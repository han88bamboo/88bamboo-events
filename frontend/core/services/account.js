// core/services/account.js — customer "manage my listings" service (SPEC §B2.3).
// Wraps the unguarded backend /account blueprint. The session is a URL token
// (cookie-free — the App Proxy strips cookies), passed explicitly in every call;
// the backend re-checks ownership (token email == event submitter) per action.
import { apiClient } from '@/core/config/api';

export const accountService = {
  // Ask the backend to email a 24h dashboard link. Always a generic success.
  async requestLink(email) {
    return apiClient.post('/account/request-link', { email });
  },

  // All of the email's events (full history) for the grid.
  async getContext(token) {
    return apiClient.get('/account/context', { params: { token } });
  },

  // One owned event: detail + editable content + action flags.
  async getEvent(token, eventId) {
    return apiClient.get('/account/event', { params: { token, event_id: eventId } });
  },

  // Edit an owned event -> a new pending version.
  async editEvent(token, eventId, event) {
    return apiClient.post('/account/edit', { token, event_id: eventId, event });
  },

  async withdraw(token, eventId) {
    return apiClient.post('/account/withdraw', { token, event_id: eventId });
  },

  async unpublish(token, eventId) {
    return apiClient.post('/account/unpublish', { token, event_id: eventId });
  },

  async republish(token, eventId) {
    return apiClient.post('/account/republish', { token, event_id: eventId });
  },
};
