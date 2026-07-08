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
MAX_URL_LEN = 2048           # event link — TEXT column, capped to a sane URL length
MAX_REGION_LEN = 255         # region — VARCHAR(255) in schema.sql
MAX_POSTCODE_LEN = 32        # postcode — VARCHAR(32) in schema.sql
MAX_PLACE_ID_LEN = 255       # Google place_id (TEXT column; capped defensively)
MAX_ORGANISER_NAME_LEN = 255 # public organiser name — VARCHAR(255) in schema.sql (EP-7)

# Coordinate ranges (EP-2 D-2): the server re-range-checks the lat/lng captured
# from the Google Places selection, never trusting the client blindly.
LAT_RANGE = (-90.0, 90.0)
LNG_RANGE = (-180.0, 180.0)

# Server-side cap on a listing's schedule size (EP-6 E-D6). A hand-entered
# schedule of a few dates is the norm; this just bounds an abusive payload.
MAX_OCCURRENCES = 50

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


def _looks_like_url(value):
    """Cheap structural URL check — an http(s) scheme and a dotted host. Not
    RFC-complete on purpose (same spirit as _looks_like_email); it just rejects
    the obvious junk that the browser's type="url" lets through (e.g. a bare
    'myevent' or a 'javascript:' scheme)."""
    if not value:
        return False
    v = value.strip()
    lower = v.lower()
    if not (lower.startswith("http://") or lower.startswith("https://")):
        return False
    # Host is everything after '://' up to the first '/', '?' or '#'.
    rest = v.split("://", 1)[1]
    host = rest.split("/", 1)[0].split("?", 1)[0].split("#", 1)[0]
    return bool(host) and "." in host and not host.startswith(".") \
        and not host.endswith(".")


def _parse_coord(value, low, high):
    """Parse a latitude/longitude into a float within [low, high].

    Returns (value_or_None, ok). A blank/absent value is (None, True) — absence is
    allowed here; the address-selection rule below is what *requires* coordinates
    when an address is present. Accepts both the string form (multipart submit) and
    the float form (the 3b re-post of the held JSON payload)."""
    if value is None or (isinstance(value, str) and not value.strip()):
        return None, True
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None, False
    # Reject NaN / ±inf (they slip past the range check otherwise).
    if f != f or f in (float("inf"), float("-inf")):
        return None, False
    if not (low <= f <= high):
        return None, False
    return f, True


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


def _validate_occurrences(raw, errors):
    """Validate an explicit multi-date schedule (EP-6 E-D6). `raw` is a list of
    {"start", "end"} dicts (each parsed via parse_datetime). Rules: each row needs a
    valid start AND end with start < end; the list is capped at MAX_OCCURRENCES.

    Returns (occurrences, summary_start, summary_end):
      • `occurrences` — the cleaned, start-sorted list of {"start": iso, "end": iso}
        strings, safe to hold for the transactional persist;
      • `summary_start` / `summary_end` — MIN(start) / MAX(end) as datetimes, the
        DERIVED scalar summary the whole existing read surface reads (listing
        filter/sort, is_past, auto-expire). The validator is the single writer of
        both, so the scalars and the rows never drift.
    Human-readable messages are appended to `errors`."""
    if len(raw) > MAX_OCCURRENCES:
        errors.append(f"Too many dates — a listing can have at most {MAX_OCCURRENCES}.")
        raw = raw[:MAX_OCCURRENCES]
    parsed = []  # list of (start_dt, end_dt)
    for i, row in enumerate(raw, start=1):
        row = row or {}
        s = parse_datetime(row.get("start"))
        e = parse_datetime(row.get("end"))
        if not s or not e:
            errors.append(f"Date {i}: a valid start and end time are required.")
            continue
        if e <= s:
            errors.append(f"Date {i}: the end time must be after the start time.")
            continue
        parsed.append((s, e))
    if not parsed:
        # Every row was invalid (messages already emitted) — nothing to summarise.
        return [], None, None
    parsed.sort(key=lambda p: p[0])
    occurrences = [{"start": s.isoformat(), "end": e.isoformat()} for s, e in parsed]
    return occurrences, parsed[0][0], max(e for _, e in parsed)


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


