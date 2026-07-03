// Analytics — the Phase-4B admin analytics panel (plan §8). Shows listing status
// counts, a captured-revenue tally, and an EXPIRING-SOON list of authorised holds
// driven by payments.capture_before (the backend scan is index-backed by
// idx_payments_status_capture). The countdown re-renders each minute so the admin
// sees how long is left before the hourly auto-release job frees a hold.
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';

import { adminService } from '@/core/services/admin';
import { adminAuth } from '@/core/services/adminAuth';
import { formatDateTime, formatFee, timeLeft } from '@/components/views/admin/adminFormat';

// Order the status tiles predictably; anything unexpected still renders after.
const STATUS_ORDER = ['pending_review', 'published', 'unpublished', 'expired', 'rejected'];
const STATUS_LABEL = {
  pending_review: 'Pending',
  published: 'Published',
  unpublished: 'Unpublished',
  expired: 'Auto-expired',
  rejected: 'Rejected',
};

function StatCard({ label, value }) {
  return (
    <div className="col">
      <div className="card text-center h-100">
        <div className="card-body py-3">
          <div className="h4 mb-0">{value}</div>
          <div className="small text-muted">{label}</div>
        </div>
      </div>
    </div>
  );
}

function Analytics() {
  const router = useRouter();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // A ticking clock so timeLeft() re-computes; bumped once a minute.
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    const token = adminAuth.getToken();
    if (!token) {
      router.replace('/admin/login');
      return;
    }
    setLoading(true);
    setError(null);
    let resp;
    try {
      ({ data: resp } = await adminService.getAnalytics(token));
    } catch (err) {
      setError('Could not reach the server. Please try again.');
      setLoading(false);
      return;
    }
    if (resp?.code === 401) {
      adminAuth.logout();
      router.replace('/admin/login');
      return;
    }
    if (resp?.code !== 200) {
      setError(resp?.error || 'Could not load analytics.');
      setLoading(false);
      return;
    }
    setData(resp.data);
    setLoading(false);
  }, [router]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(id);
  }, []);

  const statusCounts = data?.status_counts || {};
  const payments = data?.payments || {};
  const expiring = data?.expiring_soon || [];

  // Known statuses first (in order), then any extras the backend returned.
  const statusKeys = [
    ...STATUS_ORDER.filter((k) => k in statusCounts),
    ...Object.keys(statusCounts).filter((k) => !STATUS_ORDER.includes(k)),
  ];

  return (
    <main className="container py-4" style={{ maxWidth: 960 }}>
      <div className="d-flex justify-content-between align-items-center mb-4">
        <h1 className="tw-text-custom-green mb-0" style={{ fontFamily: 'Sora, sans-serif' }}>
          Analytics
        </h1>
        <button type="button" className="btn btn-outline-secondary btn-sm" onClick={load}>
          Refresh
        </button>
      </div>

      {error && <div className="alert alert-danger">{error}</div>}

      {loading ? (
        <p className="text-muted">Loading…</p>
      ) : (
        <>
          <h5 className="text-muted mb-3">Listings by status</h5>
          <div className="row row-cols-2 row-cols-md-5 g-2 mb-4">
            {statusKeys.length === 0 ? (
              <p className="text-muted">No listings yet.</p>
            ) : (
              statusKeys.map((k) => (
                <StatCard key={k} label={STATUS_LABEL[k] || k} value={statusCounts[k]} />
              ))
            )}
          </div>

          <h5 className="text-muted mb-3">Payments</h5>
          <div className="row row-cols-2 row-cols-md-4 g-2 mb-4">
            <StatCard
              label="Captured revenue"
              value={formatFee(payments.captured_amount, 'USD')}
            />
            <StatCard label="Captured" value={payments.captured_count ?? 0} />
            <StatCard label="Holds active" value={payments.held_count ?? 0} />
            <StatCard label="Auto-released" value={payments.auto_released_count ?? 0} />
          </div>

          <h5 className="text-muted mb-3">
            Expiring soon <span className="text-muted small">(authorised holds awaiting review)</span>
          </h5>
          {expiring.length === 0 ? (
            <p className="text-muted">No holds pending review.</p>
          ) : (
            <table className="table table-sm align-middle">
              <thead>
                <tr>
                  <th>Event</th>
                  <th>Submitter</th>
                  <th>Fee</th>
                  <th>Capture by</th>
                  <th>Time left</th>
                </tr>
              </thead>
              <tbody>
                {expiring.map((row) => {
                  const left = timeLeft(row.capture_before, now);
                  const urgent = left === 'expired' || /^(\d+)m$/.test(left);
                  return (
                    <tr key={row.version_id}>
                      <td>{row.name}</td>
                      <td className="small text-muted">{row.submitter_email}</td>
                      <td>{formatFee(row.amount, row.currency)}</td>
                      <td className="small">{formatDateTime(row.capture_before)}</td>
                      <td>
                        <span className={`badge ${urgent ? 'bg-danger' : 'bg-warning text-dark'}`}>
                          {left}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </>
      )}
    </main>
  );
}

export default Analytics;
