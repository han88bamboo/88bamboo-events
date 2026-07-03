// core/services/messages.js — the PUBLIC submitter side of the admin⇄submitter
// conversation (post-launch feature, SPEC §B2.3). Wraps the unguarded /messages
// blueprint. Web-link replies only: the submitter reaches this via a link in our
// email and replies here — never by emailing us back. The session is the URL
// token (cookie-free — the App Proxy strips cookies, plan §4/§7).
import { apiClient } from '@/core/config/api';

export const messagesService = {
  // Resolve a token -> the full thread + open/closed flag. 404 if invalid/expired.
  async getThread(token) {
    return apiClient.get('/messages/thread', { params: { token } });
  },

  // Post a submitter reply. Refused (409) once the conversation has frozen.
  async reply(token, body) {
    return apiClient.post('/messages/reply', { token, body });
  },
};
