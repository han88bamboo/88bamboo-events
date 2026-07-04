// pages/admin/index.js — /a/events/admin. The backstage review dashboard (plan §6).
//
// Reachable BOTH ways: directly at the backstage origin (events.88bamboo.co /
// localhost:8080) AND through the Shopify proxy on the apex
// (88bamboo.co/a/events/admin). Because the proxy STRIPS cookies (plan §4), the
// page cannot rely on an SSR cookie guard — through the proxy the cookie never
// survives, so an SSR guard would loop back to /admin/login forever. Instead the
// session is gated CLIENT-SIDE from the localStorage token (AdminDashboard's
// mount effect redirects to /admin/login when there is no token). Real security
// is unchanged: every money/listing API action is still verified server-side by
// the Bearer token (plan §5.3 carve-out) — the client guard is only page UX.
import Head from 'next/head';

import AdminDashboard from '@/components/views/admin/AdminDashboard';

function AdminDashboardPage() {
  return (
    <>
      <Head>
        <title>Admin dashboard — 88 Bamboo Events</title>
        <meta name="robots" content="noindex, nofollow" />
      </Head>
      <AdminDashboard />
    </>
  );
}

export default AdminDashboardPage;
