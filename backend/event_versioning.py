# event_versioning.py — shared edit-versioning logic (plan §7). Extracted so BOTH
# edit entry points reuse identical behaviour:
#   - scripts/edits.py     per-event magic link (slug + email -> one listing)
#   - scripts/account.py   account dashboard (email -> all listings)
#
# An edit always creates a NEW event_versions row; prior versions are retained
# (plan §7 full history). Two cases, keyed on whether the event is already
# published (events.published_version_id):
#
#   PRE-approval edit (never published): the authorised card hold sits on the
#   version under review, so we MOVE that payment onto the new version and mark
#   the old pending version(s) 'rejected' ("superseded") WITHOUT cancelling the
#   hold — the queue then shows exactly one pending version carrying the live hold.
#
#   POST-approval edit (already live): the published version keeps serving; the
#   edit is a NEW pending version with NO payment (edits are free at MVP). On
#   approval, scripts/admin.py repoints published_version_id and keeps the slug.
#
# Image is carried forward from the version being edited (image editing is out of
# MVP scope).

from organiser_names import claim_organiser_name, normalise_organiser_name


def insert_occurrences(cursor, version_id, occurrences):
    """Snapshot a version's per-date schedule (EP-6). `occurrences` is the cleaned
    list of {"start": iso, "end": iso} from validate_submission (start-sorted).
    Occurrences are per-version and immutable like the version itself, so every
    submit + edit re-inserts them against the NEW version_id (they behave like
    drink_categories — round-tripped through the form — not like a mutated row).
    A single-date submission has exactly one row; a legacy version has none (reads
    imply one from the scalar summary). Runs in the caller's transaction."""
    for i, occ in enumerate(occurrences or []):
        cursor.execute(
            "INSERT INTO event_occurrences ("
            "  event_version_id, starts_at, ends_at, sort_order"
            ") VALUES (%s, %s, %s, %s)",
            (version_id, occ["start"], occ["end"], i),
        )


def fetch_occurrences(cursor, version_id):
    """Read a version's schedule as a start-sorted list of {"start": iso, "end": iso}
    for the edit-form prefill + the public detail page (EP-6). Returns [] for a
    legacy version with no rows; callers imply a single occurrence from the scalar
    summary in that case (E-D2, no backfill)."""
    cursor.execute(
        "SELECT starts_at, ends_at FROM event_occurrences "
        "WHERE event_version_id = %s ORDER BY sort_order, starts_at",
        (version_id,),
    )
    return [
        {
            "start": r["starts_at"].isoformat() if r["starts_at"] else None,
            "end": r["ends_at"].isoformat() if r["ends_at"] else None,
        }
        for r in cursor.fetchall()
    ]


def editable_version(cursor, event_id, published_version_id):
    """The version whose content prefills an edit form / seeds a new edit: the
    live one if the event is published, otherwise the latest submitted version."""
    if published_version_id is not None:
        cursor.execute(
            "SELECT * FROM event_versions WHERE id = %s",
            (published_version_id,),
        )
    else:
        cursor.execute(
            "SELECT * FROM event_versions WHERE event_id = %s "
            "ORDER BY version_number DESC, id DESC LIMIT 1",
            (event_id,),
        )
    return cursor.fetchone()


