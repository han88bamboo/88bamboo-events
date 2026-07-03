// ManageEvent — the owner's single-listing management page (plan §7). Reached by
// clicking a card on the /my-events dashboard. Authorised by the account URL
// token; every action re-checks ownership server-side.
//
// It shows the listing's details plus the actions valid for its state:
//   pending          → Edit, Withdraw (releases the hold, archives)
//   live / past       → Edit, Unpublish (archives)
//   unpublished (self) → Re-publish (once only) — or a note if already used
//   withdrawn / rejected / expired → Re-submit (a fresh paid submission, prefilled)
// Editing happens only after clicking in (never from the grid) and opens the
// shared EditEvent form inline.
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useState } from 'react';

import { accountService } from '@/core/services/account';
import EditEvent from '../EditEvent';
import { statusBadge } from '../MyEvents/MyEvents';
import { formatDateRange } from '../publicFormat';

function ManageEvent({ token, eventId, data, taxonomy }) {
  const router = useRouter();
  const [mode, setMode] = useState('view'); // view | edit
  const [confirm, setConfirm] = useState(null); // 'withdraw' | 'unpublish' | null
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null); // { type, text }

  const ev = data.event;
  const badge = statusBadge({
    current_status: data.current_status,
    archived: data.archived,
    is_past: data.is_past,
  });
  const backHref = `/my-events?token=${encodeURIComponent(token)}`;

  // --- Edit mode: reuse the shared form, wired to the account edit endpoint ---
  if (mode === 'edit') {
    return (
      <EditEvent
        context={{ event: ev, is_published: data.is_published }}
        taxonomy={taxonomy}
        onSubmit={(fields) => accountService.editEvent(token, eventId, fields)}
        onCancel={() => setMode('view')}
      />
    );
  }

  const runAction = async (action) => {
    setBusy(true);
    setNotice(null);
    try {
      const fn = action === 'withdraw' ? accountService.withdraw
        : action === 'unpublish' ? accountService.unpublish
        : accountService.republish;
      const { data: res, ok } = await fn(token, eventId);
      if (!ok) {
        setNotice({ type: 'danger', text: res?.error || 'Something went wrong.' });
        return;
      }
      // Reflect the new state by reloading this page (SSR re-fetches the event).
      router.replace(router.asPath);
      const done = {
        withdraw: 'Your listing has been withdrawn and the card hold released.',
        unpublish: 'Your listing has been unpublished.',
        republish: 'Your listing is live again.',
      }[action];
      setNotice({ type: 'success', text: done });
    } catch {
      setNotice({ type: 'danger', text: 'Could not reach the server. Please try again.' });
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  const status = data.current_status;
  const resubmitHref = `/submit?resubmit=${eventId}&token=${encodeURIComponent(token)}`;

  return (
    <main className="container py-5" style={{ maxWidth: 820 }}>
      <p className="mb-3">
        <Link href={backHref} className="text-decoration-none">&larr; Your listings</Link>
      </p>

      {notice && <div className={`alert alert-${notice.type}`}>{notice.text}</div>}

      <div className="d-flex align-items-center gap-2 mb-2">
        <span className={`badge ${badge.cls}`}>{badge.label}</span>
        {data.is_past && status === 'published' && (
          <span className="text-muted small">This event is over — it stays listed for reference.</span>
        )}
      </div>

      <h1 className="tw-text-custom-green" style={{ fontFamily: 'Sora, sans-serif' }}>{ev.name}</h1>

      {ev.image_url && (
        <img src={ev.image_url} alt={ev.name} className="img-fluid rounded my-3 w-100" style={{ maxHeight: 340, objectFit: 'cover' }} />
      )}

      <dl className="row mb-4">
        <dt className="col-sm-3">When</dt>
        <dd className="col-sm-9">{formatDateRange(ev.start_datetime, ev.end_datetime)}</dd>
        <dt className="col-sm-3">Where</dt>
        <dd className="col-sm-9">{[ev.venue_name, ev.city, ev.country].filter(Boolean).join(', ') || '—'}</dd>
        <dt className="col-sm-3">Format</dt>
        <dd className="col-sm-9">{ev.event_format || '—'}</dd>
        <dt className="col-sm-3">Categories</dt>
        <dd className="col-sm-9">{(ev.drink_categories || []).join(', ') || '—'}</dd>
      </dl>

      {/* Confirmation banner for destructive actions */}
      {confirm && (
        <div className="alert alert-warning">
          <p className="mb-2">
            {confirm === 'withdraw'
              ? 'Withdraw this pending listing? The card hold will be released (no charge) and it will be archived. To bring it back you would re-submit and pay again.'
              : 'Unpublish this live listing? It will be taken off the public board. You can re-publish it once.'}
          </p>
          <button className="btn btn-danger btn-sm me-2" disabled={busy} onClick={() => runAction(confirm)}>
            {busy ? 'Working…' : `Yes, ${confirm}`}
          </button>
          <button className="btn btn-outline-secondary btn-sm" disabled={busy} onClick={() => setConfirm(null)}>
            Cancel
          </button>
        </div>
      )}

      {/* Action bar, by state */}
      {!confirm && (
        <div className="d-flex flex-wrap gap-2">
          {status === 'pending_review' && (
            <>
              <button className="btn btn-success" onClick={() => setMode('edit')}>Edit</button>
              <button className="btn btn-outline-danger" onClick={() => setConfirm('withdraw')}>Withdraw</button>
            </>
          )}

          {status === 'published' && (
            <>
              <button className="btn btn-success" onClick={() => setMode('edit')}>Edit</button>
              {data.slug && (
                <Link href={`/${data.slug}`} className="btn btn-outline-secondary">View public page</Link>
              )}
              <button className="btn btn-outline-danger" onClick={() => setConfirm('unpublish')}>Unpublish</button>
            </>
          )}

          {status === 'unpublished' && data.can_republish && (
            <button className="btn btn-success" disabled={busy} onClick={() => runAction('republish')}>
              {busy ? 'Working…' : 'Re-publish'}
            </button>
          )}
          {status === 'unpublished' && !data.can_republish && (
            <p className="text-muted mb-0">
              {data.archived
                ? "You've already re-published this listing once. Contact us if you need it live again."
                : 'This listing was removed by an administrator. Contact us if you have questions.'}
            </p>
          )}

          {['withdrawn', 'rejected', 'expired'].includes(status) && (
            <Link href={resubmitHref} className="btn btn-success">Re-submit this event</Link>
          )}
        </div>
      )}

      {['withdrawn', 'rejected', 'expired'].includes(status) && (
        <p className="text-muted small mt-3">
          Re-submitting starts a fresh listing with these details pre-filled. You&apos;ll
          re-upload the image and pay the listing fee again.
        </p>
      )}
    </main>
  );
}

export default ManageEvent;
