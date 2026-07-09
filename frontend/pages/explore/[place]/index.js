// pages/explore/[place]/index.js — the Explore place landing page (EXPLORE-LAYER-PLAN §6/§7).
// Thin SSR page: verify the App Proxy signature, resolve the [place] slug against the
// live published places, fetch the first grid page for that place, then render the shell
// + facet interlinks + on-page filters. Phase E adds the real SEO head: title suffix,
// meta description, canonical, CollectionPage/BreadcrumbList JSON-LD, and the D2 robots
// gate (index,follow if ≥3 upcoming events OR the path is owner-force_index'd, else
// noindex,follow) — replacing Phase D's placeholder title + hardcoded noindex.
import Head from 'next/head';

import WithLayout from '@/components/WithLayout';
import { Main } from '@/components/layouts';
import ExplorePageShell from '@/components/views/publicPages/Explore/ExplorePageShell';
import ExploreFilters from '@/components/views/publicPages/Explore/ExploreFilters';
import FacetLinks from '@/components/views/publicPages/Explore/FacetLinks';
import { isPathForceIndexed, loadExploreContext } from '@/core/utils/exploreData';
import { categoryFacetSlug, formatFacetSlug, placeSlug } from '@/core/utils/exploreFacets';
import {
  CANONICAL_BASE,
  buildBreadcrumbListJsonLd,
  buildCollectionPageJsonLd,
  exploreCanonicalUrl,
} from '@/core/utils/seo';
import { verifyProxyRequest } from '@/core/utils/shopifyProxy';

const STORE_ROOT = process.env.NEXT_PUBLIC_BASE_URL || 'https://www.88bamboo.co';
const ON_PAGE_KEYS = ['category', 'format', 'date'];
// Below this many upcoming events a page emits noindex,follow unless force_index'd (D2).
const INDEX_THRESHOLD = 3;

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

  // D2 robots gate: index if the place clears the ≥3-events threshold OR the owner
  // pinned this exact path on the sitemap allowlist with force_index.
  const path = placeSlug(context.placeDisplay);
  const forced =
    context.upcomingCount < INDEX_THRESHOLD ? await isPathForceIndexed(path) : false;
  const indexable = context.upcomingCount >= INDEX_THRESHOLD || forced;

  return { props: { context, initialQuery, indexable } };
}

function PlaceView({ context, initialQuery, indexable }) {
  const { place, placeDisplay, events, upcomingCount, categoryLabels, formatLabels } = context;

  const h1 = `Explore ${placeDisplay} Events and Things to do in ${placeDisplay}`;
  const title = `${h1} | 88 Bamboo Events`;
  const intro =
    `Discover upcoming events in ${placeDisplay} — ${upcomingCount} ` +
    `${upcomingCount === 1 ? 'event' : 'events'} from the 88 Bamboo drinks & hospitality board.`;
  const description =
    `Browse ${upcomingCount} upcoming drinks & hospitality ${upcomingCount === 1 ? 'event' : 'events'} ` +
    `in ${placeDisplay} — tastings, masterclasses, bar takeovers and more on the 88 Bamboo events board.`;

  const pSlug = placeSlug(placeDisplay);
  const canonical = exploreCanonicalUrl(pSlug);

  // Real, crawlable facet links: only the category/format axes actually present in this
  // place's events (D3 — pair facets are not auto-linked). Derived from the SSR grid so
  // no extra request and no links to empty facet pages.
  const categoryFacets = categoryLabels
    .filter((c) => events.some((e) => (e.drink_categories || []).includes(c)))
    .map((c) => ({ slug: categoryFacetSlug(c), label: c }));
  const formatFacets = formatLabels
    .filter((f) => events.some((e) => e.event_format === f))
    .map((f) => ({ slug: formatFacetSlug(f), label: f }));

  const crumbs = [
    { label: 'Home', href: STORE_ROOT, external: true },
    { label: 'Events', href: '/' },
    { label: 'Explore', href: '/explore' },
    { label: placeDisplay },
  ];

  const jsonLd = [
    buildCollectionPageJsonLd({ name: h1, url: canonical, description, events }),
    buildBreadcrumbListJsonLd([
      { name: 'Home', url: STORE_ROOT },
      { name: 'Events', url: CANONICAL_BASE },
      { name: 'Explore', url: exploreCanonicalUrl() },
      { name: placeDisplay, url: canonical },
    ]),
  ];

  return (
    <>
      <Head>
        <title>{title}</title>
        <meta name="description" content={description} />
        <meta name="robots" content={indexable ? 'index,follow' : 'noindex,follow'} />
        <link rel="canonical" href={canonical} />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </Head>
      <ExplorePageShell crumbs={crumbs} h1={h1} intro={intro}>
        <FacetLinks placeSlugValue={pSlug} categories={categoryFacets} formats={formatFacets} />
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
