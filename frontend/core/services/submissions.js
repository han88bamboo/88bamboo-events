// core/services/submissions.js — submission-flow service module (PATTERN-SPEC
// §B2.3). Pages/components import this, never `apiClient` directly.
//
//   getTaxonomy() -> { drink_categories: [{id,label}], event_formats: [{id,label}] }
//   submit(formData) -> { data, ok, status } from apiClient.post
//
// `submit` takes a FormData (it carries the image file), which apiClient.post
// forwards as multipart untouched (§B2.2).
import { apiClient } from '@/core/config/api';

export const submissionsService = {
  async getTaxonomy() {
    const response = await apiClient.get('/taxonomy');
    return (
      response.data?.data || { drink_categories: [], event_formats: [] }
    );
  },

  async submit(formData) {
    return apiClient.post('/submissions', formData);
  },
};
