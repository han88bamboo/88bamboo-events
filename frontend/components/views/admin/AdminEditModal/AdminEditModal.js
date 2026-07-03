// AdminEditModal — the admin's direct content-edit form (post-launch feature),
// rendered as a modal over the dashboard. Reuses the transport-agnostic EditEvent
// with an admin-specific onSubmit (adminService.edit) and custom copy.
//
//   • Editing a PENDING listing -> a new pending version (the hold moves onto it);
//     the admin then approves separately. No "inform them" option (it can't go live
//     in one step, so it never qualifies to notify — owner rule).
//   • Editing a LIVE listing -> goes live immediately (repoint + keep slug). The
//     "inform them of edit" checkbox + a short note are offered; the email is sent
//     only when both are provided (server enforces this too).
import { useEffect, useState } from 'react';

import EditEvent from '@/components/views/publicPages/EditEvent';
import { adminService } from '@/core/services/admin';
import { submissionsService } from '@/core/services/submissions';

function buildContext(item, isLive) {
  return {
    is_published: isLive,
    event: {
      name: item.name || '',
      submitter_email: item.submitter_email || '',
      contact_email: item.contact_email || '',
      start_datetime: item.start_datetime || null,
      end_datetime: item.end_datetime || null,
      venue_name: item.venue_name || '',
      venue_address: item.venue_address || '',
      country: item.country || '',
      city: item.city || '',
      description: item.description || '',
      link: item.link || '',
      submission_type: item.submission_type || '',
      event_format: item.event_format || '',
      drink_categories: item.drink_categories || [],
      image_url: item.image_url || null,
    },
  };
}

function AdminEditModal({ token, item, isLive, onClose, onSaved }) {
  const [taxonomy, setTaxonomy] = useState({ drink_categories: [], event_formats: [] });
  const [notify, setNotify] = useState(false);
  const [note, setNote] = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      const tax = await submissionsService.getTaxonomy();
      if (alive) setTaxonomy(tax);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const onSubmit = (fields) =>
    adminService.edit(token, item.version_id, fields, isLive && notify, note);

  const extras = isLive ? (
    <div className="border rounded p-3 mb-3 bg-light">
      <div className="form-check">
        <input
          type="checkbox"
          className="form-check-input"
          id="admin-edit-notify"
          checked={notify}
          onChange={(e) => setNotify(e.target.checked)}
        />
        <label className="form-check-label" htmlFor="admin-edit-notify">
          Inform the submitter of this edit by email
        </label>
      </div>
      {notify && (
        <div className="mt-2">
          <label className="form-label small" htmlFor="admin-edit-note">
            What changed (included in the email)
          </label>
          <textarea
            id="admin-edit-note"
            className="form-control form-control-sm"
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. We tidied the event title and corrected the end time."
          />
        </div>
      )}
      <p className="small text-muted mb-0 mt-2">
        Only sent if ticked with a note — and only because this edit publishes immediately.
      </p>
    </div>
  ) : null;

  const notified = isLive && notify && note.trim();
  const successNode = (
    <div className="p-4">
      <div className="alert alert-success">
        {isLive
          ? `Saved — the listing is updated and live${notified ? ' (submitter notified).' : '.'}`
          : 'Saved — the edited version is now pending your approval.'}
      </div>
      <button type="button" className="btn btn-success" onClick={onSaved}>
        Done
      </button>
    </div>
  );

  return (
    <>
      <div className="modal d-block" tabIndex={-1} role="dialog">
        <div className="modal-dialog modal-dialog-centered modal-lg modal-dialog-scrollable" role="document">
          <div className="modal-content">
            <div className="modal-header">
              <h5 className="modal-title">
                {isLive ? 'Edit live listing' : 'Edit submission'} — {item.name}
              </h5>
              <button type="button" className="btn-close" aria-label="Close" onClick={onClose} />
            </div>
            <div className="modal-body p-0">
              <EditEvent
                context={buildContext(item, isLive)}
                taxonomy={taxonomy}
                onSubmit={onSubmit}
                onCancel={onClose}
                submitLabel={isLive ? 'Save & publish' : 'Save changes'}
                extras={extras}
                successNode={successNode}
              />
            </div>
          </div>
        </div>
      </div>
      <div className="modal-backdrop show" />
    </>
  );
}

export default AdminEditModal;
