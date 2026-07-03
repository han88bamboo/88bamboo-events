# scripts/admin.py — the admin backstage API (plan §5.3 / §6 / §7 / §8). Prefix /admin.
#
#   POST /admin/login     issue a signed admin session (mirrors §A6 login UX)
#   GET  /admin/pending   the review queue: pending versions + payment + image + dup flag
#   POST /admin/approve   capture the hold -> publish -> approval email   [GUARDED]
#   POST /admin/reject    cancel the hold  -> rejection email (reason)     [GUARDED]
#
# THE CARVE-OUT (plan §5.3): approve/reject move money and change live listings,
# so — unlike Drink-X's unguarded routes (§A6 ⚠️) — they verify the admin session
# SERVER-SIDE via @admin_required before doing anything. The pending queue is
# guarded too (it exposes submitter data); only /login is open. Full auth
# hardening stays deferred (plan §10).
#
# Payment state is set inside each action's own transaction (plan §6: "Set payment
# status in the action's transaction; the webhook only reconciles"). Every action
# is written to admin_actions (who / event / action / details JSON).

import os

import psycopg2
import stripe
from flask import Blueprint, g, jsonify, request
from psycopg2.extras import Json

from app import db_manager
from admin_auth import admin_required, issue_session_token
from notifications import send_approved, send_rejected, send_repay_required
from payments import cancel_intent, capture_intent
from slugs import generate_unique_slug

file_name = os.path.basename(__file__)
blueprint = Blueprint(file_name[:-3], __name__)  # blueprint name == filename

# Public listing base for the approval email's live link. Local default matches
# the browse URL (plan §9); production overrides via env to the apex proxy path.
_PUBLIC_EVENT_BASE_URL = os.getenv(
    "PUBLIC_EVENT_BASE_URL", "http://localhost:8080/a/events"
).rstrip("/")


# ---------------------------------------------------------------------------
# Login — mirrors §A6: the client sends a 32-bit hash of (email + password); we
# string-compare it against the stored admin_users.password_hash. On a match we
# issue a signed session token (admin_auth.issue_session_token) that the four
# guarded endpoints later verify. No token is a "real" server session (deferred).
# ---------------------------------------------------------------------------
@blueprint.route("/login", methods=["POST"])
def login():
    payload = request.get_json(silent=True) or {}
    email = (payload.get("email") or "").strip().lower()
    password_hash = str(payload.get("password_hash") or "").strip()
    if not email or not password_hash:
        return jsonify({"code": 400, "error": "Email and password are required."}), 400

    try:
        with db_manager.get_cursor(commit=False) as cursor:
            cursor.execute(
                "SELECT id, email, password_hash FROM admin_users "
                "WHERE email = %s AND active = TRUE",
                (email,),
            )
            admin = cursor.fetchone()
    except psycopg2.Error:
        return jsonify({"code": 500, "error": "Database error occurred"}), 500

    # Same generic message whether the email is unknown or the password is wrong
    # (don't reveal which admin emails exist). String compare mirrors §A6.
    if not admin or str(admin["password_hash"]) != password_hash:
        return jsonify({"code": 401, "error": "Invalid email or password."}), 401

    token = issue_session_token(admin["id"], admin["email"])
    return (
        jsonify(
            {
                "code": 200,
                "data": {
                    "token": token,
                    "admin_user_id": admin["id"],
                    "email": admin["email"],
                },
            }
        ),
        200,
    )


# ---------------------------------------------------------------------------
# Pending review queue — every pending_review version with its full §7 detail,
# the hero image, its payment (fee + capture deadline + status), and the
# duplicate flag 3B wrote to admin_actions (action='duplicate_flagged').
# ---------------------------------------------------------------------------
@blueprint.route("/pending", methods=["GET"])
@admin_required
def pending():
    try:
        with db_manager.get_cursor(commit=False) as cursor:
            cursor.execute(
                """
                SELECT
                    ev.id                AS version_id,
                    ev.event_id,
                    ev.version_number,
                    ev.name,
                    ev.start_datetime,
                    ev.end_datetime,
                    ev.venue_name,
                    ev.venue_address,
                    ev.country,
                    ev.city,
                    ev.description,
                    ev.link,
                    ev.contact_email,
                    ev.image_url,
                    ev.submission_type,
                    ev.drink_categories,
                    ev.event_format,
                    ev.created_at,
                    e.submitter_email,
                    e.current_status     AS event_status,
                    p.payment_intent_id,
                    p.amount,
                    p.currency,
                    p.status             AS payment_status,
                    p.capture_before,
                    EXISTS (
                        SELECT 1 FROM admin_actions a
                        WHERE a.event_id = ev.event_id
                          AND a.action = 'duplicate_flagged'
                    )                    AS is_duplicate
                FROM event_versions ev
                JOIN events e ON e.id = ev.event_id
                LEFT JOIN LATERAL (
                    SELECT payment_intent_id, amount, currency, status, capture_before
                    FROM payments
                    WHERE event_version_id = ev.id
                    ORDER BY id DESC
                    LIMIT 1
                ) p ON TRUE
                WHERE ev.approval_status = 'pending_review'
                ORDER BY ev.created_at ASC
                """
            )
            rows = cursor.fetchall()
    except psycopg2.Error:
        return jsonify({"code": 500, "error": "Database error occurred"}), 500

    # RealDictCursor gives dicts already; jsonify serialises datetimes/Decimals
    # to ISO strings / numbers. Amount stays numeric for the UI to format.
    return jsonify({"code": 200, "data": [dict(r) for r in rows]}), 200


