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

  // EP-7: email a magic link that returns to the submit page (/submit?token=…) so
  // the submitter can log in there to set a public organiser name. Always generic.
  async requestLoginLink(email) {
    return apiClient.post('/account/request-login-link', { email });
  },

  // EP-7: resolve a login token → { email, organiser_names } for the submit page's
  // read-only submitter email + the "my previous organiser names" datalist.
  async getOrganisers(token) {
    return apiClient.get('/account/organisers', { params: { token } });
  },

  // All of the email's events (full history) for the grid.
  async getContext(token) {
    return apiClient.get('/account/context', { params: { token } });
  },

  // One owned event: detail + editable content + action flags.
  async getEvent(token, eventId) {
    return apiClient.get('/account/event', { params: { token, event_id: eventId } });
  },

  // Edit an owned event -> a new pending version. `additionalImages` is the
  // post-go-live "additional images" feature's current full list (round-trip
  // pattern, like drink_categories/occurrences).
  async editEvent(token, eventId, event, additionalImages = []) {
    return apiClient.post('/account/edit', {
      token, event_id: eventId, event, additional_images: additionalImages,
    });
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

  // The event's message thread (+ open flag + name). Reading it marks the admin
  // messages read on the server, which clears the dashboard bell.
  async getMessages(token, eventId) {
    return apiClient.get('/account/messages', { params: { token, event_id: eventId } });
  },

  // Post a submitter reply from the dashboard. Refused (409) once the thread is
  // frozen (the event has left review).
  async replyMessage(token, eventId, body) {
    return apiClient.post('/account/messages/reply', { token, event_id: eventId, body });
  },
};
