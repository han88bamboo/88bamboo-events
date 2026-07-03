# s3_images.py — server-side image upload to the PUBLIC bucket, mirroring the
# Drink-X s3Images.py pattern AS-IS (PATTERN-SPEC §A5, and the ⚠️ EVENTS APP
# annotation there): put_object, uuid key, public URL stored in the DB, bucket/
# region/credentials selected by the single PURPOSE env var. No presigned URLs,
# no private bucket, no CloudFront (that flow was explicitly dropped — SPEC §A5).
#
# LOCAL STUB: when PURPOSE!=production AND no AWS keys are configured, the image
# is written to a local folder and served back by scripts/uploads.py instead of
# hitting S3 — so the whole submission flow runs on the owner's machine with zero
# AWS setup (plan §9 "Locally, uploads may go to a dev bucket or a local stub").
# Set real AWS_ACCESS_KEY_ID/SECRET to target an actual dev bucket instead.

import os
import uuid

import boto3
from botocore.exceptions import ClientError, NoCredentialsError

from submission_validation import IMAGE_EXTENSIONS

# Local stub directory (git-ignored). Served at /uploads/<key> by uploads.py.
STUB_DIR = os.path.join(os.path.dirname(__file__), "uploads")


def _bucket_and_region():
    """Resolve (bucket, region) from PURPOSE, matching the §A5 selection table.
    Bucket names default per environment but can be overridden by S3_PUBLIC_BUCKET
    (the real bucket is created in Phase 7, so the default is a placeholder)."""
    purpose = os.getenv("PURPOSE")
    if purpose == "production":
        region = os.getenv("AWS_REGION", "ap-southeast-1")
        bucket = os.getenv("S3_PUBLIC_BUCKET", "88bamboo-events-images")
    else:
        region = os.getenv("AWS_REGION", "us-east-1")
        bucket = os.getenv("S3_PUBLIC_BUCKET", "88bamboo-events-images-dev")
    return bucket, region


def _use_stub():
    """Stub locally when there are no AWS credentials to talk to S3 with."""
    return os.getenv("PURPOSE") != "production" and not os.getenv("AWS_ACCESS_KEY_ID")


def _new_key(content_type):
    """Flat uuid key with the extension for the (already validated) type (§A5)."""
    return f"{uuid.uuid4()}.{IMAGE_EXTENSIONS.get(content_type, 'jpg')}"


def upload_image(data, content_type, stub_base_url=None):
    """Upload validated image bytes and return a record for the `files` table +
    the version's image_url:

        {"url", "s3_key", "bucket", "region", "content_type", "size_bytes"}

    Raises on failure so the caller can surface an error (and, in 3b, cancel the
    PaymentIntent). Callers MUST validate type/size first (submission_validation).
    """
    key = _new_key(content_type)
    size_bytes = len(data)

    if _use_stub():
        os.makedirs(STUB_DIR, exist_ok=True)
        with open(os.path.join(STUB_DIR, key), "wb") as fh:
            fh.write(data)
        base = (stub_base_url or "http://localhost:5001/").rstrip("/")
        return {
            "url": f"{base}/uploads/{key}",
            "s3_key": key,
            "bucket": "local-stub",
            "region": "local",
            "content_type": content_type,
            "size_bytes": size_bytes,
        }

    bucket, region = _bucket_and_region()
    purpose = os.getenv("PURPOSE")

    # Credential selection per §A5: production relies on the ECS task IAM role
    # (no explicit keys); development passes the .env access keys.
    if purpose == "production":
        s3 = boto3.client("s3")
    else:
        s3 = boto3.client(
            "s3",
            region_name=region,
            aws_access_key_id=os.getenv("AWS_ACCESS_KEY_ID"),
            aws_secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY"),
        )

    try:
        s3.put_object(Bucket=bucket, Key=key, Body=data, ContentType=content_type)
    except (ClientError, NoCredentialsError) as exc:
        raise RuntimeError(f"Image upload failed: {exc}") from exc

    # Virtual-hosted–style public URL (§A5.5). Objects must be publicly readable.
    url = f"https://{bucket}.s3.{region}.amazonaws.com/{key}"
    return {
        "url": url,
        "s3_key": key,
        "bucket": bucket,
        "region": region,
        "content_type": content_type,
        "size_bytes": size_bytes,
    }
