// pages/explore/index.js — the Explore hub (EXPLORE-LAYER-PLAN §6/§7). Thin SSR page:
// verify the App Proxy signature, list the top-N places by upcoming-event count (from
// GET /events/places), and link each to its place landing page. Phase E: the hub is the
// indexable entry point (index,follow + canonical + BreadcrumbList JSON-LD), and it now
// also surfaces the owner-promoted allowlist slugs (via the public /events/explore-slugs
// read added this round) so those pages get a crawl path from the hub too.
import Head from 'next/head';
import Link from 'next/link';

import WithLayout from '@/components/WithLayout';
import { Main } from '@/components/layouts';
import { eventsService } from '@/core/services/events';
import { placeSlug } from '@/core/utils/exploreFacets';
import {
  CANONICAL_BASE,
  buildBreadcrumbListJsonLd,
  exploreCanonicalUrl,
} from '@/core/utils/seo';
import { verifyProxyRequest } from '@/core/utils/shopifyProxy';

const TOP_N = 24;

// Humanise an allowlist path ('singapore/wine-tastings') into a readable link label
// ('Singapore / Wine Tastings') — display only, never re-parsed into a slug.
function humanisePath(path) {
  return path
    .split('/')
    .map((seg) => seg.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()))
    .join(' / ');
}

export async function getServerSideProps(ctx) {
  const { valid } = verifyProxyRequest(ctx);
  if (!valid) return { notFound: true };

  let places = [];
  let promoted = [];
  try {
    [places, promoted] = await Promise.all([
      eventsService.getPlaces(),
      eventsService.getExploreSlugs(),
    ]);
  } catch {
    // Degrade gracefully: render an empty hub if the API is unreachable.
  }

  // Collapse to one entry per place slug, preferring the COUNTRY row over a city row
  // (same country-wins rule as resolvePlaceSlug), then take the top-N by count. The
  // aggregate already arrives sorted by upcoming_count desc.
  const bySlug = new Map();
  for (const row of places) {
    if (!row.value) continue;
    const slug = placeSlug(row.value);
    const existing = bySlug.get(slug);
    if (!existing || (existing.kind !== 'country' && row.kind === 'country')) {
      bySlug.set(slug, { slug, label: row.value, kind: row.kind, count: Number(row.upcoming_count) });
    }
  }
  const topPlaces = [...bySlug.values()]
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, TOP_N);

  // Promoted allowlist paths as { path, label } for the "Popular" strip (D2's amplified
  // set). The public read already returns only paths that currently resolve.
  const promotedLinks = (promoted || []).map((s) => ({
    path: s.path,
    label: humanisePath(s.path),
  }));

  return { props: { topPlaces, promotedLinks } };
}

function ExploreHubView({ topPlaces = [], promotedLinks = [] }) {
  const canonical = exploreCanonicalUrl();
  const jsonLd = buildBreadcrumbListJsonLd([
    { name: 'Events', url: CANONICAL_BASE },
    { name: 'Explore', url: canonical },
  ]);

  return (
    <main className="page-width py-5">
      <Head>
        <title>Explore drinks &amp; hospitality events by city — 88 Bamboo</title>
        <meta
          name="description"
          content="Explore upcoming drinks and hospitality events by city — tastings, masterclasses, bar takeovers and more on the 88 Bamboo events board."
        />
        <meta name="robots" content="index,follow" />
        <link rel="canonical" href={canonical} />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </Head>
      <nav aria-label="Breadcrumb" className="mb-3">
        <ol className="breadcrumb small mb-0">
          <li className="breadcrumb-item">
            <Link href="/">Events</Link>
          </li>
          <li className="breadcrumb-item active" aria-current="page">
            Explore
          </li>
        </ol>
      </nav>

      <h1 className="mb-2">Explore drinks &amp; hospitality events by city</h1>
      <p className="text-muted mb-4" style={{ maxWidth: '48rem' }}>
        Browse upcoming tastings, masterclasses, bar takeovers and more across the cities on
        the 88 Bamboo events board. Pick a place to see what&apos;s on.
      </p>

      {topPlaces.length === 0 ? (
        <div className="alert alert-light border text-center py-5">
          No places with upcoming events yet.{' '}
          <Link href="/submit">List the first event.</Link>
        </div>
      ) : (
        <div className="row">
          {topPlaces.map((p) => (
            <div key={p.slug} className="col-sm-6 col-lg-4 mb-3">
              <Link
                href={`/explore/${p.slug}`}
                className="d-block border rounded p-3 h-100 text-decoration-none text-reset"
              >
                <div className="d-flex justify-content-between align-items-center">
                  <span className="fw-semibold">{p.label}</span>
                  <span className="badge bg-light text-dark">
                    {p.count} {p.count === 1 ? 'event' : 'events'}
                  </span>
                </div>
              </Link>
            </div>
          ))}
        </div>
      )}

      {promotedLinks.length > 0 && (
        <div className="mt-4">
          <div className="form-label small mb-2">Popular</div>
          <div className="d-flex flex-wrap gap-2">
            {promotedLinks.map((p) => (
              <Link
                key={p.path}
                href={`/explore/${p.path}`}
                className="badge rounded-pill bg-light text-dark text-decoration-none border"
              >
                {p.label}
              </Link>
            ))}
          </div>
        </div>
      )}

      <p className="text-muted small mt-4">
        Looking for something specific? <Link href="/">Browse the full events board.</Link>
      </p>
    </main>
  );
}

function ExploreHubPage(props) {
  return <WithLayout layout={Main} component={ExploreHubView} {...props} />;
}

export default ExploreHubPage;
