// pages/my-events/index.js — /a/events/my-events?token=… The customer dashboard
// grid (plan §7). SSR-resolves the account token to all of that email's events;
// an invalid/expired token 404s. Private page (noindex), cookie-free (token in
// the URL — the App Proxy strips cookies).
import Head from 'next/head';

import WithLayout from '@/components/WithLayout';
import { Main } from '@/components/layouts';
import MyEvents from '@/components/views/publicPages/MyEvents';
import { accountService } from '@/core/services/account';
import { verifyProxyRequest } from '@/core/utils/shopifyProxy';

export async function getServerSideProps(ctx) {
  const { valid } = verifyProxyRequest(ctx);
  if (!valid) return { notFound: true };

  const token = ctx.query.token ? String(ctx.query.token) : '';
  if (!token) return { notFound: true };

  let data = null;
  try {
    const res = await accountService.getContext(token);
    data = res.data?.data || null;
  } catch {
    data = null;
  }

  if (!data) return { notFound: true };

  return { props: { token, email: data.email, events: data.events } };
}

export default function MyEventsPage(props) {
  return (
    <>
      <Head>
        <title>Your listings — 88 Bamboo Events</title>
        <meta name="robots" content="noindex" />
      </Head>
      <WithLayout layout={Main} component={MyEvents} {...props} />
    </>
  );
}
