// core/services/payments.js — payment-flow service module (PATTERN-SPEC §B2.3).
// The checkout step imports this, never `apiClient` directly.
//
//   createIntent(payload) -> { data, ok, status }
//
// `payload` is the 3a held submission plus the Stripe payment method and a
// per-attempt idempotency key:
//   { event, image, payment_method_id, idempotency_key }
// The backend re-validates, authorises a manual-capture PaymentIntent, and
// persists the submission transactionally (plan §6).
import { apiClient } from '@/core/config/api';

export const paymentsService = {
  async createIntent(payload) {
    return apiClient.post('/submissions/create-intent', payload);
  },
};
