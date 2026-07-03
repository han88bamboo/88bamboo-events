// EventListing — the public listing page view (plan §8). Self-contained view
// (PATTERN-SPEC §B4.2.2). Grid + list views, keyword search, filters (date range,
// drink category, event format, country, city), an upcoming/past toggle with past
// events muted + badged, a manual country selector that surfaces that country's
// events first, and soonest-first sort.
//
// Data: the FIRST page is fetched SSR (initialEvents, from the query params) so
// the page is crawlable and fast; subsequent filter changes refetch client-side
// via eventsService.getListing. Taxonomy + country options arrive as props.
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

import { eventsService } from '@/core/services/events';
import { BASE_PATH } from '@/core/utils/seo';
import { formatDateRange, isPastEvent } from '../publicFormat';

const WHEN_OPTIONS = [
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'past', label: 'Past' },
  { value: 'all', label: 'All' },
];

// Build the query object sent to the backend from the current filter state,
// dropping empty values (apiClient also drops null/undefined).
function buildParams(f) {
  const p = {};
  if (f.q.trim()) p.q = f.q.trim();
  if (f.category) p.category = f.category;
  if (f.format) p.format = f.format;
  if (f.country) p.country = f.country;
  if (f.city.trim()) p.city = f.city.trim();
  if (f.date_from) p.date_from = f.date_from;
  if (f.date_to) p.date_to = f.date_to;
  if (f.when) p.when = f.when;
  if (f.preferred_country) p.preferred_country = f.preferred_country;
  return p;
}

function EventCard({ event, view }) {
  const past = isPastEvent(event);
  const href = `/${event.slug}`; // basePath '/a/events' is prepended by next/link
  const categories = event.drink_categories || [];

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

  // grid card
  return (
    <div className="col-sm-6 col-lg-4 mb-4">
      <Link href={href} className="text-decoration-none text-reset">
        <div className={`card h-100 shadow-sm ${past ? 'opacity-75' : ''}`}>
          {event.image_url && (
            <img
              src={event.image_url}
              alt=""
              className="card-img-top"
              style={{ height: 180, objectFit: 'cover' }}
            />
          )}
          <div className="card-body d-flex flex-column">
            {past && (
              <span className="badge bg-secondary align-self-start mb-2">
                This event is over
              </span>
            )}
            <h5 className="card-title">{event.name}</h5>
            <p className="card-text small text-muted mb-1">
              {formatDateRange(event.start_datetime, event.end_datetime)}
            </p>
            <p className="card-text small text-muted mb-2">
              {[event.venue_name, event.city, event.country].filter(Boolean).join(' · ')}
            </p>
            <div className="mt-auto d-flex flex-wrap gap-1">
              {event.event_format && (
                <span className="badge bg-success-subtle text-success-emphasis">
                  {event.event_format}
                </span>
              )}
              {categories.slice(0, 3).map((c) => (
                <span key={c} className="badge bg-light text-dark">
                  {c}
                </span>
              ))}
            </div>
          </div>
        </div>
      </Link>
    </div>
  );
}

