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

  // Fetch the taxonomy SSR, retrying a few times: a single transient API blip
  // must not render an empty form (the SubmitEvent view also self-heals client-
  // side, but retrying here keeps the first paint correct). An empty result is
  // treated as a miss worth retrying.
  let taxonomy = { drink_categories: [], event_formats: [] };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const t = await submissionsService.getTaxonomy();
      if (t && (t.event_formats?.length || t.drink_categories?.length)) {
        taxonomy = t;
        break;
      }
    } catch {
      // fall through to the retry/backoff below
    }
    if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 250));
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

  // EP-7 login: an OPTIONAL account token (from the emailed /submit?token=… link)
  // authenticates the submitter so they can set a public organiser name. Resolve
  // it SSR to { email, organiser_names } so the form renders the logged-in state
  // from the first paint. Anonymous submits (no token) are unaffected (F-D1).
  let auth = null;
  if (token) {
    try {
      const res = await accountService.getOrganisers(String(token));
      const payload = res.data?.data;
      if (payload?.email) {
        auth = {
          token: String(token),
          email: payload.email,
          organiser_names: payload.organiser_names || [],
        };
      }
    } catch {
      auth = null;
    }
  }

  return { props: { taxonomy, prefill, auth } };
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
