# Unit tests for the Phase-4B safety-job decision helpers (plan §6/§8). These are
# the pure, DB-free parts of scripts/scheduled_tasks.py: the auto-release window
# test, the send-once alert-threshold logic, and the single-process scheduler
# guard. The DB-touching jobs are proven end-to-end in the local run (plan §10);
# here we lock down the branching logic cheaply.
import importlib
import os
import unittest
from datetime import datetime, timedelta, timezone

from scripts import scheduled_tasks as st

NOW = datetime(2026, 7, 3, 12, 0, 0, tzinfo=timezone.utc)


def _at(hours):
    """A capture_before `hours` from NOW (negative = already past)."""
    return NOW + timedelta(hours=hours)


class DueForReleaseTests(unittest.TestCase):
    def test_outside_window_not_due(self):
        self.assertFalse(st.due_for_release(NOW, _at(30)))  # 30h out

    def test_inside_24h_is_due(self):
        self.assertTrue(st.due_for_release(NOW, _at(20)))

    def test_exactly_24h_is_due(self):
        self.assertTrue(st.due_for_release(NOW, _at(24)))

    def test_already_past_is_due(self):
        self.assertTrue(st.due_for_release(NOW, _at(-1)))

    def test_none_capture_before_not_due(self):
        self.assertFalse(st.due_for_release(NOW, None))


class AlertsDueTests(unittest.TestCase):
    def test_outside_48h_no_alerts(self):
        self.assertEqual(st.alerts_due(NOW, _at(50), False, False), [])

    def test_within_48h_only_48h(self):
        self.assertEqual(
            st.alerts_due(NOW, _at(40), False, False), [st.ALERT_ACTION_48H]
        )

    def test_within_24h_both_when_unsent(self):
        self.assertEqual(
            st.alerts_due(NOW, _at(20), False, False),
            [st.ALERT_ACTION_48H, st.ALERT_ACTION_24H],
        )

    def test_send_once_skips_already_sent_48h(self):
        # 48h already sent -> only the 24h alert remains due.
        self.assertEqual(
            st.alerts_due(NOW, _at(20), True, False), [st.ALERT_ACTION_24H]
        )

    def test_send_once_skips_both_when_sent(self):
        self.assertEqual(st.alerts_due(NOW, _at(20), True, True), [])

    def test_none_capture_before_no_alerts(self):
        self.assertEqual(st.alerts_due(NOW, None, False, False), [])


class SchedulerGuardTests(unittest.TestCase):
    """scheduler_should_run must start jobs in exactly one process (plan §6)."""

    def setUp(self):
        self._saved = {
            k: os.environ.get(k)
            for k in ("ENABLE_SCHEDULER", "FLASK_DEBUG", "WERKZEUG_RUN_MAIN")
        }
        for k in self._saved:
            os.environ.pop(k, None)

    def tearDown(self):
        for k, v in self._saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v

    def test_gunicorn_default_starts(self):
        # Imported by gunicorn (main_module=False) -> always start (single worker).
        self.assertTrue(st.scheduler_should_run(main_module=False))

    def test_gunicorn_starts_even_with_flask_debug(self):
        # The compose env sets FLASK_DEBUG=True but still runs gunicorn (no
        # reloader) — the debug flag must NOT gate the imported path.
        os.environ["FLASK_DEBUG"] = "true"
        self.assertTrue(st.scheduler_should_run(main_module=False))

    def test_explicit_optout(self):
        os.environ["ENABLE_SCHEDULER"] = "false"
        self.assertFalse(st.scheduler_should_run(main_module=False))

    def test_dev_reloader_parent_does_not_start(self):
        # `python app.py` (main_module=True) + debug, no WERKZEUG_RUN_MAIN -> the
        # watcher parent; the reloaded child will start instead.
        os.environ["FLASK_DEBUG"] = "true"
        self.assertFalse(st.scheduler_should_run(main_module=True))

    def test_dev_reloader_child_starts(self):
        os.environ["FLASK_DEBUG"] = "true"
        os.environ["WERKZEUG_RUN_MAIN"] = "true"  # the reloaded child
        self.assertTrue(st.scheduler_should_run(main_module=True))

    def test_non_debug_direct_run_starts(self):
        os.environ["FLASK_DEBUG"] = "false"
        self.assertTrue(st.scheduler_should_run(main_module=True))


if __name__ == "__main__":
    unittest.main()
