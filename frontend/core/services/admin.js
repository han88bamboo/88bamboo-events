// core/services/admin.js — admin backstage API service (PATTERN-SPEC §B2.3).
// The admin views import this, never `apiClient` directly.
//
//   login(email, passwordHash)       -> { data, ok, status } (issues a session token)
//   getPending(token)                -> { data } (the review queue)
//   approve(token, versionId)        -> { data, ok, status }
//   reject(token, versionId, reason) -> { data, ok, status }
//
// The guarded calls send the session token as `Authorization: Bearer <token>` —
// a header rather than a cookie because the API is a different origin from the
// backstage app (plan §5.3 / §4). The backend verifies it server-side.
import { apiClient } from '@/core/config/api';

const authHeader = (token) => ({ Authorization: `Bearer ${token}` });

export const adminService = {
  async login(email, passwordHash) {
    return apiClient.post('/admin/login', { email, password_hash: passwordHash });
  },

  async getPending(token) {
    return apiClient.get('/admin/pending', { headers: authHeader(token) });
  },

  async approve(token, versionId) {
    return apiClient.post(
      '/admin/approve',
      { version_id: versionId },
      { headers: authHeader(token) },
    );
  },

  async reject(token, versionId, reason) {
    return apiClient.post(
      '/admin/reject',
      { version_id: versionId, reason },
      { headers: authHeader(token) },
    );
  },

  // --- Phase 4B: live-listing management, versions, analytics, pricing ---

  async getLive(token) {
    return apiClient.get('/admin/live', { headers: authHeader(token) });
  },

  async unpublish(token, eventId, reason) {
    return apiClient.post(
      '/admin/unpublish',
      { event_id: eventId, reason },
      { headers: authHeader(token) },
    );
  },

  async getVersions(token, eventId) {
    return apiClient.get('/admin/versions', {
      params: { event_id: eventId },
      headers: authHeader(token),
    });
  },

  async getAnalytics(token) {
    return apiClient.get('/admin/analytics', { headers: authHeader(token) });
  },

  async getPricingTiers(token) {
    return apiClient.get('/admin/pricing-tiers', { headers: authHeader(token) });
  },

  async createPricingTier(token, tier) {
    return apiClient.post('/admin/pricing-tiers', tier, { headers: authHeader(token) });
  },

  async updatePricingTier(token, tierId, tier) {
    return apiClient.put(`/admin/pricing-tiers/${tierId}`, tier, {
      headers: authHeader(token),
    });
  },

  async deletePricingTier(token, tierId) {
    return apiClient.delete(`/admin/pricing-tiers/${tierId}`, {
      headers: authHeader(token),
    });
  },

  // --- Post-launch: admin content edit + admin⇄submitter messaging ---

  // Edit a listing directly. `notify`/`notifyMessage` only take effect when the
  // edit goes live (a published-listing edit) — enforced server-side.
  async edit(token, versionId, event, notify, notifyMessage) {
    return apiClient.post(
      '/admin/edit',
      { version_id: versionId, event, notify: !!notify, notify_message: notifyMessage || '' },
      { headers: authHeader(token) },
    );
  },

  // Send a message to the submitter (only while the event is under review).
  async sendMessage(token, eventId, body) {
    return apiClient.post(
      '/admin/messages',
      { event_id: eventId, body },
      { headers: authHeader(token) },
    );
  },

  // Read one event's thread (marks the submitter's messages read).
  async getThread(token, eventId) {
    return apiClient.get('/admin/messages', {
      params: { event_id: eventId },
      headers: authHeader(token),
    });
  },

  // Events with unread submitter replies (drives the Inbox tab + badge).
  async getInbox(token) {
    return apiClient.get('/admin/inbox', { headers: authHeader(token) });
  },
};
