# scripts/submissions.py — the public event submission endpoints (plan §8/§6).
# Prefix /submissions.
#
#   POST /submissions               (3a) multipart: validate + upload image, HOLD
#   POST /submissions/create-intent (3b) JSON: re-validate + authorise + persist
#
# ROUND 3a SCOPE (no payment): the first endpoint validates everything, uploads
# the image to the public bucket (SPEC §A5), and RETURNS the validated data +
# image URL as a "held" payload. It writes NOTHING to the DB — a half-written
# listing with no payment would pollute the pending queue. Only the image lands
# in the bucket (an abandoned submission at worst orphans that object; plan §6
# "abandoned checkout -> nothing persisted").
#
# ROUND 3b SCOPE (this round): /create-intent re-posts that held payload as JSON.
# The server RE-VALIDATES it (never trusts the client), reads the fee from the
# active pricing tier, authorises a manual-capture Stripe PaymentIntent, then
# persists events + event_versions + files + payments in ONE transaction and
# sends the two Phase-3 emails. The image is NOT re-uploaded — it is reused via
# the s3_key/url from the held payload. Failure states per plan §6:
#   - authorise ok but DB save fails -> cancel the intent (no orphan hold)
#   - card declined (authorise fails) -> retry prompt, nothing persisted, no
#     admin notification
#
# Abuse controls (plan §8): a honeypot field + per-IP rate limiting.
# Order of operations mirrors plan §6: validate the image BEFORE any upload, and
# authorise the card BEFORE persisting.

import json
import os

import psycopg2
from flask import Blueprint, jsonify, request
from psycopg2.extras import Json

from app import db_manager
from event_versioning import insert_occurrences
from geo_reference import load_geo
from magic_links import create_magic_link
from notifications import send_new_submission_admin, send_under_review
from payments import (
    cancel_intent,
    create_manual_capture_intent,
    derive_idempotency_key,
    read_capture_before,
    to_minor_units,
)
from rate_limit import RateLimiter, rate_limited
from s3_images import upload_image
from submission_validation import (
    DEFAULT_MAX_IMAGE_BYTES,
    HONEYPOT_FIELD,
    validate_image,
    validate_submission,
)

import stripe

file_name = os.path.basename(__file__)
blueprint = Blueprint(file_name[:-3], __name__)  # blueprint name == filename

# Per-IP limit: 5 submissions / 10 minutes. In-memory is correct for the single
# gevent worker (rate_limit.py explains the scaling caveat). Shared by both
# endpoints so the whole submit->pay attempt is bounded.
_limiter = RateLimiter(max_requests=5, window_seconds=600)

# Image size cap (env-overridable; defaults to 5 MB — submission_validation).
_MAX_IMAGE_BYTES = int(os.getenv("MAX_IMAGE_MB", "5")) * 1024 * 1024

# Public base for the pre-approval edit link emailed with the under-review
# confirmation (plan §7). Same env var + local default as admin.py / edits.py.
_PUBLIC_EVENT_BASE_URL = os.getenv(
    "PUBLIC_EVENT_BASE_URL", "http://localhost:8080/a/events"
).rstrip("/")


def _load_active_taxonomy():
    """Fetch the active taxonomy label sets to validate the submission against
    (plan §7 — the DB is the source of truth, not a hardcoded list)."""
    with db_manager.get_cursor() as cursor:
        cursor.execute("SELECT label FROM drink_categories WHERE active = TRUE")
        categories = {row["label"] for row in cursor.fetchall()}
        cursor.execute("SELECT label FROM event_formats WHERE active = TRUE")
        formats = {row["label"] for row in cursor.fetchall()}
    return categories, formats


def _load_geo():
    """Canonical country/region reference for validation (EP-2 — the DB is the
    single source of truth for the country + region lists)."""
    with db_manager.get_cursor(commit=False) as cursor:
        return load_geo(cursor)


def _parse_occurrences_field(raw):
    """Parse the multipart `occurrences` field (a JSON array string emitted by the
    multi-date form) into the list of {start, end} dicts the validator expects.
    Returns None when absent/blank/unparseable so validate_submission falls back to
    the single-date scalar path (EP-6). The 3b re-post carries `occurrences` as a
    real JSON list already, so only this multipart entry point needs the parse."""
    if not raw:
        return None
    try:
        value = json.loads(raw)
    except (ValueError, TypeError):
        return None
    return value if isinstance(value, list) else None


