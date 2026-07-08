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
  // The per-date schedule (EP-6). A legacy event has no occurrence rows — imply a
  // single occurrence from the scalar summary (E-D2, no backfill), so this renders
  // identically to before for every existing event.
  const occurrences =
    event.occurrences && event.occurrences.length
      ? event.occurrences
      : [{ start: event.start_datetime, end: event.end_datetime }];
  const multiDate = occurrences.length > 1;
  const where = [
    event.venue_name,
    event.venue_address,
    event.city,
    event.region,
    event.country,
  ]
    .filter(Boolean)
    .join(', ');
  // Prefer an EXACT PIN from the stored coordinates (EP-2): the address was
  // Google-validated at submit, so `lat,lng` places the marker precisely. Legacy
  // events (no coordinates) fall back to the EP-1 address-string query, which drops
  // the venue NAME (a name alone geocodes poorly). Either way the embed is keyless
  // (`output=embed`) — no Google API key needed on the detail page.
  const hasCoords = event.latitude != null && event.longitude != null;
  const coordQuery = hasCoords ? `${event.latitude},${event.longitude}` : null;
  const addressQuery = [event.venue_address, event.city, event.region, event.country]
    .filter(Boolean)
    .join(', ');
  const mapQuery = coordQuery || addressQuery;
  const mapSrc = mapQuery
    ? `https://www.google.com/maps?q=${encodeURIComponent(mapQuery)}&output=embed`
    : null;
  // Directions to the exact coordinates when we have them, pinned to the Google
  // place_id for accuracy; else to the address string.
  const directionsUrl = mapQuery
    ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(mapQuery)}${
        hasCoords && event.place_id
          ? `&destination_place_id=${encodeURIComponent(event.place_id)}`
          : ''
      }`
    : null;

  return (
    <main className="article-measure py-5">
      <p className="mb-3">
        <Link href="/" className="text-decoration-none">&larr; All events</Link>
      </p>

      {past && (
        <div className="alert alert-secondary" role="status">
          This event is over. It stays listed for reference.
        </div>
      )}

      {/* Article-like title: Buenard ~32px desktop / ~26px mobile (Decision 2). */}
      <h1 className="article-title mb-3">{event.name}</h1>

      <div className="d-flex flex-wrap gap-1 mb-3">
        {event.event_format && <span className="badge-bamboo">{event.event_format}</span>}
        {categories.map((c) => (
          <span key={c} className="badge-bamboo badge-bamboo--muted">{c}</span>
        ))}
      </div>

      {event.image_url && (
        // Centered featured image, capped like the storefront article treatment
        // (reference §12) rather than a full-bleed banner.
        <img
          src={event.image_url}
          alt={event.name}
          className="img-fluid rounded mb-4 d-block mx-auto"
          style={{ maxWidth: 600, width: '100%', objectFit: 'cover' }}
        />
      )}

      <dl className="row">
        <dt className="col-sm-3">When</dt>
        <dd className="col-sm-9">
          {multiDate ? (
            <>
              <span className="d-block fw-semibold">{occurrences.length} dates</span>
              <ul className="list-unstyled mb-1">
                {occurrences.map((o, i) => (
                  // Schedule rows are order-stable (server-sorted, no reorder).
                  // eslint-disable-next-line react/no-array-index-key
                  <li key={i}>{formatDateRange(o.start, o.end)}</li>
                ))}
              </ul>
            </>
          ) : (
            formatDateRange(occurrences[0].start, occurrences[0].end)
          )}
          <span className="d-block text-muted small">Local time at the event location.</span>
        </dd>

        {where && (
          <>
            <dt className="col-sm-3">Where</dt>
            <dd className="col-sm-9">{where}</dd>
          </>
        )}

        {/* Public organiser name (EP-7). Only for events that set one; legacy
            events omit the row entirely (no backfill, F-D6). */}
        {event.organiser_name && (
          <>
            <dt className="col-sm-3">Organised by</dt>
            <dd className="col-sm-9">{event.organiser_name}</dd>
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

      {/* Location map (A1): a keyless Google embed placing the event by its address
          string, plus a "Get directions" link. Only shown when we have an address
          to place. EP-2 upgrades this to an exact pin from stored coordinates. */}
      {mapSrc && (
        <div className="mb-4">
          <div className="ratio ratio-16x9 rounded overflow-hidden border">
            <iframe
              title={`Map showing ${event.venue_name || where}`}
              src={mapSrc}
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              style={{ border: 0 }}
              allowFullScreen
            />
          </div>
          <p className="mt-2 mb-0">
            <a href={directionsUrl} target="_blank" rel="noopener noreferrer">
              Get directions ↗
            </a>
          </p>
        </div>
      )}

      {event.description && (
        <div className="bamboo-prose mb-4" style={{ whiteSpace: 'pre-wrap' }}>
          {event.description}
        </div>
      )}

      {event.link && (
        <p>
          <a
            href={event.link}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="btn bamboo-btn bamboo-btn--secondary"
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
