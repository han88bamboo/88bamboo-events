# scripts/scheduled_tasks.py — the Phase-4B safety-net background jobs (plan §6/§8,
# PATTERN-SPEC §A1/§A8). APScheduler in-process jobs, started once from app.py.
#
# NOTE ON THE LOADER: this file lives in scripts/ but deliberately does NOT define
# a `blueprint`, so the app.py auto-loader (create_routes) imports it but registers
# no routes. The scheduler is started explicitly by app.py calling start_scheduler().
#
# The three jobs (plan §6):
#   1. auto_release_expired()  — HOURLY. Any payment still 'authorised' whose event
#      version is still 'pending_review' and whose Stripe capture_before is within
#      24h is CANCELLED (free release, never captured), the payment marked
#      'auto_released', the version 'auto_rejected_expired', the event 'expired',
#      and the submitter emailed to resubmit. The row's live state is re-checked
#      inside the job's own transaction (SELECT ... FOR UPDATE) so it never races a
#      concurrent manual approve. We NEVER auto-capture an unapproved submission.
#   2. send_expiry_alerts()    — HOURLY. Admin alerts at the 48h and 24h marks
#      before capture_before. SEND-ONCE per threshold per payment: an admin_actions
#      marker row (action='expiry_alert_48h' / 'expiry_alert_24h') records that the
#      alert went out, and rows already marked at a threshold are skipped — so the
#      hourly scan can't re-send ~24 duplicates across the window.
#   3. send_pending_digest_job() — DAILY. One summary email of the whole review
#      queue to the admin.
#
# Timezone: all comparisons are timezone-aware UTC against the TIMESTAMPTZ
# capture_before (pytz pinned in requirements; datetime.timezone.utc suffices here).

import logging
import os
from datetime import datetime, timedelta, timezone

from notifications import (
    send_auto_released,
    send_expiry_alert,
    send_pending_digest,
)
from payments import cancel_intent

# NOTE: db_manager, psycopg2 and APScheduler are all imported lazily inside the
# jobs / start_scheduler (not at module top) so this module can be imported to
# unit-test the pure decision helpers on a bare Python (stdlib + stripe) without
# the DB pool, psycopg2 or APScheduler installed — matching how the rest of the
# tests run on the host outside the container.

log = logging.getLogger("scheduled_tasks")
if not log.handlers:
    # Own handler at INFO so the job activity is visible under gunicorn even though
    # the app never calls logging.basicConfig (root default WARNING would swallow
    # it) — same rationale as mailer.py. Local proof the plan asks for.
    _h = logging.StreamHandler()
    _h.setFormatter(logging.Formatter("%(asctime)s [scheduler] %(message)s"))
    log.addHandler(_h)
    log.setLevel(logging.INFO)

# ---------------------------------------------------------------------------
# Windows / thresholds (plan §6). Kept as module constants so the pure helpers
# below are trivially unit-testable without a DB or a live clock.
# ---------------------------------------------------------------------------
RELEASE_WINDOW = timedelta(hours=24)   # auto-release when capture_before is this close
ALERT_48H = timedelta(hours=48)
ALERT_24H = timedelta(hours=24)

# The value we stamp on events.current_status when a hold auto-releases. The
# column is free-form (no CHECK), so we pick 'expired' and use it consistently so
# the row drops out of the pending/live views (plan §6).
EXPIRED_STATUS = "expired"

# admin_actions markers used to make the alerts send-once (plan §8).
ALERT_ACTION_48H = "expiry_alert_48h"
ALERT_ACTION_24H = "expiry_alert_24h"


# ---------------------------------------------------------------------------
# Pure decision helpers (no DB, no I/O) — unit-tested in tests/.
# ---------------------------------------------------------------------------
def due_for_release(now, capture_before):
    """True if an authorised+pending hold should be auto-released now: its
    capture_before is within RELEASE_WINDOW of `now` (or already past). Both args
    are timezone-aware UTC datetimes."""
    if capture_before is None:
        return False
    return (capture_before - now) <= RELEASE_WINDOW


