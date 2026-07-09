// pages/explore/index.js — the Explore hub (EXPLORE-LAYER-PLAN §6). Thin SSR page:
// verify the App Proxy signature, list the top-N places by upcoming-event count (from
// GET /events/places), and link each to its place landing page. Phase D: placeholder
// <title> + UNCONDITIONAL noindex,follow; the sitemap/allowlist amplification and the
// full hub↔place↔facet interlinking are Phase E.
//
// NOTE: the plan's "+ owner-allowlisted slugs" on the hub is deferred to Phase E — those
// live in explore_sitemap_slugs, which has no PUBLIC read endpoint yet (only the
// admin-guarded CRUD from Phase C); surfacing them belongs with the Phase E sitemap work.
import Head from 'next/head';
import Link from 'next/link';

import WithLayout from '@/components/WithLayout';
import { Main } from '@/components/layouts';
import { eventsService } from '@/core/services/events';
import { placeSlug } from '@/core/utils/exploreFacets';
import { verifyProxyRequest } from '@/core/utils/shopifyProxy';

const TOP_N = 24;

export async function getServerSideProps(ctx) {
  const { valid } = verifyProxyRequest(ctx);
  if (!valid) return { notFound: true };

  let places = [];
  try {
    places = await eventsService.getPlaces();
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

  return { props: { topPlaces } };
}

function ExploreHubView({ topPlaces = [] }) {
  return (
    <main className="page-width py-5">
      <Head>
        <title>Explore drinks &amp; hospitality events by city — 88 Bamboo</title>
        <meta name="robots" content="noindex,follow" />
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
