// core/utils/exploreFacets.js — deterministic slug ↔ facet/place derivation for the
// Explore SEO layer (EXPLORE-LAYER-PLAN.md §3 D3, §4). PURE functions, NO I/O and NO
// config: every explore URL slug and H1 is a deterministic function of the live
// taxonomy labels (drink_categories, event_formats) + the distinct published
// country/city strings. Nothing here is stored or owner-maintained (D2/D3).
//
// This is the foundation Phase C (backend resolvers) and Phase D (frontend routes)
// build on: the same three slug builders below are used to GENERATE valid slugs and,
// reversed, to RESOLVE an incoming URL slug back to the `/events` filter params.
//
// 'Other' (present in both the category and format taxonomies) is a catch-all with no
// SEO value and is EXCLUDED from every facet — the callers pass taxonomy lists already
// minus 'Other', and we defensively drop it again here so it can never leak into a slug.

const OTHER_LABEL = 'other';

/**
 * slugifyLabel — lowercase a label, collapse every non-alphanumeric run to a single
 * hyphen, and trim leading/trailing hyphens.
 *   'Tequila/Mezcal'        → 'tequila-mezcal'
 *   'Bar takeover'          → 'bar-takeover'
 *   'United Arab Emirates'  → 'united-arab-emirates'
 */
export function slugifyLabel(label) {
  return String(label)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * pluralizeSlug — English plural of a slug's final token (D3 rule):
 *   ends in s/x/z/ch/sh → + 'es'   ('masterclass' → 'masterclasses', 'launch' → 'launches')
 *   consonant + 'y'     → 'ies'    ('party' → 'parties')
 *   otherwise           → + 's'    ('takeover' → 'takeovers', 'trade-event' → 'trade-events')
 */
export function pluralizeSlug(slug) {
  if (/(s|x|z|ch|sh)$/.test(slug)) return `${slug}es`;
  if (/[bcdfghjklmnpqrstvwxz]y$/.test(slug)) return slug.replace(/y$/, 'ies');
  return `${slug}s`;
}

/** categoryFacetSlug — a drink category's facet slug (singular). 'Whisky' → 'whisky'. */
export function categoryFacetSlug(categoryLabel) {
  return slugifyLabel(categoryLabel);
}

/** formatFacetSlug — an event format's facet slug (pluralised). 'Tasting' → 'tastings'. */
export function formatFacetSlug(formatLabel) {
  return pluralizeSlug(slugifyLabel(formatLabel));
}

/**
 * pairFacetSlug — a category+format pair facet slug: `${categorySlug}-${formatSlugPlural}`.
 * 'Wine' + 'Tasting' → 'wine-tastings'.
 */
export function pairFacetSlug(categoryLabel, formatLabel) {
  return `${categoryFacetSlug(categoryLabel)}-${formatFacetSlug(formatLabel)}`;
}

// titleCaseSlug — render a hyphenated slug as spaced Title Case for H1 copy.
//   'bar-takeovers' → 'Bar Takeovers'
function titleCaseSlug(slug) {
  return slug
    .split('-')
    .map((word) => (word ? word.charAt(0).toUpperCase() + word.slice(1) : word))
    .join(' ');
}

/**
 * facetH1 — the deterministic H1 for a facet page (D3 templates, D9 voice). `place` is a
 * display string ('Singapore', 'Hong Kong'); `category`/`format` are taxonomy LABELS
 * (verbatim for the category noun, pluralised+title-cased for the format).
 *   category-only: '{Category} Events in {place}'          → 'Whisky Events in Singapore'
 *   format-only:   '{Format-plural} in {place}'            → 'Masterclasses in Singapore'
 *   pair:          '{Category} {Format-plural} in {place}' → 'Wine Tastings in Hong Kong'
 * 'Other' must never reach here — it is filtered upstream (see module header).
 */
export function facetH1(place, { category, format } = {}) {
  if (category && format) {
    return `${category} ${titleCaseSlug(formatFacetSlug(format))} in ${place}`;
  }
  if (category) {
    return `${category} Events in ${place}`;
  }
  if (format) {
    return `${titleCaseSlug(formatFacetSlug(format))} in ${place}`;
  }
  // No facet (bare place page) — the place-level H1 is templated elsewhere (D9).
  return `Events in ${place}`;
}

// dropOther — remove any 'Other' catch-all label (case-insensitive) from a taxonomy list.
function dropOther(labels) {
  return (labels || []).filter((label) => slugifyLabel(label) !== OTHER_LABEL);
}

/**
 * buildFacetSlugMap — the full set of valid facet slugs for a taxonomy, mapping each
 * slug → { category, format } (labels; the unused axis is null). This is the single
 * generator that resolveFacetSlug reverses, so slugs and their resolution can never drift.
 * Order = category-only, then format-only, then every (category, format) pair; the first
 * writer of a slug wins, so single-axis facets take priority over a colliding pair.
 * 'Other' is excluded from both axes.
 */
export function buildFacetSlugMap(categories, formats) {
  const cats = dropOther(categories);
  const fmts = dropOther(formats);
  const map = new Map();
  for (const category of cats) {
    const slug = categoryFacetSlug(category);
    if (!map.has(slug)) map.set(slug, { category, format: null });
  }
  for (const format of fmts) {
    const slug = formatFacetSlug(format);
    if (!map.has(slug)) map.set(slug, { category: null, format });
  }
  for (const category of cats) {
    for (const format of fmts) {
      const slug = pairFacetSlug(category, format);
      if (!map.has(slug)) map.set(slug, { category, format });
    }
  }
  return map;
}

/**
 * resolveFacetSlug — reverse of the three slug builders. Given a URL facet slug and the
 * taxonomy label lists (excluding 'Other'), return { category, format } if the slug is a
 * known category-only, format-only, or pair facet; otherwise null (the caller 404s).
 * Resolution is by matching the generated candidate set — NOT by splitting on hyphens,
 * which breaks because labels already contain hyphens ('tequila-mezcal', pair slugs).
 */
export function resolveFacetSlug(slug, categories, formats) {
  if (!slug) return null;
  return buildFacetSlugMap(categories, formats).get(slug) || null;
}

/**
 * facetSlug — the canonical URL slug for a resolved facet ({ category, format }), the
 * inverse of resolveFacetSlug: pair → 'wine-tastings', category-only → 'wine',
 * format-only → 'tastings'. Lets a page rebuild its own facet path/canonical from the
 * resolved labels without threading the raw route param through props.
 */
export function facetSlug({ category, format } = {}) {
  if (category && format) return pairFacetSlug(category, format);
  if (category) return categoryFacetSlug(category);
  if (format) return formatFacetSlug(format);
  return '';
}

/** placeSlug — a country or city display name as an explore place slug. 'Hong Kong' → 'hong-kong'. */
export function placeSlug(value) {
  return slugifyLabel(value);
}

/**
 * resolvePlaceSlug — reverse of placeSlug. Given a URL place slug and the distinct
 * published country + city label lists, return { country, city } (unused axis null), with
 * a COUNTRY match taking priority over a city match (plan §4 — this is what lets the
 * city-states Singapore/Hong Kong filter by country, which for them includes the city).
 * Returns null if the slug matches neither (the caller 404s).
 */
export function resolvePlaceSlug(slug, countries, cities) {
  if (!slug) return null;
  for (const country of countries || []) {
    if (placeSlug(country) === slug) return { country, city: null };
  }
  for (const city of cities || []) {
    if (placeSlug(city) === slug) return { country: null, city };
  }
  return null;
}
