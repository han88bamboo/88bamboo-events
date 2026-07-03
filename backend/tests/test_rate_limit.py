# Unit tests for the in-memory rate limiter (no Flask needed — the algorithm is
# exercised directly with an injected clock).

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from rate_limit import RateLimiter  # noqa: E402


class TestRateLimiter(unittest.TestCase):
    def test_allows_up_to_limit_then_blocks(self):
        limiter = RateLimiter(max_requests=3, window_seconds=60)
        self.assertTrue(limiter.check("ip1", now=0))
        self.assertTrue(limiter.check("ip1", now=1))
        self.assertTrue(limiter.check("ip1", now=2))
        # 4th within the window is blocked.
        self.assertFalse(limiter.check("ip1", now=3))

    def test_window_slides(self):
        limiter = RateLimiter(max_requests=1, window_seconds=60)
        self.assertTrue(limiter.check("ip1", now=0))
        self.assertFalse(limiter.check("ip1", now=30))  # still inside window
        # After the window elapses the old hit ages out and a new one is allowed.
        self.assertTrue(limiter.check("ip1", now=61))

    def test_keys_are_independent(self):
        limiter = RateLimiter(max_requests=1, window_seconds=60)
        self.assertTrue(limiter.check("ip1", now=0))
        self.assertTrue(limiter.check("ip2", now=0))
        self.assertFalse(limiter.check("ip1", now=1))


if __name__ == "__main__":
    unittest.main()