@blueprint.route("", methods=["POST"])
@rate_limited(_limiter)
def submit_event():
    # 1) Honeypot (plan §8): a bot fills the hidden field. Respond with a benign
    #    200 so the bot cannot distinguish rejection, but do NO work — the real
    #    flow needs the image URL this response withholds, so it dead-ends here.
    if (request.form.get(HONEYPOT_FIELD) or "").strip():
        return jsonify({"code": 200, "data": "received"}), 200

    # 2) Validate the non-file fields against the live taxonomy + geo reference.
    try:
        allowed_categories, allowed_formats = _load_active_taxonomy()
        geo = _load_geo()
    except psycopg2.Error:
        return jsonify({"code": 500, "error": "Database error occurred"}), 500

    data = {
        "name": request.form.get("name"),
        "submitter_email": request.form.get("submitter_email"),
        "contact_email": request.form.get("contact_email"),
        "start_datetime": request.form.get("start_datetime"),
        "end_datetime": request.form.get("end_datetime"),
        # Multi-date schedule (EP-6): a JSON array string when the submitter added
        # extra dates, else absent → the validator uses the scalar single-date path.
        "occurrences": _parse_occurrences_field(request.form.get("occurrences")),
        "venue_name": request.form.get("venue_name"),
        "venue_address": request.form.get("venue_address"),
        "country": request.form.get("country"),
        "city": request.form.get("city"),
        "region": request.form.get("region"),
        "latitude": request.form.get("latitude"),
        "longitude": request.form.get("longitude"),
        "place_id": request.form.get("place_id"),
        "postcode": request.form.get("postcode"),
        "description": request.form.get("description"),
        "link": request.form.get("link"),
        "event_format": request.form.get("event_format"),
        "submission_type": request.form.get("submission_type"),
        "drink_categories": request.form.getlist("drink_categories"),
    }
    cleaned, errors = validate_submission(data, allowed_categories, allowed_formats, geo)

    # 3) Validate the image BEFORE uploading (plan §6). Read the stream once; the
    #    bytes are reused for the upload so the file is never read twice.
    image_file = request.files.get("image")
    if image_file is None or not image_file.filename:
        errors.append("An event image is required.")
        image_bytes = None
    else:
        image_bytes = image_file.read()
        ok, image_error = validate_image(
            image_file.mimetype, image_bytes, max_bytes=_MAX_IMAGE_BYTES
        )
        if not ok:
            errors.append(image_error)

    if errors:
        return jsonify({"code": 400, "error": "Validation failed", "errors": errors}), 400

    # 4) Upload to the public bucket (§A5). Local stub needs our own host to build
    #    the served URL; S3 ignores it.
    try:
        image_record = upload_image(
            image_bytes, image_file.mimetype, stub_base_url=request.host_url
        )
    except RuntimeError:
        return jsonify({"code": 502, "error": "Image upload failed. Please try again."}), 502

    # 5) Return the HELD payload for the 3b payment/persist step. Not written to
    #    the DB yet (see the module docstring). The client re-submits this to
    #    create the PaymentIntent, and 3b re-validates before the transactional
    #    write.
    return (
        jsonify(
            {
                "code": 200,
                "data": {
                    "event": cleaned,
                    "image": {
                        "url": image_record["url"],
                        "s3_key": image_record["s3_key"],
                        "content_type": image_record["content_type"],
                        "size_bytes": image_record["size_bytes"],
                    },
                },
            }
        ),
        200,
    )


def _active_pricing_tier():
    """Read the fee from the active pricing_tiers row (plan §6: amount + currency
    come from the tier, seeded USD 5 — never a hardcoded constant). Returns
    (amount Decimal, currency str) or (None, None) if no active tier exists."""
    with db_manager.get_cursor(commit=False) as cursor:
        cursor.execute(
            "SELECT price, currency FROM pricing_tiers "
            "WHERE active = TRUE ORDER BY id LIMIT 1"
        )
        row = cursor.fetchone()
    if not row:
        return None, None
    return row["price"], row["currency"]


