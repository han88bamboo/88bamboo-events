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
  return (
    <>
      <Head>
        <title>Drinks &amp; hospitality events — 88 Bamboo</title>
        <meta
          name="description"
          content="Discover upcoming drinks and hospitality events worldwide — tastings, masterclasses, bar takeovers and more on the 88 Bamboo events board."
        />
        <link rel="canonical" href={listingCanonicalUrl()} />
      </Head>
      <WithLayout layout={Main} component={EventListing} {...props} />
    </>
  );
}

export default ListingPage;
