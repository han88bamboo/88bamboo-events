# scripts/edits.py — magic-link event editing (plan §7). Prefix /edits.
#
#   POST /edits/request-link   email the submitter a fresh 24-hour magic link
#   GET  /edits/context        resolve a token -> the current editable content
#   POST /edits/submit         apply an edit -> a NEW pending_review version
#
# COOKIE-FREE (plan §4/§7): the edit session is carried by the URL token, never a
# cookie — editing may run through the Shopify App Proxy, which strips cookies.
#
# VERSIONING (plan §7) — an edit always creates a new event_versions row; prior
# versions are retained. Two cases, distinguished by whether the event is already
# published (events.published_version_id):
#
#   PRE-approval edit (never published): the submitter is amending a submission
#   still in the queue. The authorised card hold sits on the version being
#   reviewed, so we MOVE that payment onto the new version and mark the old
#   pending version 'rejected' ("superseded") — WITHOUT cancelling the hold — so
#   the queue shows exactly one pending version carrying the live hold. Approving
#   it then follows the normal first-approval path (capture + mint slug).
#
#   POST-approval edit (already live): the published version keeps serving; the
#   edit becomes a NEW pending version with NO payment (edits are free at MVP —
#   plan §7). Approving it repoints published_version_id to the new version and
#   KEEPS the existing slug (the edit-approval path in scripts/admin.py).

import os

import psycopg2
from flask import Blueprint, jsonify, request

from app import db_manager
from event_versioning import create_edit_version, editable_version
from geo_reference import load_geo
from magic_links import create_magic_link, mark_used, resolve_token
from notifications import (
    send_edit_received,
    send_edit_submission_admin,
    send_magic_link,
)
from rate_limit import RateLimiter, rate_limited
from submission_validation import validate_submission

file_name = os.path.basename(__file__)
blueprint = Blueprint(file_name[:-3], __name__)  # blueprint name == filename

# Public base for the emailed edit link. Matches the approval-email base (plan §9):
# local browse path; production overrides to the apex proxy path via env.
_PUBLIC_EVENT_BASE_URL = os.getenv(
    "PUBLIC_EVENT_BASE_URL", "http://localhost:8080/a/events"
).rstrip("/")

# Per-IP limit on link requests: 5 / 10 min, same shape as the submission limiter.
# Bounds email-bomb attempts against a known submitter address (plan §8).
_link_limiter = RateLimiter(max_requests=5, window_seconds=600)


def _load_active_taxonomy():
    """Active taxonomy label sets to validate an edit against (plan §7 — the DB is
    the source of truth). Mirrors submissions.py; kept local to avoid importing a
    sibling blueprint module."""
    with db_manager.get_cursor(commit=False) as cursor:
        cursor.execute("SELECT label FROM drink_categories WHERE active = TRUE")
        categories = {row["label"] for row in cursor.fetchall()}
        cursor.execute("SELECT label FROM event_formats WHERE active = TRUE")
        formats = {row["label"] for row in cursor.fetchall()}
    return categories, formats


def _load_geo():
    """Canonical country/region reference for validating an edit (EP-2)."""
    with db_manager.get_cursor(commit=False) as cursor:
        return load_geo(cursor)


# _editable_version + the edit-version creation now live in event_versioning.py
# (shared with the account dashboard flow); this module imports them.


# ---------------------------------------------------------------------------
# Request a magic link. Anti-enumeration: ALWAYS return a generic 200 whether or
# not the (slug, email) pair matched, so this endpoint can't be used to probe
# which emails submitted which events. The link is only created + emailed on a
# real match.
# ---------------------------------------------------------------------------
@blueprint.route("/request-link", methods=["POST"])
@rate_limited(_link_limiter)
def request_link():
    payload = request.get_json(silent=True) or {}
    slug = (payload.get("slug") or "").strip()
    email = (payload.get("email") or "").strip().lower()

    generic = (
        jsonify(
            {
                "code": 200,
                "data": "If that event and email match, an edit link is on its way.",
            }
        ),
        200,
    )
    if not slug or not email:
        return generic

    try:
        with db_manager.get_cursor() as cursor:
            cursor.execute(
                "SELECT id, submitter_email, slug, current_status "
                "FROM events WHERE lower(slug) = lower(%s) LIMIT 1",
                (slug,),
            )
            event = cursor.fetchone()
            # Only a real, matching submitter gets a link. Silent otherwise.
            if not event or (event["submitter_email"] or "").lower() != email:
                return generic

            raw_token, _ = create_magic_link(cursor, event["id"])
    except psycopg2.Error:
        # Even on a DB error, keep the response generic (don't leak state).
        return generic

    edit_url = f"{_PUBLIC_EVENT_BASE_URL}/edit?token={raw_token}"
    send_magic_link(event["submitter_email"], event["slug"], edit_url)
    return generic


