// pages/admin/login.js — /a/events/admin/login. Backstage login page (plan §5.3).
//
// Reachable BOTH ways: directly at the backstage origin (events.88bamboo.co /
// localhost:8080) AND through the Shopify proxy on the apex
// (88bamboo.co/a/events/admin/login). The proxy STRIPS cookies (plan §4), so
// there is no SSR cookie guard here — the "already signed in, skip the form"
// redirect is done CLIENT-SIDE from the localStorage token (in AdminLogin).
import Head from 'next/head';

import AdminLogin from '@/components/views/admin/AdminLogin';

function AdminLoginPage() {
  return (
    <>
      <Head>
        <title>Admin sign in — 88 Bamboo Events</title>
        <meta name="robots" content="noindex, nofollow" />
      </Head>
      <AdminLogin />
    </>
  );
}

export default AdminLoginPage;
