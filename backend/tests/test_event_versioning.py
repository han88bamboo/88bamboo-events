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
    "description": "desc",
    "link": "https://example.com",
    "contact_email": "c@example.com",
    "submission_type": "bar",
    "drink_categories": ["Whisky"],
    "event_format": "Tasting",
}


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
        cur = FakeCursor([{"image_url": "http://img/x.jpg"}, {"n": 3}, {"id": 42}])
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
        cur = FakeCursor([{"image_url": None}, {"n": 1}, {"id": 5}])
        create_edit_version(cur, event_id=1, published_version_id=None, cleaned=_CLEANED)
        supersede = [
            (sql, params) for (sql, params) in cur.executed
            if "approval_status = 'rejected'" in sql
        ]
        self.assertEqual(supersede[0][1][0], "Superseded by a newer edit")


class PostApprovalEditTests(unittest.TestCase):
    def test_published_event_creates_version_without_superseding(self):
        cur = FakeCursor([{"image_url": "http://img/y.jpg"}, {"n": 2}, {"id": 43}])
        new_id, is_published = create_edit_version(
            cur, event_id=9, published_version_id=10, cleaned=_CLEANED,
        )
        self.assertEqual((new_id, is_published), (43, True))
        # No supersede / hold-move in the post-approval branch.
        self.assertFalse(any("approval_status = 'rejected'" in sql for sql, _ in cur.executed))
        self.assertFalse(any("UPDATE payments" in sql for sql, _ in cur.executed))


if __name__ == "__main__":
    unittest.main()