def _load_version_for_action(cursor, version_id):
    """Fetch the version + event + latest payment needed to approve/reject, all in
    the caller's transaction. Returns the joined row or None if the version does
    not exist."""
    cursor.execute(
        """
        SELECT
            ev.id                AS version_id,
            ev.event_id,
            ev.approval_status,
            ev.name,
            ev.start_datetime,
            ev.end_datetime,
            ev.city,
            ev.country,
            e.submitter_email,
            e.published_version_id,
            p.id                 AS payment_id,
            p.payment_intent_id,
            p.amount,
            p.currency,
            p.status             AS payment_status
        FROM event_versions ev
        JOIN events e ON e.id = ev.event_id
        LEFT JOIN LATERAL (
            SELECT id, payment_intent_id, amount, currency, status
            FROM payments
            WHERE event_version_id = ev.id
            ORDER BY id DESC
            LIMIT 1
        ) p ON TRUE
        WHERE ev.id = %s
        """,
        (version_id,),
    )
    return cursor.fetchone()


def _log_action(cursor, event_id, action, details):
    """Append to the admin_actions audit log inside the action's transaction
    (plan §6). admin_user_id comes from the verified session (flask.g)."""
    cursor.execute(
        "INSERT INTO admin_actions (admin_user_id, event_id, action, details) "
        "VALUES (%s, %s, %s, %s)",
        (g.admin_user_id, event_id, action, Json(details)),
    )


# ---------------------------------------------------------------------------
# Approve — capture the authorisation (charge the card), publish the version,
# email the submitter. Failure state (plan §6): if the capture fails (hold
# lapsed / card died) keep the listing pending, email the submitter to re-pay,
# and do NOT publish.
# ---------------------------------------------------------------------------
@blueprint.route("/approve", methods=["POST"])
@admin_required
def approve():
    body = request.get_json(silent=True) or {}
    version_id = body.get("version_id")
    if not version_id:
        return jsonify({"code": 400, "error": "version_id is required."}), 400

    # Read the version + payment first (own short transaction) so we can validate
    # state and decide on capture before opening the write transaction.
    try:
        with db_manager.get_cursor(commit=False) as cursor:
            row = _load_version_for_action(cursor, version_id)
    except psycopg2.Error:
        return jsonify({"code": 500, "error": "Database error occurred"}), 500

    if not row:
        return jsonify({"code": 404, "error": "Submission not found."}), 404
    if row["approval_status"] != "pending_review":
        return (
            jsonify({"code": 409, "error": f"Already {row['approval_status']}."}),
            409,
        )
    if not row["payment_intent_id"]:
        return jsonify({"code": 409, "error": "No payment is attached to this submission."}), 409

    event = _row_to_event(row)

    # Capture the hold — UNLESS it was already captured in a reconciliation window
    # (webhook set payments.status='captured' after a prior partial approve). A
    # cancelled/released hold can no longer be approved.
    already_captured = row["payment_status"] == "captured"
    if not already_captured:
        if row["payment_status"] != "authorised":
            return (
                jsonify(
                    {
                        "code": 409,
                        "error": "This authorisation is no longer active "
                        f"(status: {row['payment_status']}). Ask the submitter to resubmit.",
                    }
                ),
                409,
            )
        try:
            capture_intent(row["payment_intent_id"])
        except stripe.error.StripeError:
            # approve-but-capture-fails (plan §6): keep pending, do NOT publish,
            # email the submitter to re-pay, and record the failed attempt.
            try:
                with db_manager.get_cursor() as cursor:
                    _log_action(
                        cursor,
                        row["event_id"],
                        "capture_failed",
                        {
                            "version_id": version_id,
                            "payment_intent_id": row["payment_intent_id"],
                        },
                    )
            except psycopg2.Error:
                pass
            send_repay_required(
                row["submitter_email"], event, row["amount"], row["currency"]
            )
            return (
                jsonify(
                    {
                        "code": 402,
                        "error": "The card authorisation could not be captured "
                        "(it may have expired). The submitter has been asked to "
                        "resubmit; the listing was not published.",
                    }
                ),
                402,
            )

    # Capture succeeded (or was already captured). Publish transactionally:
    # payment -> captured, mint a unique slug, repoint the event to this version,
    # mark the version approved, log the action.
    try:
        with db_manager.get_cursor() as cursor:
            if not already_captured:
                cursor.execute(
                    "UPDATE payments SET status = 'captured', captured_at = now() "
                    "WHERE id = %s",
                    (row["payment_id"],),
                )

            slug = generate_unique_slug(cursor, row["name"], row["city"])

            cursor.execute(
                "UPDATE events "
                "SET published_version_id = %s, current_status = 'published', slug = %s "
                "WHERE id = %s",
                (version_id, slug, row["event_id"]),
            )
            cursor.execute(
                "UPDATE event_versions "
                "SET approval_status = 'approved', reviewed_at = now() "
                "WHERE id = %s",
                (version_id,),
            )
            _log_action(
                cursor,
                row["event_id"],
                "approve",
                {
                    "version_id": version_id,
                    "slug": slug,
                    "payment_intent_id": row["payment_intent_id"],
                    "captured": True,
                    "amount": float(row["amount"]) if row["amount"] is not None else None,
                    "currency": row["currency"],
                },
            )
    except psycopg2.Error:
        # The charge is captured but publishing failed — a rare inconsistency.
        # The payment webhook still reconciles payments.status; the admin can
        # retry approve (capture is skipped via the already_captured path).
        return (
            jsonify(
                {
                    "code": 500,
                    "error": "The card was charged but publishing failed. "
                    "Please retry approve.",
                }
            ),
            500,
        )

    public_url = f"{_PUBLIC_EVENT_BASE_URL}/{slug}"
    send_approved(row["submitter_email"], event, row["amount"], row["currency"], public_url)

    return (
        jsonify(
            {
                "code": 200,
                "data": {
                    "event_id": row["event_id"],
                    "version_id": version_id,
                    "status": "published",
                    "slug": slug,
                    "public_url": public_url,
                },
            }
        ),
        200,
    )


