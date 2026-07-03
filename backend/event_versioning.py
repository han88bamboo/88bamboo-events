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
        "  end_datetime, venue_name, venue_address, country, city,"
        "  description, link, contact_email, image_url, submission_type,"
        "  drink_categories, event_format"
        ") VALUES (%s, %s, 'pending_review', %s, %s, %s, %s, %s, %s, %s,"
        "          %s, %s, %s, %s, %s, %s, %s) RETURNING id",
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
            cleaned["description"],
            cleaned["link"],
            cleaned["contact_email"],
            image_url,
            cleaned["submission_type"],
            cleaned["drink_categories"],
            cleaned["event_format"],
        ),
    )
    new_version_id = cursor.fetchone()["id"]

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
