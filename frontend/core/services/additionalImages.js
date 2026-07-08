// core/services/additionalImages.js — post-go-live "additional images" feature
// service (plan.md backlog). Wraps the unguarded backend /additional-images
// blueprint, which is the single upload path for every additional-image slot
// (used from both the submission form and the edit forms' add-image control).
import { apiClient } from '@/core/config/api';

export const additionalImagesService = {
  // Upload ONE additional image; returns { url, s3_key, content_type, size_bytes }
  // on success (see apiClient's { data, ok, status } shape).
  async upload(file) {
    const formData = new FormData();
    formData.append('image', file);
    return apiClient.post('/additional-images/upload', formData);
  },
};
