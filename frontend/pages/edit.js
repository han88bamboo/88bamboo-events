// pages/edit.js — /a/events/edit?token=… The magic-link edit page (plan §7). The
// token is read from the URL (cookie-free — the App Proxy strips cookies). SSR
// resolves the token to the current content + fetches the taxonomy so the form is
// prefilled and its selects populated; an invalid/expired token 404s.
import Head from 'next/head';

import WithLayout from '@/components/WithLayout';
import { Main } from '@/components/layouts';
import EditEvent from '@/components/views/publicPages/EditEvent';
import { editsService } from '@/core/services/edits';
import { submissionsService } from '@/core/services/submissions';
import { verifyProxyRequest } from '@/core/utils/shopifyProxy';

export async function getServerSideProps(ctx) {
  const { valid } = verifyProxyRequest(ctx);
  if (!valid) return { notFound: true };

  const token = ctx.query.token ? String(ctx.query.token) : '';
  if (!token) return { notFound: true };

  let context = null;
  let taxonomy = { drink_categories: [], event_formats: [] };
  try {
    const [ctxRes, tax] = await Promise.all([
      editsService.getContext(token),
      submissionsService.getTaxonomy(),
    ]);
    context = ctxRes.data?.data || null;
    taxonomy = tax;
  } catch {
    context = null;
  }

  // Missing/expired token (backend 404) -> render the not-found page.
  if (!context) return { notFound: true };

  return { props: { token, context, taxonomy } };
}

export default function EditPage(props) {
  return (
    <>
      <Head>
        <title>Edit your event — 88 Bamboo Events</title>
        <meta name="robots" content="noindex" />
      </Head>
      <WithLayout layout={Main} component={EditEvent} {...props} />
    </>
  );
}
