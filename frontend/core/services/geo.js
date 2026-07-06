// core/services/geo.js — geo reference service (EP-2). The SINGLE source of truth
// for the country + region dropdowns is the backend /geo endpoint (owner
// decision), so the forms fetch it rather than importing a hardcoded list.
//
//   getGeo() -> { countries: [{ name, requires_region, regions: [...] }] }
import { apiClient } from '@/core/config/api';

export const geoService = {
  async getGeo() {
    const response = await apiClient.get('/geo');
    return response.data?.data || { countries: [] };
  },
};
