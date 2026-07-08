// EventSummaryCard — the at-a-glance facts + primary CTA for the public event
// page (SP-1). Presentational only: the parent (EventDetail) computes the
// schedule/where and owns the placement — a sticky right column on desktop and an
// inline block on mobile — mirroring how ManageEvent renders its MessagesPanel in
// two positions. Uses only existing Bootstrap card + utility classes; no themed
// styles (guardrail: theme untouched — layout/position/ordering only).
import { formatDateRange } from '../publicFormat';

// One label/value block. The muted-small label + plain value grouping is the
// "nicer than a bare When:/Where: form" treatment, built from utilities already
// used elsewhere in the app (text-muted small, fw-semibold).
function Fact({ label, children }) {
  return (
    <div className="mb-3">
      <div className="text-muted small mb-1">{label}</div>
      {children}
    </div>
  );
}

function EventSummaryCard({ event, occurrences, multiDate, where, className = '' }) {
  return (
    <div className={`card shadow-sm ${className}`}>
      <div className="card-body">
        <Fact label="When">
          {multiDate ? (
            <>
              <span className="d-block fw-semibold">{occurrences.length} dates</span>
              <ul className="list-unstyled mb-1">
                {occurrences.map((o, i) => (
                  // Schedule rows are order-stable (server-sorted, no reorder).
                  // eslint-disable-next-line react/no-array-index-key
                  <li key={i}>{formatDateRange(o.start, o.end)}</li>
                ))}
              </ul>
            </>
          ) : (
            <div className="fw-semibold">{formatDateRange(occurrences[0].start, occurrences[0].end)}</div>
          )}
          <span className="d-block text-muted small">Local time at the event location.</span>
        </Fact>

        {where && (
          <Fact label="Where">
            <div>{where}</div>
          </Fact>
        )}

        {/* Public organiser name (EP-7). Legacy events omit it (no backfill, F-D6). */}
        {event.organiser_name && (
          <Fact label="Organised by">
            <div>{event.organiser_name}</div>
          </Fact>
        )}

        {event.contact_email && (
          <Fact label="Contact">
            <div>
              <a href={`mailto:${event.contact_email}`}>{event.contact_email}</a>
            </div>
          </Fact>
        )}

        {/* Primary CTA in permanent reach (SPP-D4) — same button/styling as the
            inline one kept at the bottom of the page; only shown when a link exists. */}
        {event.link && (
          <a
            href={event.link}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="btn bamboo-btn bamboo-btn--secondary w-100"
          >
            Visit event website
          </a>
        )}
      </div>
    </div>
  );
}

export default EventSummaryCard;
