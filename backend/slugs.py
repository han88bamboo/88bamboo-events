# slugs.py — canonical URL-slug generation for published events (plan §4/§7).
#
# CHOSEN to land in Phase 4A (not stubbed for Phase 5): publishing on approval is
# the moment a slug is first needed — events.slug is UNIQUE and NOT NULL once
# live — so generating it here keeps approve self-contained. Phase 5's detail
# pages + canonical-slug redirect then consume the slug this produces.
#
# Rule (plan §7): slug = name + city, lowercased/ASCII-ish, hyphen-separated;
# on collision, append a short numeric suffix ("-2", "-3", …) until unique. The
# uniqueness check runs inside the caller's transaction (cursor passed in) so the
# slug we return is still free when the same transaction writes it.

import re
import unicodedata


def slugify(*parts):
    """Turn free text (name, city) into a lowercase hyphen slug. Strips accents to
    ASCII, drops non-alphanumerics, collapses runs of separators. Returns a
    non-empty fallback ('event') if the inputs slugify to nothing."""
    text = " ".join(p for p in parts if p)
    # Decompose accents (é -> e) then drop non-ASCII so slugs stay URL-clean.
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii")
    text = text.lower()
    text = re.sub(r"[^a-z0-9]+", "-", text).strip("-")
    return text or "event"


def generate_unique_slug(cursor, name, city, exclude_event_id=None):
    """Return a slug unique against events.slug, deduped with a short suffix.

    `cursor` is the caller's transaction cursor so the check-and-use is atomic.
    `exclude_event_id` lets a re-slug of an existing event ignore its own row
    (unused in 4A's first-approval path, but keeps the helper reusable)."""
    base = slugify(name, city)
    candidate = base
    suffix = 2
    while _slug_taken(cursor, candidate, exclude_event_id):
        candidate = f"{base}-{suffix}"
        suffix += 1
    return candidate


def _slug_taken(cursor, slug, exclude_event_id):
    if exclude_event_id is not None:
        cursor.execute(
            "SELECT 1 FROM events WHERE slug = %s AND id <> %s LIMIT 1",
            (slug, exclude_event_id),
        )
    else:
        cursor.execute("SELECT 1 FROM events WHERE slug = %s LIMIT 1", (slug,))
    return cursor.fetchone() is not None
