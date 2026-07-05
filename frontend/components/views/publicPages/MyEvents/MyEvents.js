// MyEvents — the customer "manage my listings" dashboard grid (plan §7). Shows
// every event the authenticated email submitted, full history, each badged by
// status. No actions from the grid itself: clicking a card opens that event's
// owner page (/my-events/<id>?token=…) where edit/withdraw/unpublish/republish/
// resubmit live. Authentication is the URL token (cookie-free).
import Link from 'next/link';
import { useState } from 'react';

import { formatDateRange } from '../publicFormat';

// Map a listing's state to a human badge. `archived` distinguishes a customer
// unpublish/withdraw from an admin action; is_past mutes ended live events.
export function statusBadge(ev) {
  const s = ev.current_status;
  if (s === 'pending_review') return { label: 'Pending review', cls: 'bg-warning text-dark' };
  if (s === 'published') {
    return ev.is_past
      ? { label: 'Past', cls: 'bg-secondary' }
      : { label: 'Live', cls: 'bg-success' };
  }
  if (s === 'withdrawn') return { label: 'Withdrawn', cls: 'bg-dark' };
  if (s === 'unpublished') {
    return ev.archived
      ? { label: 'Unpublished', cls: 'bg-secondary' }
      : { label: 'Removed by admin', cls: 'bg-secondary' };
  }
  if (s === 'rejected') return { label: 'Not approved', cls: 'bg-danger' };
  if (s === 'expired') return { label: 'Hold expired', cls: 'bg-dark' };
  return { label: s, cls: 'bg-secondary' };
}

// Message bell: shown only when the event has any admin messages. The outline is
// black normally and turns red when any are still unread; the number badge is the
// total admin-message count. Purely an indicator — clicking the card opens the
// listing's Messages panel, which is what actually marks the thread read.
function Bell({ count, unread }) {
  const color = unread ? '#dc3545' : '#000';
  const label = `${count} message${count === 1 ? '' : 's'} from 88 Bamboo${unread ? ' — unread' : ''}`;
  return (
    <span
      className="badge d-inline-flex align-items-center gap-1 border"
      style={{ color, borderColor: color, background: 'transparent' }}
      title={label}
      aria-label={label}
    >
      <svg width="13" height="13" viewBox="0 0 16 16" fill={color} aria-hidden="true">
        <path d="M8 16a2 2 0 0 0 2-2H6a2 2 0 0 0 2 2zm.995-14.901a1 1 0 1 0-1.99 0A5.002 5.002 0 0 0 3 6c0 1.098-.5 6-2 7h14c-1.5-1-2-5.902-2-7 0-2.42-1.72-4.44-4.005-4.901z" />
      </svg>
      {count}
    </span>
  );
}

function ManageCard({ ev, token, view }) {
  const badge = statusBadge(ev);
  const hasMessages = Number(ev.admin_message_count) > 0;
  const unread = Number(ev.unread_admin_count) > 0;
  const href = `/my-events/${ev.event_id}?token=${encodeURIComponent(token)}`;
  const where = [ev.city, ev.country].filter(Boolean).join(', ');
  const muted = ev.is_past || ['withdrawn', 'unpublished', 'rejected', 'expired'].includes(ev.current_status);

  if (view === 'list') {
    return (
      <Link href={href} className={`list-group-item list-group-item-action d-flex gap-3 align-items-center ${muted ? 'opacity-75' : ''}`}>
        {ev.image_url && (
          <img src={ev.image_url} alt="" style={{ width: 80, height: 60, objectFit: 'cover' }} className="rounded flex-shrink-0" />
        )}
        <div className="flex-grow-1">
          <div className="d-flex align-items-center gap-2">
            <h6 className="mb-0">{ev.name}</h6>
            <span className={`badge ${badge.cls}`}>{badge.label}</span>
            {ev.has_pending_edit && <span className="badge bg-info text-dark">Edit under review</span>}
            {hasMessages && <Bell count={Number(ev.admin_message_count)} unread={unread} />}
          </div>
          <div className="small text-muted">{formatDateRange(ev.start_datetime, ev.end_datetime)}</div>
          <div className="small text-muted">{where}</div>
        </div>
      </Link>
    );
  }

  return (
    <div className="col-sm-6 col-lg-4 mb-4">
      <Link href={href} className="text-decoration-none text-reset">
        <div className={`card h-100 shadow-sm ${muted ? 'opacity-75' : ''}`}>
          {ev.image_url && (
            <img src={ev.image_url} alt="" className="card-img-top" style={{ height: 160, objectFit: 'cover' }} />
          )}
          <div className="card-body d-flex flex-column">
            <div className="mb-2 d-flex gap-1 flex-wrap align-items-center">
              <span className={`badge ${badge.cls}`}>{badge.label}</span>
              {ev.has_pending_edit && <span className="badge bg-info text-dark">Edit under review</span>}
              {hasMessages && <Bell count={Number(ev.admin_message_count)} unread={unread} />}
            </div>
            <h5 className="card-title">{ev.name}</h5>
            <p className="card-text small text-muted mb-1">{formatDateRange(ev.start_datetime, ev.end_datetime)}</p>
            <p className="card-text small text-muted mb-0">{where}</p>
            <span className="mt-auto pt-2 small text-success">Manage →</span>
          </div>
        </div>
      </Link>
    </div>
  );
}

function MyEvents({ token, email, events = [] }) {
  const [view, setView] = useState('grid');

  return (
    <main className="container py-5">
      <div className="d-flex flex-wrap justify-content-between align-items-center mb-2 gap-2">
        <h1 className="tw-text-bamboo-slate mb-0" style={{ fontFamily: 'Buenard, Georgia, "Times New Roman", serif' }}>
          Your listings
        </h1>
        <Link href="/submit" className="btn bamboo-btn">List a new event</Link>
      </div>
      <p className="text-muted">Signed in as {email}. Click a listing to manage it.</p>

      <div className="d-flex justify-content-between align-items-center mb-3">
        <span className="text-muted small">
          {events.length} listing{events.length === 1 ? '' : 's'}
        </span>
        <div className="btn-group" role="group" aria-label="View mode">
          <button type="button" className={`btn btn-sm ${view === 'grid' ? 'bamboo-btn' : 'bamboo-btn bamboo-btn--secondary'}`} onClick={() => setView('grid')}>Grid</button>
          <button type="button" className={`btn btn-sm ${view === 'list' ? 'bamboo-btn' : 'bamboo-btn bamboo-btn--secondary'}`} onClick={() => setView('list')}>List</button>
        </div>
      </div>

      {events.length === 0 ? (
        <div className="alert alert-light border text-center py-5">
          You have no listings under this email yet.{' '}
          <Link href="/submit">List an event</Link>.
        </div>
      ) : view === 'grid' ? (
        <div className="row">
          {events.map((ev) => <ManageCard key={ev.event_id} ev={ev} token={token} view="grid" />)}
        </div>
      ) : (
        <div className="list-group">
          {events.map((ev) => <ManageCard key={ev.event_id} ev={ev} token={token} view="list" />)}
        </div>
      )}
    </main>
  );
}

export default MyEvents;
