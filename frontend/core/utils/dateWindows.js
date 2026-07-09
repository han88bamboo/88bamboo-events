// core/utils/dateWindows.js — pure date-window → {date_from, date_to} mapping for the
// Explore layer's on-page date chips (EXPLORE-LAYER-PLAN.md §6, D4). Each window key maps
// to a concrete pair of ISO instants that plug straight into the existing `/events`
// filter (date_from = start_datetime >= …, date_to = start_datetime <= …).
//
// UTC-PINNED on purpose: every boundary is built with Date.UTC / getUTC* — the SAME
// convention EventListing.js uses for its calendar buckets — so a window matches the
// wall-clock day the organiser entered and the result is identical on the server and the
// client (no locale/timezone hydration mismatch). No I/O, no config; unit-tested.
//
// Windows anchored at "start of today" (this-week / this-month / 3-months) mean "the rest
// of this period from today onward"; the fixed-day windows (today / tomorrow / weekend /
// next-week) are absolute day spans. The upcoming filter on the listing further trims any
// already-ended event, so a window whose start is earlier today never resurfaces past ones.

// The chip set (key + display label), in display order. Drives ExploreFilters' date chips
// and is the authoritative list of valid keys.
export const DATE_WINDOWS = [
  { key: 'today', label: 'Today' },
  { key: 'tomorrow', label: 'Tomorrow' },
  { key: 'this-weekend', label: 'This weekend' },
  { key: 'this-week', label: 'This week' },
  { key: 'next-week', label: 'Next week' },
  { key: 'this-month', label: 'This month' },
  { key: '3-months', label: 'Next 3 months' },
];

const DATE_WINDOW_KEYS = new Set(DATE_WINDOWS.map((w) => w.key));

/** isDateWindowKey — true if `key` is one of the known window keys (else it's ignored). */
export function isDateWindowKey(key) {
  return DATE_WINDOW_KEYS.has(key);
}

// 00:00:00.000 / 23:59:59.999 UTC for a calendar day. The day/month args may overflow
// (e.g. d + 6, m + 3) — Date.UTC normalises them, so month/year roll over correctly.
function startOfUtcDay(y, m, d) {
  return new Date(Date.UTC(y, m, d, 0, 0, 0, 0));
}
function endOfUtcDay(y, m, d) {
  return new Date(Date.UTC(y, m, d, 23, 59, 59, 999));
}

function iso(from, to) {
  return { date_from: from.toISOString(), date_to: to.toISOString() };
}

/**
 * dateWindow — resolve a window key to { date_from, date_to } ISO instants (UTC), relative
 * to `now` (defaults to the current time; injectable so it's deterministically testable).
 * Returns null for an unknown key so callers can drop it (an unknown ?date is a no-op).
 *
 * Week maths use a Monday-start week (Mon=0 … Sun=6) to match EventListing's calendar.
 */
export function dateWindow(key, now = new Date()) {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const d = now.getUTCDate();
  const mondayOffset = (now.getUTCDay() + 6) % 7; // days since this week's Monday

  switch (key) {
    case 'today':
      return iso(startOfUtcDay(y, m, d), endOfUtcDay(y, m, d));
    case 'tomorrow':
      return iso(startOfUtcDay(y, m, d + 1), endOfUtcDay(y, m, d + 1));
    case 'this-weekend': {
      // Saturday + Sunday of the current Monday-start week.
      const sat = d - mondayOffset + 5;
      const sun = d - mondayOffset + 6;
      return iso(startOfUtcDay(y, m, sat), endOfUtcDay(y, m, sun));
    }
    case 'this-week': {
      // Today through the end of this week's Sunday.
      const sun = d - mondayOffset + 6;
      return iso(startOfUtcDay(y, m, d), endOfUtcDay(y, m, sun));
    }
    case 'next-week': {
      // Next Monday through next Sunday (the whole following week).
      const mon = d - mondayOffset + 7;
      const sun = d - mondayOffset + 13;
      return iso(startOfUtcDay(y, m, mon), endOfUtcDay(y, m, sun));
    }
    case 'this-month': {
      // Today through the last day of the current month (day 0 of next month).
      const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
      return iso(startOfUtcDay(y, m, d), endOfUtcDay(y, m, lastDay));
    }
    case '3-months':
      // Today through the same day-of-month three months out.
      return iso(startOfUtcDay(y, m, d), endOfUtcDay(y, m + 3, d));
    default:
      return null;
  }
}
