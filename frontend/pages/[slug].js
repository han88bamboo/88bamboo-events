// pages/[slug].js — SSR public event detail page at /a/events/<slug> (plan §8,
// SPEC §B3). This is the SEO surface: full server-rendered HTML with <title>,
// meta description, schema.org/Event JSON-LD, and <link rel=canonical> to the
// apex form https://www.88bamboo.co/a/events/<slug>.
//
// Static routes (submit, admin, manage, edit, sitemap.xml) take priority over
// this dynamic segment, so it only ever catches real event slugs.
import Head from 'next/head';

import WithLayout from '@/components/WithLayout';
import { Main } from '@/components/layouts';
import EventDetail from '@/components/views/publicPages/EventDetail';
import { eventsService } from '@/core/services/events';
import {
  buildEventJsonLd,
  eventCanonicalUrl,
  eventMetaDescription,
} from '@/core/utils/seo';
import { dynamicRouteParam } from '@/core/utils/routeParams';
import { verifyProxyRequest } from '@/core/utils/shopifyProxy';

export async function getServerSideProps(ctx) {
  // App Proxy guard — pass-through locally (SHOPIFY_PROXY_VERIFY=false).
  const { valid } = verifyProxyRequest(ctx);
  if (!valid) return { notFound: true };

  const requestedSlug = dynamicRouteParam(ctx, 'slug');

  let event = null;
  try {
    event = await eventsService.getBySlug(requestedSlug);
  } catch {
    event = null;
  }

  // Only published events resolve (the backend gates on current_status). A
  // pending/unpublished/rejected/expired or unknown slug 404s.
  if (!event) return { notFound: true };

  // Canonical-slug enforcement (SPEC §B3): if the URL slug differs from the
  // event's canonical slug (e.g. a different case), 301 to the canonical URL so
  // duplicate URLs don't split SEO equity. basePath is prepended automatically.
  if (event.slug && event.slug !== requestedSlug) {
    return {
      redirect: { destination: `/${event.slug}`, permanent: true },
    };
  }

  // SP-2 "More events" row: a small set of OTHER upcoming events, soonest-first.
  // We over-fetch by one (the current event may be in the list) then drop it and
  // cap at 6. Best-effort only — a failure here must NEVER break the detail page,
  // so it degrades to an empty list and the row simply hides.
  let related = [];
  try {
    const upcoming = await eventsService.getListing({ when: 'upcoming', limit: 7 });
    related = upcoming.filter((e) => e.slug !== event.slug).slice(0, 6);
  } catch {
    related = [];
  }

  return { props: { event, related } };
}

function EventDetailPage({ event, related }) {
  const canonical = eventCanonicalUrl(event.slug);
  const description = eventMetaDescription(event);
  const jsonLd = buildEventJsonLd(event);

  return (
    <>
      <Head>
        <title>{`${event.name} — 88 Bamboo Events`}</title>
        <meta name="description" content={description} />
        <link rel="canonical" href={canonical} />

        {/* Open Graph for rich link previews (uses the same canonical + image). */}
        <meta property="og:type" content="website" />
        <meta property="og:title" content={event.name} />
        <meta property="og:description" content={description} />
        <meta property="og:url" content={canonical} />
        {event.image_url && <meta property="og:image" content={event.image_url} />}

        {/* schema.org/Event JSON-LD (plan §4). */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </Head>
      <WithLayout layout={Main} component={EventDetail} event={event} related={related} />
    </>
  );
}

export default EventDetailPage;
