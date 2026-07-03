// pages/admin/login.js — /a/events/admin/login. Backstage login page (plan §5.3).
//
// Opened DIRECTLY at the backstage origin (locally http://localhost:8080/a/events/
// admin/login), NOT through the Shopify proxy — the proxy strips cookies and the
// admin session needs them (plan §4). So there is NO verifyProxyRequest here.
//
// SSR guard (mirrors §A6): if the admin session cookie is already present, skip
// the login form and go straight to the dashboard.
import Head from 'next/head';

import AdminLogin from '@/components/views/admin/AdminLogin';
import { hasAdminCookie } from '@/core/utils/adminCookie';

export function getServerSideProps(ctx) {
  if (hasAdminCookie(ctx.req)) {
    return { redirect: { destination: '/admin', permanent: false } };
  }
  return { props: {} };
}

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
