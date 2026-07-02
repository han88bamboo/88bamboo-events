Part A — Backend codebase (Flask / Python)
 
# A1 — Overall structure and entry point 
## DrinkX Backend — Architecture Reference Spec

A reference for replicating the backend architecture in a separate application. Describes
the live backend only; deprecated components are flagged and should be ignored.

## 1. Top-level repository layout

The monorepo root contains:

| Path | Role |
|------|------|
| `backend/` | Python/Flask API server (this spec) |
| `frontend/` | Next.js app |
| `database/` | PostgreSQL schema + seed SQL (`database/postgresql/final/`) |
| `docker-compose.yml` | Local 3-service orchestration (db + backend + frontend) |
| `scripts/`, `the-green-bamboo/` | Tooling and an **older/legacy** copy of the project (not the live backend) |

> Note: `the-green-bamboo/` is a stale duplicate (it has its own `requirements.txt`).
> The authoritative backend is the top-level `backend/`.

## 2. Backend folder layout

```
backend/
├── app.py                    # ENTRY POINT — Flask app object `app`
├── requirements.txt          # pinned dependencies
├── Dockerfile.backend        # production/container build + run command
├── data.py                   # shared data/helpers
├── ports.py                  # LEGACY — port map doc for old microservices (not used)
├── supervisord.conf          # LEGACY — old per-service process manager (not used)
├── logging.conf              # logging config used by app.py (local/default)
├── logging-cloudwatch.conf   # alternate logging config for deployed (CloudWatch)
├── logging_helpers.py
├── s3Images.py, s3pdfMenu.py # AWS S3 integration
├── .env / .env.example       # runtime configuration (see §7)
├── scripts/                  # ~47 route modules, each exposing a Flask `blueprint`
│   ├── getData.py, createListing.py, payment.py, health.py, ...
│   └── scheduled_tasks.py    # APScheduler background jobs
├── other/                    # one-off maintenance/migration utilities
└── tests/
```

The application is a **single Flask app with dynamically-registered blueprints** — *not* a
microservice-per-process system. Each file in `scripts/*.py` defines a module-level
`blueprint`; `app.py` (`create_routes()`) walks the `scripts/` directory, imports each
module, and registers its blueprint under a URL prefix derived from the filename
(`getData.py` → `/getData`, underscores → hyphens).

> **Deprecated — do not replicate:** `supervisord.conf` and `ports.py` describe a prior
> architecture where each route file (`getData.py` on port 5000, `createListing.py` on
> 5001, …) ran as its own process on its own port. Those standalone scripts no longer
> exist at the top level (they are now blueprints inside `scripts/`), and nothing in the
> current build invokes supervisord. Ignore both files when replicating.

## 3. Entry point

- **File:** `backend/app.py`
- **WSGI application object:** `app` (a `flask.Flask` instance, created at `app.py:112`).
- Referenced by gunicorn as `app:app`.
- Startup sequence in `app.py`:
  1. `gevent.monkey.patch_all()` + `psycogreen.gevent.patch_psycopg()` (must run first — top of file).
  2. Configure logging from `logging.conf`.
  3. Create `app`, enable `CORS(app)`.
  4. `load_dotenv()` then read config from environment.
  5. Initialize the custom `DatabaseManager` (psycopg2 `ThreadedConnectionPool`, min 5 / max 80 — **no ORM**).
  6. Configure Flask-Mail and Stripe.
  7. `create_routes()` — dynamic blueprint registration.
  8. Initialize APScheduler background scheduler (`scripts/scheduled_tasks.py`).
- `if __name__ == "__main__":` block (`app.py:568`) runs Flask's built-in dev server
  (`app.run`) — used only for local direct execution, not in containers.

## 4. Web framework & key libraries

| Component | Version | Source |
|-----------|---------|--------|
| **Flask** | **3.0.2** | `requirements.txt` |
| Flask-Cors | 4.0.0 | " |
| Flask-Mail | 0.10.0 | " |
| **gunicorn[gevent]** | **21.2.0** | " (production server) |
| psycopg2-binary | 2.9.11 | " (PostgreSQL driver) |
| psycogreen | 1.0.2 | " (gevent ↔ psycopg2 bridge) |
| APScheduler | 3.10.4 | " (background jobs) |
| stripe | ≥5.0.0 (API `2025-05-28.basil`) | " / app.py |
| boto3 | 1.34.145 | " (AWS S3) |
| firebase-admin | 7.2.0 | " (push notifications) |
| PyJWT[crypto] | 2.10.1 | " (auth) |

No SQLAlchemy / ORM — database access is raw SQL via the pooled `DatabaseManager` context
managers (`get_cursor()` / `get_connection()`).

> `Flask-PyMongo` / `pymongo` are in requirements but Mongo is **disabled** — the connector
> is commented out in `app.py:432` ("OLD CONNECTOR"). PostgreSQL is the live datastore.
> Treat the Mongo deps as deprecated.

## 5. Python version

**Python 3.11** — pinned by the container base image `python:3.11-slim` (builder and runner
stages) in `Dockerfile.backend:3,16`.

## 6. How the app is configured to run

### (a) Production / deployed (gunicorn in container)
Defined by the `CMD` in `Dockerfile.backend:43`:

```
gunicorn --bind 0.0.0.0:5000 \
  --access-logfile - --error-logfile - --log-level info \
  --workers 1 --worker-class gevent --worker-connections 60 \
  app:app
```

- Single gevent worker, 60 concurrent connections, binds port 5000, logs to stdout/stderr.
- Multi-stage build: stage 1 (`builder`) installs deps with `build-essential`; stage 2
  (`runner`) installs runtime libs (`libpq-dev`, `curl`, `ca-certificates`) and copies
  site-packages + app code.
- Build args `HOST=0.0.0.0` / `PORT=5000`, `EXPOSE 5000`.
- Deployment target is AWS (ECS/ALB health checks, Aurora PostgreSQL, CloudWatch) —
  evidenced by `CLOUDWATCH_SETUP_GUIDE.md`, `logging-cloudwatch.conf`,
  `setup-cloudwatch.sh`, and the TCP-keepalive pool tuning in `app.py:184` (comments cite
  AWS NAT 350s timeout and Aurora idle-connection drops).
- Health endpoint: `GET /health` (from `scripts/health.py`).

### (b) Local development
Two supported modes:

1. **Docker Compose** (`docker-compose.yml`) — the primary local workflow. Builds the same
   `Dockerfile.backend` (so still gunicorn), service `backend` (container `flask`) on
   `127.0.0.1:5000`, with:
   - `db`: `postgres:15-alpine` on `127.0.0.1:5432`, auto-seeded from
     `database/postgresql/final/*.sql`, env from `database/.env`.
   - `frontend`: Next.js on `127.0.0.1:8080` (`API_INTERNAL_URL=http://backend:5000`).
   - `backend` waits on `db` healthcheck; `frontend` waits on `backend` healthcheck
     (`curl http://localhost:5000/health`).
2. **Direct Flask dev server** — running `python app.py` invokes
   `app.run(host, port, debug=FLASK_DEBUG)` (`app.py:568`). Used for non-containerized
   local debugging.

## 7. Configuration: deployed (a) vs local (b)

All config is environment-driven via `python-dotenv` (`load_dotenv()`); the keys live in
`backend/.env` (compose loads it via `env_file`). Keys observed (`.env` / `.env.example`):

| Variable | Local (b) | Deployed (a) |
|----------|-----------|--------------|
| `FLASK_DEBUG` | may be `True`/`False`; controls dev server reload & scheduler-start guard (`app.py:544`) | `False` |
| `POSTGRES_HOST` | `db` (compose service name) | AWS Aurora endpoint |
| `POSTGRES_PORT` / `POSTGRES_DB` / `POSTGRES_USER` / `POSTGRES_PASSWORD` | local postgres container creds | Aurora creds |
| `HOST` / `PORT` | `0.0.0.0` / `5000` (env, defaulted in app.py & Dockerfile) | same |
| `MAIL_SERVER` / `MAIL_PORT` / `MAIL_USERNAME` / `MAIL_PASSWORD` / `MAIL_USE_TLS` / `MAIL_USE_SSL` | Flask-Mail SMTP | same (real SMTP) |
| `STRIPE_SECRET_KEY` | test key | live key |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | S3 access | S3 access |
| `GOOGLE_APPLICATION_CREDENTIALS` | path to `serviceAccountKey.json` (Firebase) | same |
| `APNS_KEY_ID` / `APNS_KEY_PATH` / `APNS_TEAM_ID` / `APNS_USE_SANDBOX` | Apple Push (sandbox=true) | sandbox=false |
| `PURPOSE` | environment/marker flag | " |

Logging config also differs by environment: `logging.conf` is the default loaded by
`app.py`; `logging-cloudwatch.conf` is the deployed variant for CloudWatch (see
`CLOUDWATCH_SETUP_GUIDE.md`).

---

**Summary for replication:** single Python 3.11 Flask 3.0.2 app, object `app` in `app.py`,
raw psycopg2 connection-pooling (no ORM), routes auto-registered as blueprints from a
`scripts/` directory, background jobs via APScheduler, served by gunicorn (1 gevent worker,
port 5000) in a multi-stage `python:3.11-slim` Docker image — orchestrated locally with
Docker Compose (Flask + Postgres 15 + Next.js) and deployed on AWS (Aurora + ECS/ALB +
CloudWatch), all configured through `.env`. Ignore `supervisord.conf`, `ports.py`, and the
Mongo dependencies as deprecated.


# A2 — Routes / API organisation

## Backend Routing Architecture

This document describes how the backend organises its HTTP routes/endpoints, so the
pattern can be replicated in a brand-new, separate application. It reflects the **live**
stack only (the legacy Mongo connector and the older `the-green-bamboo/` copy are
intentionally excluded).

---

## 1. Framework & pattern: Flask + auto-registered Blueprints

The backend is a **single Flask application** that uses **Flask Blueprints — one Blueprint
per feature file** — rather than a single monolithic route file or a hand-maintained
registration list.

Key idea: **Blueprints are discovered and registered dynamically at startup** by scanning a
`scripts/` folder.

- Every file in `scripts/` is a self-contained feature module that defines exactly one
  module-level variable named `blueprint`.
- `app.py` loops over the folder, imports each module, and registers any `blueprint` it finds.
- **The URL prefix is derived from the filename**, with `_` converted to `-`. So
  `getData.py` → prefix `/getData`, and `push_notifications.py` → prefix `/push-notifications`.

To add a new endpoint group you simply drop a new file in `scripts/`. There is **no central
registry to edit**.

### The registration loop (`app.py`)

```python
import os
import importlib

def create_routes():
    scripts_path = os.path.join(os.path.dirname(__file__), "scripts")
    for script in os.listdir(scripts_path):
        if script.endswith(".py"):
            script_name = script[:-3]
            module = importlib.import_module(f"scripts.{script_name}")
            # Register the Blueprint from the module if it exists
            if hasattr(module, "blueprint"):
                blueprint = getattr(module, "blueprint")
                app.register_blueprint(
                    blueprint, url_prefix=f'/{script_name.replace("_", "-")}'
                )

create_routes()
```

---

## 2. Folder / file structure

```
backend/
├── app.py                 # Flask app: DB pool, CORS, logging, dynamic blueprint loader
├── ports.py               # Documentation-only map of file -> port -> routes (not wired in)
├── requirements.txt
├── Dockerfile.backend
├── .env / .env.example    # Config; deployed-vs-local switching lives here (see section 4)
├── data.py, s3Images.py, s3pdfMenu.py, logging_helpers.py   # Shared helpers (no blueprint)
└── scripts/               # ONE BLUEPRINT PER FILE — this is the route layer
    ├── getData.py         # prefix /getData   — all read/GET endpoints (largest file)
    ├── createListing.py   # prefix /createListing
    ├── editListing.py     # prefix /editListing
    ├── createReview.py    # prefix /createReview
    ├── editReview.py, deleteReview.py
    ├── createAccount.py, editProfile.py, authcheck.py
    ├── venues.py, menu.py, menuHistory.py, events.py, club.py
    ├── payment.py         # Stripe
    ├── notifications.py, push_notifications.py, scheduled_tasks.py
    ├── health.py          # prefix /health
    └── ... (~45 feature modules total)
```

Notes:
- There is **no per-route registration in `app.py`** and **no list of blueprints to
  maintain**.
- `ports.py` is purely a human-readable index of files → routes (a documentation artefact,
  not imported by the app).
- Shared, non-route helpers (image upload to S3, data utilities, logging) live as top-level
  modules and are imported by the route modules; they do **not** define a `blueprint`.

---

## 3. The per-module convention

Every route module follows the same header so the loader can find its blueprint. The
blueprint's internal name is set to the filename:

```python
import os
from flask import Blueprint, jsonify

file_name = os.path.basename(__file__)
blueprint = Blueprint(file_name[:-3], __name__)   # blueprint name = filename (no .py)
```

Modules that touch the database also import the shared pooled-connection manager (a
singleton defined in `app.py`) and use its cursor context manager. There is **no ORM** — raw
SQL via `psycopg2`, with a `ThreadedConnectionPool` underneath:

```python
from app import db_manager   # singleton wrapping psycopg2 ThreadedConnectionPool

# inside a route:
with db_manager.get_cursor() as cursor:       # auto commit/rollback + connection return
    cursor.execute('SELECT * FROM "listings" WHERE "id" = %s', (id,))
    row = cursor.fetchone()
```

The standard return convention is `jsonify(...)`: a list/dict of rows for reads, or a
`{"code"/"error": ...}` envelope for writes, optionally with an explicit HTTP status code.

---

## 4. Representative endpoint examples

### A. Health check (smallest blueprint)

`health.py` — route `""` maps to the prefix root, so this serves **`GET /health`**:

```python
@blueprint.route("", methods=["GET"])
def info():
    return jsonify({"code": 200, "data": "OK"}), 200
```

### B. GET with a path parameter

`getData.py` (prefix `/getData`) — full path **`GET /getData/getListing/<id>`**:

```python
@blueprint.route("/getListing/<id>")
def getListing(id):
    with db_manager.get_cursor() as cursor:
        cursor.execute('SELECT * FROM "listings" WHERE "id" = %s', (id,))
        listing_data = cursor.fetchone()
    # returns the listing row as JSON, or jsonify([]) if not found
```

### C. POST that writes

`createReview.py` (prefix `/createReview`) — full path **`POST /createReview/createReview`**:

```python
@blueprint.route("/createReview", methods=['POST'])
def createReviews():
    raw_review = request.get_json()
    with db_manager.get_cursor() as cursor:
        ...                       # insert review, award points/badges, notify
    # returns a JSON success/error object (jsonify({...}), status code)
```

---

## 5. Deployed vs. local: driven entirely by `.env`

The backend code is **environment-agnostic** — it always calls `os.getenv(...)`. Which
environment you run is decided purely by which lines are active in `.env`, organised as
**commented blocks you toggle**:

```dotenv
# # FOR LOCAL LAUNCH (comment out before deployment)
# POSTGRES_USER=...
# POSTGRES_HOST=...        # points at the local/Docker Postgres

# FOR DEPLOYED (comment out before local launch)
POSTGRES_USER=...
POSTGRES_HOST=...          # points at the managed cloud DB (currently active)
```

The same toggle pattern applies to `MAIL_SERVER`, a `PURPOSE` flag, and the Stripe key (a
**live** key vs. a commented-out **sandbox** key). `app.py` reads these blindly into
`app.config` and into the connection pool, so swapping environments is a matter of which
block is uncommented — never a code change.

Two things in `app.py` do react to environment values at runtime:

- **Server bind:** `HOST` / `PORT` / `FLASK_DEBUG` come from env (defaults `0.0.0.0:5000`,
  debug off).
- **Background scheduler:** only starts in the main (non-reloader) process / when not in
  debug, so the local reloader behaves differently from the deployed process.

The connection pool also carries cloud-specific tuning (TCP keepalives sized for a managed-DB
/ NAT idle timeout) that matters for the deployed path but is harmless locally.

### Docker / local-compose path

`docker-compose.yml` provides the alternative "local site" wiring without editing `.env`
blocks: it runs Postgres + the Flask backend + the frontend, binds the backend to
`127.0.0.1:5000`, and injects DB creds via `env_file`.

### Frontend → backend base-URL selection

The one place with explicit deployed/local branching is the frontend API client:

```js
const isServer = typeof window === 'undefined';
const API_BASE_URL = isServer
  ? (process.env.API_INTERNAL_URL || process.env.NEXT_PUBLIC_API_URL || 'http://backend:5000') // SSR / in-cluster
  : (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000');                               // browser
```

Server-side rendering hits the internal service URL (`http://backend:5000` in Docker), while
the browser hits `NEXT_PUBLIC_API_URL` (the public API host in prod, `localhost:5000` locally).

---

## 6. Checklist to replicate the pattern

1. One Flask app object; enable CORS; load `.env` with `python-dotenv`.
2. A `scripts/` (or `routes/`) package, **one file per feature**, each defining
   `blueprint = Blueprint(filename, __name__)`.
3. A loader in `app.py` that walks the folder, imports each module, and
   `register_blueprint(bp, url_prefix="/" + filename_with_dashes)`.
4. A shared pooled-DB singleton (`db_manager` with a `get_cursor()` context manager) imported
   by route modules — no ORM.
5. Keep all environment differences in `.env` (toggle blocks) so backend code stays
   env-agnostic; put the only deployed-vs-local branch in the frontend's API base-URL resolver.
```


# A3 — Database layer postgres-access-pattern
## PostgreSQL Access Pattern — Reference Spec

How the DrinkX backend talks to PostgreSQL, written so the exact pattern can be
replicated in a new, separate application. Deprecated MongoDB remnants are
**excluded** (see note at the end).

---

## 1. Stack at a glance

| Concern | Choice |
|---|---|
| Language / framework | Python 3 + **Flask 3** (`backend/app.py`) |
| DB driver | **`psycopg2-binary` 2.9.x** — raw psycopg2, **no ORM** |
| Pooling | **`psycopg2.pool.ThreadedConnectionPool`** (driver-native, not SQLAlchemy) |
| Async/WSGI | gunicorn `[gevent]` + `psycogreen` (gevent-patched psycopg2) |
| Result shape | `psycopg2.extras.RealDictCursor` → every row is a `dict` |
| Models | **None.** No model classes, no schema mapping in Python. Tables live in raw SQL; queries are hand-written SQL strings. |
| Migrations | **None automated.** Plain `.sql` files applied manually / on container init. No Alembic, no Flask-Migrate. |
| DB server | PostgreSQL 15 (`postgres:15-alpine` locally; AWS Aurora/RDS in prod) |

There is **no SQLAlchemy, no Alembic, no Flask-Migrate, no Flask-SQLAlchemy**
anywhere in the codebase. Persistence is raw SQL executed through psycopg2.

---

## 2. Where things live

```
backend/
  app.py                 # Flask app + DatabaseManager (the entire DB layer)
  .env                   # runtime config (toggled local vs deployed by comments)
  .env.example           # documented env keys
  requirements.txt       # psycopg2-binary, psycogreen, gunicorn[gevent], ...
  scripts/               # one file per feature area; each exposes a `blueprint`
    getData.py           # read endpoints (SELECT ...)
    createListing.py     # write endpoints (INSERT/UPDATE ...)
    ... (~40 more)
database/
  postgresql/final/
    00-init.sql          # create DB + role + grants (run first)
    01-postgresql_data3.sql  # AUTHORITATIVE schema: CREATE EXTENSION + CREATE TABLE x50+
    02-insert-data.sql   # seed data
  migrations/
    add_variantGroupID_column.sql  # ad-hoc, hand-written, manually applied
docker-compose.yml       # wires Postgres + backend + frontend
```

Key idea: **the database schema is defined only in SQL** (`database/postgresql/final/`),
never in Python. Python only holds SQL query strings.

---

## 3. Connection layer (`backend/app.py`)

### 3.1 gevent patching (must be first lines in the entrypoint)

```python
from gevent import monkey
monkey.patch_all()
from psycogreen.gevent import patch_psycopg
patch_psycopg()
```

This makes psycopg2 cooperate with gevent greenlets (needed for
`gunicorn[gevent]`). Replicate verbatim and keep it at the very top, before any
other imports.

### 3.2 The `DatabaseManager` — pool + context managers

A single hand-rolled class wraps `ThreadedConnectionPool` and exposes two
context managers. This replaces what an ORM "session" would otherwise do.

```python
import psycopg2
from psycopg2 import pool
from psycopg2.extras import RealDictCursor
from contextlib import contextmanager

class DatabaseManager:
    def __init__(self, app=None):
        self.pool = None                 # created in init_app (app-factory friendly)
        if app:
            self.init_app(app)

    def init_app(self, app):
        config = app.config
        self.pool = pool.ThreadedConnectionPool(
            minconn=5,
            maxconn=80,
            host=config['POSTGRES_HOST'],
            port=config['POSTGRES_PORT'],
            database=config['POSTGRES_DB'],
            user=config['POSTGRES_USER'],
            password=config['POSTGRES_PASSWORD'],
            cursor_factory=RealDictCursor,   # rows come back as dicts, not tuples
            # TCP keepalives: keep AWS NAT gateway (~350s) / Aurora from silently
            # killing idle pooled connections.
            keepalives=1,
            keepalives_idle=60,
            keepalives_interval=10,
            keepalives_count=5,
        )
        app.db_manager = self

    @contextmanager
    def get_connection(self):
        # getconn() -> health-check (handles Aurora 5-min idle drops) ->
        # yield -> rollback on error -> putconn() back to pool.
        # Retries up to 2x with a fresh connection if a stale one is detected.
        ...

    @contextmanager
    def get_cursor(self, commit=True):
        # The high-level API used by every route.
        with self.get_connection() as conn:
            cursor = conn.cursor()
            try:
                yield cursor
                if commit:
                    conn.commit()      # auto-commit on clean exit
            except Exception:
                conn.rollback()        # auto-rollback on any exception
                raise
            finally:
                cursor.close()

# Singleton, shared by every blueprint via `from app import db_manager`
db_manager = DatabaseManager()
```

Wiring during startup (module level, after `load_dotenv()`):

```python
app = Flask(__name__)
app.config["POSTGRES_USER"]     = os.getenv("POSTGRES_USER")
app.config["POSTGRES_PASSWORD"] = os.getenv("POSTGRES_PASSWORD")
app.config["POSTGRES_HOST"]     = os.getenv("POSTGRES_HOST")
app.config["POSTGRES_PORT"]     = os.getenv("POSTGRES_PORT")
app.config["POSTGRES_DB"]       = os.getenv("POSTGRES_DB")
db_manager.init_app(app)         # pool created once, at boot, not per request
```

Notable behaviours to replicate:
- **One transaction per `get_cursor()` call.** No long-lived sessions. Commit is
  automatic unless `get_cursor(commit=False)`.
- **Stale-connection self-healing.** Before use, each checked-out connection is
  pinged; dead ones (Aurora closes idle conns after ~5 min) are discarded and a
  fresh one is fetched, up to 2 retries.
- **No `teardown_request` / manual close.** The pool owns connection lifecycle.

### 3.3 Health endpoint

`GET /health/db-pool` returns live pool stats (`used`/`maxconn`, status) — handy
for load-balancer / monitoring checks.

---

## 4. How routes use it (the per-feature pattern)

Each file in `backend/scripts/` defines a Flask **Blueprint** named after the
file and imports the shared `db_manager`. `app.py` auto-discovers and registers
every blueprint:

```python
# app.py — dynamic blueprint registration
def create_routes():
    scripts_path = os.path.join(os.path.dirname(__file__), "scripts")
    for script in os.listdir(scripts_path):
        if script.endswith(".py"):
            name = script[:-3]
            module = importlib.import_module(f"scripts.{name}")
            if hasattr(module, "blueprint"):
                app.register_blueprint(module.blueprint,
                                       url_prefix=f'/{name.replace("_", "-")}')
create_routes()
```

A script file:

```python
# scripts/getData.py
import psycopg2
from flask import Blueprint, g, jsonify
from app import db_manager          # the shared singleton

file_name = os.path.basename(__file__)
blueprint = Blueprint(file_name[:-3], __name__)   # blueprint name == filename

@blueprint.route("/getListings", methods=['GET'])
def getListings():
    try:
        with db_manager.get_cursor() as cursor:          # read: commit is harmless
            cursor.execute('SELECT * FROM "listings"')
            listings_data = cursor.fetchall()            # list[dict] via RealDictCursor
        return jsonify(listings_data or [])
    except psycopg2.Error as db_error:
        return jsonify({"code": 500, "message": "Database error occurred"}), 500
```

**Writes use parameterized SQL (`%s` placeholders — never string interpolation of
values):**

```python
# scripts/createListing.py
set_clause = ', '.join(f'"{k}" = %s' for k in updates.keys())   # identifiers only
cursor.execute(
    f'UPDATE "listings" SET {set_clause} WHERE "id" = %s',
    list(updates.values()) + [listing_id],                       # values bound, not interpolated
)
```

Conventions to copy:
- Table/column names are `"double-quoted"` because the schema uses camelCase
  identifiers (e.g. `"listingName"`, `"producerID"`).
- Values are always passed as the second arg to `execute()` (`%s` binding) to
  avoid SQL injection. Only identifier names are ever f-string'd in.
- `get_cursor()` (default `commit=True`) is used for both reads and writes.

---

## 5. The "model" (there are no model classes)

A "model" here is purely a `CREATE TABLE` in
`database/postgresql/final/01-postgresql_data3.sql`. Extensions are enabled at
the top of that file:

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;     -- trigram fuzzy search
CREATE EXTENSION IF NOT EXISTS unaccent;    -- accent-insensitive matching
```

Example table (the canonical `listings` entity):

```sql
CREATE TABLE "listings" (
    "id"            SERIAL PRIMARY KEY,
    "listingName"   VARCHAR(500),
    "producerID"    INTEGER REFERENCES "producers"("id") ON DELETE SET NULL,
    "bottler"       VARCHAR(255),
    "bottlerID"     INTEGER REFERENCES "producers"("id") ON DELETE SET NULL,
    "originCountry" VARCHAR(255),
    "drinkType"     VARCHAR(255),
    "abv"           FLOAT,
    "officialDesc"  TEXT,
    "allowMod"      BOOLEAN,
    "addedDate"     TIMESTAMP,
    "typeCategory"  VARCHAR(255),
    "age"           VARCHAR(500),
    "reviewLink"    VARCHAR(255),
    "sourceLink"    VARCHAR(255),
    "photo"         TEXT,
    "drinkStyle"    VARCHAR(255),
    "tags"          TEXT,
    "order"         INTEGER DEFAULT NULL,
    "varietyTags"   TEXT[]                  -- Postgres array column
);
```

Patterns visible in the schema (replicate as desired): `SERIAL` surrogate PKs,
FK `REFERENCES ... ON DELETE SET NULL`, `TEXT[]` arrays, and JSONB columns on
some tables for flexible list storage. 50+ tables follow this same plain-SQL
style.

---

## 6. Migrations (manual SQL — no framework)

There is **no migration tool**. Schema changes are plain `.sql` files applied by
hand. Two layers:

**a) Initial schema + seed**, ordered by filename prefix so the Postgres Docker
init runs them in sequence:

```
database/postgresql/final/00-init.sql              # CREATE DATABASE/USER + GRANTs
database/postgresql/final/01-postgresql_data3.sql  # extensions + all CREATE TABLEs
database/postgresql/final/02-insert-data.sql       # seed rows
```

**b) Incremental changes** — one hand-written file per change in
`database/migrations/`, e.g. `add_variantGroupID_column.sql`:

```sql
ALTER TABLE "myCellarItems"
  ADD COLUMN "variantGroupID" INTEGER
  REFERENCES "myCellarItems"("id") ON DELETE SET NULL;
CREATE INDEX idx_cellar_variant_group ON "myCellarItems" ("variantGroupID");
-- followed by data-backfill UPDATEs
```

### Commands used

**Local (Docker, automatic on first boot):** `docker-compose.yml` mounts the
`final/` folder into the Postgres image's init hook, which runs every `*.sql`
there **once, on first container start** (empty data volume):

```yaml
db:
  image: postgres:15-alpine
  env_file: [database/.env]
  volumes:
    - pgdata:/var/lib/postgresql/data
    - ./database/postgresql/final:/docker-entrypoint-initdb.d:ro   # auto-runs 00,01,02
```

```bash
docker compose up -d db          # first boot runs 00-init, 01-schema, 02-seed in order
# to re-run from scratch (DESTROYS data): drop the volume, then boot again
docker compose down -v && docker compose up -d db
```

**Applying an incremental migration (local or deployed) — just pipe the file to psql:**

```bash
# local
psql "postgresql://<user>:<pass>@127.0.0.1:5432/<db>" \
  -f database/migrations/add_variantGroupID_column.sql

# deployed (against Aurora/RDS host)
psql "postgresql://<user>:<pass>@<POSTGRES_HOST>:5432/<db>" \
  -f database/migrations/add_variantGroupID_column.sql
```