def validate_submission(data, allowed_categories, allowed_formats, geo=None,
                        require_address_selection=True):
    """Validate the non-file form fields against plan §7 + EP-2 (location).

    `data` is a plain dict (already extracted from the request) with:
      name, submitter_email, contact_email, start_datetime, end_datetime,
      venue_name, venue_address, country, city, region, description, link,
      event_format, submission_type, place_id, postcode  -> strings
      latitude, longitude            -> string or number
      drink_categories               -> list[str]
    `allowed_categories` / `allowed_formats` are sets of the ACTIVE taxonomy
    labels loaded from the DB (never hardcoded — plan §7).

    `geo` is the canonical country/region reference from geo_reference.load_geo:
    {country_name: {"requires_region": bool, "regions": set[str]}}. When supplied
    (all live callers pass it), `country` is validated against that list and a
    `region` is required + validated for countries where requires_region is TRUE.
    When None (e.g. bare unit tests), those two DB-backed checks are skipped and
    country is only required-non-empty — the rest of the rules are unchanged.

    `require_address_selection` gates the "an address must carry a Google
    selection (coords + place_id)" rule. True on a fresh submission (clean-data
    guarantee). Edit paths pass False: a prefilled/legacy address (which may have
    no coordinates) must stay editable without forcing a re-pick — the versioning
    layer carries the source's coordinates forward when the address is unchanged.
    Coordinates are still range-checked in both modes.

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

    # --- Schedule: one or more explicit dates, each with its own start/end (EP-6).
    # A multi-date submission sends an `occurrences` array ([{start, end}, …]); a
    # single-date one sends the bare start_datetime/end_datetime scalars (the
    # unchanged legacy shape). Either way we DERIVE the scalar summary here
    # (MIN start / MAX end) — this validator is the single writer of both the
    # summary and the occurrence rows, so they never drift.
    raw_occurrences = data.get("occurrences")
    if isinstance(raw_occurrences, list) and raw_occurrences:
        occurrences, start_dt, end_dt = _validate_occurrences(raw_occurrences, errors)
    else:
        # Single-date path — the original scalar rules (messages unchanged so every
        # existing caller/test still passes), normalised into one occurrence below.
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
        # Normalise to one occurrence only for a positive-duration date. A
        # degenerate start == end stays on the scalar path (no row) rather than an
        # occurrence, so re-validating the held payload (whose occurrences the
        # multi-date path checks with strict start < end) stays consistent with 3a.
        occurrences = (
            [{"start": start_dt.isoformat(), "end": end_dt.isoformat()}]
            if start_dt and end_dt and end_dt > start_dt
            else []
        )

    country = _text("country", MAX_SHORT_LEN)
    if not country:
        errors.append("Country is required.")
    city = _text("city", MAX_SHORT_LEN)
    if not city:
        errors.append("City is required.")

    # --- Location: Google-validated address + captured coordinates (EP-2 D-2) ---
    # The address is OPTIONAL, but when supplied it must have come from the Google
    # Places dropdown, which returns lat/lng + a place_id in the same selection (no
    # separate geocode call). We re-range-check the coordinates and reject an
    # address typed without a valid selection — the "clean data" guarantee.
    venue_address = _text("venue_address")
    place_id = _text("place_id", MAX_PLACE_ID_LEN)
    postcode = _text("postcode", MAX_POSTCODE_LEN)
    latitude, lat_ok = _parse_coord(data.get("latitude"), *LAT_RANGE)
    longitude, lng_ok = _parse_coord(data.get("longitude"), *LNG_RANGE)
    if not lat_ok:
        errors.append("Latitude is out of range or invalid.")
    if not lng_ok:
        errors.append("Longitude is out of range or invalid.")

    if venue_address:
        if require_address_selection and (
            latitude is None or longitude is None or not place_id
        ):
            errors.append(
                "Please choose your address from the suggestions so we can map it."
            )
    else:
        # No address -> drop any orphan coordinates/place_id/postcode; they only
        # have meaning as part of an address selection.
        latitude = longitude = None
        place_id = ""
        postcode = ""

    # --- Region: a controlled subdivision, REQUIRED for certain countries ---
    # (large federal countries + Hong Kong / Macau / Taiwan). Validated against the
    # DB list for that country. Countries without a subdivision list never store a
    # stray region. Skipped entirely when `geo` is not provided.
    region = _text("region", MAX_REGION_LEN)
    if geo is not None and country:
        if country not in geo:
            errors.append("Country is not a recognised option.")
            region = ""  # can't validate a subdivision without a known country
        elif geo[country]["requires_region"]:
            if not region:
                errors.append(f"State/Territory/Region is required for {country}.")
            elif region not in geo[country]["regions"]:
                errors.append(
                    f"State/Territory/Region is not a recognised option for {country}."
                )
        else:
            region = ""

    # Single-select event format must be one of the active taxonomy labels.
    event_format = _text("event_format", MAX_SHORT_LEN)
    if not event_format:
        errors.append("Event format is required.")
    elif event_format not in allowed_formats:
        errors.append("Event format is not a recognised option.")

    # Event link is optional; when supplied it must be a real http(s) URL (the
    # browser's type="url" is lenient — a bare word passes it). Length-capped too.
    link = _text("link", MAX_URL_LEN)
    if link and not _looks_like_url(link):
        errors.append("Event link must be a valid URL starting with http:// or https://.")

    # Public organiser name (EP-7 F2). Optional, format-only here — just trimmed +
    # length-capped. The DB uniqueness CLAIM and the "only honoured for a logged-in
    # submitter" gate are the persist layer's job (organiser_names.py), exactly as
    # the geo list is loaded outside this DB-free validator. A caller that omits the
    # field gets cleaned["organiser_name"] = None, so every existing path is a no-op.
    organiser_name = _text("organiser_name", MAX_ORGANISER_NAME_LEN)

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
        # Derived scalar summary (MIN start / MAX end across the occurrences).
        "start_datetime": start_dt.isoformat() if start_dt else None,
        "end_datetime": end_dt.isoformat() if end_dt else None,
        # The per-date schedule (EP-6): [{start iso, end iso}, …], start-sorted. A
        # single-date submission normalises to exactly one occurrence.
        "occurrences": occurrences,
        "venue_name": _text("venue_name", MAX_VENUE_NAME_LEN) or None,
        "venue_address": venue_address or None,
        "country": country,
        "city": city,
        "region": region or None,
        "latitude": latitude,
        "longitude": longitude,
        "place_id": place_id or None,
        "postcode": postcode or None,
        "description": _text("description") or None,
        "link": link or None,
        "event_format": event_format,
        "drink_categories": categories,
        "submission_type": _text("submission_type", MAX_SHORT_LEN) or None,
        # Format-cleaned only; the persist layer gates it on a valid login + claims
        # its cross-account uniqueness (EP-7). None when absent — a no-op for callers
        # that never send it.
        "organiser_name": organiser_name or None,
    }
    return cleaned, errors
