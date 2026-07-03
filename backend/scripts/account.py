# scripts/account.py — the customer self-serve "manage my listings" dashboard
# (email-scoped). Prefix /account. UNGUARDED at the blueprint level, but every
# action re-checks OWNERSHIP: the account magic-link token proves the caller owns
# an email, and each event is verified to belong to that email server-side.
#
#   POST /account/request-link  email a 24h dashboard link (anti-enumeration)
#   GET  /account/context        all of the email's events (full history) for the grid
#   GET  /account/event          one owned event (detail + editable content + flags)
#   POST /account/edit           edit an owned event -> new pending version
#   POST /account/withdraw       withdraw an owned PENDING event (cancel hold, archive)
#   POST /account/unpublish      unpublish an owned LIVE event (archive)
#   POST /account/republish      re-publish an owned unpublished event (ONCE only)
#
# COOKIE-FREE (plan §4/§7): the session is the URL token, never a cookie (the App
# Proxy strips cookies). Customer actions are logged to admin_actions with a NULL
# admin_user_id (system/customer-initiated) for the audit trail.

import os
from datetime import datetime, timezone

import psycopg2
from flask import Blueprint, jsonify, request
from psycopg2.extras import Json

from app import db_manager
from event_versioning import create_edit_version, editable_version
from magic_links import create_account_link, resolve_account_token
from notifications import (
    send_account_link,
    send_edit_received,
    send_edit_submission_admin,
    send_reply_admin,
)
from payments import cancel_intent
from rate_limit import RateLimiter, rate_limited
from submission_validation import validate_submission

file_name = os.path.basename(__file__)
blueprint = Blueprint(file_name[:-3], __name__)  # blueprint name == filename

_PUBLIC_EVENT_BASE_URL = os.getenv(
    "PUBLIC_EVENT_BASE_URL", "http://localhost:8080/a/events"
).rstrip("/")

# Per-IP limit on link requests (email-bomb control — plan §8).
_link_limiter = RateLimiter(max_requests=5, window_seconds=600)

# Bound reply spam per IP (same shape as the public /messages/reply limiter).
_reply_limiter = RateLimiter(max_requests=10, window_seconds=600)


def _load_active_taxonomy():
    """Active taxonomy label sets to validate an edit against (plan §7)."""
    with db_manager.get_cursor(commit=False) as cursor:
        cursor.execute("SELECT label FROM drink_categories WHERE active = TRUE")
        categories = {row["label"] for row in cursor.fetchall()}
        cursor.execute("SELECT label FROM event_formats WHERE active = TRUE")
        formats = {row["label"] for row in cursor.fetchall()}
    return categories, formats


def _log(cursor, event_id, action, details):
    """Audit a customer self-serve action (admin_user_id NULL = not an admin)."""
    cursor.execute(
        "INSERT INTO admin_actions (admin_user_id, event_id, action, details) "
        "VALUES (NULL, %s, %s, %s)",
        (event_id, action, Json(details)),
    )


def _authorize(cursor, token, event_id):
    """Resolve the account token and verify `event_id` belongs to that email.
    Returns (email, event_row) on success, else (None, (json_response, status)).
    A mismatched/unknown event returns 404 (never reveals another owner's data)."""
    acct = resolve_account_token(cursor, token)
    if not acct:
        return None, (
            jsonify({"code": 401, "error": "This link is invalid or has expired."}),
            401,
        )
    cursor.execute(
        "SELECT id, submitter_email, current_status, archived, republish_count, "
        "       published_version_id, slug "
        "FROM events WHERE id = %s",
        (event_id,),
    )
    event = cursor.fetchone()
    if not event or (event["submitter_email"] or "").lower() != acct["email"].lower():
        return None, (jsonify({"code": 404, "error": "Listing not found."}), 404)
    return (acct["email"], event), None


