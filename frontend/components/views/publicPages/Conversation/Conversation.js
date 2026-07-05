// Conversation — the public submitter-facing message thread (post-launch feature).
// Reached from a link in our email (web-link replies only — the submitter never
// emails us back). The magic token in the URL is the session (cookie-free — the
// App Proxy strips cookies, plan §4/§7). SSR prefetches the thread; replies POST
// client-side. The thread is read-only once the event leaves review (`open=false`).
import { useState } from 'react';

import MessageThread from '@/components/views/MessageThread';
import { messagesService } from '@/core/services/messages';

function formatWhen(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-GB', { timeZone: 'UTC' });
}

function Conversation({ token, initial }) {
  const [messages, setMessages] = useState(initial?.messages || []);
  const isOpen = !!initial?.open;
  const eventName = initial?.event?.name || 'your event';
  const status = initial?.event?.current_status;

  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);

  const onSend = async (e) => {
    e.preventDefault();
    const text = body.trim();
    if (!text) return;
    setSending(true);
    setError(null);
    try {
      const { data, ok } = await messagesService.reply(token, text);
      if (!ok) {
        setError(data?.error || 'Could not send your reply. Please try again.');
        return;
      }
      // Optimistically append; the server stored it and notified the admin.
      setMessages((prev) => [
        ...prev,
        { sender: 'submitter', body: text, created_at: new Date().toISOString() },
      ]);
      setBody('');
    } catch {
      setError('Could not reach the server. Please try again.');
    } finally {
      setSending(false);
    }
  };

  return (
    <main className="container py-5" style={{ maxWidth: 680 }}>
      <h1 className="tw-text-bamboo-slate mb-1" style={{ fontFamily: 'Buenard, Georgia, "Times New Roman", serif' }}>
        Conversation about your listing
      </h1>
      <p className="text-muted">
        Re: <strong>{eventName}</strong>
      </p>

      <div className="border rounded-3 p-3 mb-3 bg-white" style={{ minHeight: 160 }}>
        <MessageThread messages={messages} perspective="submitter" formatTime={formatWhen} />
      </div>

      {error && <div className="alert alert-danger">{error}</div>}

      {isOpen ? (
        <form onSubmit={onSend}>
          <label className="form-label" htmlFor="reply">Your reply</label>
          <textarea
            id="reply"
            className="form-control mb-2"
            rows={4}
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
          This conversation is closed
          {status ? ` — your listing is now ${status}` : ''}. If you need anything else,
          please submit a new enquiry.
        </div>
      )}
    </main>
  );
}

export default Conversation;
