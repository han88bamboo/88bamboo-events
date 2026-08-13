// core/utils/imageFiles.js — shared client-side image rules for the file fields
// that accept a drop as well as a pick. A dropped file bypasses the input's
// `accept` attribute entirely, so these checks (not the attribute) are what keeps
// an obviously-wrong file from being sent.
//
// Mirrors the server's validate_image (backend/submission_validation.py): JPEG,
// PNG or WebP, non-empty, at most MAX_IMAGE_MB. Presentational only — the server
// re-validates every upload (and additionally checks the file's magic bytes).

export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const MAX_IMAGE_MB = 5;

// Pure: why a single file is unacceptable, '' when it is fine. A fragment, not a
// sentence, so callers can prefix it with either "Image" or the file's name.
export function imageFileReason(file) {
  if (!file) return 'is missing';
  if (!ALLOWED_IMAGE_TYPES.includes(file.type))
    return 'must be a JPEG, PNG, or WebP file';
  if (!file.size) return 'is empty';
  if (file.size > MAX_IMAGE_MB * 1024 * 1024)
    return `is too large (max ${MAX_IMAGE_MB} MB)`;
  return '';
}

// Pure: split a picked/dropped FileList into the files to accept and one notice
// per file that was skipped. `remaining` is how many more the field can still
// hold and `maxTotal` is its cap (used only for the "no room left" wording), so
// dragging in six images onto an empty 5-image field explains the sixth.
export function pickImageFiles(files, remaining, maxTotal) {
  const accepted = [];
  const notices = [];
  Array.from(files || []).forEach((file) => {
    const reason = imageFileReason(file);
    if (reason) {
      notices.push(`${file.name} — ${reason}.`);
      return;
    }
    if (accepted.length >= remaining) {
      notices.push(`${file.name} — skipped (maximum of ${maxTotal} images).`);
      return;
    }
    accepted.push(file);
  });
  return { accepted, notices };
}