# ---------------------------------------------------------------------------
# Request an account dashboard link. Anti-enumeration: ALWAYS a generic 200; the
# link is only created + emailed when the email actually has listings.
# ---------------------------------------------------------------------------
@blueprint.route("/request-link", methods=["POST"])
@rate_limited(_link_limiter)
def request_link():
    payload = request.get_json(silent=True) or {}
    email = (payload.get("email") or "").strip().lower()

    generic = (
        jsonify({"code": 200, "data": "If that email has listings, a link is on its way."}),
        200,
    )
    if not email:
        return generic

    try:
        with db_manager.get_cursor() as cursor:
            cursor.execute(
                "SELECT 1 FROM events WHERE lower(submitter_email) = lower(%s) LIMIT 1",
                (email,),
            )
            if not cursor.fetchone():
                return generic  # no listings for this email — stay silent
            raw_token, _ = create_account_link(cursor, email)
    except psycopg2.Error:
        return generic

    dashboard_url = f"{_PUBLIC_EVENT_BASE_URL}/my-events?token={raw_token}"
    send_account_link(email, dashboard_url)
    return generic


# ---------------------------------------------------------------------------
# The dashboard feed — every event this email submitted (full history), with the
# display version (the live one if published, else the latest) + status flags for
# badging. Ordered newest-submitted first.
# ---------------------------------------------------------------------------
@blueprint.route("/context", methods=["GET"])
def context():
    token = (request.args.get("token") or "").strip()
    try:
        with db_manager.get_cursor(commit=False) as cursor:
            acct = resolve_account_token(cursor, token)
            if not acct:
                return jsonify({"code": 401, "error": "This link is invalid or has expired."}), 401

            cursor.execute(
                """
                SELECT
                    e.id                 AS event_id,
                    e.slug,
                    e.current_status,
                    e.archived,
                    e.republish_count,
                    e.created_at,
                    e.published_version_id,
                    dv.id                AS version_id,
                    dv.name,
                    dv.start_datetime,
                    dv.end_datetime,
                    dv.city,
                    dv.country,
                    dv.image_url,
                    dv.event_format,
                    dv.approval_status,
                    (dv.end_datetime IS NOT NULL AND dv.end_datetime < now()) AS is_past,
                    EXISTS (
                        SELECT 1 FROM event_versions pv
                        WHERE pv.event_id = e.id
                          AND pv.approval_status = 'pending_review'
                          AND (e.published_version_id IS NULL OR pv.id <> e.published_version_id)
                    )                    AS has_pending_edit,
                    -- Message bell (post-launch): total admin messages, and how many
                    -- the submitter hasn't read yet (drives the red-vs-black bell).
                    (SELECT count(*) FROM event_messages m
                     WHERE m.event_id = e.id AND m.sender = 'admin')
                                         AS admin_message_count,
                    (SELECT count(*) FROM event_messages m
                     WHERE m.event_id = e.id AND m.sender = 'admin'
                       AND m.read_by_submitter = FALSE)
                                         AS unread_admin_count
                FROM events e
                JOIN LATERAL (
                    -- Display the published version if there is one, else the latest.
                    SELECT *
                    FROM event_versions ev
                    WHERE ev.event_id = e.id
                    ORDER BY (ev.id = e.published_version_id) DESC,
                             ev.version_number DESC, ev.id DESC
                    LIMIT 1
                ) dv ON TRUE
                WHERE lower(e.submitter_email) = lower(%s)
                ORDER BY e.created_at DESC
                """,
                (acct["email"],),
            )
            rows = [dict(r) for r in cursor.fetchall()]
    except psycopg2.Error:
        return jsonify({"code": 500, "error": "Database error occurred"}), 500

    return jsonify({"code": 200, "data": {"email": acct["email"], "events": rows}}), 200


