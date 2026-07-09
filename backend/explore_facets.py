# explore_facets.py — MINIMAL backend port of the slug-RESOLUTION half of
# frontend/core/utils/exploreFacets.js (EXPLORE-LAYER-PLAN §3 D3, §4).
#
# DECISION (owner, 2026-07-09): slug/H1 DISPLAY derivation stays single-source in
# the JS module — GET /events/places and GET /events/facets return RAW taxonomy
# labels + counts, and the frontend derives every slug + H1 from them. The one
# thing that CANNOT live frontend-side is the admin path-validation step
# (POST /admin/explore-slugs), which must turn a submitted `<place>/<facet>` path
# back into `/events` filter labels + a live count server-side. So this module
# ports ONLY the deterministic slugify/pluralize builders and their reversers —
# NOT facetH1 / the H1 templates. Keep this behaviourally identical to the JS
# functions of the same name so the two never drift (they are covered by parallel
# tests: exploreFacets.test.mjs in the frontend, test_explore_facets.py here).
#
# 'Other' (present in both taxonomies) is a catch-all with no SEO value and is
# excluded from every facet, exactly as the JS module does.

import re

OTHER_LABEL = "other"

_NON_ALNUM = re.compile(r"[^a-z0-9]+")
_TRIM_HYPHENS = re.compile(r"^-+|-+$")
_PLURAL_ES = re.compile(r"(s|x|z|ch|sh)$")
_PLURAL_IES = re.compile(r"[bcdfghjklmnpqrstvwxz]y$")


def slugify_label(label):
    """Lowercase a label, collapse every non-alphanumeric run to a single hyphen,
    and trim leading/trailing hyphens. Mirrors JS slugifyLabel:
      'Tequila/Mezcal' -> 'tequila-mezcal', 'Bar takeover' -> 'bar-takeover'."""
    text = _NON_ALNUM.sub("-", str(label).lower())
    return _TRIM_HYPHENS.sub("", text)


def pluralize_slug(slug):
    """English plural of a slug's final token (D3 rule). Mirrors JS pluralizeSlug:
      ends in s/x/z/ch/sh -> +'es'; consonant+'y' -> 'ies'; otherwise -> +'s'."""
    if _PLURAL_ES.search(slug):
        return f"{slug}es"
    if _PLURAL_IES.search(slug):
        return re.sub(r"y$", "ies", slug)
    return f"{slug}s"


def category_facet_slug(category_label):
    """A drink category's facet slug (singular). 'Whisky' -> 'whisky'."""
    return slugify_label(category_label)


def format_facet_slug(format_label):
    """An event format's facet slug (pluralised). 'Tasting' -> 'tastings'."""
    return pluralize_slug(slugify_label(format_label))


def pair_facet_slug(category_label, format_label):
    """A category+format pair facet slug. 'Wine' + 'Tasting' -> 'wine-tastings'."""
    return f"{category_facet_slug(category_label)}-{format_facet_slug(format_label)}"


def _drop_other(labels):
    """Remove any 'Other' catch-all label (case-insensitive) from a taxonomy list."""
    return [label for label in (labels or []) if slugify_label(label) != OTHER_LABEL]


def build_facet_slug_map(categories, formats):
    """The full set of valid facet slugs for a taxonomy, mapping each slug to
    {'category', 'format'} (labels; the unused axis is None). Single generator that
    resolve_facet_slug reverses, so slugs and their resolution never drift. Order =
    category-only, then format-only, then every (category, format) pair; the first
    writer of a slug wins, so single-axis facets take priority over a colliding
    pair. 'Other' is excluded from both axes. Mirrors JS buildFacetSlugMap."""
    cats = _drop_other(categories)
    fmts = _drop_other(formats)
    slug_map = {}
    for category in cats:
        slug = category_facet_slug(category)
        slug_map.setdefault(slug, {"category": category, "format": None})
    for event_format in fmts:
        slug = format_facet_slug(event_format)
        slug_map.setdefault(slug, {"category": None, "format": event_format})
    for category in cats:
        for event_format in fmts:
            slug = pair_facet_slug(category, event_format)
            slug_map.setdefault(slug, {"category": category, "format": event_format})
    return slug_map


def resolve_facet_slug(slug, categories, formats):
    """Reverse of the three slug builders. Given a URL facet slug and the taxonomy
    label lists (excluding 'Other'), return {'category', 'format'} if the slug is a
    known category-only, format-only, or pair facet; otherwise None. Resolution is
    by matching the generated candidate set (NOT by splitting on hyphens — labels
    already contain hyphens). Mirrors JS resolveFacetSlug."""
    if not slug:
        return None
    return build_facet_slug_map(categories, formats).get(slug)


def place_slug(value):
    """A country or city display name as an explore place slug. Mirrors JS
    placeSlug: 'Hong Kong' -> 'hong-kong'."""
    return slugify_label(value)


