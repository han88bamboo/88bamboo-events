// publicFormat.js — small presentation helpers shared by the public listing +
// detail views. Kept framework-free (pure functions) so they're easy to reason
// about and reuse.
//
// DATE RENDERING IS DELIBERATELY DETERMINISTIC (fixed locale + fixed timeZone),
// NOT viewer-local. These strings are produced during SSR (in the container, UTC)
// AND again on the client (the viewer's timezone/locale); if they differed React
// would throw a hydration mismatch. Pinning `en-GB` + `timeZone: 'UTC'` makes
// server and client produce identical output. It also shows the event at the
// wall-clock time the organiser entered (the naive datetime is stored as UTC), so
// every viewer sees the event's stated local time — the norm for an events board
// (an event at 13:00 in Tokyo reads "13:00", not converted to the reader's zone).
const DATE_LOCALE = 'en-GB';
const DATE_OPTS = {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'UTC',
};

export function formatDateTime(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(DATE_LOCALE, DATE_OPTS);
}

// A compact "start — end" range; collapses to a single date when there is no end.
export function formatDateRange(start, end) {
  const s = formatDateTime(start);
  const e = formatDateTime(end);
  if (s && e) return `${s} — ${e}`;
  return s || e || 'Date TBC';
}

// True when the event has ended (plan §8: badge "This event is over"). Computed
// from end_datetime < now(), distinct from current_status='expired' (4B). The
// backend also returns is_past; this is the client-side fallback.
export function isPastEvent(event) {
  if (typeof event?.is_past === 'boolean') return event.is_past;
  if (!event?.end_datetime) return false;
  return new Date(event.end_datetime).getTime() < Date.now();
}
