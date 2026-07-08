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
//
// The admin⇄submitter conversation is the third surface onto the same thread (the
// other two: the emailed public page + the admin dashboard). On desktop it sits
// in a sticky right column; on mobile it becomes an Intercom-style launcher pinned
// bottom-right that expands into a bottom sheet.
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useCallback, useEffect, useState } from 'react';

import MessageThread from '@/components/views/MessageThread';
import { accountService } from '@/core/services/account';
import EditEvent from '../EditEvent';
import { statusBadge } from '../MyEvents/MyEvents';
import { formatDateRange } from '../publicFormat';

// Timestamps shown as the organiser entered them (en-GB, fixed UTC) — matches the
// public Conversation page so the same thread reads identically on every surface.
function formatWhen(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-GB', { timeZone: 'UTC' });
}

// Same bell as the MyEvents grid: black outline normally, red when there are
// unread admin messages. Used on the mobile launcher to prompt the submitter.
function BellIcon({ unread }) {
  const color = unread ? '#dc3545' : '#000';
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill={color} aria-hidden="true">
      <path d="M8 16a2 2 0 0 0 2-2H6a2 2 0 0 0 2 2zm.995-14.901a1 1 0 1 0-1.99 0A5.002 5.002 0 0 0 3 6c0 1.098-.5 6-2 7h14c-1.5-1-2-5.902-2-7 0-2.42-1.72-4.44-4.005-4.901z" />
    </svg>
  );
}

