# scripts/admin.py — the admin backstage API (plan §5.3 / §6 / §7 / §8). Prefix /admin.
#
#   POST /admin/login     issue a signed admin session (mirrors §A6 login UX)
#   GET  /admin/pending   the review queue: pending versions + payment + image + dup flag
#   POST /admin/approve   capture the hold -> publish -> approval email   [GUARDED]
#                         (edit-approval variant: repoint published_version_id +
#                          keep the slug, no capture — plan §7)
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
from event_versioning import create_edit_version
from geo_reference import load_geo
from magic_links import create_conversation_link
from notifications import (
    send_admin_message,
    send_approved,
    send_edit_approved,
    send_listing_updated,
    send_rejected,
    send_repay_required,
)
from organiser_names import OrganiserNameConflict
from payments import cancel_intent, capture_intent
from slugs import generate_unique_slug
from submission_validation import validate_additional_images, validate_submission

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
                    ev.region,
                    ev.latitude::double precision  AS latitude,
                    ev.longitude::double precision AS longitude,
                    ev.place_id,
                    ev.postcode,
                    ev.description,
                    ev.link,
                    ev.contact_email,
                    ev.image_url,
                    ev.submission_type,
                    ev.drink_categories,
                    ev.event_format,
                    -- Public organiser name (EP-7) so the reviewer sees it; its
                    -- owner is the event's submitter_email (also selected below).
                    ev.organiser_name,
                    -- Per-date schedule (EP-6) so the reviewer sees every date and
                    -- the admin edit modal prefills the multi-date table. '[]' for a
                    -- legacy version (implied single occurrence from the scalars).
                    COALESCE((
                        SELECT json_agg(json_build_object('start', o.starts_at, 'end', o.ends_at)
                                        ORDER BY o.sort_order, o.starts_at)
                        FROM event_occurrences o WHERE o.event_version_id = ev.id
                    ), '[]'::json)       AS occurrences,
                    -- Additional images (post-go-live feature) so the admin edit
                    -- modal (AdminEditModal.buildContext) can prefill the set.
                    COALESCE((
                        SELECT json_agg(json_build_object('url', f.url, 's3_key', f.s3_key,
                                                           'content_type', f.content_type)
                                        ORDER BY f.sort_order)
                        FROM files f WHERE f.event_version_id = ev.id AND f.sort_order > 0
                    ), '[]'::json)       AS additional_images,
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
                  AND e.archived = FALSE
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
            e.slug,
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


def _publish_edit_version(cursor, event_id, version_id):
    """Repoint an event's live version to `version_id` and mark it approved,
    KEEPING the existing slug (an edit doesn't change the URL — plan §7). Shared by
    the edit-approval path in approve() and the direct admin-edit endpoint. Runs in
    the caller's transaction; the caller logs the action."""
    cursor.execute(
        "UPDATE events SET published_version_id = %s WHERE id = %s",
        (version_id, event_id),
    )
    cursor.execute(
        "UPDATE event_versions "
        "SET approval_status = 'approved', reviewed_at = now() "
        "WHERE id = %s",
        (version_id,),
    )


def _load_active_taxonomy():
    """Active taxonomy label sets to validate an admin edit against (plan §7 — the
    DB is the source of truth). Mirrors scripts/edits.py."""
    with db_manager.get_cursor(commit=False) as cursor:
        cursor.execute("SELECT label FROM drink_categories WHERE active = TRUE")
        categories = {row["label"] for row in cursor.fetchall()}
        cursor.execute("SELECT label FROM event_formats WHERE active = TRUE")
        formats = {row["label"] for row in cursor.fetchall()}
    return categories, formats


