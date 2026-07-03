# scripts/taxonomy.py — read-only taxonomy for the submission form's two selects
# (plan §7: options come from the DB tables, never hardcoded). Prefix /taxonomy.
#
# GET /taxonomy -> { code, data: { drink_categories: [...], event_formats: [...] } }
# Each list item is {id, label}. Only ACTIVE rows are returned so the owner can
# retire an option without code changes.

import os

import psycopg2
from flask import Blueprint, jsonify

from app import db_manager

file_name = os.path.basename(__file__)
blueprint = Blueprint(file_name[:-3], __name__)  # blueprint name == filename


@blueprint.route("", methods=["GET"])
def get_taxonomy():
    try:
        with db_manager.get_cursor() as cursor:
            cursor.execute(
                "SELECT id, label FROM drink_categories WHERE active = TRUE ORDER BY id"
            )
            drink_categories = cursor.fetchall()
            cursor.execute(
                "SELECT id, label FROM event_formats WHERE active = TRUE ORDER BY id"
            )
            event_formats = cursor.fetchall()
        return (
            jsonify(
                {
                    "code": 200,
                    "data": {
                        "drink_categories": drink_categories,
                        "event_formats": event_formats,
                    },
                }
            ),
            200,
        )
    except psycopg2.Error:
        return jsonify({"code": 500, "error": "Database error occurred"}), 500
