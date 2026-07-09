# Unit tests for explore_facets — the Explore SEO layer's slug derivation +
# resolution (EXPLORE-LAYER-PLAN §3 D3, §4, §5). Two halves:
#   1. the PURE slugify/pluralize builders + reversers (parity with the JS module
#      frontend/core/utils/exploreFacets.js — the two must never drift);
#   2. the CURSOR-DRIVEN resolution against real DB data, exercised with a fake
#      cursor so no DB is needed (mirrors test_slugs.py's FakeCursor approach).
import unittest

import explore_facets as ef

# The real seeded taxonomy (database/schema.sql) — 'Other' present in both axes so
# the exclusion path is covered.
CATEGORIES = [
    "Whisky", "Wine", "Sake", "Beer", "Cocktails", "Rum", "Gin",
    "Tequila/Mezcal", "Cognac/Brandy", "Baijiu", "Other",
]
FORMATS = [
    "Bar takeover", "Masterclass", "Tasting", "Dinner", "Festival",
    "Launch", "Competition", "Trade event", "Other",
]


class SlugifyTests(unittest.TestCase):
    def test_slugify_label(self):
        self.assertEqual(ef.slugify_label("Tequila/Mezcal"), "tequila-mezcal")
        self.assertEqual(ef.slugify_label("Bar takeover"), "bar-takeover")
        self.assertEqual(ef.slugify_label("United Arab Emirates"), "united-arab-emirates")
        self.assertEqual(ef.slugify_label("  Hong  Kong  "), "hong-kong")

    def test_pluralize_slug(self):
        # ends in s/x/z/ch/sh -> +es
        self.assertEqual(ef.pluralize_slug("masterclass"), "masterclasses")
        self.assertEqual(ef.pluralize_slug("launch"), "launches")
        # consonant + y -> ies
        self.assertEqual(ef.pluralize_slug("party"), "parties")
        # otherwise -> +s
        self.assertEqual(ef.pluralize_slug("takeover"), "takeovers")
        self.assertEqual(ef.pluralize_slug("trade-event"), "trade-events")

    def test_facet_slug_builders(self):
        self.assertEqual(ef.category_facet_slug("Whisky"), "whisky")
        self.assertEqual(ef.format_facet_slug("Tasting"), "tastings")
        self.assertEqual(ef.pair_facet_slug("Wine", "Tasting"), "wine-tastings")


class ResolveFacetSlugTests(unittest.TestCase):
    def test_category_only(self):
        self.assertEqual(
            ef.resolve_facet_slug("whisky", CATEGORIES, FORMATS),
            {"category": "Whisky", "format": None},
        )
        # slash label round-trips
        self.assertEqual(
            ef.resolve_facet_slug("tequila-mezcal", CATEGORIES, FORMATS),
            {"category": "Tequila/Mezcal", "format": None},
        )

    def test_format_only(self):
        self.assertEqual(
            ef.resolve_facet_slug("masterclasses", CATEGORIES, FORMATS),
            {"category": None, "format": "Masterclass"},
        )
        self.assertEqual(
            ef.resolve_facet_slug("bar-takeovers", CATEGORIES, FORMATS),
            {"category": None, "format": "Bar takeover"},
        )

    def test_pair(self):
        self.assertEqual(
            ef.resolve_facet_slug("wine-tastings", CATEGORIES, FORMATS),
            {"category": "Wine", "format": "Tasting"},
        )
        self.assertEqual(
            ef.resolve_facet_slug("whisky-masterclasses", CATEGORIES, FORMATS),
            {"category": "Whisky", "format": "Masterclass"},
        )

    def test_other_excluded(self):
        # 'Other' never yields a facet on either axis.
        self.assertIsNone(ef.resolve_facet_slug("other", CATEGORIES, FORMATS))
        self.assertIsNone(ef.resolve_facet_slug("others", CATEGORIES, FORMATS))

    def test_unknown(self):
        self.assertIsNone(ef.resolve_facet_slug("nonsense", CATEGORIES, FORMATS))
        self.assertIsNone(ef.resolve_facet_slug("", CATEGORIES, FORMATS))


class ResolvePlaceSlugTests(unittest.TestCase):
    COUNTRIES = ["Singapore", "Hong Kong", "Japan", "Thailand"]
    CITIES = ["Singapore", "Hong Kong", "Tokyo", "Bangkok"]

    def test_country_wins_over_city(self):
        # A city-state slug matches both axes; the country takes priority (plan §4).
        self.assertEqual(
            ef.resolve_place_slug("singapore", self.COUNTRIES, self.CITIES),
            {"country": "Singapore", "city": None},
        )
        self.assertEqual(
            ef.resolve_place_slug("hong-kong", self.COUNTRIES, self.CITIES),
            {"country": "Hong Kong", "city": None},
        )

    def test_city_only(self):
        self.assertEqual(
            ef.resolve_place_slug("tokyo", self.COUNTRIES, self.CITIES),
            {"country": None, "city": "Tokyo"},
        )

    def test_unknown(self):
        self.assertIsNone(ef.resolve_place_slug("atlantis", self.COUNTRIES, self.CITIES))
        self.assertIsNone(ef.resolve_place_slug("", self.COUNTRIES, self.CITIES))