# ---------------------------------------------------------------------------
# Resolve a token to the current editable content (prefills the edit form). 404s
# for a missing/expired token. Reveals only this event's own content (the token
# is the bearer credential).
# ---------------------------------------------------------------------------
@blueprint.route("/context", methods=["GET"])
def context():
    token = (request.args.get("token") or "").strip()
    try:
        with db_manager.get_cursor(commit=False) as cursor:
            link = resolve_token(cursor, token)
            if not link:
                return jsonify({"code": 404, "error": "This edit link is invalid or has expired."}), 404
            version = editable_version(cursor, link["event_id"], link["published_version_id"])
    except psycopg2.Error:
        return jsonify({"code": 500, "error": "Database error occurred"}), 500

    if not version:
        return jsonify({"code": 404, "error": "Nothing to edit for this event."}), 404

    is_published = link["published_version_id"] is not None
    return (
        jsonify(
            {
                "code": 200,
                "data": {
                    "slug": link["slug"],
                    "is_published": is_published,
                    "event": {
                        "name": version["name"],
                        "submitter_email": link["submitter_email"],
                        "contact_email": version["contact_email"],
                        "start_datetime": version["start_datetime"].isoformat()
                        if version["start_datetime"] else None,
                        "end_datetime": version["end_datetime"].isoformat()
                        if version["end_datetime"] else None,
                        "venue_name": version["venue_name"],
                        "venue_address": version["venue_address"],
                        "country": version["country"],
                        "city": version["city"],
                        "region": version["region"],
                        # NUMERIC -> float so the coordinates are JSON-serialisable
                        # and re-usable as hidden fields on the edit form (EP-2).
                        "latitude": float(version["latitude"])
                        if version["latitude"] is not None else None,
                        "longitude": float(version["longitude"])
                        if version["longitude"] is not None else None,
                        "place_id": version["place_id"],
                        "postcode": version["postcode"],
                        "description": version["description"],
                        "link": version["link"],
                        "event_format": version["event_format"],
                        "submission_type": version["submission_type"],
                        "drink_categories": version["drink_categories"] or [],
                        "image_url": version["image_url"],
                    },
                },
            }
        ),
        200,
    )


# ---------------------------------------------------------------------------
# Submit an edit -> a new pending_review version (see the module docstring for the
# pre- vs post-approval versioning). Free at MVP (no new payment is created).
# ---------------------------------------------------------------------------
@blueprint.route("/submit", methods=["POST"])
def submit_edit():
    payload = request.get_json(silent=True) or {}
    token = (payload.get("token") or "").strip()
    event_fields = payload.get("event") or {}

    # Re-validate the edited fields server-side against the live taxonomy (plan §7
    # — never trust the client), same validators as a fresh submission.
    try:
        allowed_categories, allowed_formats = _load_active_taxonomy()
        geo = _load_geo()
    except psycopg2.Error:
        return jsonify({"code": 500, "error": "Database error occurred"}), 500

    # require_address_selection=False: an edit's prefilled/legacy address stays
    # editable without a re-pick; the versioning layer carries coordinates forward.
    cleaned, errors = validate_submission(
        event_fields, allowed_categories, allowed_formats, geo,
        require_address_selection=False,
    )
    if errors:
        return jsonify({"code": 400, "error": "Validation failed", "errors": errors}), 400

    try:
        with db_manager.get_cursor() as cursor:
            link = resolve_token(cursor, token)
            if not link:
                return jsonify({"code": 404, "error": "This edit link is invalid or has expired."}), 404

            event_id = link["event_id"]

            # Create the new pending version (pre-/post-approval handled inside the
            # shared helper). Returns the new version id + whether it was an edit
            # of an already-published listing.
            new_version_id, is_published = create_edit_version(
                cursor, event_id, link["published_version_id"], cleaned
            )

            mark_used(cursor, link["magic_link_id"])

            # Admin recipient for the "new edit awaiting review" alert.
            cursor.execute(
                "SELECT email FROM admin_users WHERE active = TRUE ORDER BY id LIMIT 1"
            )
            admin_row = cursor.fetchone()
            admin_email = admin_row["email"] if admin_row else os.getenv("ADMIN_NOTIFY_EMAIL")
    except psycopg2.Error:
        return jsonify({"code": 500, "error": "Could not save your edit. Please try again."}), 500

    # Best-effort emails after commit (plan §8).
    send_edit_received(link["submitter_email"], cleaned)
    if admin_email:
        send_edit_submission_admin(admin_email, cleaned, is_published)

    return (
        jsonify(
            {
                "code": 200,
                "data": {
                    "event_id": event_id,
                    "version_id": new_version_id,
                    "status": "pending_review",
                    "was_published": is_published,
                },
            }
        ),
        200,
    )
