// ExploreFilters — the on-page filter module + results grid for an Explore page
// (EXPLORE-LAYER-PLAN §6, D4/D8). Drink-category chips, event-format chips, and
// date-window chips (from core/utils/dateWindows.js). Selecting a chip updates the
// query params and client-refetches via the SAME debounced eventsService.getListing
// pattern EventListing uses, then reflects the selection in the URL (shallow) so the
// state is deep-linkable. These are ON-PAGE ONLY: the whole Explore page defaults to
// noindex in Phase D, and Phase E canonical's any filtered state back to the bare page,
// so no per-chip noindex handling is needed here.
//
// The place (country|city) is FIXED by the URL and never a chip. On a facet page the
// facet's category/format start pre-selected; the user can change them (on-page only).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/router';

import { eventsService } from '@/core/services/events';
import { dateWindow, DATE_WINDOWS } from '@/core/utils/dateWindows';
import EventGrid from '../EventListing/EventGrid';

// A single pill toggle — active pills use the primary bamboo button, inactive the
// secondary, matching the view-toggle buttons on the main listing.
function Chip({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`btn btn-sm rounded-pill ${active ? 'bamboo-btn' : 'bamboo-btn bamboo-btn--secondary'}`}
    >
      {children}
    </button>
  );
}

function ChipGroup({ label, children }) {
  return (
    <div className="mb-3">
      <div className="form-label small mb-1">{label}</div>
      <div className="d-flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

function ExploreFilters({
  initialEvents = [],
  place,
  facet,
  drinkCategories = [],
  eventFormats = [],
  initialQuery = {},
}) {
  const router = useRouter();

  // On-page selections. A facet page seeds its own axis; URL query layers on top.
  const [category, setCategory] = useState(facet?.category || initialQuery.category || '');
  const [format, setFormat] = useState(facet?.format || initialQuery.format || '');
  const [date, setDate] = useState(initialQuery.date || '');
  const [events, setEvents] = useState(initialEvents);
  const [loading, setLoading] = useState(false);

  // Skip the first fetch: SSR initialEvents already reflect the initial selection.
  const firstRun = useRef(true);

  const params = useMemo(() => {
    const p = { when: 'upcoming' };
    if (place?.country) p.country = place.country;
    if (place?.city) p.city = place.city;
    if (category) p.category = category;
    if (format) p.format = format;
    if (date) {
      const w = dateWindow(date);
      if (w) {
        p.date_from = w.date_from;
        p.date_to = w.date_to;
      }
    }
    return p;
  }, [place, category, format, date]);

  // Reflect the on-page filters in the URL (shallow — no SSR re-run), preserving the
  // dynamic route params (place/facet) already in router.query.
  const syncUrl = useCallback(() => {
    const query = { ...router.query };
    ['category', 'format', 'date'].forEach((k) => delete query[k]);
    if (category) query.category = category;
    if (format) query.format = format;
    if (date) query.date = date;
    router.replace({ pathname: router.pathname, query }, undefined, { shallow: true });
    // router is stable; depend on the values that build the query.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category, format, date]);

  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const rows = await eventsService.getListing(params);
        setEvents(rows);
      } finally {
        setLoading(false);
      }
      syncUrl();
    }, 300);
    return () => clearTimeout(t);
  }, [params, syncUrl]);

  // Toggling a chip clears it if already active, else selects it (single-select per axis).
  const toggle = (setter) => (value) => setter((cur) => (cur === value ? '' : value));

  return (
    <div>
      {drinkCategories.length > 0 && (
        <ChipGroup label="Drink category">
          {drinkCategories.map((c) => (
            <Chip key={c} active={category === c} onClick={() => toggle(setCategory)(c)}>
              {c}
            </Chip>
          ))}
        </ChipGroup>
      )}

      {eventFormats.length > 0 && (
        <ChipGroup label="Format">
          {eventFormats.map((f) => (
            <Chip key={f} active={format === f} onClick={() => toggle(setFormat)(f)}>
              {f}
            </Chip>
          ))}
        </ChipGroup>
      )}

      <ChipGroup label="When">
        {DATE_WINDOWS.map((w) => (
          <Chip key={w.key} active={date === w.key} onClick={() => toggle(setDate)(w.key)}>
            {w.label}
          </Chip>
        ))}
      </ChipGroup>

      <div className="text-muted small mb-3">
        {loading ? 'Loading…' : `${events.length} event${events.length === 1 ? '' : 's'}`}
      </div>

      {events.length === 0 && !loading ? (
        <div className="alert alert-light border text-center py-5">
          No upcoming events match yet.{' '}
          <a href={`${router.basePath}/submit`}>Be the first to list one.</a>
        </div>
      ) : (
        <EventGrid events={events} view="grid" />
      )}
    </div>
  );
}

export default ExploreFilters;