def _load_geo():
    """Canonical country/region reference for validating an admin edit (EP-2)."""
    with db_manager.get_cursor(commit=False) as cursor:
        return load_geo(cursor)


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

    event = _row_to_event(row)

    # -----------------------------------------------------------------------
    # EDIT-APPROVAL PATH (plan §7 / Phase-5 heads-up note). If the event is
    # ALREADY published, this pending version is a POST-approval EDIT (created via
    # magic-link editing). Approving it just REPOINTS published_version_id to the
    # new version and KEEPS the existing slug — no Stripe capture, because edits
    # are free at MVP and carry no payment. This is a distinct code path from the
    # first-approval capture-and-mint-slug flow below.
    # -----------------------------------------------------------------------
    if row["published_version_id"] is not None:
        try:
            with db_manager.get_cursor() as cursor:
                _publish_edit_version(cursor, row["event_id"], version_id)
                _log_action(
                    cursor,
                    row["event_id"],
                    "approve_edit",
                    {
                        "version_id": version_id,
                        "slug": row["slug"],
                        "previous_published_version_id": row["published_version_id"],
                    },
                )
        except psycopg2.Error:
            return jsonify({"code": 500, "error": "Could not publish the edit. Please retry."}), 500

        public_url = f"{_PUBLIC_EVENT_BASE_URL}/{row['slug']}" if row["slug"] else None
        send_edit_approved(row["submitter_email"], event, public_url)
        return (
            jsonify(
                {
                    "code": 200,
                    "data": {
                        "event_id": row["event_id"],
                        "version_id": version_id,
                        "status": "published",
                        "slug": row["slug"],
                        "public_url": public_url,
                        "edit": True,
                    },
                }
            ),
            200,
        )

    # First-approval path: a payment (the authorised hold) must be present.
    if not row["payment_intent_id"]:
        return jsonify({"code": 409, "error": "No payment is attached to this submission."}), 409

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


# ---------------------------------------------------------------------------
# Admin content edit (post-launch feature) — the admin edits a listing directly,
# distinct from proposing changes via the messaging thread. Reuses the shared
# edit-versioning core so history is retained (no in-place mutation of an
# "immutable" snapshot — plan §7):
#   • PENDING event  -> a new admin-authored pending version, the authorised hold
#     moved onto it, the prior pending version superseded. Stays pending; the admin
#     approves→captures separately. No email (still under review).
#   • PUBLISHED event -> a new version that goes LIVE immediately (repoint + keep
#     slug — the admin IS the approval authority, no pending round-trip). The
#     "we updated your listing" email is sent ONLY when the admin opted in AND the
#     edit went live (owner rule): notify=true + a non-empty notify_message.
# ---------------------------------------------------------------------------
@blueprint.route("/edit", methods=["POST"])
@admin_required
def edit():
    body = request.get_json(silent=True) or {}
    version_id = body.get("version_id")
    event_fields = body.get("event") or {}
    notify = bool(body.get("notify"))
    notify_message = (body.get("notify_message") or "").strip()
    # Post-go-live "additional images" feature: the form always resends the
    # current full list (round-trip pattern, like drink_categories/occurrences).
    additional_images = body.get("additional_images") or []
    if not version_id:
        return jsonify({"code": 400, "error": "version_id is required."}), 400

    # Re-validate the edited fields server-side against the live taxonomy (plan §7 —
    # never trust the client), same validators as a fresh submission / submitter edit.
    try:
        allowed_categories, allowed_formats = _load_active_taxonomy()
        geo = _load_geo()
    except psycopg2.Error:
        return jsonify({"code": 500, "error": "Database error occurred"}), 500

    # require_address_selection=False: like the submitter edit paths, an admin edit
    # of a prefilled/legacy address must not be forced through a re-pick (coords
    # carry forward in the versioning layer).
    cleaned, errors = validate_submission(
        event_fields, allowed_categories, allowed_formats, geo,
        require_address_selection=False,
    )
    cleaned_additional_images, additional_image_errors = validate_additional_images(additional_images)
    errors.extend(additional_image_errors)
    if errors:
        return jsonify({"code": 400, "error": "Validation failed", "errors": errors}), 400

    try:
        with db_manager.get_cursor() as cursor:
            row = _load_version_for_action(cursor, version_id)
            if not row:
                return jsonify({"code": 404, "error": "Submission not found."}), 404

            is_published_event = row["published_version_id"] is not None
            # For a not-yet-published event we only edit the version under review.
            if not is_published_event and row["approval_status"] != "pending_review":
                return (
                    jsonify({"code": 409, "error": f"Cannot edit a {row['approval_status']} version."}),
                    409,
                )

            new_version_id, was_published = create_edit_version(
                cursor,
                row["event_id"],
                row["published_version_id"],
                cleaned,
                supersede_reason="Superseded by an admin edit",
                additional_images=cleaned_additional_images,
            )

            # Published event: the admin's edit goes live at once (repoint + keep slug).
            if was_published:
                _publish_edit_version(cursor, row["event_id"], new_version_id)

            _log_action(
                cursor,
                row["event_id"],
                "admin_edit",
                {
                    "from_version_id": version_id,
                    "new_version_id": new_version_id,
                    "was_published": was_published,
                    "notified": bool(was_published and notify and notify_message),
                },
            )
    except OrganiserNameConflict as exc:
        return jsonify({"code": 409, "error": str(exc)}), 409
    except psycopg2.Error:
        return jsonify({"code": 500, "error": "Could not save the edit. Please retry."}), 500

    # Notify the submitter ONLY for a live edit they were told about (owner rule):
    # opted in + wrote a note + the edit actually went live. Best-effort, post-commit.
    notified = False
    if was_published and notify and notify_message:
        public_url = f"{_PUBLIC_EVENT_BASE_URL}/{row['slug']}" if row["slug"] else None
        # Recipient is the event's original submitter (never the form field, which
        # the admin could have changed); content fields come from the new version.
        email_event = {
            "name": cleaned["name"],
            "start_datetime": cleaned["start_datetime"],
            "end_datetime": cleaned["end_datetime"],
            "city": cleaned["city"],
            "country": cleaned["country"],
        }
        send_listing_updated(row["submitter_email"], email_event, notify_message, public_url)
        notified = True

    return (
        jsonify(
            {
                "code": 200,
                "data": {
                    "event_id": row["event_id"],
                    "new_version_id": new_version_id,
                    "was_published": was_published,
                    "status": "published" if was_published else "pending_review",
                    "notified": notified,
                },
            }
        ),
        200,
    )


