# Unit tests for admin_auth — the signed session token behind the plan §5.3
# server-side carve-out. Covers round-trip issue/verify, tamper detection,
# expiry, wrong-secret rejection, and malformed input (all must fail closed).
import os
import time
import unittest

import admin_auth


class AdminAuthTokenTests(unittest.TestCase):
    def setUp(self):
        # Pin a known secret so signing is deterministic across the test.
        self._prev = os.environ.get("ADMIN_SESSION_SECRET")
        os.environ["ADMIN_SESSION_SECRET"] = "test-secret-abc"

    def tearDown(self):
        if self._prev is None:
            os.environ.pop("ADMIN_SESSION_SECRET", None)
        else:
            os.environ["ADMIN_SESSION_SECRET"] = self._prev

    def test_round_trip(self):
        token = admin_auth.issue_session_token(7, "owner@88bamboo.co")
        payload = admin_auth.verify_session_token(token)
        self.assertIsNotNone(payload)
        self.assertEqual(payload["sub"], 7)
        self.assertEqual(payload["email"], "owner@88bamboo.co")

    def test_tampered_payload_rejected(self):
        token = admin_auth.issue_session_token(1, "a@b.co")
        body, _, sig = token.partition(".")
        # Flip a character in the payload; the signature no longer matches.
        forged = body[:-1] + ("A" if body[-1] != "A" else "B") + "." + sig
        self.assertIsNone(admin_auth.verify_session_token(forged))

    def test_wrong_secret_rejected(self):
        token = admin_auth.issue_session_token(1, "a@b.co")
        os.environ["ADMIN_SESSION_SECRET"] = "a-different-secret"
        self.assertIsNone(admin_auth.verify_session_token(token))

    def test_expired_token_rejected(self):
        past = int(time.time()) - admin_auth.SESSION_TTL_SECONDS - 10
        token = admin_auth.issue_session_token(1, "a@b.co", now=past)
        self.assertIsNone(admin_auth.verify_session_token(token))

    def test_unexpired_token_accepted_at_boundary(self):
        now = 1_000_000
        token = admin_auth.issue_session_token(1, "a@b.co", now=now)
        # One second before expiry it is still valid.
        checked = admin_auth.verify_session_token(
            token, now=now + admin_auth.SESSION_TTL_SECONDS - 1
        )
        self.assertIsNotNone(checked)

    def test_garbage_tokens_rejected(self):
        for bad in [None, "", "no-dot", "a.b.c", "....", "x." + "y"]:
            self.assertIsNone(admin_auth.verify_session_token(bad))


if __name__ == "__main__":
    unittest.main()
