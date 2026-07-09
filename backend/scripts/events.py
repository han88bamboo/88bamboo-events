# scripts/events.py — the PUBLIC event read API (plan §8, PATTERN-SPEC §B3 SEO).
# Prefix /events. UNGUARDED by design: this is the only public-facing read
# surface (the listing feed, single-event-by-slug, and the homepage-widget feed).
#
#   GET /events            listing feed: filters + keyword search + sort
#   GET /events/widget     homepage-widget feed (upcoming, cross-origin, cookie-free)
#   GET /events/<slug>      single published event by its canonical slug
#
# STRICT PUBLIC GATE (plan §5 heads-up note): every query serves ONLY events with
# current_status = 'published', reading the content from published_version_id. We
# NEVER expose pending_review / unpublished / rejected / expired rows. Note the two
# meanings of "expired" that must not be conflated (plan §8 vs 4B):
#   - a PAST-DATED published event (end_datetime < now()) stays public, badged
#     "This event is over" — the is_past flag, computed here, drives that badge;
#   - events.current_status = 'expired' (an auto-released, never-approved hold) is
#     NOT published, so the gate above already excludes it.
#
# CORS: the app-wide policy in app.py already allows the apex + backstage origins
# in production and is permissive locally, so the widget can fetch this feed
# cross-origin from the Shopify theme with no per-route CORS handling here.

import os

import psycopg2
from flask import Blueprint, jsonify, request

from app import db_manager
from event_versioning import fetch_additional_images, fetch_occurrences

file_name = os.path.basename(__file__)
blueprint = Blueprint(file_name[:-3], __name__)  # blueprint name == filename

# Hard cap on how many rows a single listing request can return, so a crafted
# limit can't ask the DB for everything. The widget uses a smaller default.
_MAX_LISTING_LIMIT = 100
_DEFAULT_LISTING_LIMIT = 60
_DEFAULT_WIDGET_LIMIT = 6

# The columns that make up a public event card / detail payload. Selected from the
# published version (pv) joined to its event (e). is_past is computed here so the
# frontend never has to reason about the current_status='expired' vs past-dated
# distinction (see the module docstring).
_PUBLIC_COLUMNS = """
    e.id                 AS event_id,
    e.slug,
    e.created_at,
    pv.id                AS version_id,
    pv.name,
    pv.start_datetime,
    pv.end_datetime,
    pv.venue_name,
    pv.venue_address,
    pv.country,
    pv.city,
    pv.region,
    -- NUMERIC(9,6) -> double precision so jsonify can serialise the coordinates
    -- (Flask's default encoder rejects Decimal). Legacy events return NULL here and
    -- the detail page falls back to the address-string map (EP-2 D-4).
    pv.latitude::double precision  AS latitude,
    pv.longitude::double precision AS longitude,
    pv.place_id,
    pv.postcode,
    pv.description,
    pv.link,
    pv.contact_email,
    pv.image_url,
    pv.event_format,
    pv.drink_categories,
    -- Public organiser name (EP-7) — inherited by the listing, detail, and widget
    -- feeds. NULL for a legacy event → the detail page renders no "Organised by" line.
    pv.organiser_name,
    -- Count of extra dates for the "N dates" listing/widget hint (EP-6 E-D3). A
    -- cheap summary scalar — the listing/widget feeds still carry the summary
    -- start/end only, never the per-date fan-out. 0 for a legacy version (implied
    -- single occurrence). The detail-by-slug read adds the full occurrences list.
    (SELECT count(*) FROM event_occurrences o WHERE o.event_version_id = pv.id) AS occurrence_count,
    (pv.end_datetime IS NOT NULL AND pv.end_datetime < now()) AS is_past
"""


def _int_arg(name, default, maximum=None):
    """Parse a positive-int query arg, clamped to [1, maximum]; falls back to
    `default` on anything unparseable."""
    raw = request.args.get(name)
    try:
        value = int(raw)
    except (TypeError, ValueError):
        return default
    if value < 1:
        return default
    if maximum is not None:
        value = min(value, maximum)
    return value


