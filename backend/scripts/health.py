# scripts/health.py — smallest blueprint (PATTERN-SPEC §A2/§A4-A).
# Route "" maps to the prefix root, so this serves GET /health.

import os

from flask import Blueprint, jsonify

from app import db_manager

file_name = os.path.basename(__file__)
blueprint = Blueprint(file_name[:-3], __name__)  # blueprint name == filename


@blueprint.route("", methods=["GET"])
def info():
    """Liveness probe used by the ALB / docker-compose healthcheck."""
    return jsonify({"code": 200, "data": "OK"}), 200


@blueprint.route("/db", methods=["GET"])
def db_health():
    """Readiness probe: confirm the pooled DB connection is usable."""
    try:
        with db_manager.get_cursor() as cursor:
            cursor.execute("SELECT 1 AS ok")
            row = cursor.fetchone()
        return jsonify({"code": 200, "data": {"db": row["ok"] == 1}}), 200
    except Exception:
        return jsonify({"code": 500, "error": "Database unavailable"}), 500