# ===========================================================================
# Phase 4B — live-listing management, version history, analytics, pricing CRUD.
# All endpoints are @admin_required (backstage-only); UNPUBLISH is one of the
# plan §5.3 carve-out four (it changes a live listing) so its server-side guard
# is load-bearing, not just UX.
# ===========================================================================


# ---------------------------------------------------------------------------
# Live listings — every event that has been published at least once (has a
# published_version_id), with its live version's detail. The UI groups these by
# status: currently-live (published & upcoming), past (published & ended, shown
# muted/badged — plan §8), and off-board (unpublished / auto-expired). version
# count drives the "view history" affordance.
# ---------------------------------------------------------------------------
@blueprint.route("/live", methods=["GET"])
@admin_required
def live():
    try:
        with db_manager.get_cursor(commit=False) as cursor:
            cursor.execute(
                """
                SELECT
                    e.id                 AS event_id,
                    e.slug,
                    e.current_status,
                    e.submitter_email,
                    e.created_at,
                    e.published_version_id,
                    pv.id                AS version_id,
                    pv.version_number,
                    pv.name,
                    pv.start_datetime,
                    pv.end_datetime,
                    pv.venue_name,
                    pv.venue_address,
                    pv.city,
                    pv.country,
                    pv.region,
                    pv.latitude::double precision  AS latitude,
                    pv.longitude::double precision AS longitude,
                    pv.place_id,
                    pv.postcode,
                    pv.image_url,
                    pv.event_format,
                    pv.drink_categories,
                    -- full content fields so the admin EDIT form prefills completely
                    pv.description,
                    pv.link,
                    pv.contact_email,
                    pv.submission_type,
                    -- Public organiser name (EP-7) — shown to the reviewer + prefills
                    -- the admin edit modal; owner is e.submitter_email above.
                    pv.organiser_name,
                    -- Per-date schedule (EP-6) for the date-count display + the
                    -- admin edit modal's multi-date table prefill.
                    COALESCE((
                        SELECT json_agg(json_build_object('start', o.starts_at, 'end', o.ends_at)
                                        ORDER BY o.sort_order, o.starts_at)
                        FROM event_occurrences o WHERE o.event_version_id = pv.id
                    ), '[]'::json)       AS occurrences,
                    -- Additional images (post-go-live feature) so the admin edit
                    -- modal (AdminEditModal.buildContext) can prefill the set.
                    COALESCE((
                        SELECT json_agg(json_build_object('url', f.url, 's3_key', f.s3_key,
                                                           'content_type', f.content_type)
                                        ORDER BY f.sort_order)
                        FROM files f WHERE f.event_version_id = pv.id AND f.sort_order > 0
                    ), '[]'::json)       AS additional_images,
                    (pv.end_datetime IS NOT NULL AND pv.end_datetime < now()) AS is_past,
                    (SELECT count(*) FROM event_versions ev2 WHERE ev2.event_id = e.id)
                                         AS version_count,
                    pay.status           AS payment_status,
                    pay.amount,
                    pay.currency,
                    pay.captured_at
                FROM events e
                JOIN event_versions pv ON pv.id = e.published_version_id
                LEFT JOIN LATERAL (
                    SELECT status, amount, currency, captured_at
                    FROM payments
                    WHERE event_version_id = pv.id
                    ORDER BY id DESC
                    LIMIT 1
                ) pay ON TRUE
                WHERE e.published_version_id IS NOT NULL
                ORDER BY pv.start_datetime ASC NULLS LAST
                """
            )
            rows = cursor.fetchall()
    except psycopg2.Error:
        return jsonify({"code": 500, "error": "Database error occurred"}), 500

    return jsonify({"code": 200, "data": [dict(r) for r in rows]}), 200


