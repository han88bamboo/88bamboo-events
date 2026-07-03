// core/services/events.js — public event read service (PATTERN-SPEC §B2.3).
// Pages/components import this, never `apiClient` directly. Wraps the unguarded
// backend read API (backend/scripts/events.py). SSR calls resolve to the internal
// API base; browser calls to NEXT_PUBLIC_API_URL (the api-config split, §B2.2).
import { apiClient } from '@/core/config/api';

export const eventsService = {
  // The listing feed. `params` maps 1:1 to the backend query args:
  //   q, category, format, country, city, date_from, date_to, when,
  //   preferred_country, limit, offset. Undefined/empty values are dropped by
  //   apiClient's URLSearchParams builder.
  async getListing(params = {}) {
    const response = await apiClient.get('/events', { params });
    return response.data?.data || [];
  },

  // Distinct countries that currently have published events (country selector).
  async getCountries() {
    const response = await apiClient.get('/events/countries');
    return response.data?.data || [];
  },

  // A single published event by canonical slug. Returns the event object or null
  // (a non-published / unknown slug 404s -> null, letting the page notFound).
  async getBySlug(slug) {
    const response = await apiClient.get(`/events/${encodeURIComponent(slug)}`);
    return response.data?.data || null;
  },

  // The homepage-widget feed (upcoming, soonest-first, small). Used by the
  // standalone Shopify widget and any in-app "upcoming" strip.
  async getWidgetFeed(limit) {
    const response = await apiClient.get('/events/widget', {
      params: limit ? { limit } : undefined,
    });
    return response.data?.data || [];
  },
};
