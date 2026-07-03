# scripts/uploads.py — serves the LOCAL image stub (see s3_images.py). Prefix
# /uploads. Only relevant when running with the local filesystem stub (no AWS
# keys); in production the image URLs point straight at S3 and this route is
# never exercised. send_from_directory guards against path traversal.

import os

from flask import Blueprint, abort, send_from_directory

from s3_images import STUB_DIR

file_name = os.path.basename(__file__)
blueprint = Blueprint(file_name[:-3], __name__)  # blueprint name == filename


@blueprint.route("/<path:key>", methods=["GET"])
def serve_stub_image(key):
    if not os.path.isdir(STUB_DIR):
        abort(404)
    return send_from_directory(STUB_DIR, key)