# ---------------------------------------------------------------------------
# Unpublish — the plan §5.3 carve-out. Take a currently-live listing off the
# board: events.current_status='unpublished' (it drops out of the public/live
# views) and log the action. The published_version_id and full history are kept
# so it can be re-approved/re-published later; no money moves here (the fee was
# already captured at approval).
# ---------------------------------------------------------------------------
@blueprint.route("/unpublish", methods=["POST"])
@admin_required
def unpublish():
    body = request.get_json(silent=True) or {}
    event_id = body.get("event_id")
    reason = (body.get("reason") or "").strip()
    if not event_id:
        return jsonify({"code": 400, "error": "event_id is required."}), 400

    try:
        with db_manager.get_cursor() as cursor:
            cursor.execute(
                "SELECT id, current_status, published_version_id "
                "FROM events WHERE id = %s FOR UPDATE",
                (event_id,),
            )
            row = cursor.fetchone()
            if not row:
                return jsonify({"code": 404, "error": "Listing not found."}), 404
            # Only a currently-published listing can be unpublished.
            if row["current_status"] != "published":
                return (
                    jsonify(
                        {
                            "code": 409,
                            "error": f"Listing is not live (status: {row['current_status']}).",
                        }
                    ),
                    409,
                )

            cursor.execute(
                "UPDATE events SET current_status = 'unpublished' WHERE id = %s",
                (event_id,),
            )
            _log_action(
                cursor,
                event_id,
                "unpublish",
                {
                    "published_version_id": row["published_version_id"],
                    "reason": reason or None,
                },
            )
    except psycopg2.Error:
        return jsonify({"code": 500, "error": "Could not unpublish. Please retry."}), 500

    return (
        jsonify(
            {
                "code": 200,
                "data": {"event_id": event_id, "status": "unpublished"},
            }
        ),
        200,
    )


