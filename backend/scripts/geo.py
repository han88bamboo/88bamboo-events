# scripts/geo.py — read-only geo reference for the submission/edit forms (EP-2).
# Prefix /geo. The SINGLE source of truth for the required country dropdown and the
# dependent State/Territory/Region dropdown (owner decision: no hardcoded frontend
# list). Mirrors scripts/taxonomy.py in spirit — options come from the DB.
#
# GET /geo -> { code, data: { countries: [
#                 { name, requires_region, regions: [ ... ] }, ... ] } }
# Only ACTIVE rows are returned. `regions` is non-empty only when requires_region
# is TRUE (large federal countries + Hong Kong / Macau / Taiwan, whose single
# region equals the country name).

import os

import psycopg2
from flask import Blueprint, jsonify

from app import db_manager
from geo_reference import load_geo

file_name = os.path.basename(__file__)
blueprint = Blueprint(file_name[:-3], __name__)  # blueprint name == filename


@blueprint.route("", methods=["GET"])
def get_geo():
    try:
        with db_manager.get_cursor(commit=False) as cursor:
            geo = load_geo(cursor)
    except psycopg2.Error:
        return jsonify({"code": 500, "error": "Database error occurred"}), 500

    countries = [
        {
            "name": name,
            "requires_region": meta["requires_region"],
            "regions": sorted(meta["regions"]),
        }
        for name, meta in sorted(geo.items())
    ]
    return jsonify({"code": 200, "data": {"countries": countries}}), 200