There is no `revision`, `upgrade`, or `downgrade` command — forward-only,
operator-run SQL.

---

## 7. Config: deployed vs local (driven by `.env`)

The backend reads **the same five env vars** in all environments —
`POSTGRES_USER / _PASSWORD / _HOST / _PORT / _DB`. Which environment you get is
decided entirely by **which lines are commented out** in `backend/.env`. The
file literally ships with two blocks and you toggle the comments:

```dotenv
# # FOR LOCAL LAUNCH (comment out before deployment)
# POSTGRES_USER=<local-user>
# POSTGRES_PASSWORD=<local-pass>
# POSTGRES_HOST=db            # the docker-compose service name

# FOR DEPLOYED (comment out before local launch)
POSTGRES_USER=<prod-user>
POSTGRES_PASSWORD=<prod-pass>
POSTGRES_HOST=<aurora-or-rds-endpoint>

# shared by both
POSTGRES_PORT=5432
POSTGRES_DB=<db-name>
FLASK_DEBUG=False
```

| | (a) Deployed site | (b) Local site |
|---|---|---|
| `POSTGRES_HOST` | AWS Aurora/RDS endpoint | `db` (compose service) — or `127.0.0.1` if running Flask outside Docker |
| `POSTGRES_PORT` | `5432` | `5432` (compose maps `127.0.0.1:5432:5432`) |
| `POSTGRES_USER/PASSWORD/DB` | production creds | local creds, must match `database/.env` used by the Postgres container |
| Active `.env` block | "FOR DEPLOYED" uncommented | "FOR LOCAL" uncommented |
| DB server | managed Aurora/RDS (idle-connection drops → the pool's keepalives + stale-check matter) | `postgres:15-alpine` container |
| Schema/seed bootstrap | run SQL files manually against the managed instance | auto-run via `docker-entrypoint-initdb.d` on first boot |
| Other env that flips with it | `PURPOSE`, `MAIL_SERVER`, Stripe live vs sandbox key | local equivalents (also comment-toggled) |

Note the **two separate `.env` files** for local:
- `backend/.env` → consumed by Flask (`load_dotenv()` + `os.getenv`).
- `database/.env` → consumed by the Postgres container (`POSTGRES_USER/PASSWORD/DB`)
  to initialize the local DB. Keep the credentials in these two in sync locally.

`backend/.env.example` documents the full key list for a fresh setup.

---

## 8. Replication checklist

1. `pip install` : `Flask`, `psycopg2-binary`, `psycogreen`, `gunicorn[gevent]`,
   `python-dotenv` (+ `gevent`).
2. Put the gevent + `patch_psycopg()` monkey-patch at the very top of the entrypoint.
3. Drop in the `DatabaseManager` class (pool `minconn=5/maxconn=80`,
   `RealDictCursor`, keepalives, `get_connection` + `get_cursor` context managers,
   stale-connection retry). Instantiate one module-level singleton; call
   `init_app(app)` once at boot.
4. Define schema as raw `.sql` (`CREATE EXTENSION` + `CREATE TABLE`); apply via
   `psql -f` (or Docker `docker-entrypoint-initdb.d` numeric-prefix ordering).
5. One blueprint per feature file; `from app import db_manager`; run hand-written
   SQL inside `with db_manager.get_cursor() as cursor:`; bind values with `%s`.
6. Config via env vars (`POSTGRES_*`); switch local↔deployed by toggling the
   commented blocks in `.env`; keep `backend/.env` and the DB-container `.env` in
   sync for local.
7. Migrations are forward-only hand-written `.sql` run with `psql -f`. No tooling.

---

### Excluded as deprecated (do not replicate)
- `backend/data.py` and `Flask-PyMongo` / `pymongo` are **legacy MongoDB**
  dataclasses from the previous datastore, kept only as commented-out "OLD
  CONNECTOR" references. The live datastore is PostgreSQL via psycopg2 as
  described above.




# A4 — Configuration and environment variables 

## Backend Configuration Reference

Runtime configuration and environment variables read by the **DrinkX Flask backend**
(`backend/`). This is the authoritative list of settings a replacement application
must also provide. Secret values are shown as `<REDACTED>`.

The backend is a Flask app (Gunicorn + gevent worker) that reads all configuration from
**a single `.env` file** loaded with `python-dotenv` (`load_dotenv()`), plus process
environment variables. There is no separate settings module — config is read inline in
`app.py` and in individual feature modules.

---

## 1. Where config is loaded

| File | Role |
|------|------|
| `backend/.env` | The single env file. Holds **both** the local and deployed value sets; you switch environments by commenting/uncommenting blocks (see §3). |
| `backend/app.py` | Main app. Calls `load_dotenv()` (line 143). Reads Postgres, Mail, Stripe, and server (HOST/PORT/FLASK_DEBUG) settings into `app.config`. Builds the Postgres connection pool (`DatabaseManager.init_app`). |
| `backend/s3Images.py` | Image uploads to S3. Reads `PURPOSE`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`. Selects bucket/region from `PURPOSE`. |
| `backend/s3pdfMenu.py` | PDF-menu → image uploads to S3. Same vars/logic as `s3Images.py`. |
| `backend/scripts/mail.py` | Transactional email via **AWS SES** (boto3). Reads `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN`; sets `AWS_DEFAULT_REGION`. |
| `backend/scripts/authcheck.py` | Auth flows + SMTP email send. Reads `PURPOSE`, `MAIL_SERVER`, `MAIL_PORT`, `MAIL_USE_TLS`, `MAIL_USERNAME`, `MAIL_PASSWORD`. |
| `backend/scripts/notifications.py` | Push notifications. Reads APNs vars (iOS) and uses Firebase Admin via `GOOGLE_APPLICATION_CREDENTIALS` (Android/FCM). |
| `backend/scripts/payment.py` | Stripe. Reads `STRIPE_PUBLISHABLE_KEY` (diagnostics only; the live secret key is set in `app.py`). |
| `backend/scripts/createAccount.py` | Reads `PURPOSE` to branch dev/prod behavior. |
| `docker-compose.yml` | Wires `backend/.env` into the `backend` container via `env_file`; Postgres container reads `database/.env`. |

---

## 2. Full variable list

### Server / Flask
| Name | Purpose | Default |
|------|---------|---------|
| `HOST` | Bind address for the Flask/Gunicorn server. | `0.0.0.0` |
| `PORT` | Listen port for the backend. | `5000` |
| `FLASK_DEBUG` | Flask debug mode toggle. | `False` |
| `PURPOSE` | **Master environment switch.** `production` vs `development`. Drives S3 bucket/region selection, whether AWS keys are read vs IAM role is used, and dev/prod branches in auth & account creation. | (none — must be set) |

### PostgreSQL (primary database — connection pool in `app.py`)
| Name | Purpose |
|------|---------|
| `POSTGRES_HOST` | Database host. |
| `POSTGRES_PORT` | Database port. |
| `POSTGRES_DB` | Database name. |
| `POSTGRES_USER` | Database user. |
| `POSTGRES_PASSWORD` | Database password. |

> The pool itself (min 5 / max 80 connections, TCP keepalives) is hardcoded in
> `DatabaseManager.init_app`; only the five connection vars above come from env.

### Email — SMTP (Flask-Mail in `app.py`, direct SMTP in `authcheck.py`)
| Name | Purpose | Notes |
|------|---------|-------|
| `MAIL_SERVER` | SMTP server hostname. | |
| `MAIL_PORT` | SMTP port. | Default `587`. |
| `MAIL_USERNAME` | SMTP / sender login. | |
| `MAIL_PASSWORD` | SMTP password. | |
| `MAIL_USE_TLS` | Enable STARTTLS. | Read from env in `authcheck.py`; **hardcoded `True`** in `app.py`. |

> In `app.py` these are also hardcoded and **not** read from env: `MAIL_USE_SSL=False`
> and `MAIL_DEFAULT_SENDER='Drink-X <noreply@drink-x.com>'`. They appear in `.env` but
> have no runtime effect there — set the sender in code to replicate.

### Email — AWS SES (`scripts/mail.py`, boto3)
Uses the AWS credential vars below (§AWS). Region defaults to `ap-southeast-1` via
`AWS_REGION`; `scripts/mail.py` also exports `AWS_DEFAULT_REGION` from that value.

### AWS / S3 (`s3Images.py`, `s3pdfMenu.py`, `scripts/mail.py`)
| Name | Purpose | Notes |
|------|---------|-------|
| `AWS_ACCESS_KEY_ID` | AWS access key. | Used for S3 and SES. In `PURPOSE=production`, S3 clients are created **without** explicit keys (rely on the ECS task **IAM role**); keys are used only when `PURPOSE=development`. |
| `AWS_SECRET_ACCESS_KEY` | AWS secret key. | Same prod/dev rule as above. |
| `AWS_REGION` | AWS region for SES. | Default `ap-southeast-1` (`scripts/mail.py`). |
| `AWS_SESSION_TOKEN` | Optional temporary-credential session token for SES. | Optional. |
| *(`AWS_DEFAULT_REGION`)* | Set by `scripts/mail.py` from `AWS_REGION`; not something you set yourself. | Derived. |

**S3 buckets/regions are selected by `PURPOSE` (hardcoded in `s3Images.py` / `s3pdfMenu.py`):**
| `PURPOSE` | Bucket | Region | Credentials |
|-----------|--------|--------|-------------|
| `production` | `tf-drinkx-prod-fe-images` | `ap-southeast-1` | IAM role (no keys) |
| `development` (anything else) | `drinkximages` | `us-east-1` | `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` |

### Stripe (`app.py`, `scripts/payment.py`) ⚠️ EVENTS APP: Drink-X's payment.py uses Stripe SUBSCRIPTIONS with price IDs. The events app needs PaymentIntents with capture_method=manual (authorise-now / capture-on-approval). BUILD FRESH — do not copy the subscription logic. Reuse only the shape (secret key from env, client_secret to the frontend, Stripe Elements).
| Name | Purpose | Notes |
|------|---------|-------|
| `STRIPE_SECRET_KEY` | Stripe secret API key. Set as `stripe.api_key` in `app.py`. | `.env` keeps both a live key and a commented sandbox key. API version `2025-05-28.basil` is pinned in code. |
| `STRIPE_PUBLISHABLE_KEY` | Stripe publishable key. | Only referenced in a diagnostics endpoint in `payment.py`; optional for core flows. |

### Apple Push Notifications — APNs (`scripts/notifications.py`)
| Name | Purpose | Default |
|------|---------|---------|
| `APNS_KEY_PATH` | Path to the APNs auth key [EVENTS APP: No mobile app, no push. Omit APNs, Firebase, and the PyJWT[crypto] / firebase-admin dependencies entirely.] `.p8` file on disk (e.g. `backend/AuthKey_64V343ZN58.p8`). | (none) |
| `APNS_KEY_ID` | 10-character APNs Key ID. | (none) |
| `APNS_TEAM_ID` | Apple Developer Team ID. | (none) |
| `APNS_BUNDLE_ID` | App bundle ID used as the APNs topic. | `com.88bamboo.drinkx` |
| `APNS_USE_SANDBOX` | `true` → sandbox APNs host, else production host. | `true` |

> If `APNS_KEY_PATH`/`APNS_KEY_ID`/`APNS_TEAM_ID` are unset, push silently skips.

### Firebase Cloud Messaging — Android push (`scripts/notifications.py`)
| Name | Purpose |
|------|---------|
| `GOOGLE_APPLICATION_CREDENTIALS` | Path to the Firebase Admin SDK service-account JSON (e.g. `backend/serviceAccountKey.json`). Consumed by `firebase_admin.initialize_app()` (FCM V1 API). |

---

## 3. Local vs. Deployed (.env switching)

The repo uses **one `.env`** with two value sets toggled by comments. The variables that
differ between environments:

| Variable | Local (development) | Deployed (production) |
|----------|--------------------|-----------------------|
| `PURPOSE` | `development` | `production` |
| `MAIL_SERVER` | local/dev SMTP host | production SMTP host |
| `POSTGRES_USER` | local DB user | production (Aurora) DB user  CORRECTION: drinkxprod is a plain RDS PostgreSQL instance, NOT Aurora. The events app gets its OWN new, separate RDS PostgreSQL instance (same VPC, own security group). |
| `POSTGRES_PASSWORD` | local DB password | production DB password |
| `POSTGRES_HOST` | local host (e.g. `db` / `localhost`) | production DB endpoint |

Knock-on effects of `PURPOSE`:
- **production** → S3 bucket `tf-drinkx-prod-fe-images` @ `ap-southeast-1`, S3 auth via IAM role.
- **development** → S3 bucket `drinkximages` @ `us-east-1`, S3 auth via `AWS_*` keys.

The remaining variables (`POSTGRES_PORT`, `POSTGRES_DB`, all `MAIL_*` except server,
`STRIPE_*`, `AWS_*`, `APNS_*`, `GOOGLE_APPLICATION_CREDENTIALS`, `FLASK_DEBUG`) are the
same across environments in this `.env`.

### Container wiring (`docker-compose.yml`)
- `backend` service: `env_file: backend/.env`; `.env` is also `COPY`d into the image (`Dockerfile.backend`).
- `db` service (Postgres 15): `env_file: database/.env` (its own `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` for container init).

---

## 4. Credential files referenced at runtime
These on-disk files are pointed to by config and must ship with the new app:
| File | Referenced by | Purpose |
|------|---------------|---------|
| `.p8` APNs key (e.g. `AuthKey_64V343ZN58.p8`) | `APNS_KEY_PATH` | Signs APNs JWTs. |
| Firebase service-account JSON (e.g. `serviceAccountKey.json`) | `GOOGLE_APPLICATION_CREDENTIALS` | Firebase Admin / FCM auth. |

---

## 5. Excluded — deprecated / non-runtime (do NOT replicate)
- `MONGO_DB_URL` — old MongoDB connector. The Mongo connection in `app.py` is commented
  out ("OLD CONNECTOR"); `data.py` (Mongo dataclasses, marked "TO BE DELETED") and the
  `backend/other/` migration scripts still reference it, but the live backend runs on
  PostgreSQL. Not needed.
- `POSTGRES_URI` — used only by `backend/tests/test_db_connection.py`, not the app.
- `WERKZEUG_RUN_MAIN` — set automatically by the Werkzeug reloader; not user config.



# A5 — AWS / S3 integration in code 

## S3 File-Handling Reference Spec

A concise, copy-ready description of how the DrinkX backend interacts with AWS S3 for image and PDF storage. Describes current (non-deprecated) behaviour only.

## 1. Library & dependencies

- **AWS SDK:** `boto3` (the `s3` client), with `botocore.exceptions` (`NoCredentialsError`, `ClientError`) for error handling. No `@aws-sdk` / JS SDK on the backend.
- **Config loading:** `python-dotenv` (`load_dotenv()`) reads environment from `.env`.
- **Supporting libs:** `base64`, `uuid`, `io`/`BytesIO`, `requests` (for fetching remote images), `fitz` (PyMuPDF, for PDF→image rendering).

Two modules own all S3 logic:

| File | Responsibility |
| --- | --- |
| `backend/s3Images.py` | Image upload (base64 & remote URL), image delete |
| `backend/s3pdfMenu.py` | PDF upload, PDF→PNG-pages upload, PDF/menu delete, PDF validation |

These are imported directly by request handlers in `backend/scripts/*.py` (e.g. `createReview.py`, `editVenueProfile.py`, `club.py`, `assembly.py`, `adminFunctions.py`, `events.py`, `userWall.py`, `editReview.py`, `deleteReview.py`, `deleteVenue.py`, `editProducerTextSections.py`).

## 2. Environment-driven configuration (deployed vs local)

A single env var, `PURPOSE`, switches **bucket, region, and credential source**. It is read once at module load in both `s3Images.py` and `s3pdfMenu.py`:

```python
purpose = os.getenv('PURPOSE')

if purpose == 'production':
    bucket_name = 'tf-drinkx-prod-fe-images'
    region = 'ap-southeast-1'
else:
    bucket_name = 'drinkximages'
    region = 'us-east-1'
```

| Mode (`PURPOSE`) | Bucket | Region | Credentials |
| --- | --- | --- | --- |
| **(a) Deployed site** — `production` | `tf-drinkx-prod-fe-images` | `ap-southeast-1` | None passed in code. `boto3.client('s3')` relies on the **IAM role of the ECS task** (ambient credentials). |
| **(b) Local site** — `development` (any non-`production` value) | `drinkximages` | `us-east-1` | Explicit `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` from `.env`, passed into the client. |

Client construction pattern (identical across all functions):

```python
if purpose == 'development':
    credentials = {
        'aws_access_key_id': os.getenv('AWS_ACCESS_KEY_ID'),
        'aws_secret_access_key': os.getenv('AWS_SECRET_ACCESS_KEY'),
    }

if purpose == 'production':
    s3 = boto3.client('s3')                       # IAM role, region implicit
else:
    s3 = boto3.client('s3', region_name=region, **credentials) \
         if credentials else boto3.client('s3', region_name=region)
```

**Required env vars** (`backend/.env.example`): `PURPOSE`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`. (Production leaves the two AWS keys unset and uses the task IAM role.)

> Security note: the live `backend/.env` in this repo contains real credentials. When replicating, supply your own and keep them out of source control.

## 3. Upload operations

All uploads use **`put_object`** (or `upload_fileobj` for the streamed case). No multipart, no presigned uploads. [⚠️ EVENTS APP: Mirror this pattern AS-IS — public bucket, server-side put_object, public URLs. (An earlier private/presigned plan was dropped in build-plan v6.)]

### 3.1 Base64 image → S3 — `s3Images.uploadBase64ImageToS3(base64_string)`
- Decodes base64 → bytes (`base64.b64decode`). On decode error, returns the original string unchanged.
- Key: `f'{uuid.uuid4()}.jpg'` (flat, bucket root).
- `s3.put_object(Bucket=bucket_name, Key=object_key, Body=image_data, ContentType='image/jpg')`.
- Returns the public URL (see §5). On `NoCredentialsError`, returns the original base64 string.

### 3.2 Remote URL → S3 (re-hosting) — `s3Images.uploadURLtoS3(url)`
- `requests.get(url, stream=True)`; bails (returns original url) on non-200.
- Preserves source `Content-Type` header (default `image/jpeg`); wraps body in `io.BytesIO`.
- Key: `f'{uuid.uuid4()}.jpg'`.
- `s3.upload_fileobj(img_data, Bucket=bucket_name, Key=object_key, ExtraArgs={"ContentType": content_type})`.
- Note: this function always uses `boto3.client('s3')` (ambient/IAM creds) regardless of `PURPOSE`.
- Returns the new public URL; returns original url on any failure.

### 3.3 Base64 PDF → S3 (raw PDF) — `s3pdfMenu.uploadBase64PDFToS3(base64_string)`
- Validates via `validatePDFFile` (checks magic bytes `b'%PDF'`).
- Key: `f'menus/{uuid.uuid4()}.pdf'`.
- `put_object(..., ContentType='application/pdf', ContentDisposition='inline')` so browsers render rather than download.
- Returns public URL, else `None`.

### 3.4 Base64 PDF → per-page PNG images → S3 — `s3pdfMenu.uploadBase64PDFToImageS3(base64_string)`
- Validates PDF, opens with PyMuPDF (`fitz.open(stream=..., filetype="pdf")`).
- Renders each page at `fitz.Matrix(3.0, 3.0)` (~216 DPI) → PNG bytes (`pix.tobytes("png")`).
- One shared `base_uuid` per document; key per page: `f'menus/{base_uuid}/page_{page_num+1:03d}.png'` (e.g. `menus/<uuid>/page_001.png`).
- `put_object(..., ContentType='image/png')` per page.
- Returns a **JSON string** (`json.dumps`) of the list of page URLs; `None` on failure.

## 4. Read / delete operations

- **No download/read-from-S3 code path exists.** Files are served directly to clients via their public URLs (object reads happen over plain HTTPS GET by the browser, not by the backend).
- **Existence check before delete:** `head_object` is used in the PDF/menu deletes (`s3pdfMenu`) to detect 404s; image delete (`s3Images`) calls `delete_object` directly.
- **Delete functions:**
  - `s3Images.deleteImageFromS3(url)`
  - `s3pdfMenu.deleteMenuImagesFromS3(menu_urls_json)` (iterates a JSON list)
  - `s3pdfMenu.deletePDFFromS3(url)`
- **Key extraction on delete:** the object key is recovered by string-stripping the known URL prefix:
  ```python
  if 'https://tf-drinkx-prod-fe-images.s3.ap-southeast-1.amazonaws.com/' in url:
      object_key = url.replace('https://tf-drinkx-prod-fe-images.s3.ap-southeast-1.amazonaws.com/', '')
  elif 'https://drinkximages.s3.us-east-1.amazonaws.com/' in url:
      object_key = url.replace('https://drinkximages.s3.us-east-1.amazonaws.com/', '')
  else:
      # Non-S3 URL (e.g. external/Shopify CDN) -> skip deletion
  ```
- **Cross-environment delete guard** (`s3Images.deleteImageFromS3`): the URL identifies which bucket/region/env the image belongs to; dev refuses to delete prod images and prod refuses to delete dev images (logged and skipped). Delete targets the bucket/region parsed from the URL, not the ambient `bucket_name`.

## 5. Public URL construction

URLs are **virtual-hosted–style S3 object URLs**, built by string interpolation immediately after upload:

```python
url = f"https://{bucket_name}.s3.{region}.amazonaws.com/{object_key}"
```

Resolved forms:

- **Deployed (production):** `https://tf-drinkx-prod-fe-images.s3.ap-southeast-1.amazonaws.com/<key>`
- **Local (development):** `https://drinkximages.s3.us-east-1.amazonaws.com/<key>`

This full URL is what gets stored in the database and returned to the frontend; the frontend uses it directly as an `<img>`/PDF src. Objects must therefore be publicly readable. [⚠️ EVENTS APP: Mirror this pattern AS-IS — public bucket, server-side put_object, public URLs. (An earlier private/presigned plan was dropped in build-plan v6.)]

## 6. Presigned URLs

- **Not used.** There is no `generate_presigned_url` / `generate_presigned_post` anywhere in the backend.
- The only mention is an aspirational comment in `backend/scripts/createListing.py:401` ("move the upload with s3 presigned URL…") — not implemented.

## 7. CloudFront

- **Not used for backend file storage or URL construction.** Stored-file URLs point straight at the S3 virtual-hosted endpoint (§5).
- CloudFront appears **only** in the frontend static-site deploy script `scripts/fe-deploy.sh` (`--cf-id` flag and `aws cloudfront create-invalidation --distribution-id ... --paths "/${DOMAIN}*"`), which invalidates the website distribution after a deploy. It is unrelated to user-uploaded image/PDF assets.

## 8. Replication checklist

1. Add `boto3`, `python-dotenv`, `requests`, `PyMuPDF` (`fitz`) to dependencies.
2. Create two S3 buckets (one per environment) with public read on objects; pick a region for each. [⚠️ EVENTS APP: Mirror this pattern AS-IS — public bucket, server-side put_object, public URLs. (An earlier private/presigned plan was dropped in build-plan v6.)]
3. Drive bucket/region/credential selection from a single `PURPOSE` env var (`production` → IAM-role creds; otherwise → `.env` access keys).
4. Upload via `put_object` (`upload_fileobj` for streamed remote fetches); generate keys with `uuid.uuid4()` (flat for images, `menus/...` prefix for PDFs/menu pages).
5. Set `ContentType` per asset; use `ContentDisposition='inline'` for inline-viewable PDFs.
6. Construct/store the public URL as `https://{bucket}.s3.{region}.amazonaws.com/{key}`.
7. For deletes, parse the key by stripping the known URL prefix; `head_object` first if you want 404-safety; guard against cross-environment deletion.
8. Skip presigned URLs and CloudFront unless you intend to add them — the original does neither for stored files.


# A6 — Authentication pattern 
## DrinkX — Authentication Architecture Reference

A factual description of how login/auth works in the existing DrinkX backend
(Flask + PostgreSQL) and its Next.js frontend, written so the pattern can be
replicated in a separate application. This documents the **current, non-deprecated**
implementation only. No improvements are suggested.

---

## 1. TL;DR of the model

- **Stateless, no server sessions, no auth tokens/JWT for login.** The backend
  issues no session cookie and no JWT on login. It returns the account `id` and
  `role`, and the **client** persists that identity locally.
- **"Session" lives entirely on the client** in `localStorage` + mirror cookies
  (`88B_accID`, `88B_accType`, `88B_accUsername`).
- **Password "hashing" is a custom 32-bit JS hash computed on the client**, sent
  to the backend, and stored/compared **as a plain string**. There is **no**
  password-hashing library (no bcrypt/argon2/scrypt/PBKDF2) and no per-user salt.
- **Backend routes are not protected.** There is no auth middleware, decorator,
  or token check on any data/mutation route. Authorization is effectively
  enforced only by the client (and SSR redirect guards in Next.js). ⚠️ EVENTS APP: Mirror this login UX for MVP, but the endpoints that approve / reject / capture / unpublish MUST verify the admin session server-side before acting — they trigger real Stripe captures. Everything else can stay unguarded like Drink-X.
- **JWT and Firebase libraries exist in the backend but are used only for push
  notifications**, not authentication (see §7).

---

## 2. Components & files

### Backend (Flask, Python)
| Concern | File |
|---|---|
| App bootstrap, CORS, DB pool, blueprint auto-registration | [app.py](../backend/app.py) |
| Login + password change/reset + account-deletion request | [scripts/authcheck.py](../backend/scripts/authcheck.py) |
| Account creation (user/producer/venue), invite tokens | [scripts/createAccount.py](../backend/scripts/createAccount.py) |
| Lookups used during login (email→username, canonical username) | [scripts/getData.py](../backend/scripts/getData.py) |
| Push notifications (JWT/Firebase — NOT auth) | [scripts/notifications.py](../backend/scripts/notifications.py) |
| Dependency list | [requirements.txt](../backend/requirements.txt) |

### Frontend (Next.js / React)
| Concern | File |
|---|---|
| Client auth service (hash, login, session storage, reset) | [core/services/auth.js](../frontend/core/services/auth.js) |
| Auth React context/provider | [hooks/useAuth.js](../frontend/hooks/useAuth.js) |
| API client + base-URL selection | [core/config/api.js](../frontend/core/config/api.js) |
| SSR cookie guards (per page) | e.g. [pages/login.js](../frontend/pages/login.js) |
| Social sign-in (Google/Apple via Capacitor) | [components/views/landingPages/Login/components/GoogleSignIn.js](../frontend/components/views/landingPages/Login/components/GoogleSignIn.js) |

---

## 3. Account model

Three independent account tables, each with its own credentials:
`users`, `producers`, `venues` [EVENTS APP: Only needs admin_users (one admin) + magic_links. No public account tables, no users/producers/venues.]. Each row holds:

- `username`
- `hashedPassword` — a **string** holding the client-computed hash (or a sentinel
  like `"googleSignIn"` for social accounts)
- `pin` — transient `"<6-digit-pin>,<timestamp>"` used during password reset
- `email`

Login resolves an identity by trying the three tables **in order**: `users` →
`producers` → `venues`. The first table containing the username decides the
returned `role` (`"user"` / `"producer"` / `"venue"`).

---

## 4. Password "hashing"

There is **no cryptographic hashing library**. A custom 32-bit string hash
(the classic Java/JS `hashCode`) is computed **on the client** and stored
verbatim (EVENTS APP: Accepted for MVP per my decision. Replace with bcrypt/argon2 + real server session in the post-MVP hardening pass.). The backend never hashes — it compares strings. 

**Client (login), in `auth.js`:**
```js
hashPassword: (id, password) => {
  const combinedString = id.toString() + password; // id = canonical username
  let hash = 0;
  for (let i = 0; i < combinedString.length; i++) {
    const char = combinedString.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0; // 32-bit signed int
  }
  return hash;
}
```

**Backend comparison, in `authcheck.py` (`/authcheck/authcheck`):**
```python
if str(user["hashedPassword"]) == str(password):  # plain string compare
    return {"code": 200, "id": ..., "role": "user"}
```

**Backend reset re-implements the same hash in Python** (`authcheck.py`,
`/resetPassword`, `/resetPasswordLogin`) using `username + password`:
```python
combinedString = username + password
hash = 0
for ch in combinedString:
    hash = (hash << 5) - hash + ord(ch)
    hash &= 0xFFFFFFFF
if hash & (1 << 31):
    hash -= 1 << 32          # convert to signed 32-bit
```

> Note: the seed differs by flow — login hashes with the **canonical username**,
> account creation/reset hash with the **username**. Replicate exactly per flow
> if matching existing data.

---

## 5. Login flow (end to end)

1. **Client** (`auth.js > login`):
   - If input contains `@`, resolve email→username via
     `GET /getData/getUsernameFromEmail/<email>`.
   - Resolve canonical username via `GET /getData/getCanonicalUsername/<username>`.
   - Compute `hashedPassword = hashPassword(canonicalUsername, password)`.
   - `POST /authcheck/authcheck` with `{ username, password: hashedPassword, canonicalUsername }`.
2. **Backend** (`authcheck.py > authcheck`): looks up username across
   `users`/`producers`/`venues`, string-compares the hash. Returns:
   - `200 { code, id, role, message }` on success (also rescinds any pending
     account-deletion request for users)
   - `401` wrong password, `400` no such account, `500` error
3. **Client** persists identity with `authService.setUser({ id, type: role, username })`,
   which writes both `localStorage` and cookies (§6). No token is returned or stored.

There is **no** server-side session record created at any point.

---

## 6. Where the "session" is stored (client-side)

`auth.js` defines three keys and writes them to **both** `localStorage`
(unbounded lifetime) and **cookies** (7-day TTL, `path=/`, `SameSite=Lax`,
no `HttpOnly`, no `Secure`):

```
88B_accID        -> account id
88B_accType      -> "user" | "producer" | "venue"
88B_accUsername  -> username
```

- `setUser` / `setAuth` — write all three to localStorage + cookies.
- `getUser` — reads from localStorage; **re-issues the cookies from localStorage
  if the cookies have expired** but localStorage still has the session (keeps
  SSR guards working after the 7-day cookie TTL lapses).
- `logout` — clears all three from localStorage and cookies.
- `isAuthenticated` — true iff `getUser()` is non-null.

Cookies are **client-set, readable by JS** (not `HttpOnly`); they exist so the
Next.js server can read identity during SSR.

---

## 7. Auth enforcement — where (and where not)

### Backend: no enforcement
- `app.py` registers every `scripts/*.py` blueprint automatically. There are
  only two `@app.before_request` hooks and **neither checks auth** — one assigns
  a request id for logging, the other loads `mail` into `g`.
- No `Authorization` header is ever read; no `login_required`/auth decorator
  exists; no token is verified. Any client can call any data/mutation endpoint
  directly. ⚠️ EVENTS APP: Do NOT leave the payment/admin mutation endpoints open. Add a server-side session check on those four money/listing endpoints, and restrict CORS for the admin routes. Public read endpoints can stay open.
- **CORS is fully open:** `CORS(app)` (all origins), and the global error
  handler also sets `Access-Control-Allow-Origin: *`.
- Endpoints take the acting account's `id`/`userType` as **parameters in the
  request body or URL** (e.g. `/authcheck/editPassword/<id>`), trusting the
  caller-supplied identity.

### Frontend: the only gatekeeping
- **SSR redirect guards** in `getServerSideProps` read the cookies directly from
  `req.headers.cookie` and redirect based on presence of `88B_accID` /
  `88B_accType` / `88B_accUsername`. Example (`pages/login.js`): if the auth
  cookies are present, redirect away from the login page to the user's profile.
  Protected pages use the inverse check. There is **no** central Next.js
  `middleware.*`; each page implements its own guard.
- **Client React context** (`hooks/useAuth.js`): `AuthProvider` hydrates from
  SSR `initialUser` or from `authService.getUser()` (localStorage), exposes
  `user`, `userId`, `userType`, `isAdmin`, `isModerator`, `specialStatus`,
  `login`, `logout`. Role flags (`isAdmin`, `modType`) come from a follow-up
  profile fetch, not from login.

---

## 8. Account creation

`POST /createAccount/createAccount` (and `/createProducerAccount`,
`/createVenueAccount`) insert a row including a client-supplied `hashedPassword`
field — the backend stores it as-is. No verification, no email confirmation gate
on the insert itself.

Business onboarding uses single-use **invite tokens** (`tokens` table) created
via `POST /createAccount/createToken` using `secrets.token_urlsafe(16)` with an
`expiry`. These are invitation/setup tokens for the partner onboarding flow —
**not** login/session tokens.

---

## 9. Password reset & change (authcheck blueprint)

- `POST /authcheck/editPassword/<id>` — body `{ oldHash, newHash, userType }`;
  verifies `oldHash` string-equals stored value, then writes `newHash`.
- `POST /authcheck/sendResetPin/<id>` — generates 6-digit PIN, stores
  `"<pin>,<timestamp>"` in `pin`, emails it (delivery path is env-dependent, §11).
- `POST /authcheck/verifyPin/<id>` — checks PIN matches and is ≤ 2 hours old.
- `POST /authcheck/resetPassword/<id>` — on valid PIN, generates a random
  password, hashes it server-side (§4), stores it, clears `pin`, emails the new
  password.
- `POST /authcheck/resetPasswordLogin` — body `{ id, username, password, userType }`;
  hashes server-side and stores, clears `pin`.
- `POST /authcheck/requestAccountDeletion` — records a deletion request
  (`accountDeletionRequests`) for `userType == "user"` only.

---

## 10. Social sign-in (Google / Apple)

Handled **client-side** via Capacitor (`@capgo/capacitor-social-login`) [EVENTS APP: No public user accounts at all. Omit social sign-in. Submitter editing is magic-link only.]; see
`GoogleSignIn.js`. Flow:
1. Native SDK returns the social profile (email, name, picture).
2. Client checks `GET /getData/getUserByUsername/<email>`.
3. If new, client calls `POST /createAccount/createAccount` with
   `username = email` and the sentinel `hashedPassword: 'googleSignIn'`.
4. Client then sets the local session (§6) like any other login.

The backend does **not** verify Google/Apple ID tokens. `getData.py` surfaces
`authMethod: "googleSignIn"` purely by detecting the sentinel stored in
`hashedPassword`. (An Apple equivalent is stubbed/commented, not active.)

---

## 11. Environment-dependent behavior

The backend branches on the `PURPOSE` env var (`development` vs `production`).
This affects **email delivery for the reset flow**, not the auth logic itself.

### `PURPOSE=development` (local)
- Reset emails are sent via direct **SMTP** (`smtplib`) using
  `MAIL_SERVER` / `MAIL_PORT` / `MAIL_USE_TLS` / `MAIL_USERNAME` / `MAIL_PASSWORD`.
- `FLASK_DEBUG` typically off; app runs via `python app.py` on `HOST`/`PORT`
  (default `0.0.0.0:5000`).

### `PURPOSE=production` (deployed)
- Reset emails are sent via **AWS SES** (`send_email_aws` in `scripts/mail.py`),
  using `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`.
- Served behind gunicorn (gevent worker; `monkey.patch_all()` at top of `app.py`).

### Database (both)
PostgreSQL via a custom `psycopg2` `ThreadedConnectionPool` (`DatabaseManager`
in `app.py`), `minconn=5 / maxconn=80`, TCP keepalives tuned for AWS
Aurora/NAT idle timeouts. Config from `POSTGRES_HOST/PORT/DB/USER/PASSWORD`.
No ORM; each `db_manager.get_cursor()` is its own auto-commit transaction.

### Frontend API base URL (`core/config/api.js`)
Selected by execution context and env:
- **Server-side (SSR):** `API_INTERNAL_URL` → `NEXT_PUBLIC_API_URL` →
  `http://backend:5000` (the docker-compose service name — for the deployed/
  containerized setup).
- **Client-side (browser):** `NEXT_PUBLIC_API_URL` → `http://localhost:5000`
  (local default).
- For a deployed site, `NEXT_PUBLIC_API_URL` is set to the public API origin and
  `API_INTERNAL_URL` to the internal/container address.

---

## 12. Push-notification credentials (NOT authentication)

`requirements.txt` includes `PyJWT[crypto]` and `firebase-admin`; these are used
**only** in `scripts/notifications.py`:
- **Apple APNs:** builds an `ES256` JWT from a `.p8` key
  (`APNS_KEY_PATH`, `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_USE_SANDBOX`).
- **Android FCM:** `firebase_admin` with default app credentials.

These authenticate the server **to Apple/Google for sending pushes**. They are
unrelated to user login and play no role in the auth model above.

---

## 13. Minimal contract to replicate the existing pattern

If reusing this exact model:
1. Three credential tables (or one), each storing `username`, a `hashedPassword`
   **string**, `email`, `pin`.
2. A single `POST /authcheck` endpoint that string-compares a client-sent hash
   and returns `{ id, role }` — no token, no session.
3. Client computes the 32-bit hash (§4) and stores `{id, type, username}` in
   localStorage + 3 non-HttpOnly cookies (§6).
4. Per-page SSR guards reading those cookies for redirects; client context for
   role flags.
5. `PURPOSE`-gated email delivery (SMTP locally, SES in prod) for the PIN-based
   reset flow.
6. Open CORS; identity passed as request parameters; no backend route guards.



# A7 — Email 
## Email — Architecture Reference Spec

Reference for replicating the DrinkX backend's email behavior in a new app. Describes the system *as built* (no improvements suggested). Backend is **Python / Flask**.

## 1. Does it send email?

Yes. Email is sent via **two distinct transports selected at runtime by the `PURPOSE` environment variable**:

| `PURPOSE` value | Transport | Library |
| --- | --- | --- |
| `development` (local site) | Raw SMTP | Python stdlib `smtplib` |
| `production` (deployed site) | AWS SES (v2 API) | `boto3` (`sesv2` client) |

There is no provider abstraction that auto-detects; every send site contains an explicit `if PURPOSE == 'development'` / `if PURPOSE == 'production'` branch.

## 2. Libraries & versions

From `backend/requirements.txt`:

- `Flask-Mail==0.10.0`
- `boto3==1.34.145` (+ `botocore`)
- `smtplib`, `email.mime.*` — Python standard library (no install)

## 3. Configuration

### 3.1 Flask-Mail init — `backend/app.py` (lines ~450–469)

```python
app.config["MAIL_SERVER"]   = os.getenv("MAIL_SERVER")
app.config["MAIL_PORT"]     = os.getenv("MAIL_PORT", 587)
app.config["MAIL_USE_TLS"]  = True
app.config["MAIL_USE_SSL"]  = False
app.config["MAIL_USERNAME"] = os.getenv("MAIL_USERNAME")
app.config["MAIL_PASSWORD"] = os.getenv("MAIL_PASSWORD")
app.config["MAIL_DEFAULT_SENDER"] = "Drink-X <noreply@drink-x.com>"

mail = Mail(app)

@app.before_request
def before_request():
    g.mail = mail   # Flask-Mail instance exposed on flask.g
```

> Note: `Mail(app)` is initialized and exposed on `g.mail`, but the only function that consumes it (`send_email`, below) is **defined but not called anywhere**. All live email goes through `smtplib` (dev) or SES (prod). Included here for completeness because the wiring exists.

### 3.2 Environment variables

Declared in `backend/.env.example`:

```
MAIL_SERVER=
MAIL_PORT=
MAIL_USE_TLS=true
MAIL_USERNAME=
MAIL_PASSWORD=
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
```

Additional vars read by the code but **not** present in `.env.example` (must still be set):

- `PURPOSE` — `development` or `production`; the master switch for transport selection.
- `AWS_REGION` — defaults to `ap-southeast-1` if unset (`backend/scripts/mail.py`).
- `AWS_SESSION_TOKEN` — optional; passed to the boto3 session if set.

| Variable | Used by | (a) Deployed site (`production`) | (b) Local site (`development`) |
| --- | --- | --- | --- |
| `PURPOSE` | all send sites | `production` | `development` |
| `MAIL_SERVER` | smtplib (dev), Flask-Mail | unused for sending | required (SMTP host) |
| `MAIL_PORT` | smtplib (dev), Flask-Mail | unused for sending | required (default 587) |
| `MAIL_USE_TLS` | smtplib (dev) | unused for sending | `true` → STARTTLS; else SMTP_SSL |
| `MAIL_USERNAME` | smtplib login (dev) | unused for sending | required (SMTP user / from addr) |
| `MAIL_PASSWORD` | smtplib login (dev) | unused for sending | required (SMTP password) |
| `AWS_REGION` | SES (prod) | used (default `ap-southeast-1`) | unused |
| `AWS_ACCESS_KEY_ID` | SES (prod) | required | unused |
| `AWS_SECRET_ACCESS_KEY` | SES (prod) | required | unused |
| `AWS_SESSION_TOKEN` | SES (prod) | optional | unused |

## 4. Send helpers — `backend/scripts/mail.py`

Two functions (one per transport). Sender address is hardcoded `Drink-X <noreply@drink-x.com>` in both.

### `send_email(subject, recipient, body)` — Flask-Mail / SMTP
- Uses `g.mail` + `flask_mail.Message`, plain-text body.
- **Defined but currently unused** (see §3.1).

### `send_email_aws(region_name=None, profile_name=None, subject=None, recipient=None, body=None)` — AWS SES
- This is the **production** sender.
- Reads AWS creds/region from env at import time.
- Builds a raw MIME message: `MIMEMultipart('mixed')` → `MIMEMultipart('alternative')` → `MIMEText(..., 'plain', 'utf-8')`.
- Sends via `boto3.client('sesv2').send_email(...)` using the **`Raw` content** form:
  ```python
  client.send_email(
      FromEmailAddress=SENDER,
      Destination={'ToAddresses': [RECIPIENT]},
      Content={'Raw': {'Data': body}},
  )
  ```
- Errors: catches `botocore.exceptions.ClientError`, logs, and re-raises.

## 5. Where email is sent (call sites)

| Endpoint | File | Purpose / body |
| --- | --- | --- |
| `POST /sendResetPin/<id>` | `scripts/authcheck.py` (~323) | Sends a 6-digit reset PIN (valid 1 hour). |
| `POST` (forgot/reset flow, ~520–623) | `scripts/authcheck.py` | Sends a newly generated password. |
| `POST /sendEmail` | `scripts/createAccount.py` (~1023) | Generic send: takes `subject`, `recipient`, `message` from JSON body. |

### Dev vs. prod branching pattern (representative — `sendResetPin`)

```python
PURPOSE = os.getenv('PURPOSE')

# development: build SMTP server from MAIL_* env and send directly
if PURPOSE == 'development':
    mail_server = os.getenv('MAIL_SERVER')
    mail_port   = int(os.getenv('MAIL_PORT', 587))
    mail_use_tls = os.getenv('MAIL_USE_TLS', 'false').lower() == 'true'
    if mail_use_tls:
        server = smtplib.SMTP(mail_server, mail_port); server.ehlo(); server.starttls()
    else:
        server = smtplib.SMTP_SSL(mail_server, mail_port)
    server.login(email_address, password)   # email_address=MAIL_USERNAME, password=MAIL_PASSWORD
    ...
    server.sendmail(email_address, userRaw["email"], message)
    server.quit()

# production: hand off to AWS SES
if PURPOSE == 'production':
    send_email_aws(subject="Drink-X Reset Password",
                   recipient=userRaw["email"], body=message)
```

The generic `/sendEmail` endpoint **short-circuits in development** (no mail sent):

```python
if os.getenv("PURPOSE") == "development":
    return jsonify({'message': 'Local dev skip Email successfully!'}), 200
send_email_aws(subject=data['subject'], recipient=data['recipient'], body=data['message'])
```

## 6. Templates

**No template engine or template files for email.** All message bodies are **inline Python f-strings / `.format()` plain text**, assembled at the call site. Raw SMTP messages prepend `Subject: ...\n\n`; SES messages set the subject via the MIME `Subject` header. Content type is always `text/plain; charset=utf-8` — no HTML emails.

## 7. Replication checklist

1. Install `Flask-Mail`, `boto3` (versions in §2).
2. Define a `PURPOSE` env var as the transport switch.
3. Local: configure `MAIL_SERVER`, `MAIL_PORT`, `MAIL_USE_TLS`, `MAIL_USERNAME`, `MAIL_PASSWORD`; send via `smtplib` (STARTTLS when `MAIL_USE_TLS=true`, else SSL).
4. Deployed: configure `AWS_REGION` (default `ap-southeast-1`), `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, optional `AWS_SESSION_TOKEN`; send via boto3 `sesv2` raw MIME.
5. Hardcoded sender: `Drink-X <noreply@drink-x.com>` (must be a verified SES identity in production). EVENTS APP: Use a sender on 88bamboo.co [EVENTS APP: Verify the domain 88bamboo.co in SES; sender is events@88bamboo.co. (drink-x.com's identity does not cover 88bamboo.co. SES is already out of sandbox — no approval wait.)]. drink-x.com's identity does NOT cover 88bamboo.co — verify the new domain in SES. NOTE: SES is already out of the sandbox on this account, so no approval wait.
6. Keep message bodies as inline plain-text strings; no template system.


# A8 — Dependencies 

## Backend Dependency Baseline — Reference Spec

Source of truth: `backend/` (top-level). The `the-green-bamboo/backend/` copy is older — ignore it.
Backend stack: **Flask (Python) + PostgreSQL**, served by **Gunicorn (gevent)**, containerized with Docker.

---

## 1. Python Version

**Python 3.11** — pinned via the Docker base image, not a `runtime.txt`/`.python-version` file.

```dockerfile
FROM python:3.11-slim AS builder   # build stage
FROM python:3.11-slim AS runner    # runtime stage
```

There is **no** `Pipfile`, `pyproject.toml`, or `poetry.lock`. Dependencies are managed by a single `requirements.txt` installed with `pip`.

System packages required at build/runtime (from `Dockerfile.backend`):
- Build stage: `build-essential` (compiles `psycopg2`, `PyMuPDF`, etc.)
- Runtime stage: `ca-certificates`, `libpq-dev`, `curl`, `wget`

---

## 2. `requirements.txt` (verbatim — full file)

```text
Flask==3.0.2
Flask-Mail==0.10.0
Flask-PyMongo==2.3.0
Flask-Cors==4.0.0
gunicorn[gevent]==21.2.0
pymongo==4.6.3
python-dotenv==1.0.0
requests==2.31.0
pytz==2023.4
stripe>=5.0.0
boto3==1.34.145
psycopg2-binary==2.9.11
psycogreen==1.0.2
pycparser==2.21
chardet==5.2.0
feedparser==6.0.11
beautifulsoup4==4.12.3
PyMuPDF==1.24.5
forex-python==1.8
redis
fuzzywuzzy==0.18.0
pandas==2.3.3
APScheduler==3.10.4
PyJWT[crypto]==2.10.1
httpx[http2]==0.28.1
firebase-admin==7.2.0
```

---

## 3. Recommended Baseline (deprecated / unused removed)

> You asked to exclude deprecated items. These are **listed in `requirements.txt` but should NOT seed the new app**:
>
> - **`Flask-PyMongo==2.3.0`** and **`pymongo==4.6.3`** — **legacy MongoDB layer.** The app has migrated to PostgreSQL; the Mongo URI is commented out in `app.py` (`# app.config["MONGO_URI"]`). Mongo is only still touched by one-off migration scripts in `backend/data.py` and `backend/other/*.py`. Do not carry into a new PostgreSQL-based app.
> - **`redis`** — **unpinned and unused.** No `import redis` anywhere in the codebase. Drop it (or pin a version only if you actually add caching).
> - **`pycparser==2.21`** — transitive dependency (pulled in via `cffi`/crypto); does not need to be a direct pin.

### Active dependency baseline (grouped by purpose)

| Package | Pin | Purpose in backend |
|---|---|---|
| `Flask` | `==3.0.2` | Web framework / routing |
| `Flask-Cors` | `==4.0.0` | CORS for the Next.js frontend |
| `Flask-Mail` | `==0.10.0` | Transactional email (SMTP) |
| `gunicorn[gevent]` | `==21.2.0` | Production WSGI server (gevent worker) |
| `psycogreen` | `==1.0.2` | Makes `psycopg2` cooperate with gevent (green threads) |
| `psycopg2-binary` | `==2.9.11` | PostgreSQL driver (primary database) |
| `python-dotenv` | `==1.0.0` | Loads `.env` (`load_dotenv()` in `app.py`) |
| `PyJWT[crypto]` | `==2.10.1` | Auth tokens (JWT) |
| `requests` | `==2.31.0` | Outbound HTTP |
| `httpx[http2]` | `==0.28.1` | Async/HTTP2 client (used by APNs push path) |
| `stripe` | `>=5.0.0` | Payments / subscriptions |
| `boto3` | `==1.34.145` | AWS S3 (image + PDF-menu uploads) |
| `firebase-admin` | `==7.2.0` | Firebase Cloud Messaging (Android push) |
| `APScheduler` | `==3.10.4` | In-process scheduled jobs |
| `pytz` | `==2023.4` | Timezone handling |
| `pandas` | `==2.3.3` | Data/bulk processing in scripts |
| `chardet` | `==5.2.0` | Charset detection (imports/feeds) |
| `feedparser` | `==6.0.11` | RSS/feed parsing |
| `beautifulsoup4` | `==4.12.3` | HTML scraping/parsing |
| `PyMuPDF` | `==1.24.5` | PDF parsing (menu ingestion) |
| `forex-python` | `==1.8` | Currency conversion |
| `fuzzywuzzy` | `==0.18.0` | Fuzzy string matching |

> Note: `stripe>=5.0.0` is the only unbounded version range — every other active package is hard-pinned. Resolve `stripe` to a concrete version when you lock the new baseline.

---

## 4. Runtime entrypoint (deployed vs local)

The same `app.py` runs both ways; the launcher differs.

**(a) Deployed** — Gunicorn with gevent (from `Dockerfile.backend` `CMD`):
```bash
gunicorn --bind 0.0.0.0:5000 \
  --access-logfile - --error-logfile - --log-level info \
  --workers 1 --worker-class gevent --worker-connections 60 \
  app:app
```
Requires `psycogreen` (gevent monkeypatch) so `psycopg2` doesn't block the event loop.

**(b) Local** — Flask dev server via the `__main__` block in `app.py`:
```python
HOST = os.getenv("HOST", "0.0.0.0")
PORT = int(os.getenv("PORT", 5000))
FLASK_DEBUG = bool(os.getenv("FLASK_DEBUG", False))
app.run(host=HOST, port=PORT, debug=FLASK_DEBUG)
```
Or via `docker-compose.yml` (service `backend`, port mapped `127.0.0.1:5000:5000`).

---

## 5. Environment configuration — deployed vs local

`app.py` calls `load_dotenv()` and reads everything from env vars. Canonical key list is `backend/.env.example`; the live `backend/.env` adds push-notification + extra mail keys. **Never commit real secrets to the new app.**

### Keys read by the backend

| Env var | Used for | Local value | Deployed value |
|---|---|---|---|
| `FLASK_DEBUG` | Flask debug mode | `True` (dev) | `False` |
| `HOST` / `PORT` | bind address | `0.0.0.0` / `5000` | `0.0.0.0` / `5000` (ARG in Dockerfile) |
| `POSTGRES_USER` | DB user | local creds | managed-DB creds |
| `POSTGRES_PASSWORD` | DB password | local creds | managed-DB creds |
| `POSTGRES_HOST` | DB host | `db` (compose service name) | RDS/managed Postgres hostname |
| `POSTGRES_PORT` | DB port | `5432` | `5432` |
| `POSTGRES_DB` | DB name | local db | prod db |
| `MAIL_SERVER` | SMTP host | dev SMTP / sandbox | prod SMTP |
| `MAIL_PORT` | SMTP port (default `587`) | `587` | `587` |
| `MAIL_USE_TLS` | SMTP TLS | `true` | `true` |
| `MAIL_USE_SSL` | SMTP SSL | `False` (hardcoded in `app.py`) | `False` |
| `MAIL_USERNAME` / `MAIL_PASSWORD` | SMTP auth | dev creds | prod creds |
| `MAIL_DEFAULT_SENDER` | from-address | `Drink-X <noreply@drink-x.com>` (hardcoded) | same |
| `STRIPE_SECRET_KEY` | Stripe API | **test** key (`sk_test_…`) | **live** key (`sk_live_…`) |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | S3 (boto3) | dev/sandbox bucket creds | prod bucket creds |
| `APNS_KEY_PATH` | Apple push `.p8` key path | path to local `.p8` | path to mounted `.p8` |
| `APNS_KEY_ID` / `APNS_TEAM_ID` | Apple push identity | Apple dev creds | Apple prod creds |
| `APNS_USE_SANDBOX` | Apple push host switch | `true` → `api.sandbox.push.apple.com` | `false` → `api.push.apple.com` |
| `GOOGLE_APPLICATION_CREDENTIALS` | Firebase FCM service-account JSON path | path to `serviceAccountKey.json` | path to mounted prod JSON |

### Credential files referenced (must be supplied per-environment, never reuse prod in dev)
- `serviceAccountKey.json` — Firebase service account (FCM)
- `AuthKey_*.p8` — Apple APNs signing key
- AWS keys → S3 (`s3Images.py`, `s3pdfMenu.py`)

### Local infra via `docker-compose.yml`
- `db`: `postgres:15-alpine`, auto-runs SQL in `database/postgresql/final/` on first boot, port `127.0.0.1:5432:5432`.
- `backend`: built from `backend/Dockerfile.backend`, `env_file: backend/.env`, port `127.0.0.1:5000:5000`, health check `GET /health`.
- Frontend (for reference) talks to backend at `http://localhost:5000` (browser) / `http://backend:5000` (internal).

### Deployment notes (from Dockerfile / config files present)
- Two-stage Docker build (deps compiled in builder, copied to slim runner).
- `.env` is **copied into the image** (`COPY .env .env`) — for the new app, prefer injecting env at runtime instead.
- AWS-oriented: health check endpoint for ECS/ALB; `supervisord.conf`, `logging-cloudwatch.conf`, and `CLOUDWATCH_SETUP_GUIDE.md` indicate CloudWatch logging on the deployed side. `logging.conf` is the plain/local logging variant.

---

## 6. Minimal `requirements.txt` to start the new app

```text
# --- Web / server ---
Flask==3.0.2
Flask-Cors==4.0.0
Flask-Mail==0.10.0
gunicorn[gevent]==21.2.0

# --- PostgreSQL (with gevent) ---
psycopg2-binary==2.9.11
psycogreen==1.0.2

# --- Config / auth ---
python-dotenv==1.0.0
PyJWT[crypto]==2.10.1

# --- Integrations ---
stripe>=5.0.0
boto3==1.34.145
firebase-admin==7.2.0
requests==2.31.0
httpx[http2]==0.28.1

# --- Jobs / utils ---
APScheduler==3.10.4
pytz==2023.4
pandas==2.3.3
chardet==5.2.0
feedparser==6.0.11
beautifulsoup4==4.12.3
PyMuPDF==1.24.5
forex-python==1.8
fuzzywuzzy==0.18.0
```

Dropped vs original: `Flask-PyMongo`, `pymongo` (legacy MongoDB), `redis` (unused, unpinned), `pycparser` (transitive). Add them back only if you intentionally reintroduce Mongo/Redis.


# B1 — Build setup 

## DrinkX Frontend — Architecture Reference Spec

Scope: the **active** frontend at `frontend/` only. The Vue app under
`the-green-bamboo/frontend/` is deprecated and excluded.

This is a factual reference for replicating the stack in a new, separate app.
No recommendations or changes are implied.

---

## 1. Framework & Language

- **Framework:** Next.js — `next` `^16.0.7` (Next.js **16**, Pages Router).
  - Uses the **Pages Router** (`pages/` directory), not the App Router.
    Confirmed by `pages/` dir and `README.md` referencing `pages/index.js` and
    `pages/api/*`.
  - `reactStrictMode: true` (`next.config.mjs`).
- **UI library:** React `19.2.0` + React DOM `19.2.0` (pinned, exact versions).
- **Language:** JavaScript (no TypeScript). Path alias `@/* → ./*` declared in
  `jsconfig.json`.
- Source: `frontend/package.json`, `frontend/jsconfig.json`,
  `frontend/next.config.mjs`.

## 2. Build Tool

- **Bundler:** **Webpack**, explicitly forced via the `--webpack` flag on both
  `dev` and `build` scripts (Next 16 defaults to Turbopack; this project opts
  back into Webpack). Source: `package.json` scripts.
- **CSS pipeline:** PostCSS + Tailwind CSS + Autoprefixer.
  - `tailwindcss` `^3.4.19` (Tailwind **v3**), config `tailwind.config.mjs`.
  - `postcss.config.js`, `autoprefixer` `^10.4.27`.
  - Bootstrap 5 (`bootstrap` `^5.3.8`) and `bootstrap-icons` are also dependencies
    (used alongside Tailwind).

## 3. Node Version

- **Not pinned in-repo for local dev** — there is no `engines` field in
  `package.json`, and no `.nvmrc` / `.node-version` file.
- **Pinned only in Docker:** `Dockerfile.frontend` uses `node:20-alpine` for the
  `dev`, `builder`, and `runner` stages. So the de-facto target is **Node 20**.

## 4. NPM Scripts (`package.json`)

| Script  | Command                  | Purpose |
|---------|--------------------------|---------|
| `dev`   | `next dev --webpack`     | Local dev server (default port 3000). |
| `build` | `next build --webpack`   | Production build. |
| `start` | `next start`             | Serve the production build (SSR server). |

- **No mobile/native build script exists in `package.json`.** Capacitor native
  builds are driven manually via the Capacitor CLI (`@capacitor/cli` `^8.1.0` is
  a devDependency) and the native IDE toolchains (Xcode / Gradle), not npm
  scripts. There are no `cap sync` / `build:mobile` / `export` scripts.

## 5. Where Built Files Go

- **Web (the real production output):** `next build` produces the standard
  **`.next/`** directory. The app is served as a **running Next.js server**
  (`next start`) — see `Dockerfile.frontend` `runner` stage
  (`CMD ["npm", "run", "start", ...]`). This is an SSR/server deployment, **not** a
  static export.
- **`next.config.mjs` does NOT set `output: 'export'`** (nor `output: 'standalone'`).
  So `next build` alone does not generate the `out/` directory.
- **`out/` directory:** present in the repo but contains only a placeholder
  `index.html`. It is referenced as Capacitor's `webDir` (see §6) but is **not**
  populated by the standard build pipeline and is **not** the live web artifact.

## 6. Mobile / Native (Capacitor)

- **Capacitor v8** (`@capacitor/core` `^8.0.2`, plus `@capacitor/ios`,
  `@capacitor/android`). Native projects are committed: `frontend/ios/` and
  `frontend/android/`.
- Config: `frontend/capacitor.config.json`
  - `appId`: `com.88bamboo.drinkx`, `appName`: `Drink-X`.
  - `webDir`: `out`.
  - **`server.url`: `https://www.drink-x.com`** — the native shell loads the
    **remote production website** at runtime rather than serving bundled local
    assets. (This is why `webDir`/`out` is effectively a placeholder.)
    `cleartext: false`.
- Native plugins configured: `PushNotifications` (badge/sound/alert),
  `SplashScreen` (2500ms, no auto-hide, white bg), `SystemBars` (CSS insets,
  LIGHT), `SocialLogin` (Google + Apple enabled; Facebook/Twitter disabled).
- Other Capacitor plugins in deps: `@capacitor/app`, `@capacitor/camera`,
  `@capacitor/splash-screen`, `@capacitor/push-notifications`,
  `@capgo/capacitor-social-login` `^8.3.9`.

## 7. Environment Config — Deployed (a) vs Local (b)

Env files present: `.env`, `.env.development`, `.env.production`, `.env.example`.
All runtime-variable client config is exposed via `NEXT_PUBLIC_*` vars (inlined at
build time by Next.js). `API_INTERNAL_URL` is server-only.

### API base URL resolution — `core/config/api.js`

The single most important env-dependent behavior. `apiClient` chooses its base URL
by execution context:

```
isServer (SSR / Node):  API_INTERNAL_URL  ||  NEXT_PUBLIC_API_URL  ||  'http://backend:5000'
isClient (browser):     NEXT_PUBLIC_API_URL  ||  'http://localhost:5000'
```

- **(b) Local:** `NEXT_PUBLIC_API_URL=http://localhost:5000` (browser) and
  `API_INTERNAL_URL=http://backend:5000` (server, Docker service name).
  `NEXT_PUBLIC_BASE_URL=http://localhost:3000`.
- **(a) Deployed:** `NEXT_PUBLIC_API_URL=https://api.drink-x.com`,
  `NEXT_PUBLIC_BASE_URL=https://drink-x.com`. (`.env.production` notes these are
  the deployed values and must be commented out before a local launch.)

> Note: `.env.development` carries developer-machine values (e.g. a LAN IP
> `http://172.20.10.8:5001`) — illustrating that `NEXT_PUBLIC_API_URL` is
> environment-specific and must be set per target.

### Other env-driven values

| Var | Role | Deployed vs Local |
|-----|------|-------------------|
| `NEXT_PUBLIC_API_URL` | Backend API base (browser) | prod host vs localhost:5000 |
| `API_INTERNAL_URL` | Backend API base (SSR, internal network) | set in Docker; empty in prod env file |
| `NEXT_PUBLIC_BASE_URL` | App's own public URL | `https://drink-x.com` vs `http://localhost:3000` |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Stripe.js key | live key in `.env`; empty in `.env.example` |
| `NEXT_PUBLIC_STRIPE_MONTHLY_PRICE_ID` / `..._YEARLY_PRICE_ID` | Stripe price IDs | per-env |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | Google Maps JS | per-env |
| `NEXT_PUBLIC_GAUTH_API_KEY` | Google OAuth web client ID | per-env |
| `NEXT_PUBLIC_GOOGLE_IOS_CLIENT_ID` | Google OAuth iOS client ID | per-env |
| `NEXT_PUBLIC_APPLE_SERVICES_ID` | Apple Sign-In services ID (`com.88bamboo.drinkx.web`) | per-env |

### Host-canonicalization (env-independent, in `next.config.mjs`)

- A `redirects()` rule 308-redirects any request whose `Host` is the bare apex
  `drink-x.com` to `https://www.drink-x.com/...`. Production edge also does this;
  the rule keeps preview/proxy environments consistent. Only meaningful for the
  **deployed** site (no effect on localhost).

### Remote image allowlist (`next.config.mjs` → `images.remotePatterns`)

`next/image` only loads from an explicit allowlist of hosts, including:
`cdn.shopify.com`, `tf-drinkx-prod-fe-images.s3.ap-southeast-1.amazonaws.com`,
`drinkx-badges.s3.ap-southeast-1.amazonaws.com`, `lh3.googleusercontent.com`,
`88bamboo.co` / `http://88bamboo.co`, `images.unsplash.com`, `placehold.co`,
`m.media-amazon.com`, and a few others. Any new image host must be added here.

## 8. Project Layout (top-level under `frontend/`)

- `pages/` — routes + `pages/api/*` (Next Pages Router).
- `components/` — React components.
- `core/` — app logic: `core/config/api.js` (the fetch client above),
  `core/services/*` (≈40 per-domain API modules: `auth`, `users`, `listings`,
  `producers`, `venues`/`business`, `payment`, `stripe`, `menu`, `events`,
  `pushNotificationService`, `deepLinkingService`, etc.), `core/utils/`.
- `hooks/` — React hooks.
- `styles/` — global/Tailwind styles.
- `public/`, `assets/` — static assets.
- `ios/`, `android/` — committed Capacitor native projects.
- `Dockerfile.frontend` — multi-stage (dev / builder / runner) on `node:20-alpine`.

## 9. Notable Dependencies (for replication parity)

- Data/UI: `@headlessui/react`, `@phosphor-icons/react`, `lucide-react`,
  `bootstrap` + `bootstrap-icons`, `react-toastify`, `react-quill-new` (rich text),
  `@dnd-kit/*` (drag-and-drop), `chart.js` + `react-chartjs-2`,
  `qrcode` + `react-qr-code`, `dompurify`.
- Maps: `@googlemaps/js-api-loader`, `@react-google-maps/api`.
- Payments: `@stripe/stripe-js`.
- Auth utils: `jwt-decode`.

---

### Sources cited
`frontend/package.json`, `frontend/next.config.mjs`,
`frontend/capacitor.config.json`, `frontend/jsconfig.json`,
`frontend/Dockerfile.frontend`, `frontend/core/config/api.js`,
`frontend/.env.example`, `frontend/.env` / `.env.development` / `.env.production`.


# B2 — How the frontend talks to the backend 

## DrinkX Frontend → Backend API Reference Spec

Scope: the active Next.js app at `frontend/` only. (The deprecated Vue app under
`the-green-bamboo/frontend/` is ignored.) This document describes *how the frontend
talks to the backend* so the same wiring can be reproduced in a new app pointed at a
new backend. It is descriptive, not prescriptive — no improvements suggested.

---

## 1. Stack summary

- **Framework:** Next.js (Pages Router), React 19. Dev/build run with the Webpack
  compiler (`next dev --webpack` / `next build --webpack`).
- **HTTP mechanism:** **native `fetch`** only. No axios, no generated client, no
  React Query. A single hand-rolled wrapper object (`apiClient`) centralizes all
  calls. (Some service files reference `error.response?.data` in catch blocks — an
  axios-ism — but those branches are dead; `fetch` rejections don't carry `.response`.)
- **Packaging:** also wrapped as a native app via Capacitor (`@capacitor/*`), but the
  API-call mechanism is identical on web and native.

---

## 2. The single HTTP client — `core/config/api.js`

Every backend call goes through one module: [`core/config/api.js`](frontend/core/config/api.js).
It exports a plain object `apiClient` with `get / post / put / patch / delete`
methods, each a thin wrapper over `fetch`.

### 2.1 Base URL resolution (the key part)

```js
const isServer = typeof window === 'undefined';

const API_BASE_URL = isServer
  ? (process.env.API_INTERNAL_URL || process.env.NEXT_PUBLIC_API_URL || 'http://backend:5000')
  : (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000');
```

The base URL is **resolved once at module load**, and it differs by execution context:

| Context | Variable used (in order) | Fallback |
| --- | --- | --- |
| **Server-side** (SSR / `getServerSideProps` / Node) | `API_INTERNAL_URL` → `NEXT_PUBLIC_API_URL` | `http://backend:5000` |
| **Client-side** (browser / Capacitor webview) | `NEXT_PUBLIC_API_URL` | `http://localhost:5000` |

Why two variables:
- `NEXT_PUBLIC_*` vars are inlined into the browser bundle by Next.js, so the client
  can read them.
- `API_INTERNAL_URL` is **not** `NEXT_PUBLIC_`, so it stays server-only. It lets SSR
  reach the backend over an internal/container network (e.g. Docker service DNS
  `http://backend:5000`) instead of the public hostname.

There is **no `axios.create`, no interceptor, no central instance config** beyond this.
Endpoints are passed as path strings (e.g. `/getData/getUsers`); the wrapper prepends
`API_BASE_URL`.

### 2.2 Request behavior per method

- **Headers:** defaults to `Content-Type: application/json`; caller `config.headers`
  are merged in. For `POST`, if the body is a `FormData` instance, the JSON
  content-type is *omitted* (so the browser sets the multipart boundary).
- **Body:** `JSON.stringify(data)` for json; raw `data` for `FormData`.
- **Query params:** `get` accepts `config.params` (object) and builds a query string
  via `URLSearchParams`, skipping `null`/`undefined` values.
- **Return shape:**
  - `get` / `delete`: return `{ data }` (parsed JSON). `delete` throws on `!response.ok`;
    `get` does not.
  - `post` / `put` / `patch`: return `{ data, ok, status }` and **never throw** — network
    or parse errors resolve to `{ data: null, ok: false, status: 0, error }`.
- **No auth header / no cookies are sent by the client.** `fetch` is called *without*
  `credentials: 'include'` and without an `Authorization` header. See §4.

---

## 3. Service layer — `core/services/*.js`

Each domain has a service module (e.g. [`auth.js`](frontend/core/services/auth.js),
`listings.js`, `venues.js`, `producers.js`, `users.js`, `menu.js`, `stripe.js`, …).
Pattern is uniform:

```js
import { apiClient } from '../config/api';      // or '@/core/config/api'

export const listingsService = {
  async getCSVTemplate() {
    const response = await apiClient.get('/adminFunctions/readCSV');
    return response.data?.data || [];
  },
  // ...
};
```

Pages/components/hooks import these services (not `apiClient` directly). Backend route
prefixes seen in use: `/getData/*`, `/authcheck/*`, `/createAccount/*`,
`/createListing/*`, `/adminFunctions/*`, `/auth/*`, etc. — i.e. the frontend assumes a
flat REST-ish backend mounted at `API_BASE_URL`.

To point a new frontend at a new backend: **change only `NEXT_PUBLIC_API_URL` (and
`API_INTERNAL_URL` for SSR).** No code changes are needed as long as the new backend
exposes the same route paths.

---

## 4. Auth / session model (so you replicate it correctly)

Auth state is **not** carried on API requests via tokens or cookies-over-fetch.
[`core/services/auth.js`](frontend/core/services/auth.js):

- On login it `POST`s to `/authcheck/authcheck` and, on success, stores identity in
  **`localStorage`** under keys `88B_accID`, `88B_accType`, `88B_accUsername`, and
  **mirrors them into non-HttpOnly cookies** (`SameSite=Lax`, 7-day TTL) purely so
  SSR auth guards (which can only read cookies) can see the session.
- Passwords are hashed client-side with a simple custom hash before being sent.
- Identity for authorized actions is **passed in the request payload** (e.g. `submitterID`,
  `submitterType`), not in an auth header — see the comment in
  `core/services/collaborators.js`. So the `apiClient` deliberately sends no
  `Authorization` header and no `credentials`.

Replicate this only if the new backend expects the same scheme. If your new backend
uses bearer tokens/HttpOnly cookies, you'd add an `Authorization` header (or
`credentials: 'include'`) in `apiClient` — but that is a change, noted here only for
correctness of the description.

---

## 5. Environment configuration

Next.js auto-loads env files by NODE_ENV: `.env.development` during `next dev`,
`.env.production` during `next build` / `next start`, with `.env` always loaded (lower
priority). Only `NEXT_PUBLIC_*` vars reach the browser; everything else is server-only.

### Files present in `frontend/`

`.env` (always loaded — non-API public keys only; does **not** set the API URL):
```
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY = ...
NEXT_PUBLIC_GAUTH_API_KEY = ...
NEXT_PUBLIC_APPLE_SERVICES_ID = com.88bamboo.drinkx.web
NEXT_PUBLIC_GOOGLE_IOS_CLIENT_ID = ...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = pk_live_...
```

[`.env.development`](frontend/.env.development) — used by `npm run dev` (local site):
```
NEXT_PUBLIC_BASE_URL=http://localhost:8080
NEXT_PUBLIC_API_URL=http://172.20.10.8:5001   # backend on dev machine/LAN
API_INTERNAL_URL=http://backend:5000          # SSR → backend over container network
NEXT_PUBLIC_APPLE_SERVICES_ID=com.88bamboo.drinkx.web
```

[`.env.production`](frontend/.env.production) — used by `build`/`start` (deployed site):
```
NEXT_PUBLIC_API_URL=https://api.drink-x.com    # public backend host
NEXT_PUBLIC_BASE_URL=https://drink-x.com
API_INTERNAL_URL=                              # empty → SSR falls back to NEXT_PUBLIC_API_URL
NEXT_PUBLIC_APPLE_SERVICES_ID=com.88bamboo.drinkx.web
```

[`.env.example`](frontend/.env.example) — template:
```
NEXT_PUBLIC_BASE_URL=http://localhost:3000
NEXT_PUBLIC_API_URL=http://localhost:5000
API_INTERNAL_URL=http://backend:5000
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=
NEXT_PUBLIC_GAUTH_API_KEY=
NEXT_PUBLIC_GOOGLE_IOS_CLIENT_ID=
NEXT_PUBLIC_APPLE_SERVICES_ID=
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=
NEXT_PUBLIC_STRIPE_MONTHLY_PRICE_ID=
NEXT_PUBLIC_STRIPE_YEARLY_PRICE_ID=
```

### How the API base URL differs: deployed vs local

| | **(a) Deployed site** (`.env.production`) | **(b) Local site** (`.env.development`) |
| --- | --- | --- |
| Client fetch base (`NEXT_PUBLIC_API_URL`) | `https://api.drink-x.com` | `http://172.20.10.8:5001` |
| SSR fetch base (`API_INTERNAL_URL` → else `NEXT_PUBLIC_API_URL`) | `API_INTERNAL_URL` empty ⇒ uses `https://api.drink-x.com` | `http://backend:5000` |
| `NEXT_PUBLIC_BASE_URL` (frontend's own origin, not the API) | `https://drink-x.com` | `http://localhost:8080` |

So **`.env` directly controls the API target**, and it *does* differ between deployed
and local — both the public client URL and the SSR/internal URL change as shown above.
(`NEXT_PUBLIC_BASE_URL` is the app's own public origin used for SEO/links, not for API
calls; the actual API base is `NEXT_PUBLIC_API_URL` / `API_INTERNAL_URL`.)

---

## 6. Minimal recipe for a new app pointed at a new backend

1. Copy [`core/config/api.js`](frontend/core/config/api.js) verbatim — it is the whole
   integration layer (native `fetch`, base-URL resolution, return-shape conventions).
2. Set env per environment:
   - Local: `NEXT_PUBLIC_API_URL=<your dev backend>`, `API_INTERNAL_URL=<internal host
     or blank>` in `.env.development`.
   - Deployed: `NEXT_PUBLIC_API_URL=<your prod backend>`, `API_INTERNAL_URL=<internal or
     blank>` in `.env.production`.
3. Write per-domain service modules that import `apiClient` and call path strings.
4. If your new backend's auth differs from the payload-identity scheme in §4, that is
   the one place you must adapt (`apiClient` headers/credentials + `authService`).


# B3 — Routing and state
## DrinkX Frontend — Routing & State Reference Spec

Scope: the active Next.js app at `frontend/` only. (The deprecated Vue app under
`the-green-bamboo/frontend/` is intentionally excluded.) This document records
*what the app does* so the architecture can be replicated in a new app. It does
not propose changes.

## Stack baseline

| Concern | Choice |
|---|---|
| Framework | Next.js `^16` (`react` / `react-dom` `19.2.0`) EVENTS APP: Set next.config basePath: '/a/events' so assets/links resolve through the Shopify App Proxy (Drink-X runs at root, so it has none). KEEP the canonical-slug enforcement pattern in getServerSideProps — reuse it for event pages. |
| Router | **Pages Router** (`pages/` directory; no `app/` directory) |
| Language | JavaScript (`.js`, JSX) — no TypeScript |
| Path alias | `@/*` → project root (`jsconfig.json`) |
| Bundler | Webpack (scripts run `next dev --webpack` / `next build --webpack`) |
| Styling | Tailwind CSS 3 + Bootstrap 5 + Bootstrap Icons + custom `styles/globals.css` |
| Native shell | Capacitor 8 (iOS/Android) wraps the same web app |
| State libraries | **None** (no Redux/Zustand/Recoil/Jotai). State = React Context + custom hooks + a service layer |

---

## 1. Routing

### 1.1 Approach

File-system routing via the **Pages Router**. Every file under `pages/` is a
route; the file path *is* the URL. There is no central route table — route
definitions are implicit in the directory tree. Dynamic segments use bracket
filename conventions:

- `[param].js` — single dynamic segment (e.g. `pages/search/[query].js` → `/search/:query`)
- `[[...param]].js` — **optional catch-all** (matches the base path *and* any depth below it)
- `[...param].js` — catch-all (one or more segments) — convention is available; the codebase favors the optional form
- Nested folders → nested URL paths; `index.js` → the folder's base path

Special files:

- `pages/_app.js` — root wrapper for every page (providers, global CSS, route-transition loading, toasts)
- `pages/_document.js` — custom HTML document (`<html lang>`, viewport with `viewport-fit=cover` for Capacitor safe-areas, Google "Sora" font preconnect/stylesheet)
- `pages/404.js` — custom not-found page
- `pages/api/*` — API routes (only `pages/api/hello.js` exists; the app talks to a **separate external backend**, not Next API routes)

### 1.2 Route inventory (selected, showing the conventions)

Real entries from `pages/`:

```
/                                  pages/index.js
/explore                           pages/explore.js
/login  /signup  /help             pages/login.js, signup.js, help.js
/businessLogin  /businessSignup    pages/businessLogin.js, businessSignup.js

# single dynamic segment
/search/[query]                    pages/search/[query].js
/browse/tag/[tag]                  pages/browse/tag/[tag].js

# nested dynamic segments
/listing/view/[listingID]/[listingName]
/profile/user/[userID]/[username]/index.js   (+ /activity, /lists, /badges, /allreviews, ...)
/profile/producer/[producerID]/[[...slug]]    (optional catch-all tail)
/club/view/[clubID]/[clubName]
/event/[eventID]/[eventName]
/assemblies/[assemblyId]/[assemblyName]/assembly-post/[postId]/[postTitle].js

# optional catch-all (matches base + deeper)
/listing/create/[[...params]]
/listing/edit/[listingID]/[[...requestID]]
/dashboard/venue/[[...venueID]]
/browse/drink/[browseDrinkType]/[[...browseTypeCategory]]
/request/new/[[...requestID]]   /request/modify/[mode]/[listingID]/[[...requestID]]

# sub-apps under the same router
/shop, /shop/products, /shop/individual-listing/[listingId], /shop/login
/admin/dashboard, /admin/importListings

# SEO / machine routes rendered as pages
/robots.txt            pages/robots.txt.js
/sitemap.xml           pages/sitemap.xml.js
/sitemap-static.xml    pages/sitemap-static.xml.js
/sitemap-listings/[page]  /sitemap-producers/[page]  /sitemap-venues/[page]
```

> Multi-segment "pretty" URLs (e.g. `[listingID]/[listingName]`) carry a numeric
> id plus a human slug. Canonicalization is enforced server-side (see §1.5).

### 1.3 Navigation & route events

- Navigation uses `next/link` and the imperative `useRouter()` from `next/router`.
- `pages/_app.js` subscribes to `router.events` (`routeChangeStart` /
  `routeChangeComplete` / `routeChangeError`) to drive a **global loading
  overlay** and scroll-to-top on every transition. While loading it renders a
  layout-wrapped placeholder: `LoadingSkeleton` for `/listing/view/*` routes,
  `LoadingWithFunFact` otherwise.

```js
// pages/_app.js (essence)
const router = useRouter();
useEffect(() => {
  const handleStart = (url) => { setTargetPath(url); setLoading(true); window.scrollTo(0, 0); };
  const handleEnd = () => setLoading(false);
  router.events.on('routeChangeStart', handleStart);
  router.events.on('routeChangeComplete', handleEnd);
  router.events.on('routeChangeError', handleEnd);
  return () => { /* .off(...) the same three */ };
}, [router]);
```

### 1.4 Layouts

There is no Pages-Router `getLayout` pattern. Instead:

- A small HOC `components/WithLayout.js` composes a page with a layout:
  ```js
  const WithLayout = ({ component: Component, layout: Layout, ...rest }) =>
    <Layout><Component {...rest} /></Layout>;
  ```
- Three layouts exported from `components/layouts/index.js`:
  - `Main` — `LandingPageNavBar` + content + `FooterBar` (the default site chrome; ~70 pages use it)
  - `ShopLayout` — the `/shop` sub-app chrome (its own `Navbar`)
  - `UserProfileLayout` — profile pages
- Pages import the layout directly and wrap their own content (most pages import from `@/components/layouts`).

### 1.5 Server-side routing behaviour (redirects, 404s, guards)

**Config-level redirect** — `next.config.mjs` 308-redirects the bare apex host
to the canonical `www` host:

```js
async redirects() {
  return [{
    source: '/:path*',
    has: [{ type: 'host', value: 'drink-x.com' }],
    destination: 'https://www.drink-x.com/:path*',
    permanent: true,
  }];
}
```

**Per-page in `getServerSideProps`** (the dominant data-fetching method — ~73
pages use `getServerSideProps`, only 2 use `getStaticProps`, 0 use
`getStaticPaths`):

- *Real 404s*: invalid/missing ids return `{ notFound: true }` (e.g. non-numeric `listingID`).
- *Canonical-slug enforcement*: if the URL slug ≠ the slug derived from the entity name, return a permanent `redirect` to the canonical URL (prevents duplicate URLs splitting SEO equity).
- *Auth guards*: read auth cookies from `req.headers.cookie`, redirect to `/login` (or `/`) when missing/unauthorized, and pass the verified user back as the `initialUser` prop.

```js
// auth-guard pattern (pages/admin/dashboard.js, essence) [EVENTS APP: Open the admin dashboard on the events origin DIRECTLY (events.88bamboo.co), NOT via www.88bamboo.co — the Shopify App Proxy strips the cookies this guard reads. Public pages go through the proxy; admin does not.]
export async function getServerSideProps({ req }) {
  const cookies = req.headers.cookie || '';
  const accID = cookies.split('; ').find(c => c.startsWith('88B_accID='))?.split('=')[1];
  if (!accID) return { redirect: { destination: '/login', permanent: false } };
  const user = await adminService.getUser(accID);
  if (!user || !user.isAdmin) return { redirect: { destination: '/', permanent: false } };
  return { props: { initialUser: user } };   // hydrates auth context (see §2.2)
}
```

`getServerSideProps` returning `initialUser` is found across guarded pages
(admin dashboard, stories create/edit, topics create, listing import, club post,
events organiser dashboards, etc.).

---

## 2. State management

**Pattern, not a library.** State is layered:

1. **React Context** for cross-cutting auth/session — a single `AuthContext`.
2. **Custom hooks** (`hooks/*`) for feature-local stateful logic.
3. **A service layer** (`core/services/*`) wrapping a fetch client — the data
   source; components hold fetched data in local `useState`.

There is no global store and no client cache library (no React Query/SWR);
each component/page fetches via services and keeps results in local state.

### 2.1 The one global store: `AuthContext` (`hooks/useAuth.js`)

`AuthProvider` (mounted once in `_app.js`) holds the entire auth/session model
and exposes it through `useAuth()`:

Exposed value:
```
user, userDetails, userId, userType, loading,
isAdmin, isModerator, specialStatus,
login(userData), logout(), refreshUserDetails()
```

Behaviour:
- Seeds `user` from the SSR-provided `initialUser` prop when present; otherwise
  reads the client session from `authService.getUser()` (localStorage) on mount.
- After it has a `user`, calls `usersService.getUserData(id, type)` to populate
  `userDetails`, and derives flags: `isAdmin`, `isModerator` (non-empty
  `modType` array), and `specialStatus` (for `venue` accounts).
- `login()` persists the session (`authService.setUser`) then refreshes details;
  `logout()` clears push-notification registration, signs out native Google/Apple
  social sessions on Capacitor, then clears storage/cookies and resets state.
- `useAuth()` throws if used outside the provider.

```js
// _app.js wiring
<AuthProvider initialUser={initialUser}>
  <PushNotificationInitializer />   {/* uses useAuth(); inits push once user.id exists */}
  {/* page or loading placeholder */}
  <ToastContainer />
