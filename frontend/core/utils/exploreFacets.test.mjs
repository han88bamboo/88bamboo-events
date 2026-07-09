// core/utils/exploreFacets.test.mjs — unit tests for the Explore-layer facet/place slug
// derivation (EXPLORE-LAYER-PLAN.md §3 D3, §4). Uses Node's built-in test runner (no new
// dependency): run with `node --test core/utils/` from the frontend/ directory.
//
// These lock the exact slug + H1 scheme every later phase trusts, using the REAL seeded
// taxonomy from database/schema.sql: 10 non-'Other' drink categories, 8 non-'Other' event
// formats (both taxonomies also seed 'Other', which must never produce a facet).

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  slugifyLabel,
  pluralizeSlug,
  categoryFacetSlug,
  formatFacetSlug,
  pairFacetSlug,
  facetH1,
  buildFacetSlugMap,
  resolveFacetSlug,
  facetSlug,
  placeSlug,
  resolvePlaceSlug,
} from './exploreFacets.js';

// --- Seeded taxonomy (database/schema.sql), 'Other' dropped as it is upstream ---------
const CATEGORIES = [
  'Whisky', 'Wine', 'Sake', 'Beer', 'Cocktails',
  'Rum', 'Gin', 'Tequila/Mezcal', 'Cognac/Brandy', 'Baijiu',
];
const FORMATS = [
  'Bar takeover', 'Masterclass', 'Tasting', 'Dinner',
  'Festival', 'Launch', 'Competition', 'Trade event',
];

// -------------------------------------------------------------------------------------
// slugifyLabel + pluralizeSlug primitives
// -------------------------------------------------------------------------------------
test('slugifyLabel: lowercases, hyphenates non-alnum, trims', () => {
  assert.equal(slugifyLabel('Tequila/Mezcal'), 'tequila-mezcal');
  assert.equal(slugifyLabel('Cognac/Brandy'), 'cognac-brandy');
  assert.equal(slugifyLabel('Bar takeover'), 'bar-takeover');
  assert.equal(slugifyLabel('United Arab Emirates'), 'united-arab-emirates');
  assert.equal(slugifyLabel('  Spaced /out  '), 'spaced-out');
});

test('pluralizeSlug: s/x/z/ch/sh → +es, consonant+y → ies, else +s', () => {
  assert.equal(pluralizeSlug('masterclass'), 'masterclasses'); // ends s
  assert.equal(pluralizeSlug('launch'), 'launches');           // ends ch
  assert.equal(pluralizeSlug('bar-takeover'), 'bar-takeovers');// else +s
  assert.equal(pluralizeSlug('box'), 'boxes');                 // ends x
  assert.equal(pluralizeSlug('quiz'), 'quizes');               // ends z (simple rule)
  assert.equal(pluralizeSlug('bash'), 'bashes');               // ends sh
  assert.equal(pluralizeSlug('party'), 'parties');             // consonant + y
  assert.equal(pluralizeSlug('day'), 'days');                  // vowel + y → +s
});

// -------------------------------------------------------------------------------------
// D3 verification table — exact slug output for all 10 categories + all 8 formats
// -------------------------------------------------------------------------------------
test('categoryFacetSlug: exact for all 10 non-Other categories', () => {
  const expected = {
    Whisky: 'whisky',
    Wine: 'wine',
    Sake: 'sake',
    Beer: 'beer',
    Cocktails: 'cocktails',
    Rum: 'rum',
    Gin: 'gin',
    'Tequila/Mezcal': 'tequila-mezcal',
    'Cognac/Brandy': 'cognac-brandy',
    Baijiu: 'baijiu',
  };
  for (const [label, slug] of Object.entries(expected)) {
    assert.equal(categoryFacetSlug(label), slug, `category ${label}`);
  }
});

test('formatFacetSlug: exact for all 8 non-Other formats', () => {
  const expected = {
    'Bar takeover': 'bar-takeovers',
    Masterclass: 'masterclasses',
    Tasting: 'tastings',
    Dinner: 'dinners',
    Festival: 'festivals',
    Launch: 'launches',
    Competition: 'competitions',
    'Trade event': 'trade-events',
  };
  for (const [label, slug] of Object.entries(expected)) {
    assert.equal(formatFacetSlug(label), slug, `format ${label}`);
  }
});

