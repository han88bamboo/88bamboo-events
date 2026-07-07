// SubmitEvent — the public event submission form (plan §8). Self-contained view
// (PATTERN-SPEC §B4.2.2). Taxonomy options arrive as props (fetched SSR from the
// DB-backed /taxonomy endpoint — never hardcoded, plan §7).
//
// ROUND 3a: on submit this validates + uploads the image server-side and shows
// the returned "held" payload. Payment (Stripe Elements) is wired in 3b, so the
// button here reads "Continue" and the success panel stands in for the checkout
// step that will consume this payload next round.
//
// EP-3 (frontend-only UX, no schema/contract change): the data-entry portion is a
// hand-rolled multi-step wizard (Details → Location → Description & image); the
// single `fields`/`selectedCategories`/`imageFile`/`locationErrors`/`honeypot`
// state is unchanged and FormData is still assembled + submitted once, at the end.
// The 3a "Continue" still flips to the existing post-3a "Confirm & pay" screen
// (CheckoutStep, 3b) — the two-request contract is untouched. Validation is now
// shown inline per field (D2, presentational only — the server stays authoritative)
// and the image field has a thumbnail preview + drag-and-drop zone (D1).
import { useEffect, useState } from 'react';

import { submissionsService } from '@/core/services/submissions';
import { SUBMITTER_TYPES, withLegacyValue } from '@/core/constants/formOptions';
import LocationFields from '@/components/common/LocationFields';
import ScheduleFields from '@/components/common/ScheduleFields';
import CheckoutStep from './CheckoutStep';

// Mirror the server's image rules for fast client-side feedback (the server is
// still authoritative — submission_validation.py).
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_IMAGE_MB = 5;

// Wizard steps (data-entry only — payment stays on the post-3a screen). Each
// entry lists the field keys validated to gate "Next"/reveal inline errors; the
// location step also folds in LocationFields' own reported errors.
// The Details step's date entry (start/end, or the multi-date schedule) is owned
// by ScheduleFields, which reports its own errors up (like LocationFields) — so the
// date keys are NOT in this per-field map.
const STEPS = ['Details', 'Location', 'Description & image'];
const STEP_FIELD_KEYS = [
  ['name', 'submitter_email'],
  ['country', 'city'],
  ['event_format', 'drink_categories', 'image'],
];
const LAST_STEP = STEPS.length - 1;

const EMPTY = {
  name: '',
  submitter_email: '',
  contact_email: '',
  start_datetime: '',
  end_datetime: '',
  venue_name: '',
  venue_address: '',
  country: '',
  city: '',
  // EP-2 location fields: region (controlled subdivision) + the coordinates /
  // place_id / postcode captured from the Google Places selection.
  region: '',
  latitude: '',
  longitude: '',
  place_id: '',
  postcode: '',
  description: '',
  link: '',
  event_format: '',
  submission_type: '',
};

// datetime-local wants 'YYYY-MM-DDTHH:MM'; the re-submit prefill carries ISO.
const toLocalInput = (iso) => (iso ? String(iso).slice(0, 16) : '');

// Pure: message for a bad/missing image file, '' when acceptable. Mirrors the
// server rules so obvious problems surface before a round-trip.
function imageError(file) {
  if (!file) return 'An event image is required.';
  if (!ALLOWED_IMAGE_TYPES.includes(file.type))
    return 'Image must be a JPEG, PNG, or WebP file.';
  if (file.size > MAX_IMAGE_MB * 1024 * 1024)
    return `Image is too large (max ${MAX_IMAGE_MB} MB).`;
  return '';
}

