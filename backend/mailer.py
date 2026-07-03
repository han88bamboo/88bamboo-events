# mailer.py — the transactional-email abstraction (plan §8, PATTERN-SPEC §A7).
#
# ONE entry point, `send_email(subject, recipient, body)`, that picks a transport
# by the PURPOSE env switch — mirroring Drink-X's dev/prod mail branch (§A7):
#
#   PURPOSE=production            -> AWS SES v2 (boto3 `sesv2`, raw MIME)
#   local + MAIL_SERVER set       -> SMTP (e.g. MailHog on :1025) — opt-in
#   local (default)               -> log to the console; NEVER sends real mail
#
# The SES path is written to the §A7 shape so it swaps in cleanly at deploy, but
# it only runs under PURPOSE=production — locally we never send real email
# (plan §9). Bodies are plain text assembled by callers (notifications.py); no
# template engine, matching §A7.

import logging
import os
import smtplib
from email.mime.text import MIMEText

log = logging.getLogger("mailer")

# Verified sender identity. Local transports ignore verification; SES requires it
# (88bamboo.co is verified out-of-sandbox in Phase 7 — plan §3).
DEFAULT_SENDER = os.getenv("SES_SENDER", "events@88bamboo.co")


def _build_mime(subject, recipient, body, sender):
    """A minimal text/plain MIME message (utf-8), reused by the SMTP and SES
    transports so both send byte-identical mail (§A7: text/plain only)."""
    msg = MIMEText(body, "plain", "utf-8")
    msg["Subject"] = subject
    msg["From"] = sender
    msg["To"] = recipient
    return msg


def _send_console(subject, recipient, body, sender):
    """Local default: log the whole message instead of sending it. Makes the two
    Phase-3 emails provable locally (they appear in the api logs) with zero
    infra and zero risk of contacting a real inbox (plan §9)."""
    log.info(
        "[mailer:console] EMAIL NOT SENT (local dev)\n"
        "  From:    %s\n  To:      %s\n  Subject: %s\n"
        "  ----- body -----\n%s\n  ----------------",
        sender,
        recipient,
        subject,
        body,
    )
    return True


def _send_smtp(subject, recipient, body, sender):
    """Opt-in local transport for MailHog / any dev SMTP (no auth, no TLS by
    default). Enabled only when MAIL_SERVER is set. MailHog captures mail in its
    web UI without ever relaying it externally."""
    host = os.getenv("MAIL_SERVER")
    port = int(os.getenv("MAIL_PORT", "1025"))
    msg = _build_mime(subject, recipient, body, sender)
    with smtplib.SMTP(host, port, timeout=10) as server:
        if os.getenv("MAIL_USE_TLS", "false").lower() == "true":
            server.starttls()
        username = os.getenv("MAIL_USERNAME")
        if username:
            server.login(username, os.getenv("MAIL_PASSWORD", ""))
        server.sendmail(sender, [recipient], msg.as_string())
    return True


def _send_ses(subject, recipient, body, sender):
    """Production transport: AWS SES v2 raw MIME (PATTERN-SPEC §A7). boto3 is
    imported lazily so local runs never need it. Credentials come from the ECS
    task IAM role in production (no explicit keys — §A5/§A7)."""
    import boto3
    from botocore.exceptions import ClientError

    msg = _build_mime(subject, recipient, body, sender)
    client = boto3.client("sesv2", region_name=os.getenv("AWS_REGION", "ap-southeast-1"))
    try:
        client.send_email(
            FromEmailAddress=sender,
            Destination={"ToAddresses": [recipient]},
            Content={"Raw": {"Data": msg.as_string()}},
        )
    except ClientError:
        log.exception("SES send failed for %s", recipient)
        raise
    return True


def send_email(subject, recipient, body, sender=None):
    """Send one plain-text email through the PURPOSE-selected transport. Returns
    True on success. Callers treat delivery as best-effort — a failed
    notification must not roll back an already-authorised, already-persisted
    submission (the Phase-4 admin digest is the backstop)."""
    sender = sender or DEFAULT_SENDER
    if not recipient:
        log.warning("send_email skipped: no recipient for subject %r", subject)
        return False

    if os.getenv("PURPOSE") == "production":
        return _send_ses(subject, recipient, body, sender)
    if os.getenv("MAIL_SERVER"):
        return _send_smtp(subject, recipient, body, sender)
    return _send_console(subject, recipient, body, sender)
