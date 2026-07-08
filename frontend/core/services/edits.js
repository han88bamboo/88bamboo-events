// core/services/edits.js — magic-link editing service (plan §7, SPEC §B2.3).
// Wraps the unguarded backend /edits blueprint. The edit session is a URL token,
// never a cookie (the App Proxy strips cookies — plan §4/§7), so the token is
// passed explicitly in each call rather than read from a cookie.
import { apiClient } from '@/core/config/api';

export const editsService = {
  // Ask the backend to email a fresh 24-hour edit link. Always resolves to a
  // generic success (anti-enumeration is enforced server-side).
  async requestLink(slug, email) {
    return apiClient.post('/edits/request-link', { slug, email });
  },

  // Resolve a token to the current editable content (prefills the edit form).
  async getContext(token) {
    return apiClient.get('/edits/context', { params: { token } });
  },

  // Submit edited fields -> a new pending_review version. `additionalImages` is
  // the post-go-live "additional images" feature's current full list (round-trip
  // pattern, like drink_categories/occurrences) — defaults to [] for callers that
  // predate the feature.
  async submitEdit(token, event, additionalImages = []) {
    return apiClient.post('/edits/submit', { token, event, additional_images: additionalImages });
  },
};
