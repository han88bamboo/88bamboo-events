// pages/admin/index.js — /a/events/admin. The backstage review dashboard (plan §6).
//
// Opened DIRECTLY at the backstage origin (locally http://localhost:8080/a/events/
// admin), NOT through the Shopify proxy (the proxy strips cookies; the admin
// session needs them — plan §4). So there is NO verifyProxyRequest here.
//
// SSR guard (mirrors §A6): no admin session cookie -> redirect to the login page.
// The cookie only gates PAGE access; the API actions are additionally verified
// server-side (plan §5.3 carve-out) — the cookie alone can't move money.
import Head from 'next/head';

import ReviewQueue from '@/components/views/admin/ReviewQueue';
import { hasAdminCookie } from '@/core/utils/adminCookie';

export function getServerSideProps(ctx) {
  if (!hasAdminCookie(ctx.req)) {
    return { redirect: { destination: '/admin/login', permanent: false } };
  }
  return { props: {} };
}

function AdminDashboardPage() {
  return (
    <>
      <Head>
        <title>Review queue — 88 Bamboo Events</title>
        <meta name="robots" content="noindex, nofollow" />
      </Head>
      <ReviewQueue />
    </>
  );
}

export default AdminDashboardPage;
