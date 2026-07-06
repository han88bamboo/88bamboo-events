# Unit tests for event_versioning.create_edit_version — the shared edit-versioning
# core (plan §7). Exercised here with a fake cursor (DB-free) to lock the two
# behaviours the post-launch admin-edit feature depends on:
#   1. the pre-approval branch stamps the caller's supersede_reason (so an admin
#      edit reads "Superseded by an admin edit", not the submitter-edit default);
#   2. the post-approval branch creates a new version and does NOT supersede.
import unittest

from event_versioning import create_edit_version

_CLEANED = {
    "name": "Test Event",
    "start_datetime": "2026-08-01T18:00",
    "end_datetime": "2026-08-01T21:00",
    "venue_name": "The Bar",
    "venue_address": "1 Road",
    "country": "Singapore",
    "city": "Singapore",
    "region": None,
    "latitude": None,
    "longitude": None,
    "place_id": None,
    "postcode": None,
    "description": "desc",
    "link": "https://example.com",
    "contact_email": "c@example.com",
    "submission_type": "bar",
    "drink_categories": ["Whisky"],
    "event_format": "Tasting",
}


def _source(**over):
    """A source event_versions row as create_edit_version reads it (image +
    location for the carry-forward). Override any field per test."""
    row = {
        "image_url": None,
        "venue_address": "1 Road",
        "latitude": None,
        "longitude": None,
        "place_id": None,
        "postcode": None,
    }
    row.update(over)
    return row


class FakeCursor:
    """Minimal cursor stand-in: records every execute() and pops predefined
    fetchone() results in order."""

    def __init__(self, fetch_queue):
        self.executed = []  # (sql, params)
        self._fetch = list(fetch_queue)

    def execute(self, sql, params=None):
        self.executed.append((sql, params))

    def fetchone(self):
        return self._fetch.pop(0)


class PreApprovalEditTests(unittest.TestCase):
    def test_custom_supersede_reason_is_stamped(self):
        # editable_version -> source row; version-number bump; INSERT ... RETURNING id
        cur = FakeCursor([_source(image_url="http://img/x.jpg"), {"n": 3}, {"id": 42}])
        new_id, is_published = create_edit_version(
            cur, event_id=7, published_version_id=None, cleaned=_CLEANED,
            supersede_reason="Superseded by an admin edit",
        )
        self.assertEqual((new_id, is_published), (42, False))

        # Find the supersede UPDATE and assert it carried the custom reason first.
        supersede = [
            (sql, params) for (sql, params) in cur.executed
            if "approval_status = 'rejected'" in sql
        ]
        self.assertEqual(len(supersede), 1)
        self.assertEqual(supersede[0][1][0], "Superseded by an admin edit")

    def test_default_supersede_reason(self):
        cur = FakeCursor([_source(), {"n": 1}, {"id": 5}])
        create_edit_version(cur, event_id=1, published_version_id=None, cleaned=_CLEANED)
        supersede = [
            (sql, params) for (sql, params) in cur.executed
            if "approval_status = 'rejected'" in sql
        ]
        self.assertEqual(supersede[0][1][0], "Superseded by a newer edit")


class LocationCarryForwardTests(unittest.TestCase):
    """EP-2: coordinates carry forward from the source version when the edit did
    not change the address, but a changed address brings its own coordinates."""

    def _insert_params(self, cur):
        rows = [p for sql, p in cur.executed if "INSERT INTO event_versions" in sql]
        self.assertEqual(len(rows), 1)
        return rows[0]

    def test_coords_carried_forward_when_address_unchanged(self):
        source = _source(
            venue_address="1 Road", latitude=1.5, longitude=103.5,
            place_id="pid", postcode="12345",
        )
        cur = FakeCursor([source, {"n": 2}, {"id": 60}])
        # Same address, no coords in the edit (e.g. an untouched prefilled address).
        create_edit_version(cur, event_id=3, published_version_id=5, cleaned=dict(_CLEANED))
        params = self._insert_params(cur)
        for expected in (1.5, 103.5, "pid", "12345"):
            self.assertIn(expected, params)

    def test_new_coords_used_when_address_changed(self):
        source = _source(
            venue_address="1 Road", latitude=1.5, longitude=103.5,
            place_id="old", postcode="00000",
        )
        cur = FakeCursor([source, {"n": 2}, {"id": 61}])
        cleaned = dict(
            _CLEANED, venue_address="2 New Road", latitude=40.0, longitude=-70.0,
            place_id="new", postcode="99999",
        )
        create_edit_version(cur, event_id=3, published_version_id=5, cleaned=cleaned)
        params = self._insert_params(cur)
        self.assertIn(40.0, params)
        self.assertIn("new", params)
        self.assertNotIn(1.5, params)
        self.assertNotIn("old", params)


class PostApprovalEditTests(unittest.TestCase):
    def test_published_event_creates_version_without_superseding(self):
        cur = FakeCursor([_source(image_url="http://img/y.jpg"), {"n": 2}, {"id": 43}])
        new_id, is_published = create_edit_version(
            cur, event_id=9, published_version_id=10, cleaned=_CLEANED,
        )
        self.assertEqual((new_id, is_published), (43, True))
        # No supersede / hold-move in the post-approval branch.
        self.assertFalse(any("approval_status = 'rejected'" in sql for sql, _ in cur.executed))
        self.assertFalse(any("UPDATE payments" in sql for sql, _ in cur.executed))


if __name__ == "__main__":
    unittest.main()
