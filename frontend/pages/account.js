// pages/account.js — /a/events/account. Entry point to the customer "manage my
// listings" dashboard (plan §7). Enter the email you submitted with; the backend
// emails a 24h magic link to a page listing all your events. The response is
// always generic (anti-enumeration), so we never confirm whether an email is on
// file.
import Head from 'next/head';
import { useRouter } from 'next/router';
import { useState } from 'react';

import WithLayout from '@/components/WithLayout';
import { Main } from '@/components/layouts';
import { accountService } from '@/core/services/account';
import { verifyProxyRequest } from '@/core/utils/shopifyProxy';

export async function getServerSideProps(ctx) {
  const { valid } = verifyProxyRequest(ctx);
  if (!valid) return { notFound: true };
  return { props: {} };
}

function AccountView() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await accountService.requestLink(email.trim());
      setSent(true);
    } finally {
      setSubmitting(false);
    }
  };

  if (sent) {
    return (
      <main className="container py-5" style={{ maxWidth: 620 }}>
        <div className="alert alert-success">
          <h4 className="alert-heading">Check your email</h4>
          <p className="mb-0">
            If that email has any listings with us, we&apos;ve sent a secure link
            to manage them all. It expires in 24 hours.
          </p>
        </div>
        <button className="btn btn-outline-secondary" onClick={() => router.push('/')}>
          Back to events
        </button>
      </main>
    );
  }

  return (
    <main className="container py-5" style={{ maxWidth: 620 }}>
      <h1 className="tw-text-bamboo-slate mb-3" style={{ fontFamily: 'Buenard, Georgia, "Times New Roman", serif' }}>
        Manage your listings
      </h1>
      <p className="text-muted">
        Enter the email you submitted with and we&apos;ll send you a secure link to
        view and manage every event you&apos;ve listed — pending, live, and past.
      </p>
      <form onSubmit={onSubmit}>
        <div className="mb-3">
          <label className="form-label" htmlFor="email">Your email</label>
          <input
            id="email"
            type="email"
            className="form-control"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <button type="submit" className="btn bamboo-btn" disabled={submitting}>
          {submitting ? 'Sending…' : 'Email me a manage link'}
        </button>
      </form>
    </main>
  );
}

export default function AccountPage(props) {
  return (
    <>
      <Head>
        <title>Manage your listings — 88 Bamboo Events</title>
        <meta name="robots" content="noindex" />
      </Head>
      <WithLayout layout={Main} component={AccountView} {...props} />
    </>
  );
}
