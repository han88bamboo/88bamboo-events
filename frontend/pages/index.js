// pages/index.js — the /a/events landing page (scaffold placeholder).
// Thin page: it verifies the App Proxy signature (no-op locally), fetches the
// backend health over the SSR/internal URL to prove the api-config split works,
// then renders a view inside the Main layout via WithLayout.
import Head from 'next/head';

import WithLayout from '@/components/WithLayout';
import { Main } from '@/components/layouts';
import { eventsService } from '@/core/services/events';
import { verifyProxyRequest } from '@/core/utils/shopifyProxy';

function Landing({ apiHealth }) {
  return (
    <>
      <Head>
        <title>88 Bamboo Events</title>
        <meta name="description" content="Drinks & hospitality events — 88 Bamboo." />
      </Head>
      <main className="container py-5">
        <h1 className="tw-text-custom-green" style={{ fontFamily: 'Sora, sans-serif' }}>
          88 Bamboo Events
        </h1>
        <p className="text-muted">
          Scaffold is live. Public listings, submission flow and admin dashboard
          arrive in later phases.
        </p>
        <p>
          Backend health (via SSR):{' '}
          <code>{apiHealth ? JSON.stringify(apiHealth) : 'unreachable'}</code>
        </p>
      </main>
    </>
  );
}

export async function getServerSideProps(ctx) {
  // App Proxy guard — pass-through locally (SHOPIFY_PROXY_VERIFY=false).
  const { valid } = verifyProxyRequest(ctx);
  if (!valid) return { notFound: true };

  let apiHealth = null;
  try {
    apiHealth = await eventsService.health();
  } catch {
    apiHealth = null;
  }

  return { props: { apiHealth } };
}

export default function IndexPage(props) {
  return <WithLayout layout={Main} component={Landing} {...props} />;
}
