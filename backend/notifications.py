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
# The magic-link / edit emails are wired in Phase 5.

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