# ---------------------------------------------------------------------------
# Version history (DISPLAY-ONLY in 4B — plan note). The full version chain for one
# event, oldest first, marking which row is the currently-published one. This
# renders the §7 versioning story: pre-approval edits are additional pending
# versions; a post-approval edit is a new pending version that, once approved,
# repoints published_version_id. (The endpoint that CREATES post-approval edit
# versions is Phase 5 magic-link editing — there is no edit endpoint yet.)
# ---------------------------------------------------------------------------
@blueprint.route("/versions", methods=["GET"])
@admin_required
def versions():
    event_id = request.args.get("event_id")
    if not event_id:
        return jsonify({"code": 400, "error": "event_id is required."}), 400

    try:
        with db_manager.get_cursor(commit=False) as cursor:
            cursor.execute(
                "SELECT id, published_version_id, current_status, slug, submitter_email "
                "FROM events WHERE id = %s",
                (event_id,),
            )
            event = cursor.fetchone()
            if not event:
                return jsonify({"code": 404, "error": "Listing not found."}), 404

            cursor.execute(
                """
                SELECT
                    ev.id                AS version_id,
                    ev.version_number,
                    ev.approval_status,
                    ev.name,
                    ev.start_datetime,
                    ev.end_datetime,
                    ev.city,
                    ev.country,
                    ev.created_at,
                    ev.reviewed_at,
                    ev.rejection_reason,
                    (ev.id = %s)         AS is_published,
                    pay.status           AS payment_status,
                    pay.amount,
                    pay.currency
                FROM event_versions ev
                LEFT JOIN LATERAL (
                    SELECT status, amount, currency
                    FROM payments
                    WHERE event_version_id = ev.id
                    ORDER BY id DESC
                    LIMIT 1
                ) pay ON TRUE
                WHERE ev.event_id = %s
                ORDER BY ev.version_number ASC, ev.id ASC
                """,
                (event["published_version_id"], event_id),
            )
            chain = [dict(r) for r in cursor.fetchall()]
    except psycopg2.Error:
        return jsonify({"code": 500, "error": "Database error occurred"}), 500

    return (
        jsonify(
            {
                "code": 200,
                "data": {
                    "event": dict(event),
                    "versions": chain,
                },
            }
        ),
        200,
    )


# ---------------------------------------------------------------------------
# Analytics — status counts + a captured-revenue tally + an expiring-soon list
# (authorised holds ordered by capture_before, driving the dashboard countdown;
# the idx_payments_status_capture index supports the scan — plan §8).
# ---------------------------------------------------------------------------
@blueprint.route("/analytics", methods=["GET"])
@admin_required
def analytics():
    try:
        with db_manager.get_cursor(commit=False) as cursor:
            cursor.execute(
                "SELECT current_status, count(*) AS n FROM events GROUP BY current_status"
            )
            status_counts = {r["current_status"]: r["n"] for r in cursor.fetchall()}

            cursor.execute(
                """
                SELECT
                    count(*) FILTER (WHERE status = 'captured')            AS captured_count,
                    COALESCE(sum(amount) FILTER (WHERE status = 'captured'), 0) AS captured_amount,
                    count(*) FILTER (WHERE status = 'authorised')          AS held_count,
                    count(*) FILTER (WHERE status = 'auto_released')       AS auto_released_count,
                    count(*) FILTER (WHERE status = 'cancelled')           AS cancelled_count
                FROM payments
                """
            )
            payments_summary = dict(cursor.fetchone())

            cursor.execute(
                """
                SELECT
                    ev.event_id,
                    ev.id                AS version_id,
                    ev.name,
                    ev.start_datetime,
                    e.submitter_email,
                    p.capture_before,
                    p.amount,
                    p.currency
                FROM payments p
                JOIN event_versions ev ON ev.id = p.event_version_id
                JOIN events e ON e.id = ev.event_id
                WHERE p.status = 'authorised'
                  AND ev.approval_status = 'pending_review'
                ORDER BY p.capture_before ASC NULLS LAST
                """
            )
            expiring_soon = [dict(r) for r in cursor.fetchall()]
    except psycopg2.Error:
        return jsonify({"code": 500, "error": "Database error occurred"}), 500

    return (
        jsonify(
            {
                "code": 200,
                "data": {
                    "status_counts": status_counts,
                    "payments": payments_summary,
                    "expiring_soon": expiring_soon,
                },
            }
        ),
        200,
    )


