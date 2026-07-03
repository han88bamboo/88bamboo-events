# admin_auth.py — minimal SERVER-SIDE admin session verification (plan §5.3 carve-out).
#
# The MVP mirrors the Drink-X login UX (PATTERN-SPEC §A6: a client-computed 32-bit
# password hash string-compared against admin_users.password_hash, a cookie +
# localStorage "session" on the client, and per-page getServerSideProps guards).
# BUT §A6 leaves every backend route unguarded — and plan §5 forbids that for the
# four endpoints that move money or change live listings (approve / reject /
# capture / unpublish). So this module adds the one thing §A6 lacks: a session the
# SERVER can verify before it acts.
#
# CHOSEN MECHANISM (stated in plan checklist): a stateless, HMAC-signed opaque
# token — NOT a DB session table, NOT JWT (no new dependency). At login the server
# signs {admin_user_id, email, exp} with a server-only secret; each guarded request
# carries the token in `Authorization: Bearer <token>` and the server recomputes
# the HMAC (timing-safe) and checks the expiry before acting. Nothing the client
# sends is trusted except what the signature covers.
#
# This is deliberately minimal. Real hardening (bcrypt/argon2 password hashing +
# server-stored sessions / rotation / revocation) stays DEFERRED per plan §10.
#
# Core functions are Flask-free so they unit-test standalone; the route decorator
# (which needs request/jsonify) imports Flask lazily, mirroring rate_limit.py.

import base64
import hashlib
import hmac
import json
import logging
import os
import time
from functools import wraps

log = logging.getLogger("admin_auth")

# Token lifetime — matches the §A6 client cookie TTL (7 days). After this the
# admin re-logs in; there is no refresh/rotation in the MVP (deferred).
SESSION_TTL_SECONDS = 7 * 24 * 60 * 60


def _secret():
    """The HMAC signing key. Prefer a dedicated ADMIN_SESSION_SECRET; fall back to
    the Shopify shared secret (already provisioned) so local dev works without an
    extra var, then to a clearly-insecure dev constant with a warning. Production
    MUST set ADMIN_SESSION_SECRET."""
    secret = os.getenv("ADMIN_SESSION_SECRET") or os.getenv("SHOPIFY_SHARED_SECRET")
    if secret and not secret.endswith("REPLACE_ME"):
        return secret.encode("utf-8")
    log.warning(
        "ADMIN_SESSION_SECRET not set — using an INSECURE dev default. Set "
        "ADMIN_SESSION_SECRET before deploying."
    )
    return b"dev-insecure-admin-secret"


def _b64url_encode(raw):
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _b64url_decode(text):
    pad = "=" * (-len(text) % 4)
    return base64.urlsafe_b64decode(text + pad)


def issue_session_token(admin_user_id, email, now=None):
    """Sign a session token for a freshly-authenticated admin. `now` is injectable
    for deterministic tests. Returns the `<payload>.<signature>` string the client
    stores and later replays in the Authorization header."""
    now = int(time.time()) if now is None else int(now)
    payload = {"sub": int(admin_user_id), "email": email, "exp": now + SESSION_TTL_SECONDS}
    body = _b64url_encode(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    sig = hmac.new(_secret(), body.encode("ascii"), hashlib.sha256).digest()
    return f"{body}.{_b64url_encode(sig)}"


def verify_session_token(token, now=None):
    """Return the token's payload dict if the signature is valid AND unexpired,
    else None. Signature is checked with a timing-safe compare before the payload
    is trusted; a tampered or expired token yields None (never raises)."""
    if not token or "." not in token:
        return None
    body, _, provided_sig = token.partition(".")
    expected = hmac.new(_secret(), body.encode("ascii"), hashlib.sha256).digest()
    try:
        if not hmac.compare_digest(expected, _b64url_decode(provided_sig)):
            return None
    except (ValueError, TypeError):
        return None
    try:
        payload = json.loads(_b64url_decode(body))
    except (ValueError, TypeError):
        return None
    now = int(time.time()) if now is None else int(now)
    if not isinstance(payload, dict) or int(payload.get("exp", 0)) < now:
        return None
    return payload


def _bearer_token(request):
    """Pull the token out of `Authorization: Bearer <token>` (case-insensitive
    scheme). The admin dashboard sends it as a header rather than a cookie because
    the API is a different origin from the backstage app (cookies would not ride
    along cross-origin)."""
    header = request.headers.get("Authorization", "")
    parts = header.split(None, 1)
    if len(parts) == 2 and parts[0].lower() == "bearer":
        return parts[1].strip()
    return None


def admin_required(view):
    """Route decorator enforcing the plan §5.3 carve-out: verify the admin session
    SERVER-SIDE before the wrapped action runs. On success the acting admin's id
    and email are stashed on flask.g for the audit log; on failure the request is
    rejected with 401 before any money/listing state changes."""
    from flask import g, jsonify, request  # lazy — keeps the core testable

    @wraps(view)
    def wrapper(*args, **kwargs):
        payload = verify_session_token(_bearer_token(request))
        if not payload:
            return jsonify({"code": 401, "error": "Admin authentication required."}), 401
        g.admin_user_id = payload["sub"]
        g.admin_email = payload.get("email")
        return view(*args, **kwargs)

    return wrapper