@blueprint.route("", methods=["GET"])
def listing():
    """The public listing feed (plan §8). Server-side filtering + ILIKE keyword
    search + soonest-first sort, all parameterized (never string-built).

    Query params (all optional):
      q                keyword — ILIKE across name / venue_name / description
      category         drink category label — matches if present in the array
      format           event_format label (exact)
      country          country (exact) — the country FILTER
      city             city (exact)
      date_from        ISO date/datetime — events starting on/after this
      date_to          ISO date/datetime — events starting on/before this
      when             'upcoming' (default) | 'past' | 'all' — the toggle
      preferred_country  the manual country SELECTOR — surfaces that country's
                         events first without excluding the rest (plan §8)
      limit / offset   pagination (limit clamped to _MAX_LISTING_LIMIT)
    """
    where = ["e.current_status = 'published'"]
    params = []

    q = (request.args.get("q") or "").strip()
    if q:
        # ILIKE keyword search across the three free-text fields (plan §8). The
        # % wildcards are added to the PARAM, not the SQL, so the value is fully
        # parameterized (no injection surface).
        where.append(
            "(pv.name ILIKE %s OR pv.venue_name ILIKE %s OR pv.description ILIKE %s)"
        )
        like = f"%{q}%"
        params.extend([like, like, like])

    category = (request.args.get("category") or "").strip()
    if category:
        # drink_categories is a TEXT[] of labels; match membership.
        where.append("%s = ANY(pv.drink_categories)")
        params.append(category)

    event_format = (request.args.get("format") or "").strip()
    if event_format:
        where.append("pv.event_format = %s")
        params.append(event_format)

    country = (request.args.get("country") or "").strip()
    if country:
        where.append("pv.country = %s")
        params.append(country)

    city = (request.args.get("city") or "").strip()
    if city:
        where.append("pv.city = %s")
        params.append(city)

    date_from = (request.args.get("date_from") or "").strip()
    if date_from:
        where.append("pv.start_datetime >= %s")
        params.append(date_from)

    date_to = (request.args.get("date_to") or "").strip()
    if date_to:
        where.append("pv.start_datetime <= %s")
        params.append(date_to)

    # upcoming/past toggle (plan §8). "past" = the event has ended
    # (end_datetime < now()); "upcoming" = it has not. Default is upcoming.
    when = (request.args.get("when") or "upcoming").strip().lower()
    if when == "past":
        where.append("pv.end_datetime IS NOT NULL AND pv.end_datetime < now()")
    elif when == "all":
        pass
    else:  # 'upcoming' (default)
        where.append("(pv.end_datetime IS NULL OR pv.end_datetime >= now())")

    # Sort: the manual country selector (preferred_country) surfaces that
    # country's events first; within that, soonest upcoming first (plan §8).
    order_parts = []
    preferred_country = (request.args.get("preferred_country") or "").strip()
    if preferred_country:
        order_parts.append("(pv.country = %s) DESC")
    # NULLS LAST so undated rows never crowd the top of a soonest-first list.
    order_parts.append("pv.start_datetime ASC NULLS LAST")
    order_by = ", ".join(order_parts)

    limit = _int_arg("limit", _DEFAULT_LISTING_LIMIT, _MAX_LISTING_LIMIT)
    try:
        offset = max(0, int(request.args.get("offset")))
    except (TypeError, ValueError):
        offset = 0

    sql = f"""
        SELECT {_PUBLIC_COLUMNS}
        FROM events e
        JOIN event_versions pv ON pv.id = e.published_version_id
        WHERE {' AND '.join(where)}
        ORDER BY {order_by}
        LIMIT %s OFFSET %s
    """
    # psycopg2 binds %s placeholders by their POSITION IN THE SQL STRING. The
    # ORDER BY clause (with the optional preferred_country %s) comes AFTER the
    # WHERE clause in the string, so its param must follow the WHERE params;
    # limit/offset (LIMIT ... OFFSET, last in the string) trail everything.
    order_params = [preferred_country] if preferred_country else []

    try:
        with db_manager.get_cursor(commit=False) as cursor:
            cursor.execute(sql, (*params, *order_params, limit, offset))
            rows = [dict(r) for r in cursor.fetchall()]
    except psycopg2.Error:
        return jsonify({"code": 500, "error": "Database error occurred"}), 500

    return jsonify({"code": 200, "data": rows}), 200


@blueprint.route("/countries", methods=["GET"])
def countries():
    """Distinct countries that currently have published events — populates the
    listing page's country filter/selector without hardcoding a country list."""
    try:
        with db_manager.get_cursor(commit=False) as cursor:
            cursor.execute(
                """
                SELECT DISTINCT pv.country AS country
                FROM events e
                JOIN event_versions pv ON pv.id = e.published_version_id
                WHERE e.current_status = 'published'
                  AND pv.country IS NOT NULL AND pv.country <> ''
                ORDER BY pv.country ASC
                """
            )
            rows = [r["country"] for r in cursor.fetchall()]
    except psycopg2.Error:
        return jsonify({"code": 500, "error": "Database error occurred"}), 500

    return jsonify({"code": 200, "data": rows}), 200


