// pages/conversation.js — /a/events/conversation?token=… The public submitter
// conversation page (post-launch messaging feature). The token is read from the
// URL (cookie-free — the App Proxy strips cookies). SSR resolves the token to the
// thread; an invalid/expired token 404s. Web-link replies only — the submitter
// reaches this from a link in our email, never by emailing us back.
import Head from 'next/head';

import WithLayout from '@/components/WithLayout';
import { Main } from '@/components/layouts';
import Conversation from '@/components/views/publicPages/Conversation';
import { messagesService } from '@/core/services/messages';
import { verifyProxyRequest } from '@/core/utils/shopifyProxy';

export async function getServerSideProps(ctx) {
  const { valid } = verifyProxyRequest(ctx);
  if (!valid) return { notFound: true };

  const token = ctx.query.token ? String(ctx.query.token) : '';
  if (!token) return { notFound: true };

  let initial = null;
  try {
    const res = await messagesService.getThread(token);
    initial = res.data?.data || null;
  } catch {
    initial = null;
  }

  // Missing/expired token (backend 404) -> render the not-found page.
  if (!initial) return { notFound: true };

  return { props: { token, initial } };
}

export default function ConversationPage({ token, initial }) {
  return (
    <>
      <Head>
        <title>Conversation — 88 Bamboo Events</title>
        <meta name="robots" content="noindex" />
      </Head>
      <WithLayout layout={Main} component={Conversation} token={token} initial={initial} />
    </>
  );
}
