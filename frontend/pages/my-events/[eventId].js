// pages/my-events/[eventId].js — /a/events/my-events/<id>?token=… A single owned
// listing's management page (plan §7). SSR-resolves the account token + verifies
// ownership of this event; fetches the taxonomy for the inline edit form. An
// invalid token or a listing not owned by the token's email 404s. Private
// (noindex), cookie-free (token in the URL).
import Head from 'next/head';

import WithLayout from '@/components/WithLayout';
import { Main } from '@/components/layouts';
import ManageEvent from '@/components/views/publicPages/ManageEvent';
import { accountService } from '@/core/services/account';
import { submissionsService } from '@/core/services/submissions';
import { verifyProxyRequest } from '@/core/utils/shopifyProxy';

export async function getServerSideProps(ctx) {
  const { valid } = verifyProxyRequest(ctx);
  if (!valid) return { notFound: true };

  const token = ctx.query.token ? String(ctx.query.token) : '';
  const eventId = ctx.params.eventId;
  if (!token) return { notFound: true };

  let data = null;
  let taxonomy = { drink_categories: [], event_formats: [] };
  try {
    const [evRes, tax] = await Promise.all([
      accountService.getEvent(token, eventId),
      submissionsService.getTaxonomy(),
    ]);
    data = evRes.data?.data || null;
    taxonomy = tax;
  } catch {
    data = null;
  }

  if (!data) return { notFound: true };

  return { props: { token, eventId, data, taxonomy } };
}

export default function ManageEventPage(props) {
  return (
    <>
      <Head>
        <title>Manage listing — 88 Bamboo Events</title>
        <meta name="robots" content="noindex" />
      </Head>
      <WithLayout layout={Main} component={ManageEvent} {...props} />
    </>
  );
}