function EventListing({ initialEvents = [], taxonomy, countries = [], initialFilters }) {
  const drinkCategories = taxonomy?.drink_categories || [];
  const eventFormats = taxonomy?.event_formats || [];

  const [filters, setFilters] = useState({
    q: '',
    category: '',
    format: '',
    country: '',
    city: '',
    date_from: '',
    date_to: '',
    when: 'upcoming',
    preferred_country: '',
    ...(initialFilters || {}),
  });
  const [events, setEvents] = useState(initialEvents);
  const [view, setView] = useState('grid');
  const [loading, setLoading] = useState(false);

  // Skip the very first fetch: the SSR initialEvents already reflect the initial
  // filters, so refetching on mount would just repeat that request.
  const firstRun = useRef(true);

  const refetch = useCallback(async (f) => {
    setLoading(true);
    try {
      const rows = await eventsService.getListing(buildParams(f));
      setEvents(rows);
    } finally {
      setLoading(false);
    }
  }, []);

  // Debounced refetch whenever a filter changes (keyword typing included).
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    const t = setTimeout(() => refetch(filters), 300);
    return () => clearTimeout(t);
  }, [filters, refetch]);

  const set = (key) => (e) =>
    setFilters((prev) => ({ ...prev, [key]: e.target.value }));

  return (
    <main className="container py-5">
      <div className="d-flex flex-wrap justify-content-between align-items-center mb-3 gap-2">
        <h1 className="tw-text-custom-green mb-0" style={{ fontFamily: 'Sora, sans-serif' }}>
          Drinks &amp; hospitality events
        </h1>
        <Link href="/submit" className="btn btn-success">
          List an event
        </Link>
      </div>

      {/* Keyword search */}
      <div className="mb-3">
        <input
          type="search"
          className="form-control form-control-lg"
          placeholder="Search events, venues, keywords…"
          value={filters.q}
          onChange={set('q')}
          aria-label="Search events"
        />
      </div>

      {/* Filters */}
      <div className="row g-2 mb-3">
        <div className="col-6 col-md-3">
          <label className="form-label small mb-1">Show</label>
          <select className="form-select" value={filters.when} onChange={set('when')}>
            {WHEN_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <div className="col-6 col-md-3">
          <label className="form-label small mb-1">Prioritise country</label>
          <select
            className="form-select"
            value={filters.preferred_country}
            onChange={set('preferred_country')}
            aria-label="Manual country selector"
          >
            <option value="">Anywhere</option>
            {countries.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        <div className="col-6 col-md-3">
          <label className="form-label small mb-1">Category</label>
          <select className="form-select" value={filters.category} onChange={set('category')}>
            <option value="">All categories</option>
            {drinkCategories.map((c) => (
              <option key={c.id} value={c.label}>{c.label}</option>
            ))}
          </select>
        </div>
        <div className="col-6 col-md-3">
          <label className="form-label small mb-1">Format</label>
          <select className="form-select" value={filters.format} onChange={set('format')}>
            <option value="">All formats</option>
            {eventFormats.map((f) => (
              <option key={f.id} value={f.label}>{f.label}</option>
            ))}
          </select>
        </div>
        <div className="col-6 col-md-3">
          <label className="form-label small mb-1">Country</label>
          <select className="form-select" value={filters.country} onChange={set('country')}>
            <option value="">All countries</option>
            {countries.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        <div className="col-6 col-md-3">
          <label className="form-label small mb-1">City</label>
          <input className="form-control" value={filters.city} onChange={set('city')} placeholder="Any city" />
        </div>
        <div className="col-6 col-md-3">
          <label className="form-label small mb-1">From</label>
          <input type="date" className="form-control" value={filters.date_from} onChange={set('date_from')} />
        </div>
        <div className="col-6 col-md-3">
          <label className="form-label small mb-1">To</label>
          <input type="date" className="form-control" value={filters.date_to} onChange={set('date_to')} />
        </div>
      </div>

      {/* Result count + view toggle */}
      <div className="d-flex justify-content-between align-items-center mb-3">
        <span className="text-muted small">
          {loading ? 'Loading…' : `${events.length} event${events.length === 1 ? '' : 's'}`}
        </span>
        <div className="btn-group" role="group" aria-label="View mode">
          <button
            type="button"
            className={`btn btn-sm ${view === 'grid' ? 'btn-success' : 'btn-outline-success'}`}
            onClick={() => setView('grid')}
          >
            Grid
          </button>
          <button
            type="button"
            className={`btn btn-sm ${view === 'list' ? 'btn-success' : 'btn-outline-success'}`}
            onClick={() => setView('list')}
          >
            List
          </button>
        </div>
      </div>

      {/* Results */}
      {events.length === 0 && !loading ? (
        <div className="alert alert-light border text-center py-5">
          No events match your filters yet. Try widening your search.
        </div>
      ) : view === 'grid' ? (
        <div className="row">
          {events.map((e) => (
            <EventCard key={e.event_id} event={e} view="grid" />
          ))}
        </div>
      ) : (
        <div className="list-group">
          {events.map((e) => (
            <EventCard key={e.event_id} event={e} view="list" />
          ))}
        </div>
      )}

      <p className="text-muted small mt-4">
        Public listings live at{' '}
        <code>{BASE_PATH}/&lt;event&gt;</code>. Organisers can update a listing via
        the edit link emailed to them.
      </p>
    </main>
  );
}

export default EventListing;
