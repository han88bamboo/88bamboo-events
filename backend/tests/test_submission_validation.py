# Unit tests for the pure submission validators (no Flask/DB needed).
# Run: cd backend && python -m pytest tests/  (or python -m unittest discover tests)

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from submission_validation import (  # noqa: E402
    validate_image,
    validate_submission,
)

CATEGORIES = {"Whisky", "Wine", "Cocktails"}
FORMATS = {"Tasting", "Masterclass"}

# Canonical geo reference (shape of geo_reference.load_geo) for the EP-2 rules.
GEO = {
    "Singapore": {"requires_region": False, "regions": set()},
    "United States": {"requires_region": True, "regions": {"California", "New York"}},
    "Hong Kong": {"requires_region": True, "regions": {"Hong Kong"}},
}


def _valid_form(**overrides):
    form = {
        "name": "Rare Whisky Tasting",
        "submitter_email": "host@example.com",
        "contact_email": "",
        "start_datetime": "2026-08-01T18:00",
        "end_datetime": "2026-08-01T21:00",
        "venue_name": "The Cellar",
        # A Google-selected address carries coordinates + a place_id in the same
        # selection (EP-2 D-2). The fixture mirrors a valid selection.
        "venue_address": "1 Bamboo Road, Singapore",
        "latitude": "1.283",
        "longitude": "103.86",
        "place_id": "ChIJdummyPlaceId",
        "postcode": "049483",
        "country": "Singapore",
        "city": "Singapore",
        "description": "An evening of rare drams.",
        "link": "https://example.com/event",
        "event_format": "Tasting",
        "submission_type": "bar",
        "drink_categories": ["Whisky", "Cocktails"],
    }
    form.update(overrides)
    return form


# Smallest valid PNG/JPEG/WebP magic-byte prefixes for image tests.
PNG_BYTES = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32
JPEG_BYTES = b"\xff\xd8\xff" + b"\x00" * 32
WEBP_BYTES = b"RIFF\x00\x00\x00\x00WEBP" + b"\x00" * 32


class TestValidateSubmission(unittest.TestCase):
    def test_valid_submission_has_no_errors(self):
        cleaned, errors = validate_submission(_valid_form(), CATEGORIES, FORMATS)
        self.assertEqual(errors, [])
        self.assertEqual(cleaned["name"], "Rare Whisky Tasting")
        self.assertEqual(cleaned["drink_categories"], ["Whisky", "Cocktails"])
        # Datetimes are normalised to ISO strings for the held payload.
        self.assertEqual(cleaned["start_datetime"], "2026-08-01T18:00:00")
        # Empty optional contact email becomes None.
        self.assertIsNone(cleaned["contact_email"])

    def test_missing_required_fields(self):
        _, errors = validate_submission(
            _valid_form(name="", country="", city=""), CATEGORIES, FORMATS
        )
        self.assertTrue(any("name is required" in e.lower() for e in errors))
        self.assertTrue(any("country is required" in e.lower() for e in errors))
        self.assertTrue(any("city is required" in e.lower() for e in errors))

    def test_invalid_email(self):
        _, errors = validate_submission(
            _valid_form(submitter_email="not-an-email"), CATEGORIES, FORMATS
        )
        self.assertTrue(any("valid email" in e.lower() for e in errors))

    def test_end_before_start(self):
        _, errors = validate_submission(
            _valid_form(
                start_datetime="2026-08-01T21:00", end_datetime="2026-08-01T18:00"
            ),
            CATEGORIES,
            FORMATS,
        )
        self.assertTrue(any("before the start" in e.lower() for e in errors))

    def test_unknown_taxonomy_rejected(self):
        _, cat_errors = validate_submission(
            _valid_form(drink_categories=["Whisky", "Absinthe"]), CATEGORIES, FORMATS
        )
        self.assertTrue(any("drink categories" in e.lower() for e in cat_errors))

        _, fmt_errors = validate_submission(
            _valid_form(event_format="Rave"), CATEGORIES, FORMATS
        )
        self.assertTrue(any("event format" in e.lower() for e in fmt_errors))

    def test_no_category_selected(self):
        _, errors = validate_submission(
            _valid_form(drink_categories=[]), CATEGORIES, FORMATS
        )
        self.assertTrue(any("at least one drink category" in e.lower() for e in errors))

    def test_duplicate_categories_deduped(self):
        cleaned, errors = validate_submission(
            _valid_form(drink_categories=["Whisky", "Whisky", "Wine"]),
            CATEGORIES,
            FORMATS,
        )
        self.assertEqual(errors, [])
        self.assertEqual(cleaned["drink_categories"], ["Whisky", "Wine"])

    def test_link_optional_when_blank(self):
        # No link supplied → no error, cleaned link is None.
        cleaned, errors = validate_submission(
            _valid_form(link=""), CATEGORIES, FORMATS
        )
        self.assertEqual(errors, [])
        self.assertIsNone(cleaned["link"])

    def test_valid_links_accepted(self):
        for url in (
            "https://example.com/event",
            "http://sub.example.co.uk/path?x=1#frag",
        ):
            _, errors = validate_submission(
                _valid_form(link=url), CATEGORIES, FORMATS
            )
            self.assertFalse(
                any("link" in e.lower() for e in errors), msg=f"{url}: {errors}"
            )

    def test_invalid_links_rejected(self):
        # A bare word, a missing scheme, a non-http scheme, and a dotless host —
        # all pass the browser's lenient type="url" but must fail server-side.
        for url in ("myevent", "example.com", "javascript:alert(1)", "https://localhost"):
            _, errors = validate_submission(
                _valid_form(link=url), CATEGORIES, FORMATS
            )
            self.assertTrue(
                any("valid url" in e.lower() for e in errors), msg=f"{url} not rejected"
            )