# ---------------------------------------------------------------------------
# Pricing-tier CRUD (plan §6/§7). The submission flow reads the active tier as
# `WHERE active = TRUE ORDER BY id LIMIT 1` (submissions.py) — so to keep new
# submissions DETERMINISTIC we enforce a SINGLE-ACTIVE invariant here: writing a
# tier as active deactivates every other tier in the same transaction, so at most
# one tier is ever active and that ORDER BY ... LIMIT 1 always resolves to it.
# ---------------------------------------------------------------------------
def _deactivate_other_tiers(cursor, keep_id):
    """Enforce the single-active invariant: clear `active` on every tier except
    keep_id. Called whenever a tier is written active."""
    cursor.execute(
        "UPDATE pricing_tiers SET active = FALSE WHERE id <> %s AND active = TRUE",
        (keep_id,),
    )


def _parse_tier_body(body):
    """Validate/coerce a pricing-tier write body. Returns (values, error) where
    values is (label, price Decimal, currency, featured_duration_days, active)."""
    from decimal import Decimal, InvalidOperation

    label = (body.get("label") or "").strip()
    if not label:
        return None, "A tier label is required."
    try:
        price = Decimal(str(body.get("price")))
    except (InvalidOperation, TypeError, ValueError):
        return None, "Price must be a number."
    if price < 0:
        return None, "Price cannot be negative."
    currency = (body.get("currency") or "USD").strip().upper()
    if len(currency) != 3:
        return None, "Currency must be a 3-letter ISO code."
    featured = body.get("featured_duration_days")
    if featured in ("", None):
        featured = None
    else:
        try:
            featured = int(featured)
        except (TypeError, ValueError):
            return None, "Featured duration must be a whole number of days."
    active = bool(body.get("active", True))
    return (label, price, currency, featured, active), None


@blueprint.route("/pricing-tiers", methods=["GET"])
@admin_required
def list_pricing_tiers():
    try:
        with db_manager.get_cursor(commit=False) as cursor:
            cursor.execute(
                "SELECT id, label, price, currency, featured_duration_days, active "
                "FROM pricing_tiers ORDER BY id ASC"
            )
            rows = [dict(r) for r in cursor.fetchall()]
    except psycopg2.Error:
        return jsonify({"code": 500, "error": "Database error occurred"}), 500
    return jsonify({"code": 200, "data": rows}), 200


@blueprint.route("/pricing-tiers", methods=["POST"])
@admin_required
def create_pricing_tier():
    values, error = _parse_tier_body(request.get_json(silent=True) or {})
    if error:
        return jsonify({"code": 400, "error": error}), 400
    label, price, currency, featured, active = values
    try:
        with db_manager.get_cursor() as cursor:
            cursor.execute(
                "INSERT INTO pricing_tiers (label, price, currency, featured_duration_days, active) "
                "VALUES (%s, %s, %s, %s, %s) RETURNING id",
                (label, price, currency, featured, active),
            )
            tier_id = cursor.fetchone()["id"]
            if active:
                _deactivate_other_tiers(cursor, tier_id)
            _log_action(cursor, None, "pricing_tier_create",
                        {"tier_id": tier_id, "label": label, "active": active})
    except psycopg2.Error:
        return jsonify({"code": 500, "error": "Could not create the tier. Please retry."}), 500
    return jsonify({"code": 200, "data": {"id": tier_id}}), 200


@blueprint.route("/pricing-tiers/<int:tier_id>", methods=["PUT"])
@admin_required
def update_pricing_tier(tier_id):
    values, error = _parse_tier_body(request.get_json(silent=True) or {})
    if error:
        return jsonify({"code": 400, "error": error}), 400
    label, price, currency, featured, active = values
    try:
        with db_manager.get_cursor() as cursor:
            cursor.execute("SELECT id FROM pricing_tiers WHERE id = %s", (tier_id,))
            if not cursor.fetchone():
                return jsonify({"code": 404, "error": "Tier not found."}), 404
            cursor.execute(
                "UPDATE pricing_tiers "
                "SET label = %s, price = %s, currency = %s, "
                "    featured_duration_days = %s, active = %s "
                "WHERE id = %s",
                (label, price, currency, featured, active, tier_id),
            )
            if active:
                _deactivate_other_tiers(cursor, tier_id)
            _log_action(cursor, None, "pricing_tier_update",
                        {"tier_id": tier_id, "label": label, "active": active})
    except psycopg2.Error:
        return jsonify({"code": 500, "error": "Could not update the tier. Please retry."}), 500
    return jsonify({"code": 200, "data": {"id": tier_id}}), 200