</AuthProvider>
```

### 2.2 Session persistence & SSR/CSR bridge (`core/services/auth.js`)

Session identity is stored under three keys, in **both** localStorage and
cookies, so client code and SSR both have access:

```
88B_accID  88B_accType  88B_accUsername
```

- **localStorage** is the source of truth on the client (unbounded lifetime).
- **Cookies** (7-day TTL, `path=/; SameSite=Lax`) exist so `getServerSideProps`
  can read the session server-side (auth guards in §1.5).
- Drift handling: `authService.getUser()` re-issues the cookies from
  localStorage if they have expired but localStorage still has the session
  (otherwise SSR guards would bounce a "logged-in" user to `/login`).
- `login()` hashes the password client-side, resolves username→canonical
  username via the backend, then `POST /authcheck/authcheck`.

> Note: auth here is an **id/type/username session pointer**, not a JWT. The
> `/shop` sub-app is the exception — it uses a JWT in `localStorage` under key
> `token`, decoded with `jwt-decode` in `hooks/shopAuth.js` (`user_code`
> 1=admin, 2=merchant, 3=customer). The two auth systems are independent.

### 2.3 Custom hooks (`hooks/`)

Feature-scoped stateful logic, each a self-contained hook:

```
useAuth.js            global auth context (above)
useNotifications.js   notifications state
useSearch.js          search state/logic
useUserSearch.js      user search
useAutocompleteSearch.js  navbar autocomplete
useLocationTagging.js
useSignupForm.js  useSignupSubmit.js   signup flow
useTagFriends.js
shopAuth.js           shop JWT helpers (not a React context)
```

### 2.4 Service layer (`core/services/`) + API client (`core/config/api.js`)

All backend I/O goes through `apiClient` (a thin `fetch` wrapper exposing
`get/post/put/patch/delete`; JSON by default, passes `FormData` through
untouched, returns `{ data, ok, status }`). ~40 domain service modules wrap it,
e.g. `auth`, `users`, `listings`, `producers`, `venues`, `reviews`, `events`,
`clubs`, `stories`, `shop`, `payment`/`stripe`, `notifications`, `search`, etc.

Utility modules: `core/utils/{constants,helpers,sanitize,seo}.js`.

---

## 3. Environment variables (`.env`) — deployed vs local

The base URL the frontend uses to reach the backend is the only routing/state
behaviour that changes with environment. The client/server split is in
`core/config/api.js`:

```js
const isServer = typeof window === 'undefined';
const API_BASE_URL = isServer
  ? (process.env.API_INTERNAL_URL || process.env.NEXT_PUBLIC_API_URL || 'http://backend:5000')
  : (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000');
```

- **Browser (CSR)** always uses `NEXT_PUBLIC_API_URL`.
- **Server (SSR / `getServerSideProps`)** prefers `API_INTERNAL_URL` (in-cluster
  hostname) and falls back to `NEXT_PUBLIC_API_URL`.

| Var | (a) Deployed (`.env.production`) | (b) Local (`.env.development`) |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | `https://api.drink-x.com` | `http://172.20.10.8:5001` (example LAN IP; was `localhost:5000`) |
| `NEXT_PUBLIC_BASE_URL` | `https://drink-x.com` | `http://localhost:8080` |
| `API_INTERNAL_URL` | empty (falls back to public URL) | `http://backend:5000` (docker-compose service name) |
| `NEXT_PUBLIC_APPLE_SERVICES_ID` | `com.88bamboo.drinkx.web` | `com.88bamboo.drinkx.web` (same) |

Non-environment-specific keys live in `.env` (shared) — Google Maps key, Google
OAuth client id, Google iOS client id, Stripe publishable key. The canonical
public site host used for SEO (`SITE_URL = https://www.drink-x.com`) is
**hard-coded** in `core/utils/seo.js` (EVENTS APP: Hardcode the events canonical base instead: https://www.88bamboo.co/a/events — used for JSON-LD and canonical tags.), not env-driven.

> **Routing & state and `.env`:** Beyond the API base URL (and the apex→www
> redirect, which is host-driven in `next.config.mjs`, not env-driven), the
> **routing structure and state-management behaviour do not change between the
> deployed and local environments.** Route definitions, the Context/hooks/service
> pattern, auth-cookie handling, and SSR guards are identical in both. The only
> environment difference is *which backend host* requests are sent to.

---

## 4. Replication checklist

1. Next.js Pages Router, JavaScript, `@/*` → root alias, Tailwind + Bootstrap.
2. `_app.js`: mount one `AuthProvider`, wire `router.events` for a global
   loading overlay + scroll-reset, render a `ToastContainer`.
3. `_document.js`: set `lang`, `viewport-fit=cover`, preload fonts.
4. Auth = React Context fed by an SSR `initialUser` prop *or* a localStorage
   session, mirrored into cookies so `getServerSideProps` guards can read it.
5. Data fetching = per-page `getServerSideProps` for SEO-critical/guarded pages;
   client components call a `core/services/*` layer over a single `fetch`-based
   `apiClient`. No global store, no client cache library.
6. Environment: split `API_BASE_URL` (server-internal vs public) via env; keep
   everything else env-independent; hard-code the canonical SEO host.



# B4 — Component and styling structure 
## Frontend — Components & Styling Reference Spec

Reference for replicating the component/styling organisation of the active Next.js app
at `frontend/`. (The deprecated Vue app under `the-green-bamboo/frontend/` is ignored.)
This is a description of what exists, not a recommendation.

---

## 1. Stack at a glance

| Concern | Choice |
|---|---|
| Framework | Next.js (Pages Router, **not** App Router) — `pages/` directory |
| React | React 19 |
| Language | Plain **JavaScript** (`.js` / JSX). No TypeScript — 608 component files, all `.js` |
| Module alias | `@/*` → project root (`jsconfig.json`) |
| Styling — primary | **Bootstrap 5** (CSS + JS bundle) + one large global stylesheet |
| Styling — secondary | **Tailwind CSS** (prefixed `tw-`, used sparingly), inline `style={{}}`, `styled-jsx` |
| Icons | `bootstrap-icons`, `@phosphor-icons/react`, `lucide-react` |
| Component libs | `@headlessui/react`, `@dnd-kit/*`, `react-toastify`, `react-quill-new`, chart.js |
| Native wrapper | Capacitor (iOS/Android) — affects some styling (safe-area insets) |

No CSS Modules, no SCSS, no Vanilla Extract — confirmed: zero `*.module.css` / `*.scss`
files exist in the project.

---

## 2. Folder structure

```
frontend/
├── pages/                # Next.js Pages Router — routes + thin page wrappers
│   ├── _app.js           # global CSS imports, providers, layout-on-loading
│   ├── _document.js      # <html>, fonts, viewport meta
│   └── <route>.js / <route>/...
├── components/
│   ├── WithLayout.js               # HOC-style layout wrapper
│   ├── WithUserProfileLayout.js    # second layout wrapper
│   ├── common/                     # 42 shared, cross-page components (flat)
│   ├── layouts/                    # page-shell layouts (Main / ShopLayout / UserProfileLayout)
│   └── views/                      # one folder per page/screen ("view")
│       ├── landingPages/           # public/marketing screens
│       └── supportingPages/        # ~70 app screens
├── core/
│   ├── config/         # config constants
│   ├── services/       # API service modules (data fetching)
│   └── utils/          # helpers
├── hooks/              # custom React hooks (e.g. useAuth)
├── styles/
│   ├── globals.css     # ~3.3k-line global stylesheet (the real workhorse)
│   └── shop/shop.css   # shop-specific styles (currently NOT imported)
├── public/             # static assets (Images/, assets/, svgs, favicon)
├── assets/             # Capacitor app icon.png / splash.png
├── tailwind.config.mjs
├── postcss.config.js
├── next.config.mjs
└── jsconfig.json
```

### 2.1 `components/common/` — shared components
Flat directory (no nesting). One file per component, PascalCase filename = component name.
Examples: `Modal.js`, `ListingCard.js`, `LoadingSpinner.js`, `EditProfileModal.js`,
`UserProfileHeader.js`, `ErrorBoundry.js`, `SortBar.js`. These are imported across many views.

### 2.2 `components/views/` — page-level screens
Each screen is a **self-contained folder** named in PascalCase. The convention per folder:

```
views/supportingPages/IndividualListing/
├── IndividualListing.js     # the main view component (same name as folder)
├── index.js                 # barrel: export { default } from './IndividualListing'
└── components/              # OPTIONAL — view-private sub-components
    └── *.js
```

- The main component file **shares the folder's name**.
- `index.js` is a one-line **barrel re-export** so the folder can be imported by name.
- A `components/` subfolder holds sub-components used **only** by that view (46 of ~76 view
  folders have one). Example — `views/landingPages/Home/`:
  ```
  Home/
  ├── Home.js
  ├── index.js
  └── components/
      ├── Hero.js, Features.js, LookingFor.js, ReviewsGrid.js, ...
      └── index.js            # barrel re-exporting all sub-components
  ```
- `views/landingPages/` vs `views/supportingPages/` is the only categorisation —
  marketing/public entry screens vs. authenticated/app screens.

### 2.3 Barrel files (`index.js`) everywhere
Two patterns, used consistently:
- **Single re-export:** `export { default } from './IndividualListing'`
- **Aggregating barrel:** `components/views/supportingPages/index.js` (67 lines) does
  `export { default as LatestNews } from './LatestNews';` for every view, so pages can
  `import { LatestNews } from '@/components/views/supportingPages'`.

### 2.4 `components/layouts/` — page shells
Three layouts, each its own folder with the same internal convention as views
(`Layout.js` + `index.js` + `components/` for layout-private parts like navbar/footer):

```
layouts/
├── index.js              # barrel: exports Main, UserProfileLayout, ShopLayout
├── Main/
│   ├── Main.js           # <LandingPageNavBar/> + {children} + <FooterBar/>
│   ├── index.js
│   └── components/
│       ├── FooterBar.js
│       └── LandingPageNavBar/   # nested folder w/ its own components/ + index.js
├── ShopLayout/
│   └── components/Navbar.js
└── UserProfileLayout/    # fetches shared profile data once, wraps profile tabs
```

`Main.js` is intentionally minimal:
```jsx
const Main = ({ children }) => (
  <>
    <div><LandingPageNavBar /></div>
    <div>{children}</div>
    <div><FooterBar /></div>
  </>
)
```

### 2.5 How pages wire layouts to views
`pages/*.js` are thin: they handle data fetching (`getStaticProps`/`getServerSideProps`),
SEO `<Head>`, then render a view inside a layout via the `WithLayout` helper:

```jsx
// components/WithLayout.js
const WithLayout = ({ component: Component, layout: Layout, ...rest }) => (
  <Layout><Component {...rest} /></Layout>
);
```
```jsx
// pages/Latest-News.js
<WithLayout layout={Main} component={LatestNews} news={latestNews} />
```
`WithUserProfileLayout.js` is the equivalent for the profile layout.

---

## 3. Styling approach

There is **no single styling system** — it's a layered, pragmatic mix. In priority of how
much it carries the UI:

1. **Bootstrap 5 (dominant).** Imported globally in `pages/_app.js`:
   ```js
   import 'bootstrap/dist/css/bootstrap.min.css';
   import 'bootstrap-icons/font/bootstrap-icons.css';
   ```
   The JS bundle is dynamically imported client-side in `_app.js`:
   `import('bootstrap/dist/js/bootstrap.bundle.min.js')` (enables modals/dropdowns/etc).
   ~405 of 608 component files use Bootstrap grid/utility classes (`container`, `row`,
   `col-*`, `d-flex`, `btn`, etc.). This is the main layout/spacing/typography mechanism.

2. **`styles/globals.css` (~3,311 lines).** The custom global stylesheet — bespoke
   classes (`.hero-section`, `.navbar-container`, custom `mobile-*` responsive helpers,
   modal/review/"House Note" feature blocks), plus Bootstrap overrides and Capacitor
   safe-area rules. Organised loosely by feature with `/* ===== Section ===== */` comment
   banners. Imported once in `_app.js` as `@/styles/globals.css`.

3. **Inline styles `style={{ }}` (~355 files).** Heavily used for one-off/dynamic styling.

4. **`styled-jsx` (~109 files).** Next.js's built-in scoped CSS, via
   `<style jsx>` / `<style jsx global>` blocks inside components, for component-local rules.

5. **Tailwind CSS (light use, ~14 files).** Configured but secondary. **Crucially it is
   namespaced** to coexist with Bootstrap:
   ```js
   // tailwind.config.mjs
   export default {
     prefix: 'tw-',         // ALL Tailwind classes are tw-* (e.g. tw-flex, tw-bg-custom-green)
     important: true,       // Tailwind rules win specificity battles vs Bootstrap
     content: ['./pages/**/*.{js,...}', './components/**/*.{js,...}', './app/**/*.{js,...}'],
     theme: { extend: {
       colors: { 'custom-green': '#0B4321', 'custom-orange': '#DD9E54', 'nav-color': '#FFFCF6', ... },
       spacing: { '9/10': '90%' },
       screens: { '8xl': '1440px' },
     }},
     plugins: [],
   }
   ```
   PostCSS pipeline (`postcss.config.js`): `tailwindcss` + `autoprefixer`.
   > Note: `globals.css` does **not** contain `@tailwind base/components/utilities`
   > directives at the top of the inspected region — Tailwind is opt-in via `tw-` classes
   > where present; Bootstrap + globals.css provide the base layer.

### 3.1 Brand colour palette (from `tailwind.config.mjs`)
`custom-green #0B4321`, `custom-green-dark #262626`, `custom-green-light #7f9a82`,
`custom-orange #DD9E54`, `custom-orange-light #E0B58D`, `custom-yellow-dark #DD9E54`,
`backg-color #FFFFFF`, `nav-color #FFFCF6`, `table-color #FFFAF0`.

### 3.2 Fonts
- **Sora** — loaded via Google Fonts `<link>` in `_document.js` (weights 100–800).
- Body default font stack in `globals.css`: `'Helvetica Neue', Helvetica, Arial, sans-serif`.
- `<body className="antialiased">` set in `_document.js`.

### 3.3 Global CSS import order (single source of truth — `pages/_app.js`)
```js
import 'bootstrap/dist/css/bootstrap.min.css';
import 'bootstrap-icons/font/bootstrap-icons.css';
import '@/styles/globals.css';
//import '@/styles/shop/shop.css';            // present but commented out
import 'react-toastify/dist/ReactToastify.css';
```
`styles/shop/shop.css` exists (~60 lines) but is **not currently imported** anywhere.

### 3.4 Capacitor / native-app styling hook
`_app.js` adds `document.body.classList.add('capacitor-native')` when running inside the
native app. `globals.css` keys off `body.capacitor-native` to apply safe-area-inset padding
(notch/home-indicator) and to hide certain nav items on iOS/Android. `_document.js` sets
`viewport-fit=cover` so `env(safe-area-inset-*)` works. This only affects the Capacitor
builds, not the web site.

---

## 4. Environment (`.env`) impact on components & styling

**`.env` has no effect on the component or styling organisation.** Stated explicitly because
the spec asks: the folder structure, Bootstrap/Tailwind/global-CSS setup, layouts, and class
usage are **identical** between the deployed site and the local site. Env vars here only
configure API endpoints and third-party keys, not styling.

For completeness, the env differences that *do* exist (non-styling):

| Variable | (a) Deployed (`.env.production`) | (b) Local (`.env.development`) |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | `https://api.drink-x.com` | `http://172.20.10.8:5001` (local backend) |
| `NEXT_PUBLIC_BASE_URL` | `https://drink-x.com` | `http://localhost:8080` |
| `API_INTERNAL_URL` | empty | `http://backend:5000` (Docker) |
| `NEXT_PUBLIC_*` keys (Maps/GAuth/Apple/Stripe) | from `.env` (live keys, e.g. Stripe `pk_live_…`) | same `.env`; fill blanks per `.env.example` |

`.env.example` lists all expected keys (Maps, Google/Apple auth client IDs, Stripe
publishable + price IDs). None of these alter how components are structured or styled —
they're data/integration config only.

---

## 5. Conventions to mirror (checklist)

- Pages Router, plain JS/JSX, `@/*` alias to project root.
- **Three buckets** under `components/`: `common/` (flat shared), `layouts/` (page shells),
  `views/` (one folder per screen, split into `landingPages/` + `supportingPages/`).
- Each view/layout folder = `Name.js` + `index.js` barrel + optional `components/` subfolder
  (with its own aggregating `index.js`) for private sub-components.
- Aggregating `index.js` barrels at each grouping level for clean named imports.
- Thin `pages/*` files: data + `<Head>` SEO + `WithLayout({ layout, component, ...props })`.
- Styling = **Bootstrap 5 as the base**, one big `styles/globals.css` for custom/feature CSS,
  Tailwind **prefixed `tw-` + `important: true`** for opt-in utilities, plus inline styles and
  `styled-jsx` for local cases. All global CSS imported once in `_app.js`.
- Brand palette + custom breakpoints live in `tailwind.config.mjs` `theme.extend`.
- Sora font via `_document.js`; body uses Helvetica Neue stack from `globals.css`.
- Non-web (Capacitor) styling gated behind a `body.capacitor-native` class.
```



# C1 — Dockerfiles 
## DrinkX — Docker / Container Reference Spec

Reference for replicating the containerized architecture in a new, separate application.
Describes exactly what exists today: every Dockerfile, the service it builds, its base
image, what gets installed, and the startup command — plus the `.env`-driven differences
between **(a) the deployed site** and **(b) the local site**.

There are **two stacks** in this repo:

| Stack | Location | Frontend | Backend | DB | Status |
|-------|----------|----------|---------|----|--------|
| **Current** | repo root (`frontend/`, `backend/`, `database/`) | Next.js (Node) | Flask (Python) | Postgres 15 | Authoritative |
| **Legacy** | `the-green-bamboo/` | Vue + Nginx | Flask (Python) | Postgres 15.8 | Older copy — kept for reference only |

There are **4 Dockerfiles total**: 2 in the current stack, 2 in the legacy stack.
The database has no Dockerfile in either stack — it runs from the official `postgres` image
in compose, seeded from SQL files.

---

## 1. Current frontend — `frontend/Dockerfile.frontend`

**Builds:** the **frontend** service (Next.js app, container name `nextjs`).

This is a **3-stage multi-stage build** with named targets — compose picks which target to
build, which is the main local-vs-deployed lever (see §5).

```dockerfile
# ========================
# Dev image
# ========================
FROM node:20-alpine AS dev
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
EXPOSE 3000

# Important: bind to 0.0.0.0 so Docker can expose it
CMD ["npm", "run", "dev", "--", "--hostname", "0.0.0.0", "--port", "3000"]


# ========================
# Prod build
# ========================
FROM node:20-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build


# ========================
# Prod runtime
# ========================
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app ./
EXPOSE 3000

CMD ["npm", "run", "start", "--", "--hostname", "0.0.0.0", "--port", "3000"]
```

**Plain language:**

- **Base image:** `node:20-alpine` (Node.js 20 on Alpine Linux — small) for all three stages.
- **What gets installed:** Node dependencies via `npm ci` (clean install from `package-lock.json`).
  No OS packages are added. The `builder` stage additionally runs `npm run build`
  (`next build --webpack`) to produce the optimized `.next` output.
- **Startup command:**
  - `dev` target → `npm run dev` (`next dev --webpack`) — hot-reload dev server.
  - `runner` target → `npm run start` (`next start`) — serves the prebuilt production output,
    with `NODE_ENV=production`.
  - Both bind to `0.0.0.0:3000` inside the container.
- **Exposed port:** 3000.

> Note: the `builder` stage has no `CMD`; it exists only to produce build artifacts that the
> `runner` stage copies in via `COPY --from=builder /app ./`.

---

## 2. Current backend — `backend/Dockerfile.backend`

**Builds:** the **backend** service (Flask API served by Gunicorn, container name `flask`).

**2-stage multi-stage build** (no named-target selection; always builds the final `runner`).

```dockerfile
########################################################################################
# Stage 1: Install dependencies
FROM python:3.11-slim AS builder

WORKDIR /app

# Copy all Python files and requirements.txt into the container
COPY ./requirements.txt ./

# Install dependencies from requirements.txt
RUN apt-get update && apt install -y build-essential
RUN pip install --no-cache-dir -r requirements.txt

########################################################################################
# Stage 2: Set up the actual application
FROM python:3.11-slim AS runner

WORKDIR /app

# This is for health check by AWS services: ECS, ALB, etc.
RUN apt-get update \
    && apt-get install --no-install-recommends -y ca-certificates libpq-dev curl wget \
    && rm -rf /var/lib/apt/lists/*

# Environment variables for build
ARG HOST=0.0.0.0
ENV HOST=${HOST}
ARG PORT=5000
ENV PORT=${PORT}

# Copy the installed dependencies from the builder stage
COPY --from=builder /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin

# Copy the application files into the container
COPY ./ ./
COPY .env .env

# Expose ports for each backend service
EXPOSE ${PORT}

# Command to run the application
CMD ["gunicorn", "--bind", "0.0.0.0:5000", "--access-logfile", "-", "--error-logfile", "-", "--log-level", "info", "--workers", "1", "--worker-class", "gevent", "--worker-connections", "60", "app:app"]
```

**Plain language:**

- **Base image:** `python:3.11-slim` (Python 3.11, slim Debian) for both stages.
- **What gets installed:**
  - *Builder stage:* `build-essential` (compilers/headers needed to build Python wheels),
    then all Python deps from `requirements.txt` via `pip install --no-cache-dir`.
  - *Runner stage:* runtime-only OS packages `ca-certificates`, `libpq-dev` (Postgres client
    lib), `curl`, `wget` (the last two used for container/ALB health checks), with apt lists
    cleaned up to keep the image small. The installed Python packages and console scripts are
    copied over from the builder stage (`site-packages` + `/usr/local/bin`) rather than
    reinstalled.
- **Build args / env:** `HOST` (default `0.0.0.0`) and `PORT` (default `5000`) are build-time
  args promoted to env vars. `EXPOSE ${PORT}` → 5000.
- **App files:** the whole backend tree is copied in, **including a baked-in `.env`**
  (`COPY .env .env`). The runtime config therefore comes from this `.env` file baked into the
  image (plus anything compose injects).
- **Startup command:** Gunicorn serving the WSGI app `app:app`:
  - bind `0.0.0.0:5000`
  - access + error logs to stdout/stderr
  - log level `info`
  - **1 worker**, `gevent` worker class, `60` worker connections (async I/O concurrency from a
    single worker process).

---

## 3. Legacy frontend — `the-green-bamboo/frontend/Dockerfile.frontend`

**Builds:** the **legacy frontend** service (Vue.js static site served by Nginx,
container name `vuejs`). This is the *older* stack.

```dockerfile
################################################################################
# Step 1: Serve static website with Nginx
################################################################################
FROM node:14-slim AS builder

# Set the working directory in the container
WORKDIR /app

# Copy package.json and package-lock.json to the container
COPY ./package*.json ./

# Install dependencies
RUN npm install

COPY .env .env
COPY .eslintrc.js .eslintrc.js 
COPY babel.config.js babel.config.js
COPY vue.config.js vue.config.js

COPY ./src ./src
COPY ./Images ./Images

# build app for production with minification
RUN npm run build

################################################################################
# Step 2: Serve static website with Nginx
################################################################################
FROM nginx:1.26-alpine AS runner

WORKDIR /usr/share/nginx/html

COPY --from=builder /app/dist/ /usr/share/nginx/html

COPY ./nginx.conf /etc/nginx/conf.d/default.conf
COPY ./nginx-backend-not-found.conf /etc/nginx/extra-conf.d/backend-not-found.conf
```

**Plain language:**

- **Base images:** build stage `node:14-slim` (Node 14, slim Debian); runtime stage
  `nginx:1.26-alpine` (Nginx web server on Alpine).
- **What gets installed:**
  - *Builder:* Node deps via `npm install`, then a Vue production build (`npm run build`)
    that emits a static site into `/app/dist/`. A build-time `.env` plus the Vue/Babel/ESLint
    config files are copied in before building.
  - *Runner:* no package installs — it's just Nginx. The built static files are copied to
    Nginx's web root (`/usr/share/nginx/html`), and two Nginx configs are dropped in
    (`nginx.conf` as the default server, `nginx-backend-not-found.conf` as an extra conf).
- **Startup command:** **none specified** — it inherits the base `nginx:1.26-alpine` image's
  default `CMD` (`nginx -g 'daemon off;'`), i.e. Nginx runs in the foreground serving the SPA.
- **Served port:** 80 inside the container (the Nginx config listens on `:80`; compose maps it).
- **Nginx config:** SPA fallback routing — `try_files $uri /index.html =404;` so client-side
  routes resolve to `index.html`.

---

## 4. Legacy backend — `the-green-bamboo/backend/Dockerfile.backend`

**Builds:** the **legacy backend** service (Flask API via Gunicorn, container name `flask`).

Identical in structure to the current backend (§2). **The only difference** is the startup
command: the legacy version does **not** set `--worker-connections 60` on Gunicorn (otherwise
same base image, same installs, same `gevent` single worker).

```dockerfile
########################################################################################
# Stage 1: Install dependencies
FROM python:3.11-slim AS builder

WORKDIR /app

COPY ./requirements.txt ./

RUN apt-get update && apt install -y build-essential
RUN pip install --no-cache-dir -r requirements.txt

########################################################################################
# Stage 2: Set up the actual application
FROM python:3.11-slim AS runner

WORKDIR /app

RUN apt-get update \
    && apt-get install --no-install-recommends -y ca-certificates libpq-dev curl wget \
    && rm -rf /var/lib/apt/lists/*

ARG HOST=0.0.0.0
ENV HOST=${HOST}
ARG PORT=5000
ENV PORT=${PORT}

COPY --from=builder /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin

COPY ./ ./
COPY .env .env

EXPOSE ${PORT}

# Command to run the application (note: no --worker-connections here)
CMD ["gunicorn", "--bind", "0.0.0.0:5000", "--access-logfile", "-", "--error-logfile", "-", "--log-level", "info", "--workers", "1", "--worker-class", "gevent", "app:app"]
```

Base image, installs, build args, baked-in `.env`, and exposed port are all exactly as
described in §2.

---

## 5. Compose wiring & how the image/target is chosen

### Current stack — `docker-compose.yml` (single file, all three services)

| Service | Image / build | Container | Host port → container | Notes |
|---------|---------------|-----------|----------------------|-------|
| `db` | `postgres:15-alpine` (no Dockerfile) | `postgres` | `127.0.0.1:5432 → 5432` | Seeds from `./database/postgresql/final` mounted into `/docker-entrypoint-initdb.d` on first boot; data in named volume `pgdata`; healthcheck `pg_isready`. |
| `backend` | builds `backend/Dockerfile.backend` | `flask` | `127.0.0.1:5000 → 5000` | `env_file: backend/.env`; forces UTF-8 locale; waits for `db` healthy; healthcheck `curl http://localhost:5000/health`. |
| `frontend` | builds `frontend/Dockerfile.frontend`, **`target: dev`** | `nextjs` | `127.0.0.1:8080 → 3000` | Bind-mounts `./frontend` for live reload (anonymous volumes shield `node_modules` and `.next`); waits for `backend` healthy. |

Key point: the root compose file builds the frontend with **`target: dev`** — i.e. the local
workflow uses the **`dev`** stage (hot reload). To run the production frontend you build the
**`runner`** target instead (the Dockerfile supports it; this compose file doesn't select it).

### Legacy stack — split compose files (`the-green-bamboo/`)

Three separate files, brought up independently:

- `docker-compose-db.yml` — `postgres:15.8-alpine`, host port `5432→5430` (bind-mounted data dir,
  not a named volume), verbose statement logging enabled via `command:`.
- `docker-compose-be.yml` — builds the legacy backend (no `target`), port `5000→5000`.
- `docker-compose-fe.yml` — builds the legacy frontend (no `target`), port `3000→80`
  (Nginx listens on 80).

---

## 6. Deployed (a) vs Local (b) — the `.env`-driven differences

The container **images are the same** in both cases; what changes is the environment supplied.
The frontend is where this matters most, because `NEXT_PUBLIC_*` values are read at
**build time** and baked into the client bundle.

### Frontend env files (`frontend/`)

| Var | (b) Local (`.env.development`) | (a) Deployed (`.env.production`) | Meaning |
|-----|------------------------------|----------------------------------|---------|
| `NEXT_PUBLIC_BASE_URL` | `http://localhost:8080` | `https://drink-x.com` | Public site origin (browser-facing). |
| `NEXT_PUBLIC_API_URL` | a LAN/dev host, e.g. `http://172.20.10.8:5001` (was `http://localhost:5000`) | `https://api.drink-x.com` | API origin the **browser** calls. |
| `API_INTERNAL_URL` | `http://backend:5000` (Docker service DNS) | empty | Server-side/internal API URL used inside the container network. |
| `NEXT_PUBLIC_APPLE_SERVICES_ID` | `com.88bamboo.drinkx.web` | `com.88bamboo.drinkx.web` | Apple Sign-In services ID. |

`.env.example` (template) also lists client keys that must be filled per environment:
`NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`, `NEXT_PUBLIC_GAUTH_API_KEY`,
`NEXT_PUBLIC_GOOGLE_IOS_CLIENT_ID`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`,
`NEXT_PUBLIC_STRIPE_MONTHLY_PRICE_ID`, `NEXT_PUBLIC_STRIPE_YEARLY_PRICE_ID`.

> `.env.production` header literally says *"FOR DEPLOYED (comment out before local launch)"* [FRONTEND ENV CORRECTION: production frontend env vars live in the Vercel dashboard (scoped All/Production/Preview), NOT in a baked .env.production. Locally the frontend uses .env.local + npm run dev. The commented-block .env toggle pattern applies to the backend only.] —
> selection between (a) and (b) is done by swapping which env file is active, not by changing
> the Dockerfile.

**Also note:** in the **current** compose, the frontend gets its URLs from inline
`environment:` (not an env_file) — locally hardwired to:
`NEXT_PUBLIC_BASE_URL=http://localhost:8080`, `NEXT_PUBLIC_API_URL=http://localhost:5000`,
`API_INTERNAL_URL=http://backend:5000`.

### Backend env (`backend/.env`, template `backend/.env.example`)

Same image for (a) and (b); values differ. Template keys:

```
FLASK_DEBUG=False          # True locally for debug, False deployed
POSTGRES_USER / POSTGRES_PASSWORD / POSTGRES_DB
POSTGRES_HOST=db           # 'db' = compose service name locally; real host when deployed
POSTGRES_PORT=5432
MAIL_SERVER / MAIL_PORT / MAIL_USE_TLS / MAIL_USERNAME / MAIL_PASSWORD
STRIPE_SECRET_KEY          # test key local, live key deployed
AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY
```

The backend image **bakes in `.env`** at build (`COPY .env .env`) **and** compose injects
`backend/.env` via `env_file`, so the active `.env` chosen before build/up determines (a) vs (b).

### Database env (`database/.env`, template `database/.env.example`)

```
POSTGRES_USER / POSTGRES_PASSWORD / POSTGRES_DB
```

Consumed by the official `postgres` image to initialize the cluster on first boot. Same image,
different credentials per environment.

### Port summary (a vs b)

| | Local (b) | Deployed (a) |
|--|-----------|--------------|
| Frontend | `http://localhost:8080` (compose maps 8080→3000) | `https://drink-x.com` (behind a reverse proxy/ALB) |
| Backend API | `http://localhost:5000` | `https://api.drink-x.com` |
| Postgres | `127.0.0.1:5432` (current) / `5430` (legacy), localhost-only | managed/remote host |

All compose port bindings are pinned to `127.0.0.1` so nothing is exposed beyond the host
locally; in deployment the services sit behind a proxy/load balancer (the backend's
`curl`/`wget` + `/health` endpoint exist specifically for AWS ECS/ALB health checks).

---

## 7. Minimal recipe to replicate the architecture

1. **Frontend (Node/Next.js):** multi-stage `node:20-alpine` Dockerfile with `dev`, `builder`,
   `runner` targets; `npm ci` for installs; `next build` in builder; serve with `next dev`
   (local, via compose `target: dev` + bind mount) or `next start` (prod). Expose 3000.
2. **Backend (Python/Flask):** 2-stage `python:3.11-slim`; builder installs `build-essential`
   + `pip install -r requirements.txt`; runner adds `ca-certificates libpq-dev curl wget`,
   copies site-packages from builder, runs Gunicorn (`gevent`, 1 worker) on `0.0.0.0:5000`
   serving `app:app`; provide a `/health` endpoint. Expose 5000.
3. **Database:** official `postgres:15-alpine` image (no Dockerfile); mount SQL into
   `/docker-entrypoint-initdb.d` for first-boot seeding; persist with a named volume.
4. **Compose:** wire `db → backend → frontend` with healthcheck-gated `depends_on`; bind host
   ports to `127.0.0.1`; supply config via per-service `.env` / `env_file`, swapping
   development vs production env files (and the frontend build target) to switch between
   local and deployed.


# C2 — Compose / multi-container setup 

## DrinkX — Architecture Reference Spec (for replication)

A reference spec for reproducing the container architecture and environment wiring of this monorepo in a brand-new, separate application. Describes the system as it is — no recommendations.

## 1. Topology overview

Three services, single Docker network (the implicit default network created by Compose):

| Service    | Image / Build                          | Container name | Role                     |
| ---------- | -------------------------------------- | -------------- | ------------------------ |
| `db`       | `postgres:15-alpine`                   | `postgres`     | PostgreSQL database      |
| `backend`  | build `backend/Dockerfile.backend`     | `flask`        | Flask API (Gunicorn)     |
| `frontend` | build `frontend/Dockerfile.frontend`   | `nextjs`       | Next.js app              |

Startup order is enforced by health-gated dependencies:

```
db (healthy) ──> backend (healthy) ──> frontend
```

Services address each other by **service name** on the Compose network (e.g. backend connects to Postgres at host `db`; the frontend server process reaches the backend at `http://backend:5000`).

## 2. The authoritative compose file — `docker-compose.yml` (repo root)

This is the primary, current compose file. Reproduced in full:

```yaml
name: "drink-x"

services:
  db:
    image: postgres:15-alpine
    container_name: postgres
    env_file:
      - database/.env
    ports:
      - "127.0.0.1:5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
      # Auto-run your SQL init/seed on first boot
      - ./database/postgresql/final:/docker-entrypoint-initdb.d:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U $$POSTGRES_USER -d $$POSTGRES_DB"]
      interval: 5s
      timeout: 5s
      retries: 20
    restart: unless-stopped

  backend:
    build:
      context: backend
      dockerfile: Dockerfile.backend
    container_name: flask
    env_file:
      - backend/.env
    environment:
      LANG: "en_US.UTF-8"
      LC_COLLATE: "en_US.UTF-8"
      LC_CTYPE: "en_US.UTF-8"
    ports:
      - "127.0.0.1:5000:5000"
    depends_on:
      db:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "curl", "-fsSL", "http://localhost:5000/health"]
      interval: 10s
      timeout: 10s
      retries: 10
    restart: unless-stopped

  frontend:
    build:
      context: frontend
      dockerfile: Dockerfile.frontend
      target: dev
    container_name: nextjs
    environment:
      - NEXT_PUBLIC_BASE_URL=http://localhost:8080
      - NEXT_PUBLIC_API_URL=http://localhost:5000
      - API_INTERNAL_URL=http://backend:5000
    ports:
      - "127.0.0.1:8080:3000"
    depends_on:
      backend:
        condition: service_healthy
    # For live reload while developing locally
    volumes:
      - ./frontend:/app
      - /app/node_modules
      - /app/.next
    command: ["npm", "run", "dev", "--", "--hostname", "0.0.0.0", "--port", "3000"]
    restart: unless-stopped

volumes:
  pgdata:
```

### 2.1 Service-by-service

**`db` (PostgreSQL)**
- Image `postgres:15-alpine`.
- Config comes entirely from `database/.env` (see §4): `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`.
- Port `5432` published only to `127.0.0.1` (loopback-only, not exposed to the LAN).
- Two volumes:
  - Named volume `pgdata` → `/var/lib/postgresql/data` (persistent data).
  - Bind mount `./database/postgresql/final` → `/docker-entrypoint-initdb.d` (read-only). The Postgres image auto-runs any `*.sql`/`*.sh` in that dir **only on first boot** (i.e. when `pgdata` is empty). The authoritative seed/schema is `database/postgresql/final/01-postgresql_data3.sql`.
- Healthcheck: `pg_isready -U $POSTGRES_USER -d $POSTGRES_DB`. The `$$` in the YAML escapes `$` so the variable is expanded inside the container at runtime, not by Compose.

**`backend` (Flask / Gunicorn)**
- Built from `backend/Dockerfile.backend`.
- Env from `backend/.env` (see §4) plus three locale vars injected inline (`LANG`, `LC_COLLATE`, `LC_CTYPE` = `en_US.UTF-8`).
- Port `5000` → `127.0.0.1:5000`.
- `depends_on db: service_healthy` — will not start until the DB healthcheck passes.
- Healthcheck hits `GET /health` on itself via curl.
- Connects to Postgres using the host `db` (set via `POSTGRES_HOST=db` in `backend/.env`), NOT `localhost`.

**`frontend` (Next.js)**
- Built from `frontend/Dockerfile.frontend`, **`target: dev`** (the dev stage of the multi-stage Dockerfile).
- Env injected inline (the local/dev values — see §3 for how these flip in deployment).
- Port mapping `127.0.0.1:8080:3000` — container listens on 3000, host reaches it at `localhost:8080`.
- `depends_on backend: service_healthy`.
- Dev bind-mount setup for live reload:
  - `./frontend:/app` mounts the source over the image.
  - `/app/node_modules` and `/app/.next` are **anonymous volumes** that shadow the bind mount, so the container keeps its own installed deps and build cache instead of the host's.
- Overrides the image CMD to run `npm run dev` bound to `0.0.0.0:3000`.

## 3. Deployed vs. Local configuration (driven by env)

The key replication detail: the **same code** behaves differently based on which env values are present. The frontend resolves the API base URL at runtime depending on whether it is running on the server or in the browser, and on which env file is loaded.

### 3.1 Frontend API base-URL resolution — `frontend/core/config/api.js`

```js
const isServer = typeof window === 'undefined';

const API_BASE_URL = isServer
  ? (process.env.API_INTERNAL_URL || process.env.NEXT_PUBLIC_API_URL || 'http://backend:5000')
  : (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000');
```

- **Server-side (SSR / Next.js node process):** prefers `API_INTERNAL_URL` — the in-network address of the backend (`http://backend:5000`). Falls back to the public URL, then to `http://backend:5000`.
- **Client-side (browser):** uses `NEXT_PUBLIC_API_URL` (must be a browser-reachable address), falls back to `http://localhost:5000`.

This split is why two API URL vars exist: one for container-to-container calls, one for browser-to-backend calls. `NEXT_PUBLIC_*` vars are inlined into the client bundle by Next.js at build time and are public; non-prefixed vars (`API_INTERNAL_URL`) stay server-only.

### 3.2 The three env variables that flip per environment

| Variable                  | Local / dev value                         | Deployed value                  | Scope            |
| ------------------------- | ----------------------------------------- | ------------------------------- | ---------------- |
| `NEXT_PUBLIC_API_URL`     | `http://localhost:5000` (or a LAN IP/port)| `https://api.drink-x.com`       | browser + server |
| `NEXT_PUBLIC_BASE_URL`    | `http://localhost:8080` / `:3000`         | `https://drink-x.com`           | browser + server |
| `API_INTERNAL_URL`        | `http://backend:5000`                     | empty / unset in prod env file  | server only      |

### 3.3 The env files that encode each mode

**`frontend/.env.production`** — deployed values:
```
# FOR DEPLOYED (comment out before local launch)
NEXT_PUBLIC_API_URL=https://api.drink-x.com
NEXT_PUBLIC_APPLE_SERVICES_ID=com.88bamboo.drinkx.web
NEXT_PUBLIC_BASE_URL=https://drink-x.com # was http://127.0.0.1:3000
API_INTERNAL_URL=
```

**`frontend/.env.development`** — local values:
```
NEXT_PUBLIC_BASE_URL=http://localhost:8080
NEXT_PUBLIC_API_URL=http://172.20.10.8:5001 #originally http://localhost:5000 or 192.168.2.79:5001
NEXT_PUBLIC_APPLE_SERVICES_ID=com.88bamboo.drinkx.web
API_INTERNAL_URL=http://backend:5000
```

Notes for replication:
- In **local Docker** the inline `environment:` block in `docker-compose.yml` provides the dev values directly, overriding/short-circuiting any `.env` file for the frontend service.
- For **local non-Docker dev** (`next dev`), Next.js auto-loads `.env.development`; the LAN IP/port (`172.20.10.8:5001`, etc.) is used when testing from a phone/other device that cannot reach `localhost` of the dev machine.
- In **deployment** (e.g. Vercel-style hosting + a separate API host), `.env.production` values are used: the browser talks to `https://api.drink-x.com`, `API_INTERNAL_URL` is empty (no in-network backend hostname), and the bare apex `drink-x.com` 308-redirects to `https://www.drink-x.com` (see §6).

### 3.4 Backend deployed vs local

The backend reads everything from environment (`backend/.env` locally; real env vars in deployment). There is no separate prod/dev backend env file — the same keys take different values:
- `POSTGRES_HOST=db` for Docker Compose; a managed DB hostname (e.g. AWS Aurora endpoint) in deployment. The connection-pool code includes Aurora-timeout-aware health checks, indicating the deployed DB is Aurora/RDS.
- Credentials, mail, Stripe, and AWS keys are blank in `.env.example` and filled per environment.
- `HOST` defaults to `0.0.0.0`, `PORT` to `5000`, `FLASK_DEBUG` to `False` (`backend/app.py`).

## 4. Environment variable reference (from `.env.example` files)

### `database/.env` (consumed by `db`, and referenced by `backend`)
```
POSTGRES_USER=
POSTGRES_PASSWORD=
POSTGRES_DB=
```

### `backend/.env`
```
FLASK_DEBUG=False

POSTGRES_USER=
POSTGRES_PASSWORD=
POSTGRES_HOST=db          # service name on the Compose network
POSTGRES_PORT=5432
POSTGRES_DB=

MAIL_SERVER=
MAIL_PORT=
MAIL_USE_TLS=true
MAIL_USERNAME=
MAIL_PASSWORD=

STRIPE_SECRET_KEY=

AWS_ACCESS_KEY_ID=        # used for S3 image/PDF-menu uploads, CloudWatch
AWS_SECRET_ACCESS_KEY=
```
Also read at runtime by `app.py` but not in the example: `HOST` (default `0.0.0.0`), `PORT` (default `5000`).

### `frontend/.env` (full key set, from `.env.example`)
```
NEXT_PUBLIC_BASE_URL=http://localhost:3000
NEXT_PUBLIC_API_URL=http://localhost:5000
API_INTERNAL_URL=http://backend:5000

NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=
NEXT_PUBLIC_GAUTH_API_KEY=
NEXT_PUBLIC_GOOGLE_IOS_CLIENT_ID=
NEXT_PUBLIC_APPLE_SERVICES_ID=
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=
NEXT_PUBLIC_STRIPE_MONTHLY_PRICE_ID=
NEXT_PUBLIC_STRIPE_YEARLY_PRICE_ID=
```
All `NEXT_PUBLIC_*` keys are inlined into the client bundle at build time (public). `API_INTERNAL_URL` is the only server-only var.

### How env vars are passed in (summary)
- `db`: `env_file: database/.env`.
- `backend`: `env_file: backend/.env` + inline `environment:` (locales). The Dockerfile additionally `COPY .env .env` into the image (so the built image bakes in a `.env`; `app.py` calls `load_dotenv()`).
- `frontend`: inline `environment:` in compose for local Docker; `.env.development` / `.env.production` for non-Docker / deployed builds.

## 5. Dockerfiles

### `frontend/Dockerfile.frontend` — multi-stage (dev / builder / runner)
```dockerfile
# Dev image
FROM node:20-alpine AS dev
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
EXPOSE 3000
CMD ["npm", "run", "dev", "--", "--hostname", "0.0.0.0", "--port", "3000"]

# Prod build
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Prod runtime
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app ./
EXPOSE 3000
CMD ["npm", "run", "start", "--", "--hostname", "0.0.0.0", "--port", "3000"]
```
- `docker-compose.yml` uses **`target: dev`** (live-reload dev server with bind-mounted source).
- A production deploy would target `runner` (build then `next start`). Scripts (`frontend/package.json`): `dev`=`next dev --webpack`, `build`=`next build --webpack`, `start`=`next start`.

### `backend/Dockerfile.backend` — multi-stage (builder / runner)
```dockerfile
# Stage 1: deps
FROM python:3.11-slim AS builder
WORKDIR /app
COPY ./requirements.txt ./
RUN apt-get update && apt install -y build-essential
RUN pip install --no-cache-dir -r requirements.txt

# Stage 2: app
FROM python:3.11-slim AS runner
WORKDIR /app
RUN apt-get update \
    && apt-get install --no-install-recommends -y ca-certificates libpq-dev curl wget \
    && rm -rf /var/lib/apt/lists/*
ARG HOST=0.0.0.0
ENV HOST=${HOST}
ARG PORT=5000
ENV PORT=${PORT}
COPY --from=builder /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin
COPY ./ ./
COPY .env .env
EXPOSE ${PORT}
CMD ["gunicorn", "--bind", "0.0.0.0:5000", "--access-logfile", "-", "--error-logfile", "-", \
     "--log-level", "info", "--workers", "1", "--worker-class", "gevent", \
     "--worker-connections", "60", "app:app"]
```
- Runtime: **Gunicorn** with a single **gevent** worker, 60 worker-connections, serving `app:app`.
- `app.py` monkey-patches gevent and psycopg at import time (top of file) for async DB I/O.
- `curl`/`wget` + `ca-certificates` installed specifically so AWS ECS/ALB and the compose healthcheck can hit `/health`.
- Comments indicate deployment target is AWS (ECS, ALB, CloudWatch logging via `logging-cloudwatch.conf`).

## 6. Frontend `next.config.mjs` highlights (deploy behavior)
- `reactStrictMode: true`.
- **Apex → www redirect:** any request with `Host: drink-x.com` is 308-redirected (`permanent: true`) to `https://www.drink-x.com/:path*`. The edge layer does this in prod; the rule is kept in-app for other proxies/previews.
- `images.remotePatterns` allowlists external image hosts, including the prod S3 buckets `tf-drinkx-prod-fe-images.s3.ap-southeast-1.amazonaws.com` and `drinkx-badges.s3.ap-southeast-1.amazonaws.com` (region `ap-southeast-1`).

## 7. Secondary / legacy compose files — `the-green-bamboo/`

This is the **older copy** (per `CLAUDE.md`, always use the top-level versions). It splits compose into three files for running services individually, and the frontend there is **Vue.js**, not Next.js. Kept here only for completeness — do not replicate from these.

- **`docker-compose-db.yml`** — `postgres:15.8-alpine`, container `postgres`, port `127.0.0.1:5430:5430`, `PGDATA=/var/lib/postgresql/data/pgdata`, explicit locale env, bind-mounted data dir (`./database/postgresql/data`) + init dir, verbose query logging (`log_statement=all`, `log_min_duration_statement=50`), `restart: no`.
- **`docker-compose-be.yml`** — Flask backend, port `5000`, `env_file: backend/.env`, locale env, `/health` healthcheck; `depends_on` is commented out.
- **`docker-compose-fe.yml`** — `container_name: vuejs`, builds `frontend/Dockerfile.frontend`, port `127.0.0.1:3000:80` (served by a web server on port 80 in-container, i.e. a built static Vue app), `env_file: frontend/.env`, `depends_on backend: service_healthy`.
- Its frontend env uses `VUE_APP_*` keys (`VUE_APP_API_KEY`, `VUE_APP_GAUTH_API_KEY`, `VUE_APP_STRIPE_PUBLISHABLE_KEY`).

These three share `name: "drink-x"` so they compose into one project when run together (`docker compose -f docker-compose-db.yml -f docker-compose-be.yml -f docker-compose-fe.yml up`).

## 8. Run commands

**Local (authoritative stack):**
```bash
# from repo root — builds backend+frontend, starts db→backend→frontend in order
docker compose up --build
# frontend:  http://localhost:8080
# backend:   http://localhost:5000   (health: /health)
# postgres:  127.0.0.1:5432
```
First boot seeds the DB from `database/postgresql/final/*.sql`. To re-seed, remove the `pgdata` volume (`docker compose down -v`).

**Local non-Docker frontend dev:** `cd frontend && npm install && npm run dev` (loads `.env.development`).

**Deployed:** frontend built with `target: runner` (or hosted on Vercel-style platform) [CONFIRMED: production frontend = Vercel (repo han88bamboo/drinkx-monorepo, root dir frontend/, Node 24, region us-east-1/iad1, Fluid Compute + Image Optimization on). The Dockerfile.frontend runner target is LOCAL/legacy only — not the production path.] using `.env.production`; backend image run on AWS ECS behind an ALB with a managed Postgres (Aurora/RDS) — env vars supplied by the platform rather than `.env` files; static assets/images served from S3 (`ap-southeast-1`).


# D1 — Find the deployment mechanism 

## Drink-X — Build / Ship / Deploy Reference Spec

A concise, replication-oriented reference for the monorepo's build, CI, and deploy
machinery. Purely descriptive — documents what exists, not what it should be.

> **Stack:** Next.js frontend (+ Capacitor iOS/Android) · Flask backend (Gunicorn) ·
> Postgres. **Cloud:** AWS (ECR, ECS/ALB implied, S3 + CloudFront, Aurora Postgres) [⚠️ FRONTEND CORRECTION: the Next.js frontend deploys to Vercel (auto-deploy from main), NOT AWS ECS. AWS hosts the backend only. The ECS/ALB path here applies to the Flask API.],
> region `ap-southeast-1`, account `851725425890`.

> **Important architectural fact:** the **active** app has **no GitHub Actions / no
> managed CI pipeline**. Building and shipping is done **manually by running the
> shell scripts in `scripts/`** from a developer machine. The only workflow file in
> the repo belongs to `the-green-bamboo/` — the *retired Vue.js reference copy* — and
> does not deploy anything.

---

## 1. Inventory — every build/ship/deploy file

| File | Type | Purpose (plain language) |
|------|------|--------------------------|
| `scripts/docker-build.sh` | Bash | Builds the **backend** Docker image (`be-drinkx`), tagging `latest` + short git hash. |
| `scripts/fe-build.sh` | Bash | Builds the **frontend** Docker image (`fe-drinkx`), then also runs an `npm install` + `npm run build`. |
| `scripts/docker-push.sh` | Bash | Logs into AWS ECR and pushes the backend image under three tags (build-hash, git-hash, latest). |
| `scripts/fe-deploy.sh` | Bash | Deploys a **static** frontend build to S3 and invalidates CloudFront (CLI-flag driven). |
| `scripts/up.sh` | Bash | Local multi-file `docker compose` up/down helper (expects split compose files — see notes). |
| `docker-compose.yml` | Compose | The **actual** local-dev stack: Postgres + Flask + Next.js (dev mode, live reload). |
| `backend/Dockerfile.backend` | Dockerfile | Multi-stage build of the Flask app, run under Gunicorn (gevent worker). |
| `frontend/Dockerfile.frontend` | Dockerfile | Multi-stage Next.js image with `dev`, `builder`, `runner` targets. |
| `frontend/capacitor.config.json` | Config | Capacitor native-shell config (iOS/Android wrap pointing at production web). |
| `frontend/next.config.mjs` | Config | Next.js runtime config — host redirects, remote image hosts. |
| `the-green-bamboo/.github/workflows/node.js.yml` | GitHub Actions | **Reference-only / legacy.** Runs Jest + Python unittest on push/PR to `main`. Does **not** build or deploy. |
| `the-green-bamboo/docker-compose-*.yml`, `the-green-bamboo/**/Dockerfile.*` | Compose/Dockerfile | **Reference-only** (old Vue version). Ignore for replication. |

There are **no** `buildspec.yml`, `Makefile`, `task-definition.json`, Terraform, or
CloudFormation files in the active project. (The S3 bucket name `tf-drinkx-prod-fe-images`
hints infra was once Terraform-managed, but no `.tf` files are committed here.)

---

## 2. What each active file does in detail

### `scripts/docker-build.sh` — build backend image
- `cd`s to repo root, then into `backend/`.
- Sets `ECR_REPO="be-drinkx"`.
- Determines tag: `${GITHUB_SHA::7}` when run in CI, else `git rev-parse --short HEAD`.
  (CI-awareness is built in even though no CI currently calls it.)
- `docker image build --platform linux/amd64 --build-arg LOGLEVEL=info -f Dockerfile.backend -t be-drinkx:latest -t be-drinkx:<hash> .`
- Forces `linux/amd64` so images built on Apple Silicon run on AWS x86.

### `scripts/fe-build.sh` — build frontend image
- Same pattern with `ECR_REPO="fe-drinkx"` / `Dockerfile.frontend`.
- After the docker build it additionally runs `nvm use`, `npm install`, and
  `npm run build --production` directly in `frontend/` (produces a local Next build).

### `scripts/docker-push.sh` — push backend image to ECR
- `AWS_REGION=${AWS_DEFAULT_REGION:-ap-southeast-1}`, account `851725425890`.
- `ECR_HOST = <account>.dkr.ecr.<region>.amazonaws.com`, repo `be-drinkx`.
- `aws ecr get-login-password | docker login ...` to authenticate.
- Re-tags and pushes the locally-built image under **three** tags:
  - `<ECR_HOST>/be-drinkx:<build-hash>` (the image's own digest-derived id),
  - `<ECR_HOST>/be-drinkx:<git-hash>`,
  - `<ECR_HOST>/be-drinkx:latest`.
- Writes the build hash to `be-drinkx-hash.txt` (handoff artifact for whatever
  updates the ECS task / deployment).
- **Note:** only the backend has a push script; there is no `fe-push.sh`. The
  frontend ships as static files via `fe-deploy.sh` instead.

### `scripts/fe-deploy.sh` — deploy static frontend to S3 + CloudFront
- A flag-driven deploy tool (`-c/--cf-id`, `-s/--s3-bucket`, `-n/--domain-name`,
  `-t/--template`, plus `-v` verbose and `-d` dry-run).
- Optionally sources a local `.env` for those values.
- Validates all required vars; `--domain-name` must end in `/`.
- Workflow: `aws s3 rm` the existing prefix → `aws s3 sync frontend/<template>` up to
  `s3://<bucket>/<domain>/` (excluding LICENSE/README) → `aws cloudfront
  create-invalidation` for that path.
- Implies a **static-hosting** deployment path for the marketing/static template,
  distinct from the containerized Next.js server.

### `scripts/up.sh` — local stack lifecycle helper
- Runs `docker compose --project-name drink-x` against **three** files:
  `docker-compose-db.yml`, `docker-compose-be.yml`, `docker-compose-fe.yml`
  (a split layout) — first `down --remove-orphans --volumes`, then
  `up --build --detach --pull=missing --renew-anon-volumes`.
- **Caveat for replication:** those three split files do **not** exist at the active
  repo root (only the single `docker-compose.yml` does). They exist under
  `the-green-bamboo/`. For the active app, use `docker compose up -d --build` against
  the root `docker-compose.yml` (as the README instructs) rather than `up.sh`.

### `backend/Dockerfile.backend`
- Stage 1 `builder` (`python:3.11-slim`): `apt install build-essential`, `pip install -r requirements.txt`.
- Stage 2 `runner` (`python:3.11-slim`): installs `ca-certificates libpq-dev curl wget`
  (curl/wget present for ALB/ECS health checks), copies site-packages + app, copies `.env`.
- Build args `HOST=0.0.0.0`, `PORT=5000`.
- Runtime: `gunicorn --bind 0.0.0.0:5000 --worker-class gevent --workers 1
  --worker-connections 60 app:app` with access/error logs to stdout/stderr.
- Health endpoint: `GET /health` (also wired in compose healthcheck).

### `frontend/Dockerfile.frontend` (three targets)
- `dev` (`node:20-alpine`): `npm ci`, runs `next dev` bound to `0.0.0.0:3000`. **This is
  the target docker-compose uses locally.**
- `builder`: `npm ci` + `npm run build`.
- `runner`: `NODE_ENV=production`, copies built app, runs `npm run start` on `0.0.0.0:3000`.
- So the container path serves a **Next.js server**; the `fe-deploy.sh` path serves
  **static S3** — two different shipping modes coexist.

### `docker-compose.yml` (root — the real local stack)
- Project name `drink-x`. Three services:
  - **db** — `postgres:15-alpine`, env from `database/.env`, port bound to
    `127.0.0.1:5432`, named volume `pgdata`, and **auto-runs SQL** from
    `./database/postgresql/final` on first boot (mounted to
    `/docker-entrypoint-initdb.d`). Healthcheck via `pg_isready`.
  - **backend** — built from `backend/Dockerfile.backend`, env from `backend/.env`,
    forces UTF-8 locale, port `127.0.0.1:5000`, waits for db health, healthchecks
    `GET /health`.
  - **frontend** — built with `target: dev`, port `127.0.0.1:8080 -> 3000`, waits for
    backend health, bind-mounts source for live reload (`./frontend:/app` with
    anonymous volumes for `node_modules` and `.next`), runs `npm run dev`.
- Inline frontend env here points the browser at localhost and the server at the
  internal docker hostname (see §3).

### `frontend/next.config.mjs`
- `reactStrictMode: true`.
- `redirects()`: 308-redirects bare apex `drink-x.com` → `https://www.drink-x.com`
  (canonical-host enforcement; mirrors the edge layer).
- `images.remotePatterns`: allow-list of external image hosts (Shopify CDN, the prod
  S3 image bucket `tf-drinkx-prod-fe-images.s3.ap-southeast-1...`, badges bucket,
  Google/Amazon/Unsplash, etc.).
- Commented note: Vercel serves the `apple-app-site-association` file as
  octet-stream; a `headers()` override is suggested but not implemented.

### `frontend/capacitor.config.json` (native mobile shell)
- `appId: com.88bamboo.drinkx`, `appName: Drink-X`, `webDir: out`.
- `server.url: https://www.drink-x.com`, `cleartext: false` — the native iOS/Android
  apps load the **production** website rather than a bundled build.
- Plugins: PushNotifications, SplashScreen (2.5s), SystemBars, SocialLogin
  (Google + Apple enabled).

### `the-green-bamboo/.github/workflows/node.js.yml` (legacy reference only)
- Trigger: push / PR to `main`.
- Job `test-jest`: `npm install` then `npm test -- frontend/tests/example.spec.js`.
- Job `test-unittest`: sets up Python 3.11, installs `backend/requirements.txt`,
  runs `python -m unittest backend/tests/test_sample.py`.
- Test-only; **no build, push, or deploy steps.** Belongs to the retired Vue app.

---

## 3. Environment configuration — deployed (a) vs local (b)

Env files are git-ignored except `*.example`. The committed examples enumerate the
required keys; `.env.development` / `.env.production` carry the actual local/prod values.

### Frontend (`frontend/.env*`)

| Key | (a) Deployed / production | (b) Local |
|-----|---------------------------|-----------|
| `NEXT_PUBLIC_BASE_URL` | `https://drink-x.com` | `http://localhost:8080` |
| `NEXT_PUBLIC_API_URL` (browser → API) | `https://api.drink-x.com` | `http://localhost:5000` (compose) / a LAN IP like `http://172.20.10.8:5001` in `.env.development` for device testing |
| `API_INTERNAL_URL` (server-side → API) | *(empty in prod file)* | `http://backend:5000` (docker service DNS name) |
| `NEXT_PUBLIC_APPLE_SERVICES_ID` | `com.88bamboo.drinkx.web` | same |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | set | set |
| `NEXT_PUBLIC_GAUTH_API_KEY` | set | set |
| `NEXT_PUBLIC_GOOGLE_IOS_CLIENT_ID` | set | set |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | set | set |
| `NEXT_PUBLIC_STRIPE_MONTHLY_PRICE_ID` / `..._YEARLY_PRICE_ID` | set | set |

Key distinction: `NEXT_PUBLIC_*` vars are **browser-exposed** (inlined at build time);
`API_INTERNAL_URL` is **server-side only** and uses the in-cluster/in-compose hostname
(`backend`) so SSR talks to the API over the private network, while the browser uses
the public `NEXT_PUBLIC_API_URL`. In production the frontend file leaves
`API_INTERNAL_URL` empty (SSR uses the public API host or none).

`.env.production` header note: *"FOR DEPLOYED (comment out before local launch)"* — i.e.
the same file is toggled by commenting; selection is manual, not automated.

### Backend (`backend/.env`)

| Key | (a) Deployed | (b) Local |
|-----|--------------|-----------|
| `FLASK_DEBUG` | off | on |
| `POSTGRES_HOST` | AWS Aurora endpoint | `db` (compose service) |
| `POSTGRES_PORT` / `USER` / `PASSWORD` / `DB` | Aurora creds | local creds (match `database/.env`) |
| `MAIL_SERVER` / `MAIL_PORT` / `MAIL_USE_TLS` / `MAIL_USERNAME` / `MAIL_PASSWORD` | SMTP (Flask-Mail) | same / test SMTP |
| `STRIPE_SECRET_KEY` | live/secret key | test key |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | IAM creds for S3 uploads (boto3) | dev creds |

Backend app notes: Flask 3 + `flask-cors` (`CORS(app)` — open CORS), `psycopg2` with a
custom connection pool that does health checks/retries (built for Aurora connection
timeouts), `gunicorn[gevent]`, `boto3` for S3, `stripe` SDK.

### Database (`database/.env`)
- `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` — consumed by the `db` compose
  service and must match the backend's Postgres creds. On first boot the container
  auto-loads SQL from `database/postgresql/final/` (authoritative schema:
  `01-postgresql_data3.sql`).

---

## 4. Replication checklist (active app)

1. **Local dev:** copy each `.env.example` → `.env` (and `frontend/.env.development`),
   fill values, then `docker compose up -d --build`.
   - Frontend: `http://localhost:8080` · Backend health: `http://localhost:5000/health`
     · Postgres: `localhost:5432`.
   - Schema/seed auto-loads from `database/postgresql/final/` on first DB boot.
2. **Backend ship (manual):** `scripts/docker-build.sh` → `scripts/docker-push.sh`
   (needs AWS creds; pushes `be-drinkx` to ECR in `ap-southeast-1`). Whatever updates
   the ECS service consumes the `latest` tag / `be-drinkx-hash.txt`.
3. **Frontend ship:** either the container path (`Dockerfile.frontend` `runner` target
   → registry → ECS) or the static path (`scripts/fe-deploy.sh` → S3 + CloudFront).
4. **Mobile:** Capacitor wraps the live production site (`webDir: out`,
   `server.url: https://www.drink-x.com`); no separate web build is bundled.
5. **CI:** none for the active app — replicate the manual scripts, or port the legacy
   `the-green-bamboo` test workflow if test gating is wanted.

### AWS resources referenced in code
- ECR repos: `be-drinkx`, `fe-drinkx` (account `851725425890`, `ap-southeast-1`).
- S3: prod FE image bucket `tf-drinkx-prod-fe-images`, badges bucket `drinkx-badges`,
  plus a static-site bucket passed via `--s3-bucket` to `fe-deploy.sh`.
- CloudFront: distribution id passed via `--cf-id` to `fe-deploy.sh`.
- Aurora Postgres (backend pool tuned for Aurora timeouts).
- Domains: apex `drink-x.com` → `www.drink-x.com`; API at `api.drink-x.com`.


# D2 — Trace the deploy flow end to end

## Drink-X — Deployment Flow (plain-steps reference)

Companion to `DEPLOYMENT-CI-REFERENCE.md`. Describes, step by step, what actually
happens when you build and ship — and flags exactly which steps are **manual** vs
automated. Purely descriptive of the current repo; no recommendations.

> **Bottom line up front:** there is **no automated deploy pipeline**. Nothing happens
> on `git push`. Deployment is a **manual, developer-run sequence** of shell scripts +
> AWS CLI actions. The final "make production run the new image" step and all database
> changes are done **by hand** and are **not scripted in this repo**.

---

## 0. What a `git push` does

**Nothing deployment-related.** The active repo has no top-level `.github/workflows/`,
no CodeBuild, no CodePipeline. A push to GitHub only stores code. (The lone workflow
under `the-green-bamboo/` is the retired Vue reference app and runs tests only.)
All building and shipping is triggered manually by running scripts from a dev machine.

---

## 1. Backend deploy flow (Flask API)

### Where it's built
- **Locally, on the developer's machine** (or any box where you run the script).
- `scripts/docker-build.sh`:
  - `cd backend/`, builds `Dockerfile.backend` with `--platform linux/amd64`
    (so an Apple-Silicon dev machine produces x86 images for AWS).
  - Multi-stage: stage 1 pip-installs `requirements.txt`; stage 2 is the slim runtime
    running **Gunicorn** (`gevent` worker, 1 worker, binds `0.0.0.0:5000`).
  - Tags the image `be-drinkx:latest` **and** `be-drinkx:<git-short-hash>`.

### Where it's stored
- **AWS ECR** (Elastic Container Registry), region `ap-southeast-1`, account
  `851725425890`, repo `be-drinkx`.
- `scripts/docker-push.sh`:
  - `aws ecr get-login-password | docker login` to the ECR host.
  - Re-tags and pushes the locally built image under **three** tags:
    `…/be-drinkx:<build-hash>`, `…/be-drinkx:<git-hash>`, `…/be-drinkx:latest`.
  - Writes the resolved build hash to `be-drinkx-hash.txt`.

### What runs it in production
- An **AWS ECS task** (the container runs on ECS). Evidence in-repo:
  `backend/s3Images.py` — *"credentials provided by the IAM role associated with the
  ECS task"*; `Dockerfile.backend` installs `curl`/`wget` *"for health check by AWS
  services: ECS, ALB, etc."* So: ECS service behind an ALB, container talking to S3
  via the task's IAM role.
- **Launch type (Fargate vs EC2) is NOT specified anywhere in this repo.** No
  `task-definition.json`, no service/cluster names, no Terraform. You must supply that
  out-of-band when replicating.

### How production picks up the new image — **MANUAL / not in repo**
- There is **no** `aws ecs update-service`, `register-task-definition`, or any
  deploy-trigger script anywhere in the repo. Pushing `:latest` to ECR does **not**
  by itself restart the running task.
- Forcing ECS to pull and run the new image (force-new-deployment or a new task-def
  revision) is done **manually** — via the AWS Console or an `aws ecs` command run by
  hand — and that step is not captured here. `be-drinkx-hash.txt` exists as a handoff
  artifact for whoever performs that manual step.

### Plain sequence (backend)
1. `bash scripts/docker-build.sh` — build image locally (x86).
2. `bash scripts/docker-push.sh` — login to ECR, push 3 tags. *(needs AWS creds)*
3. **Manually** tell ECS to deploy the new image (Console or `aws ecs ...`). **Not scripted.**

---

## 2. Frontend deploy flow (Next.js)

Two distinct, manually-chosen shipping modes exist in the repo:

### Mode A — containerized Next.js server (parallels the backend)
- `scripts/fe-build.sh` builds `Dockerfile.frontend` tagged `fe-drinkx:latest` /
  `fe-drinkx:<hash>` (also runs a local `npm install` + `npm run build`).
- The `runner` target serves `next start` on `0.0.0.0:3000` under `NODE_ENV=production`.
- **There is no `fe-push.sh`** in the repo — pushing `fe-drinkx` to ECR and updating
  its ECS service is **manual / not scripted** (only the backend has a push script).

### Mode B — static site to S3 + CloudFront [LEGACY for the frontend: Vercel now serves www.drink-x.com. This CloudFront→S3 distribution is stale as the frontend host. (The separate tf-drinkx-prod-fe-images bucket is still used for images.)]
- `scripts/fe-deploy.sh` (flag-driven, run by hand):
  - `aws s3 rm` the target prefix, then `aws s3 sync frontend/<template>` →
    `s3://<bucket>/<domain>/`, then `aws cloudfront create-invalidation`.
  - Requires `--cf-id` (CloudFront distribution), `--s3-bucket`, `--domain-name`
    (must end in `/`), `--template`. Supports `--dry-run`.
- This is the path for the static template content; it is entirely **manual**.

### Mobile (Capacitor)
- iOS/Android shells (`frontend/capacitor.config.json`) just load the **live
  production website** (`server.url: https://www.drink-x.com`). No web bundle is
  shipped inside the app; "deploying" the website updates the apps automatically.
  Native binary release to the App/Play stores is a separate manual process (not in repo).

---

## 3. Database / migrations during deploy

**There is no migration tooling and no migration step in any deploy script.**

### Source of truth
- The authoritative schema is a single file: `database/postgresql/final/01-postgresql_data3.sql`.
- Project convention (`AGENTS.md`): *"any changes to the database schema should be
  reflected in `01-postgresql_data3.sql`. No need for migration."* Schema changes are
  edited directly into that file.

### What runs automatically — **local only, first boot only**
- In local Docker, the `db` service mounts `database/postgresql/final/` to
  `/docker-entrypoint-initdb.d`. Postgres runs those files **once, on an empty data
  volume**, in filename order:
  1. `00-init.sql` — creates the `drinkx` database/user and grants (uses `dblink`).
  2. `01-postgresql_data3.sql` — full schema (tables, extensions `pg_trgm`/`unaccent`).
  3. `02-insert-data.sql` — seed data.
- This **only** happens locally and **only** on first boot (empty `pgdata` volume).
  It does **not** run on subsequent `up`s, and it does **not** run against production.

### Production database
- Production uses **AWS Aurora Postgres** (the backend's psycopg2 connection pool is
  tuned for Aurora connection timeouts/retries). Aurora is a long-lived managed DB —
  the init SQL above never runs against it.
- Applying schema changes to production Aurora is **fully manual**: connect to Aurora
  and run the relevant SQL/DDL by hand (e.g. the ad-hoc
  `database/migrations/add_variantGroupID_column.sql` is an example of a one-off SQL
  patch kept as a file but applied manually). There is no automated migration runner,
  no Alembic/Flyway, and the backend does **not** create/alter tables on startup.

---

## 4. End-to-end manual checklist (to repeat for the new app)

> Everything below is run by hand, in order, from a dev machine with Docker + AWS CLI
> creds. Nothing is triggered by `git push`.

1. **(DB, if schema changed)** Edit `01-postgresql_data3.sql`; apply the same DDL to
   production Aurora **manually** by connecting and running the SQL.
2. **Backend image:** `bash scripts/docker-build.sh`.
3. **Backend push:** `bash scripts/docker-push.sh` → lands in ECR `be-drinkx`.
4. **Backend release:** **manually** force a new ECS deployment to pull the image.
5. **Frontend:** either
   - Mode A: `bash scripts/fe-build.sh`, then **manually** push `fe-drinkx` to ECR and
     redeploy its ECS service; **or**
   - Mode B: `bash scripts/fe-deploy.sh -c <cf-id> -s <bucket> -n <domain>/ -t <template>`
     to push static files to S3 + invalidate CloudFront.
6. **Mobile:** nothing to deploy for web changes (apps load live site); native store
   releases are a separate manual process.

---

## 5. (a) Deployed vs (b) Local — config that flips the flow

| Concern | (a) Deployed / production | (b) Local |
|---------|---------------------------|-----------|
| Build/push trigger | manual scripts → ECR | `docker compose up -d --build` (no registry) |
| Backend runtime | ECS task (Gunicorn/gevent) behind ALB, IAM role for S3 | `flask` container from compose, port `127.0.0.1:5000` |
| Frontend runtime | ECS `runner` (`next start`) **or** static S3+CloudFront | `frontend` container `target: dev` (`next dev`), port `8080→3000` |
| Frontend API target | `NEXT_PUBLIC_API_URL=https://api.drink-x.com`; `API_INTERNAL_URL` empty | `NEXT_PUBLIC_API_URL=http://localhost:5000` (or LAN IP for devices); `API_INTERNAL_URL=http://backend:5000` |
| Base URL | `https://drink-x.com` (apex 308→`www`) | `http://localhost:8080` |
| Database | AWS Aurora Postgres (`POSTGRES_HOST`=Aurora endpoint); schema applied **manually** | `db` compose service (`postgres:15-alpine`); schema **auto-loaded on first boot** from `docker-entrypoint-initdb.d` |
| Secrets (Stripe/AWS/Mail) | live keys in `backend/.env` / prod frontend env | test keys; `.env.production` lines commented out before local launch |
| AWS creds for S3 uploads | ECS task IAM role | `AWS_ACCESS_KEY_ID`/`SECRET` in `backend/.env` |


# E - AWS Account discovery
below is a reproduction of what i get when i run various queries in my AWS CloudShell

-------


~ $ aws sts get-caller-identity
{
    "UserId": "AIDA4MTWKTTRM4QWN2FLE",
    "Account": "851725425890",
    "Arn": "arn:aws:iam::851725425890:user/DeploymentUser"
}
~ $ aws configure get region
~ $ aws configure get region
~ $ aws configure set region ap-southeast-1
~ $ aws configure get region
ap-southeast-1
~ $ aws rds describe-db-clusters
{
    "DBClusters": []
}
~ $ aws rds describe-db-instances
{
    "DBInstances": [
        {
            "DBInstanceIdentifier": "drinkxprod",
            "DBInstanceClass": "db.t4g.small",
            "Engine": "postgres",
            "DBInstanceStatus": "available",
            "MasterUsername": "drinkxdbmaster",
            "DBName": "postgres",
            "Endpoint": {
                "Address": "drinkxprod.cxoa4asusd0j.ap-southeast-1.rds.amazonaws.com",
                "Port": 5432,
                "HostedZoneId": "Z2G0U3KFCY8NZ5"
            },
            "AllocatedStorage": 20,
            "InstanceCreateTime": "2024-10-19T09:54:55.909000+00:00",
            "PreferredBackupWindow": "03:00-06:00",
            "BackupRetentionPeriod": 1,
            "DBSecurityGroups": [],
            "VpcSecurityGroups": [
                {
                    "VpcSecurityGroupId": "sg-05dba46a6d301d9b6",
                    "Status": "active"
                }
            ],
            "DBParameterGroups": [
                {
                    "DBParameterGroupName": "drinkxprod-20241008004623480800000001",
                    "ParameterApplyStatus": "in-sync"
                }
            ],
            "AvailabilityZone": "ap-southeast-1b",
            "DBSubnetGroup": {
                "DBSubnetGroupName": "tf-drinkx-prod-vpc",
                "DBSubnetGroupDescription": "Database subnet group for tf-drinkx-prod-vpc",
                "VpcId": "vpc-0d2c20f48f851c971",
                "SubnetGroupStatus": "Complete",
                "Subnets": [
                    {
                        "SubnetIdentifier": "subnet-05410ca0021409199",
                        "SubnetAvailabilityZone": {
                            "Name": "ap-southeast-1a"
                        },
                        "SubnetOutpost": {},
                        "SubnetStatus": "Active"
                    },
                    {
                        "SubnetIdentifier": "subnet-09b30ccea6e4f5fa7",
                        "SubnetAvailabilityZone": {
                            "Name": "ap-southeast-1c"
                        },
                        "SubnetOutpost": {},
                        "SubnetStatus": "Active"
                    },
                    {
                        "SubnetIdentifier": "subnet-0e7bc6146e247ba3b",
                        "SubnetAvailabilityZone": {
                            "Name": "ap-southeast-1b"
                        },
                        "SubnetOutpost": {},
                        "SubnetStatus": "Active"
                    }
                ]
            },
            "PreferredMaintenanceWindow": "mon:00:00-mon:03:00",
            "UpgradeRolloutOrder": "second",
            "PendingModifiedValues": {},
            "LatestRestorableTime": "2026-06-27T16:52:23+00:00",
            "MultiAZ": false,
            "EngineVersion": "15.17",
            "AutoMinorVersionUpgrade": true,
            "ReadReplicaDBInstanceIdentifiers": [],
            "LicenseModel": "postgresql-license",
            "OptionGroupMemberships": [
            "OptionGroupMemberships": [
                {
                    "OptionGroupName": "default:postgres-15",
                    "Status": "in-sync"
                }
            ],
            "PubliclyAccessible": false,
            "StorageType": "gp2",
            "DbInstancePort": 0,
            "StorageEncrypted": true,
            "KmsKeyId": "arn:aws:kms:ap-southeast-1:851725425890:key/331940ce-2900-4442-8420-8bd6ac0282c8",
            "DbiResourceId": "db-FRQJ64T6U6Q3Q6LLFYPGVELYAY",
            "CACertificateIdentifier": "rds-ca-rsa2048-g1",
            "DomainMemberships": [],
            "CopyTagsToSnapshot": false,
            "MonitoringInterval": 0,
            "DBInstanceArn": "arn:aws:rds:ap-southeast-1:851725425890:db:drinkxprod",
            "IAMDatabaseAuthenticationEnabled": false,
            "DatabaseInsightsMode": "standard",
            "PerformanceInsightsEnabled": true,
            "PerformanceInsightsKMSKeyId": "arn:aws:kms:ap-southeast-1:851725425890:key/331940ce-2900-4442-8420-8bd6ac0282c8",
            "PerformanceInsightsRetentionPeriod": 7,
            "DeletionProtection": false,
            "AssociatedRoles": [],
            "MaxAllocatedStorage": 50,
            "TagList": [
                {
                    "Key": "project",
                    "Value": "drinkx"
                },
                {
                    "Key": "terraform",
                    "Value": "y"
                },
                {
                    "Key": "env",
                    "Value": "prod"
                },
                {
                    "Key": "Name",
                    "Value": "tf-drinkx-prod-rds"
                }
            ],
            "CustomerOwnedIpEnabled": false,
            "NetworkType": "IPV4",
            "ActivityStreamStatus": "stopped",
            "BackupTarget": "region",
            "CertificateDetails": {
                "CAIdentifier": "rds-ca-rsa2048-g1",
                "ValidTill": "2027-04-27T02:05:13+00:00"
            },
            "DedicatedLogVolume": false,
            "IsStorageConfigUpgradeAvailable": false,
            "EngineLifecycleSupport": "open-source-rds-extended-support"
        }
    ]
}
(END)


~ $ aws s3api get-bucket-policy --bucket tf-drinkx-prod-fe-images
{
    "Policy": "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Sid\":\"denyOutdatedTLS\",\"Effect\":\"Deny\",\"Principal\":\"*\",\"Action\":\"s3:*\",\"Resource\":[\"arn:aws:s3:::tf-drinkx-prod-fe-images/*\",\"arn:aws:s3:::tf-drinkx-prod-fe-images\"],\"Condition\":{\"NumericLessThan\":{\"s3:TlsVersion\":\"1.2\"}}},{\"Sid\":\"denyInsecureTransport\",\"Effect\":\"Deny\",\"Principal\":\"*\",\"Action\":\"s3:*\",\"Resource\":[\"arn:aws:s3:::tf-drinkx-prod-fe-images/*\",\"arn:aws:s3:::tf-drinkx-prod-fe-images\"],\"Condition\":{\"Bool\":{\"aws:SecureTransport\":\"false\"}}},{\"Sid\":\"AllowCloudFrontServicePrincipalReadOnly\",\"Effect\":\"Allow\",\"Principal\":{\"Service\":\"cloudfront.amazonaws.com\"},\"Action\":\"s3:GetObject\",\"Resource\":\"arn:aws:s3:::tf-drinkx-prod-fe-images/*\",\"Condition\":{\"ArnLike\":{\"aws:SourceArn\":\"arn:aws:cloudfront::851725425890:distribution/*\"}}},{\"Sid\":\"Statement1\",\"Effect\":\"Allow\",\"Principal\":\"*\",\"Action\":\"s3:GetObject\",\"Resource\":\"arn:aws:s3:::tf-drinkx-prod-fe-images/*\"}]}"
}
~ $ aws s3api get-public-access-block tf-drinkx-prod-fe-images

aws: [ERROR]: An error occurred (ParamValidation): the following arguments are required: --bucket

usage: aws [options] <command> <subcommand> [<subcommand> ...] [parameters]
To see help text, you can run:

  aws help
  aws <command> help
  aws <command> <subcommand> help

~ $ aws s3api get-public-access-block --bucket tf-drinkx-prod-fe-images
{
    "PublicAccessBlockConfiguration": {
        "BlockPublicAcls": false,
        "IgnorePublicAcls": false,
        "BlockPublicPolicy": false,
        "RestrictPublicBuckets": false
    }
}
~ $ aws cloudfront list-distributions
{
    "DistributionList": {
        "Items": [
            {
                "Id": "E3REJFTEGBCIZA",
                "ARN": "arn:aws:cloudfront::851725425890:distribution/E3REJFTEGBCIZA",
                "ETag": "EJEBDRCKFQKLN",
                "Status": "Deployed",
                "LastModifiedTime": "2026-06-16T17:22:53.776000+00:00",
                "DomainName": "ddkwf4u6288qx.cloudfront.net",
                "Aliases": {
                    "Quantity": 2,
                    "Items": [
                        "www.drink-x.com",
                        "drink-x.com"
                    ]
                },
                "Origins": {
                    "Quantity": 1,
                    "Items": [
                        {
                            "Id": "tf-drinkx-prod-s3-oac-www",
                            "DomainName": "tf-drinkx-prod-fe-static.s3.ap-southeast-1.amazonaws.com" [LEGACY for the frontend: Vercel now serves www.drink-x.com. This CloudFront→S3 distribution is stale as the frontend host. (The separate tf-drinkx-prod-fe-images bucket is still used for images.)],
                            "OriginPath": "/drink-x.com",
                            "CustomHeaders": {
                                "Quantity": 0
                            },
                            "S3OriginConfig": {
                                "OriginAccessIdentity": "",
                                "OriginReadTimeout": 30
                            },
                            "ConnectionAttempts": 3,
                            "ConnectionTimeout": 10,
                            "OriginShield": {
                                "Enabled": true,
                                "OriginShieldRegion": "ap-southeast-1"
                            },
                            "OriginAccessControlId": "EI992ZVSM33SG"
                        }
                    ]
                },
                "OriginGroups": {
                    "Quantity": 0
                },
                "DefaultCacheBehavior": {
                    "TargetOriginId": "tf-drinkx-prod-s3-oac-www",
                    "TrustedSigners": {
                        "Enabled": false,
                        "Quantity": 0
                    },
                    "TrustedKeyGroups": {
                        "Enabled": false,
                        "Quantity": 0
                    },
                    "ViewerProtocolPolicy": "redirect-to-https",
                    "AllowedMethods": {
                        "Quantity": 3,
                        "Items": [
                            "HEAD",
                            "GET",
                            "OPTIONS"
                        ],
                        "CachedMethods": {
                            "Quantity": 2,
                            "Items": [
                                "HEAD",
                                "GET"
                            ]
                        }
                    },
                    "SmoothStreaming": false,
                    "Compress": true,
                    "LambdaFunctionAssociations": {
                        "Quantity": 0
                    },
                    "FunctionAssociations": {
                        "Quantity": 1,
                        "Items": [
                            {
                                "FunctionARN": "arn:aws:cloudfront::851725425890:function/tf-drinkx-prod-fn-rewrite-viewer-request",
                                "EventType": "viewer-request"
                            }
                        ]
                    },
                    "FieldLevelEncryptionId": "",
                    "CachePolicyId": "658327ea-f89d-4fab-a63d-7e88639e58f6",
                    "OriginRequestPolicyId": "88a5eaf4-2fd4-4709-b370-b4c650ea3fcf",
                    "ResponseHeadersPolicyId": "eaab4381-ed33-4a86-88ca-d9558dc6cd63",
                    "GrpcConfig": {
                        "Enabled": false
                    }
                },
                "CacheBehaviors": {
                    "Quantity": 0
                },
                "CustomErrorResponses": {
                    "Quantity": 3,
                    "Items": [
                        {
                            "ErrorCode": 403,
                            "ResponsePagePath": "/404.html",
                            "ResponseCode": "404",
                            "ErrorCachingMinTTL": 2
                        },
                        {
                            "ErrorCode": 404,
                            "ResponsePagePath": "/404.html",
                            "ResponseCode": "404",
                            "ErrorCachingMinTTL": 2
                        },
                        {
                            "ErrorCode": 500,
                            "ResponsePagePath": "/404.html",
                            "ResponseCode": "404",
                            "ErrorCachingMinTTL": 2
                        }
                    ]
                },
                "Comment": "(tf-drinkx-prod) CloudFront distribution for drink-x.com",
                "PriceClass": "PriceClass_All",
                "Enabled": true,
                "ViewerCertificate": {
                    "CloudFrontDefaultCertificate": false,
                    "ACMCertificateArn": "arn:aws:acm:us-east-1:851725425890:certificate/84a82584-2ba4-4679-a4b3-60a1e6cc1639",
                    "SSLSupportMethod": "sni-only",
                    "MinimumProtocolVersion": "TLSv1.1_2016",
                    "Certificate": "arn:aws:acm:us-east-1:851725425890:certificate/84a82584-2ba4-4679-a4b3-60a1e6cc1639",
                    "CertificateSource": "acm"
                },
                "Restrictions": {
                    "GeoRestriction": {
                        "RestrictionType": "none",
                        "Quantity": 0
                    }
                },
                "WebACLId": "",
                "HttpVersion": "HTTP2and3",
                "IsIPV6Enabled": true,
                "AliasICPRecordals": [
                    {
                        "CNAME": "www.drink-x.com",
                        "ICPRecordalStatus": "APPROVED"
                    },
                    {
                        "CNAME": "drink-x.com",
                        "ICPRecordalStatus": "APPROVED"
                    }
                ],
                "Staging": false,
                "ConnectionMode": "direct"
            }
        ]
    }
}
(END)

~ $ aws ecs list-clusters
{
    "clusterArns": [
        "arn:aws:ecs:ap-southeast-1:851725425890:cluster/tf-drinkx-prod-ecs-cluster",
        "arn:aws:ecs:ap-southeast-1:851725425890:cluster/drinkx-menu-embed"
    ]
}
~ $ aws ecs list-services --cluster 

aws: [ERROR]: An error occurred (ParamValidation): argument --cluster: expected one argument

usage: aws [options] <command> <subcommand> [<subcommand> ...] [parameters]
To see help text, you can run:

  aws help
  aws <command> help
  aws <command> <subcommand> help

~ $ Cluster
-bash: Cluster: command not found
~ $ 
~ $ Services
-bash: Services: command not found
~ $ 
~ $ Tasks
-bash: Tasks: command not found
~ $ 
~ $ Container instances
-bash: Container: command not found
~ $ 
~ $ CloudWatch monitoring
-bash: CloudWatch: command not found
~ $ 
~ $ Capacity provider strategy
-bash: Capacity: command not found
~ $ 
~ $ aws ecs list-services --cluster tf-drinkx-prod-ecs-cluster
{
    "serviceArns": [
        "arn:aws:ecs:ap-southeast-1:851725425890:service/tf-drinkx-prod-ecs-cluster/tf-drinkx-prod-ecs-svc1"
    ]
}
~ $ aws ecr describe-repositories

{
    "repositories": [
        {
            "repositoryArn": "arn:aws:ecr:ap-southeast-1:851725425890:repository/menu-embedding",
            "registryId": "851725425890",
            "repositoryName": "menu-embedding",
            "repositoryUri": "851725425890.dkr.ecr.ap-southeast-1.amazonaws.com/menu-embedding",
            "createdAt": "2025-09-21T07:49:22.816000+00:00",
            "imageTagMutability": "MUTABLE",
            "imageScanningConfiguration": {
                "scanOnPush": false
            },
            "encryptionConfiguration": {
                "encryptionType": "AES256"
            }
        },
        {
            "repositoryArn": "arn:aws:ecr:ap-southeast-1:851725425890:repository/be-drinkx-nextjs",
            "registryId": "851725425890",
            "repositoryName": "be-drinkx-nextjs",
            "repositoryUri": "851725425890.dkr.ecr.ap-southeast-1.amazonaws.com/be-drinkx-nextjs",
            "createdAt": "2025-09-21T07:59:59.118000+00:00",
            "imageTagMutability": "MUTABLE",
            "imageScanningConfiguration": {
                "scanOnPush": false
            },
            "encryptionConfiguration": {
                "encryptionType": "AES256"
            }
        },
        {
            "repositoryArn": "arn:aws:ecr:ap-southeast-1:851725425890:repository/fe-drinkx",
            "registryId": "851725425890",
            "repositoryName": "fe-drinkx",
            "repositoryUri": "851725425890.dkr.ecr.ap-southeast-1.amazonaws.com/fe-drinkx",
            "createdAt": "2024-10-07T14:56:07.636000+00:00",
            "imageTagMutability": "MUTABLE",
            "imageScanningConfiguration": {
                "scanOnPush": false
            },
            "encryptionConfiguration": {
                "encryptionType": "AES256"
            }
        },
        {
            "repositoryArn": "arn:aws:ecr:ap-southeast-1:851725425890:repository/be-drinkx",
            "registryId": "851725425890",
            "repositoryName": "be-drinkx",
            "repositoryUri": "851725425890.dkr.ecr.ap-southeast-1.amazonaws.com/be-drinkx",
            "createdAt": "2024-10-07T14:56:07.663000+00:00",
            "imageTagMutability": "MUTABLE",
            "imageScanningConfiguration": {
                "scanOnPush": false
            },
            "encryptionConfiguration": {
                "encryptionType": "AES256"
            }
        },
        {
            "repositoryArn": "arn:aws:ecr:ap-southeast-1:851725425890:repository/fe-drinkx-nextjs",
            "registryId": "851725425890",
            "repositoryName": "fe-drinkx-nextjs",
            "repositoryUri": "851725425890.dkr.ecr.ap-southeast-1.amazonaws.com/fe-drinkx-nextjs",
            "createdAt": "2025-09-21T08:00:10.053000+00:00",
            "imageTagMutability": "MUTABLE",
            "imageScanningConfiguration": {
                "scanOnPush": false
            },
            "encryptionConfiguration": {
                "encryptionType": "AES256"
            }
        }
    ]
}
(END)

~ $ aws ec2 describe-instances --filters "Name=tf-drinkx-prod-ec2-common,Values=running"

aws: [ERROR]: An error occurred (InvalidParameterValue) when calling the DescribeInstances operation: The filter 'tf-drinkx-prod-ec2-common' is invalid
~ $ aws ec2 describe-instances --filters "Name=instance-state-name,Values=running"
{
    "Reservations": [
        {
            "ReservationId": "r-06647ced96f36f14b",
            "OwnerId": "851725425890",
            "Groups": [],
            "Instances": [
                {
                    "Architecture": "x86_64",
                    "BlockDeviceMappings": [
                        {
                            "DeviceName": "/dev/xvda",
                            "Ebs": {
                                "AttachTime": "2024-10-19T07:04:58+00:00",
                                "DeleteOnTermination": true,
                                "Status": "attached",
                                "VolumeId": "vol-030d0c1b0c4094d4f",
                                "EbsCardIndex": 0
                            }
                        },
                        {
                            "DeviceName": "/dev/xvdf",
                            "Ebs": {
                                "AttachTime": "2024-10-19T07:05:20+00:00",
                                "DeleteOnTermination": false,
                                "Status": "attached",
                                "VolumeId": "vol-0cc2b3a3d14b65d4e",
                                "EbsCardIndex": 0
                            }
                        }
                    ],
                    "ClientToken": "terraform-20241019070452731700000006",
                    "EbsOptimized": false,
                    "EnaSupport": true,
                    "Hypervisor": "xen",
                    "IamInstanceProfile": {
                        "Arn": "arn:aws:iam::851725425890:instance-profile/tf-drinkx-prod-ec2-common-20241019070450756300000003",
                        "Id": "AIPA4MTWKTTRFK5I7EIY5"
                    },
                    "NetworkInterfaces": [
                        {
                            "Association": {
                                "IpOwnerId": "amazon",
                                "PublicDnsName": "ec2-47-129-217-130.ap-southeast-1.compute.amazonaws.com",
                                "PublicIp": "47.129.217.130"
                            },
                            "Attachment": {
                                "AttachTime": "2024-10-19T07:04:58+00:00",
                                "AttachmentId": "eni-attach-0121ea1dfc7ec5346",
                                "DeleteOnTermination": true,
                                "DeviceIndex": 0,
                                "Status": "attached",
                                "NetworkCardIndex": 0
                            },
                            "Description": "",
                            "Groups": [
                                {
                                    "GroupId": "sg-00807738973ecf956",
                                    "GroupName": "tf-drinkx-prod-ec2-sg-apps-20241019070447345900000001"
                                },
                                {
                                    "GroupId": "sg-006f85094dd8675f0",
                                    "GroupName": "tf-drinkx-prod-ec2-sg-common-20241019065251870700000003"
                                }
                            ],
                            "Ipv6Addresses": [],
                            "MacAddress": "06:79:c7:29:7f:55",
                            "NetworkInterfaceId": "eni-0593fc8cd48b8f822",
                            "OwnerId": "851725425890",
                            "PrivateDnsName": "ip-10-87-10-127.ap-southeast-1.compute.internal",
                            "PrivateIpAddress": "10.87.10.127",
                            "PrivateIpAddresses": [
                                {
                                    "Association": {
                                        "IpOwnerId": "amazon",
                                        "PublicDnsName": "ec2-47-129-217-130.ap-southeast-1.compute.amazonaws.com",
                                        "PublicIp": "47.129.217.130"
                                    },
                                    "Primary": true,
                                    "PrivateDnsName": "ip-10-87-10-127.ap-southeast-1.compute.internal",
                                    "PrivateIpAddress": "10.87.10.127"
                                }
                            ],
                            "SourceDestCheck": true,
                            "Status": "in-use",
                            "SubnetId": "subnet-0abc2802a7aee05a5",
                            "VpcId": "vpc-0d2c20f48f851c971",
                            "InterfaceType": "interface",
                            "Operator": {
                                "Managed": false
                            }
                        }
                    ],
                    "RootDeviceName": "/dev/xvda",
                    "RootDeviceType": "ebs",
                    "SecurityGroups": [
                        {
                            "GroupId": "sg-00807738973ecf956",
                            "GroupName": "tf-drinkx-prod-ec2-sg-apps-20241019070447345900000001"
                        },
                        {
                            "GroupId": "sg-006f85094dd8675f0",
                            "GroupName": "tf-drinkx-prod-ec2-sg-common-20241019065251870700000003"
                        }
                    ],
                    "SourceDestCheck": true,
                    "Tags": [
                        {
                            "Key": "Name",
                            "Value": "tf-drinkx-prod-ec2-common"
                        },
                        {
                            "Key": "env",
                            "Value": "prod"
                        },
                        {
                            "Key": "terraform",
                            "Value": "y"
                        },
                        {
                            "Key": "project",
                            "Value": "drinkx"
                        }
                    ],
                    "VirtualizationType": "hvm",
                    "CpuOptions": {
                        "CoreCount": 1,
                        "ThreadsPerCore": 2
                    },
                    "CapacityReservationSpecification": {
                        "CapacityReservationPreference": "open"
                    },
                    "HibernationOptions": {
                        "Configured": false
                    },
                    "MetadataOptions": {
                        "State": "applied",
                        "HttpTokens": "required",
                        "HttpPutResponseHopLimit": 2,
                        "HttpEndpoint": "enabled",
                        "HttpProtocolIpv6": "disabled",
                        "InstanceMetadataTags": "enabled"
                    },
                    "EnclaveOptions": {
                        "Enabled": false
                    },
                    "BootMode": "uefi-preferred",
                    "PlatformDetails": "Linux/UNIX",
                    "UsageOperation": "RunInstances",
                    "UsageOperationUpdateTime": "2024-10-19T07:04:58+00:00",
                    "PrivateDnsNameOptions": {
                        "HostnameType": "ip-name",
                        "EnableResourceNameDnsARecord": false,
                        "EnableResourceNameDnsAAAARecord": false
                    },
                    "MaintenanceOptions": {
                        "AutoRecovery": "default",
                        "RebootMigration": "default"
                    },
                    "CurrentInstanceBootMode": "uefi",
                    "NetworkPerformanceOptions": {
                        "BandwidthWeighting": "default"
                    },
                    "Operator": {
                        "Managed": false,
                        "HiddenByDefault": false
                    },
                    "InstanceId": "i-006f461be066cc1b4",
                    "ImageId": "ami-04b6019d38ea93034",
                    "State": {
                        "Code": 16,
                        "Name": "running"
                    },
                    "PrivateDnsName": "ip-10-87-10-127.ap-southeast-1.compute.internal",
                    "PublicDnsName": "ec2-47-129-217-130.ap-southeast-1.compute.amazonaws.com",
                    "StateTransitionReason": "",
                    "KeyName": "drinkxdev2",
                    "AmiLaunchIndex": 0,
                    "ProductCodes": [],
                    "InstanceType": "t3a.micro",
                    "LaunchTime": "2026-06-16T17:25:02+00:00",
                    "Placement": {
                        "AvailabilityZoneId": "apse1-az2",
                        "GroupName": "",
                        "Tenancy": "default",
                        "AvailabilityZone": "ap-southeast-1a"
                    },
                    "Monitoring": {
                        "State": "disabled"
                    },
                    "SubnetId": "subnet-0abc2802a7aee05a5",
                    "VpcId": "vpc-0d2c20f48f851c971",
                    "PrivateIpAddress": "10.87.10.127",
                    "PublicIpAddress": "47.129.217.130"
                }
            ]
        }
    ]
}
(END)

~ $ aws ec2 describe-vpcs
{
    "Vpcs": [
        {
            "OwnerId": "851725425890",
            "InstanceTenancy": "default",
            "CidrBlockAssociationSet": [
                {
                    "AssociationId": "vpc-cidr-assoc-050f0ac1e17cca8d7",
                    "CidrBlock": "172.31.0.0/16",
                    "CidrBlockState": {
                        "State": "associated"
                    }
                }
            ],
            "IsDefault": true,
            "Tags": [
                {
                    "Key": "Name",
                    "Value": "Default vpc for region ap-southeast-1"
                },
                {
                    "Key": "terraform",
                    "Value": "y"
                },
                {
                    "Key": "env",
                    "Value": "prod"
                },
                {
                    "Key": "project",
                    "Value": "drinkx"
                }
            ],
            "BlockPublicAccessStates": {
                "InternetGatewayBlockMode": "off"
            },
            "VpcId": "vpc-06560e68f48be2040",
            "State": "available",
            "CidrBlock": "172.31.0.0/16",
            "DhcpOptionsId": "dopt-0c8e1d573554ab53e"
        },
        {
            "OwnerId": "851725425890",
            "InstanceTenancy": "default",
            "CidrBlockAssociationSet": [
                {
                    "AssociationId": "vpc-cidr-assoc-062623c0caf9af942",
                    "CidrBlock": "10.87.0.0/16",
                    "CidrBlockState": {
                        "State": "associated"
                    }
                }
            ],
            "IsDefault": false,
            "Tags": [
                {
                    "Key": "terraform",
                    "Value": "y"
                },
                {
                    "Key": "env",
                    "Value": "prod"
                },
                {
                    "Key": "project",
                    "Value": "drinkx"
                },
                {
                    "Key": "Name",
                    "Value": "tf-drinkx-prod-vpc"
                }
            ],
            "BlockPublicAccessStates": {
                "InternetGatewayBlockMode": "off"
            },
            "VpcId": "vpc-0d2c20f48f851c971",
            "State": "available",
            "CidrBlock": "10.87.0.0/16",
            "DhcpOptionsId": "dopt-0c8e1d573554ab53e"
        }
    ]
}
(END)

~ $ aws ec2 describe-security-groups
{
    "SecurityGroups": [
        {
            "GroupId": "sg-00807738973ecf956",
            "IpPermissionsEgress": [
                {
                    "IpProtocol": "tcp",
                    "FromPort": 5432,
                    "ToPort": 5432,
                    "UserIdGroupPairs": [
                        {
                            "Description": "Egress Rule",
                            "UserId": "851725425890",
                            "GroupId": "sg-05dba46a6d301d9b6"
                        }
                    ],
                    "IpRanges": [],
                    "Ipv6Ranges": [],
                    "PrefixListIds": []
                }
            ],
            "Tags": [
                {
                    "Key": "project",
                    "Value": "drinkx"
                },
                {
                    "Key": "Name",
                    "Value": "tf-drinkx-prod-ec2-sg-apps"
                },
                {
                    "Key": "env",
                    "Value": "prod"
                },
                {
                    "Key": "terraform",
                    "Value": "y"
                }
            ],
            "VpcId": "vpc-0d2c20f48f851c971",
            "SecurityGroupArn": "arn:aws:ec2:ap-southeast-1:851725425890:security-group/sg-00807738973ecf956",
            "OwnerId": "851725425890",
            "GroupName": "tf-drinkx-prod-ec2-sg-apps-20241019070447345900000001",
            "Description": "Allows public to interact w resources that are attached with this sg over application ports",
            "IpPermissions": []
        },
        {
            "GroupId": "sg-05dba46a6d301d9b6",
            "IpPermissionsEgress": [
                {
                    "IpProtocol": "-1",
                    "UserIdGroupPairs": [],
                    "IpRanges": [
                        {
                            "Description": "All protocols",
                            "CidrIp": "0.0.0.0/0"
                        }
                    ],
                    "Ipv6Ranges": [
                        {
                            "Description": "All protocols",
                            "CidrIpv6": "::/0"
                        }
                    ],
                    "PrefixListIds": []
                }
            ],
            "Tags": [
                {
                    "Key": "project",
                    "Value": "drinkx"
                },
                {
                    "Key": "env",
                    "Value": "prod"
                },
                {
                    "Key": "terraform",
                    "Value": "y"
                },
                {
                    "Key": "Name",
                    "Value": "tf-drinkx-prod-rds-sg"
                }
            ],
            "VpcId": "vpc-0d2c20f48f851c971",
            "SecurityGroupArn": "arn:aws:ec2:ap-southeast-1:851725425890:security-group/sg-05dba46a6d301d9b6",
            "OwnerId": "851725425890",
            "GroupName": "tf-drinkx-prod-rds-sg-20241019071112635200000001",
            "Description": "Allows resources in private & public subnets interact w RDS",
            "IpPermissions": [
                {
                    "IpProtocol": "tcp",
                    "FromPort": 5432,
                    "ToPort": 5432,
                    "UserIdGroupPairs": [
                        {
                            "Description": "Ingress Rule",
                            "UserId": "851725425890",
                            "GroupId": "sg-00807738973ecf956"
                        }
                    ],
                    "IpRanges": [
                        {
                            "Description": "PostgreSQL",
                            "CidrIp": "10.87.0.0/24"
                        },
                        {
                            "Description": "PostgreSQL",
                            "CidrIp": "10.87.1.0/24"
                        },
                        {
                            "Description": "PostgreSQL",
                            "CidrIp": "10.87.10.0/24"
                        },
                        {
                            "Description": "PostgreSQL",
                            "CidrIp": "10.87.11.0/24"
                        },
                        {
                            "Description": "PostgreSQL",
                            "CidrIp": "10.87.12.0/24"
                        },
                        {
                            "Description": "PostgreSQL",
                            "CidrIp": "10.87.2.0/24"
                        }
                    ],
                    "Ipv6Ranges": [],
                    "PrefixListIds": []
                }
            ]
        },
        {
            "GroupId": "sg-006f85094dd8675f0",
            "IpPermissionsEgress": [
                {
                    "IpProtocol": "-1",
                    "UserIdGroupPairs": [],
                    "IpRanges": [
                        {
                            "Description": "All protocols",
                            "CidrIp": "0.0.0.0/0"
                        }
                    ],
                    "Ipv6Ranges": [
                        {
                            "Description": "All protocols",
                            "CidrIpv6": "::/0"
                        }
                    ],
                    "PrefixListIds": []
                }
            ],
            "Tags": [
                {
                    "Key": "project",
                    "Value": "drinkx"
                },
                {
                    "Key": "Name",
                    "Value": "tf-drinkx-prod-ec2-sg-common"
                },
                {
                    "Key": "env",
                    "Value": "prod"
                },
                {
                    "Key": "terraform",
                    "Value": "y"
                }
            ],
            "VpcId": "vpc-0d2c20f48f851c971",
            "SecurityGroupArn": "arn:aws:ec2:ap-southeast-1:851725425890:security-group/sg-006f85094dd8675f0",
            "OwnerId": "851725425890",
            "GroupName": "tf-drinkx-prod-ec2-sg-common-20241019065251870700000003",
            "Description": "Allows public to interact w resources that are attached with this sg over SSH and ICMP",
            "IpPermissions": [
                {
                    "IpProtocol": "tcp",
                    "FromPort": 22,
                    "ToPort": 22,
                    "UserIdGroupPairs": [],
                    "IpRanges": [
                        {
                            "Description": "SSH",
                            "CidrIp": "0.0.0.0/0"
                        }
                    ],
                    "Ipv6Ranges": [],
                    "PrefixListIds": []
                },
                {
                    "IpProtocol": "icmp",
                    "FromPort": -1,
                    "ToPort": -1,
                    "UserIdGroupPairs": [],
                    "IpRanges": [
                        {
                            "Description": "All IPV4 ICMP",
                            "CidrIp": "0.0.0.0/0"
                        }
                    ],
                    "Ipv6Ranges": [],
                    "PrefixListIds": []
                }
            ]
        },
        {
            "GroupId": "sg-07df054265d23dda7",
            "IpPermissionsEgress": [
                {
                    "IpProtocol": "-1",
                    "UserIdGroupPairs": [],
                    "IpRanges": [
                        {
                            "CidrIp": "0.0.0.0/0"
                        }
                    ],
                    "Ipv6Ranges": [],
                    "PrefixListIds": []
                }
            ],
            "VpcId": "vpc-06560e68f48be2040",
            "SecurityGroupArn": "arn:aws:ec2:ap-southeast-1:851725425890:security-group/sg-07df054265d23dda7",
            "OwnerId": "851725425890",
            "GroupName": "default",
            "Description": "default VPC security group",
            "IpPermissions": [
                {
                    "IpProtocol": "-1",
                    "UserIdGroupPairs": [
                        {
                            "UserId": "851725425890",
                            "GroupId": "sg-07df054265d23dda7"
                        }
                    ],
                    "IpRanges": [],
                    "Ipv6Ranges": [],
                    "PrefixListIds": []
                }
            ]
        },
        {
            "GroupId": "sg-0fabe1276eb31bebf",
            "IpPermissionsEgress": [
                {
                    "IpProtocol": "-1",
                    "UserIdGroupPairs": [],
                    "IpRanges": [
                        {
                            "CidrIp": "0.0.0.0/0"
                        }
                    ],
                    "Ipv6Ranges": [
                        {
                            "CidrIpv6": "::/0"
                        }
                    ],
                    "PrefixListIds": []
                }
            ],
            "Tags": [
                {
                    "Key": "Name",
                    "Value": "tf-drinkx-prod-ecs-svc1-sg"
                },
                {
                    "Key": "env",
                    "Value": "prod"
                },
                {
                    "Key": "project",
                    "Value": "drinkx"
                },
                {
                    "Key": "terraform",
                    "Value": "y"
                }
            ],
            "VpcId": "vpc-0d2c20f48f851c971",
            "SecurityGroupArn": "arn:aws:ec2:ap-southeast-1:851725425890:security-group/sg-0fabe1276eb31bebf",
            "OwnerId": "851725425890",
            "GroupName": "tf-drinkx-prod-ecs-svc1-sg-20241021092502361100000003",
            "Description": "Managed by Terraform",
            "IpPermissions": [
                {
                    "IpProtocol": "tcp",
                    "FromPort": 5000,
                    "ToPort": 5000,
                    "UserIdGroupPairs": [
                        {
                            "Description": "Service port",
                            "UserId": "851725425890",
                            "GroupId": "sg-0d624dda1e1f4c7d9"
                        }
                    ],
                    "IpRanges": [],
                    "Ipv6Ranges": [],
                    "PrefixListIds": []
                }
            ]
        },
        {
            "GroupId": "sg-0f120568266fcba4c",
            "IpPermissionsEgress": [
                {
                    "IpProtocol": "-1",
                    "UserIdGroupPairs": [],
                    "IpRanges": [
                        {
                            "CidrIp": "0.0.0.0/0"
                        }
                    ],
                    "Ipv6Ranges": [],
                    "PrefixListIds": []
                }
            ],
            "VpcId": "vpc-06560e68f48be2040",
            "SecurityGroupArn": "arn:aws:ec2:ap-southeast-1:851725425890:security-group/sg-0f120568266fcba4c",
            "OwnerId": "851725425890",
            "GroupName": "launch-wizard-1",
            "Description": "launch-wizard-1 created 2025-09-27T08:48:17.552Z",
            "IpPermissions": [
                {
                    "IpProtocol": "tcp",
                    "FromPort": 22,
                    "ToPort": 22,
                    "UserIdGroupPairs": [],
                    "IpRanges": [
                        {
                            "CidrIp": "0.0.0.0/0"
                        }
                    ],
                    "Ipv6Ranges": [],
                    "PrefixListIds": []
                }
            ]
        },
        {
            "GroupId": "sg-0d624dda1e1f4c7d9",
            "IpPermissionsEgress": [
                {
                    "IpProtocol": "-1",
                    "UserIdGroupPairs": [],
                    "IpRanges": [
                        {
                            "Description": "ALB outgoing requests only to internal VPC IPv4",
                            "CidrIp": "10.87.0.0/16"
                        }
                    ],
                    "Ipv6Ranges": [],
                    "PrefixListIds": []
                }
            ],
            "Tags": [
                {
                    "Key": "project",
                    "Value": "drinkx"
                },
                {
                    "Key": "terraform",
                    "Value": "y"
                },
                {
                    "Key": "Name",
                    "Value": "tf-drinkx-prod-alb"
                },
                {
                    "Key": "terraform-aws-modules",
                    "Value": "alb"
                },
                {
                    "Key": "env",
                    "Value": "prod"
                }
            ],
            "VpcId": "vpc-0d2c20f48f851c971",
            "SecurityGroupArn": "arn:aws:ec2:ap-southeast-1:851725425890:security-group/sg-0d624dda1e1f4c7d9",
            "OwnerId": "851725425890",
            "GroupName": "tf-drinkx-prod-alb-sg-20241020194339519700000001",
            "Description": "Security group for tf-drinkx-prod-alb-sg application load balancer",
            "IpPermissions": [
                {
                    "IpProtocol": "tcp",
                    "FromPort": 80,
                    "ToPort": 80,
                    "UserIdGroupPairs": [],
                    "IpRanges": [
                        {
                            "Description": "HTTP web traffic",
                            "CidrIp": "0.0.0.0/0"
                        }
                    ],
                    "Ipv6Ranges": [
                        {
                            "Description": "HTTP web traffic",
                            "CidrIpv6": "::/0"
                        }
                    ],
                    "PrefixListIds": []
                },
                {
                    "IpProtocol": "tcp",
                    "FromPort": 443,
                    "ToPort": 443,
                    "UserIdGroupPairs": [],
                    "IpRanges": [
                        {
                            "Description": "HTTPS web traffic",
                            "CidrIp": "0.0.0.0/0"
                        }
                    ],
                    "Ipv6Ranges": [
                        {
                            "Description": "HTTPS web traffic",
                            "CidrIpv6": "::/0"
                        }
                    ],
                    "PrefixListIds": []
                }
            ]
        },
        {
            "GroupId": "sg-03a5568f44f36549e",
            "IpPermissionsEgress": [],
            "Tags": [
                {
                    "Key": "project",
                    "Value": "drinkx"
                },
                {
                    "Key": "Name",
                    "Value": "tf-drinkx-prod-vpc-sg-tls"
                },
                {
                    "Key": "terraform",
                    "Value": "y"
                },
                {
                    "Key": "env",
                    "Value": "prod"
                }
            ],
            "VpcId": "vpc-0d2c20f48f851c971",
            "SecurityGroupArn": "arn:aws:ec2:ap-southeast-1:851725425890:security-group/sg-03a5568f44f36549e",
            "OwnerId": "851725425890",
            "GroupName": "tf-drinkx-prod-vpc-sg-tls20241008002955400000000004",
            "Description": "Allow TLS inbound traffic",
            "IpPermissions": [
                {
                    "IpProtocol": "tcp",
                    "FromPort": 443,
                    "ToPort": 443,
                    "UserIdGroupPairs": [],
                    "IpRanges": [
                        {
                            "Description": "TLS from VPC",
                            "CidrIp": "10.87.0.0/16"
                        }
                    ],
                    "Ipv6Ranges": [],
                    "PrefixListIds": []
                }
            ]
        },
        {
            "GroupId": "sg-0c1a94ffcbeb08492",
            "IpPermissionsEgress": [
                {
                    "IpProtocol": "-1",
                    "UserIdGroupPairs": [],
                    "IpRanges": [
                        {
                            "CidrIp": "0.0.0.0/0"
                        }
                    ],
                    "Ipv6Ranges": [
                        {
                            "CidrIpv6": "::/0"
                        }
                    ],
                    "PrefixListIds": []
                }
            ],
            "Tags": [
                {
                    "Key": "Name",
                    "Value": "tf-drinkx-prod-vpc-sg-default"
                },
                {
                    "Key": "env",
                    "Value": "prod"
                },
                {
                    "Key": "terraform",
                    "Value": "y"
                },
                {
                    "Key": "Description",
                    "Value": "Allow all resources within this VPC talk to each other, and can reach Internet"
                },
                {
                    "Key": "project",
                    "Value": "drinkx"
                }
            ],
            "VpcId": "vpc-0d2c20f48f851c971",
            "SecurityGroupArn": "arn:aws:ec2:ap-southeast-1:851725425890:security-group/sg-0c1a94ffcbeb08492",
            "OwnerId": "851725425890",
            "GroupName": "default",
            "Description": "default VPC security group",
            "IpPermissions": [
                {
                    "IpProtocol": "-1",
                    "UserIdGroupPairs": [
                        {
                            "UserId": "851725425890",
                            "GroupId": "sg-0c1a94ffcbeb08492"
                        }
                    ],
                    "IpRanges": [],
                    "Ipv6Ranges": [],
                    "PrefixListIds": []
                }
            ]
        }
    ]
}
(END)

~ $ aws secretsmanager list-secrets
{
    "SecretList": []
}
~ $ aws ssm describe-parameters
{
    "Parameters": []
}
~ $ 



# F - Email decision input [RESOLVED: verify 88bamboo.co as a domain identity; sender events@88bamboo.co.]

From A7 we know whether Drink-X sends email and uses AWS SES. Take note the sending domain and region; the events app can reuse the same verified domain identity (or a subdomain), which saves the sandbox-approval step.
OR alternatively the events app can instead take note of the pattern and teach me how to set it up for a subdomain under 88bamboo.co if not another domain


# EVENTS-APP ENVIRONMENT ADDITIONS (local + deployed) — NOT in Drink-X

These env vars/behaviours are NEW to the events app. Mirror Drink-X's
one-.env-with-commented-blocks toggle for them too.

### Backend (events-api/.env)
| Var | Local (development) | Deployed (production) |
|-----|--------------------|-----------------------|
| PURPOSE | development | production |
| POSTGRES_HOST | db (compose service) | <new events RDS endpoint> |
| STRIPE_SECRET_KEY | sk_test_… | sk_live_… |
| STRIPE_WEBHOOK_SECRET | whsec_… from `stripe listen` (Stripe CLI) | whsec_… from the prod webhook endpoint |
| SHOPIFY_SHARED_SECRET | (set, but HMAC check is bypassed locally) | <shared secret from the custom app> |
| SHOPIFY_PROXY_VERIFY | false (bypass HMAC locally) | true (enforce HMAC) |
| SES_FROM / AWS_REGION | local mailer or MailHog | events@88bamboo.co / ap-southeast-1 |

### Frontend (events-web)
| Var | Local | Deployed |
|-----|-------|----------|
| NEXT_PUBLIC_API_URL | http://localhost:5000 | https://events-api.88bamboo.co |
| API_INTERNAL_URL | http://backend:5000 | (empty → uses public URL) |
| NEXT_PUBLIC_BASE_URL | http://localhost:8080 | https://www.88bamboo.co |
| (next.config) basePath | /a/events | /a/events |
| (next.config) images.remotePatterns | add events image bucket / CloudFront host | same |

### Local-only notes
- App Proxy does NOT exist locally → browse events-web directly at
  http://localhost:8080/a/events. Enforce HMAC only when SHOPIFY_PROXY_VERIFY=true.
- Stripe webhooks locally: run `stripe listen --forward-to localhost:5000/<webhook path>`
  and use the secret it prints as STRIPE_WEBHOOK_SECRET.
- Backend is PUBLIC in prod (events-api.88bamboo.co), mirroring api.drink-x.com —
  not private. Local SSR still uses http://backend:5000 via API_INTERNAL_URL.

# FRONTEND HOSTING — VERCEL (production) — NOT AWS

- Platform: Vercel. Repo: github.com/han88bamboo/drinkx-monorepo. Root dir: frontend/.
- Framework: Next.js (defaults; no overridden build/install/output commands).
- Deploy: git integration — feature branch → Preview deployment; merge to main → Production.
- Domains: www.drink-x.com (Production, CNAME→Vercel); drink-x.com (307→www); drinkx-next.vercel.app (Vercel-generated). DNS for drink-x.com is in AWS Route 53.
- Env vars: set in the Vercel dashboard (All Environments) — NEXT_PUBLIC_* (API URL, BASE URL, Stripe publishable, Maps/GAuth/Apple), API_INTERNAL_URL. NOT in a .env.production file.
- Runtime: Node 24.x; Fluid Compute ON; Image Optimization ON; region us-east-1 (iad1, default).

EVENTS APP divergences:
- New Vercel project, root dir frontend/, region sin1 (co-locate with events-api in ap-southeast-1).
- Custom domain events.88bamboo.co (CNAME → Vercel) = the Shopify App Proxy origin; admin opened here directly.
- next.config: basePath '/a/events'; add events image host to images.remotePatterns; NO apex→www redirect.
- Backend (events-api) stays on AWS Fargate+ALB (events-api.88bamboo.co), like api.drink-x.com.
