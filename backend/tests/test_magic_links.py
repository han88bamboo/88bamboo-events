# Unit tests for magic_links — the DB-free token helpers (plan §7). Token
# generation/hashing are pure functions, so they're tested in isolation; the
# create/resolve/mark helpers take a live cursor and are exercised in the Phase-5
# end-to-end proof instead.
import hashlib
import unittest

import magic_links


class TokenGenerationTests(unittest.TestCase):
    def test_tokens_are_unique_and_high_entropy(self):
        tokens = {magic_links.generate_token() for _ in range(100)}
        # No collisions across 100 draws, and each is a long URL-safe string.
        self.assertEqual(len(tokens), 100)
        for t in tokens:
            self.assertGreaterEqual(len(t), 40)
            # token_urlsafe uses base64url alphabet: [A-Za-z0-9_-]
            self.assertTrue(all(c.isalnum() or c in "_-" for c in t))


class HashTokenTests(unittest.TestCase):
    def test_hash_is_sha256_hex(self):
        raw = "hello-token"
        expected = hashlib.sha256(raw.encode("utf-8")).hexdigest()
        self.assertEqual(magic_links.hash_token(raw), expected)
        # 64 hex chars.
        self.assertEqual(len(magic_links.hash_token(raw)), 64)

    def test_hash_is_deterministic(self):
        self.assertEqual(magic_links.hash_token("abc"), magic_links.hash_token("abc"))

    def test_different_tokens_hash_differently(self):
        self.assertNotEqual(magic_links.hash_token("a"), magic_links.hash_token("b"))

    def test_hash_never_equals_raw(self):
        # The stored hash must not be the raw token (plan §7: never store the raw).
        raw = magic_links.generate_token()
        self.assertNotEqual(magic_links.hash_token(raw), raw)

    def test_empty_token_is_handled(self):
        # hash_token('') / None must not raise (resolve_token guards empties too).
        self.assertEqual(len(magic_links.hash_token("")), 64)
        self.assertEqual(len(magic_links.hash_token(None)), 64)


if __name__ == "__main__":
    unittest.main()
