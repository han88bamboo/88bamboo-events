# scripts/submissions.py — the public event submission endpoint (plan §8).
# Prefix /submissions.
#
#   POST /submissions   (multipart/form-data: all §7 fields + `image` + honeypot)
#
# ROUND 3a SCOPE (no payment yet): this endpoint validates everything, uploads
# the image to the public bucket (SPEC §A5), and RETURNS the validated data +
# image URL for the client to carry into the 3b payment step. It does NOT write
# events/event_versions/files — that write is transactional with the Stripe
# PaymentIntent in 3b (plan §6), and a half-written listing with no payment would
# pollute the pending queue. So nothing is persisted here (plan §6 "abandoned
# checkout -> nothing persisted"); only the image lands in the bucket, and an
# abandoned submission at worst orphans that object.
#
# Abuse controls (plan §8): a honeypot field + per-IP rate limiting.
# Order of operations mirrors plan §6: validate the image BEFORE any upload.

import os

import psycopg2
from flask import Blueprint, jsonify, request

from app import db_manager
from rate_limit import RateLimiter, rate_limited
from s3_images import upload_image
from submission_validation import (
    DEFAULT_MAX_IMAGE_BYTES,
    HONEYPOT_FIELD,
    validate_image,
    validate_submission,
)

file_name = os.path.basename(__file__)
blueprint = Blueprint(file_name[:-3], __name__)  # blueprint name == filename

# Per-IP limit: 5 submissions / 10 minutes. In-memory is correct for the single
# gevent worker (rate_limit.py explains the scaling caveat).
_limiter = RateLimiter(max_requests=5, window_seconds=600)

# Image size cap (env-overridable; defaults to 5 MB — submission_validation).
_MAX_IMAGE_BYTES = int(os.getenv("MAX_IMAGE_MB", "5")) * 1024 * 1024


def _load_active_taxonomy():
    """Fetch the active taxonomy label sets to validate the submission against
    (plan §7 — the DB is the source of truth, not a hardcoded list)."""
    with db_manager.get_cursor() as cursor:
        cursor.execute("SELECT label FROM drink_categories WHERE active = TRUE")
        categories = {row["label"] for row in cursor.fetchall()}
        cursor.execute("SELECT label FROM event_formats WHERE active = TRUE")
        formats = {row["label"] for row in cursor.fetchall()}
    return categories, formats


@blueprint.route("", methods=["POST"])
@rate_limited(_limiter)
def submit_event():
    # 1) Honeypot (plan §8): a bot fills the hidden field. Respond with a benign
    #    200 so the bot cannot distinguish rejection, but do NO work — the real
    #    flow needs the image URL this response withholds, so it dead-ends here.
    if (request.form.get(HONEYPOT_FIELD) or "").strip():
        return jsonify({"code": 200, "data": "received"}), 200

    # 2) Validate the non-file fields against the live taxonomy.
    try:
        allowed_categories, allowed_formats = _load_active_taxonomy()
    except psycopg2.Error:
        return jsonify({"code": 500, "error": "Database error occurred"}), 500

    data = {
        "name": request.form.get("name"),
        "submitter_email": request.form.get("submitter_email"),
        "contact_email": request.form.get("contact_email"),
        "start_datetime": request.form.get("start_datetime"),
        "end_datetime": request.form.get("end_datetime"),
        "venue_name": request.form.get("venue_name"),
        "venue_address": request.form.get("venue_address"),
        "country": request.form.get("country"),
        "city": request.form.get("city"),
        "description": request.form.get("description"),
        "link": request.form.get("link"),
        "event_format": request.form.get("event_format"),
        "submission_type": request.form.get("submission_type"),
        "drink_categories": request.form.getlist("drink_categories"),
    }
    cleaned, errors = validate_submission(data, allowed_categories, allowed_formats)

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