test('pairFacetSlug: the four sample pairs from the D3 table', () => {
  assert.equal(pairFacetSlug('Wine', 'Tasting'), 'wine-tastings');
  assert.equal(pairFacetSlug('Whisky', 'Masterclass'), 'whisky-masterclasses');
  assert.equal(pairFacetSlug('Beer', 'Festival'), 'beer-festivals');
  assert.equal(pairFacetSlug('Gin', 'Dinner'), 'gin-dinners');
});

// -------------------------------------------------------------------------------------
// D3 H1 templates
// -------------------------------------------------------------------------------------
test('facetH1: category-only template', () => {
  assert.equal(facetH1('Singapore', { category: 'Whisky' }), 'Whisky Events in Singapore');
  // 'Other' is filtered upstream, but the awkward slash/plural labels still render (D3 note).
  assert.equal(facetH1('Tokyo', { category: 'Tequila/Mezcal' }), 'Tequila/Mezcal Events in Tokyo');
});

test('facetH1: format-only template (plural, Title Case)', () => {
  assert.equal(facetH1('Singapore', { format: 'Masterclass' }), 'Masterclasses in Singapore');
  assert.equal(facetH1('Bangkok', { format: 'Bar takeover' }), 'Bar Takeovers in Bangkok');
  assert.equal(facetH1('Tokyo', { format: 'Trade event' }), 'Trade Events in Tokyo');
});

test('facetH1: pair template', () => {
  assert.equal(facetH1('Hong Kong', { category: 'Wine', format: 'Tasting' }), 'Wine Tastings in Hong Kong');
  assert.equal(facetH1('Singapore', { category: 'Whisky', format: 'Masterclass' }), 'Whisky Masterclasses in Singapore');
});

// -------------------------------------------------------------------------------------
// resolveFacetSlug — round-trips every generated slug, null for garbage
// -------------------------------------------------------------------------------------
test('resolveFacetSlug: round-trips every generated facet slug', () => {
  const map = buildFacetSlugMap(CATEGORIES, FORMATS);
  assert.ok(map.size > 0);
  for (const [slug, facet] of map) {
    assert.deepEqual(resolveFacetSlug(slug, CATEGORIES, FORMATS), facet, `slug ${slug}`);
  }
});

test('resolveFacetSlug: resolves each kind to the right axes', () => {
  assert.deepEqual(resolveFacetSlug('whisky', CATEGORIES, FORMATS), { category: 'Whisky', format: null });
  assert.deepEqual(resolveFacetSlug('masterclasses', CATEGORIES, FORMATS), { category: null, format: 'Masterclass' });
  assert.deepEqual(resolveFacetSlug('wine-tastings', CATEGORIES, FORMATS), { category: 'Wine', format: 'Tasting' });
  // hyphen-containing category resolves as a single facet, not a naive split:
  assert.deepEqual(resolveFacetSlug('tequila-mezcal', CATEGORIES, FORMATS), { category: 'Tequila/Mezcal', format: null });
});

// facetSlug — the exact inverse of resolveFacetSlug (Phase E: rebuilds a page's own
// canonical/breadcrumb path from the resolved { category, format } labels).
test('facetSlug: round-trips every generated facet back to its slug', () => {
  const map = buildFacetSlugMap(CATEGORIES, FORMATS);
  for (const [slug, facet] of map) {
    assert.equal(facetSlug(facet), slug, `facet ${slug}`);
  }
});

test('resolveFacetSlug: null for garbage input', () => {
  assert.equal(resolveFacetSlug('asdf', CATEGORIES, FORMATS), null);
  assert.equal(resolveFacetSlug('whisky-whisky', CATEGORIES, FORMATS), null);
  assert.equal(resolveFacetSlug('', CATEGORIES, FORMATS), null);
  assert.equal(resolveFacetSlug(null, CATEGORIES, FORMATS), null);
});

