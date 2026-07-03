// EventDetail — the public single-event view (plan §8). Self-contained view. The
// SEO machinery (<title>, meta, JSON-LD, canonical) lives in the page's <Head>
// (pages/[slug].js); this component is the visible content only.
//
// A past-dated but still-published event stays live and is clearly badged "This
// event is over" (plan §8) — computed from end_datetime, NOT from the internal
// current_status='expired' (which is never public).
import Link from 'next/link';

import { formatDateRange, isPastEvent } from '../publicFormat';

function EventDetail({ event }) {
  if (!event) return null;
  const past = isPastEvent(event);
  const categories = event.drink_categories || [];
  const where = [event.venue_name, event.venue_address, event.city, event.country]
    .filter(Boolean)
    .join(', ');

  return (
    <main className="container py-5" style={{ maxWidth: 860 }}>
      <p className="mb-3">
        <Link href="/" className="text-decoration-none">&larr; All events</Link>
      </p>

      {past && (
        <div className="alert alert-secondary" role="status">
          This event is over. It stays listed for reference.
        </div>
      )}

      <h1 className="tw-text-custom-green" style={{ fontFamily: 'Sora, sans-serif' }}>
        {event.name}
      </h1>

      <div className="d-flex flex-wrap gap-1 mb-3">
        {event.event_format && (
          <span className="badge bg-success-subtle text-success-emphasis">
            {event.event_format}
          </span>
        )}
        {categories.map((c) => (
          <span key={c} className="badge bg-light text-dark">{c}</span>
        ))}
      </div>

      {event.image_url && (
        <img
          src={event.image_url}
          alt={event.name}
          className="img-fluid rounded mb-4 w-100"
          style={{ maxHeight: 420, objectFit: 'cover' }}
        />
      )}

      <dl className="row">
        <dt className="col-sm-3">When</dt>
        <dd className="col-sm-9">
          {formatDateRange(event.start_datetime, event.end_datetime)}
        </dd>

        {where && (
          <>
            <dt className="col-sm-3">Where</dt>
            <dd className="col-sm-9">{where}</dd>
          </>
        )}

        {event.contact_email && (
          <>
            <dt className="col-sm-3">Contact</dt>
            <dd className="col-sm-9">
              <a href={`mailto:${event.contact_email}`}>{event.contact_email}</a>
            </dd>
          </>
        )}
      </dl>

      {event.description && (
        <div className="mb-4" style={{ whiteSpace: 'pre-wrap' }}>
          {event.description}
        </div>
      )}

      {event.link && (
        <p>
          <a
            href={event.link}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="btn btn-outline-success"
          >
            Visit event website
          </a>
        </p>
      )}

      <hr className="my-4" />
      <p className="text-muted small">
        Are you the organiser?{' '}
        <Link href={`/manage?slug=${encodeURIComponent(event.slug)}`}>
          Request an edit link
        </Link>{' '}
        to update this listing.
      </p>
    </main>
  );
}

export default EventDetail;
