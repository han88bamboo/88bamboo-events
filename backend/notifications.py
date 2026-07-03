# notifications.py — the transactional emails (plan §8), built as inline
# plain-text bodies (PATTERN-SPEC §A7: no template engine) and sent through the
# mailer abstraction. Delivery is best-effort (see mailer.send_email) so a mail
# hiccup never undoes an authorised/persisted submission or a completed action.
#
# Phase-3 emails:
#   - submitter "under review"  (the §8 review-window wording, verbatim)
#   - admin "new submission"    (queue alert for the owner to review)
# Phase-4A emails (added this round — plan §8):
#   - submitter "approved"      (listing live; the held fee is now charged)
#   - submitter "rejected"      (hold released, never charged; admin reason)
#   - submitter "re-pay"        (approve-but-capture-failed; hold lapsed, resubmit)
# Phase-4B emails (the safety-job mails — plan §6/§8):
#   - submitter "auto-released" (review window lapsed; hold freed, resubmit)
#   - admin     "pending digest" (once-a-day summary of the review queue)
#   - admin     "expiry alert"   (send-once 48h / 24h before an authorisation lapses)
# Phase-5 emails (magic-link editing — plan §7/§8):
#   - submitter "magic link"     (one-time 30-min edit link, URL token)
#   - submitter "edit received"  (changes under review; edits are free)
#   - admin     "edit awaiting"  (an edit is queued for review)
#   - submitter "edit approved"  (the update is live; slug unchanged)

import logging

from mailer import send_email

log = logging.getLogger("notifications")


def _format_fee(amount, currency):
    """Render the tier fee for prose, e.g. 'USD 5' — driven by the pricing tier,
    not a hardcoded constant (plan §6). Trims a trailing '.00' so USD 5.00 reads
    as 'USD 5' to match the §8 wording."""
    text = f"{amount:.2f}".rstrip("0").rstrip(".")
    return f"{currency} {text}"


def send_under_review(recipient, event, amount, currency):
    """Submitter confirmation. The body is the plan §8 review-window wording
    (kept verbatim so the hold-not-a-charge promise is exact), with the fee
    interpolated from the active tier."""
    fee = _format_fee(amount, currency)
    subject = "We received your event submission — under review"
    body = (
        f"Hi,\n\n"
        f"Thanks for your submission! Listings are usually reviewed within 3 "
        f"business days. While we review, your card shows a temporary "
        f"authorisation (a hold, not a charge). If we approve your listing, it "
        f"goes live and the {fee} is charged then. If we reject it, the hold is "
        f"released and you are never charged. If we can't review it within the "
        f"authorisation window, the hold is automatically released with no "
        f"charge and you're welcome to resubmit.\n\n"
        f"Event: {event.get('name')}\n"
        f"When:  {event.get('start_datetime')} — {event.get('end_datetime')}\n"
        f"Where: {event.get('city')}, {event.get('country')}\n\n"
        f"— 88 Bamboo Events"
    )
    return send_email(subject, recipient, body)


def send_new_submission_admin(recipient, event, amount, currency, capture_before,
                              is_duplicate=False):
    """Owner alert that a new listing is awaiting review. Plain-text queue
    summary; surfaces the capture deadline (so the hold is actioned in time) and
    a duplicate flag when the (email + name + date) dedupe fired (plan §6)."""
    fee = _format_fee(amount, currency)
    dup_line = (
        "\n** POSSIBLE DUPLICATE ** — a submission with the same email, event "
        "name and date already exists. Review before approving.\n"
        if is_duplicate
        else ""
    )
    deadline = capture_before.isoformat() if capture_before else "unknown"
    subject = f"New event submission: {event.get('name')}"
    body = (
        f"A new event listing is awaiting review.\n"
        f"{dup_line}\n"
        f"Event:      {event.get('name')}\n"
        f"Submitter:  {event.get('submitter_email')}\n"
        f"When:       {event.get('start_datetime')} — {event.get('end_datetime')}\n"
        f"Where:      {event.get('venue_name') or '-'}, "
        f"{event.get('city')}, {event.get('country')}\n"
        f"Format:     {event.get('event_format')}\n"
        f"Categories: {', '.join(event.get('drink_categories') or [])}\n"
        f"Fee held:   {fee} (authorised, not captured)\n"
        f"Capture by: {deadline} (release the hold or capture before this)\n\n"
        f"Open the admin dashboard to approve or reject.\n"
        f"— 88 Bamboo Events"
    )
    return send_email(subject, recipient, body)


