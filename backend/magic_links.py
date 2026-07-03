# magic_links.py — passwordless edit-link tokens (plan §7). Cookie-free by design:
# an edit session is carried entirely by a URL token, because magic-link editing
# may run through the Shopify App Proxy, which strips cookies (plan §4/§7).
#
# Security shape (plan §7, TTL widened from the original 30-min spec value —
# see DEFAULT_TTL_MINUTES below):
#   - a random, high-entropy token is emailed to the submitter;
#   - only its SHA-256 HASH is stored (magic_links.token_hash), never the raw
#     token, so a DB leak cannot be replayed as a live link;
#   - 24-hour expiry;
#   - "single-use but tolerate ~3 uses": email-security scanners pre-click links
#     (GET), which would burn a strictly single-use token before the human ever
#     opens it. We therefore gate on EXPIRY, not on a hard first-use lock —
#     validation succeeds for any not-yet-expired token, and `used_at` is stamped
#     for audit on the first successful edit. Within the 24-hour window a link
#     tolerates the handful of scanner/human hits this is meant to survive.
#
# Pure-ish helpers: token generation/hashing are DB-free (unit-testable); the
# create/consume helpers take the caller's transaction cursor so the read-check
# and the write stay atomic (mirrors slugs.generate_unique_slug).

import hashlib
import secrets
from datetime import datetime, timedelta, timezone

# 32 bytes -> a 43-char URL-safe token. Ample entropy against guessing.
_TOKEN_BYTES = 32
DEFAULT_TTL_MINUTES = 60 * 24  # 24 hours (was 30 minutes at Phase-5 launch)

# Conversation reply links are effectively indefinite: the REAL lifetime gate is
# the event's state (a thread freezes once the event leaves 'pending_review'), so
# the token's own expiry is set far out and never becomes the limiting factor
# (owner decision — a review conversation stays open as long as the event is under
# review). ~100 years.
CONVERSATION_TTL_MINUTES = 60 * 24 * 365 * 100


def generate_token():
    """Return a fresh, high-entropy URL-safe raw token (the value emailed to the
    submitter). Never stored — only its hash is (see hash_token)."""
    return secrets.token_urlsafe(_TOKEN_BYTES)


def hash_token(raw_token):
    """Return the SHA-256 hex digest of a raw token. Deterministic, so a presented
    token can be matched against the stored hash without ever storing the token."""
    return hashlib.sha256((raw_token or "").encode("utf-8")).hexdigest()


def create_magic_link(cursor, event_id, ttl_minutes=DEFAULT_TTL_MINUTES):
    """Mint a magic link for an event: insert a fresh token's HASH + expiry and
    return the RAW token for emailing. A fresh link is issued per edit request
    (plan §7), so callers create a new row each time rather than reusing one."""
    raw_token = generate_token()
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=ttl_minutes)
    cursor.execute(
        "INSERT INTO magic_links (event_id, token_hash, expires_at) "
        "VALUES (%s, %s, %s) RETURNING id",
        (event_id, hash_token(raw_token), expires_at),
    )
    link_id = cursor.fetchone()["id"]
    return raw_token, link_id


def create_conversation_link(cursor, event_id):
    """Mint a per-event magic link for a messaging thread (admin⇄submitter). Same
    hashed-token shape as an edit link but with an effectively-indefinite expiry
    (see CONVERSATION_TTL_MINUTES) — the thread's real open/closed gate is the
    event state, checked in the messaging endpoints. Returns the RAW token for
    emailing. Resolved with the shared resolve_token (it's an event-scoped link)."""
    return create_magic_link(cursor, event_id, ttl_minutes=CONVERSATION_TTL_MINUTES)


def resolve_token(cursor, raw_token):
    """Look up a live (not-expired) magic link by a presented raw token. Returns
    the joined event context (magic_links + events row) or None. Does NOT mutate
    used_at — call mark_used only when an edit is actually committed, so scanner
    pre-clicks (GET) don't consume the link (see the module docstring)."""
    if not raw_token:
        return None
    cursor.execute(
        """
        SELECT
            ml.id            AS magic_link_id,
            ml.event_id,
            ml.expires_at,
            ml.used_at,
            e.current_status,
            e.published_version_id,
            e.submitter_email,
            e.slug
        FROM magic_links ml
        JOIN events e ON e.id = ml.event_id
        WHERE ml.token_hash = %s
          AND ml.expires_at > now()
        ORDER BY ml.id DESC
        LIMIT 1
        """,
        (hash_token(raw_token),),
    )
    return cursor.fetchone()


def mark_used(cursor, magic_link_id):
    """Stamp used_at for audit after a successful edit. Idempotent: only sets it
    the first time so the original use time is preserved."""
    cursor.execute(
        "UPDATE magic_links SET used_at = now() WHERE id = %s AND used_at IS NULL",
        (magic_link_id,),
    )


# ---------------------------------------------------------------------------
# Account-scoped links (customer "manage all my listings" dashboard). These are
# scoped to an EMAIL rather than a single event: magic_links.email is set and
# event_id is NULL. The token proves ownership of the email, so it authorises
# every listing that email submitted (ownership re-checked per action server-side).
# Same hashed-token / expiry / anti-enumeration shape as the per-event links.
# ---------------------------------------------------------------------------
def create_account_link(cursor, email, ttl_minutes=DEFAULT_TTL_MINUTES):
    """Mint an account-wide dashboard link for an email. Stores the token HASH +
    the email (event_id NULL) and returns the RAW token for emailing."""
    raw_token = generate_token()
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=ttl_minutes)
    cursor.execute(
        "INSERT INTO magic_links (event_id, email, token_hash, expires_at) "
        "VALUES (NULL, %s, %s, %s) RETURNING id",
        (email.strip().lower(), hash_token(raw_token), expires_at),
    )
    link_id = cursor.fetchone()["id"]
    return raw_token, link_id


def resolve_account_token(cursor, raw_token):
    """Look up a live (not-expired) ACCOUNT link by a presented raw token. Returns
    {magic_link_id, email, expires_at, used_at} or None. Only matches account
    links (email set, event_id NULL) so a per-event token can't be replayed here."""
    if not raw_token:
        return None
    cursor.execute(
        """
        SELECT id AS magic_link_id, email, expires_at, used_at
        FROM magic_links
        WHERE token_hash = %s
          AND email IS NOT NULL
          AND event_id IS NULL
          AND expires_at > now()
        ORDER BY id DESC
        LIMIT 1
        """,
        (hash_token(raw_token),),
    )
    return cursor.fetchone()