def alerts_due(now, capture_before, sent_48h, sent_24h):
    """Return the list of threshold actions that should be sent for this payment
    right now, given which have already been sent. Send-once is enforced by the
    caller recording a marker; this only decides *which* thresholds are in-window
    and not yet sent. Returns a subset of [ALERT_ACTION_48H, ALERT_ACTION_24H]."""
    if capture_before is None:
        return []
    remaining = capture_before - now
    due = []
    if not sent_48h and remaining <= ALERT_48H:
        due.append(ALERT_ACTION_48H)
    if not sent_24h and remaining <= ALERT_24H:
        due.append(ALERT_ACTION_24H)
    return due


def _threshold_label(action):
    return "48 hours" if action == ALERT_ACTION_48H else "24 hours"


def _utcnow():
    return datetime.now(timezone.utc)


def _admin_email():
    """The digest/alert recipient: the active admin_users row, else
    ADMIN_NOTIFY_EMAIL (mirrors submissions.py's fallback)."""
    from app import db_manager

    try:
        with db_manager.get_cursor(commit=False) as cursor:
            cursor.execute(
                "SELECT email FROM admin_users WHERE active = TRUE ORDER BY id LIMIT 1"
            )
            row = cursor.fetchone()
    except Exception:
        log.exception("could not read admin recipient")
        row = None
    return row["email"] if row else os.getenv("ADMIN_NOTIFY_EMAIL")


def _event_for_mail(row):
    """Shape a joined scan row into the dict the notification helpers expect."""
    return {
        "name": row.get("name"),
        "submitter_email": row.get("submitter_email"),
        "start_datetime": row.get("start_datetime"),
        "end_datetime": row.get("end_datetime"),
        "city": row.get("city"),
        "country": row.get("country"),
    }


