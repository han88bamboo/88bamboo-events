// pages/explore/[place]/[facet].js — the Explore place+facet page (EXPLORE-LAYER-PLAN §6).
// Thin SSR page: verify the App Proxy signature, resolve BOTH the [place] and [facet]
// slugs against live data (404 if either matches nothing), fetch the first grid page for
// the combined filter, then render the shell + on-page filters. Phase D: placeholder
// <title> from facetH1 + UNCONDITIONAL noindex,follow (real gating/canonical/JSON-LD = Phase E).
import Head from 'next/head';

import WithLayout from '@/components/WithLayout';
import { Main } from '@/components/layouts';
import ExplorePageShell from '@/components/views/publicPages/Explore/ExplorePageShell';
import ExploreFilters from '@/components/views/publicPages/Explore/ExploreFilters';
import { loadExploreContext } from '@/core/utils/exploreData';
import { facetH1, placeSlug } from '@/core/utils/exploreFacets';
import { verifyProxyRequest } from '@/core/utils/shopifyProxy';

const STORE_ROOT = process.env.NEXT_PUBLIC_BASE_URL || 'https://www.88bamboo.co';
const ON_PAGE_KEYS = ['category', 'format', 'date'];

export async function getServerSideProps(ctx) {
  const { valid } = verifyProxyRequest(ctx);
  if (!valid) return { notFound: true };

  const placeParam = String(ctx.params.place || '');
  const facetParam = String(ctx.params.facet || '');
  let context;
  try {
    context = await loadExploreContext(placeParam, facetParam);
  } catch {
    return { notFound: true }; // API unreachable — can't validate the slugs
  }
  if (!context) return { notFound: true }; // place OR facet resolves to nothing

  const initialQuery = {};
  ON_PAGE_KEYS.forEach((k) => {
    if (ctx.query[k]) initialQuery[k] = String(ctx.query[k]);
  });

  return { props: { context, initialQuery } };
}

function FacetView({ context, initialQuery }) {
  const { place, placeDisplay, facet, events, upcomingCount, categoryLabels, formatLabels } =
    context;

  const h1 = facetH1(placeDisplay, facet);
  // The H1's leading phrase (H1 minus " in {place}") is the facet's display name — reused
  // for the intro and the breadcrumb, so nothing re-derives the slug/H1 machinery here.
  const facetPhrase = h1.replace(` in ${placeDisplay}`, '');
  const intro =
    `Discover upcoming ${facetPhrase.toLowerCase()} in ${placeDisplay} — ${upcomingCount} ` +
    `${upcomingCount === 1 ? 'event' : 'events'} from the 88 Bamboo drinks & hospitality board.`;

  const crumbs = [
    { label: 'Home', href: STORE_ROOT, external: true },
    { label: 'Events', href: '/' },
    { label: 'Explore', href: '/explore' },
    { label: placeDisplay, href: `/explore/${placeSlug(placeDisplay)}` },
    { label: facetPhrase },
  ];

  return (
    <>
      <Head>
        <title>{h1}</title>
        <meta name="robots" content="noindex,follow" />
      </Head>
      <ExplorePageShell crumbs={crumbs} h1={h1} intro={intro}>
        <ExploreFilters
          initialEvents={events}
          place={place}
          facet={facet}
          drinkCategories={categoryLabels}
          eventFormats={formatLabels}
          initialQuery={initialQuery}
        />
      </ExplorePageShell>
    </>
  );
}

function FacetPage(props) {
  return <WithLayout layout={Main} component={FacetView} {...props} />;
}

export default FacetPage;