class TestLocationRules(unittest.TestCase):
    """EP-2 location rules: coordinate range, Google-selection requirement, and the
    DB-backed country + region checks."""

    def test_lat_lng_out_of_range_rejected(self):
        _, errors = validate_submission(
            _valid_form(latitude="200", longitude="-200"), CATEGORIES, FORMATS
        )
        self.assertTrue(any("latitude" in e.lower() for e in errors))
        self.assertTrue(any("longitude" in e.lower() for e in errors))

    def test_address_without_selection_rejected(self):
        # An address typed without a Google selection (no coords/place_id) is
        # rejected on a fresh submission (require_address_selection defaults True).
        _, errors = validate_submission(
            _valid_form(latitude="", longitude="", place_id=""), CATEGORIES, FORMATS
        )
        self.assertTrue(any("suggestions" in e.lower() for e in errors))

    def test_address_selection_relaxed_for_edits(self):
        # Edit paths pass require_address_selection=False: a coordinate-less
        # (legacy/prefilled) address is accepted so it stays editable.
        cleaned, errors = validate_submission(
            _valid_form(latitude="", longitude="", place_id=""),
            CATEGORIES, FORMATS, GEO, require_address_selection=False,
        )
        self.assertEqual(errors, [])
        self.assertIsNone(cleaned["latitude"])
        self.assertIsNone(cleaned["place_id"])

    def test_valid_selection_accepted(self):
        cleaned, errors = validate_submission(
            _valid_form(), CATEGORIES, FORMATS, GEO
        )
        self.assertEqual(errors, [])
        self.assertAlmostEqual(cleaned["latitude"], 1.283)
        self.assertAlmostEqual(cleaned["longitude"], 103.86)
        self.assertEqual(cleaned["place_id"], "ChIJdummyPlaceId")
        self.assertEqual(cleaned["postcode"], "049483")

    def test_country_not_in_list_rejected(self):
        _, errors = validate_submission(
            _valid_form(country="Atlantis"), CATEGORIES, FORMATS, GEO
        )
        self.assertTrue(any("country is not a recognised option" in e.lower() for e in errors))

    def test_region_required_when_country_requires_it(self):
        # United States requires a region; blank -> error.
        _, errors = validate_submission(
            _valid_form(country="United States", region=""), CATEGORIES, FORMATS, GEO
        )
        self.assertTrue(any("region is required" in e.lower() for e in errors))

    def test_region_must_be_in_list(self):
        _, errors = validate_submission(
            _valid_form(country="United States", region="Narnia"),
            CATEGORIES, FORMATS, GEO,
        )
        self.assertTrue(any("not a recognised option for" in e.lower() for e in errors))

    def test_valid_region_accepted(self):
        cleaned, errors = validate_submission(
            _valid_form(country="United States", region="California"),
            CATEGORIES, FORMATS, GEO,
        )
        self.assertEqual(errors, [])
        self.assertEqual(cleaned["region"], "California")

    def test_region_dropped_for_country_without_subdivisions(self):
        # Singapore has no region list; any submitted region is not stored.
        cleaned, errors = validate_submission(
            _valid_form(country="Singapore", region="Somewhere"),
            CATEGORIES, FORMATS, GEO,
        )
        self.assertEqual(errors, [])
        self.assertIsNone(cleaned["region"])


