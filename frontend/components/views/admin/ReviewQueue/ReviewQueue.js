// ReviewQueue — the admin pending-review dashboard (plan §6/§7/§8). Self-contained
// view. Lists every pending_review version with its full detail + hero image +
// payment (fee, capture deadline, status) + the duplicate flag 3B wrote, and lets
// the admin approve (capture + publish) or reject (release + reason) each one.
//
// Data is fetched CLIENT-SIDE with the session token as a Bearer header (the API
// is a different origin from this backstage app, so cookies don't ride along —
// plan §5.3). The page's getServerSideProps cookie guard handles the SSR redirect;
// this component redirects too if the token is missing when it mounts.
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';

import { adminService } from '@/core/services/admin';
import { adminAuth } from '@/core/services/adminAuth';
import AdminEditModal from '@/components/views/admin/AdminEditModal';
import AdminLocationMap from '@/components/views/admin/AdminLocationMap';
import ConversationPanel from '@/components/views/admin/ConversationPanel';

function formatDateTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
}

// Fee comes back as a numeric string/number; render it as "USD 15".
function formatFee(amount, currency) {
  if (amount == null) return '—';
  const num = Number(amount);
  const text = Number.isInteger(num) ? String(num) : num.toFixed(2);
  return `${currency || 'USD'} ${text}`;
}

