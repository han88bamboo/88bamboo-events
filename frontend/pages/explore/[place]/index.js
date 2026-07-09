// pages/explore/[place]/index.js — the Explore place landing page (EXPLORE-LAYER-PLAN §6).
// Thin SSR page: verify the App Proxy signature, resolve the [place] slug against the
// live published places, fetch the first grid page for that place, then render the shell
// + on-page filters. Phase D sets a placeholder <title> and UNCONDITIONAL noindex,follow —
// the real ≥3-events / allowlist robots gating + canonical + JSON-LD are Phase E.
import Head from 'next/head';

import WithLayout from '@/components/WithLayout';
import { Main } from '@/components/layouts';
import ExplorePageShell from '@/components/views/publicPages/Explore/ExplorePageShell';
import ExploreFilters from '@/components/views/publicPages/Explore/ExploreFilters';
import { loadExploreContext } from '@/core/utils/exploreData';
import { verifyProxyRequest } from '@/core/utils/shopifyProxy';

const STORE_ROOT = process.env.NEXT_PUBLIC_BASE_URL || 'https://www.88bamboo.co';
const ON_PAGE_KEYS = ['category', 'format', 'date'];

export async function getServerSideProps(ctx) {
  const { valid } = verifyProxyRequest(ctx);
  if (!valid) return { notFound: true };

  const placeParam = String(ctx.params.place || '');
  let context;
  try {
    context = await loadExploreContext(placeParam);
  } catch {
    return { notFound: true }; // API unreachable — can't validate the slug
  }
  if (!context) return { notFound: true }; // slug matches no published place

  const initialQuery = {};
  ON_PAGE_KEYS.forEach((k) => {
    if (ctx.query[k]) initialQuery[k] = String(ctx.query[k]);
  });

  return { props: { context, initialQuery } };
}

function PlaceView({ context, initialQuery }) {
  const { place, placeDisplay, events, upcomingCount, categoryLabels, formatLabels } = context;

  const h1 = `Explore ${placeDisplay} Events and Things to do in ${placeDisplay}`;
  const intro =
    `Discover upcoming events in ${placeDisplay} — ${upcomingCount} ` +
    `${upcomingCount === 1 ? 'event' : 'events'} from the 88 Bamboo drinks & hospitality board.`;

  const crumbs = [
    { label: 'Home', href: STORE_ROOT, external: true },
    { label: 'Events', href: '/' },
    { label: 'Explore', href: '/explore' },
    { label: placeDisplay },
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
          facet={null}
          drinkCategories={categoryLabels}
          eventFormats={formatLabels}
          initialQuery={initialQuery}
        />
      </ExplorePageShell>
    </>
  );
}

function PlacePage(props) {
  return <WithLayout layout={Main} component={PlaceView} {...props} />;
}

export default PlacePage;
