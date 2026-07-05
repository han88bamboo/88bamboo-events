// LiveListings — the Phase-4B live-listing management panel (plan §5.3/§7/§8).
// Lists every event that has been published at least once, grouped into:
//   • Live      — published & upcoming
//   • Past      — published & ended (muted + "Event is over" badge, plan §8)
//   • Off-board — unpublished (by the admin) or auto-expired (safety job)
//
// Actions: UNPUBLISH a live listing (server-side-guarded carve-out — plan §5.3;
// sets current_status='unpublished' and logs to admin_actions), and expand a
// row's VERSION HISTORY (display-only in 4B — plan §7: the version chain, marking
// which version is currently published).
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';

import { adminService } from '@/core/services/admin';
import { adminAuth } from '@/core/services/adminAuth';
import { formatDateTime, formatFee } from '@/components/views/admin/adminFormat';
import AdminEditModal from '@/components/views/admin/AdminEditModal';
import ConversationPanel from '@/components/views/admin/ConversationPanel';

function StatusBadge({ status, isPast }) {
  if (status === 'published') {
    return isPast ? (
      <span className="badge bg-secondary">Past — event is over</span>
    ) : (
      <span className="badge bg-success">Live</span>
    );
  }
  if (status === 'unpublished') return <span className="badge bg-dark">Unpublished</span>;
  if (status === 'expired') return <span className="badge bg-warning text-dark">Auto-expired</span>;
  return <span className="badge bg-light text-dark">{status}</span>;
}

function VersionChain({ token, eventId }) {
  const [state, setState] = useState({ loading: true, error: null, data: null });

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data } = await adminService.getVersions(token, eventId);
      if (!alive) return;
      if (data?.code !== 200) {
        setState({ loading: false, error: data?.error || 'Could not load history.', data: null });
        return;
      }
      setState({ loading: false, error: null, data: data.data });
    })();
    return () => {
      alive = false;
    };
  }, [token, eventId]);

  if (state.loading) return <p className="text-muted small mb-0">Loading history…</p>;
  if (state.error) return <p className="text-danger small mb-0">{state.error}</p>;

  const versions = state.data?.versions || [];
  return (
    <ol className="list-group list-group-numbered">
      {versions.map((v) => (
        <li
          key={v.version_id}
          className="list-group-item d-flex justify-content-between align-items-start"
        >
          <div className="ms-2 me-auto">
            <div className="fw-bold">
              v{v.version_number} · {v.name}{' '}
              {v.is_published && <span className="badge bg-success ms-1">Published</span>}
            </div>
            <div className="small text-muted">
              {v.approval_status} · created {formatDateTime(v.created_at)}
              {v.reviewed_at ? ` · reviewed ${formatDateTime(v.reviewed_at)}` : ''}
            </div>
            {v.rejection_reason && (
              <div className="small text-danger">Reason: {v.rejection_reason}</div>
            )}
          </div>
          <span className="text-muted small">{formatFee(v.amount, v.currency)}</span>
        </li>
      ))}
    </ol>
  );
}

