# payments.py — Stripe PaymentIntent helpers (manual capture / authorise-now).
#
# This is ALL-NEW payment code (plan §5.1): Drink-X's payment.py uses Stripe
# Subscriptions with price IDs (PATTERN-SPEC §A4 Stripe annotation) — we do NOT
# copy that. We reuse only the *shape*: the secret key comes from the env, the
# API version is pinned in code, and (in the blueprints) the client_secret goes
# to the browser and the webhook is verified with STRIPE_WEBHOOK_SECRET.
#
# Flow (plan §6): create + confirm a PaymentIntent with capture_method='manual'
# so the card is AUTHORISED (a hold) but NOT charged; the fee is captured later,
# only on admin approval (Phase 4). The authorisation's expiry — Stripe's
# `capture_before` — is read per intent and stored verbatim; it is NEVER
# hardcoded to 7 days (plan §6).

import hashlib
import os
from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP

import stripe

# Secret key from env (§A4 shape). Pinned API version so Stripe's response shape
# is stable across account defaults (PATTERN-SPEC §A4 notes 2025-05-28.basil).
stripe.api_key = os.getenv("STRIPE_SECRET_KEY")
stripe.api_version = "2025-05-28.basil"

# ISO-4217 currencies Stripe treats as zero-decimal (amount is already in the
# smallest unit) or three-decimal. Everything else (incl. USD) is two-decimal.
# https://docs.stripe.com/currencies#zero-decimal
_ZERO_DECIMAL = {
    "bif", "clp", "djf", "gnf", "jpy", "kmf", "krw", "mga", "pyg",
    "rwf", "ugx", "vnd", "vuv", "xaf", "xof", "xpf",
}
_THREE_DECIMAL = {"bhd", "jod", "kwd", "omr", "tnd"}


def to_minor_units(amount, currency):
    """Convert a major-unit price (e.g. Decimal('5.00') USD) to the integer
    smallest-unit amount Stripe expects (500 cents). Currency-aware so a JPY 5
    tier authorises ¥5, not ¥500. Rounds half-up at the currency's precision."""
    code = (currency or "usd").lower()
    if code in _ZERO_DECIMAL:
        factor = 1
    elif code in _THREE_DECIMAL:
        factor = 1000
    else:
        factor = 100
    scaled = (Decimal(str(amount)) * factor).to_integral_value(rounding=ROUND_HALF_UP)
    return int(scaled)


def derive_idempotency_key(event, image):
    """Server-side fallback idempotency key when the client did not send one.
    Deterministic over the stable identity of the submission attempt so a
    retried request cannot double-authorise (plan §6). The client normally
    supplies its own per-attempt UUID; this only backstops a missing value."""
    basis = "|".join(
        [
            (event.get("submitter_email") or "").lower(),
            (event.get("name") or "").lower(),
            event.get("start_datetime") or "",
            image.get("s3_key") or "",
        ]
    )
    return "evt-" + hashlib.sha256(basis.encode("utf-8")).hexdigest()[:40]


def create_manual_capture_intent(
    amount_minor, currency, payment_method_id, idempotency_key, metadata=None
):
    """Create AND confirm a manual-capture PaymentIntent in one call (authorise
    now). Returns the Stripe intent with `latest_charge` expanded so the caller
    can read `capture_before` off the charge.

    Raises stripe.error.CardError on a decline (card died / insufficient funds)
    and stripe.error.StripeError on any other API problem — the caller maps
    those to the plan §6 failure states.
    """
    return stripe.PaymentIntent.create(
        amount=amount_minor,
        currency=currency.lower(),
        capture_method="manual",  # AUTHORISE only; capture happens on approval
        confirm=True,
        payment_method=payment_method_id,
        # Card-only, server-side confirm: no redirect-based methods, so no
        # return_url is required. 3-D Secure still surfaces as requires_action.
        automatic_payment_methods={"enabled": True, "allow_redirects": "never"},
        metadata=metadata or {},
        expand=["latest_charge"],
        idempotency_key=idempotency_key,
    )


def _get(obj, key):
    """Item-style read that works on both a Stripe StripeObject (which supports
    obj[key] but not obj.get()) and a plain dict. Returns None if missing."""
    if obj is None:
        return None
    try:
        return obj[key]
    except (KeyError, TypeError):
        return None


def read_capture_before(intent):
    """Extract Stripe's authorisation-expiry timestamp from a confirmed
    manual-capture intent, as a timezone-aware UTC datetime, or None if absent.

    The value lives at charge.payment_method_details.card.capture_before (a Unix
    timestamp; verified against the Stripe API). Stored verbatim so the Phase-4
    hourly auto-release job can find these rows before they lapse — never
    hardcoded to 7 days (plan §6).
    """
    charge = _get(intent, "latest_charge")
    if not charge or isinstance(charge, str):
        return None
    ts = _get(_get(_get(charge, "payment_method_details"), "card"), "capture_before")
    if not ts:
        return None
    return datetime.fromtimestamp(int(ts), tz=timezone.utc)


def cancel_intent(payment_intent_id):
    """Release an authorisation hold (free — no fee). Used when the DB save
    fails AFTER a successful authorise, so no orphan hold is left on the card
    (plan §6 authorise-succeeds-but-DB-save-fails). Best-effort: swallows Stripe
    errors so it never masks the original failure the caller is handling."""
    try:
        stripe.PaymentIntent.cancel(payment_intent_id)
        return True
    except stripe.error.StripeError:
        return False
