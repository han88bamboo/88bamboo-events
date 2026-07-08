# organiser_names.py — the public event-organiser name registry (EP-7 F2/F-D3/F-D4).
#
# A submitter who is LOGGED IN (an authenticated account email — F-D2) may set an
# optional, publicly-shown organiser name. Names are race-proof first-come-first-
# served and cross-account-unique: the first email to claim a name OWNS it and may
# reuse it on any number of their own events; a DIFFERENT email is rejected. The
# UNIQUE constraint on event_organiser_names.normalised_name is the ultimate guard
# (it resolves a submit-time race), while these helpers give a clean read-side
# pre-check + the "my previous organiser names" dropdown source.
#
# Two concerns, split like the rest of the codebase:
#   - normalise_organiser_name(s): PURE, DB-free (unit-testable in isolation) — the
#     F-D4 matching rule (case-insensitive + trim + fold accents + strip
#     punctuation + collapse whitespace). Two names collide iff their normalised
#     forms are equal. The DISPLAY name keeps the submitter's original casing.
#   - the cursor helpers (check/claim/fetch): take the caller's transaction cursor
#     so the read-check and the write stay atomic (mirrors magic_links / slugs).

import unicodedata


class OrganiserNameConflict(Exception):
    """Raised when a normalised organiser name is already owned by a DIFFERENT
    account email. Callers translate it into a 4xx conflict response; when it is
    raised inside a persist transaction, the surrounding get_cursor rolls back (and
    the submit path additionally cancels the payment intent — F-D5)."""


def normalise_organiser_name(name):
    """Fold an organiser name to its canonical match key (F-D4). Case-insensitive,
    trimmed, accents folded (é→e), punctuation stripped, internal whitespace
    collapsed. Returns a lowercase string ('' for blank/all-punctuation input).

    So "Sake Matsuri Singapore", "sake  matsuri singapore " and
    "Saké-Matsuri, Singapore" all normalise to "sake matsuri singapore" and collide.
    Non-Latin scripts (e.g. CJK) are preserved — only combining accent marks are
    stripped — so those names still match on their own exact form."""
    if not name:
        return ""
    # NFKD decomposition splits an accented letter into base + combining mark;
    # dropping the combining marks folds the accent away.
    decomposed = unicodedata.normalize("NFKD", name)
    without_accents = "".join(c for c in decomposed if not unicodedata.combining(c))
    # Lowercase, then turn every non-alphanumeric char (punctuation, symbols,
    # underscores) into a space so "Saké-Matsuri," and "Sake Matsuri" agree.
    spaced = "".join(c if c.isalnum() else " " for c in without_accents.lower())
    # Collapse runs of whitespace and trim.
    return " ".join(spaced.split())


def check_organiser_name_available(cursor, name, owner_email):
    """Read-only pre-flight used BEFORE the payment hold (F-D5): True when `name` is
    unclaimed OR already owned by `owner_email`; False when a DIFFERENT email owns
    it. A blank/all-punctuation name (normalises to '') is treated as available —
    there is nothing meaningful to own. Does NOT write; the actual claim is
    claim_organiser_name inside the persist transaction."""
    normalised = normalise_organiser_name(name)
    if not normalised:
        return True
    owner = (owner_email or "").strip().lower()
    cursor.execute(
        "SELECT owner_email FROM event_organiser_names WHERE normalised_name = %s",
        (normalised,),
    )
    row = cursor.fetchone()
    return row is None or (row["owner_email"] or "").strip().lower() == owner


def claim_organiser_name(cursor, name, owner_email):
    """Claim `name` for `owner_email` inside the caller's transaction (F-D3/F-D5).

    - unclaimed  -> INSERT the claim (display_name keeps the original casing);
    - same owner -> no-op (the owner reuses their own name freely);
    - different owner -> raise OrganiserNameConflict (first-come-first-served).

    A blank/all-punctuation name is a no-op. A concurrent claim that slips past the
    SELECT is caught by the normalised_name UNIQUE constraint, which raises a
    psycopg2 IntegrityError — the surrounding transaction then rolls back (F-D5)."""
    normalised = normalise_organiser_name(name)
    if not normalised:
        return
    owner = (owner_email or "").strip().lower()
    cursor.execute(
        "SELECT owner_email FROM event_organiser_names WHERE normalised_name = %s",
        (normalised,),
    )
    row = cursor.fetchone()
    if row is None:
        cursor.execute(
            "INSERT INTO event_organiser_names (normalised_name, owner_email, display_name) "
            "VALUES (%s, %s, %s)",
            (normalised, owner, name.strip()),
        )
        return
    if (row["owner_email"] or "").strip().lower() != owner:
        raise OrganiserNameConflict(
            "That organiser name is already in use by another account."
        )
    # Same owner — the existing claim already covers this name; nothing to do.


def fetch_organiser_names(cursor, owner_email):
    """The display names this email has previously claimed, newest first — the
    source for the submitter's "my previous organiser names" dropdown (F-D3)."""
    owner = (owner_email or "").strip().lower()
    if not owner:
        return []
    cursor.execute(
        "SELECT display_name FROM event_organiser_names "
        "WHERE lower(owner_email) = %s ORDER BY created_at DESC, id DESC",
        (owner,),
    )
    return [r["display_name"] for r in cursor.fetchall()]
