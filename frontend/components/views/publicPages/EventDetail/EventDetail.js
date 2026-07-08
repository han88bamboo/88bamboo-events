// EventDetail — the public single-event view (plan §8). Self-contained view. The
// SEO machinery (<title>, meta, JSON-LD, canonical) lives in the page's <Head>
// (pages/[slug].js); this component is the visible content only.
//
// A past-dated but still-published event stays live and is clearly badged "This
// event is over" (plan §8) — computed from end_datetime, NOT from the internal
// current_status='expired' (which is never public).
import Link from 'next/link';
import { useState } from 'react';

import { isPastEvent } from '../publicFormat';
import { EventCard } from '../EventListing/EventListing';
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

// "See more" collapse threshold (SPP-D9, owner: 800 chars). Only an exceptionally
// long description collapses; at/under this length the whole description + map
// render in full with no fade. The collapse is VISUAL (a clipped, faded region),
// not a character-level truncation, so it wraps the description AND the map below.
const DESCRIPTION_COLLAPSE_LENGTH = 800;

function EventDetail({ event, related = [] }) {
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
    event.postcode,
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
  // Collapse only an exceptionally long description (SPP-D9): the description+map
  // block clips behind a faded, clickable "See more" region; short ones show in
  // full with the map and no fade.
  const isLong = (event.description || '').length > DESCRIPTION_COLLAPSE_LENGTH;
  // Client-only toggle. Starts collapsed on both server and client so the first
  // client render matches the SSR markup exactly — no hydration mismatch.
  const [expanded, setExpanded] = useState(false);
  const collapsed = isLong && !expanded;
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
          {/* Article-like title: Buenard ~32px desktop / ~26px mobile (Decision 2).
              Now ABOVE the image (owner revision, SPP-D7 — reverses SPP-D2). */}
          <h1 className="article-title mb-3">{event.name}</h1>

          {event.image_url && (
            // Hero image, kept capped rather than a full-bleed banner (banner =
            // theme, excluded). Sits BELOW the title now (SPP-D7).
            <img
              src={event.image_url}
              alt={event.name}
              className="img-fluid rounded mb-4 d-block mx-auto"
              style={{ maxWidth: 600, width: '100%', objectFit: 'cover' }}
            />
          )}

          <div className="d-flex flex-wrap gap-1 mb-3">
            {event.event_format && <span className="badge-bamboo">{event.event_format}</span>}
            {categories.map((c) => (
              <span key={c} className="badge-bamboo badge-bamboo--muted">{c}</span>
            ))}
          </div>

          {/* Mobile-only summary: on <lg the sticky column is hidden, so the facts
              stack here right under the title/badges. */}
          <EventSummaryCard {...summaryProps} className="d-lg-none mb-4" />

          {/* Description + map as ONE block (SPP-D8): the map sits directly below
              the description words. When the description is exceptionally long
              (> DESCRIPTION_COLLAPSE_LENGTH) the whole block clips behind a faded,
              full-width "See more" region that reveals the rest of the copy AND the
              map on click (SPP-D9); shorter descriptions show everything, no fade. */}
          {(paragraphs.length > 0 || mapSrc) && (
            <div className="mb-4">
              <div
                className={`bamboo-collapsible${collapsed ? ' bamboo-collapsible--collapsed' : ''}`}
              >
                {paragraphs.length > 0 && (
                  // Each newline-separated fragment is its own <p> (P1); the
                  // paragraph gap now comes from a scoped .bamboo-prose p rule
                  // (Tailwind Preflight had zeroed the default margin — SPP-D10).
                  <div className="bamboo-prose">
                    {paragraphs.map((para, i) => (
                      // eslint-disable-next-line react/no-array-index-key
                      <p key={i}>{para}</p>
                    ))}
                  </div>
                )}

                {/* Location map (A1): a keyless Google embed placing the event by
                    its address string, plus a "Get directions" link. Only shown
                    when we have an address. EP-2 upgrades this to an exact pin from
                    stored coords. */}
                {mapSrc && (
                  <div className="mt-4">
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

                {collapsed && (
                  // The faded region itself is the click target (SPP-D9) — not a
                  // tiny button; clicking reveals the rest of the copy + the map.
                  <button
                    type="button"
                    className="bamboo-collapsible__more"
                    onClick={() => setExpanded(true)}
                  >
                    See more
                  </button>
                )}
              </div>
              {isLong && expanded && (
                <button
                  type="button"
                  className="btn btn-link btn-sm p-0 small text-decoration-none mt-2"
                  onClick={() => setExpanded(false)}
                >
                  See less
                </button>
              )}
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
          <div className="position-sticky" style={{ top: '6rem' }}>
            <EventSummaryCard {...summaryProps} />
          </div>
        </div>
      </div>

      {/* "More events" related row (SP-2 / R1) — reuses the listing's grid
          EventCard so it's byte-for-byte the same card, no theme change. Placed
          before the organiser edit-link footer, and hidden entirely when the SSR
          fetch returned nothing (empty or failed → related=[]). */}
      {related.length > 0 && (
        <section className="mt-5">
          <h2 className="article-title h4 mb-3">More events</h2>
          <div className="row">
            {related.map((e) => (
              <EventCard key={e.event_id} event={e} view="grid" />
            ))}
          </div>
        </section>
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