class TestOccurrences(unittest.TestCase):
    """EP-6 multi-date scheduling: occurrence validation, summary derivation, and
    single-date normalisation. validate_submission is the single writer of both the
    occurrence rows and the derived scalar summary."""

    def test_single_date_normalised_to_one_occurrence(self):
        # A bare single-date submission (no `occurrences` array) still validates and
        # is normalised into exactly one occurrence; the summary equals its dates.
        cleaned, errors = validate_submission(_valid_form(), CATEGORIES, FORMATS)
        self.assertEqual(errors, [])
        self.assertEqual(len(cleaned["occurrences"]), 1)
        self.assertEqual(cleaned["occurrences"][0]["start"], "2026-08-01T18:00:00")
        self.assertEqual(cleaned["occurrences"][0]["end"], "2026-08-01T21:00:00")
        self.assertEqual(cleaned["start_datetime"], "2026-08-01T18:00:00")
        self.assertEqual(cleaned["end_datetime"], "2026-08-01T21:00:00")

    def test_multi_date_summary_is_min_start_max_end(self):
        # Three dates supplied out of order → summary start = earliest start,
        # summary end = latest end, and the stored occurrences are start-sorted.
        occ = [
            {"start": "2026-08-10T19:00", "end": "2026-08-10T22:00"},
            {"start": "2026-08-01T18:00", "end": "2026-08-01T21:00"},
            {"start": "2026-08-05T18:00", "end": "2026-08-05T23:30"},
        ]
        cleaned, errors = validate_submission(
            _valid_form(occurrences=occ), CATEGORIES, FORMATS
        )
        self.assertEqual(errors, [])
        self.assertEqual(len(cleaned["occurrences"]), 3)
        # Sorted by start.
        self.assertEqual(cleaned["occurrences"][0]["start"], "2026-08-01T18:00:00")
        self.assertEqual(cleaned["occurrences"][-1]["start"], "2026-08-10T19:00:00")
        # Derived summary = MIN(start) / MAX(end).
        self.assertEqual(cleaned["start_datetime"], "2026-08-01T18:00:00")
        self.assertEqual(cleaned["end_datetime"], "2026-08-10T22:00:00")

    def test_occurrence_end_before_start_rejected(self):
        occ = [{"start": "2026-08-01T21:00", "end": "2026-08-01T18:00"}]
        _, errors = validate_submission(
            _valid_form(occurrences=occ), CATEGORIES, FORMATS
        )
        self.assertTrue(any("after the start time" in e.lower() for e in errors))

    def test_occurrence_equal_start_end_rejected(self):
        # Occurrences require start < end strictly (E-D6), unlike the grandfathered
        # single-date scalar path.
        occ = [{"start": "2026-08-01T18:00", "end": "2026-08-01T18:00"}]
        _, errors = validate_submission(
            _valid_form(occurrences=occ), CATEGORIES, FORMATS
        )
        self.assertTrue(any("after the start time" in e.lower() for e in errors))

    def test_occurrence_missing_time_rejected(self):
        occ = [{"start": "", "end": "2026-08-01T21:00"}]
        _, errors = validate_submission(
            _valid_form(occurrences=occ), CATEGORIES, FORMATS
        )
        self.assertTrue(any("valid start and end" in e.lower() for e in errors))

    def test_occurrence_count_capped(self):
        # 51 dates → over the 50 cap → rejected.
        occ = [
            {"start": f"2026-08-01T{h:02d}:00", "end": f"2026-08-01T{h:02d}:30"}
            for h in range(0, 24)
        ] * 3  # 72 rows
        _, errors = validate_submission(
            _valid_form(occurrences=occ), CATEGORIES, FORMATS
        )
        self.assertTrue(any("at most 50" in e.lower() for e in errors))

    def test_empty_occurrences_falls_back_to_scalars(self):
        # An empty array is not a valid multi-date schedule; the validator falls
        # back to the single-date scalar path (which here is valid).
        cleaned, errors = validate_submission(
            _valid_form(occurrences=[]), CATEGORIES, FORMATS
        )
        self.assertEqual(errors, [])
        self.assertEqual(len(cleaned["occurrences"]), 1)


class TestValidateImage(unittest.TestCase):
    def test_accepts_valid_types(self):
        for ctype, blob in (
            ("image/png", PNG_BYTES),
            ("image/jpeg", JPEG_BYTES),
            ("image/webp", WEBP_BYTES),
        ):
            ok, err = validate_image(ctype, blob)
            self.assertTrue(ok, msg=f"{ctype}: {err}")

    def test_rejects_disallowed_type(self):
        ok, err = validate_image("image/gif", b"GIF89a")
        self.assertFalse(ok)
        self.assertIn("JPEG", err)

    def test_rejects_spoofed_content_type(self):
        # Declared PNG but the bytes are not a PNG -> magic-byte check catches it.
        ok, err = validate_image("image/png", b"this is definitely not a png")
        self.assertFalse(ok)
        self.assertIn("valid image", err)

    def test_rejects_oversized(self):
        big = JPEG_BYTES + b"\x00" * (2 * 1024 * 1024)
        ok, err = validate_image("image/jpeg", big, max_bytes=1024)
        self.assertFalse(ok)
        self.assertIn("too large", err)

    def test_rejects_empty(self):
        ok, err = validate_image("image/png", b"")
        self.assertFalse(ok)


if __name__ == "__main__":
    unittest.main()