# ---------------------------------------------------------------------------
# Job 1 — hourly auto-release of near-expiry unactioned holds (plan §6).
# ---------------------------------------------------------------------------
def auto_release_expired():
    """CANCEL every authorised+pending hold within 24h of its capture_before, per
    the plan §6 hard rule that no authorisation ever expires unactioned. Each row
    is processed in its OWN transaction that re-reads and locks the payment row
    (FOR UPDATE) so a manual approve committing at the same moment can't be
    clobbered. Emails are sent after each commit (best-effort)."""
    from app import db_manager
    from psycopg2.extras import Json

    now = _utcnow()
    cutoff = now + RELEASE_WINDOW
    log.info("auto_release_expired: scanning for holds expiring before %s", cutoff.isoformat())

    # Find candidate payment ids first (a cheap read; the index
    # idx_payments_status_capture supports the status+capture_before scan). Each
    # is then re-checked under a row lock in its own transaction.
    try:
        with db_manager.get_cursor(commit=False) as cursor:
            cursor.execute(
                """
                SELECT p.id
                FROM payments p
                JOIN event_versions ev ON ev.id = p.event_version_id
                WHERE p.status = 'authorised'
                  AND ev.approval_status = 'pending_review'
                  AND p.capture_before IS NOT NULL
                  AND p.capture_before <= %s
                ORDER BY p.capture_before ASC
                """,
                (cutoff,),
            )
            candidate_ids = [r["id"] for r in cursor.fetchall()]
    except Exception:
        log.exception("auto_release_expired: candidate scan failed")
        return 0

    released = 0
    for payment_id in candidate_ids:
        mail_target = None
        try:
            with db_manager.get_cursor() as cursor:
                # Re-read + LOCK the payment row inside the write transaction so the
                # status check below can't race a concurrent manual approve (plan
                # §6). If the row is no longer authorised/pending, skip it.
                cursor.execute(
                    """
                    SELECT
                        p.id                 AS payment_id,
                        p.payment_intent_id,
                        p.status             AS payment_status,
                        p.amount,
                        p.currency,
                        ev.id                AS version_id,
                        ev.event_id,
                        ev.approval_status,
                        ev.name,
                        ev.start_datetime,
                        ev.end_datetime,
                        ev.city,
                        ev.country,
                        e.submitter_email
                    FROM payments p
                    JOIN event_versions ev ON ev.id = p.event_version_id
                    JOIN events e ON e.id = ev.event_id
                    WHERE p.id = %s
                    FOR UPDATE OF p
                    """,
                    (payment_id,),
                )
                row = cursor.fetchone()
                if (
                    not row
                    or row["payment_status"] != "authorised"
                    or row["approval_status"] != "pending_review"
                ):
                    # A manual approve/reject beat us to it — leave it alone.
                    continue

                # Free the hold at Stripe (best-effort; never auto-CAPTURE — plan
                # §6). cancel_intent swallows Stripe errors so a hold Stripe already
                # released doesn't block us marking our own row consistently.
                cancel_intent(row["payment_intent_id"])

                cursor.execute(
                    "UPDATE payments SET status = 'auto_released' WHERE id = %s",
                    (row["payment_id"],),
                )
                cursor.execute(
                    "UPDATE event_versions "
                    "SET approval_status = 'auto_rejected_expired', reviewed_at = now() "
                    "WHERE id = %s",
                    (row["version_id"],),
                )
                cursor.execute(
                    "UPDATE events SET current_status = %s WHERE id = %s",
                    (EXPIRED_STATUS, row["event_id"]),
                )
                # System action (admin_user_id NULL) — audit trail (plan §6).
                cursor.execute(
                    "INSERT INTO admin_actions (event_id, action, details) "
                    "VALUES (%s, 'auto_released', %s)",
                    (
                        row["event_id"],
                        Json(
                            {
                                "payment_id": row["payment_id"],
                                "version_id": row["version_id"],
                                "payment_intent_id": row["payment_intent_id"],
                            }
                        ),
                    ),
                )
                mail_target = (
                    row["submitter_email"],
                    _event_for_mail(row),
                    row["amount"],
                    row["currency"],
                )
        except Exception:
            log.exception("auto_release_expired: failed on payment %s", payment_id)
            continue

        # After commit: tell the submitter (best-effort — a mail hiccup must not
        # undo the release).
        if mail_target:
            released += 1
            recipient, event, amount, currency = mail_target
            try:
                send_auto_released(recipient, event, amount, currency)
            except Exception:
                log.exception("auto_release_expired: email failed for %s", recipient)

    log.info("auto_release_expired: released %d hold(s)", released)
    return released


