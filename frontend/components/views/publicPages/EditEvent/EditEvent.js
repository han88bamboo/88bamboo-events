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

import { SUBMITTER_TYPES, withLegacyValue } from '@/core/constants/formOptions';
import LocationFields from '@/components/common/LocationFields';
import ScheduleFields, {
  toEditableOccurrences,
  toWireOccurrences,
} from '@/components/common/ScheduleFields';

// datetime-local wants 'YYYY-MM-DDTHH:MM'; the API returns full ISO strings.
const toLocalInput = (iso) => (iso ? String(iso).slice(0, 16) : '');

// Pure: build the per-field error map (D2, presentational only — the shared
// validate_submission on the server stays the authority). Mirrors SubmitEvent
// minus the image (edits carry the image forward). The date entry is owned by
// ScheduleFields, which reports its own errors up, so date keys are not here.
function buildFieldErrors(fields, selectedCategories) {
  const fe = {};
  if (!fields.name.trim()) fe.name = 'Event name is required.';
  if (!fields.submitter_email.trim()) fe.submitter_email = 'Your email is required.';
  if (!fields.country.trim()) fe.country = 'Country is required.';
  if (!fields.city.trim()) fe.city = 'City is required.';
  if (!fields.event_format) fe.event_format = 'Event format is required.';
  if (selectedCategories.length === 0)
    fe.drink_categories = 'Select at least one drink category.';
  return fe;
}

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
    occurrences: toEditableOccurrences(src.occurrences),
    venue_name: src.venue_name || '',
    venue_address: src.venue_address || '',
    country: src.country || '',
    city: src.city || '',
    // EP-2 location fields, carried forward so an untouched address keeps its
    // captured coordinates (the versioning layer also enforces this server-side).
    region: src.region || '',
    latitude: src.latitude ?? '',
    longitude: src.longitude ?? '',
    place_id: src.place_id || '',
    postcode: src.postcode || '',
    description: src.description || '',
    link: src.link || '',
    submission_type: src.submission_type || '',
    event_format: src.event_format || '',
    // Public organiser name (EP-7). The edit session already proves ownership, so
    // no login is needed here; a changed name is re-claimed server-side.
    organiser_name: src.organiser_name || '',
  });
  const pastOrganiserNames = context?.organiser_names || [];
  const [selectedCategories, setSelectedCategories] = useState(src.drink_categories || []);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState([]); // server/network errors (top alert)
  const [locationErrors, setLocationErrors] = useState([]); // from LocationFields
  const [scheduleErrors, setScheduleErrors] = useState([]); // from ScheduleFields (EP-6)
  const [touched, setTouched] = useState({});
  const [locationTouched, setLocationTouched] = useState(false);
  const [scheduleTouched, setScheduleTouched] = useState(false);
  const [done, setDone] = useState(false);

  // Recomputed each render from the single source of state (D2, pure).
  const fieldErrors = buildFieldErrors(fields, selectedCategories);
  const locationInvalid =
    !!fieldErrors.country || !!fieldErrors.city || locationErrors.length > 0;

  const setField = (key) => (e) =>
    setFields((prev) => ({ ...prev, [key]: e.target.value }));

  const blur = (key) => () => setTouched((t) => ({ ...t, [key]: true }));

  const patchFields = (patch) => setFields((prev) => ({ ...prev, ...patch }));

  const toggleCategory = (label) => {
    setSelectedCategories((prev) =>
      prev.includes(label) ? prev.filter((c) => c !== label) : [...prev, label],
    );
    setTouched((t) => ({ ...t, drink_categories: true }));
  };

  const FieldError = ({ name }) =>
    touched[name] && fieldErrors[name] ? (
      <div className="text-danger small mt-1">{fieldErrors[name]}</div>
    ) : null;

  const invalidClass = (name) =>
    touched[name] && fieldErrors[name] ? ' is-invalid' : '';

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrors([]);
    // Client mirror of the required rules + LocationFields' own errors, shown
    // inline; reveal them and bail if anything is still invalid (the server
    // re-validates regardless).
    if (Object.keys(fieldErrors).length || locationInvalid || scheduleErrors.length) {
      setTouched((t) => ({
        ...t,
        ...Object.fromEntries(Object.keys(fieldErrors).map((k) => [k, true])),
      }));
      setLocationTouched(true);
      setScheduleTouched(true);
      return;
    }
    setSubmitting(true);
    try {
      // Combine the multi-date rows' parts into wire {start,end} datetimes (EP-6);
      // in single-date mode occurrences is absent → the server uses the scalar
      // start/end path.
      const { occurrences, ...rest } = fields;
      const { data, ok } = await onSubmit({
        ...rest,
        drink_categories: selectedCategories,
        ...(Array.isArray(occurrences)
          ? { occurrences: toWireOccurrences(occurrences) }
          : {}),
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
      <h1 className="tw-text-bamboo-slate mb-1" style={{ fontFamily: 'Buenard, Georgia, "Times New Roman", serif' }}>
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
          <input id="name" className={`form-control${invalidClass('name')}`} value={fields.name} onChange={setField('name')} onBlur={blur('name')} maxLength={500} required />
          <FieldError name="name" />
        </div>

        <div className="row">
          <div className="col-md-6 mb-3">
            <label className="form-label" htmlFor="submitter_email">Your email *</label>
            <input id="submitter_email" type="email" className={`form-control${invalidClass('submitter_email')}`} value={fields.submitter_email} onChange={setField('submitter_email')} onBlur={blur('submitter_email')} required />
            <FieldError name="submitter_email" />
          </div>
          <div className="col-md-6 mb-3">
            <label className="form-label" htmlFor="contact_email">Public contact email</label>
            <input id="contact_email" type="email" className="form-control" value={fields.contact_email} onChange={setField('contact_email')} />
          </div>
        </div>

        {/* Public organiser name (EP-7) — optional; a datalist offers the owner's
            previously-used names. Changing it re-claims server-side (a name owned by
            another account is rejected). */}
        <div className="mb-3">
          <label className="form-label" htmlFor="organiser_name">Public organiser name</label>
          <input
            id="organiser_name"
            className="form-control"
            list="organiser-name-options"
            value={fields.organiser_name}
            onChange={setField('organiser_name')}
            maxLength={255}
            placeholder="e.g. Sake Matsuri Singapore"
          />
          {pastOrganiserNames.length > 0 && (
            <datalist id="organiser-name-options">
              {pastOrganiserNames.map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
          )}
          <div className="form-text">Shown publicly as “Organised by …”. Optional.</div>
        </div>

        {/* Schedule: single date by default or a multi-date table (EP-6). Owned by
            ScheduleFields, which reports its own errors up; surfaced inline below. */}
        {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
        <div onBlur={() => setScheduleTouched(true)}>
          <ScheduleFields
            values={fields}
            onChange={patchFields}
            onValidationChange={setScheduleErrors}
          />
        </div>
        {scheduleTouched && scheduleErrors.length > 0 && (
          <div className="text-danger small mb-3">
            <ul className="mb-0 ps-3">
              {scheduleErrors.map((m, i) => (
                <li key={i}>{m}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Venue name + Google-validated address + country + dependent region +
            city (EP-2), shared with the submit form via LocationFields. Its own
            reported errors + country/city required are shown inline below (D2). */}
        {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
        <div onBlur={() => setLocationTouched(true)}>
          <LocationFields
            values={fields}
            onChange={patchFields}
            onValidationChange={setLocationErrors}
          />
        </div>
        {locationTouched && locationInvalid && (
          <div className="text-danger small mb-3">
            <ul className="mb-0 ps-3">
              {fieldErrors.country && <li>{fieldErrors.country}</li>}
              {fieldErrors.city && <li>{fieldErrors.city}</li>}
              {locationErrors.map((m, i) => (
                <li key={i}>{m}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="mb-3">
          <label className="form-label" htmlFor="event_format">Event format *</label>
          <select id="event_format" className={`form-select${invalidClass('event_format')}`} value={fields.event_format} onChange={setField('event_format')} onBlur={blur('event_format')} required>
            <option value="">Choose…</option>
            {eventFormats.map((f) => (
              <option key={f.id} value={f.label}>{f.label}</option>
            ))}
          </select>
          <FieldError name="event_format" />
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
          <FieldError name="drink_categories" />
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
          <select id="submission_type" className="form-select" value={fields.submission_type} onChange={setField('submission_type')}>
            <option value="">Choose…</option>
            {withLegacyValue(SUBMITTER_TYPES, fields.submission_type).map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>

        {extras}

        <div className="d-flex gap-2">
          <button type="submit" className="btn bamboo-btn" disabled={submitting}>
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