def create_edit_version(cursor, event_id, published_version_id, cleaned,
                        supersede_reason="Superseded by a newer edit"):
    """Create a new pending_review version from validated `cleaned` fields, handling
    the pre-/post-approval cases above. Runs entirely in the caller's transaction.
    Returns (new_version_id, is_published).

    `supersede_reason` is the rejection_reason stamped on the prior pending
    version(s) in the pre-approval case — defaulted for submitter edits, overridden
    to "Superseded by an admin edit" when the admin edits from the dashboard."""
    is_published = published_version_id is not None

    # Carry the prior version's image forward (no image re-upload on edit at MVP).
    source = editable_version(cursor, event_id, published_version_id)
    image_url = source["image_url"] if source else None

    # Carry the captured LOCATION forward the same way (EP-2): if the edit did not
    # change the address, keep the source version's coordinates / place_id / postcode
    # so an untouched (or legacy, coordinate-less) address is never forced through a
    # re-pick. A CHANGED address brings its own coordinates from its new Google
    # selection (already in `cleaned`). `region` is a separate controlled dropdown,
    # so it always comes from the submitted form.
    same_address = bool(source) and (cleaned.get("venue_address") or None) == (
        source["venue_address"] or None
    )
    if same_address and cleaned.get("latitude") is None:
        latitude = source["latitude"]
        longitude = source["longitude"]
        place_id = source["place_id"]
        postcode = source["postcode"]
    else:
        latitude = cleaned.get("latitude")
        longitude = cleaned.get("longitude")
        place_id = cleaned.get("place_id")
        postcode = cleaned.get("postcode")

    # New version number = current max + 1 (full history retained).
    cursor.execute(
        "SELECT COALESCE(MAX(version_number), 0) + 1 AS n "
        "FROM event_versions WHERE event_id = %s",
        (event_id,),
    )
    next_version_number = cursor.fetchone()["n"]

    cursor.execute(
        "INSERT INTO event_versions ("
        "  event_id, version_number, approval_status, name, start_datetime,"
        "  end_datetime, venue_name, venue_address, country, city, region,"
        "  latitude, longitude, place_id, postcode,"
        "  description, link, contact_email, image_url, submission_type,"
        "  drink_categories, event_format, organiser_name"
        ") VALUES (%s, %s, 'pending_review', %s, %s, %s, %s, %s, %s, %s,"
        "          %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id",
        (
            event_id,
            next_version_number,
            cleaned["name"],
            cleaned["start_datetime"],
            cleaned["end_datetime"],
            cleaned["venue_name"],
            cleaned["venue_address"],
            cleaned["country"],
            cleaned["city"],
            cleaned["region"],
            latitude,
            longitude,
            place_id,
            postcode,
            cleaned["description"],
            cleaned["link"],
            cleaned["contact_email"],
            image_url,
            cleaned["submission_type"],
            cleaned["drink_categories"],
            cleaned["event_format"],
            # Organiser name (EP-7) round-trips through the edit form like
            # drink_categories, so re-inserting it IS the carry-forward. None when
            # the submitter cleared it.
            cleaned.get("organiser_name"),
        ),
    )
    new_version_id = cursor.fetchone()["id"]

    # EP-7: re-run the organiser-name claim ONLY when it CHANGED. The owner is the
    # event's own submitter email — an edit session already proves ownership (its
    # magic link / account token / admin auth), so no re-auth is needed here. An
    # unchanged name is already claimed; a changed name is claimed against the owner
    # (a name owned by a DIFFERENT account raises OrganiserNameConflict → the
    # caller's transaction rolls back and it returns a conflict).
    new_organiser = cleaned.get("organiser_name")
    if new_organiser:
        prev_organiser = source.get("organiser_name") if source else None
        if normalise_organiser_name(new_organiser) != normalise_organiser_name(prev_organiser):
            cursor.execute("SELECT submitter_email FROM events WHERE id = %s", (event_id,))
            owner_row = cursor.fetchone()
            claim_organiser_name(
                cursor, new_organiser, owner_row["submitter_email"] if owner_row else None
            )

    # Re-snapshot the per-date schedule onto the NEW version (EP-6). `cleaned`
    # always carries the current schedule (the edit forms round-trip it, so an
    # unchanged schedule is simply re-inserted — the carry-forward), derived from
    # the same occurrences the summary start/end above came from.
    insert_occurrences(cursor, new_version_id, cleaned.get("occurrences"))

    if not is_published:
        # PRE-approval edit: move the still-authorised hold onto the new version
        # and supersede the old pending version(s). The hold is NOT cancelled.
        cursor.execute(
            "UPDATE payments SET event_version_id = %s "
            "WHERE event_version_id IN ("
            "  SELECT id FROM event_versions "
            "  WHERE event_id = %s AND id <> %s AND approval_status = 'pending_review'"
            ") AND status = 'authorised'",
            (new_version_id, event_id, new_version_id),
        )
        cursor.execute(
            "UPDATE event_versions "
            "SET approval_status = 'rejected', "
            "    rejection_reason = %s "
            "WHERE event_id = %s AND id <> %s AND approval_status = 'pending_review'",
            (supersede_reason, event_id, new_version_id),
        )

    return new_version_id, is_published
