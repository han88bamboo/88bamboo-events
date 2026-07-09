// core/utils/seo.js — canonical URL + schema.org/Event JSON-LD builders (plan §4,
// PATTERN-SPEC §B3 SEO). The public detail pages are the SEO surface: full SSR
// HTML with <title>, meta description, JSON-LD, and a <link rel=canonical> to the
// APEX form https://www.88bamboo.co/a/events/<slug>.
//
// Canonical base (plan §5 heads-up + §9): the app runs under basePath '/a/events'
// but the canonical/JSON-LD/sitemap URLs must be the apex proxy form. We derive
// `${NEXT_PUBLIC_BASE_URL}${BASE_PATH}` so it is correct in every environment
// (local http://localhost:8080/a/events; prod https://www.88bamboo.co/a/events),
// with the apex hard-coded as the production fallback per the SPEC §B3 annotation.
// There is NO apex->www redirect (it would break the App Proxy — SPEC annotation).

export const BASE_PATH = '/a/events';

// NEXT_PUBLIC_* is inlined at build time, so this works in the browser and SSR.
const SITE_ORIGIN = (
  process.env.NEXT_PUBLIC_BASE_URL || 'https://www.88bamboo.co'
).replace(/\/$/, '');

// The public canonical base, e.g. https://www.88bamboo.co/a/events
export const CANONICAL_BASE = `${SITE_ORIGIN}${BASE_PATH}`;

// Canonical URL for a single event detail page.
export function eventCanonicalUrl(slug) {
  return `${CANONICAL_BASE}/${slug}`;
}

// The listing page canonical URL.
export function listingCanonicalUrl() {
  return CANONICAL_BASE;
}

// Canonical URL for an Explore page (EXPLORE-LAYER-PLAN §7). Apex form, same
// CANONICAL_BASE pattern as the event/listing canonicals. No args → the hub
// (/explore); a place slug → the place page; place + facet slug → the facet page.
// A filtered on-page state (query params) canonicals back to its bare page, so the
// callers pass only the resolved place/facet slugs, never the query.
export function exploreCanonicalUrl(placeSlug, facetSlug) {
  let url = `${CANONICAL_BASE}/explore`;
  if (placeSlug) url += `/${placeSlug}`;
  if (placeSlug && facetSlug) url += `/${facetSlug}`;
  return url;
}

// A concise meta description from the event (falls back to a generic line).
export function eventMetaDescription(event) {
  const desc = (event?.description || '').trim();
  if (desc) return desc.length > 300 ? `${desc.slice(0, 297)}…` : desc;
  const where = [event?.city, event?.country].filter(Boolean).join(', ');
  return `${event?.name || 'Event'}${where ? ` in ${where}` : ''} — on the 88 Bamboo drinks & hospitality events board.`;
}

// schema.org expects ISO-8601 dates; the API serialises TIMESTAMPTZ as RFC-1123
// ("Tue, 28 Jul 2026 13:00:00 GMT"), so normalise via Date -> toISOString().
function isoDate(v) {
  if (!v) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

// The location Place (PostalAddress + optional GeoCoordinates), shared across every
// occurrence's Event. Returns undefined when there's nothing to place.
function eventLocation(event) {
  const address = {};
  if (event?.venue_address) address.streetAddress = event.venue_address;
  if (event?.city) address.addressLocality = event.city;
  if (event?.region) address.addressRegion = event.region;
  if (event?.postcode) address.postalCode = event.postcode;
  if (event?.country) address.addressCountry = event.country;
  const hasCoords = event?.latitude != null && event?.longitude != null;
  if (!(event?.venue_name || Object.keys(address).length || hasCoords)) return undefined;
  return {
    '@type': 'Place',
    ...(event?.venue_name ? { name: event.venue_name } : {}),
    ...(hasCoords
      ? { geo: { '@type': 'GeoCoordinates', latitude: event.latitude, longitude: event.longitude } }
      : {}),
    ...(Object.keys(address).length
      ? { address: { '@type': 'PostalAddress', ...address } }
      : {}),
  };
}

// Build ONE schema.org/Event object for a given start/end (plan §4). Includes name,
// startDate, endDate, eventStatus, location, image, and description. Missing fields
// are omitted rather than emitted empty.
function buildOneEvent(event, start, end) {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: event?.name,
    // Schedule state: we only model scheduled events (no cancel/postpone flow),
    // so a past-dated event is still EventScheduled (it took place as planned).
    eventStatus: 'https://schema.org/EventScheduled',
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    url: eventCanonicalUrl(event?.slug),
  };
  const startDate = isoDate(start);
  const endDate = isoDate(end);
  if (startDate) jsonLd.startDate = startDate;
  if (endDate) jsonLd.endDate = endDate;
  if (event?.image_url) jsonLd.image = [event.image_url];
  if (event?.description) jsonLd.description = event.description;
  const location = eventLocation(event);
  if (location) jsonLd.location = location;
  // Public organiser (EP-7). Emitted only when the event set an organiser name;
  // legacy events omit it. Organization is the safe default for a listing's
  // organiser (an individual would be Person, but names here are org-style).
  if (event?.organiser_name) {
    jsonLd.organizer = { '@type': 'Organization', name: event.organiser_name };
  }
  return jsonLd;
}

// Build the schema.org/Event JSON-LD (plan §4). For a single-date event this is one
// Event object (unchanged). For a multi-date schedule (EP-6) it is an ARRAY of Event
// objects — one per occurrence, each with its own startDate/endDate — which is
// Google's guidance for the same event repeated on several dates.
export function buildEventJsonLd(event) {
  const occurrences = event?.occurrences && event.occurrences.length
    ? event.occurrences
    : [{ start: event?.start_datetime, end: event?.end_datetime }];
  if (occurrences.length > 1) {
    return occurrences.map((o) => buildOneEvent(event, o.start, o.end));
  }
  return buildOneEvent(event, occurrences[0].start, occurrences[0].end);
}

// The per-event shape for an ItemList entry: reuse buildEventJsonLd's Event object,
// collapsing a multi-date event to its first occurrence (the collection LISTS the
// event; the detail page carries the full occurrence set) and dropping the redundant
// nested '@context' (the enclosing CollectionPage already declares it).
function eventItemShape(event) {
  const ld = buildEventJsonLd(event);
  const one = Array.isArray(ld) ? ld[0] : ld;
  const { '@context': _context, ...rest } = one;
  return rest;
}

// Build the CollectionPage + ItemList JSON-LD for an Explore page (EXPLORE-LAYER-PLAN
// §7): a CollectionPage whose mainEntity is an ordered ItemList of the events on the
// page, each item reusing buildEventJsonLd's per-event Event shape. `name`/`url`
// mirror the page's H1/canonical; `description` is optional.
export function buildCollectionPageJsonLd({ name, url, description, events = [] }) {
  return {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    ...(name ? { name } : {}),
    ...(url ? { url } : {}),
    ...(description ? { description } : {}),
    mainEntity: {
      '@type': 'ItemList',
      numberOfItems: events.length,
      itemListElement: events.map((event, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        url: eventCanonicalUrl(event?.slug),
        item: eventItemShape(event),
      })),
    },
  };
}

// Build BreadcrumbList JSON-LD from an ordered crumb list (EXPLORE-LAYER-PLAN §7).
// Each crumb is { name, url? }; the LAST (current page) may omit `url`. URLs must be
// absolute apex form — the callers build them with CANONICAL_BASE/exploreCanonicalUrl.
export function buildBreadcrumbListJsonLd(crumbs = []) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((crumb, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: crumb.name,
      ...(crumb.url ? { item: crumb.url } : {}),
    })),
  };
}
