// pages/submit.js — /a/events/submit. Thin page (PATTERN-SPEC §B3.2.5): verify
// the App Proxy signature (no-op locally), fetch the taxonomy SSR so the two
// selects are populated from the DB (plan §7), then render the SubmitEvent view
// inside the Main layout via WithLayout.
import Head from 'next/head';

import WithLayout from '@/components/WithLayout';
import { Main } from '@/components/layouts';
import SubmitEvent from '@/components/views/landingPages/SubmitEvent';
import { accountService } from '@/core/services/account';
import { submissionsService } from '@/core/services/submissions';
import { verifyProxyRequest } from '@/core/utils/shopifyProxy';

export async function getServerSideProps(ctx) {
  // App Proxy guard — pass-through locally (SHOPIFY_PROXY_VERIFY=false).
  const { valid } = verifyProxyRequest(ctx);
  if (!valid) return { notFound: true };

  let taxonomy = { drink_categories: [], event_formats: [] };
  try {
    taxonomy = await submissionsService.getTaxonomy();
  } catch {
    // Leave the selects empty if the API is unreachable; the page still renders.
  }

  // Re-submit flow (plan §7): an archived/withdrawn listing links here with
  // ?resubmit=<id>&token=<account token>. We fetch its fields (ownership checked
  // server-side by the account token) to PRE-FILL a brand-new submission. The
  // image + payment are fresh — only the text fields are carried over.
  let prefill = null;
  const { resubmit, token } = ctx.query;
  if (resubmit && token) {
    try {
      const res = await accountService.getEvent(String(token), String(resubmit));
      prefill = res.data?.data?.event || null;
    } catch {
      prefill = null;
    }
  }

  return { props: { taxonomy, prefill } };
}

function SubmitPage(props) {
  return (
    <>
      <Head>
        <title>List an event — 88 Bamboo Events</title>
        <meta
          name="description"
          content="Submit a drinks or hospitality event to the 88 Bamboo events board."
        />
      </Head>
      <WithLayout layout={Main} component={SubmitEvent} {...props} />
    </>
  );
}

export default SubmitPage;
