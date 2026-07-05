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
import ConversationPanel from '@/components/views/admin/ConversationPanel';

function formatDateTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
}

// Fee comes back as a numeric string/number; render it as "USD 5".
function formatFee(amount, currency) {
  if (amount == null) return '—';
  const num = Number(amount);
  const text = Number.isInteger(num) ? String(num) : num.toFixed(2);
  return `${currency || 'USD'} ${text}`;
}

function PendingCard({ item, onApprove, onReject, onEdit, onMessage, busy }) {
  const [showReject, setShowReject] = useState(false);
  const [reason, setReason] = useState('');

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
              <h5 className="card-title mb-1">{item.name}</h5>
              {item.is_duplicate && (
                <span className="badge bg-warning text-dark">Possible duplicate</span>
              )}
            </div>

            <p className="text-muted mb-2">
              {item.event_format} · {(item.drink_categories || []).join(', ')}
            </p>

            <dl className="row mb-2 small">
              <dt className="col-sm-3">When</dt>
              <dd className="col-sm-9">
                {formatDateTime(item.start_datetime)} — {formatDateTime(item.end_datetime)}
              </dd>

              <dt className="col-sm-3">Where</dt>
              <dd className="col-sm-9">
                {item.venue_name ? `${item.venue_name}, ` : ''}
                {item.venue_address ? `${item.venue_address}, ` : ''}
                {item.city}, {item.country}
              </dd>

              <dt className="col-sm-3">Submitter</dt>
              <dd className="col-sm-9">{item.submitter_email}</dd>

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
                {formatFee(item.amount, item.currency)}{' '}
                <span className="text-muted">({item.payment_status || 'unknown'})</span>
              </dd>

              <dt className="col-sm-3">Capture by</dt>
              <dd className="col-sm-9">{formatDateTime(item.capture_before)}</dd>
            </dl>

            {item.description && (
              <p className="card-text small text-muted">{item.description}</p>
            )}

            {!showReject ? (
              <div className="d-flex gap-2 mt-3">
                <button
                  type="button"
                  className="btn bamboo-btn btn-sm"
                  disabled={busy}
                  onClick={() => onApprove(item)}
                >
                  Approve &amp; charge
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
            ) : (
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

function ReviewQueue() {
  const router = useRouter();
  const [items, setItems] = useState([]);
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
      ) : items.length === 0 ? (
        <p className="text-muted">Nothing awaiting review. 🎉</p>
      ) : (
        items.map((item) => (
          <PendingCard
            key={item.version_id}
            item={item}
            busy={busyId === item.version_id}
            onApprove={onApprove}
            onReject={onReject}
            onEdit={setEditItem}
            onMessage={setMsgItem}
          />
        ))
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