class FakeCursor:
    """Stand-in for a psycopg2 RealDictCursor: routes each query to preset rows by
    inspecting the SQL, and records (sql, params) so the SQL-backed resolution can
    be asserted without a DB (mirrors test_slugs.py's FakeCursor)."""

    def __init__(self, countries, cities, categories, formats, count=0):
        self.countries = countries
        self.cities = cities
        self.categories = categories
        self.formats = formats
        self.count = count
        self._mode = None
        self.executed = []

    def execute(self, sql, params=None):
        self.executed.append((sql, params))
        if "count(*)" in sql:
            self._mode = "count"
        elif "pv.country" in sql:
            self._mode = "countries"
        elif "pv.city" in sql:
            self._mode = "cities"
        elif "drink_categories" in sql:
            self._mode = "categories"
        elif "event_formats" in sql:
            self._mode = "formats"
        else:
            self._mode = None

    def fetchall(self):
        return {
            "countries": [{"value": v} for v in self.countries],
            "cities": [{"value": v} for v in self.cities],
            "categories": [{"label": v} for v in self.categories],
            "formats": [{"label": v} for v in self.formats],
        }.get(self._mode, [])

    def fetchone(self):
        return {"n": self.count} if self._mode == "count" else None


def _cursor(**overrides):
    kwargs = dict(
        countries=["Singapore", "Japan"],
        cities=["Singapore", "Tokyo"],
        categories=CATEGORIES,
        formats=FORMATS,
    )
    kwargs.update(overrides)
    return FakeCursor(**kwargs)


class ResolveExplorePathTests(unittest.TestCase):
    def test_place_only(self):
        resolved, error = ef.resolve_explore_path(_cursor(), "singapore")
        self.assertIsNone(error)
        self.assertEqual(resolved["path"], "singapore")
        self.assertEqual(resolved["place"], {"country": "Singapore", "city": None})
        self.assertIsNone(resolved["facet"])

    def test_place_and_facet(self):
        resolved, error = ef.resolve_explore_path(_cursor(), "singapore/wine-tastings")
        self.assertIsNone(error)
        self.assertEqual(resolved["place"], {"country": "Singapore", "city": None})
        self.assertEqual(resolved["facet"], {"category": "Wine", "format": "Tasting"})

    def test_city_place(self):
        resolved, error = ef.resolve_explore_path(_cursor(), "tokyo/masterclasses")
        self.assertIsNone(error)
        self.assertEqual(resolved["place"], {"country": None, "city": "Tokyo"})
        self.assertEqual(resolved["facet"], {"category": None, "format": "Masterclass"})

    def test_bad_place(self):
        resolved, error = ef.resolve_explore_path(_cursor(), "atlantis")
        self.assertIsNone(resolved)
        self.assertIn("atlantis", error)

    def test_bad_facet(self):
        resolved, error = ef.resolve_explore_path(_cursor(), "singapore/nonsense")
        self.assertIsNone(resolved)
        self.assertIn("nonsense", error)

    def test_too_many_segments(self):
        resolved, error = ef.resolve_explore_path(_cursor(), "singapore/wine/tastings")
        self.assertIsNone(resolved)
        self.assertIn("<place>", error)

    def test_empty_path(self):
        resolved, error = ef.resolve_explore_path(_cursor(), "")
        self.assertIsNone(resolved)


class CountExploreEventsTests(unittest.TestCase):
    def test_country_no_facet(self):
        cur = _cursor(count=7)
        n = ef.count_explore_events(cur, {"country": "Singapore", "city": None}, None)
        self.assertEqual(n, 7)
        sql, params = cur.executed[-1]
        self.assertIn("pv.country = %s", sql)
        self.assertEqual(params, ("Singapore",))

    def test_city_with_pair_facet(self):
        cur = _cursor(count=3)
        n = ef.count_explore_events(
            cur,
            {"country": None, "city": "Tokyo"},
            {"category": "Wine", "format": "Tasting"},
        )
        self.assertEqual(n, 3)
        sql, params = cur.executed[-1]
        self.assertIn("pv.city = %s", sql)
        self.assertIn("%s = ANY(pv.drink_categories)", sql)
        self.assertIn("pv.event_format = %s", sql)
        # order: city, then category, then format
        self.assertEqual(params, ("Tokyo", "Wine", "Tasting"))

    def test_published_and_upcoming_always_filtered(self):
        cur = _cursor(count=0)
        ef.count_explore_events(cur, {"country": "Singapore", "city": None}, None)
        sql, _ = cur.executed[-1]
        self.assertIn("e.current_status = 'published'", sql)
        self.assertIn("pv.end_datetime >= now()", sql)


if __name__ == "__main__":
    unittest.main()
