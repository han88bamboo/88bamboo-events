# scripts/taxonomy.py — read-only reference data for the submission form (plan §7:
# options come from the DB tables, never hardcoded). Prefix /taxonomy.
#
# GET /taxonomy -> { code, data: { drink_categories: [...], event_formats: [...],
#                                  pricing: {price, currency} | null } }
# Each list item is {id, label}. Only ACTIVE rows are returned so the owner can
# retire an option without code changes.
#
# `pricing` is the PUBLIC read of the active pricing tier — the same row
# /submissions/create-intent prices the PaymentIntent from — so the submit and
# checkout pages can quote the real fee instead of a hardcoded number that drifts
# whenever the owner edits the tier. Read-only and non-secret: label and the admin
# CRUD stay behind /admin/pricing-tiers.

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
            # Same read as submissions.py `_active_pricing_tier()` — single-active
            # invariant enforced by the admin CRUD, so this resolves to the tier
            # the card will actually be authorised for. None if none is configured.
            cursor.execute(
                "SELECT price, currency FROM pricing_tiers "
                "WHERE active = TRUE ORDER BY id LIMIT 1"
            )
            tier = cursor.fetchone()
        return (
            jsonify(
                {
                    "code": 200,
                    "data": {
                        "drink_categories": drink_categories,
                        "event_formats": event_formats,
                        "pricing": (
                            {"price": tier["price"], "currency": tier["currency"]}
                            if tier
                            else None
                        ),
                    },
                }
            ),
            200,
        )
    except psycopg2.Error:
        return jsonify({"code": 500, "error": "Database error occurred"}), 500
