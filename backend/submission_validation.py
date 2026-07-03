# submission_validation.py — pure validators for the public event submission
# (plan.md §7 fields, §8 abuse controls). Deliberately Flask/DB-free so the logic
# is unit-testable in isolation (CLAUDE.md: lightweight tests on data-processing
# functions are valued). The blueprint (scripts/submissions.py) extracts values
# from the multipart request, then delegates the actual rules to this module.

from datetime import datetime

# --- Image constraints (validated on the server BEFORE any upload/persist) ---
ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp"}
# Extension chosen for the S3 key, keyed by the (validated) content type.
IMAGE_EXTENSIONS = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}
DEFAULT_MAX_IMAGE_BYTES = 5 * 1024 * 1024  # 5 MB

# --- Field length caps (mirror the schema's VARCHAR limits in schema.sql §7) ---
MAX_NAME_LEN = 500
MAX_SHORT_LEN = 255          # emails, country, city, format
MAX_VENUE_NAME_LEN = 500

# The honeypot field: a real browser never fills it (it is visually hidden and
# tab-skipped). Any non-empty value marks the submitter as a bot (plan §8).
HONEYPOT_FIELD = "company_url"


def _looks_like_email(value):
    """Cheap structural email check — one @, non-empty local/domain, a dot in
    the domain. Not RFC-complete on purpose; Stripe/SES do the real bounce test."""
    if not value or value.count("@") != 1:
        return False
    local, _, domain = value.partition("@")
    return bool(local) and "." in domain and not domain.startswith(".") \
        and not domain.endswith(".")


def parse_datetime(value):
    """Parse an ISO-8601 string (e.g. the HTML datetime-local value
    '2026-07-10T18:00') into a datetime, or return None if unparseable."""
    if not value:
        return None
    try:
        # fromisoformat handles 'YYYY-MM-DDTHH:MM' and offset-aware forms.
        return datetime.fromisoformat(value.strip())
    except (ValueError, TypeError):
        return None


def validate_image(content_type, data, max_bytes=DEFAULT_MAX_IMAGE_BYTES):
    """Validate an uploaded image's declared type, magic bytes, and size.

    Returns (ok, error). Both the declared Content-Type AND the leading magic
    bytes must indicate a permitted format, so a spoofed content type on a
    non-image payload is rejected before it is ever uploaded (plan §6/§8).
    """
    if content_type not in ALLOWED_IMAGE_TYPES:
        return False, "Image must be a JPEG, PNG, or WebP file."
    if not data:
        return False, "The image file is empty."
    if len(data) > max_bytes:
        mb = max_bytes // (1024 * 1024)
        return False, f"Image is too large (max {mb} MB)."
    if not _magic_matches(content_type, data):
        return False, "The image file does not look like a valid image."
    return True, None


def _magic_matches(content_type, data):
    """Confirm the file's leading bytes match its declared type."""
    if content_type == "image/jpeg":
        return data[:3] == b"\xff\xd8\xff"
    if content_type == "image/png":
        return data[:8] == b"\x89PNG\r\n\x1a\n"
    if content_type == "image/webp":
        # RIFF....WEBP container.
        return data[:4] == b"RIFF" and data[8:12] == b"WEBP"
    return False


def validate_submission(data, allowed_categories, allowed_formats):
    """Validate the non-file form fields against plan §7.

    `data` is a plain dict (already extracted from the request) with:
      name, submitter_email, contact_email, start_datetime, end_datetime,
      venue_name, venue_address, country, city, description, link,
      event_format, submission_type  -> strings
      drink_categories               -> list[str]
    `allowed_categories` / `allowed_formats` are sets of the ACTIVE taxonomy
    labels loaded from the DB (never hardcoded — plan §7).

    Returns (cleaned, errors): `cleaned` is a normalised dict safe to hold for
    the 3b transactional persist; `errors` is a list of human-readable messages
    (empty => valid). Datetimes are normalised back to ISO strings so the held
    payload stays JSON-serialisable.
    """
    errors = []

    def _text(key, maxlen=None):
        value = (data.get(key) or "").strip()
        if maxlen and len(value) > maxlen:
            errors.append(f"{key.replace('_', ' ').capitalize()} is too long.")
            return value[:maxlen]
        return value

    name = _text("name", MAX_NAME_LEN)
    if not name:
        errors.append("Event name is required.")

    submitter_email = _text("submitter_email", MAX_SHORT_LEN)
    if not submitter_email:
        errors.append("Submitter email is required.")
    elif not _looks_like_email(submitter_email):
        errors.append("Submitter email is not a valid email address.")

    # Contact email is optional; validate only when supplied.
    contact_email = _text("contact_email", MAX_SHORT_LEN)
    if contact_email and not _looks_like_email(contact_email):
        errors.append("Contact email is not a valid email address.")

    start_raw = _text("start_datetime")
    end_raw = _text("end_datetime")
    start_dt = parse_datetime(start_raw)
    end_dt = parse_datetime(end_raw)
    if not start_dt:
        errors.append("A valid start date/time is required.")
    if not end_dt:
        errors.append("A valid end date/time is required.")
    if start_dt and end_dt and end_dt < start_dt:
        errors.append("End date/time cannot be before the start date/time.")

    country = _text("country", MAX_SHORT_LEN)
    if not country:
        errors.append("Country is required.")
    city = _text("city", MAX_SHORT_LEN)
    if not city:
        errors.append("City is required.")

    # Single-select event format must be one of the active taxonomy labels.
    event_format = _text("event_format", MAX_SHORT_LEN)
    if not event_format:
        errors.append("Event format is required.")
    elif event_format not in allowed_formats:
        errors.append("Event format is not a recognised option.")

    # Multi-select drink categories: at least one, all from the taxonomy.
    raw_categories = data.get("drink_categories") or []
    categories = [c.strip() for c in raw_categories if c and c.strip()]
    # De-duplicate while preserving order.
    categories = list(dict.fromkeys(categories))
    if not categories:
        errors.append("Select at least one drink category.")
    else:
        unknown = [c for c in categories if c not in allowed_categories]
        if unknown:
            errors.append("One or more drink categories are not recognised.")

    cleaned = {
        "name": name,
        "submitter_email": submitter_email,
        "contact_email": contact_email or None,
        "start_datetime": start_dt.isoformat() if start_dt else None,
        "end_datetime": end_dt.isoformat() if end_dt else None,
        "venue_name": _text("venue_name", MAX_VENUE_NAME_LEN) or None,
        "venue_address": _text("venue_address") or None,
        "country": country,
        "city": city,
        "description": _text("description") or None,
        "link": _text("link") or None,
        "event_format": event_format,
        "drink_categories": categories,
        "submission_type": _text("submission_type", MAX_SHORT_LEN) or None,
    }
    return cleaned, errors