@blueprint.route("/pricing-tiers/<int:tier_id>", methods=["DELETE"])
@admin_required
def delete_pricing_tier(tier_id):
    try:
        with db_manager.get_cursor() as cursor:
            cursor.execute("SELECT active FROM pricing_tiers WHERE id = %s", (tier_id,))
            row = cursor.fetchone()
            if not row:
                return jsonify({"code": 404, "error": "Tier not found."}), 404
            # Refuse to delete the only remaining tier: submissions need one to
            # price against (submissions.py returns 500 with no active tier).
            cursor.execute("SELECT count(*) AS n FROM pricing_tiers")
            if cursor.fetchone()["n"] <= 1:
                return (
                    jsonify(
                        {
                            "code": 409,
                            "error": "Cannot delete the last pricing tier — "
                            "create another first.",
                        }
                    ),
                    409,
                )
            cursor.execute("DELETE FROM pricing_tiers WHERE id = %s", (tier_id,))
            _log_action(cursor, None, "pricing_tier_delete", {"tier_id": tier_id})
    except psycopg2.Error:
        return jsonify({"code": 500, "error": "Could not delete the tier. Please retry."}), 500
    return jsonify({"code": 200, "data": {"id": tier_id, "deleted": True}}), 200


# ===========================================================================
# Messaging — the admin side of the admin⇄submitter conversation thread
# (post-launch feature). The submitter side is the PUBLIC, token-gated
# scripts/messages.py. Web-link replies only: the admin's message is emailed with
# a link to a page on our own site; the submitter never emails us back.
#
# FREEZE RULE (owner decision): a conversation is OPEN only while the event is
# 'pending_review'. Once the event goes live / is withdrawn / otherwise resolves,
# the thread is read-only — the admin can view it but not post. So POST refuses
# unless the event is pending_review; GET always works (viewing history).
# ===========================================================================


def _event_message_context(cursor, event_id):
    """Fetch the event's display name (published version, else latest), submitter,
    status and slug — the context both message endpoints need. None if no event."""
    cursor.execute(
        """
        SELECT
            e.id                 AS event_id,
            e.submitter_email,
            e.current_status,
            e.slug,
            COALESCE(pv.name, lv.name) AS name
        FROM events e
        LEFT JOIN event_versions pv ON pv.id = e.published_version_id
        LEFT JOIN LATERAL (
            SELECT name FROM event_versions
            WHERE event_id = e.id
            ORDER BY version_number DESC, id DESC
            LIMIT 1
        ) lv ON TRUE
        WHERE e.id = %s
        """,
        (event_id,),
    )
    return cursor.fetchone()


def _thread_rows(cursor, event_id):
    """The full message thread for an event, oldest first."""
    cursor.execute(
        "SELECT id, sender, admin_user_id, body, created_at, read_by_admin "
        "FROM event_messages WHERE event_id = %s ORDER BY created_at ASC, id ASC",
        (event_id,),
    )
    return [dict(r) for r in cursor.fetchall()]


# ---------------------------------------------------------------------------
# Send a message to the submitter. Only allowed while the event is pending_review
# (the conversation freezes once it resolves). Emails the submitter the message +
# a magic reply link to the public conversation page.
# ---------------------------------------------------------------------------
@blueprint.route("/messages", methods=["POST"])
@admin_required
def send_message():
    body = request.get_json(silent=True) or {}
    event_id = body.get("event_id")
    text = (body.get("body") or "").strip()
    if not event_id or not text:
        return jsonify({"code": 400, "error": "event_id and a message body are required."}), 400

    try:
        with db_manager.get_cursor() as cursor:
            ctx = _event_message_context(cursor, event_id)
            if not ctx:
                return jsonify({"code": 404, "error": "Listing not found."}), 404
            if ctx["current_status"] != "pending_review":
                return (
                    jsonify(
                        {
                            "code": 409,
                            "error": "This conversation is closed — the listing is no "
                            f"longer under review (status: {ctx['current_status']}).",
                        }
                    ),
                    409,
                )

            cursor.execute(
                "INSERT INTO event_messages (event_id, sender, admin_user_id, body, "
                "read_by_admin, email_sent) VALUES (%s, 'admin', %s, %s, TRUE, TRUE) "
                "RETURNING id",
                (event_id, g.admin_user_id, text),
            )
            message_id = cursor.fetchone()["id"]

            # Fresh reply link (indefinite expiry; the real gate is the event state).
            raw_token, _ = create_conversation_link(cursor, event_id)
            _log_action(cursor, event_id, "admin_message", {"message_id": message_id})
    except psycopg2.Error:
        return jsonify({"code": 500, "error": "Could not send the message. Please retry."}), 500

    reply_url = f"{_PUBLIC_EVENT_BASE_URL}/conversation?token={raw_token}"
    send_admin_message(ctx["submitter_email"], {"name": ctx["name"]}, text, reply_url)

    return jsonify({"code": 200, "data": {"event_id": event_id, "message_id": message_id}}), 200


