// SubmitEvent — the public event submission form (plan §8). Self-contained view
// (PATTERN-SPEC §B4.2.2). Taxonomy options arrive as props (fetched SSR from the
// DB-backed /taxonomy endpoint — never hardcoded, plan §7).
//
// ROUND 3a: on submit this validates + uploads the image server-side and shows
// the returned "held" payload. Payment (Stripe Elements) is wired in 3b, so the
// button here reads "Continue" and the success panel stands in for the checkout
// step that will consume this payload next round.
import { useEffect, useState } from 'react';

import { submissionsService } from '@/core/services/submissions';
import CheckoutStep from './CheckoutStep';

// Mirror the server's image rules for fast client-side feedback (the server is
// still authoritative — submission_validation.py).
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_IMAGE_MB = 5;

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
  description: '',
  link: '',
  event_format: '',
  submission_type: '',
};

// datetime-local wants 'YYYY-MM-DDTHH:MM'; the re-submit prefill carries ISO.
const toLocalInput = (iso) => (iso ? String(iso).slice(0, 16) : '');

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
    venue_name: prefill.venue_name || '',
    venue_address: prefill.venue_address || '',
    country: prefill.country || '',
    city: prefill.city || '',
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
  const [honeypot, setHoneypot] = useState(''); // must stay empty for real users
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState([]);
  const [result, setResult] = useState(null); // 3a held payload (event + image)
  const [confirmation, setConfirmation] = useState(null); // 3b pending_review result

  const resetAll = () => {
    setResult(null);
    setConfirmation(null);
    setFields(EMPTY);
    setSelectedCategories([]);
    setImageFile(null);
  };

  const setField = (key) => (e) =>
    setFields((prev) => ({ ...prev, [key]: e.target.value }));

  const toggleCategory = (label) =>
    setSelectedCategories((prev) =>
      prev.includes(label) ? prev.filter((c) => c !== label) : [...prev, label],
    );

  const onFileChange = (e) => {
    const file = e.target.files?.[0] || null;
    setImageFile(file);
  };

  // Lightweight client-side pre-check so obvious problems surface without a
  // round-trip. Returns an array of messages (empty => ok).
  const clientValidate = () => {
    const msgs = [];
    if (!fields.name.trim()) msgs.push('Event name is required.');
    if (!fields.submitter_email.trim()) msgs.push('Submitter email is required.');
    if (!fields.start_datetime) msgs.push('Start date/time is required.');
    if (!fields.end_datetime) msgs.push('End date/time is required.');
    if (!fields.country.trim()) msgs.push('Country is required.');
    if (!fields.city.trim()) msgs.push('City is required.');
    if (!fields.event_format) msgs.push('Event format is required.');
    if (selectedCategories.length === 0)
      msgs.push('Select at least one drink category.');
    if (!imageFile) {
      msgs.push('An event image is required.');
    } else {
      if (!ALLOWED_IMAGE_TYPES.includes(imageFile.type))
        msgs.push('Image must be a JPEG, PNG, or WebP file.');
      if (imageFile.size > MAX_IMAGE_MB * 1024 * 1024)
        msgs.push(`Image is too large (max ${MAX_IMAGE_MB} MB).`);
    }
    return msgs;
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    setErrors([]);
    setResult(null);

    const clientErrors = clientValidate();
    if (clientErrors.length) {
      setErrors(clientErrors);
      return;
    }

    const formData = new FormData();
    Object.entries(fields).forEach(([k, v]) => formData.append(k, v));
    selectedCategories.forEach((c) => formData.append('drink_categories', c));
    formData.append('company_url', honeypot); // honeypot — server checks it
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

        <div className="mb-3">
          <label className="form-label" htmlFor="name">
            Event name <span className="text-danger">*</span>
          </label>
          <input
            id="name"
            className="form-control"
            value={fields.name}
            onChange={setField('name')}
            maxLength={500}
            required
          />
        </div>

        <div className="row">
          <div className="col-md-6 mb-3">
            <label className="form-label" htmlFor="submitter_email">
              Your email <span className="text-danger">*</span>
            </label>
            <input
              id="submitter_email"
              type="email"
              className="form-control"
              value={fields.submitter_email}
              onChange={setField('submitter_email')}
              required
            />
            <div className="form-text">Where we send review updates.</div>
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

        <div className="row">
          <div className="col-md-6 mb-3">
            <label className="form-label" htmlFor="start_datetime">
              Starts <span className="text-danger">*</span>
            </label>
            <input
              id="start_datetime"
              type="datetime-local"
              className="form-control"
              value={fields.start_datetime}
              onChange={setField('start_datetime')}
              required
            />
          </div>
          <div className="col-md-6 mb-3">
            <label className="form-label" htmlFor="end_datetime">
              Ends <span className="text-danger">*</span>
            </label>
            <input
              id="end_datetime"
              type="datetime-local"
              className="form-control"
              value={fields.end_datetime}
              onChange={setField('end_datetime')}
              required
            />
          </div>
        </div>

        <div className="mb-3">
          <label className="form-label" htmlFor="venue_name">
            Venue name
          </label>
          <input
            id="venue_name"
            className="form-control"
            value={fields.venue_name}
            onChange={setField('venue_name')}
            maxLength={500}
          />
        </div>

        <div className="mb-3">
          <label className="form-label" htmlFor="venue_address">
            Venue address
          </label>
          <input
            id="venue_address"
            className="form-control"
            value={fields.venue_address}
            onChange={setField('venue_address')}
          />
        </div>

        <div className="row">
          <div className="col-md-6 mb-3">
            <label className="form-label" htmlFor="country">
              Country <span className="text-danger">*</span>
            </label>
            <input
              id="country"
              className="form-control"
              value={fields.country}
              onChange={setField('country')}
              required
            />
          </div>
          <div className="col-md-6 mb-3">
            <label className="form-label" htmlFor="city">
              City <span className="text-danger">*</span>
            </label>
            <input
              id="city"
              className="form-control"
              value={fields.city}
              onChange={setField('city')}
              required
            />
          </div>
        </div>

        <div className="mb-3">
          <label className="form-label" htmlFor="event_format">
            Event format <span className="text-danger">*</span>
          </label>
          <select
            id="event_format"
            className="form-select"
            value={fields.event_format}
            onChange={setField('event_format')}
            required
          >
            <option value="">Choose…</option>
            {eventFormats.map((f) => (
              <option key={f.id} value={f.label}>
                {f.label}
              </option>
            ))}
          </select>
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
          <input
            id="submission_type"
            className="form-control"
            value={fields.submission_type}
            onChange={setField('submission_type')}
            placeholder="e.g. bar, brand, agency"
            maxLength={255}
          />
        </div>

        <div className="mb-4">
          <label className="form-label" htmlFor="image">
            Event image <span className="text-danger">*</span>
          </label>
          <input
            id="image"
            type="file"
            className="form-control"
            accept="image/jpeg,image/png,image/webp"
            onChange={onFileChange}
          />
          <div className="form-text">JPEG, PNG, or WebP, up to {MAX_IMAGE_MB} MB.</div>
        </div>

        <button type="submit" className="btn bamboo-btn" disabled={submitting}>
          {submitting ? 'Uploading…' : 'Continue'}
        </button>
      </form>
    </main>
  );
}

export default SubmitEvent;
