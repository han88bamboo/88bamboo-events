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
import { eventCanonicalUrl, listingCanonicalUrl } from '@/core/utils/seo';

function buildSitemap(events) {
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

  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
    listingEntry +
    eventEntries +
    '</urlset>'
  );
}

export async function getServerSideProps({ res }) {
  let events = [];
  try {
    // when=all so past-dated published events (which stay indexable) are included.
    events = await eventsService.getListing({ when: 'all', limit: 100 });
  } catch {
    events = [];
  }

  res.setHeader('Content-Type', 'application/xml');
  res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate');
  res.write(buildSitemap(events));
  res.end();

  return { props: {} };
}

// No visible output — the response is written in getServerSideProps.
export default function SiteMap() {
  return null;
}
