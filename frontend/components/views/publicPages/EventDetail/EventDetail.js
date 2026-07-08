// EventDetail — the public single-event view (plan §8). Self-contained view. The
// SEO machinery (<title>, meta, JSON-LD, canonical) lives in the page's <Head>
// (pages/[slug].js); this component is the visible content only.
//
// A past-dated but still-published event stays live and is clearly badged "This
// event is over" (plan §8) — computed from end_datetime, NOT from the internal
// current_status='expired' (which is never public).
import Link from 'next/link';

import { isPastEvent } from '../publicFormat';
import EventSummaryCard from './EventSummaryCard';

// Split a plain-text description into paragraphs (SP-1 / P1). Every newline (single
// OR double) starts a new paragraph, so a submitter's single return renders as a
// neatly-spaced <p> without needing a blank line. Empty fragments are dropped.
function toParagraphs(text) {
  return (text || '')
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
}

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

  const paragraphs = toParagraphs(event.description);
  // Shared props for the summary/CTA card, rendered twice: inline on mobile and in
  // the sticky right column on desktop (SP-1, mirroring ManageEvent's MessagesPanel).
  const summaryProps = { event, occurrences, multiDate, where };

  return (
    // Two-column body reusing the ManageEvent recipe: a widened Bootstrap container
    // + row, content in col-lg-8, an at-a-glance summary/CTA in a sticky col-lg-4.
    // On mobile the row collapses to one column and the summary renders inline.
    <main className="container py-5" style={{ maxWidth: 1140 }}>
      <p className="mb-3">
        <Link href="/" className="text-decoration-none">&larr; All events</Link>
      </p>

      {past && (
        <div className="alert alert-secondary" role="status">
          This event is over. It stays listed for reference.
        </div>
      )}

      <div className="row g-4">
        <div className="col-lg-8">
          {event.image_url && (
            // Featured image ABOVE the title (Eventbrite-faithful order, SPP-D2),
            // kept capped rather than a full-bleed banner (banner = theme, excluded).
            <img
              src={event.image_url}
              alt={event.name}
              className="img-fluid rounded mb-4 d-block mx-auto"
              style={{ maxWidth: 600, width: '100%', objectFit: 'cover' }}
            />
          )}

          {/* Article-like title: Buenard ~32px desktop / ~26px mobile (Decision 2). */}
          <h1 className="article-title mb-3">{event.name}</h1>

          <div className="d-flex flex-wrap gap-1 mb-3">
            {event.event_format && <span className="badge-bamboo">{event.event_format}</span>}
            {categories.map((c) => (
              <span key={c} className="badge-bamboo badge-bamboo--muted">{c}</span>
            ))}
          </div>

          {/* Mobile-only summary: on <lg the sticky column is hidden, so the facts
              stack here right under the title/badges. */}
          <EventSummaryCard {...summaryProps} className="d-lg-none mb-4" />

          {/* Location map (A1): a keyless Google embed placing the event by its
              address string, plus a "Get directions" link. Only shown when we have
              an address. EP-2 upgrades this to an exact pin from stored coords. */}
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

          {paragraphs.length > 0 && (
            // Each newline-separated fragment is its own <p> (P1) so a single return
            // reads as a spaced paragraph — natural rhythm from the default <p>
            // margin, no themed styling.
            <div className="bamboo-prose mb-4">
              {paragraphs.map((para, i) => (
                // eslint-disable-next-line react/no-array-index-key
                <p key={i}>{para}</p>
              ))}
            </div>
          )}

          {/* Bottom CTA preserved alongside the one in the summary card (SPP-D4). */}
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
        </div>

        {/* Desktop: sticky summary/CTA column (hidden on mobile — rendered inline
            above instead). */}
        <div className="col-lg-4 d-none d-lg-block">
          <div className="position-sticky" style={{ top: '1rem' }}>
            <EventSummaryCard {...summaryProps} />
          </div>
        </div>
      </div>

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