# The "upcoming" predicate shared by the explore aggregates below — an event is
# upcoming if it has not ended (mirrors the when='upcoming' branch in listing()).
_UPCOMING = "(pv.end_datetime IS NULL OR pv.end_datetime >= now())"


@blueprint.route("/places", methods=["GET"])
def places():
    """Distinct published COUNTRIES and CITIES with their upcoming-event counts,
    each tagged `kind` ('country'/'city') — the aggregate the Explore layer builds
    on (EXPLORE-LAYER-PLAN §5.1): validating place slugs, the hub's top-N list, the
    ≥3-events thin-content gate, and sitemap generation. A UNION of the country and
    city columns of the same published+upcoming set; a city-state like Singapore
    therefore appears twice (kind='country' and kind='city'), and the frontend's
    resolvePlaceSlug prefers the country row (plan §4). RAW label values only — the
    slug is derived frontend-side (owner decision 2026-07-09), so nothing here needs
    the JS/Python slug logic."""
    try:
        with db_manager.get_cursor(commit=False) as cursor:
            cursor.execute(
                f"""
                SELECT 'country' AS kind, pv.country AS value, count(*) AS upcoming_count
                FROM events e
                JOIN event_versions pv ON pv.id = e.published_version_id
                WHERE e.current_status = 'published'
                  AND {_UPCOMING}
                  AND pv.country IS NOT NULL AND pv.country <> ''
                GROUP BY pv.country
                UNION ALL
                SELECT 'city' AS kind, pv.city AS value, count(*) AS upcoming_count
                FROM events e
                JOIN event_versions pv ON pv.id = e.published_version_id
                WHERE e.current_status = 'published'
                  AND {_UPCOMING}
                  AND pv.city IS NOT NULL AND pv.city <> ''
                GROUP BY pv.city
                ORDER BY upcoming_count DESC, value ASC
                """
            )
            rows = [dict(r) for r in cursor.fetchall()]
    except psycopg2.Error:
        return jsonify({"code": 500, "error": "Database error occurred"}), 500

    return jsonify({"code": 200, "data": rows}), 200


@blueprint.route("/facets", methods=["GET"])
def facets():
    """The derived facet set with upcoming-event counts (EXPLORE-LAYER-PLAN §5.2):
    distinct unnested `drink_categories`, distinct `event_format`, and the
    (category, format) pairs that ACTUALLY CO-OCCUR in published upcoming events.
    Feeds each place page's facet links and the admin tab's "available URLs" picker.

    RAW taxonomy labels + counts only (owner decision 2026-07-09) — the frontend
    derives every slug + H1 from these via core/utils/exploreFacets.js, keeping the
    slug/H1 scheme single-source. 'Other' (a catch-all with no SEO value) is
    excluded from all three groups, matching that module's dropOther. Pairs are the
    real co-occurring set (not the cartesian product), so the crawl surface stays
    proportional to actual data (plan §8 pair-explosion mitigation). Category counts
    can sum above the event total because an event carries multiple categories —
    each count is 'upcoming published events tagged with this label', which is the
    number a facet page would show."""
    try:
        with db_manager.get_cursor(commit=False) as cursor:
            cursor.execute(
                f"""
                SELECT cat AS category, count(*) AS upcoming_count
                FROM events e
                JOIN event_versions pv ON pv.id = e.published_version_id
                CROSS JOIN LATERAL unnest(pv.drink_categories) AS cat
                WHERE e.current_status = 'published'
                  AND {_UPCOMING}
                  AND cat IS NOT NULL AND cat <> '' AND lower(cat) <> 'other'
                GROUP BY cat
                ORDER BY upcoming_count DESC, cat ASC
                """
            )
            categories = [dict(r) for r in cursor.fetchall()]

            cursor.execute(
                f"""
                SELECT pv.event_format AS format, count(*) AS upcoming_count
                FROM events e
                JOIN event_versions pv ON pv.id = e.published_version_id
                WHERE e.current_status = 'published'
                  AND {_UPCOMING}
                  AND pv.event_format IS NOT NULL AND pv.event_format <> ''
                  AND lower(pv.event_format) <> 'other'
                GROUP BY pv.event_format
                ORDER BY upcoming_count DESC, pv.event_format ASC
                """
            )
            formats = [dict(r) for r in cursor.fetchall()]

            cursor.execute(
                f"""
                SELECT cat AS category, pv.event_format AS format, count(*) AS upcoming_count
                FROM events e
                JOIN event_versions pv ON pv.id = e.published_version_id
                CROSS JOIN LATERAL unnest(pv.drink_categories) AS cat
                WHERE e.current_status = 'published'
                  AND {_UPCOMING}
                  AND cat IS NOT NULL AND cat <> '' AND lower(cat) <> 'other'
                  AND pv.event_format IS NOT NULL AND pv.event_format <> ''
                  AND lower(pv.event_format) <> 'other'
                GROUP BY cat, pv.event_format
                ORDER BY upcoming_count DESC, cat ASC, pv.event_format ASC
                """
            )
            pairs = [dict(r) for r in cursor.fetchall()]
    except psycopg2.Error:
        return jsonify({"code": 500, "error": "Database error occurred"}), 500

    return (
        jsonify(
            {
                "code": 200,
                "data": {
                    "categories": categories,
                    "formats": formats,
                    "pairs": pairs,
                },
            }
        ),
        200,
    )


