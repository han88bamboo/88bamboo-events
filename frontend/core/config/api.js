// core/config/api.js — the single HTTP client (PATTERN-SPEC §B2.2), copied
// verbatim in shape. Every backend call goes through `apiClient`.
//
// Base URL is resolved ONCE at module load and differs by execution context:
//   - Server (SSR / getServerSideProps): API_INTERNAL_URL -> NEXT_PUBLIC_API_URL
//     -> http://backend:5000  (reaches the API over the container network)
//   - Browser: NEXT_PUBLIC_API_URL -> http://localhost:5000
const isServer = typeof window === 'undefined';

const API_BASE_URL = isServer
  ? process.env.API_INTERNAL_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    'http://backend:5000'
  : process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';

function buildUrl(endpoint, params) {
  let url = `${API_BASE_URL}${endpoint}`;
  if (params) {
    const search = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== null && value !== undefined) search.append(key, value);
    });
    const qs = search.toString();
    if (qs) url += `?${qs}`;
  }
  return url;
}

export const apiClient = {
  async get(endpoint, config = {}) {
    const response = await fetch(buildUrl(endpoint, config.params), {
      method: 'GET',
      headers: { 'Content-Type': 'application/json', ...(config.headers || {}) },
    });
    const data = await response.json().catch(() => null);
    return { data };
  },

  async post(endpoint, data, config = {}) {
    try {
      const isFormData = typeof FormData !== 'undefined' && data instanceof FormData;
      const headers = { ...(config.headers || {}) };
      if (!isFormData) headers['Content-Type'] = 'application/json';

      const response = await fetch(buildUrl(endpoint), {
        method: 'POST',
        headers,
        body: isFormData ? data : JSON.stringify(data),
      });
      const body = await response.json().catch(() => null);
      return { data: body, ok: response.ok, status: response.status };
    } catch (error) {
      return { data: null, ok: false, status: 0, error };
    }
  },

  async put(endpoint, data, config = {}) {
    try {
      const response = await fetch(buildUrl(endpoint), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...(config.headers || {}) },
        body: JSON.stringify(data),
      });
      const body = await response.json().catch(() => null);
      return { data: body, ok: response.ok, status: response.status };
    } catch (error) {
      return { data: null, ok: false, status: 0, error };
    }
  },

  async patch(endpoint, data, config = {}) {
    try {
      const response = await fetch(buildUrl(endpoint), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...(config.headers || {}) },
        body: JSON.stringify(data),
      });
      const body = await response.json().catch(() => null);
      return { data: body, ok: response.ok, status: response.status };
    } catch (error) {
      return { data: null, ok: false, status: 0, error };
    }
  },

  async delete(endpoint, config = {}) {
    const response = await fetch(buildUrl(endpoint, config.params), {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', ...(config.headers || {}) },
    });
    if (!response.ok) throw new Error(`DELETE ${endpoint} failed: ${response.status}`);
    const data = await response.json().catch(() => null);
    return { data };
  },
};