# ---------------------------------------------------------------------------
# Read a thread (any status — viewing a frozen thread is fine) and mark the
# submitter's messages read so the unread badge clears.
# ---------------------------------------------------------------------------
@blueprint.route("/messages", methods=["GET"])
@admin_required
def get_thread():
    event_id = request.args.get("event_id")
    if not event_id:
        return jsonify({"code": 400, "error": "event_id is required."}), 400

    try:
        with db_manager.get_cursor() as cursor:
            ctx = _event_message_context(cursor, event_id)
            if not ctx:
                return jsonify({"code": 404, "error": "Listing not found."}), 404
            cursor.execute(
                "UPDATE event_messages SET read_by_admin = TRUE "
                "WHERE event_id = %s AND sender = 'submitter' AND read_by_admin = FALSE",
                (event_id,),
            )
            messages = _thread_rows(cursor, event_id)
    except psycopg2.Error:
        return jsonify({"code": 500, "error": "Database error occurred"}), 500

    return (
        jsonify(
            {
                "code": 200,
                "data": {
                    "event": {
                        "event_id": ctx["event_id"],
                        "name": ctx["name"],
                        "submitter_email": ctx["submitter_email"],
                        "current_status": ctx["current_status"],
                        "slug": ctx["slug"],
                    },
                    "open": ctx["current_status"] == "pending_review",
                    "messages": messages,
                },
            }
        ),
        200,
    )


# ---------------------------------------------------------------------------
# Inbox — EVERY event that has any messages, most-recent activity first (owner
# request 2026-07-04: read conversations stay visible for the record). `unread`
# (submitter replies not yet read_by_admin) is a per-row count that still drives
# the red dot / dashboard badge, but a fully-read conversation now remains listed
# (unread = 0) instead of being filtered out.
# ---------------------------------------------------------------------------
@blueprint.route("/inbox", methods=["GET"])
@admin_required
def inbox():
    try:
        with db_manager.get_cursor(commit=False) as cursor:
            cursor.execute(
                """
                SELECT
                    e.id                 AS event_id,
                    e.slug,
                    e.current_status,
                    e.submitter_email,
                    COALESCE(pv.name, lv.name) AS name,
                    count(*) FILTER (
                        WHERE m.sender = 'submitter' AND m.read_by_admin = FALSE
                    )                    AS unread,
                    count(*)             AS total,
                    max(m.created_at)    AS last_message_at
                FROM event_messages m
                JOIN events e ON e.id = m.event_id
                LEFT JOIN event_versions pv ON pv.id = e.published_version_id
                LEFT JOIN LATERAL (
                    SELECT name FROM event_versions
                    WHERE event_id = e.id
                    ORDER BY version_number DESC, id DESC
                    LIMIT 1
                ) lv ON TRUE
                GROUP BY e.id, e.slug, e.current_status, e.submitter_email, pv.name, lv.name
                ORDER BY max(m.created_at) DESC
                """
            )
            rows = [dict(r) for r in cursor.fetchall()]
    except psycopg2.Error:
        return jsonify({"code": 500, "error": "Database error occurred"}), 500

    return jsonify({"code": 200, "data": rows}), 200