// -------------------------------------------------------------------------------------
// 'Other' never produces a facet (neither category nor format nor pair)
// -------------------------------------------------------------------------------------
test("'Other' never appears in any generated facet", () => {
  const map = buildFacetSlugMap([...CATEGORIES, 'Other'], [...FORMATS, 'Other']);
  // No slug is 'other' / 'others', and no resolved facet carries an 'Other' label.
  assert.ok(!map.has('other'));
  assert.ok(!map.has('others'));
  for (const [slug, { category, format }] of map) {
    assert.notEqual(category, 'Other', `category leaked in ${slug}`);
    assert.notEqual(format, 'Other', `format leaked in ${slug}`);
    assert.ok(!slug.includes('other'), `slug ${slug} contains 'other'`);
  }
  // And a directly requested 'other' slug does not resolve.
  assert.equal(resolveFacetSlug('other', [...CATEGORIES, 'Other'], [...FORMATS, 'Other']), null);
  assert.equal(resolveFacetSlug('others', [...CATEGORIES, 'Other'], [...FORMATS, 'Other']), null);
});

// -------------------------------------------------------------------------------------
// placeSlug + resolvePlaceSlug — representative seeded countries + free-text cities
// -------------------------------------------------------------------------------------
// A ~10-country sample from database/schema.sql, including the multi-word/tricky ones.
const COUNTRY_SAMPLE = [
  'Singapore', 'Hong Kong', 'Mainland China', 'United Arab Emirates', 'South Korea',
  'United Kingdom', 'United States', 'New Zealand', 'Czech Republic', 'Japan',
];
// Free-text city values a submitter might enter.
const CITY_SAMPLE = ['Hong Kong', 'Tokyo', 'Ho Chi Minh City'];

test('placeSlug: reasonable slugs for seeded multi-word countries + cities', () => {
  assert.equal(placeSlug('Singapore'), 'singapore');
  assert.equal(placeSlug('Hong Kong'), 'hong-kong');
  assert.equal(placeSlug('Mainland China'), 'mainland-china');
  assert.equal(placeSlug('United Arab Emirates'), 'united-arab-emirates');
  assert.equal(placeSlug('South Korea'), 'south-korea');
  assert.equal(placeSlug('Czech Republic'), 'czech-republic');
  assert.equal(placeSlug('Tokyo'), 'tokyo');
  assert.equal(placeSlug('Ho Chi Minh City'), 'ho-chi-minh-city');
});

test('resolvePlaceSlug: round-trips the country sample to a country match', () => {
  for (const country of COUNTRY_SAMPLE) {
    assert.deepEqual(
      resolvePlaceSlug(placeSlug(country), COUNTRY_SAMPLE, CITY_SAMPLE),
      { country, city: null },
      `country ${country}`,
    );
  }
});

test('resolvePlaceSlug: country wins over an identically-slugged city (Hong Kong)', () => {
  // 'Hong Kong' is both a seeded country and a plausible city; the country must win (§4).
  assert.deepEqual(
    resolvePlaceSlug('hong-kong', COUNTRY_SAMPLE, CITY_SAMPLE),
    { country: 'Hong Kong', city: null },
  );
});

test('resolvePlaceSlug: city-only slug resolves to a city', () => {
  assert.deepEqual(
    resolvePlaceSlug('tokyo', COUNTRY_SAMPLE, CITY_SAMPLE),
    { country: null, city: 'Tokyo' },
  );
  assert.deepEqual(
    resolvePlaceSlug('ho-chi-minh-city', COUNTRY_SAMPLE, CITY_SAMPLE),
    { country: null, city: 'Ho Chi Minh City' },
  );
});

test('resolvePlaceSlug: null for an unknown slug', () => {
  assert.equal(resolvePlaceSlug('atlantis', COUNTRY_SAMPLE, CITY_SAMPLE), null);
  assert.equal(resolvePlaceSlug('', COUNTRY_SAMPLE, CITY_SAMPLE), null);
});