# ---------------------------------------------------------------------------
# One owned event: the display version's full content (for the owner detail view
# and to prefill the edit form) plus the flags the UI needs to decide which
# actions to offer (edit / withdraw / unpublish / republish / resubmit).
# ---------------------------------------------------------------------------
@blueprint.route("/event", methods=["GET"])
def event():
    token = (request.args.get("token") or "").strip()
    event_id = request.args.get("event_id")
    try:
        with db_manager.get_cursor(commit=False) as cursor:
            owned, err = _authorize(cursor, token, event_id)
            if err:
                return err
            _email, ev = owned
            version = editable_version(cursor, ev["id"], ev["published_version_id"])
    except psycopg2.Error:
        return jsonify({"code": 500, "error": "Database error occurred"}), 500

    if not version:
        return jsonify({"code": 404, "error": "Nothing to show for this listing."}), 404

    is_published = ev["current_status"] == "published"
    is_past = bool(
        version["end_datetime"] and version["end_datetime"] < datetime.now(timezone.utc)
    )
    return (
        jsonify(
            {
                "code": 200,
                "data": {
                    "event_id": ev["id"],
                    "slug": ev["slug"],
                    "current_status": ev["current_status"],
                    "archived": ev["archived"],
                    "republish_count": ev["republish_count"],
                    "can_republish": (
                        ev["current_status"] == "unpublished"
                        and ev["archived"]
                        and ev["republish_count"] < 1
                    ),
                    "is_published": is_published,
                    "is_past": is_past,
                    "event": {
                        "name": version["name"],
                        "submitter_email": ev["submitter_email"],
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
# Edit an owned event -> a new pending version (pre-/post-approval handled by the
# shared helper). Free (no new payment). Authorised by the account token.
# ---------------------------------------------------------------------------
@blueprint.route("/edit", methods=["POST"])
def edit():
    payload = request.get_json(silent=True) or {}
    token = (payload.get("token") or "").strip()
    event_id = payload.get("event_id")
    event_fields = payload.get("event") or {}

    try:
        allowed_categories, allowed_formats = _load_active_taxonomy()
    except psycopg2.Error:
        return jsonify({"code": 500, "error": "Database error occurred"}), 500

    cleaned, errors = validate_submission(event_fields, allowed_categories, allowed_formats)
    if errors:
        return jsonify({"code": 400, "error": "Validation failed", "errors": errors}), 400

    try:
        with db_manager.get_cursor() as cursor:
            owned, err = _authorize(cursor, token, event_id)
            if err:
                return err
            email, ev = owned

            # Only pending or published listings can receive edits; a
            # withdrawn/rejected/expired one must be re-submitted instead.
            if ev["current_status"] not in ("pending_review", "published"):
                return (
                    jsonify({"code": 409, "error": "This listing can't be edited in its current state."}),
                    409,
                )

            new_version_id, is_published = create_edit_version(
                cursor, ev["id"], ev["published_version_id"], cleaned
            )

            cursor.execute(
                "SELECT email FROM admin_users WHERE active = TRUE ORDER BY id LIMIT 1"
            )
            admin_row = cursor.fetchone()
            admin_email = admin_row["email"] if admin_row else os.getenv("ADMIN_NOTIFY_EMAIL")
            _log(cursor, ev["id"], "customer_edit",
                 {"version_id": new_version_id, "was_published": is_published})
    except psycopg2.Error:
        return jsonify({"code": 500, "error": "Could not save your edit. Please try again."}), 500

    send_edit_received(email, cleaned)
    if admin_email:
        send_edit_submission_admin(admin_email, cleaned, is_published)

    return (
        jsonify(
            {
                "code": 200,
                "data": {
                    "event_id": ev["id"],
                    "version_id": new_version_id,
                    "status": "pending_review",
                    "was_published": is_published,
                },
            }
        ),
        200,
    )


# ---------------------------------------------------------------------------
# Withdraw an owned PENDING listing: release the card hold immediately (free) and
# archive it. Terminal — to bring it back the customer re-submits (a fresh paid
# submission with the fields pre-filled).
# ---------------------------------------------------------------------------
@blueprint.route("/withdraw", methods=["POST"])
def withdraw():
    payload = request.get_json(silent=True) or {}
    token = (payload.get("token") or "").strip()
    event_id = payload.get("event_id")

    try:
        with db_manager.get_cursor() as cursor:
            owned, err = _authorize(cursor, token, event_id)
            if err:
                return err
            _email, ev = owned
            if ev["current_status"] != "pending_review" or ev["archived"]:
                return jsonify({"code": 409, "error": "Only a pending listing can be withdrawn."}), 409

            # Release the authorised hold (best-effort — a webhook race that
            # already cancelled it must not block the withdrawal).
            cursor.execute(
                """
                SELECT p.id, p.payment_intent_id
                FROM payments p
                JOIN event_versions ev ON ev.id = p.event_version_id
                WHERE ev.event_id = %s AND p.status = 'authorised'
                ORDER BY p.id DESC LIMIT 1
                """,
                (ev["id"],),
            )
            pay = cursor.fetchone()
            if pay and pay["payment_intent_id"]:
                cancel_intent(pay["payment_intent_id"])
                cursor.execute(
                    "UPDATE payments SET status = 'cancelled' WHERE id = %s",
                    (pay["id"],),
                )

            cursor.execute(
                "UPDATE events SET current_status = 'withdrawn', archived = TRUE WHERE id = %s",
                (ev["id"],),
            )
            _log(cursor, ev["id"], "customer_withdraw", {"released_payment_id": pay["id"] if pay else None})
    except psycopg2.Error:
        return jsonify({"code": 500, "error": "Could not withdraw. Please try again."}), 500

    return jsonify({"code": 200, "data": {"event_id": int(event_id), "status": "withdrawn"}}), 200


# ---------------------------------------------------------------------------
# Unpublish an owned LIVE listing: take it off the public board and archive it. No
# money moves (the fee was captured at approval). archived=TRUE marks it as a
# CUSTOMER unpublish, which is what makes it re-publishable (once).
# ---------------------------------------------------------------------------
@blueprint.route("/unpublish", methods=["POST"])
def unpublish():
    payload = request.get_json(silent=True) or {}
    token = (payload.get("token") or "").strip()
    event_id = payload.get("event_id")

    try:
        with db_manager.get_cursor() as cursor:
            owned, err = _authorize(cursor, token, event_id)
            if err:
                return err
            _email, ev = owned
            if ev["current_status"] != "published":
                return jsonify({"code": 409, "error": "Only a live listing can be unpublished."}), 409

            cursor.execute(
                "UPDATE events SET current_status = 'unpublished', archived = TRUE WHERE id = %s",
                (ev["id"],),
            )
            _log(cursor, ev["id"], "customer_unpublish", {"published_version_id": ev["published_version_id"]})
    except psycopg2.Error:
        return jsonify({"code": 500, "error": "Could not unpublish. Please try again."}), 500

    return jsonify({"code": 200, "data": {"event_id": int(event_id), "status": "unpublished"}}), 200


# ---------------------------------------------------------------------------
# Re-publish an owned listing the CUSTOMER unpublished — allowed ONCE only
# (republish_count < 1). Gated on archived=TRUE so an ADMIN unpublish (moderation)
# can't be reversed by the customer.
# ---------------------------------------------------------------------------
@blueprint.route("/republish", methods=["POST"])
def republish():
    payload = request.get_json(silent=True) or {}
    token = (payload.get("token") or "").strip()
    event_id = payload.get("event_id")

    try:
        with db_manager.get_cursor() as cursor:
            owned, err = _authorize(cursor, token, event_id)
            if err:
                return err
            _email, ev = owned
            if not (ev["current_status"] == "unpublished" and ev["archived"]):
                return jsonify({"code": 409, "error": "This listing isn't one you can re-publish."}), 409
            if ev["republish_count"] >= 1:
                return (
                    jsonify({"code": 409, "error": "You've already re-published this listing once. Contact us if you need it live again."}),
                    409,
                )
            if ev["published_version_id"] is None:
                return jsonify({"code": 409, "error": "This listing was never approved, so it can't be re-published."}), 409

            cursor.execute(
                "UPDATE events "
                "SET current_status = 'published', archived = FALSE, "
                "    republish_count = republish_count + 1 "
                "WHERE id = %s",
                (ev["id"],),
            )
            _log(cursor, ev["id"], "customer_republish", {"republish_count": ev["republish_count"] + 1})
    except psycopg2.Error:
        return jsonify({"code": 500, "error": "Could not re-publish. Please try again."}), 500

    return jsonify({"code": 200, "data": {"event_id": int(event_id), "status": "published"}}), 200


# ===========================================================================
# Messaging — the DASHBOARD surface of the admin⇄submitter conversation thread
# (post-launch feature). Third surface onto the SAME event_messages records (the
# other two: the public emailed page scripts/messages.py, and the admin side in
# admin.py). Account-token-gated + ownership-checked, reusing _authorize.
#
# FREEZE RULE (unchanged): the thread is always READABLE (history for a resolved
# event), but a reply is only accepted while the event is 'pending_review' — the
# same gate as the public /messages/reply.
# ===========================================================================


def _event_display_name(cursor, event_id, published_version_id):
    """The event's display name: the published version's, else the latest one's."""
    if published_version_id is not None:
        cursor.execute("SELECT name FROM event_versions WHERE id = %s", (published_version_id,))
    else:
        cursor.execute(
            "SELECT name FROM event_versions WHERE event_id = %s "
            "ORDER BY version_number DESC, id DESC LIMIT 1",
            (event_id,),
        )
    row = cursor.fetchone()
    return row["name"] if row else None


# ---------------------------------------------------------------------------
# Read an owned event's thread + open flag + name. Marks the admin messages
# read_by_submitter=TRUE (clears the dashboard bell) — hence a committing cursor.
# ---------------------------------------------------------------------------
@blueprint.route("/messages", methods=["GET"])
def messages():
    token = (request.args.get("token") or "").strip()
    event_id = request.args.get("event_id")
    try:
        with db_manager.get_cursor() as cursor:
            owned, err = _authorize(cursor, token, event_id)
            if err:
                return err
            _email, ev = owned

            # How many admin messages were unread AS OF THIS LOAD — read before the
            # mark-read UPDATE below so the client (mobile launcher) can still show
            # the red "you have new messages" bell even though opening the page
            # clears them server-side (page-load = read, owner-confirmed).
            cursor.execute(
                "SELECT count(*) AS n FROM event_messages "
                "WHERE event_id = %s AND sender = 'admin' AND read_by_submitter = FALSE",
                (ev["id"],),
            )
            unread = cursor.fetchone()["n"]

            # Opening the thread (any surface) marks the admin messages read.
            cursor.execute(
                "UPDATE event_messages SET read_by_submitter = TRUE "
                "WHERE event_id = %s AND sender = 'admin' AND read_by_submitter = FALSE",
                (ev["id"],),
            )
            name = _event_display_name(cursor, ev["id"], ev["published_version_id"])
            cursor.execute(
                "SELECT sender, body, created_at FROM event_messages "
                "WHERE event_id = %s ORDER BY created_at ASC, id ASC",
                (ev["id"],),
            )
            messages_out = [
                {
                    "sender": r["sender"],
                    "body": r["body"],
                    "created_at": r["created_at"].isoformat() if r["created_at"] else None,
                }
                for r in cursor.fetchall()
            ]
    except psycopg2.Error:
        return jsonify({"code": 500, "error": "Database error occurred"}), 500

    return (
        jsonify(
            {
                "code": 200,
                "data": {
                    "event": {"name": name, "current_status": ev["current_status"]},
                    "open": ev["current_status"] == "pending_review",
                    "unread": unread,
                    "messages": messages_out,
                },
            }
        ),
        200,
    )


# ---------------------------------------------------------------------------
# Post a submitter reply from the dashboard. 409 once the thread is frozen (the
# event left review). Inserts read_by_submitter=TRUE (their own message) +
# read_by_admin=FALSE, then notifies the admin — same as the public reply path.
# ---------------------------------------------------------------------------
@blueprint.route("/messages/reply", methods=["POST"])
@rate_limited(_reply_limiter)
def messages_reply():
    payload = request.get_json(silent=True) or {}
    token = (payload.get("token") or "").strip()
    event_id = payload.get("event_id")
    text = (payload.get("body") or "").strip()
    if not text:
        return jsonify({"code": 400, "error": "A reply message is required."}), 400

    try:
        with db_manager.get_cursor() as cursor:
            owned, err = _authorize(cursor, token, event_id)
            if err:
                return err
            _email, ev = owned
            if ev["current_status"] != "pending_review":
                return (
                    jsonify(
                        {
                            "code": 409,
                            "error": "This conversation is closed — your listing is no "
                            "longer under review, so replies are disabled.",
                        }
                    ),
                    409,
                )

            cursor.execute(
                "INSERT INTO event_messages (event_id, sender, body, read_by_admin, "
                "read_by_submitter) VALUES (%s, 'submitter', %s, FALSE, TRUE)",
                (ev["id"], text),
            )
            name = _event_display_name(cursor, ev["id"], ev["published_version_id"])

            # Admin recipient for the "new reply" alert (active admin, else env).
            cursor.execute(
                "SELECT email FROM admin_users WHERE active = TRUE ORDER BY id LIMIT 1"
            )
            admin_row = cursor.fetchone()
            admin_email = admin_row["email"] if admin_row else os.getenv("ADMIN_NOTIFY_EMAIL")
            submitter_email = ev["submitter_email"]
    except psycopg2.Error:
        return jsonify({"code": 500, "error": "Could not send your reply. Please try again."}), 500

    if admin_email:
        send_reply_admin(
            admin_email,
            {"name": name, "submitter_email": submitter_email},
            text,
        )

    return jsonify({"code": 200, "data": {"event_id": int(event_id), "status": "sent"}}), 200