@blueprint.route("/create-intent", methods=["POST"])
@rate_limited(_limiter)
def create_intent():
    """3b: authorise the card and persist the submission transactionally.

    Body (JSON, the 3a held payload plus the payment method):
      { "event": {..cleaned fields..},
        "image": {"url","s3_key","content_type","size_bytes"},
        "payment_method_id": "pm_...",
        "idempotency_key": "<per-attempt uuid>" }
    """
    payload = request.get_json(silent=True) or {}
    event = payload.get("event") or {}
    image = payload.get("image") or {}
    payment_method_id = (payload.get("payment_method_id") or "").strip()
    idempotency_key = (payload.get("idempotency_key") or "").strip()

    # 1) Re-validate the held payload SERVER-SIDE — never trust what the client
    #    re-posts (plan §6). Same validators as 3a, against the live taxonomy.
    try:
        allowed_categories, allowed_formats = _load_active_taxonomy()
        geo = _load_geo()
    except psycopg2.Error:
        return jsonify({"code": 500, "error": "Database error occurred"}), 500

    cleaned, errors = validate_submission(event, allowed_categories, allowed_formats, geo)
    if not image.get("s3_key") or not image.get("url"):
        errors.append("Missing uploaded image reference. Please start over.")
    if not payment_method_id:
        errors.append("Missing payment details.")
    if errors:
        return jsonify({"code": 400, "error": "Validation failed", "errors": errors}), 400

    # 2) Fee from the active pricing tier (plan §6 — not a constant).
    amount, currency = _active_pricing_tier()
    if amount is None:
        return jsonify({"code": 500, "error": "No active pricing tier configured"}), 500
    amount_minor = to_minor_units(amount, currency)

    if not idempotency_key:
        idempotency_key = derive_idempotency_key(cleaned, image)

    # 3) AUTHORISE-FIRST (plan §6): create + confirm a manual-capture intent. A
    #    decline raises CardError here, BEFORE anything is persisted -> retry
    #    prompt, no admin notification, nothing half-written.
    try:
        intent = create_manual_capture_intent(
            amount_minor,
            currency,
            payment_method_id,
            idempotency_key,
            metadata={
                "event_name": cleaned["name"][:200],
                "submitter_email": cleaned["submitter_email"],
                "s3_key": image.get("s3_key", ""),
            },
        )
    except stripe.error.CardError as exc:
        return (
            jsonify(
                {
                    "code": 402,
                    "error": "Your card was declined. Please try a different "
                    "card — you have not been charged.",
                    "decline": (exc.error.code if getattr(exc, "error", None) else None),
                }
            ),
            402,
        )
    except stripe.error.StripeError:
        return jsonify({"code": 502, "error": "Payment could not be processed. Please try again."}), 502

    # 3-D Secure or any non-authorised terminal state: don't persist. The card
    # was not left holding funds we intend to keep — cancel to be safe and ask
    # the client to complete authentication / retry. (Test card 4242… never
    # hits this path; it authorises straight to requires_capture.)
    if intent.status != "requires_capture":
        cancel_intent(intent.id)
        return (
            jsonify(
                {
                    "code": 402,
                    "error": "Card authorisation could not be completed. Please try again.",
                    "status": intent.status,
                }
            ),
            402,
        )

    capture_before = read_capture_before(intent)

    # 4) PERSIST TRANSACTIONALLY (plan §6): events + event_versions + files +
    #    payments in ONE transaction. If any of it fails, get_cursor rolls back
    #    and we CANCEL the intent so no orphan hold is left on the card.
    try:
        with db_manager.get_cursor() as cursor:
            is_duplicate = _is_duplicate(cursor, cleaned)

            cursor.execute(
                "INSERT INTO events (submitter_email, current_status) "
                "VALUES (%s, 'pending_review') RETURNING id",
                (cleaned["submitter_email"],),
            )
            event_id = cursor.fetchone()["id"]

            cursor.execute(
                "INSERT INTO event_versions ("
                "  event_id, version_number, approval_status, name, start_datetime,"
                "  end_datetime, venue_name, venue_address, country, city, region,"
                "  latitude, longitude, place_id, postcode,"
                "  description, link, contact_email, image_url, submission_type,"
                "  drink_categories, event_format"
                ") VALUES (%s, 1, 'pending_review', %s, %s, %s, %s, %s, %s, %s, %s,"
                "          %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id",
                (
                    event_id,
                    cleaned["name"],
                    cleaned["start_datetime"],
                    cleaned["end_datetime"],
                    cleaned["venue_name"],
                    cleaned["venue_address"],
                    cleaned["country"],
                    cleaned["city"],
                    cleaned["region"],
                    cleaned["latitude"],
                    cleaned["longitude"],
                    cleaned["place_id"],
                    cleaned["postcode"],
                    cleaned["description"],
                    cleaned["link"],
                    cleaned["contact_email"],
                    image["url"],
                    cleaned["submission_type"],
                    cleaned["drink_categories"],
                    cleaned["event_format"],
                ),
            )
            version_id = cursor.fetchone()["id"]

            # Snapshot the per-date schedule for this version (EP-6), in the SAME
            # transaction. A single-date submission normalises to one row; the
            # scalar start/end above are the derived MIN/MAX summary of these rows.
            insert_occurrences(cursor, version_id, cleaned.get("occurrences"))

            cursor.execute(
                "INSERT INTO files ("
                "  event_version_id, s3_key, file_type, content_type, size_bytes, is_public"
                ") VALUES (%s, %s, 'image', %s, %s, TRUE)",
                (
                    version_id,
                    image["s3_key"],
                    image.get("content_type"),
                    image.get("size_bytes"),
                ),
            )

            cursor.execute(
                "INSERT INTO payments ("
                "  event_version_id, provider, payment_intent_id, amount, currency,"
                "  status, capture_before"
                ") VALUES (%s, 'stripe', %s, %s, %s, 'authorised', %s)",
                (version_id, intent.id, amount, currency, capture_before),
            )

            if is_duplicate:
                # Flag for the Phase-4 dashboard via the audit log (no schema
                # change needed); admin_user_id NULL = system-generated.
                cursor.execute(
                    "INSERT INTO admin_actions (event_id, action, details) "
                    "VALUES (%s, 'duplicate_flagged', %s)",
                    (
                        event_id,
                        Json(
                            {
                                "submitter_email": cleaned["submitter_email"],
                                "name": cleaned["name"],
                                "start_datetime": cleaned["start_datetime"],
                            }
                        ),
                    ),
                )

            # Mint a pre-approval edit link (plan §7) so the submitter can amend
            # this listing while it sits in the review queue — a still-pending
            # event has no public slug, so the manage page can't reach it; the
            # link in the under-review email is how they self-serve an edit. The
            # hash is stored in this same transaction; the raw token is emailed
            # below. 24-hour expiry (magic_links default).
            edit_token, _ = create_magic_link(cursor, event_id)

            # Read the admin recipient inside the same connection (used after
            # commit for the notification email).
            cursor.execute(
                "SELECT email FROM admin_users WHERE active = TRUE ORDER BY id LIMIT 1"
            )
            admin_row = cursor.fetchone()
            # Fall back to ADMIN_NOTIFY_EMAIL when no admin_users row is seeded
            # (the local seed is env-driven and optional — database/README.md).
            admin_email = admin_row["email"] if admin_row else os.getenv("ADMIN_NOTIFY_EMAIL")
    except Exception:
        # authorise-succeeds-but-DB-save-fails (plan §6): release the hold so the
        # submitter is never left with an orphan authorisation, then surface a
        # retryable error.
        cancel_intent(intent.id)
        return (
            jsonify(
                {
                    "code": 500,
                    "error": "We could not save your submission. Your card was "
                    "not charged — please try again.",
                }
            ),
            500,
        )

    # 5) Emails (best-effort, AFTER commit — plan §8). A mail failure must not
    #    undo the authorised, persisted submission (Phase-4 digest backstops it).
    #    The under-review email carries the pre-approval edit link (plan §7).
    edit_url = f"{_PUBLIC_EVENT_BASE_URL}/edit?token={edit_token}"
    send_under_review(cleaned["submitter_email"], cleaned, amount, currency, edit_url=edit_url)
    if admin_email:
        send_new_submission_admin(
            admin_email, cleaned, amount, currency, capture_before, is_duplicate
        )

    return (
        jsonify(
            {
                "code": 200,
                "data": {
                    "event_id": event_id,
                    "status": "pending_review",
                    "duplicate_flagged": is_duplicate,
                    "payment": {
                        "payment_intent_id": intent.id,
                        "status": "authorised",
                        "amount": float(amount),
                        "currency": currency,
                        "capture_before": capture_before.isoformat() if capture_before else None,
                    },
                },
            }
        ),
        200,
    )


def _is_duplicate(cursor, cleaned):
    """Dedupe on (submitter email + event name + event date) and FLAG it — the
    submission still goes through; the flag surfaces in the admin dashboard
    (plan §6). Name match is case-insensitive; date is the start_datetime's
    calendar date."""
    cursor.execute(
        "SELECT ev.id FROM event_versions ev "
        "JOIN events e ON ev.event_id = e.id "
        "WHERE lower(e.submitter_email) = lower(%s) "
        "  AND lower(ev.name) = lower(%s) "
        "  AND ev.start_datetime::date = %s::date "
        "LIMIT 1",
        (cleaned["submitter_email"], cleaned["name"], cleaned["start_datetime"]),
    )
    return cursor.fetchone() is not None
