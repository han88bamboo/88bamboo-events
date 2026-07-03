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

// A concise meta description from the event (falls back to a generic line).
export function eventMetaDescription(event) {
  const desc = (event?.description || '').trim();
  if (desc) return desc.length > 300 ? `${desc.slice(0, 297)}…` : desc;
  const where = [event?.city, event?.country].filter(Boolean).join(', ');
  return `${event?.name || 'Event'}${where ? ` in ${where}` : ''} — on the 88 Bamboo drinks & hospitality events board.`;
}

// Build the schema.org/Event JSON-LD object (plan §4). Includes name, startDate,
// endDate, eventStatus, location with PostalAddress, image, and description.
// Google reads this to render rich event results. Fields that are missing are
// simply omitted rather than emitted empty.
export function buildEventJsonLd(event) {
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

  // schema.org expects ISO-8601 dates; the API serialises TIMESTAMPTZ as RFC-1123
  // ("Tue, 28 Jul 2026 13:00:00 GMT"), so normalise via Date -> toISOString().
  const isoDate = (v) => {
    if (!v) return undefined;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
  };
  const startDate = isoDate(event?.start_datetime);
  const endDate = isoDate(event?.end_datetime);
  if (startDate) jsonLd.startDate = startDate;
  if (endDate) jsonLd.endDate = endDate;
  if (event?.image_url) jsonLd.image = [event.image_url];
  if (event?.description) jsonLd.description = event.description;

  // location: a Place with a PostalAddress. Only include the parts we have.
  const address = {};
  if (event?.venue_address) address.streetAddress = event.venue_address;
  if (event?.city) address.addressLocality = event.city;
  if (event?.country) address.addressCountry = event.country;
  if (event?.venue_name || Object.keys(address).length) {
    jsonLd.location = {
      '@type': 'Place',
      ...(event?.venue_name ? { name: event.venue_name } : {}),
      ...(Object.keys(address).length
        ? { address: { '@type': 'PostalAddress', ...address } }
        : {}),
    };
  }

  return jsonLd;
}
