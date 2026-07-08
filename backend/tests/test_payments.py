# test_payments.py — unit tests for the pure payment helpers (payments.py).
# These cover the money-math and Stripe-response parsing that must be correct
# regardless of the network (CLAUDE.md: lightweight tests on data-processing
# functions are valued). No Stripe API calls are made.
#
# Run:  cd backend && python -m unittest discover -s tests

import os
import sys
import unittest
from datetime import datetime, timezone
from decimal import Decimal

# Import the module under test (backend/ on the path, like the other tests).
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from payments import (  # noqa: E402
    derive_idempotency_key,
    read_capture_before,
    to_minor_units,
)


class ToMinorUnitsTests(unittest.TestCase):
    def test_usd_two_decimal(self):
        # USD 15.00 -> 1500 cents (the seeded tier).
        self.assertEqual(to_minor_units(Decimal("15.00"), "USD"), 1500)

    def test_case_insensitive_currency(self):
        self.assertEqual(to_minor_units(Decimal("5.00"), "usd"), 500)

    def test_zero_decimal_currency(self):
        # JPY has no minor unit: ¥5 authorises as 5, not 500.
        self.assertEqual(to_minor_units(Decimal("5"), "JPY"), 5)

    def test_three_decimal_currency(self):
        # BHD is three-decimal: 1.500 -> 1500.
        self.assertEqual(to_minor_units(Decimal("1.500"), "BHD"), 1500)

    def test_rounds_half_up(self):
        self.assertEqual(to_minor_units(Decimal("5.005"), "USD"), 501)

    def test_accepts_float_and_str(self):
        self.assertEqual(to_minor_units(5, "USD"), 500)
        self.assertEqual(to_minor_units("5.50", "USD"), 550)


class IdempotencyKeyTests(unittest.TestCase):
    def _event(self):
        return {
            "submitter_email": "Host@Example.com",
            "name": "Whisky Night",
            "start_datetime": "2026-08-01T18:00:00",
        }

    def test_deterministic(self):
        img = {"s3_key": "abc.jpg"}
        self.assertEqual(
            derive_idempotency_key(self._event(), img),
            derive_idempotency_key(self._event(), img),
        )

    def test_case_insensitive_on_email_and_name(self):
        img = {"s3_key": "abc.jpg"}
        a = derive_idempotency_key(self._event(), img)
        lower = {**self._event(), "submitter_email": "host@example.com", "name": "whisky night"}
        self.assertEqual(a, derive_idempotency_key(lower, img))

    def test_changes_with_image(self):
        a = derive_idempotency_key(self._event(), {"s3_key": "abc.jpg"})
        b = derive_idempotency_key(self._event(), {"s3_key": "xyz.jpg"})
        self.assertNotEqual(a, b)


class ReadCaptureBeforeTests(unittest.TestCase):
    def test_reads_nested_timestamp(self):
        # 2026-07-10 12:00:00 UTC.
        ts = int(datetime(2026, 7, 10, 12, 0, tzinfo=timezone.utc).timestamp())
        intent = {
            "latest_charge": {
                "payment_method_details": {"card": {"capture_before": ts}}
            }
        }
        got = read_capture_before(intent)
        self.assertEqual(got, datetime(2026, 7, 10, 12, 0, tzinfo=timezone.utc))

    def test_none_when_charge_not_expanded(self):
        # latest_charge is still just an id string.
        self.assertIsNone(read_capture_before({"latest_charge": "ch_123"}))

    def test_none_when_field_absent(self):
        intent = {"latest_charge": {"payment_method_details": {"card": {}}}}
        self.assertIsNone(read_capture_before(intent))

    def test_none_when_no_charge(self):
        self.assertIsNone(read_capture_before({"latest_charge": None}))


if __name__ == "__main__":
    unittest.main()
