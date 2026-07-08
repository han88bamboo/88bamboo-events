# Unit tests for organiser_names — the EP-7 public organiser-name registry.
# normalise_organiser_name is a pure function (tested directly); the cursor helpers
# are exercised against a small in-memory fake cursor that mimics the one table +
# its normalised_name UNIQUE constraint, so the claim/conflict/reuse matrix is
# verifiable without a live DB (same spirit as the magic_links token tests).

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from organiser_names import (  # noqa: E402
    OrganiserNameConflict,
    check_organiser_name_available,
    claim_organiser_name,
    fetch_organiser_names,
    normalise_organiser_name,
)


class NormaliseTests(unittest.TestCase):
    def test_the_three_spec_variants_collide(self):
        # F-D4's worked example: casing, extra/edge whitespace, and
        # punctuation/accents all fold to the same key.
        canonical = normalise_organiser_name("Sake Matsuri Singapore")
        self.assertEqual(canonical, "sake matsuri singapore")
        self.assertEqual(normalise_organiser_name("sake  matsuri singapore "), canonical)
        self.assertEqual(normalise_organiser_name("Saké-Matsuri, Singapore"), canonical)

    def test_case_insensitive(self):
        self.assertEqual(
            normalise_organiser_name("THE WHISKY CLUB"),
            normalise_organiser_name("the whisky club"),
        )

    def test_trims_and_collapses_whitespace(self):
        self.assertEqual(normalise_organiser_name("  a\t b\n  c "), "a b c")

    def test_strips_punctuation_and_symbols(self):
        self.assertEqual(normalise_organiser_name("A&B Co."), "a b co")
        self.assertEqual(normalise_organiser_name("Bar #1 & Co!"), "bar 1 co")

    def test_folds_accents(self):
        self.assertEqual(normalise_organiser_name("Café Crème"), "cafe creme")

    def test_blank_and_all_punctuation_normalise_to_empty(self):
        for value in ("", "   ", None, "!!!", "-- , --"):
            self.assertEqual(normalise_organiser_name(value), "")

    def test_non_latin_is_preserved(self):
        # Only combining accent marks are stripped; CJK stays so those names still
        # match on their own exact form.
        self.assertEqual(normalise_organiser_name("清酒祭"), "清酒祭")


class _FakeCursor:
    """Minimal stand-in for event_organiser_names: a list of rows plus the
    normalised_name UNIQUE constraint, enough to drive the cursor helpers."""

    def __init__(self, rows=None):
        # rows: list of {"normalised_name","owner_email","display_name"} dicts.
        self.rows = list(rows or [])
        self._result = None

    def execute(self, sql, params=None):
        sql_l = " ".join(sql.split()).lower()
        if sql_l.startswith("select owner_email from event_organiser_names where normalised_name"):
            (normalised,) = params
            match = next((r for r in self.rows if r["normalised_name"] == normalised), None)
            self._result = [{"owner_email": match["owner_email"]}] if match else []
        elif sql_l.startswith("insert into event_organiser_names"):
            normalised, owner, display = params
            if any(r["normalised_name"] == normalised for r in self.rows):
                # Emulate the UNIQUE violation a concurrent claim would trigger.
                raise Exception("duplicate key value violates unique constraint")
            self.rows.append(
                {"normalised_name": normalised, "owner_email": owner, "display_name": display}
            )
            self._result = []
        elif sql_l.startswith("select display_name from event_organiser_names where lower(owner_email)"):
            (owner,) = params
            self._result = [
                {"display_name": r["display_name"]}
                for r in self.rows
                if r["owner_email"].lower() == owner
            ]
        else:  # pragma: no cover - unexpected query
            raise AssertionError(f"unexpected SQL: {sql_l}")

    def fetchone(self):
        return self._result[0] if self._result else None

    def fetchall(self):
        return list(self._result)


class ClaimTests(unittest.TestCase):
    def test_unclaimed_name_is_inserted(self):
        cur = _FakeCursor()
        claim_organiser_name(cur, "Sake Matsuri Singapore", "owner@x.com")
        self.assertEqual(len(cur.rows), 1)
        row = cur.rows[0]
        self.assertEqual(row["normalised_name"], "sake matsuri singapore")
        self.assertEqual(row["owner_email"], "owner@x.com")
        # display_name keeps the submitter's original casing.
        self.assertEqual(row["display_name"], "Sake Matsuri Singapore")

    def test_same_owner_reuses_freely(self):
        cur = _FakeCursor()
        claim_organiser_name(cur, "The Whisky Club", "owner@x.com")
        # A second claim by the same owner (different casing/spacing) is a no-op.
        claim_organiser_name(cur, "the  whisky club", "OWNER@x.com")
        self.assertEqual(len(cur.rows), 1)

    def test_different_owner_is_rejected(self):
        cur = _FakeCursor()
        claim_organiser_name(cur, "Sake Matsuri Singapore", "first@x.com")
        with self.assertRaises(OrganiserNameConflict):
            claim_organiser_name(cur, "Saké-Matsuri, Singapore", "second@y.com")
        # No stray row was added for the rejected claim.
        self.assertEqual(len(cur.rows), 1)

    def test_blank_name_is_a_no_op(self):
        cur = _FakeCursor()
        claim_organiser_name(cur, "   ", "owner@x.com")
        claim_organiser_name(cur, "!!!", "owner@x.com")
        self.assertEqual(cur.rows, [])


class AvailabilityTests(unittest.TestCase):
    def test_available_when_unclaimed(self):
        cur = _FakeCursor()
        self.assertTrue(check_organiser_name_available(cur, "Fresh Name", "a@x.com"))

    def test_available_to_the_owner(self):
        cur = _FakeCursor([
            {"normalised_name": "fresh name", "owner_email": "a@x.com", "display_name": "Fresh Name"}
        ])
        self.assertTrue(check_organiser_name_available(cur, "FRESH NAME", "A@x.com"))

    def test_unavailable_to_a_different_email(self):
        cur = _FakeCursor([
            {"normalised_name": "fresh name", "owner_email": "a@x.com", "display_name": "Fresh Name"}
        ])
        self.assertFalse(check_organiser_name_available(cur, "fresh name", "b@y.com"))

    def test_blank_name_is_treated_as_available(self):
        cur = _FakeCursor()
        self.assertTrue(check_organiser_name_available(cur, "", "a@x.com"))


class FetchTests(unittest.TestCase):
    def test_returns_only_the_owners_names(self):
        cur = _FakeCursor([
            {"normalised_name": "a", "owner_email": "a@x.com", "display_name": "Alpha"},
            {"normalised_name": "b", "owner_email": "b@y.com", "display_name": "Beta"},
            {"normalised_name": "c", "owner_email": "a@x.com", "display_name": "Gamma"},
        ])
        names = fetch_organiser_names(cur, "A@X.com")
        self.assertEqual(set(names), {"Alpha", "Gamma"})

    def test_empty_email_returns_nothing(self):
        cur = _FakeCursor([
            {"normalised_name": "a", "owner_email": "a@x.com", "display_name": "Alpha"},
        ])
        self.assertEqual(fetch_organiser_names(cur, ""), [])


if __name__ == "__main__":
    unittest.main()
