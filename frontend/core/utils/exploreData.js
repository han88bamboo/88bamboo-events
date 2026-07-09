// core/utils/exploreData.js — server-side data loading for the Explore pages
// (EXPLORE-LAYER-PLAN §6). Resolves an incoming place (+ optional facet) slug against
// the LIVE published places/facets aggregates, then fetches the first grid page for the
// resolved `/events` filter. Imported only from getServerSideProps, so it never ships
// to the browser bundle. Slug↔label resolution reuses the pure helpers in
// exploreFacets.js — the same generators the backend admin validation mirrors.
import { eventsService } from '@/core/services/events';
import { resolveFacetSlug, resolvePlaceSlug } from './exploreFacets';

// Split the /events/places rows into distinct country + city label lists (each row is
// { kind, value, upcoming_count }); a city-state contributes to both.
function splitPlaces(places) {
  const countries = [];
  const cities = [];
  for (const row of places) {
    if (row.kind === 'country') countries.push(row.value);
    else if (row.kind === 'city') cities.push(row.value);
  }
  return { countries, cities };
}

// The upcoming count for a bare place, straight from the aggregate (country row wins,
// matching resolvePlaceSlug's country-over-city rule). Accurate (not grid-capped).
function placeCount(places, place) {
  const wantKind = place.country ? 'country' : 'city';
  const wantValue = place.country || place.city;
  const row = places.find((r) => r.kind === wantKind && r.value === wantValue);
  return row ? Number(row.upcoming_count) : 0;
}

/**
 * loadExploreContext — resolve a place (and optional facet) slug to render an Explore
 * page. Returns null when the slug matches nothing (the caller returns notFound), else
 * the resolved context: the { country, city } place, its display name, the resolved
 * { category, format } facet (or null), the first grid page of events, an upcoming
 * count, and the category/format LABEL lists that drive the on-page chips.
 *
 * @param {string} placeSlugParam  the [place] route segment
 * @param {string|null} facetSlugParam  the [facet] route segment, or null for a place page
 */
export async function loadExploreContext(placeSlugParam, facetSlugParam = null) {
  const [places, facets] = await Promise.all([
    eventsService.getPlaces(),
    eventsService.getFacets(),
  ]);

  const { countries, cities } = splitPlaces(places);
  const place = resolvePlaceSlug(placeSlugParam, countries, cities);
  if (!place) return null;

  const categoryLabels = (facets.categories || []).map((c) => c.category);
  const formatLabels = (facets.formats || []).map((f) => f.format);

  let facet = null;
  if (facetSlugParam) {
    facet = resolveFacetSlug(facetSlugParam, categoryLabels, formatLabels);
    if (!facet) return null; // real slug shape but no such facet → 404
  }

  // Build the exact /events filter the resolved place + facet map to.
  const filter = { when: 'upcoming' };
  if (place.country) filter.country = place.country;
  if (place.city) filter.city = place.city;
  if (facet?.category) filter.category = facet.category;
  if (facet?.format) filter.format = facet.format;

  const events = await eventsService.getListing(filter);

  // Place pages take the accurate aggregate count; facet pages use the grid length
  // (a precise per-facet aggregate is only needed for Phase E's robots gating).
  const upcomingCount = facet ? events.length : placeCount(places, place);

  return {
    place,
    placeDisplay: place.country || place.city,
    facet,
    events,
    upcomingCount,
    categoryLabels,
    formatLabels,
  };
}