def resolve_place_slug(slug, countries, cities):
    """Reverse of place_slug. Given a URL place slug and the distinct published
    country + city label lists, return {'country', 'city'} (unused axis None), with
    a COUNTRY match taking priority over a city match (plan §4 — lets the
    city-states Singapore/Hong Kong filter by country, which for them includes the
    city). None if the slug matches neither. Mirrors JS resolvePlaceSlug."""
    if not slug:
        return None
    for country in countries or []:
        if place_slug(country) == slug:
            return {"country": country, "city": None}
    for city in cities or []:
        if place_slug(city) == slug:
            return {"country": None, "city": city}
    return None


# ---------------------------------------------------------------------------
# Cursor-driven resolution against real DB data (used by the admin CRUD in
# scripts/admin.py). These take a psycopg2 cursor and do NOT import app, so they
# unit-test standalone with a fake cursor — exactly like slugs.generate_unique_slug
# (see tests/test_explore_facets.py). This is the "slug->place / slug->facet
# resolution wired to real DB data" half of Phase C.
# ---------------------------------------------------------------------------


def distinct_place_labels(cursor):
    """The distinct published country + city label lists (ALL published, not only
    upcoming) — the candidate set a place slug resolves against (plan §4 D2:
    'resolves if <place> slugifies to a distinct published country or city')."""
    cursor.execute(
        "SELECT DISTINCT pv.country AS value FROM events e "
        "JOIN event_versions pv ON pv.id = e.published_version_id "
        "WHERE e.current_status = 'published' "
        "AND pv.country IS NOT NULL AND pv.country <> ''"
    )
    countries = [r["value"] for r in cursor.fetchall()]
    cursor.execute(
        "SELECT DISTINCT pv.city AS value FROM events e "
        "JOIN event_versions pv ON pv.id = e.published_version_id "
        "WHERE e.current_status = 'published' "
        "AND pv.city IS NOT NULL AND pv.city <> ''"
    )
    cities = [r["value"] for r in cursor.fetchall()]
    return countries, cities


def active_facet_labels(cursor):
    """The active drink-category + event-format label lists (ordered by id, the
    taxonomy's own order — matches scripts/taxonomy.py), the candidate set a facet
    slug resolves against. 'Other' is left in; resolve_facet_slug drops it, exactly
    as this module's build_facet_slug_map does."""
    cursor.execute("SELECT label FROM drink_categories WHERE active = TRUE ORDER BY id")
    categories = [r["label"] for r in cursor.fetchall()]
    cursor.execute("SELECT label FROM event_formats WHERE active = TRUE ORDER BY id")
    formats = [r["label"] for r in cursor.fetchall()]
    return categories, formats


def resolve_explore_path(cursor, path):
    """Turn a normalised explore path (below /explore, e.g. 'singapore' or
    'singapore/wine-tastings') into the /events filter labels it maps to. Returns
    (resolved, error): resolved is {'path', 'place': {country, city},
    'facet': {category, format}|None} on success, or (None, message) when the path
    is malformed or does not resolve to a real place/facet."""
    segments = [s for s in path.split("/") if s]
    if not segments or len(segments) > 2:
        return None, "Path must be '<place>' or '<place>/<facet>'."

    countries, cities = distinct_place_labels(cursor)
    place = resolve_place_slug(segments[0], countries, cities)
    if not place:
        return None, f"No published place matches '{segments[0]}'."

    facet = None
    if len(segments) == 2:
        categories, formats = active_facet_labels(cursor)
        facet = resolve_facet_slug(segments[1], categories, formats)
        if not facet:
            return None, f"No facet matches '{segments[1]}'."

    return {"path": "/".join(segments), "place": place, "facet": facet}, None


def count_explore_events(cursor, place, facet):
    """Count published UPCOMING events matching a resolved place (+ optional facet),
    using the EXACT /events listing filters (plan §5.4): the place's country|city,
    plus a facet category (array membership) and/or format (exact). The live count
    POST reports and GET shows per row."""
    where = [
        "e.current_status = 'published'",
        "(pv.end_datetime IS NULL OR pv.end_datetime >= now())",
    ]
    params = []
    if place.get("country"):
        where.append("pv.country = %s")
        params.append(place["country"])
    elif place.get("city"):
        where.append("pv.city = %s")
        params.append(place["city"])
    if facet and facet.get("category"):
        where.append("%s = ANY(pv.drink_categories)")
        params.append(facet["category"])
    if facet and facet.get("format"):
        where.append("pv.event_format = %s")
        params.append(facet["format"])

    cursor.execute(
        "SELECT count(*) AS n FROM events e "
        "JOIN event_versions pv ON pv.id = e.published_version_id "
        f"WHERE {' AND '.join(where)}",
        tuple(params),
    )
    return cursor.fetchone()["n"]
