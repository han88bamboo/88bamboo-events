# scripts/additional_images.py — upload path for the post-go-live "additional
# images" feature (plan.md backlog, up to 6 images + carousel). Prefix
# /additional-images.
#
#   POST /additional-images/upload   multipart: validate + upload ONE image
#
# This is the single upload entry point for every additional-image slot, reused
# by BOTH the submission form (called once per extra file before 3b) and the
# edit forms' add-image control (submitter magic-link edit, account dashboard,
# admin edit). It deliberately mirrors the existing feature-image upload step in
# scripts/submissions.py (validate THEN upload, same validators) but as its own
# small multipart endpoint, since edit flows post JSON and can't ride along on a
# form submit the way 3a's feature image does.
#
# The existing single-image upload/validation code (submission_validation.py,
# s3_images.py, the `image` field, event_versions.image_url) is untouched — this
# module only calls into it, exactly as submissions.py already does.

import os

from flask import Blueprint, jsonify, request

from rate_limit import RateLimiter, rate_limited
from s3_images import upload_image
from submission_validation import validate_image

file_name = os.path.basename(__file__)
blueprint = Blueprint(file_name[:-3], __name__)  # blueprint name == filename

# Generous per-IP limit: up to 6 images per listing, plus edit-time add/replace
# attempts and retries, so this needs headroom beyond the 5/10min submission
# limiter (submissions.py) that gates a full listing submit.
_limiter = RateLimiter(max_requests=40, window_seconds=600)

_MAX_IMAGE_BYTES = int(os.getenv("MAX_IMAGE_MB", "5")) * 1024 * 1024


@blueprint.route("/upload", methods=["POST"])
@rate_limited(_limiter)
def upload():
    image_file = request.files.get("image")
    if image_file is None or not image_file.filename:
        return jsonify({"code": 400, "error": "An image file is required."}), 400

    image_bytes = image_file.read()
    ok, error = validate_image(image_file.mimetype, image_bytes, max_bytes=_MAX_IMAGE_BYTES)
    if not ok:
        return jsonify({"code": 400, "error": error}), 400

    try:
        image_record = upload_image(image_bytes, image_file.mimetype, stub_base_url=request.host_url)
    except RuntimeError:
        return jsonify({"code": 502, "error": "Image upload failed. Please try again."}), 502

    return (
        jsonify(
            {
                "code": 200,
                "data": {
                    "url": image_record["url"],
                    "s3_key": image_record["s3_key"],
                    "content_type": image_record["content_type"],
                    "size_bytes": image_record["size_bytes"],
                },
            }
        ),
        200,
    )
