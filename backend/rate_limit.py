# rate_limit.py — a small in-memory rate limiter for the submission endpoint
# (plan §8 abuse controls). No external dependency (no Flask-Limiter/redis).
#
# Why in-memory is sufficient here: the backend runs a SINGLE gunicorn gevent
# worker (PATTERN-SPEC §A1), so one process holds all state; a threading.Lock
# (gevent-patched to a greenlet-safe lock) guards concurrent access. If the
# service is ever scaled to multiple instances, this must move to a shared store
# (e.g. Redis) — flagged deliberately.
#
# Deliberately standalone (no Flask import at module top) so the core algorithm
# is unit-testable; the Flask decorator is a thin wrapper added at the bottom.

import threading
import time
from collections import defaultdict, deque
from functools import wraps


class RateLimiter:
    """Fixed-window-ish sliding limiter: at most `max_requests` per `window_seconds`
    per key, tracked as a deque of recent hit timestamps."""

    def __init__(self, max_requests, window_seconds):
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self._hits = defaultdict(deque)
        self._lock = threading.Lock()

    def check(self, key, now=None):
        """Record a hit for `key`. Return True if allowed, False if over the limit.

        `now` is injectable for deterministic tests.
        """
        now = time.monotonic() if now is None else now
        cutoff = now - self.window_seconds
        with self._lock:
            hits = self._hits[key]
            # Drop timestamps that have aged out of the window.
            while hits and hits[0] <= cutoff:
                hits.popleft()
            if len(hits) >= self.max_requests:
                return False
            hits.append(now)
            # Opportunistically forget keys that have gone quiet.
            if not hits:
                del self._hits[key]
            return True


def client_ip(request):
    """Best-effort client IP. Behind the ALB the real client is the first entry
    in X-Forwarded-For; fall back to the socket peer locally."""
    forwarded = request.headers.get("X-Forwarded-For", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.remote_addr or "unknown"


def rate_limited(limiter):
    """Flask route decorator: 429 when the caller's IP exceeds `limiter`."""
    # Imported here (not at module top) to keep the algorithm import-light/testable.
    from flask import jsonify, request

    def decorator(view):
        @wraps(view)
        def wrapper(*args, **kwargs):
            if not limiter.check(client_ip(request)):
                return (
                    jsonify(
                        {
                            "code": 429,
                            "error": "Too many submissions. Please wait a few "
                            "minutes and try again.",
                        }
                    ),
                    429,
                )
            return view(*args, **kwargs)

        return wrapper

    return decorator
