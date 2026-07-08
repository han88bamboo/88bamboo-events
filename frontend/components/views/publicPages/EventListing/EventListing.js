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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { eventsService } from '@/core/services/events';
import { BASE_PATH } from '@/core/utils/seo';
import { formatDateRange, isPastEvent } from '../publicFormat';

const WHEN_OPTIONS = [
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'past', label: 'Past' },
  { value: 'all', label: 'All' },
];

// --- Calendar helpers -------------------------------------------------------
// Every date operation here reads UTC fields (getUTC*, Date.UTC, timeZone:'UTC')
// so a calendar day matches the wall-clock day the organiser entered — the same
// UTC pinning publicFormat.js uses to avoid a locale/timezone hydration mismatch.
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MAX_CHIPS = 2; // event chips shown per day cell before a "+N more"

// 'YYYY-MM-DD' bucket key for an event's start, in UTC. Zero-padded so plain
// string comparison (cell.key < todayKey) is also chronological order.
function utcDayKey(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// The month (1st, UTC) to open the calendar on: the soonest UPCOMING event's
// month if there is one, else the current month — so a sparse board doesn't
// open on an empty page.
function initialMonth(events) {
  const now = Date.now();
  let best = null;
  for (const e of events) {
    const t = new Date(e.start_datetime).getTime();
    if (!Number.isNaN(t) && t >= now && (best === null || t < best)) best = t;
  }
  const d = best !== null ? new Date(best) : new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

// Cells for a Monday-start month grid: leading/trailing nulls pad to full weeks.
function buildMonthGrid(cursor) {
  const y = cursor.getUTCFullYear();
  const m = cursor.getUTCMonth();
  const daysInMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const firstDow = (new Date(Date.UTC(y, m, 1)).getUTCDay() + 6) % 7; // Mon=0
  const cells = [];
  for (let i = 0; i < firstDow; i += 1) cells.push(null);
  for (let d = 1; d <= daysInMonth; d += 1) {
    cells.push({ d, key: `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}` });
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function monthLabel(cursor) {
  return cursor.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

// Human day heading from a 'YYYY-MM-DD' key, pinned to UTC to match the buckets.
function formatDayHeading(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC',
  });
}

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

// Short editorial excerpt for a card: first ~120 chars of the description, on a
// word boundary, with an ellipsis. Empty when there's no description (the card
// falls back to the date/place lines).
function excerptOf(event) {
  const d = (event.description || '').trim().replace(/\s+/g, ' ');
  if (!d) return '';
  if (d.length <= 120) return d;
  const cut = d.slice(0, 120);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > 60 ? cut.slice(0, lastSpace) : cut).trim()}…`;
}

// Exported so the detail page's "More events" row (SP-2) can reuse the exact same
// card rather than duplicating it — it only needs fields already in _PUBLIC_COLUMNS.
export function EventCard({ event, view }) {
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

// MonthCalendar — the third view (plan §8 calendar view). Client-only (the parent
// only renders it when view==='calendar', which is client state), so the "today"
// highlight and Date.now() reads never run during SSR — no hydration mismatch.
// Events arrive already filtered by the parent (which fetches with when='all' in
// calendar mode); this component only buckets them by UTC day and lays out the grid.
function MonthCalendar({ events }) {
  // Opened once from the events present when the user first switches to calendar;
  // navigation then drives it. initialMonth uses the soonest upcoming event.
  const [cursor, setCursor] = useState(() => initialMonth(events));
  const [openDay, setOpenDay] = useState(null); // 'YYYY-MM-DD' expanded via "+N more"

  // Bucket events by UTC start day, soonest-first within each day.
  const byDay = useMemo(() => {
    const map = new Map();
    for (const e of events) {
      const k = utcDayKey(e.start_datetime);
      if (!k) continue;
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(e);
    }
    for (const list of map.values()) {
      list.sort((a, b) => new Date(a.start_datetime) - new Date(b.start_datetime));
    }
    return map;
  }, [events]);

  const y = cursor.getUTCFullYear();
  const m = cursor.getUTCMonth();
  const cells = useMemo(() => buildMonthGrid(cursor), [cursor]);
  const todayKey = utcDayKey(Date.now());
  const monthPrefix = `${y}-${String(m + 1).padStart(2, '0')}-`;

  // Days in the visible month that have events (mobile agenda + empty-state).
  const monthKeys = useMemo(
    () => [...byDay.keys()].filter((k) => k.startsWith(monthPrefix)).sort(),
    [byDay, monthPrefix],
  );

  const goPrev = () => { setOpenDay(null); setCursor(new Date(Date.UTC(y, m - 1, 1))); };
  const goNext = () => { setOpenDay(null); setCursor(new Date(Date.UTC(y, m + 1, 1))); };
  const goToday = () => {
    setOpenDay(null);
    const n = new Date();
    setCursor(new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), 1)));
  };

  const openList = openDay ? (byDay.get(openDay) || []) : [];

  return (
    <div>
      {/* Month navigation */}
      <div className="d-flex justify-content-between align-items-center mb-3">
        <button
          type="button"
          className="btn btn-sm btn-outline-secondary"
          onClick={goPrev}
          aria-label="Previous month"
        >
          ‹
        </button>
        <div className="d-flex align-items-center gap-2">
          <h5 className="mb-0" style={{ fontFamily: 'Buenard, Georgia, "Times New Roman", serif' }}>{monthLabel(cursor)}</h5>
          <button type="button" className="btn btn-sm btn-link text-decoration-none p-0" onClick={goToday}>
            Today
          </button>
        </div>
        <button
          type="button"
          className="btn btn-sm btn-outline-secondary"
          onClick={goNext}
          aria-label="Next month"
        >
          ›
        </button>
      </div>

      {/* Desktop month grid */}
      <div className="d-none d-md-block">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
          {WEEKDAYS.map((w) => (
            <div key={w} className="text-center small text-muted fw-semibold pb-1">{w}</div>
          ))}
          {cells.map((cell, i) => {
            if (!cell) {
              // eslint-disable-next-line react/no-array-index-key
              return <div key={`blank-${i}`} style={{ minHeight: 96 }} className="bg-light-subtle rounded" />;
            }
            const list = byDay.get(cell.key) || [];
            const isToday = cell.key === todayKey;
            const isPast = todayKey && cell.key < todayKey;
            return (
              <div
                key={cell.key}
                className={`border rounded p-1 ${isToday ? 'border-success border-2' : ''} ${isPast ? 'opacity-75' : ''}`}
                style={{ minHeight: 96 }}
              >
                <div className={`small fw-semibold ${isToday ? 'text-success' : 'text-muted'}`}>{cell.d}</div>
                {list.slice(0, MAX_CHIPS).map((e) => (
                  <Link
                    key={e.event_id}
                    href={`/${e.slug}`}
                    title={e.name}
                    className="d-block text-truncate small rounded px-1 mt-1 text-decoration-none bg-success-subtle text-success-emphasis"
                  >
                    {e.name}
                  </Link>
                ))}
                {list.length > MAX_CHIPS && (
                  <button
                    type="button"
                    className="btn btn-link btn-sm p-0 small text-decoration-none mt-1"
                    onClick={() => setOpenDay(openDay === cell.key ? null : cell.key)}
                  >
                    +{list.length - MAX_CHIPS} more
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {/* Expanded-day panel (from "+N more") */}
        {openDay && openList.length > 0 && (
          <div className="mt-3">
            <div className="d-flex justify-content-between align-items-center mb-2">
              <h6 className="mb-0">{formatDayHeading(openDay)}</h6>
              <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setOpenDay(null)}>
                Close
              </button>
            </div>
            <div className="list-group">
              {openList.map((e) => <EventCard key={e.event_id} event={e} view="list" />)}
            </div>
          </div>
        )}
      </div>

      {/* Mobile agenda — the visible month grouped by day (grid is hidden below md) */}
      <div className="d-md-none">
        {monthKeys.length === 0 ? (
          <div className="alert alert-light border text-center py-4">
            No events in {monthLabel(cursor)}.
          </div>
        ) : (
          monthKeys.map((k) => (
            <div key={k} className="mb-3">
              <h6 className="text-muted small mb-2">{formatDayHeading(k)}</h6>
              <div className="list-group">
                {byDay.get(k).map((e) => <EventCard key={e.event_id} event={e} view="list" />)}
              </div>
            </div>
          ))
        )}
      </div>
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

  const refetch = useCallback(async (f, v) => {
    setLoading(true);
    try {
      const params = buildParams(f);
      // Calendar view navigates by month, so the Upcoming/Past toggle doesn't
      // apply there — always fetch 'all' so past and future months populate.
      if (v === 'calendar') params.when = 'all';
      const rows = await eventsService.getListing(params);
      setEvents(rows);
    } finally {
      setLoading(false);
    }
  }, []);

  // Debounced refetch whenever a filter OR the view changes (switching to/from
  // calendar swaps the effective 'when', so it needs a refetch too).
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    const t = setTimeout(() => refetch(filters, view), 300);
    return () => clearTimeout(t);
  }, [filters, view, refetch]);

  const set = (key) => (e) =>
    setFilters((prev) => ({ ...prev, [key]: e.target.value }));

  return (
    <main className="page-width py-5">
      <div className="d-flex flex-wrap justify-content-between align-items-center mb-3 gap-2">
        <h1 className="mb-0">
          Find, Attend &amp; List Events or Promotions
        </h1>
        <div className="d-flex gap-2">
          <Link href="/submit" className="btn bamboo-btn">
            List an event
          </Link>
          <Link href="/account" className="btn bamboo-btn bamboo-btn--secondary">
            Manage your listings
          </Link>
        </div>
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
        {view !== 'calendar' && (
          <div className="col-6 col-md-3">
            <label className="form-label small mb-1">Show</label>
            <select className="form-select" value={filters.when} onChange={set('when')}>
              {WHEN_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
        )}
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
            className={`btn btn-sm ${view === 'grid' ? 'bamboo-btn' : 'bamboo-btn bamboo-btn--secondary'}`}
            onClick={() => setView('grid')}
          >
            Grid
          </button>
          <button
            type="button"
            className={`btn btn-sm ${view === 'list' ? 'bamboo-btn' : 'bamboo-btn bamboo-btn--secondary'}`}
            onClick={() => setView('list')}
          >
            List
          </button>
          <button
            type="button"
            className={`btn btn-sm ${view === 'calendar' ? 'bamboo-btn' : 'bamboo-btn bamboo-btn--secondary'}`}
            onClick={() => setView('calendar')}
          >
            Calendar
          </button>
        </div>
      </div>

      {/* Results */}
      {events.length === 0 && !loading ? (
        <div className="alert alert-light border text-center py-5">
          No events match your filters yet. Try widening your search.
        </div>
      ) : view === 'calendar' ? (
        <MonthCalendar events={events} />
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
