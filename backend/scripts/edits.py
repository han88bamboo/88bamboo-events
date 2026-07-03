# scripts/edits.py — magic-link event editing (plan §7). Prefix /edits.
#
#   POST /edits/request-link   email the submitter a fresh 30-min magic link
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


def _editable_version(cursor, event_id, published_version_id):
    """The version whose content prefills the edit form: the live one if the event
    is published, otherwise the latest submitted version."""
    if published_version_id is not None:
        cursor.execute(
            "SELECT * FROM event_versions WHERE id = %s",
            (published_version_id,),
        )
    else:
        cursor.execute(
            "SELECT * FROM event_versions WHERE event_id = %s "
            "ORDER BY version_number DESC, id DESC LIMIT 1",
            (event_id,),
        )
    return cursor.fetchone()


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
            version = _editable_version(cursor, link["event_id"], link["published_version_id"])
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
    except psycopg2.Error:
        return jsonify({"code": 500, "error": "Database error occurred"}), 500

    cleaned, errors = validate_submission(event_fields, allowed_categories, allowed_formats)
    if errors:
        return jsonify({"code": 400, "error": "Validation failed", "errors": errors}), 400

    try:
        with db_manager.get_cursor() as cursor:
            link = resolve_token(cursor, token)
            if not link:
                return jsonify({"code": 404, "error": "This edit link is invalid or has expired."}), 404

            event_id = link["event_id"]
            is_published = link["published_version_id"] is not None

            # The version we're editing FROM — carries the image forward (image
            # editing is out of MVP scope; the new version keeps the prior image).
            source = _editable_version(cursor, event_id, link["published_version_id"])
            image_url = source["image_url"] if source else None

            # New version number = current max + 1 (plan §7 full history).
            cursor.execute(
                "SELECT COALESCE(MAX(version_number), 0) + 1 AS n "
                "FROM event_versions WHERE event_id = %s",
                (event_id,),
            )
            next_version_number = cursor.fetchone()["n"]

            cursor.execute(
                "INSERT INTO event_versions ("
                "  event_id, version_number, approval_status, name, start_datetime,"
                "  end_datetime, venue_name, venue_address, country, city,"
                "  description, link, contact_email, image_url, submission_type,"
                "  drink_categories, event_format"
                ") VALUES (%s, %s, 'pending_review', %s, %s, %s, %s, %s, %s, %s,"
                "          %s, %s, %s, %s, %s, %s, %s) RETURNING id",
                (
                    event_id,
                    next_version_number,
                    cleaned["name"],
                    cleaned["start_datetime"],
                    cleaned["end_datetime"],
                    cleaned["venue_name"],
                    cleaned["venue_address"],
                    cleaned["country"],
                    cleaned["city"],
                    cleaned["description"],
                    cleaned["link"],
                    cleaned["contact_email"],
                    image_url,
                    cleaned["submission_type"],
                    cleaned["drink_categories"],
                    cleaned["event_format"],
                ),
            )
            new_version_id = cursor.fetchone()["id"]

            if not is_published:
                # PRE-approval edit: move the still-authorised hold onto the new
                # version and supersede the old pending version(s), so the queue
                # carries exactly one pending version with the live hold. The hold
                # is NOT cancelled (we're moving it, not releasing it).
                cursor.execute(
                    "UPDATE payments SET event_version_id = %s "
                    "WHERE event_version_id IN ("
                    "  SELECT id FROM event_versions "
                    "  WHERE event_id = %s AND id <> %s AND approval_status = 'pending_review'"
                    ") AND status = 'authorised'",
                    (new_version_id, event_id, new_version_id),
                )
                cursor.execute(
                    "UPDATE event_versions "
                    "SET approval_status = 'rejected', "
                    "    rejection_reason = 'Superseded by a newer edit' "
                    "WHERE event_id = %s AND id <> %s AND approval_status = 'pending_review'",
                    (event_id, new_version_id),
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
