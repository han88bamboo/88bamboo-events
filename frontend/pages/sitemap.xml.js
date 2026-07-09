// pages/sitemap.xml.js — the events sitemap at /a/events/sitemap.xml (plan §8,
// SPEC §B3 sitemap.xml.js pattern). Lists every PUBLISHED event's canonical apex
// URL for Google Search Console. Rendered as a page route that writes XML to the
// response and returns no React output (the SPEC's machine-route-as-page shape).
//
// Machine route: we deliberately do NOT run the App Proxy signature guard here —
// a sitemap is fully public and must always be fetchable by crawlers.
//
// Scale note: the listing feed caps at 100 rows, so this single sitemap covers up
// to 100 events. If the board outgrows that, split into paginated child sitemaps
// (SPEC §B3 /sitemap-listings/[page]) behind a sitemap index — the growth path.
import { eventsService } from '@/core/services/events';
import { eventCanonicalUrl, exploreCanonicalUrl, listingCanonicalUrl } from '@/core/utils/seo';

function buildSitemap(events, exploreSlugs) {
  const listingEntry =
    `<url><loc>${listingCanonicalUrl()}</loc><changefreq>daily</changefreq></url>`;

  const eventEntries = events
    .filter((e) => e.slug)
    .map((e) => {
      const lastmod = e.created_at
        ? `<lastmod>${new Date(e.created_at).toISOString()}</lastmod>`
        : '';
      return `<url><loc>${eventCanonicalUrl(e.slug)}</loc>${lastmod}<changefreq>weekly</changefreq></url>`;
    })
    .join('');

  // Explore layer (EXPLORE-LAYER-PLAN §7, D2): the hub + the OWNER-CURATED allowlist
  // only — NOT every auto-generated place/facet (that would risk flooding Google with
  // thin pages). The public /events/explore-slugs read already returns only promoted
  // paths that currently resolve, each below /explore (e.g. 'singapore/wine-tastings').
  const exploreHubEntry =
    `<url><loc>${exploreCanonicalUrl()}</loc><changefreq>daily</changefreq></url>`;
  const exploreEntries = (exploreSlugs || [])
    .filter((s) => s.path)
    .map((s) => `<url><loc>${CANONICAL_BASE_EXPLORE}/${s.path}</loc><changefreq>weekly</changefreq></url>`)
    .join('');

  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
    listingEntry +
    exploreHubEntry +
    exploreEntries +
    eventEntries +
    '</urlset>'
  );
}

// The apex '/a/events/explore' prefix a promoted allowlist path (below /explore) hangs
// off — exploreCanonicalUrl() with no args, reused for every promoted row.
const CANONICAL_BASE_EXPLORE = exploreCanonicalUrl();

export async function getServerSideProps({ res }) {
  let events = [];
  let exploreSlugs = [];
  try {
    // when=all so past-dated published events (which stay indexable) are included.
    // Explore slugs read in parallel; the public endpoint returns only resolving paths.
    [events, exploreSlugs] = await Promise.all([
      eventsService.getListing({ when: 'all', limit: 100 }),
      eventsService.getExploreSlugs(),
    ]);
  } catch {
    events = [];
    exploreSlugs = [];
  }

  res.setHeader('Content-Type', 'application/xml');
  res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate');
  res.write(buildSitemap(events, exploreSlugs));
  res.end();

  return { props: {} };
}

// No visible output — the response is written in getServerSideProps.
export default function SiteMap() {
  return null;
}
