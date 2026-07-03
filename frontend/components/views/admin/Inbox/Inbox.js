// Inbox — EVERY event that has a conversation (post-launch messaging), newest
// activity first (owner request 2026-07-04: read threads stay visible for the
// record). A red unread pill shows only while there are submitter replies the
// admin hasn't read; a read thread still appears, badged with its message count.
// Clicking one opens the ConversationPanel (which marks it read). Complements the
// per-card "Message" buttons on the Pending / Live tabs.
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';

import { adminService } from '@/core/services/admin';
import { adminAuth } from '@/core/services/adminAuth';
import { formatDateTime } from '@/components/views/admin/adminFormat';
import ConversationPanel from '@/components/views/admin/ConversationPanel';

function Inbox() {
  const router = useRouter();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [active, setActive] = useState(null); // { event_id, name }

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
      ({ data } = await adminService.getInbox(token));
    } catch {
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
      setError(data?.error || 'Could not load the inbox.');
      setLoading(false);
      return;
    }
    setItems(data.data || []);
    setLoading(false);
  }, [router]);

  useEffect(() => {
    load();
  }, [load]);

  const token = adminAuth.getToken();

  return (
    <main className="container py-4" style={{ maxWidth: 900 }}>
      <div className="d-flex justify-content-between align-items-center mb-4">
        <h1 className="tw-text-custom-green mb-0" style={{ fontFamily: 'Sora, sans-serif' }}>
          Inbox
        </h1>
        <button type="button" className="btn btn-outline-secondary btn-sm" onClick={load}>
          Refresh
        </button>
      </div>

      {error && <div className="alert alert-danger">{error}</div>}

      {loading ? (
        <p className="text-muted">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-muted">No conversations yet.</p>
      ) : (
        <div className="list-group">
          {items.map((it) => (
            <button
              key={it.event_id}
              type="button"
              className="list-group-item list-group-item-action d-flex justify-content-between align-items-center"
              onClick={() => setActive({ event_id: it.event_id, name: it.name })}
            >
              <span>
                <span className="fw-bold">{it.name || `Event #${it.event_id}`}</span>
                <span className="text-muted small ms-2">
                  {it.submitter_email} · {it.current_status}
                </span>
                <span className="d-block text-muted small">
                  Last reply {formatDateTime(it.last_message_at)}
                </span>
              </span>
              {Number(it.unread) > 0 ? (
                <span className="badge bg-danger rounded-pill">{it.unread} new</span>
              ) : (
                <span className="badge bg-light text-muted rounded-pill border">
                  {it.total} message{Number(it.total) === 1 ? '' : 's'}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {active && (
        <ConversationPanel
          token={token}
          eventId={active.event_id}
          eventName={active.name}
          onClose={() => {
            setActive(null);
            load();
          }}
          onChanged={load}
        />
      )}
    </main>
  );
}

export default Inbox;