function PendingCard({ item, onApprove, onReject, onWaive, onEdit, onMessage, busy }) {
  const [showReject, setShowReject] = useState(false);
  const [confirmWaive, setConfirmWaive] = useState(false);
  const [reason, setReason] = useState('');
  // WV-1 states the reviewer must see BEFORE clicking anything:
  //   no payment row at all  -> nothing was ever held
  //   already captured       -> the money is gone; waiving is refused server-side
  const noPayment = !item.payment_status;
  const alreadyCharged = item.payment_status === 'captured';

  return (
    <div className="card mb-4">
      <div className="row g-0">
        <div className="col-md-4">
          {item.image_url ? (
            // Plain <img> — the S3/stub host isn't guaranteed in the next/image
            // allowlist and this is an internal review view, not a public page.
            <img
              src={item.image_url}
              alt={item.name}
              className="img-fluid rounded-start"
              style={{ objectFit: 'cover', height: '100%', width: '100%', maxHeight: 260 }}
            />
          ) : (
            <div className="bg-light h-100 d-flex align-items-center justify-content-center text-muted">
              No image
            </div>
          )}
        </div>
        <div className="col-md-8">
          <div className="card-body">
            <div className="d-flex justify-content-between align-items-start">
              <h3 className="card-title mb-1">{item.name}</h3>
              <div className="d-flex gap-2 flex-wrap justify-content-end">
                {item.is_duplicate && (
                  <span className="badge bg-warning text-dark">Possible duplicate</span>
                )}
                {/* WV-1: surface the payment state as a badge, not just buried in
                    the detail list — the reviewer must know there is nothing to
                    charge (or that it is already charged) before choosing. */}
                {noPayment && (
                  <span className="badge bg-warning text-dark">No payment attached</span>
                )}
                {alreadyCharged && (
                  <span className="badge bg-success">Fee already charged</span>
                )}
              </div>
            </div>

            <p className="text-muted mb-2">
              {item.event_format} · {(item.drink_categories || []).join(', ')}
            </p>

            <dl className="row mb-2 small">
              <dt className="col-sm-3">When</dt>
              <dd className="col-sm-9">
                {formatDateTime(item.start_datetime)} — {formatDateTime(item.end_datetime)}
                {/* Multi-date schedule (EP-6): show the count + each date so the
                    reviewer sees the whole schedule before approving. */}
                {(item.occurrences || []).length > 1 && (
                  <>
                    <span className="badge bg-secondary-subtle text-secondary ms-2">
                      {item.occurrences.length} dates
                    </span>
                    <ul className="list-unstyled mb-0 mt-1">
                      {item.occurrences.map((o, i) => (
                        // eslint-disable-next-line react/no-array-index-key
                        <li key={i}>
                          {formatDateTime(o.start)} — {formatDateTime(o.end)}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </dd>

              <dt className="col-sm-3">Where</dt>
              <dd className="col-sm-9">
                {item.venue_name ? `${item.venue_name}, ` : ''}
                {item.venue_address ? `${item.venue_address}, ` : ''}
                {item.city}, {item.country}
              </dd>

              <dt className="col-sm-3">Submitter</dt>
              <dd className="col-sm-9">{item.submitter_email}</dd>

              {/* Public organiser name (EP-7); its owner is the submitter email
                  above, so the reviewer can see who is behind it. */}
              {item.organiser_name && (
                <>
                  <dt className="col-sm-3">Organiser</dt>
                  <dd className="col-sm-9">
                    {item.organiser_name}{' '}
                    <span className="text-muted">(owner: {item.submitter_email})</span>
                  </dd>
                </>
              )}

              {item.contact_email && (
                <>
                  <dt className="col-sm-3">Contact</dt>
                  <dd className="col-sm-9">{item.contact_email}</dd>
                </>
              )}

              {item.link && (
                <>
                  <dt className="col-sm-3">Link</dt>
                  <dd className="col-sm-9">
                    <a href={item.link} target="_blank" rel="noreferrer">
                      {item.link}
                    </a>
                  </dd>
                </>
              )}

              <dt className="col-sm-3">Fee held</dt>
              <dd className="col-sm-9">
                {noPayment ? (
                  <span className="text-warning-emphasis">None — no payment attached</span>
                ) : (
                  <>
                    {formatFee(item.amount, item.currency)}{' '}
                    <span className="text-muted">({item.payment_status})</span>
                  </>
                )}
              </dd>

              <dt className="col-sm-3">Capture by</dt>
              <dd className="col-sm-9">{formatDateTime(item.capture_before)}</dd>
            </dl>

            {/* Exact-pin location preview (EP-4) so the reviewer sees WHERE the
                event is before approving. Open by default — few pending items. */}
            <AdminLocationMap item={item} initialOpen />

            {item.description && (
              <p className="card-text small text-muted">{item.description}</p>
            )}

            {showReject || confirmWaive ? null : (
              <div className="d-flex gap-2 mt-3 flex-wrap">
                <button
                  type="button"
                  className="btn bamboo-btn btn-sm"
                  disabled={busy || noPayment}
                  // Nothing is held, so there is nothing to capture — approve()
                  // would 409. Waiving is the only way to publish these.
                  title={noPayment ? 'No payment is attached — use Approve without charging.' : undefined}
                  onClick={() => onApprove(item)}
                >
                  Approve &amp; charge
                </button>
                <button
                  type="button"
                  className="btn btn-outline-success btn-sm"
                  disabled={busy || alreadyCharged}
                  title={
                    alreadyCharged
                      ? 'The fee was already charged — refund it in Stripe instead.'
                      : undefined
                  }
                  onClick={() => setConfirmWaive(true)}
                >
                  Approve without charging
                </button>
                <button
                  type="button"
                  className="btn btn-outline-danger btn-sm"
                  disabled={busy}
                  onClick={() => setShowReject(true)}
                >
                  Reject
                </button>
                <button
                  type="button"
                  className="btn btn-outline-secondary btn-sm"
                  disabled={busy}
                  onClick={() => onEdit(item)}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className="btn btn-outline-primary btn-sm"
                  disabled={busy}
                  onClick={() => onMessage(item)}
                >
                  Message
                </button>
              </div>
            )}

            {/* Waive confirmation (E2). Irreversible: once the hold is cancelled
                the card cannot be charged again without a fresh submission. */}
            {confirmWaive && (
              <div className="mt-3 border rounded p-3 bg-light">
                <p className="small mb-2">
                  Publish <strong>{item.name}</strong> without charging?{' '}
                  {noPayment
                    ? 'No payment is attached, so nothing is released.'
                    : `The ${formatFee(item.amount, item.currency)} hold will be released and the card will not be charged.`}{' '}
                  This cannot be undone — charging later would need a fresh submission.
                </p>
                <div className="d-flex gap-2">
                  <button
                    type="button"
                    className="btn btn-success btn-sm"
                    disabled={busy}
                    onClick={() => onWaive(item)}
                  >
                    Confirm — publish free
                  </button>
                  <button
                    type="button"
                    className="btn btn-link btn-sm text-muted"
                    disabled={busy}
                    onClick={() => setConfirmWaive(false)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {showReject && (
              <div className="mt-3">
                <label className="form-label small" htmlFor={`reason-${item.version_id}`}>
                  Reason (emailed to the submitter)
                </label>
                <textarea
                  id={`reason-${item.version_id}`}
                  className="form-control form-control-sm mb-2"
                  rows={2}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. Event details are incomplete."
                />
                <div className="d-flex gap-2">
                  <button
                    type="button"
                    className="btn btn-danger btn-sm"
                    disabled={busy}
                    onClick={() => onReject(item, reason)}
                  >
                    Confirm reject &amp; release hold
                  </button>
                  <button
                    type="button"
                    className="btn btn-link btn-sm text-muted"
                    disabled={busy}
                    onClick={() => setShowReject(false)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ExpiredRow (WV-1) — a submission the hourly job auto-released. There is no hold
// left, so the ONLY action is publishing it free; a compact row rather than a full
// PendingCard because this is an exception list, not the daily triage surface.
function ExpiredRow({ item, onWaive, busy }) {
  const [confirm, setConfirm] = useState(false);

  return (
    <div className="border rounded p-3 mb-2">
      <div className="d-flex justify-content-between align-items-start gap-3 flex-wrap">
        <div>
          <div className="fw-semibold">{item.name}</div>
          <div className="small text-muted">
            {formatDateTime(item.start_datetime)} · {item.city}, {item.country}
          </div>
          <div className="small text-muted">
            {item.submitter_email} · hold released {formatDateTime(item.reviewed_at)} (
            {formatFee(item.amount, item.currency)} never charged)
          </div>
        </div>
        {!confirm ? (
          <button
            type="button"
            className="btn btn-outline-success btn-sm"
            disabled={busy}
            onClick={() => setConfirm(true)}
          >
            Publish without charging
          </button>
        ) : (
          <div className="d-flex gap-2 align-items-center">
            <span className="small text-muted">Publish free?</span>
            <button
              type="button"
              className="btn btn-success btn-sm"
              disabled={busy}
              onClick={() => onWaive(item)}
            >
              Confirm
            </button>
            <button
              type="button"
              className="btn btn-link btn-sm text-muted"
              disabled={busy}
              onClick={() => setConfirm(false)}
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function ReviewQueue() {
  const router = useRouter();
  const [items, setItems] = useState([]);
  // WV-1: expired submissions live below the queue on this same tab. They are
  // invisible everywhere else in the admin app once the job marks them.
  const [expired, setExpired] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [editItem, setEditItem] = useState(null);
  const [msgItem, setMsgItem] = useState(null);

  const load = useCallback(async () => {
    const token = adminAuth.getToken();
    if (!token) {
      router.replace('/admin/login');
      return;
    }
    setLoading(true);
    setError(null);
    let data;
    try {
      ({ data } = await adminService.getPending(token));
    } catch (err) {
      setError('Could not reach the server. Please try again.');
      setLoading(false);
      return;
    }
    if (data?.code === 401) {
      adminAuth.logout();
      router.replace('/admin/login');
      return;
    }
    if (data?.code !== 200) {
      setError(data?.error || 'Could not load the review queue.');
      setLoading(false);
      return;
    }
    setItems(data.data || []);
    // The expired list is secondary — a failure here must not blank the queue,
    // so it is fetched separately and simply left empty if it fails.
    try {
      const { data: exp } = await adminService.getExpired(token);
      setExpired(exp?.code === 200 ? exp.data || [] : []);
    } catch {
      setExpired([]);
    }
    setLoading(false);
  }, [router]);

  useEffect(() => {
    load();
  }, [load]);

  const onApprove = async (item) => {
    setBusyId(item.version_id);
    setNotice(null);
    setError(null);
    const token = adminAuth.getToken();
    const { data, ok } = await adminService.approve(token, item.version_id);
    setBusyId(null);
    if (!ok) {
      setError(data?.error || 'Approval failed.');
      // A capture failure (402) removes it from "actionable" too — refresh so the
      // queue reflects the backend's current state.
      if (data?.code === 402) load();
      return;
    }
    setItems((prev) => prev.filter((i) => i.version_id !== item.version_id));
    setNotice(`Approved “${item.name}” — published at /${data.data.slug} and the card was charged.`);
  };

  const onReject = async (item, reason) => {
    setBusyId(item.version_id);
    setNotice(null);
    setError(null);
    const token = adminAuth.getToken();
    const { data, ok } = await adminService.reject(token, item.version_id, reason);
    setBusyId(null);
    if (!ok) {
      setError(data?.error || 'Rejection failed.');
      return;
    }
    setItems((prev) => prev.filter((i) => i.version_id !== item.version_id));
    setNotice(`Rejected “${item.name}” — the authorisation hold was released.`);
  };

  // WV-1: publish without charging. Serves both surfaces — a queue card (whose
  // hold gets released) and an expired row (whose hold is already gone) — so it
  // clears the item from whichever list it came from.
  const onWaive = async (item) => {
    setBusyId(item.version_id);
    setNotice(null);
    setError(null);
    const token = adminAuth.getToken();
    const { data, ok } = await adminService.approveWaived(token, item.version_id);
    setBusyId(null);
    if (!ok) {
      setError(data?.error || 'Could not publish without charging.');
      // 409 means the backend's state moved under us (a race with the hourly
      // auto-release job, or a double-click) — resync rather than guess.
      if (data?.code === 409) load();
      return;
    }
    setItems((prev) => prev.filter((i) => i.version_id !== item.version_id));
    setExpired((prev) => prev.filter((i) => i.version_id !== item.version_id));
    setNotice(
      `Published “${item.name}” at /${data.data.slug} — no charge was made and any hold was released.`,
    );
  };

  const onLogout = () => {
    adminAuth.logout();
    router.replace('/admin/login');
  };

  return (
    <main className="container py-5" style={{ maxWidth: 900 }}>
      <div className="d-flex justify-content-between align-items-center mb-4">
        <h1 className="tw-text-bamboo-slate mb-0" style={{ fontFamily: 'Buenard, Georgia, "Times New Roman", serif' }}>
          Pending review
        </h1>
        <div className="d-flex gap-2">
          <button type="button" className="btn btn-outline-secondary btn-sm" onClick={load}>
            Refresh
          </button>
          <button type="button" className="btn btn-outline-secondary btn-sm" onClick={onLogout}>
            Sign out
          </button>
        </div>
      </div>

      {notice && (
        <div className="alert alert-success" role="alert">
          {notice}
        </div>
      )}
      {error && (
        <div className="alert alert-danger" role="alert">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-muted">Loading…</p>
      ) : (
        <>
          {items.length === 0 ? (
            <p className="text-muted">Nothing in queue.</p>
          ) : (
            items.map((item) => (
              <PendingCard
                key={item.version_id}
                item={item}
                busy={busyId === item.version_id}
                onApprove={onApprove}
                onReject={onReject}
                onWaive={onWaive}
                onEdit={setEditItem}
                onMessage={setMsgItem}
              />
            ))
          )}

          {/* Expired (WV-1) — below the queue on the same tab. Rendered only when
              there is something to rescue, so the daily view stays clean. */}
          {expired.length > 0 && (
            <section className="mt-5">
              <h2 className="h5 tw-text-bamboo-slate mb-1">Expired</h2>
              <p className="text-muted small mb-3">
                The authorisation lapsed before review, so these were released and dropped
                out of the queue. Nothing can be charged for them — publishing one is free.
              </p>
              {expired.map((item) => (
                <ExpiredRow
                  key={item.version_id}
                  item={item}
                  busy={busyId === item.version_id}
                  onWaive={onWaive}
                />
              ))}
            </section>
          )}
        </>
      )}

      {editItem && (
        <AdminEditModal
          token={adminAuth.getToken()}
          item={editItem}
          isLive={false}
          onClose={() => setEditItem(null)}
          onSaved={() => {
            setEditItem(null);
            setNotice('Edit saved — the updated version is pending your approval.');
            load();
          }}
        />
      )}

      {msgItem && (
        <ConversationPanel
          token={adminAuth.getToken()}
          eventId={msgItem.event_id}
          eventName={msgItem.name}
          onClose={() => setMsgItem(null)}
        />
      )}
    </main>
  );
}

export default ReviewQueue;
