// ConversationPanel — the admin side of a message thread (post-launch messaging),
// rendered as a modal over the dashboard. Fetches the thread (which also marks the
// submitter's messages read), shows the exchange, and — while the event is still
// under review — lets the admin send a message. Sending emails the submitter a
// link to the public conversation page; they reply there (web-link replies only).
//
// A frozen thread (event no longer 'pending_review') is shown read-only.
import { useCallback, useEffect, useState } from 'react';

import MessageThread from '@/components/views/MessageThread';
import { adminService } from '@/core/services/admin';
import { formatDateTime } from '@/components/views/admin/adminFormat';

function ConversationPanel({ token, eventId, eventName, onClose, onChanged }) {
  const [state, setState] = useState({ loading: true, error: null, data: null });
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState(null);

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true }));
    const { data } = await adminService.getThread(token, eventId);
    if (data?.code !== 200) {
      setState({ loading: false, error: data?.error || 'Could not load the conversation.', data: null });
      return;
    }
    setState({ loading: false, error: null, data: data.data });
    // Opening the thread marked replies read — let the parent refresh its badge.
    if (onChanged) onChanged();
  }, [token, eventId, onChanged]);

  useEffect(() => {
    load();
  }, [load]);

  const onSend = async (e) => {
    e.preventDefault();
    const text = body.trim();
    if (!text) return;
    setSending(true);
    setSendError(null);
    const { data, ok } = await adminService.sendMessage(token, eventId, text);
    setSending(false);
    if (!ok) {
      setSendError(data?.error || 'Could not send the message.');
      return;
    }
    setBody('');
    load();
  };

  const data = state.data;
  const isOpen = !!data?.open;

  return (
    <>
      <div className="modal d-block" tabIndex={-1} role="dialog">
        <div className="modal-dialog modal-dialog-centered modal-lg" role="document">
          <div className="modal-content">
            <div className="modal-header">
              <h5 className="modal-title">Conversation — {eventName || data?.event?.name}</h5>
              <button type="button" className="btn-close" aria-label="Close" onClick={onClose} />
            </div>
            <div className="modal-body">
              {state.loading ? (
                <p className="text-muted mb-0">Loading…</p>
              ) : state.error ? (
                <div className="alert alert-danger mb-0">{state.error}</div>
              ) : (
                <>
                  <div className="border rounded-3 p-3 mb-3 bg-white" style={{ maxHeight: 320, overflowY: 'auto' }}>
                    <MessageThread
                      messages={data.messages || []}
                      perspective="admin"
                      formatTime={formatDateTime}
                      emptyText="No messages yet — start the conversation below."
                    />
                  </div>

                  {sendError && <div className="alert alert-danger">{sendError}</div>}

                  {isOpen ? (
                    <form onSubmit={onSend}>
                      <label className="form-label small" htmlFor="admin-msg">
                        Message to the submitter (emailed with a reply link)
                      </label>
                      <textarea
                        id="admin-msg"
                        className="form-control mb-2"
                        rows={3}
                        value={body}
                        onChange={(e) => setBody(e.target.value)}
                        placeholder="e.g. We'd like to shorten the title to “…”. Is that OK?"
                      />
                      <button type="submit" className="btn bamboo-btn btn-sm" disabled={sending || !body.trim()}>
                        {sending ? 'Sending…' : 'Send message'}
                      </button>
                    </form>
                  ) : (
                    <div className="alert alert-secondary mb-0">
                      This conversation is closed — the listing is no longer under review
                      {data?.event?.current_status ? ` (now ${data.event.current_status})` : ''}.
                    </div>
                  )}
                </>
              )}
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-outline-secondary btn-sm" onClick={onClose}>
                Close
              </button>
            </div>
          </div>
        </div>
      </div>
      <div className="modal-backdrop show" />
    </>
  );
}

export default ConversationPanel;
