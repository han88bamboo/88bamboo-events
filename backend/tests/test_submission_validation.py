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


def _valid_form(**overrides):
    form = {
        "name": "Rare Whisky Tasting",
        "submitter_email": "host@example.com",
        "contact_email": "",
        "start_datetime": "2026-08-01T18:00",
        "end_datetime": "2026-08-01T21:00",
        "venue_name": "The Cellar",
        "venue_address": "1 Bamboo Road",
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
