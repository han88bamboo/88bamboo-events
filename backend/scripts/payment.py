# scripts/payment.py — the Stripe webhook (plan §6, PATTERN-SPEC §A4 shape only).
# Prefix /payment.
#
#   POST /payment/webhook   Stripe event receiver, HMAC-verified
#
# All-NEW payment code (plan §5.1) — we reuse only the §A4 shape: the signature
# is verified with STRIPE_WEBHOOK_SECRET. Locally, run:
#     stripe listen --forward-to localhost:5001/payment/webhook
# and put the printed whsec_… into STRIPE_WEBHOOK_SECRET.
#
# The authoritative write path is synchronous in /submissions/create-intent, so
# this webhook is a RECONCILER: it keeps the payments row's status in step with
# Stripe if the hold is later authorised elsewhere, captured, cancelled, or
# fails. It never creates rows — only updates a payment we already persisted by
# its payment_intent_id. Phase-4 capture/reject actions rely on the same mapping.

import os

import stripe
from flask import Blueprint, jsonify, request

from app import db_manager

file_name = os.path.basename(__file__)
blueprint = Blueprint(file_name[:-3], __name__)  # blueprint name == filename

# Stripe intent status / event -> our payments.status CHECK value (schema §7).
# amount_capturable_updated fires when a manual-capture hold is authorised.
_STATUS_BY_EVENT = {
    "payment_intent.amount_capturable_updated": "authorised",
    "payment_intent.succeeded": "captured",       # capture happened (Phase 4)
    "payment_intent.canceled": "cancelled",       # hold released
}


def _update_payment_status(payment_intent_id, status, set_captured_at=False):
    """Reconcile the stored payment to match Stripe. No-op if we have no row for
    this intent (e.g. an intent cancelled before the DB save committed)."""
    captured_clause = ", captured_at = now()" if set_captured_at else ""
    with db_manager.get_cursor() as cursor:
        cursor.execute(
            f"UPDATE payments SET status = %s{captured_clause} "
            f"WHERE payment_intent_id = %s",
            (status, payment_intent_id),
        )


@blueprint.route("/webhook", methods=["POST"])
def stripe_webhook():
    webhook_secret = os.getenv("STRIPE_WEBHOOK_SECRET")
    payload = request.get_data()
    signature = request.headers.get("Stripe-Signature")

    # Verify the signature (§A4 shape). Without a configured secret we refuse to
    # trust the payload rather than processing it blindly.
    if not webhook_secret or webhook_secret.endswith("REPLACE_ME"):
        return jsonify({"error": "Webhook secret not configured"}), 500
    try:
        event = stripe.Webhook.construct_event(payload, signature, webhook_secret)
    except (ValueError, stripe.error.SignatureVerificationError):
        return jsonify({"error": "Invalid signature"}), 400

    event_type = event["type"]
    intent = event["data"]["object"]

    if event_type in _STATUS_BY_EVENT:
        _update_payment_status(
            intent["id"],
            _STATUS_BY_EVENT[event_type],
            set_captured_at=(event_type == "payment_intent.succeeded"),
        )
    # Any other event type is acknowledged but ignored (Stripe retries on non-2xx).

    return jsonify({"received": True}), 200
