// pages/manage.js — /a/events/manage. Where an organiser requests a magic edit
// link for their listing (plan §7). They enter the listing slug (prefilled from
// the detail page's "Request an edit link") + the submitter email; the backend
// emails a 30-minute link if — and only if — the pair matches. The response is
// always generic (anti-enumeration), so the UI never confirms whether an email
// is on file.
import Head from 'next/head';
import { useRouter } from 'next/router';
import { useState } from 'react';

import WithLayout from '@/components/WithLayout';
import { Main } from '@/components/layouts';
import { editsService } from '@/core/services/edits';
import { verifyProxyRequest } from '@/core/utils/shopifyProxy';

export async function getServerSideProps(ctx) {
  const { valid } = verifyProxyRequest(ctx);
  if (!valid) return { notFound: true };
  return { props: { initialSlug: ctx.query.slug ? String(ctx.query.slug) : '' } };
}

function ManageView({ initialSlug }) {
  const router = useRouter();
  const [slug, setSlug] = useState(initialSlug || '');
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await editsService.requestLink(slug.trim(), email.trim());
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
            If that listing and email match, we&apos;ve sent an edit link. It
            expires in 30 minutes. Didn&apos;t get it? Check the address and try
            again.
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
      <h1 className="tw-text-custom-green mb-3" style={{ fontFamily: 'Sora, sans-serif' }}>
        Edit your listing
      </h1>
      <p className="text-muted">
        Enter your listing and the email you submitted with. We&apos;ll email you a
        secure, one-time link to make changes. Edits are free and reviewed before
        they go live.
      </p>
      <form onSubmit={onSubmit}>
        <div className="mb-3">
          <label className="form-label" htmlFor="slug">Listing</label>
          <input
            id="slug"
            className="form-control"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="the-listing-slug"
            required
          />
          <div className="form-text">
            The last part of your event&apos;s web address.
          </div>
        </div>
        <div className="mb-3">
          <label className="form-label" htmlFor="email">Submitter email</label>
          <input
            id="email"
            type="email"
            className="form-control"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <button type="submit" className="btn btn-success" disabled={submitting}>
          {submitting ? 'Sending…' : 'Email me an edit link'}
        </button>
      </form>
    </main>
  );
}

export default function ManagePage(props) {
  return (
    <>
      <Head>
        <title>Edit your listing — 88 Bamboo Events</title>
        {/* Not a page we want indexed. */}
        <meta name="robots" content="noindex" />
      </Head>
      <WithLayout layout={Main} component={ManageView} {...props} />
    </>
  );
}