// Pure: build the per-field error map from the current form state (D2). Purely
// presentational — the server re-validates everything on submit.
function buildFieldErrors(fields, selectedCategories, imageFile) {
  const fe = {};
  if (!fields.name.trim()) fe.name = 'Event name is required.';
  if (!fields.submitter_email.trim()) fe.submitter_email = 'Submitter email is required.';
  if (!fields.country.trim()) fe.country = 'Country is required.';
  if (!fields.city.trim()) fe.city = 'City is required.';
  if (!fields.event_format) fe.event_format = 'Event format is required.';
  if (selectedCategories.length === 0)
    fe.drink_categories = 'Select at least one drink category.';
  const img = imageError(imageFile);
  if (img) fe.image = img;
  return fe;
}

// Map a serialised occurrences list ([{start,end}] ISO) to the datetime-local
// 'YYYY-MM-DDTHH:MM' shape ScheduleFields edits. Only a genuine multi-date schedule
// (>1 date) opens the table; a single/legacy date uses the scalar start/end.
function toLocalOccurrences(list) {
  if (!Array.isArray(list) || list.length <= 1) return undefined;
  return list.map((o) => ({ start: toLocalInput(o.start), end: toLocalInput(o.end) }));
}

// Build the initial form state, seeding from a re-submit prefill when present.
function initialFields(prefill) {
  if (!prefill) return EMPTY;
  return {
    ...EMPTY,
    name: prefill.name || '',
    submitter_email: prefill.submitter_email || '',
    contact_email: prefill.contact_email || '',
    start_datetime: toLocalInput(prefill.start_datetime),
    end_datetime: toLocalInput(prefill.end_datetime),
    occurrences: toLocalOccurrences(prefill.occurrences),
    venue_name: prefill.venue_name || '',
    venue_address: prefill.venue_address || '',
    country: prefill.country || '',
    city: prefill.city || '',
    region: prefill.region || '',
    latitude: prefill.latitude ?? '',
    longitude: prefill.longitude ?? '',
    place_id: prefill.place_id || '',
    postcode: prefill.postcode || '',
    description: prefill.description || '',
    link: prefill.link || '',
    event_format: prefill.event_format || '',
    submission_type: prefill.submission_type || '',
  };
}