def send_approved(recipient, event, amount, currency, public_url=None):
    """Submitter approval email (plan §8 approved). The listing is live and the
    held authorisation has now been captured — so this is the moment the fee is
    actually charged. Mirrors the promise made in the under-review email."""
    fee = _format_fee(amount, currency)
    url_line = f"\nYour listing: {public_url}\n" if public_url else ""
    subject = f"Your event is live: {event.get('name')}"
    body = (
        f"Hi,\n\n"
        f"Good news — your event listing has been approved and is now live on the "
        f"88 Bamboo events board. As explained when you submitted, the temporary "
        f"authorisation on your card has now been captured, so the {fee} listing "
        f"fee has been charged.\n"
        f"{url_line}\n"
        f"Event: {event.get('name')}\n"
        f"When:  {event.get('start_datetime')} — {event.get('end_datetime')}\n"
        f"Where: {event.get('city')}, {event.get('country')}\n\n"
        f"Thank you for listing with us.\n"
        f"— 88 Bamboo Events"
    )
    return send_email(subject, recipient, body)


def send_rejected(recipient, event, reason=None):
    """Submitter rejection email (plan §8 rejected, with reason). NOT a refund —
    the authorisation is released (cancelled), so the card was never charged. The
    reason is admin-editable and stored on event_versions.rejection_reason."""
    reason_line = (
        f"\nReason: {reason}\n" if reason and reason.strip() else ""
    )
    subject = f"About your event submission: {event.get('name')}"
    body = (
        f"Hi,\n\n"
        f"Thank you for your submission. After review, we're unable to publish "
        f"this listing at the moment. As promised, the temporary authorisation on "
        f"your card has been released — you have NOT been charged.\n"
        f"{reason_line}\n"
        f"Event: {event.get('name')}\n"
        f"When:  {event.get('start_datetime')} — {event.get('end_datetime')}\n\n"
        f"You're welcome to address the above and resubmit.\n"
        f"— 88 Bamboo Events"
    )
    return send_email(subject, recipient, body)


def send_auto_released(recipient, event, amount, currency):
    """Submitter email for the hourly auto-release safety job (plan §6). The
    authorisation window lapsed before the listing could be reviewed, so the hold
    was automatically released — the card was never charged. This is the promise
    made in the under-review email ("If we can't review it within the
    authorisation window, the hold is automatically released with no charge and
    you're welcome to resubmit"), so the wording mirrors it."""
    fee = _format_fee(amount, currency)
    subject = f"Your event submission — hold released, please resubmit: {event.get('name')}"
    body = (
        f"Hi,\n\n"
        f"Thanks again for your submission. Unfortunately we weren't able to "
        f"review your listing within the card authorisation window, so — exactly "
        f"as promised when you submitted — the temporary {fee} hold on your card "
        f"has now been automatically released. You have NOT been charged.\n\n"
        f"You're very welcome to resubmit and we'll take a fresh authorisation:\n"
        f"Event: {event.get('name')}\n"
        f"When:  {event.get('start_datetime')} — {event.get('end_datetime')}\n\n"
        f"Sorry we couldn't get to it in time.\n"
        f"— 88 Bamboo Events"
    )
    return send_email(subject, recipient, body)


def send_pending_digest(recipient, pending_rows):
    """Admin daily digest of the review queue (plan §6/§8). One line per pending
    submission with its capture deadline so nothing is left to auto-release. Sent
    once a day by the scheduler; a no-op benign body when the queue is empty (the
    scheduler skips the send in that case, but the empty branch keeps it safe)."""
    count = len(pending_rows)
    if count == 0:
        lines = "The review queue is empty — nothing awaiting review.\n"
    else:
        lines = ""
        for row in pending_rows:
            deadline = row.get("capture_before")
            deadline = deadline.isoformat() if hasattr(deadline, "isoformat") else (deadline or "unknown")
            lines += (
                f"- {row.get('name')} "
                f"(from {row.get('submitter_email')}) "
                f"— capture by {deadline}\n"
            )
    subject = f"88 Bamboo Events — {count} listing(s) awaiting review"
    body = (
        f"Daily review digest.\n\n"
        f"{count} submission(s) are awaiting your review:\n\n"
        f"{lines}\n"
        f"Open the admin dashboard to approve or reject. Holds are released "
        f"automatically if not actioned before their capture deadline.\n"
        f"— 88 Bamboo Events"
    )
    return send_email(subject, recipient, body)


def send_expiry_alert(recipient, event, capture_before, threshold_label):
    """Admin pre-expiry alert (plan §6/§8). Sent SEND-ONCE per threshold per
    payment (the scheduler records a marker in admin_actions and skips rows
    already alerted at this threshold, so an hourly scan can't re-send ~24 copies
    across the window). `threshold_label` is a human string like '48 hours' /
    '24 hours'."""
    deadline = capture_before.isoformat() if hasattr(capture_before, "isoformat") else (capture_before or "unknown")
    subject = (
        f"Action needed within {threshold_label}: {event.get('name')}"
    )
    body = (
        f"An authorised submission is approaching its capture deadline.\n\n"
        f"If it is not approved or rejected within about {threshold_label}, the "
        f"hold will be released automatically and the submitter asked to "
        f"resubmit.\n\n"
        f"Event:      {event.get('name')}\n"
        f"Submitter:  {event.get('submitter_email')}\n"
        f"When:       {event.get('start_datetime')} — {event.get('end_datetime')}\n"
        f"Capture by: {deadline}\n\n"
        f"Open the admin dashboard to action it.\n"
        f"— 88 Bamboo Events"
    )
    return send_email(subject, recipient, body)


