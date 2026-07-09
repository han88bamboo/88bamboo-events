// pages/index.js — the /a/events listing page (plan §8). Thin page (SPEC §B3.2.5):
// verify the App Proxy signature (no-op locally), fetch the first page of events
// + taxonomy + country options SSR (so the grid is crawlable), then render the
// EventListing view inside the Main layout.
import Head from 'next/head';

import WithLayout from '@/components/WithLayout';
import { Main } from '@/components/layouts';
import EventListing from '@/components/views/publicPages/EventListing';
import { eventsService } from '@/core/services/events';
import { submissionsService } from '@/core/services/submissions';
import { listingCanonicalUrl } from '@/core/utils/seo';
import { verifyProxyRequest } from '@/core/utils/shopifyProxy';

// The listing filters we honour from the initial URL query (deep-linkable).
const QUERY_KEYS = [
  'q', 'category', 'format', 'country', 'city',
  'date_from', 'date_to', 'when', 'preferred_country',
];

// D7 cannibalisation (EXPLORE-LAYER-PLAN §3 D7A): the BARE board stays indexable, but a
// filtered query-param state must NOT compete with the Explore pages for the same query,
// so it gets noindex,follow. "Filtered" = any of these params present, or a non-default
// `when` — i.e. anything beyond the implicit `when=upcoming` default.
const FILTER_KEYS = [
  'q', 'category', 'format', 'country', 'city', 'date_from', 'date_to', 'preferred_country',
];

export async function getServerSideProps(ctx) {
  // App Proxy guard — pass-through locally (SHOPIFY_PROXY_VERIFY=false).
  const { valid } = verifyProxyRequest(ctx);
  if (!valid) return { notFound: true };

  // Seed the filters from the URL so a shared/deep link renders server-side.
  const initialFilters = {};
  QUERY_KEYS.forEach((k) => {
    if (ctx.query[k]) initialFilters[k] = String(ctx.query[k]);
  });
  if (!initialFilters.when) initialFilters.when = 'upcoming';

  let initialEvents = [];
  let taxonomy = { drink_categories: [], event_formats: [] };
  let countries = [];
  try {
    [initialEvents, taxonomy, countries] = await Promise.all([
      eventsService.getListing(initialFilters),
      submissionsService.getTaxonomy(),
      eventsService.getCountries(),
    ]);
  } catch {
    // Degrade gracefully: render an empty board if the API is unreachable.
  }

  return { props: { initialEvents, taxonomy, countries, initialFilters } };
}

function ListingPage(props) {
  const { initialFilters = {} } = props;
  const filtered =
    initialFilters.when !== 'upcoming' || FILTER_KEYS.some((k) => initialFilters[k]);

  return (
    <>
      <Head>
        <title>Find, Attend &amp; List Events — 88 Bamboo</title>
        <meta
          name="description"
          content="Discover upcoming drinks and hospitality events worldwide — tastings, masterclasses, bar takeovers and more on the 88 Bamboo events board."
        />
        {/* Filtered query-param states are noindex,follow (D7A) — the canonical below
            still points at the bare board, so equity consolidates there. */}
        {filtered && <meta name="robots" content="noindex,follow" />}
        <link rel="canonical" href={listingCanonicalUrl()} />
      </Head>
      <WithLayout layout={Main} component={EventListing} {...props} />
    </>
  );
}

export default ListingPage;
