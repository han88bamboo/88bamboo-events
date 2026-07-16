// CheckoutStep — the 3b payment step (plan §6). Takes the 3a "held" payload
// (validated event + already-uploaded image) and authorises a manual-capture
// PaymentIntent via Stripe Elements: the card is HELD, not charged. On success
// the listing is persisted server-side as pending_review.
//
// Card details never touch our server — Stripe.js turns them into a
// payment_method id (pm_…) that we hand to the backend, which creates + confirms
// the intent (§A4 shape: client_secret / Elements on the client, secret key on
// the server). A per-attempt idempotency key guards against double-authorising
// on a double-click; it is regenerated only when the user retries after a
// decline (plan §6).
import { useState } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import {
  Elements,
  CardElement,
  useStripe,
  useElements,
} from '@stripe/react-stripe-js';

import { paymentsService } from '@/core/services/payments';

const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
// loadStripe is memoised at module scope so the SDK loads once (Stripe guidance).
const stripePromise =
  PUBLISHABLE_KEY && !PUBLISHABLE_KEY.includes('REPLACE_ME')
    ? loadStripe(PUBLISHABLE_KEY)
    : null;

function newIdempotencyKey() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `k_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function PayForm({ held, token, onPaid }) {
  const stripe = useStripe();
  const elements = useElements();
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  // Stable per checkout attempt; a fresh key is minted on each retry so a
  // declined attempt does not block a genuine re-try with another card.
  const [idempotencyKey, setIdempotencyKey] = useState(newIdempotencyKey);

  const onPay = async (e) => {
    e.preventDefault();
    setError(null);
    if (!stripe || !elements) return;

    setBusy(true);
    try {
      // 1) Turn the card into a payment_method id (details stay client-side).
      const { error: pmError, paymentMethod } = await stripe.createPaymentMethod({
        type: 'card',
        card: elements.getElement(CardElement),
        billing_details: { email: held.event?.submitter_email },
      });
      if (pmError) {
        setError(pmError.message);
        return;
      }

      // 2) Authorise + persist server-side.
      const { data, ok, status } = await paymentsService.createIntent({
        event: held.event,
        image: held.image,
        // Post-go-live "additional images" feature: already-uploaded refs
        // carried from the 3a step (SubmitEvent.js).
        additional_images: held.additional_images || [],
        payment_method_id: paymentMethod.id,
        idempotency_key: idempotencyKey,
        // EP-7: re-posted so the server re-resolves the login (forces the
        // submitter email + gates/claims the organiser name in the persist txn).
        token: token || undefined,
      });

      if (ok) {
        onPaid(data?.data || null);
        return;
      }

      // Decline (402) or save failure — let the user retry with a fresh key.
      setError(
        (data?.errors && data.errors.join(' ')) ||
          data?.error ||
          'Payment could not be completed. Please try again.',
      );
      if (status === 402) setIdempotencyKey(newIdempotencyKey());
    } catch (err) {
      setError('Could not reach the payment service. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={onPay}>
      {error && (
        <div className="alert alert-danger" role="alert">
          {error}
        </div>
      )}
      <div className="mb-3">
        <label className="form-label">Card details</label>
        <div className="form-control" style={{ padding: '0.6rem 0.75rem' }}>
          <CardElement options={{ hidePostalCode: true }} />
        </div>
        <div className="form-text">
          Test card: 4242 4242 4242 4242, any future date, any CVC.
        </div>
      </div>
      <button type="submit" className="btn bamboo-btn" disabled={!stripe || busy}>
        {busy ? 'Authorising…' : 'Place a temporary hold & submit'}
      </button>
    </form>
  );
}

function CheckoutStep({ held, token, onPaid, onBack }) {
  if (!stripePromise) {
    return (
      <div className="alert alert-warning" role="alert">
        Payment is not configured (missing Stripe publishable key). Set
        <code> NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY</code> to enable checkout.
      </div>
    );
  }

  return (
    <div>
      <p className="text-muted">
        Your details and image are saved. To finish, we place a temporary
        authorisation (a hold, not a charge) on your card. You are only charged
        the listing fee if your event is approved.
      </p>
      <Elements stripe={stripePromise}>
        <PayForm held={held} token={token} onPaid={onPaid} />
      </Elements>
      {onBack && (
        <button
          type="button"
          className="btn btn-link mt-2 px-0"
          onClick={onBack}
        >
          ← Edit details
        </button>
      )}
    </div>
  );
}

export default CheckoutStep;
