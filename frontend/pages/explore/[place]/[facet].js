// pages/explore/[place]/[facet].js — the Explore place+facet page (EXPLORE-LAYER-PLAN §6/§7).
// Thin SSR page: verify the App Proxy signature, resolve BOTH the [place] and [facet]
// slugs against live data (404 if either matches nothing), fetch the first grid page for
// the combined filter, then render the shell + on-page filters. Phase E adds the real SEO
// head: title = H1 + " | 88 Bamboo Events", meta description, canonical, CollectionPage/
// BreadcrumbList JSON-LD, and the D2 robots gate (index,follow if ≥3 upcoming events OR
// the path is owner-force_index'd, else noindex,follow) — replacing Phase D's placeholder.
import Head from 'next/head';

import WithLayout from '@/components/WithLayout';
import { Main } from '@/components/layouts';
import ExplorePageShell from '@/components/views/publicPages/Explore/ExplorePageShell';
import ExploreFilters from '@/components/views/publicPages/Explore/ExploreFilters';
import { isPathForceIndexed, loadExploreContext } from '@/core/utils/exploreData';
import { facetH1, facetSlug, placeSlug } from '@/core/utils/exploreFacets';
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

  // D2 robots gate: index if the facet clears the ≥3-events threshold OR the owner
  // pinned this exact path on the sitemap allowlist with force_index.
  const path = `${placeSlug(context.placeDisplay)}/${facetSlug(context.facet)}`;
  const forced =
    context.upcomingCount < INDEX_THRESHOLD ? await isPathForceIndexed(path) : false;
  const indexable = context.upcomingCount >= INDEX_THRESHOLD || forced;

  return { props: { context, initialQuery, indexable } };
}

function FacetView({ context, initialQuery, indexable }) {
  const { place, placeDisplay, facet, events, upcomingCount, categoryLabels, formatLabels } =
    context;

  const h1 = facetH1(placeDisplay, facet);
  const title = `${h1} | 88 Bamboo Events`;
  // The H1's leading phrase (H1 minus " in {place}") is the facet's display name — reused
  // for the intro, meta description and breadcrumb, so nothing re-derives the slug/H1 here.
  const facetPhrase = h1.replace(` in ${placeDisplay}`, '');
  const intro =
    `Discover upcoming ${facetPhrase.toLowerCase()} in ${placeDisplay} — ${upcomingCount} ` +
    `${upcomingCount === 1 ? 'event' : 'events'} from the 88 Bamboo drinks & hospitality board.`;
  const description =
    `Find ${upcomingCount} upcoming ${facetPhrase.toLowerCase()} in ${placeDisplay} — ` +
    `${upcomingCount === 1 ? 'event' : 'events'} from the 88 Bamboo drinks & hospitality board.`;

  const pSlug = placeSlug(placeDisplay);
  const fSlug = facetSlug(facet);
  const canonical = exploreCanonicalUrl(pSlug, fSlug);

  const crumbs = [
    { label: 'Home', href: STORE_ROOT, external: true },
    { label: 'Events', href: '/' },
    { label: 'Explore', href: '/explore' },
    { label: placeDisplay, href: `/explore/${pSlug}` },
    { label: facetPhrase },
  ];

  const jsonLd = [
    buildCollectionPageJsonLd({ name: h1, url: canonical, description, events }),
    buildBreadcrumbListJsonLd([
      { name: 'Home', url: STORE_ROOT },
      { name: 'Events', url: CANONICAL_BASE },
      { name: 'Explore', url: exploreCanonicalUrl() },
      { name: placeDisplay, url: exploreCanonicalUrl(pSlug) },
      { name: facetPhrase, url: canonical },
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
