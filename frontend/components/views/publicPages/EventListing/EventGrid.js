// EventGrid / EventCard — the shared public event card + grid, extracted from
// EventListing.js so the listing page AND the Explore SEO pages (EXPLORE-LAYER-PLAN §6)
// render the exact same cards instead of duplicating them. MOVED verbatim from
// EventListing.js (no visual change): the card markup, its excerpt helper, and the
// word-boundary truncation are unchanged — EventListing.js and EventDetail.js re-import
// EventCard/truncateAtWordBoundary from here.
import Link from 'next/link';

import { formatDateRange, isPastEvent } from '../publicFormat';

// Cut `text` to at most `maxLen` chars on a word boundary, with an ellipsis.
// Shared by the card excerpt below and the detail page's "Read more" truncation
// (EventDetail.js) so both trim text the same way.
export function truncateAtWordBoundary(text, maxLen) {
  if (text.length <= maxLen) return text;
  const cut = text.slice(0, maxLen);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > maxLen / 2 ? cut.slice(0, lastSpace) : cut).trim()}…`;
}

// Short editorial excerpt for a card: first ~120 chars of the description, on a
// word boundary, with an ellipsis. Empty when there's no description (the card
// falls back to the date/place lines).
function excerptOf(event) {
  const d = (event.description || '').trim().replace(/\s+/g, ' ');
  if (!d) return '';
  return truncateAtWordBoundary(d, 120);
}

// Exported so the detail page's "More events" row (SP-2) and the Explore grid can reuse
// the exact same card rather than duplicating it — it only needs fields already in
// _PUBLIC_COLUMNS.
export function EventCard({ event, view }) {
  const past = isPastEvent(event);
  const href = `/${event.slug}`; // basePath '/a/events' is prepended by next/link

  if (view === 'list') {
    return (
      <Link
        href={href}
        className={`list-group-item list-group-item-action d-flex gap-3 align-items-center ${past ? 'opacity-75' : ''}`}
      >
        {event.image_url && (
          <img
            src={event.image_url}
            alt=""
            style={{ width: 88, height: 66, objectFit: 'cover' }}
            className="rounded flex-shrink-0"
          />
        )}
        <div className="flex-grow-1">
          <div className="d-flex align-items-center gap-2">
            <h6 className="mb-0">{event.name}</h6>
            {past && <span className="badge bg-secondary">This event is over</span>}
          </div>
          <div className="small text-muted">
            {formatDateRange(event.start_datetime, event.end_datetime)}
            {/* Multi-date hint (EP-6): the card shows the full first→last range plus
                an "N dates" count; the feed carries only the summary + count. */}
            {event.occurrence_count > 1 && ` · ${event.occurrence_count} dates`}
          </div>
          <div className="small text-muted">
            {[event.venue_name, event.city, event.country].filter(Boolean).join(' · ')}
          </div>
        </div>
        {event.event_format && (
          <span className="badge bg-light text-dark align-self-start">
            {event.event_format}
          </span>
        )}
      </Link>
    );
  }

  // grid card — editorial article-card shell (STYLE-PARITY-PLAN §8, reference §11):
  // native-ratio-cover image on top, Buenard title, muted date/place, short
  // excerpt, and a tertiary "View event" pill; light format/past badges for scan.
  const place = [event.venue_name, event.city, event.country].filter(Boolean).join(' · ');
  return (
    <div className="col-sm-6 col-lg-4 mb-4">
      <Link href={href} className="text-decoration-none text-reset d-block h-100">
        <article className={`event-card ${past ? 'opacity-75' : ''}`}>
          <div className="event-card__imgwrap">
            {event.image_url && (
              <img src={event.image_url} alt="" className="event-card__img" />
            )}
          </div>
          <div className="event-card__body">
            <div className="d-flex flex-wrap gap-1 mb-2">
              {past && <span className="badge-bamboo badge-bamboo--muted">This event is over</span>}
              {event.event_format && <span className="badge-bamboo">{event.event_format}</span>}
            </div>
            <h3 className="event-card__title">{event.name}</h3>
            <div className="event-card__date">
              {formatDateRange(event.start_datetime, event.end_datetime)}
              {event.occurrence_count > 1 && ` · ${event.occurrence_count} dates`}
            </div>
            {place && <div className="event-card__place">{place}</div>}
            {excerptOf(event) && <p className="event-card__excerpt">{excerptOf(event)}</p>}
            <span className="bamboo-btn bamboo-btn--tertiary bamboo-btn--small mt-auto align-self-start">
              View event
            </span>
          </div>
        </article>
      </Link>
    </div>
  );
}

// EventGrid — render a list of events as either the responsive grid of cards
// (view='grid', the default) or a stacked list-group (view='list'). This is the
// exact grid/list markup EventListing rendered inline; the Explore pages reuse it.
function EventGrid({ events = [], view = 'grid' }) {
  if (view === 'list') {
    return (
      <div className="list-group">
        {events.map((e) => (
          <EventCard key={e.event_id} event={e} view="list" />
        ))}
      </div>
    );
  }
  return (
    <div className="row">
      {events.map((e) => (
        <EventCard key={e.event_id} event={e} view="grid" />
      ))}
    </div>
  );
}

export default EventGrid;
