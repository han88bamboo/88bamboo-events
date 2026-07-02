# shopify_proxy.py — Shopify App Proxy HMAC verification middleware.
#
# App-specific (not in Drink-X): the public events pages are served through the
# Shopify App Proxy at www.88bamboo.co/a/events/*. Shopify signs every proxied
# request with an HMAC-SHA256 `signature` query param computed from the other
# query params + the shared secret.
#
# Gating (plan §4/§9): verification runs ONLY when SHOPIFY_PROXY_VERIFY=true.
# Locally there is no proxy, so the flag is false and this middleware is a no-op.
# The shared secret is read from SHOPIFY_SHARED_SECRET (never hardcoded).

import hashlib
import hmac
import os

from flask import request, jsonify

# Paths that must never be gated by the proxy signature (health checks, etc.).
EXEMPT_PREFIXES = ("/health",)


def _truthy(value):
    return str(value).lower() in ("1", "true", "yes")


def verify_proxy_signature(args, secret):
    """Return True if `args` carry a valid Shopify App Proxy signature.

    Shopify builds the signature by taking every query param EXCEPT `signature`,
    sorting them by key, joining each as `key=value` (values joined with ',' when
    repeated) with no separator between pairs, then HMAC-SHA256 hex-digesting that
    string with the app's shared secret.
    """
    if not secret:
        return False

    provided = args.get("signature")
    if not provided:
        return False

    # Build the canonical string from all params except `signature`.
    params = {}
    for key in args.keys():
        if key == "signature":
            continue
        # request.args is a MultiDict; repeated values are comma-joined.
        params[key] = ",".join(args.getlist(key))

    message = "".join(f"{k}={params[k]}" for k in sorted(params.keys()))
    computed = hmac.new(
        secret.encode("utf-8"),
        message.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()

    return hmac.compare_digest(computed, provided)


def init_shopify_proxy(app):
    """Register the gated before_request hook on the Flask app."""

    @app.before_request
    def _verify_shopify_proxy():
        # Disabled unless explicitly turned on (false locally — no proxy exists).
        if not _truthy(os.getenv("SHOPIFY_PROXY_VERIFY", "false")):
            return None

        # Never gate health checks (load balancers / compose healthchecks).
        if request.path.startswith(EXEMPT_PREFIXES):
            return None

        secret = os.getenv("SHOPIFY_SHARED_SECRET")
        if not verify_proxy_signature(request.args, secret):
            return jsonify({"code": 401, "error": "Invalid App Proxy signature"}), 401

        return None
