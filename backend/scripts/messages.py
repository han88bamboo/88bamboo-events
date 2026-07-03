# scripts/messages.py — the PUBLIC, submitter side of the admin⇄submitter
# conversation thread (post-launch feature). Prefix /messages.
#
#   GET  /messages/thread   resolve a token -> the full thread + open/closed flag
#   POST /messages/reply    post a submitter reply (only while the thread is open)
#
# WEB-LINK REPLIES ONLY (owner decision): the submitter reaches this via a link in
# our email and replies on a page on our own site — they NEVER email us back. There
# is no inbound-email path. COOKIE-FREE (plan §4/§7): the session is the URL magic
# token, because a conversation may run through the Shopify App Proxy (cookies
# stripped).
#
# FREEZE RULE: a conversation is OPEN only while the event is 'pending_review'.
# Once the event goes live / is withdrawn / otherwise resolves, the thread is
# read-only — GET still returns it (for the record), but POST /reply refuses (409).

import os

import psycopg2
from flask import Blueprint, jsonify, request

from app import db_manager
from magic_links import resolve_token
from notifications import send_reply_admin
from rate_limit import RateLimiter, rate_limited

file_name = os.path.basename(__file__)
blueprint = Blueprint(file_name[:-3], __name__)  # blueprint name == filename

# Bound reply spam per IP (same shape as the submission/edit limiters, plan §8).
_reply_limiter = RateLimiter(max_requests=10, window_seconds=600)


def _event_name(cursor, event_id, published_version_id):
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


def _thread_payload(cursor, link):
    """Build the {event, open, messages} payload for a resolved conversation link."""
    event_id = link["event_id"]
    is_open = link["current_status"] == "pending_review"
    name = _event_name(cursor, event_id, link["published_version_id"])
    cursor.execute(
        "SELECT sender, body, created_at FROM event_messages "
        "WHERE event_id = %s ORDER BY created_at ASC, id ASC",
        (event_id,),
    )
    messages = [
        {
            "sender": r["sender"],
            "body": r["body"],
            "created_at": r["created_at"].isoformat() if r["created_at"] else None,
        }
        for r in cursor.fetchall()
    ]
    return {
        "event": {"name": name, "slug": link["slug"], "current_status": link["current_status"]},
        "open": is_open,
        "messages": messages,
    }


# ---------------------------------------------------------------------------
# Resolve a token -> the thread. A missing/expired token 404s with a generic
# message (anti-enumeration — the token is the bearer credential).
# ---------------------------------------------------------------------------
@blueprint.route("/thread", methods=["GET"])
def thread():
    token = (request.args.get("token") or "").strip()
    try:
        with db_manager.get_cursor(commit=False) as cursor:
            link = resolve_token(cursor, token)
            if not link:
                return jsonify({"code": 404, "error": "This link is invalid or has expired."}), 404
            payload = _thread_payload(cursor, link)
    except psycopg2.Error:
        return jsonify({"code": 500, "error": "Database error occurred"}), 500

    return jsonify({"code": 200, "data": payload}), 200


# ---------------------------------------------------------------------------
# Post a submitter reply. Refuses if the token is invalid/expired (404) or the
# conversation has frozen (409). Notifies the admin; the reply lands unread.
# ---------------------------------------------------------------------------
@blueprint.route("/reply", methods=["POST"])
@rate_limited(_reply_limiter)
def reply():
    payload = request.get_json(silent=True) or {}
    token = (payload.get("token") or "").strip()
    text = (payload.get("body") or "").strip()
    if not text:
        return jsonify({"code": 400, "error": "A reply message is required."}), 400

    try:
        with db_manager.get_cursor() as cursor:
            link = resolve_token(cursor, token)
            if not link:
                return jsonify({"code": 404, "error": "This link is invalid or has expired."}), 404
            if link["current_status"] != "pending_review":
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

            event_id = link["event_id"]
            cursor.execute(
                "INSERT INTO event_messages (event_id, sender, body, read_by_admin) "
                "VALUES (%s, 'submitter', %s, FALSE)",
                (event_id, text),
            )
            name = _event_name(cursor, event_id, link["published_version_id"])

            # Admin recipient for the "new reply" alert (active admin, else env).
            cursor.execute(
                "SELECT email FROM admin_users WHERE active = TRUE ORDER BY id LIMIT 1"
            )
            admin_row = cursor.fetchone()
            admin_email = admin_row["email"] if admin_row else os.getenv("ADMIN_NOTIFY_EMAIL")
            submitter_email = link["submitter_email"]
    except psycopg2.Error:
        return jsonify({"code": 500, "error": "Could not send your reply. Please try again."}), 500

    if admin_email:
        send_reply_admin(
            admin_email,
            {"name": name, "submitter_email": submitter_email},
            text,
        )

    return jsonify({"code": 200, "data": {"event_id": event_id, "status": "sent"}}), 200