// Presentational conversation panel (no fetching — the parent owns the thread
// state so it can decide the desktop column layout). `variant` picks the shell:
//   'desktop' → a plain sticky card (always visible in the right column)
//   'mobile'  → a bottom-pinned launcher that expands into a sheet
function MessagesPanel({ variant, token, eventId, data, onReplied }) {
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState(null);
  const [expanded, setExpanded] = useState(false); // mobile launcher state

  const onSend = async (e) => {
    e.preventDefault();
    const text = body.trim();
    if (!text) return;
    setSending(true);
    setSendError(null);
    try {
      const { data: res, ok } = await accountService.replyMessage(token, eventId, text);
      if (!ok) {
        setSendError(res?.error || 'Could not send your reply. Please try again.');
        return;
      }
      onReplied(text); // parent appends to the shared thread; both variants re-render
      setBody('');
    } catch {
      setSendError('Could not reach the server. Please try again.');
    } finally {
      setSending(false);
    }
  };

  // The thread + reply UI, shared by both variants.
  const thread = (
    <>
      <div
        className="border rounded-3 p-3 mb-3 bg-white"
        style={{ maxHeight: variant === 'mobile' ? '45vh' : 360, overflowY: 'auto' }}
      >
        <MessageThread messages={data.messages} perspective="submitter" formatTime={formatWhen} />
      </div>

      {sendError && <div className="alert alert-danger">{sendError}</div>}

      {data.open ? (
        <form onSubmit={onSend}>
          <label className="form-label" htmlFor={`reply-${variant}`}>Your reply</label>
          <textarea
            id={`reply-${variant}`}
            className="form-control mb-2"
            rows={3}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Type your response to 88 Bamboo…"
          />
          <button type="submit" className="btn bamboo-btn" disabled={sending || !body.trim()}>
            {sending ? 'Sending…' : 'Send reply'}
          </button>
        </form>
      ) : (
        <div className="alert alert-secondary mb-0">
          This conversation is closed — your listing is no longer under review, so replies
          are disabled. The thread stays here for your reference.
        </div>
      )}
    </>
  );

  if (variant === 'desktop') {
    return (
      <div className="card shadow-sm">
        <div className="card-header bg-white fw-semibold">Messages from 88 Bamboo</div>
        <div className="card-body">{thread}</div>
      </div>
    );
  }

  // Mobile: a pinned launcher (collapsed by default) that opens a bottom sheet.
  const unread = Number(data.unread) > 0;
  return (
    <div className="d-lg-none">
      {!expanded && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="btn btn-light border rounded-pill shadow position-fixed d-inline-flex align-items-center gap-2"
          style={{ bottom: 16, right: 16, zIndex: 1050 }}
          aria-label="Open messages from 88 Bamboo"
        >
          <BellIcon unread={unread} />
          <span className="fw-semibold">Messages</span>
          {unread && (
            <span
              className="position-absolute top-0 start-100 translate-middle p-1 bg-danger border border-light rounded-circle"
              aria-hidden="true"
            >
              <span className="visually-hidden">unread messages</span>
            </span>
          )}
        </button>
      )}

      {expanded && (
        <>
          <div className="modal-backdrop show" onClick={() => setExpanded(false)} />
          <div
            className="position-fixed bottom-0 start-0 end-0 bg-white rounded-top shadow-lg d-flex flex-column"
            style={{ zIndex: 1055, maxHeight: '85vh' }}
          >
            <div className="d-flex justify-content-between align-items-center p-3 border-bottom">
              <span className="fw-semibold">Messages from 88 Bamboo</span>
              <button
                type="button"
                className="btn-close"
                aria-label="Collapse messages"
                onClick={() => setExpanded(false)}
              />
            </div>
            <div className="p-3" style={{ overflowY: 'auto' }}>
              {thread}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function ManageEvent({ token, eventId, data, taxonomy }) {
  const router = useRouter();
  const [mode, setMode] = useState('view'); // view | edit
  const [confirm, setConfirm] = useState(null); // 'withdraw' | 'unpublish' | null
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null); // { type, text }

  // Conversation thread — fetched here (not in the panel) so the layout can react
  // to whether the listing has messages. Fetching marks the admin messages read
  // server-side, which clears the grid bell (page-load = read, owner-confirmed).
  const [msg, setMsg] = useState({ loading: true, data: null });
  const loadMessages = useCallback(async () => {
    try {
      const { data: res } = await accountService.getMessages(token, eventId);
      setMsg({ loading: false, data: res?.code === 200 ? res.data : null });
    } catch {
      setMsg({ loading: false, data: null });
    }
  }, [token, eventId]);
  useEffect(() => {
    loadMessages();
  }, [loadMessages]);

  const appendReply = useCallback((text) => {
    setMsg((s) => ({
      ...s,
      data: {
        ...s.data,
        messages: [
          ...(s.data?.messages || []),
          { sender: 'submitter', body: text, created_at: new Date().toISOString() },
        ],
      },
    }));
  }, []);

  const hasMessages = (msg.data?.messages || []).length > 0;

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
    <main className="container py-5" style={{ maxWidth: hasMessages ? 1140 : 820 }}>
      <p className="mb-3">
        <Link href={backHref} className="text-decoration-none">&larr; Your listings</Link>
      </p>

      {notice && <div className={`alert alert-${notice.type}`}>{notice.text}</div>}

      <div className="row g-4">
        <div className={hasMessages ? 'col-lg-8' : 'col-12'}>
          <div className="d-flex align-items-center gap-2 mb-2">
            <span className={`badge ${badge.cls}`}>{badge.label}</span>
            {data.is_past && status === 'published' && (
              <span className="text-muted small">This event is over — it stays listed for reference.</span>
            )}
          </div>

          <h1 className="tw-text-bamboo-slate" style={{ fontFamily: 'Buenard, Georgia, "Times New Roman", serif' }}>{ev.name}</h1>

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
                  <button className="btn bamboo-btn" onClick={() => setMode('edit')}>Edit</button>
                  <button className="btn btn-outline-danger" onClick={() => setConfirm('withdraw')}>Withdraw</button>
                </>
              )}

              {status === 'published' && (
                <>
                  <button className="btn bamboo-btn" onClick={() => setMode('edit')}>Edit</button>
                  {data.slug && (
                    <Link href={`/${data.slug}`} className="btn btn-outline-secondary">View public page</Link>
                  )}
                  <button className="btn btn-outline-danger" onClick={() => setConfirm('unpublish')}>Unpublish</button>
                </>
              )}

              {status === 'unpublished' && data.can_republish && (
                <button className="btn bamboo-btn" disabled={busy} onClick={() => runAction('republish')}>
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
                <Link href={resubmitHref} className="btn bamboo-btn">Re-submit this event</Link>
              )}
            </div>
          )}

          {['withdrawn', 'rejected', 'expired'].includes(status) && (
            <p className="text-muted small mt-3">
              Re-submitting starts a fresh listing with these details pre-filled. You&apos;ll
              re-upload the image and pay the listing fee again.
            </p>
          )}
        </div>

        {/* Desktop: sticky conversation column (hidden on mobile). */}
        {hasMessages && (
          <div className="col-lg-4 d-none d-lg-block">
            <div className="position-sticky" style={{ top: '6rem' }}>
              <MessagesPanel variant="desktop" token={token} eventId={eventId} data={msg.data} onReplied={appendReply} />
            </div>
          </div>
        )}
      </div>

      {/* Mobile: pinned launcher + bottom sheet (hidden on desktop). */}
      {hasMessages && (
        <MessagesPanel variant="mobile" token={token} eventId={eventId} data={msg.data} onReplied={appendReply} />
      )}
    </main>
  );
}

export default ManageEvent;