function ListingRow({ item, token, onUnpublish, onEdit, onMessage, busy }) {
  const [showHistory, setShowHistory] = useState(false);
  const muted = item.is_past || item.current_status !== 'published';

  return (
    <div className={`card mb-3 ${muted ? 'opacity-75' : ''}`}>
      <div className="row g-0">
        <div className="col-md-3">
          {item.image_url ? (
            <img
              src={item.image_url}
              alt={item.name}
              className="img-fluid rounded-start"
              style={{ objectFit: 'cover', height: '100%', width: '100%', maxHeight: 180 }}
            />
          ) : (
            <div className="bg-light h-100 d-flex align-items-center justify-content-center text-muted">
              No image
            </div>
          )}
        </div>
        <div className="col-md-9">
          <div className="card-body">
            <div className="d-flex justify-content-between align-items-start">
              <h6 className="card-title mb-1">{item.name}</h6>
              <StatusBadge status={item.current_status} isPast={item.is_past} />
            </div>
            <p className="small text-muted mb-1">
              {formatDateTime(item.start_datetime)} — {formatDateTime(item.end_datetime)}
            </p>
            <p className="small text-muted mb-1">
              {item.city}, {item.country} · {item.event_format}
            </p>
            <p className="small text-muted mb-2">
              /{item.slug} · {formatFee(item.amount, item.currency)}{' '}
              <span className="text-muted">({item.payment_status || '—'})</span>
            </p>

            <div className="d-flex gap-2 align-items-center">
              {item.current_status === 'published' && (
                <>
                  <button
                    type="button"
                    className="btn btn-outline-dark btn-sm"
                    disabled={busy}
                    onClick={() => onUnpublish(item)}
                  >
                    Unpublish
                  </button>
                  <button
                    type="button"
                    className="btn btn-outline-secondary btn-sm"
                    disabled={busy}
                    onClick={() => onEdit(item)}
                  >
                    Edit
                  </button>
                </>
              )}
              <button
                type="button"
                className="btn btn-outline-primary btn-sm"
                onClick={() => onMessage(item)}
              >
                Messages
              </button>
              <button
                type="button"
                className="btn btn-link btn-sm text-muted p-0"
                onClick={() => setShowHistory((s) => !s)}
              >
                {showHistory ? 'Hide' : 'View'} history ({item.version_count})
              </button>
            </div>

            {showHistory && (
              <div className="mt-3">
                <VersionChain token={token} eventId={item.event_id} />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Section({ title, items, token, onUnpublish, onEdit, onMessage, busyId }) {
  if (items.length === 0) return null;
  return (
    <section className="mb-4">
      <h5 className="text-muted mb-3">{title}</h5>
      {items.map((item) => (
        <ListingRow
          key={item.event_id}
          item={item}
          token={token}
          onUnpublish={onUnpublish}
          onEdit={onEdit}
          onMessage={onMessage}
          busy={busyId === item.event_id}
        />
      ))}
    </section>
  );
}

function LiveListings() {
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
      ({ data } = await adminService.getLive(token));
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
      setError(data?.error || 'Could not load listings.');
      setLoading(false);
      return;
    }
    setItems(data.data || []);
    setLoading(false);
  }, [router]);

  useEffect(() => {
    load();
  }, [load]);

  const onUnpublish = async (item) => {
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Unpublish “${item.name}”? It will leave the live board.`)) return;
    setBusyId(item.event_id);
    setNotice(null);
    setError(null);
    const token = adminAuth.getToken();
    const { data, ok } = await adminService.unpublish(token, item.event_id);
    setBusyId(null);
    if (!ok) {
      setError(data?.error || 'Unpublish failed.');
      return;
    }
    setNotice(`Unpublished “${item.name}”.`);
    load();
  };

  const token = adminAuth.getToken();
  const live = items.filter((i) => i.current_status === 'published' && !i.is_past);
  const past = items.filter((i) => i.current_status === 'published' && i.is_past);
  const off = items.filter((i) => i.current_status !== 'published');

  return (
    <main className="container py-4" style={{ maxWidth: 960 }}>
      <div className="d-flex justify-content-between align-items-center mb-4">
        <h1 className="tw-text-bamboo-slate mb-0" style={{ fontFamily: 'Buenard, Georgia, "Times New Roman", serif' }}>
          Live listings
        </h1>
        <button type="button" className="btn btn-outline-secondary btn-sm" onClick={load}>
          Refresh
        </button>
      </div>

      {notice && <div className="alert alert-success">{notice}</div>}
      {error && <div className="alert alert-danger">{error}</div>}

      {loading ? (
        <p className="text-muted">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-muted">No published listings yet.</p>
      ) : (
        <>
          <Section title="Live" items={live} token={token} onUnpublish={onUnpublish} onEdit={setEditItem} onMessage={setMsgItem} busyId={busyId} />
          <Section title="Past" items={past} token={token} onUnpublish={onUnpublish} onEdit={setEditItem} onMessage={setMsgItem} busyId={busyId} />
          <Section title="Off the board" items={off} token={token} onUnpublish={onUnpublish} onEdit={setEditItem} onMessage={setMsgItem} busyId={busyId} />
        </>
      )}

      {editItem && (
        <AdminEditModal
          token={token}
          item={editItem}
          isLive
          onClose={() => setEditItem(null)}
          onSaved={() => {
            setEditItem(null);
            setNotice(`Updated “${editItem.name}” — the live listing now shows your changes.`);
            load();
          }}
        />
      )}

      {msgItem && (
        <ConversationPanel
          token={token}
          eventId={msgItem.event_id}
          eventName={msgItem.name}
          onClose={() => setMsgItem(null)}
        />
      )}
    </main>
  );
}

export default LiveListings;
