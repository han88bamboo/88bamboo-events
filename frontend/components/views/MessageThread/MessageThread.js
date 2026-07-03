// MessageThread — the presentational message-bubble list shared by the public
// Conversation, the admin ConversationPanel, and the dashboard Messages panel
// (post-launch messaging). Extracted to kill the previously triple-duplicated
// `Bubble` markup. Pure/presentational: it renders `messages` and nothing else.
//
// `perspective` decides which sender sits on the right ("mine", green) and the
// display labels; `formatTime` renders each timestamp (callers pass their own
// locale/format so this component stays free of any admin/public-specific helper).
function MessageThread({
  messages = [],
  perspective = 'submitter',
  formatTime = (v) => v,
  emptyText = 'No messages yet.',
}) {
  const labels =
    perspective === 'admin'
      ? { mine: 'You (88 Bamboo)', theirs: 'Submitter' }
      : { mine: 'You', theirs: '88 Bamboo Events' };

  if (messages.length === 0) {
    return <p className="text-muted mb-0">{emptyText}</p>;
  }

  return (
    <>
      {messages.map((m, i) => {
        const mine = m.sender === perspective;
        return (
          <div
            key={i}
            className={`d-flex mb-2 ${mine ? 'justify-content-end' : 'justify-content-start'}`}
          >
            <div
              className={`p-2 px-3 rounded-3 ${mine ? 'bg-success text-white' : 'bg-light border'}`}
              style={{ maxWidth: '80%', whiteSpace: 'pre-wrap' }}
            >
              <div className="small fw-bold mb-1">{mine ? labels.mine : labels.theirs}</div>
              <div>{m.body}</div>
              <div className={`small mt-1 ${mine ? 'text-white-50' : 'text-muted'}`}>
                {formatTime(m.created_at)}
              </div>
            </div>
          </div>
        );
      })}
    </>
  );
}

export default MessageThread;