# ---------------------------------------------------------------------------
# Job 2 — hourly send-once 48h / 24h pre-expiry admin alerts (plan §6/§8).
# ---------------------------------------------------------------------------
def send_expiry_alerts():
    """Warn the admin at the 48h and 24h marks before an authorisation lapses.
    SEND-ONCE per threshold per payment: an admin_actions marker records each sent
    alert and already-marked rows are skipped, so the hourly scan never re-sends
    the same threshold. Rows the auto-release job has already cancelled drop out
    (they are no longer 'authorised')."""
    from app import db_manager
    from psycopg2.extras import Json

    now = _utcnow()
    admin_email = _admin_email()
    if not admin_email:
        log.info("send_expiry_alerts: no admin recipient configured; skipping")
        return 0

    try:
        with db_manager.get_cursor(commit=False) as cursor:
            # Everything authorised+pending within 48h, with whether each threshold
            # marker already exists (send-once). Match markers per-payment via the
            # details->>'payment_id' we stamp, so resubmissions with their own
            # payment are tracked independently.
            cursor.execute(
                """
                SELECT
                    p.id                 AS payment_id,
                    p.capture_before,
                    ev.event_id,
                    ev.name,
                    ev.start_datetime,
                    ev.end_datetime,
                    ev.city,
                    ev.country,
                    e.submitter_email,
                    EXISTS (
                        SELECT 1 FROM admin_actions a
                        WHERE a.action = %s
                          AND (a.details->>'payment_id')::int = p.id
                    ) AS sent_48h,
                    EXISTS (
                        SELECT 1 FROM admin_actions a
                        WHERE a.action = %s
                          AND (a.details->>'payment_id')::int = p.id
                    ) AS sent_24h
                FROM payments p
                JOIN event_versions ev ON ev.id = p.event_version_id
                JOIN events e ON e.id = ev.event_id
                WHERE p.status = 'authorised'
                  AND ev.approval_status = 'pending_review'
                  AND p.capture_before IS NOT NULL
                  AND p.capture_before <= %s
                ORDER BY p.capture_before ASC
                """,
                (ALERT_ACTION_48H, ALERT_ACTION_24H, now + ALERT_48H),
            )
            rows = cursor.fetchall()
    except Exception:
        log.exception("send_expiry_alerts: scan failed")
        return 0

    sent = 0
    for row in rows:
        due = alerts_due(now, row["capture_before"], row["sent_48h"], row["sent_24h"])
        for action in due:
            # Record the marker FIRST (in its own transaction). If the send then
            # fails we simply don't retry that threshold — deliberately erring
            # toward under-sending rather than the ~24-duplicate storm the marker
            # exists to prevent.
            try:
                with db_manager.get_cursor() as cursor:
                    cursor.execute(
                        "INSERT INTO admin_actions (event_id, action, details) "
                        "VALUES (%s, %s, %s)",
                        (
                            row["event_id"],
                            action,
                            Json({"payment_id": row["payment_id"]}),
                        ),
                    )
            except Exception:
                log.exception("send_expiry_alerts: could not record marker for payment %s", row["payment_id"])
                continue

            try:
                send_expiry_alert(
                    admin_email,
                    _event_for_mail(row),
                    row["capture_before"],
                    _threshold_label(action),
                )
                sent += 1
            except Exception:
                log.exception("send_expiry_alerts: email failed for payment %s", row["payment_id"])

    log.info("send_expiry_alerts: sent %d alert(s)", sent)
    return sent


# ---------------------------------------------------------------------------
# Job 3 — daily pending-review digest to the admin (plan §6/§8).
# ---------------------------------------------------------------------------
def send_pending_digest_job():
    """Email the admin a once-a-day summary of the review queue so nothing sits
    unactioned until it auto-releases. Skips the send when the queue is empty."""
    from app import db_manager

    admin_email = _admin_email()
    if not admin_email:
        log.info("send_pending_digest_job: no admin recipient configured; skipping")
        return 0

    try:
        with db_manager.get_cursor(commit=False) as cursor:
            cursor.execute(
                """
                SELECT
                    ev.name,
                    e.submitter_email,
                    p.capture_before
                FROM event_versions ev
                JOIN events e ON e.id = ev.event_id
                LEFT JOIN LATERAL (
                    SELECT capture_before
                    FROM payments
                    WHERE event_version_id = ev.id
                    ORDER BY id DESC
                    LIMIT 1
                ) p ON TRUE
                WHERE ev.approval_status = 'pending_review'
                ORDER BY p.capture_before ASC NULLS LAST
                """
            )
            rows = [dict(r) for r in cursor.fetchall()]
    except Exception:
        log.exception("send_pending_digest_job: scan failed")
        return 0

    if not rows:
        log.info("send_pending_digest_job: queue empty; not sending")
        return 0

    try:
        send_pending_digest(admin_email, rows)
    except Exception:
        log.exception("send_pending_digest_job: email failed")
        return 0
    log.info("send_pending_digest_job: digest sent for %d pending item(s)", len(rows))
    return len(rows)


# ---------------------------------------------------------------------------
# Scheduler wiring (plan §6 / §A8). Started once from app.py.
# ---------------------------------------------------------------------------
_scheduler = None


