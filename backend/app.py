# app.py — events-api entry point (WSGI object: `app`)
#
# Mirrors the Drink-X backend architecture (PATTERN-SPEC §A1–§A4):
#   - gevent monkey-patch FIRST, before any other import (§A3.1)
#   - single Flask app, CORS enabled, config from .env via os.getenv (§A4)
#   - pooled psycopg2 DatabaseManager, NO ORM (§A3.2)
#   - blueprints auto-discovered from scripts/ and registered by filename (§A2)
#   - GET /health (§A1)
# App-specific additions for the events app:
#   - Shopify App Proxy HMAC middleware, gated by SHOPIFY_PROXY_VERIFY (plan §4/§9)

# --- gevent patching: MUST be the very first thing that runs (§A3.1) ---
from gevent import monkey

monkey.patch_all()
from psycogreen.gevent import patch_psycopg

patch_psycopg()

import importlib
import os
from contextlib import contextmanager

import psycopg2
from flask import Flask, jsonify
from flask_cors import CORS
from psycopg2 import pool
from psycopg2.extras import RealDictCursor
from dotenv import load_dotenv

from shopify_proxy import init_shopify_proxy


# ---------------------------------------------------------------------------
# DatabaseManager — pooled psycopg2 with context managers (PATTERN-SPEC §A3.2)
# ---------------------------------------------------------------------------
class DatabaseManager:
    """Wraps a psycopg2 ThreadedConnectionPool. One transaction per get_cursor().

    Rows come back as dicts (RealDictCursor). Connections are health-checked on
    checkout so a managed-DB idle-drop is transparently retried (RDS closes idle
    connections; the keepalives + stale-check below keep the pool honest).
    """

    def __init__(self, app=None):
        self.pool = None
        if app is not None:
            self.init_app(app)

    def init_app(self, app):
        config = app.config
        self.pool = pool.ThreadedConnectionPool(
            minconn=5,
            maxconn=80,
            host=config["POSTGRES_HOST"],
            port=config["POSTGRES_PORT"],
            database=config["POSTGRES_DB"],
            user=config["POSTGRES_USER"],
            password=config["POSTGRES_PASSWORD"],
            cursor_factory=RealDictCursor,
            # TCP keepalives sized for a managed DB behind a NAT gateway (~350s)
            # so idle pooled connections are not silently dropped.
            keepalives=1,
            keepalives_idle=60,
            keepalives_interval=10,
            keepalives_count=5,
        )
        app.db_manager = self

    @contextmanager
    def get_connection(self):
        """Check out a live connection, self-healing stale ones (up to 2 retries)."""
        conn = None
        attempts = 0
        while True:
            try:
                conn = self.pool.getconn()
                # Ping: discard and refetch if the connection is dead.
                with conn.cursor() as ping:
                    ping.execute("SELECT 1")
                break
            except (psycopg2.OperationalError, psycopg2.InterfaceError):
                if conn is not None:
                    try:
                        self.pool.putconn(conn, close=True)
                    except Exception:
                        pass
                    conn = None
                attempts += 1
                if attempts > 2:
                    raise
        try:
            yield conn
        except Exception:
            conn.rollback()
            raise
        finally:
            self.pool.putconn(conn)

    @contextmanager
    def get_cursor(self, commit=True):
        """High-level API used by every blueprint. Auto commit/rollback."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            try:
                yield cursor
                if commit:
                    conn.commit()
            except Exception:
                conn.rollback()
                raise
            finally:
                cursor.close()


# Singleton shared by every blueprint via `from app import db_manager` (§A2/§A3).
db_manager = DatabaseManager()


# ---------------------------------------------------------------------------
# App construction
# ---------------------------------------------------------------------------
load_dotenv()

app = Flask(__name__)

# CORS: permissive locally; locked to the apex + backstage origins in production
# (plan §4). PURPOSE is the master environment switch (§A4).
if os.getenv("PURPOSE") == "production":
    CORS(
        app,
        origins=[
            "https://www.88bamboo.co",
            "https://events.88bamboo.co",
        ],
    )
else:
    CORS(app)

# Postgres config — the only five DB vars read from env (§A3/§A4).
app.config["POSTGRES_USER"] = os.getenv("POSTGRES_USER")
app.config["POSTGRES_PASSWORD"] = os.getenv("POSTGRES_PASSWORD")
app.config["POSTGRES_HOST"] = os.getenv("POSTGRES_HOST")
app.config["POSTGRES_PORT"] = os.getenv("POSTGRES_PORT")
app.config["POSTGRES_DB"] = os.getenv("POSTGRES_DB")

# Hard cap on request bodies so an oversized image upload is rejected before it
# is buffered into memory (plan §8 abuse control; the per-image rule lives in
# submission_validation). Headroom above the image cap covers the text fields.
_max_image_mb = int(os.getenv("MAX_IMAGE_MB", "5"))
app.config["MAX_CONTENT_LENGTH"] = (_max_image_mb + 1) * 1024 * 1024

db_manager.init_app(app)  # pool created once, at boot

# Shopify App Proxy HMAC middleware — skipped unless SHOPIFY_PROXY_VERIFY=true
# (no proxy exists locally, so it is false there — plan §4/§9).
init_shopify_proxy(app)


# ---------------------------------------------------------------------------
# Dynamic blueprint registration (PATTERN-SPEC §A2)
# Every file in scripts/ that defines `blueprint` is mounted at /<filename>,
# with underscores turned into hyphens. No central registry to edit.
# ---------------------------------------------------------------------------
def create_routes():
    scripts_path = os.path.join(os.path.dirname(__file__), "scripts")
    for script in os.listdir(scripts_path):
        if script.endswith(".py") and not script.startswith("__"):
            script_name = script[:-3]
            module = importlib.import_module(f"scripts.{script_name}")
            if hasattr(module, "blueprint"):
                app.register_blueprint(
                    module.blueprint,
                    url_prefix=f'/{script_name.replace("_", "-")}',
                )


create_routes()


# ---------------------------------------------------------------------------
# APScheduler background safety jobs (Phase 4B — plan §6/§8, PATTERN-SPEC §A8).
# scripts/scheduled_tasks.py holds the jobs (hourly auto-release + expiry alerts,
# daily digest); start_scheduler() is guarded so the jobs run in exactly ONE
# process (single gevent worker under gunicorn; the WERKZEUG_RUN_MAIN child under
# the dev reloader). Run at import time so gunicorn's worker starts it too — not
# only in the __main__ dev path.
# ---------------------------------------------------------------------------
from scripts.scheduled_tasks import start_scheduler  # noqa: E402  (after create_routes)

# main_module tells the guard whether we're `python app.py` (__main__, where the
# Werkzeug reloader can double-fire) vs an import under gunicorn (the compose path,
# single worker — always start). See scheduler_should_run().
start_scheduler(app, main_module=(__name__ == "__main__"))


if __name__ == "__main__":
    # Local direct execution only (containers run gunicorn — see Dockerfile).
    HOST = os.getenv("HOST", "0.0.0.0")
    PORT = int(os.getenv("PORT", 5000))
    FLASK_DEBUG = os.getenv("FLASK_DEBUG", "False").lower() in ("1", "true", "yes")
    app.run(host=HOST, port=PORT, debug=FLASK_DEBUG)
