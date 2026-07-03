// EditEvent — the reusable edit form (plan §7). Prefilled from the current
// version; submitting creates a NEW pending_review version (image carried
// forward — image editing is out of MVP scope; edits are free). Fields mirror
// SubmitEvent, minus the image + honeypot.
//
// Transport-agnostic: the caller passes `onSubmit(eventFields)` returning the
// apiClient-shaped `{ data, ok }`, so the same form serves the per-event magic
// link (/edit), the account dashboard (/my-events/<id>), AND the admin dashboard.
// `onCancel` is optional (the account flow shows a "Cancel" back to the event view).
//
// Optional presentation props (all default to the submitter-edit copy so existing
// callers are unchanged): `submitLabel` overrides the submit button text; `extras`
// renders extra controls just above the buttons (the admin's "inform them" option);
// `successNode` replaces the default "under review" screen (the admin edit shows a
// "saved/published" message instead).
import { useState } from 'react';

// datetime-local wants 'YYYY-MM-DDTHH:MM'; the API returns full ISO strings.
const toLocalInput = (iso) => (iso ? String(iso).slice(0, 16) : '');

function EditEvent({ context, taxonomy, onSubmit, onCancel, submitLabel, extras, successNode }) {
  const drinkCategories = taxonomy?.drink_categories || [];
  const eventFormats = taxonomy?.event_formats || [];
  const src = context?.event || {};

  const [fields, setFields] = useState({
    name: src.name || '',
    submitter_email: src.submitter_email || '',
    contact_email: src.contact_email || '',
    start_datetime: toLocalInput(src.start_datetime),
    end_datetime: toLocalInput(src.end_datetime),
    venue_name: src.venue_name || '',
    venue_address: src.venue_address || '',
    country: src.country || '',
    city: src.city || '',
    description: src.description || '',
    link: src.link || '',
    submission_type: src.submission_type || '',
    event_format: src.event_format || '',
  });
  const [selectedCategories, setSelectedCategories] = useState(src.drink_categories || []);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState([]);
  const [done, setDone] = useState(false);

  const setField = (key) => (e) =>
    setFields((prev) => ({ ...prev, [key]: e.target.value }));

  const toggleCategory = (label) =>
    setSelectedCategories((prev) =>
      prev.includes(label) ? prev.filter((c) => c !== label) : [...prev, label],
    );

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrors([]);
    setSubmitting(true);
    try {
      const { data, ok } = await onSubmit({
        ...fields,
        drink_categories: selectedCategories,
      });
      if (!ok) {
        setErrors(data?.errors || [data?.error || 'Could not save your edit.']);
        return;
      }
      setDone(true);
    } catch {
      setErrors(['Could not reach the server. Please try again.']);
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    if (successNode) return successNode;
    return (
      <main className="container py-5" style={{ maxWidth: 720 }}>
        <div className="alert alert-success">
          <h4 className="alert-heading">Edit received — under review</h4>
          <p className="mb-0">
            Thanks! Your changes are queued for review.{' '}
            {context?.is_published
              ? 'Your current listing stays live until the update is approved.'
              : 'Your submission will be reviewed with the updated details.'}{' '}
            There&apos;s no charge for edits.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="container py-5" style={{ maxWidth: 720 }}>
      <h1 className="tw-text-custom-green mb-1" style={{ fontFamily: 'Sora, sans-serif' }}>
        Edit your event
      </h1>
      <p className="text-muted">
        Update the details below. Changes are reviewed before they go live; the
        event image stays as-is.
      </p>

      {src.image_url && (
        <div className="mb-3">
          <label className="form-label d-block">Current image</label>
          {/* Plain <img> (not next/image): the S3/stub host isn't guaranteed in
              the next/image allowlist, and this is a read-only preview. */}
          <img
            src={src.image_url}
            alt={src.name || 'Event image'}
            className="img-thumbnail"
            style={{ maxHeight: 200, objectFit: 'cover' }}
          />
          <div className="form-text">The event image can’t be changed here.</div>
        </div>
      )}

      {errors.length > 0 && (
        <div className="alert alert-danger">
          <ul className="mb-0">
            {errors.map((m, i) => <li key={i}>{m}</li>)}
          </ul>
        </div>
      )}

      <form onSubmit={handleSubmit} noValidate>
        <div className="mb-3">
          <label className="form-label" htmlFor="name">Event name *</label>
          <input id="name" className="form-control" value={fields.name} onChange={setField('name')} maxLength={500} required />
        </div>

        <div className="row">
          <div className="col-md-6 mb-3">
            <label className="form-label" htmlFor="submitter_email">Your email *</label>
            <input id="submitter_email" type="email" className="form-control" value={fields.submitter_email} onChange={setField('submitter_email')} required />
          </div>
          <div className="col-md-6 mb-3">
            <label className="form-label" htmlFor="contact_email">Public contact email</label>
            <input id="contact_email" type="email" className="form-control" value={fields.contact_email} onChange={setField('contact_email')} />
          </div>
        </div>

        <div className="row">
          <div className="col-md-6 mb-3">
            <label className="form-label" htmlFor="start_datetime">Starts *</label>
            <input id="start_datetime" type="datetime-local" className="form-control" value={fields.start_datetime} onChange={setField('start_datetime')} required />
          </div>
          <div className="col-md-6 mb-3">
            <label className="form-label" htmlFor="end_datetime">Ends *</label>
            <input id="end_datetime" type="datetime-local" className="form-control" value={fields.end_datetime} onChange={setField('end_datetime')} required />
          </div>
        </div>

        <div className="mb-3">
          <label className="form-label" htmlFor="venue_name">Venue name</label>
          <input id="venue_name" className="form-control" value={fields.venue_name} onChange={setField('venue_name')} maxLength={500} />
        </div>
        <div className="mb-3">
          <label className="form-label" htmlFor="venue_address">Venue address</label>
          <input id="venue_address" className="form-control" value={fields.venue_address} onChange={setField('venue_address')} />
        </div>

        <div className="row">
          <div className="col-md-6 mb-3">
            <label className="form-label" htmlFor="country">Country *</label>
            <input id="country" className="form-control" value={fields.country} onChange={setField('country')} required />
          </div>
          <div className="col-md-6 mb-3">
            <label className="form-label" htmlFor="city">City *</label>
            <input id="city" className="form-control" value={fields.city} onChange={setField('city')} required />
          </div>
        </div>

        <div className="mb-3">
          <label className="form-label" htmlFor="event_format">Event format *</label>
          <select id="event_format" className="form-select" value={fields.event_format} onChange={setField('event_format')} required>
            <option value="">Choose…</option>
            {eventFormats.map((f) => (
              <option key={f.id} value={f.label}>{f.label}</option>
            ))}
          </select>
        </div>

        <div className="mb-3">
          <label className="form-label d-block">Drink categories *</label>
          <div className="d-flex flex-wrap gap-3">
            {drinkCategories.map((c) => (
              <div className="form-check" key={c.id}>
                <input
                  className="form-check-input"
                  type="checkbox"
                  id={`cat-${c.id}`}
                  checked={selectedCategories.includes(c.label)}
                  onChange={() => toggleCategory(c.label)}
                />
                <label className="form-check-label" htmlFor={`cat-${c.id}`}>{c.label}</label>
              </div>
            ))}
          </div>
        </div>

        <div className="mb-3">
          <label className="form-label" htmlFor="description">Description</label>
          <textarea id="description" className="form-control" rows={4} value={fields.description} onChange={setField('description')} />
        </div>
        <div className="mb-3">
          <label className="form-label" htmlFor="link">Event link</label>
          <input id="link" type="url" className="form-control" value={fields.link} onChange={setField('link')} placeholder="https://…" />
        </div>
        <div className="mb-4">
          <label className="form-label" htmlFor="submission_type">Submitter type</label>
          <input id="submission_type" className="form-control" value={fields.submission_type} onChange={setField('submission_type')} maxLength={255} placeholder="e.g. bar, brand, agency" />
        </div>

        {extras}

        <div className="d-flex gap-2">
          <button type="submit" className="btn btn-success" disabled={submitting}>
            {submitting ? 'Saving…' : submitLabel || 'Submit changes for review'}
          </button>
          {onCancel && (
            <button type="button" className="btn btn-outline-secondary" onClick={onCancel} disabled={submitting}>
              Cancel
            </button>
          )}
        </div>
      </form>
    </main>
  );
}

export default EditEvent;