@blueprint.route("/widget", methods=["GET"])
def widget_feed():
    """The homepage-widget feed (plan §8). Upcoming published events only,
    soonest first, capped small. Called DIRECTLY cross-origin from the Shopify
    theme's standalone widget JS (not through the App Proxy), so it must be
    cookie-free and CORS-open — both already true (unguarded route + app CORS).
    Returns the canonical apex detail path so the widget can link straight to it
    without knowing the site host."""
    limit = _int_arg("limit", _DEFAULT_WIDGET_LIMIT, 24)
    try:
        with db_manager.get_cursor(commit=False) as cursor:
            cursor.execute(
                f"""
                SELECT {_PUBLIC_COLUMNS}
                FROM events e
                JOIN event_versions pv ON pv.id = e.published_version_id
                WHERE e.current_status = 'published'
                  AND (pv.end_datetime IS NULL OR pv.end_datetime >= now())
                ORDER BY pv.start_datetime ASC NULLS LAST
                LIMIT %s
                """,
                (limit,),
            )
            rows = [dict(r) for r in cursor.fetchall()]
    except psycopg2.Error:
        return jsonify({"code": 500, "error": "Database error occurred"}), 500

    return jsonify({"code": 200, "data": rows}), 200


@blueprint.route("/<slug>", methods=["GET"])
def by_slug(slug):
    """A single published event by its canonical slug (plan §8, SPEC §B3). Slug
    match is case-insensitive and returns the CANONICAL slug so the frontend's
    getServerSideProps can 301-redirect a non-canonical URL to the canonical one
    (SPEC §B3 canonical-slug enforcement). Only published events resolve — a
    pending/unpublished/rejected/expired slug 404s."""
    slug = (slug or "").strip()
    if not slug:
        return jsonify({"code": 404, "error": "Not found."}), 404

    try:
        with db_manager.get_cursor(commit=False) as cursor:
            cursor.execute(
                f"""
                SELECT {_PUBLIC_COLUMNS}
                FROM events e
                JOIN event_versions pv ON pv.id = e.published_version_id
                WHERE e.current_status = 'published'
                  AND lower(e.slug) = lower(%s)
                LIMIT 1
                """,
                (slug,),
            )
            row = cursor.fetchone()
            # The full per-date schedule for the detail page + per-occurrence
            # JSON-LD (EP-6). [] for a legacy event — the detail page implies one
            # occurrence from the scalar summary. Only the detail read fans this
            # out; the listing/widget feeds keep the summary scalars (E-D3).
            occurrences = fetch_occurrences(cursor, row["version_id"]) if row else []
            # Additional images (post-go-live feature) — detail-page carousel
            # ONLY; the listing/widget feeds above still read image_url alone.
            additional_images = fetch_additional_images(cursor, row["version_id"]) if row else []
    except psycopg2.Error:
        return jsonify({"code": 500, "error": "Database error occurred"}), 500

    if not row:
        return jsonify({"code": 404, "error": "Event not found."}), 404

    data = dict(row)
    data["occurrences"] = occurrences
    data["additional_images"] = additional_images
    return jsonify({"code": 200, "data": data}), 200