function SubmitEvent({ taxonomy, prefill }) {
  // Taxonomy normally arrives from SSR props. Keep it in state with a client-side
  // fallback: if SSR came back empty (a transient API blip), re-fetch it in the
  // browser so the form self-heals instead of showing empty selects (plan §7).
  const [tax, setTax] = useState(taxonomy);
  const drinkCategories = tax?.drink_categories || [];
  const eventFormats = tax?.event_formats || [];

  useEffect(() => {
    if (eventFormats.length || drinkCategories.length) return undefined;
    let cancelled = false;
    submissionsService
      .getTaxonomy()
      .then((t) => {
        if (!cancelled && t && (t.event_formats?.length || t.drink_categories?.length)) {
          setTax(t);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // Run once on mount as a fallback; SSR props are the primary source.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [fields, setFields] = useState(() => initialFields(prefill));
  const [selectedCategories, setSelectedCategories] = useState(prefill?.drink_categories || []);
  const [imageFile, setImageFile] = useState(null);
  const [locationErrors, setLocationErrors] = useState([]); // from LocationFields
  const [scheduleErrors, setScheduleErrors] = useState([]); // from ScheduleFields (EP-6)
  const [honeypot, setHoneypot] = useState(''); // must stay empty for real users
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState([]); // server/network errors (top alert)
  const [result, setResult] = useState(null); // 3a held payload (event + image)
  const [confirmation, setConfirmation] = useState(null); // 3b pending_review result

  // Wizard + inline-validation UI state (EP-3). `touched` gates when a field's
  // inline error is revealed; `locationTouched` does the same for the shared
  // LocationFields block (it reports its errors up via onValidationChange).
  const [step, setStep] = useState(0);
  const [touched, setTouched] = useState({});
  const [locationTouched, setLocationTouched] = useState(false);
  const [scheduleTouched, setScheduleTouched] = useState(false);
  const [imagePreview, setImagePreview] = useState(null);
  const [dragActive, setDragActive] = useState(false);

  // Recomputed each render from the single source of state (cheap, pure).
  const fieldErrors = buildFieldErrors(fields, selectedCategories, imageFile);
  const locationInvalid =
    !!fieldErrors.country || !!fieldErrors.city || locationErrors.length > 0;

  // Object-URL thumbnail preview for the selected image; revoked on change/unmount
  // so we don't leak blobs (D1). Client-only (effect never runs during SSR).
  useEffect(() => {
    if (!imageFile) {
      setImagePreview(null);
      return undefined;
    }
    const url = URL.createObjectURL(imageFile);
    setImagePreview(url);
    return () => URL.revokeObjectURL(url);
  }, [imageFile]);

  const resetAll = () => {
    setResult(null);
    setConfirmation(null);
    setFields(EMPTY);
    setSelectedCategories([]);
    setImageFile(null);
    setStep(0);
    setTouched({});
    setLocationTouched(false);
    setScheduleTouched(false);
    setErrors([]);
  };

  const setField = (key) => (e) =>
    setFields((prev) => ({ ...prev, [key]: e.target.value }));

  // Merge a partial update (used by LocationFields, which sets several fields at
  // once from one Google selection).
  const patchFields = (patch) => setFields((prev) => ({ ...prev, ...patch }));

  const blur = (key) => () => setTouched((t) => ({ ...t, [key]: true }));

  const toggleCategory = (label) => {
    setSelectedCategories((prev) =>
      prev.includes(label) ? prev.filter((c) => c !== label) : [...prev, label],
    );
    setTouched((t) => ({ ...t, drink_categories: true }));
  };

  // Accept a file from either the picker or a drop; keep the existing client-side
  // type/size checks (surfaced inline via imageError above).
  const acceptFile = (file) => {
    setImageFile(file || null);
    setTouched((t) => ({ ...t, image: true }));
  };
  const onFileChange = (e) => acceptFile(e.target.files?.[0] || null);
  const onDrop = (e) => {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) acceptFile(file);
  };

  // Reveal every inline error in a step (used when a gated "Next" is blocked or
  // when a submit jumps back to the first invalid step).
  const revealStep = (i) => {
    setTouched((t) => ({
      ...t,
      ...Object.fromEntries(STEP_FIELD_KEYS[i].map((k) => [k, true])),
    }));
    if (i === 0) setScheduleTouched(true);
    if (i === 1) setLocationTouched(true);
  };

  const stepInvalid = (i) => {
    if (i === 0)
      return STEP_FIELD_KEYS[0].some((k) => fieldErrors[k]) || scheduleErrors.length > 0;
    if (i === 1) return locationInvalid;
    return STEP_FIELD_KEYS[i].some((k) => fieldErrors[k]);
  };

  const goNext = () => {
    if (stepInvalid(step)) {
      revealStep(step);
      return;
    }
    setStep((s) => Math.min(s + 1, LAST_STEP));
  };
  const goBack = () => setStep((s) => Math.max(s - 1, 0));

  const onSubmit = async (e) => {
    e.preventDefault();
    // Enter-to-submit / Next on a non-final step just advances the wizard.
    if (step < LAST_STEP) {
      goNext();
      return;
    }

    setErrors([]);
    setResult(null);

    // Client mirror of the required rules; jump to the first step with a problem
    // and reveal its inline errors (the server re-validates regardless).
    for (let i = 0; i < STEPS.length; i += 1) {
      if (stepInvalid(i)) {
        revealStep(i);
        setStep(i);
        return;
      }
    }

    const formData = new FormData();
    Object.entries(fields).forEach(([k, v]) => {
      // occurrences is an array (the multi-date schedule) — appended as JSON below,
      // never through the generic string append (which would comma-join it).
      if (k === 'occurrences') return;
      formData.append(k, v);
    });
    selectedCategories.forEach((c) => formData.append('drink_categories', c));
    formData.append('company_url', honeypot); // honeypot — server checks it
    // Multi-date schedule (EP-6). Empty in the single-date case → the server uses
    // the scalar start/end path (unchanged legacy behaviour).
    formData.append('occurrences', JSON.stringify(fields.occurrences || []));
    if (imageFile) formData.append('image', imageFile);

    setSubmitting(true);
    try {
      const { data, ok } = await submissionsService.submit(formData);
      if (!ok) {
        setErrors(
          data?.errors || [data?.error || 'Submission failed. Please try again.'],
        );
        return;
      }
      setResult(data?.data || null);
    } catch (err) {
      setErrors(['Could not reach the server. Please try again.']);
    } finally {
      setSubmitting(false);
    }
  };

  // Small inline error under a flat field, revealed once the field is touched.
  const FieldError = ({ name }) =>
    touched[name] && fieldErrors[name] ? (
      <div className="text-danger small mt-1">{fieldErrors[name]}</div>
    ) : null;

  const invalidClass = (name) =>
    touched[name] && fieldErrors[name] ? ' is-invalid' : '';

  // Final state: the card was authorised and the listing is pending review.
  if (confirmation) {
    return (
      <main className="container py-5" style={{ maxWidth: 720 }}>
        <div className="alert alert-success" role="alert">
          <h4 className="alert-heading">Submission received — under review</h4>
          <p className="mb-0">
            We placed a temporary authorisation (a hold, not a charge) on your
            card and sent you a confirmation email. Listings are usually reviewed
            within 3 business days. You are only charged if your event is approved.
          </p>
        </div>
        {confirmation.payment?.capture_before && (
          <p className="text-muted">
            Authorisation reference: <code>{confirmation.payment.payment_intent_id}</code>
          </p>
        )}
        <button type="button" className="btn btn-outline-secondary" onClick={resetAll}>
          Submit another
        </button>
      </main>
    );
  }

  // Intermediate state: details validated + image uploaded (3a), now take payment.
  if (result) {
    return (
      <main className="container py-5" style={{ maxWidth: 720 }}>
        <h1 className="tw-text-bamboo-slate mb-3" style={{ fontFamily: 'Buenard, Georgia, "Times New Roman", serif' }}>
          Confirm &amp; pay
        </h1>
        {result.image?.url && (
          // Plain <img> (not next/image): the local stub host is not in the
          // next.config remotePatterns allowlist, and this is just a preview.
          <img
            src={result.image.url}
            alt="Uploaded event"
            className="img-fluid rounded mb-3"
            style={{ maxHeight: 200 }}
          />
        )}
        <h5 className="mb-1">{result.event?.name}</h5>
        <p className="text-muted">
          {result.event?.city}, {result.event?.country}
        </p>
        <CheckoutStep
          held={result}
          onPaid={(data) => setConfirmation(data)}
          onBack={() => setResult(null)}
        />
      </main>
    );
  }

  return (
    <main className="container py-5" style={{ maxWidth: 720 }}>
      <h1 className="tw-text-bamboo-slate mb-1" style={{ fontFamily: 'Buenard, Georgia, "Times New Roman", serif' }}>
        List an event
      </h1>
      <p className="text-muted">
        Submit your drinks or hospitality event. Listings go live after review;
        the USD 5 fee is only charged if your listing is approved.
      </p>

      {prefill && (
        <div className="alert alert-info" role="status">
          We&apos;ve pre-filled the details from your previous listing. Re-upload the
          event image and submit to list it again — a fresh listing fee applies.
        </div>
      )}

      {/* Step indicator (Details → Location → Description & image). */}
      <ol className="list-unstyled d-flex flex-wrap gap-2 mb-4" aria-label="Progress">
        {STEPS.map((label, i) => (
          <li key={label} className="d-flex align-items-center gap-2">
            <span
              className={`badge rounded-pill ${i === step ? 'bamboo-btn' : 'bg-secondary-subtle text-secondary'}`}
            >
              {i + 1}
            </span>
            <span className={i === step ? 'fw-semibold' : 'text-muted'}>{label}</span>
            {i < LAST_STEP && <span className="text-muted d-none d-sm-inline">→</span>}
          </li>
        ))}
      </ol>

      {/* Top alert is now reserved for server/network errors (client-side field
          rules are shown inline per field, D2). */}
      {errors.length > 0 && (
        <div className="alert alert-danger" role="alert">
          <ul className="mb-0">
            {errors.map((msg, i) => (
              <li key={i}>{msg}</li>
            ))}
          </ul>
        </div>
      )}

      <form onSubmit={onSubmit} noValidate>
        {/* Honeypot: hidden from users, tab-skipped, autocomplete off. A filled
            value flags a bot server-side (plan §8). */}
        <div
          aria-hidden="true"
          style={{ position: 'absolute', left: '-9999px', top: 'auto', height: 0, overflow: 'hidden' }}
        >
          <label htmlFor="company_url">Company URL (leave blank)</label>
          <input
            id="company_url"
            name="company_url"
            type="text"
            tabIndex={-1}
            autoComplete="off"
            value={honeypot}
            onChange={(e) => setHoneypot(e.target.value)}
          />
        </div>

        {/* STEP 1 — Details. All steps stay mounted (hidden when inactive) so the
            LocationFields autocomplete + captured coords are never torn down. */}
        <div hidden={step !== 0}>
          <div className="mb-3">
            <label className="form-label" htmlFor="name">
              Event name <span className="text-danger">*</span>
            </label>
            <input
              id="name"
              className={`form-control${invalidClass('name')}`}
              value={fields.name}
              onChange={setField('name')}
              onBlur={blur('name')}
              maxLength={500}
              required
            />
            <FieldError name="name" />
          </div>

          <div className="row">
            <div className="col-md-6 mb-3">
              <label className="form-label" htmlFor="submitter_email">
                Your email <span className="text-danger">*</span>
              </label>
              <input
                id="submitter_email"
                type="email"
                className={`form-control${invalidClass('submitter_email')}`}
                value={fields.submitter_email}
                onChange={setField('submitter_email')}
                onBlur={blur('submitter_email')}
                required
              />
              <div className="form-text">Where we send review updates.</div>
              <FieldError name="submitter_email" />
            </div>
            <div className="col-md-6 mb-3">
              <label className="form-label" htmlFor="contact_email">
                Public contact email
              </label>
              <input
                id="contact_email"
                type="email"
                className="form-control"
                value={fields.contact_email}
                onChange={setField('contact_email')}
              />
              <div className="form-text">Shown on the listing (optional).</div>
            </div>
          </div>

          {/* Schedule: a single date by default, or an "Add another date" table for
              multi-date events (EP-6). ScheduleFields owns the date inputs and
              reports its own blocking errors up (like LocationFields); we surface
              them inline within this step. The wrapping onBlur marks the block
              touched once any schedule field loses focus. */}
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
        </div>

        {/* STEP 2 — Location. Venue name + Google-validated address + country +
            dependent region + city (EP-2). LocationFields owns the Google Places
            autocomplete and the controlled country/region dropdowns and reports
            blocking errors up; we surface them inline within this step (D2, no
            duplication of its logic). The wrapping onBlur marks the block touched
            once any location field loses focus. */}
        <div hidden={step !== 1}>
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
        </div>

        {/* STEP 3 — Description & image. */}
        <div hidden={step !== 2}>
          <div className="mb-3">
            <label className="form-label" htmlFor="event_format">
              Event format <span className="text-danger">*</span>
            </label>
            <select
              id="event_format"
              className={`form-select${invalidClass('event_format')}`}
              value={fields.event_format}
              onChange={setField('event_format')}
              onBlur={blur('event_format')}
              required
            >
              <option value="">Choose…</option>
              {eventFormats.map((f) => (
                <option key={f.id} value={f.label}>
                  {f.label}
                </option>
              ))}
            </select>
            <FieldError name="event_format" />
          </div>

          <div className="mb-3">
            <label className="form-label d-block">
              Drink categories <span className="text-danger">*</span>
            </label>
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
                  <label className="form-check-label" htmlFor={`cat-${c.id}`}>
                    {c.label}
                  </label>
                </div>
              ))}
            </div>
            <FieldError name="drink_categories" />
          </div>

          <div className="mb-3">
            <label className="form-label" htmlFor="description">
              Description
            </label>
            <textarea
              id="description"
              className="form-control"
              rows={4}
              value={fields.description}
              onChange={setField('description')}
            />
            <div className="form-text d-flex justify-content-between">
              <span>Tell attendees what to expect — drinks, hosts, what&apos;s included.</span>
              <span>{fields.description.length} characters</span>
            </div>
          </div>

          <div className="mb-3">
            <label className="form-label" htmlFor="link">
              Event link
            </label>
            <input
              id="link"
              type="url"
              className="form-control"
              value={fields.link}
              onChange={setField('link')}
              placeholder="https://…"
            />
          </div>

          <div className="mb-3">
            <label className="form-label" htmlFor="submission_type">
              Submitter type
            </label>
            <select
              id="submission_type"
              className="form-select"
              value={fields.submission_type}
              onChange={setField('submission_type')}
            >
              <option value="">Choose…</option>
              {withLegacyValue(SUBMITTER_TYPES, fields.submission_type).map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>

          <div className="mb-4">
            <label className="form-label d-block" htmlFor="image">
              Event image <span className="text-danger">*</span>
            </label>
            {/* Drag-and-drop zone + thumbnail preview (D1). The file picker stays
                the primary control; dropping a file routes through the same
                acceptFile()/type-size checks. */}
            {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
            <div
              className={`border rounded p-3 text-center ${dragActive ? 'border-primary bg-light' : 'border-secondary-subtle'}`}
              style={{ borderStyle: 'dashed' }}
              onDragOver={(e) => {
                e.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={(e) => {
                e.preventDefault();
                setDragActive(false);
              }}
              onDrop={onDrop}
            >
              {imagePreview ? (
                // Plain <img> (object URL, not next/image): a transient local
                // blob preview, never in the next.config remotePatterns allowlist.
                <img
                  src={imagePreview}
                  alt="Selected event"
                  className="img-fluid rounded mb-2"
                  style={{ maxHeight: 200 }}
                />
              ) : (
                <p className="text-muted mb-2">
                  Drag &amp; drop an image here, or choose a file below.
                </p>
              )}
              <input
                id="image"
                type="file"
                className="form-control"
                accept="image/jpeg,image/png,image/webp"
                onChange={onFileChange}
              />
            </div>
            <div className="form-text">JPEG, PNG, or WebP, up to {MAX_IMAGE_MB} MB.</div>
            {imageFile && <div className="form-text">Selected: {imageFile.name}</div>}
            <FieldError name="image" />
          </div>
        </div>

        {/* Wizard navigation. Back/Next are type="button"; only the final step's
            "Continue" submits (fires 3a → the existing Confirm & pay screen). */}
        <div className="d-flex justify-content-between gap-2">
          <button
            type="button"
            className="btn btn-outline-secondary"
            onClick={goBack}
            disabled={step === 0 || submitting}
            hidden={step === 0}
          >
            ← Back
          </button>
          <div className="ms-auto">
            {step < LAST_STEP ? (
              <button type="button" className="btn bamboo-btn" onClick={goNext}>
                Next →
              </button>
            ) : (
              <button type="submit" className="btn bamboo-btn" disabled={submitting}>
                {submitting ? 'Uploading…' : 'Continue'}
              </button>
            )}
          </div>
        </div>
      </form>
    </main>
  );
}

export default SubmitEvent;