def send_magic_link(recipient, slug, edit_url):
    """Submitter's edit magic-link email (plan §7/§8). Carries the one-time,
    30-minute URL token as a plain link — no cookie, no password. The token is in
    the URL because editing may run through the App Proxy (which strips cookies)."""
    subject = "Your edit link for your 88 Bamboo event listing"
    body = (
        f"Hi,\n\n"
        f"You (or someone using your email) asked to edit your event listing "
        f"'{slug}'. Use the link below to make changes — it expires in 30 "
        f"minutes and is for you alone:\n\n"
        f"{edit_url}\n\n"
        f"Any changes you submit are reviewed before they go live. If you didn't "
        f"request this, you can safely ignore this email — nothing changes.\n"
        f"— 88 Bamboo Events"
    )
    return send_email(subject, recipient, body)


def send_edit_received(recipient, event):
    """Submitter confirmation that an edit was received and is under review (plan
    §7/§8). Edits are free at MVP, so — unlike a first submission — there is no new
    card hold to explain."""
    subject = f"We received your edit — under review: {event.get('name')}"
    body = (
        f"Hi,\n\n"
        f"Thanks — we received your changes and they're now under review. Your "
        f"current listing stays as-is until we approve the update; there's no "
        f"charge for edits.\n\n"
        f"Event: {event.get('name')}\n"
        f"When:  {event.get('start_datetime')} — {event.get('end_datetime')}\n"
        f"Where: {event.get('city')}, {event.get('country')}\n\n"
        f"We'll email you once it's live.\n"
        f"— 88 Bamboo Events"
    )
    return send_email(subject, recipient, body)


def send_edit_submission_admin(recipient, event, was_published):
    """Owner alert that an EDIT is awaiting review (plan §7/§8). Notes whether it
    edits an already-live listing (approving repoints the published version, keeps
    the slug) or amends a still-pending submission."""
    kind = (
        "an edit to an already-LIVE listing"
        if was_published
        else "an amendment to a still-pending submission"
    )
    subject = f"Edit awaiting review: {event.get('name')}"
    body = (
        f"A submitter has proposed {kind}.\n\n"
        f"Event:      {event.get('name')}\n"
        f"Submitter:  {event.get('submitter_email')}\n"
        f"When:       {event.get('start_datetime')} — {event.get('end_datetime')}\n"
        f"Where:      {event.get('city')}, {event.get('country')}\n"
        f"Format:     {event.get('event_format')}\n"
        f"Categories: {', '.join(event.get('drink_categories') or [])}\n\n"
        f"Open the admin dashboard to review the new version. Edits are free — no "
        f"payment is attached.\n"
        f"— 88 Bamboo Events"
    )
    return send_email(subject, recipient, body)


def send_edit_approved(recipient, event, public_url=None):
    """Submitter email when an EDIT is approved and is now the live version (plan
    §7/§8). The slug (and URL) is unchanged — only the content updated."""
    url_line = f"\nYour listing: {public_url}\n" if public_url else ""
    subject = f"Your listing update is live: {event.get('name')}"
    body = (
        f"Hi,\n\n"
        f"Your changes have been approved and are now live on the 88 Bamboo "
        f"events board — same link as before, updated details.\n"
        f"{url_line}\n"
        f"Event: {event.get('name')}\n"
        f"When:  {event.get('start_datetime')} — {event.get('end_datetime')}\n"
        f"Where: {event.get('city')}, {event.get('country')}\n\n"
        f"Thanks for keeping your listing up to date.\n"
        f"— 88 Bamboo Events"
    )
    return send_email(subject, recipient, body)


def send_repay_required(recipient, event, amount, currency):
    """Submitter email for the approve-but-capture-fails state (plan §6). The
    admin approved, but the authorisation could no longer be captured (the hold
    lapsed or the card died), so the listing is NOT live. Asks the submitter to
    resubmit so a fresh authorisation can be taken."""
    fee = _format_fee(amount, currency)
    subject = f"Action needed to publish your event: {event.get('name')}"
    body = (
        f"Hi,\n\n"
        f"We tried to approve your event listing, but the temporary authorisation "
        f"on your card could no longer be captured — this usually means the hold "
        f"expired or the card is no longer valid. You have NOT been charged, and "
        f"your listing is not yet live.\n\n"
        f"To publish it, please resubmit so we can take a fresh {fee} "
        f"authorisation:\n"
        f"Event: {event.get('name')}\n"
        f"When:  {event.get('start_datetime')} — {event.get('end_datetime')}\n\n"
        f"Sorry for the inconvenience.\n"
        f"— 88 Bamboo Events"
    )
    return send_email(subject, recipient, body)