# ---------------------------------------------------------------------------
# Reject — cancel the authorisation (free release, NOT a refund: nothing was
# captured), store the admin's reason on the version, email the submitter.
# ---------------------------------------------------------------------------
@blueprint.route("/reject", methods=["POST"])
@admin_required
def reject():
    body = request.get_json(silent=True) or {}
    version_id = body.get("version_id")
    reason = (body.get("reason") or "").strip()
    if not version_id:
        return jsonify({"code": 400, "error": "version_id is required."}), 400

    try:
        with db_manager.get_cursor(commit=False) as cursor:
            row = _load_version_for_action(cursor, version_id)
    except psycopg2.Error:
        return jsonify({"code": 500, "error": "Database error occurred"}), 500

    if not row:
        return jsonify({"code": 404, "error": "Submission not found."}), 404
    if row["approval_status"] != "pending_review":
        return jsonify({"code": 409, "error": f"Already {row['approval_status']}."}), 409

    event = _row_to_event(row)

    # Release the hold first (free — plan §6). Best-effort: cancel_intent swallows
    # Stripe errors so a webhook-race that already cancelled it doesn't block the
    # rejection. We still set the DB status to 'cancelled' in the transaction.
    if row["payment_intent_id"] and row["payment_status"] == "authorised":
        cancel_intent(row["payment_intent_id"])

    try:
        with db_manager.get_cursor() as cursor:
            if row["payment_id"] and row["payment_status"] == "authorised":
                cursor.execute(
                    "UPDATE payments SET status = 'cancelled' WHERE id = %s",
                    (row["payment_id"],),
                )
            cursor.execute(
                "UPDATE event_versions "
                "SET approval_status = 'rejected', rejection_reason = %s, reviewed_at = now() "
                "WHERE id = %s",
                (reason or None, version_id),
            )
            # First-submission rejection: the event has no live version, so mark
            # the event rejected too. (A rejected POST-approval edit would leave
            # the still-published event alone — that path arrives in 4B.)
            if row["published_version_id"] is None:
                cursor.execute(
                    "UPDATE events SET current_status = 'rejected' WHERE id = %s",
                    (row["event_id"],),
                )
            _log_action(
                cursor,
                row["event_id"],
                "reject",
                {
                    "version_id": version_id,
                    "reason": reason or None,
                    "payment_intent_id": row["payment_intent_id"],
                },
            )
    except psycopg2.Error:
        return jsonify({"code": 500, "error": "Could not record the rejection. Please retry."}), 500

    send_rejected(row["submitter_email"], event, reason)

    return (
        jsonify(
            {
                "code": 200,
                "data": {
                    "event_id": row["event_id"],
                    "version_id": version_id,
                    "status": "rejected",
                },
            }
        ),
        200,
    )


def _row_to_event(row):
    """Shape a joined action row into the dict the notification helpers expect."""
    return {
        "name": row["name"],
        "submitter_email": row["submitter_email"],
        "start_datetime": row["start_datetime"],
        "end_datetime": row["end_datetime"],
        "city": row["city"],
        "country": row["country"],
    }
