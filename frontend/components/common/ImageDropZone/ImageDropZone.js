// ImageDropZone — a dashed drop target wrapping a file input, so images can be
// dragged in as well as chosen. Mirrors the submit wizard's feature-image zone
// (SubmitEvent D1) and is shared by the "Additional images" field on both the
// submit wizard and the edit form.
//
// Presentational: it never validates or stores anything. Whatever was dropped or
// picked is handed to `onFiles` as a FileList, and the caller applies its own
// rules (core/utils/imageFiles) and its own cap. Drops are still forwarded when
// the field is full — the caller turns them into "maximum reached" notices, which
// is friendlier than a drop that appears to do nothing.
import { useState } from 'react';

import { ALLOWED_IMAGE_TYPES } from '@/core/utils/imageFiles';

function ImageDropZone({
  inputId,
  onFiles,
  multiple = false,
  disabled = false, // e.g. an upload in flight — ignores drops and picks
  atCap = false, // field is full: no input, drops become caller-side notices
  hint = 'Drag & drop an image here, or choose a file below.',
  capMessage,
  children, // optional preview rendered inside the zone
}) {
  const [dragActive, setDragActive] = useState(false);

  const handleFiles = (files) => {
    if (disabled || !files?.length) return;
    onFiles(files);
  };

  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <div
      className={`border rounded p-3 text-center ${
        dragActive ? 'border-primary bg-light' : 'border-secondary-subtle'
      }`}
      style={{ borderStyle: 'dashed' }}
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setDragActive(true);
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        setDragActive(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragActive(false);
        handleFiles(e.dataTransfer.files);
      }}
    >
      {children}
      <p className="text-muted mb-2">{atCap ? capMessage : hint}</p>
      {!atCap && (
        <input
          id={inputId}
          type="file"
          className="form-control"
          accept={ALLOWED_IMAGE_TYPES.join(',')}
          multiple={multiple}
          disabled={disabled}
          onChange={(e) => {
            handleFiles(e.target.files);
            // Clear so re-picking the same file still fires onChange.
            e.target.value = '';
          }}
        />
      )}
    </div>
  );
}

export default ImageDropZone;