def scheduler_should_run(main_module=False):
    """Decide whether THIS process should own the background jobs (plan §6): they
    must fire in exactly one process.

    - Under gunicorn (the compose path): app.py is IMPORTED, so main_module is
      False and we always start — a single gevent worker imports the app once, so
      the jobs run there and fire exactly once. (FLASK_DEBUG may be set in the
      compose env, but that does NOT mean the Werkzeug reloader is running under
      gunicorn, so it must not gate this path.)
    - Under `python app.py` with the Werkzeug reloader (FLASK_DEBUG=True): app.py
      is __main__ (main_module True) and is executed in BOTH the watcher parent
      and the reloaded child, but only the child sets WERKZEUG_RUN_MAIN=true. We
      start jobs solely in that child so they don't double-fire.
    - ENABLE_SCHEDULER=false is an explicit opt-out (used by tests / one-off CLI).

    `main_module` is whether app.py is running as __main__ (i.e. `python app.py`),
    which is the ONLY situation where the Werkzeug reloader guard applies.
    """
    if os.getenv("ENABLE_SCHEDULER", "true").lower() not in ("1", "true", "yes"):
        return False
    if main_module:
        debug = os.getenv("FLASK_DEBUG", "False").lower() in ("1", "true", "yes")
        if debug and os.environ.get("WERKZEUG_RUN_MAIN") != "true":
            return False
    return True


def start_scheduler(app=None, main_module=False):
    """Create and start the BackgroundScheduler with the three safety jobs, unless
    scheduler_should_run() vetoes it. Idempotent: a second call is a no-op. Returns
    the scheduler (or None if it did not start).

    NOTE (scaling): correctness here relies on exactly one worker owning the jobs.
    The deployed compose/gunicorn path is a single gevent worker, so this holds. If
    the service is ever scaled to >1 worker or replica, move to a shared lock (e.g.
    a Postgres advisory lock) before starting — flagged in plan §10.
    """
    global _scheduler
    if _scheduler is not None:
        return _scheduler
    if not scheduler_should_run(main_module=main_module):
        log.info("scheduler not started in this process (guard vetoed)")
        return None

    from apscheduler.schedulers.background import BackgroundScheduler
    from apscheduler.triggers.cron import CronTrigger
    from apscheduler.triggers.interval import IntervalTrigger

    # gevent-friendly: monkey-patched threading means APScheduler's default thread
    # executor runs jobs as cooperative greenlets, and psycogreen makes the pooled
    # psycopg2 calls cooperative too. UTC throughout (plan §6).
    _scheduler = BackgroundScheduler(timezone="UTC")

    # Hourly: auto-release near-expiry holds + send-once expiry alerts. next_run in
    # a few seconds so a fresh boot acts promptly rather than waiting a full hour.
    first = _utcnow() + timedelta(seconds=15)
    _scheduler.add_job(
        auto_release_expired,
        trigger=IntervalTrigger(hours=1),
        id="auto_release_expired",
        next_run_time=first,
        max_instances=1,
        coalesce=True,
        replace_existing=True,
    )
    _scheduler.add_job(
        send_expiry_alerts,
        trigger=IntervalTrigger(hours=1),
        id="send_expiry_alerts",
        next_run_time=first,
        max_instances=1,
        coalesce=True,
        replace_existing=True,
    )
    # Daily digest at a fixed UTC hour (override via env).
    digest_hour = int(os.getenv("DIGEST_HOUR_UTC", "8"))
    _scheduler.add_job(
        send_pending_digest_job,
        trigger=CronTrigger(hour=digest_hour, minute=0, timezone="UTC"),
        id="send_pending_digest_job",
        max_instances=1,
        coalesce=True,
        replace_existing=True,
    )

    _scheduler.start()
    log.info(
        "scheduler started: hourly auto-release + expiry alerts, daily digest at %02d:00 UTC",
        digest_hour,
    )
    return _scheduler
