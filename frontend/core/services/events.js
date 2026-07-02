// core/services/events.js — per-domain service module (PATTERN-SPEC §B2.3).
// Pages/components import services, never `apiClient` directly. Endpoints are
// plain path strings mounted at the backend's API base.
//
// Scaffold placeholder: only a health probe exists so far. The real read/write
// methods (getUpcoming, getBySlug, submit, ...) land in Phases 3 & 5.
import { apiClient } from '@/core/config/api';

export const eventsService = {
  async health() {
    const response = await apiClient.get('/health');
    return response.data;
  },
};
