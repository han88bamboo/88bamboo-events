// PricingTiers — the Phase-4B pricing-tier CRUD panel (plan §6/§7).
//
// The submission flow prices new listings off the active tier read as
// `WHERE active = TRUE ORDER BY id LIMIT 1`. To keep that DETERMINISTIC the
// backend enforces a SINGLE-ACTIVE invariant: saving a tier as active deactivates
// all others. This panel surfaces that — exactly one row shows the "Active" badge,
// and activating another moves it. Create / edit / delete round out the CRUD.
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';

import { adminService } from '@/core/services/admin';
import { adminAuth } from '@/core/services/adminAuth';
import { formatFee } from '@/components/views/admin/adminFormat';

const EMPTY_FORM = {
  label: '',
  price: '',
  currency: 'USD',
  featured_duration_days: '',
  active: true,
};

function TierForm({ initial, submitting, onSubmit, onCancel }) {
  const [form, setForm] = useState(initial || EMPTY_FORM);
  const set = (k) => (e) => {
    const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setForm((f) => ({ ...f, [k]: value }));
  };

  return (
    <form
      className="row g-2 align-items-end border rounded p-3 mb-3 bg-light"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(form);
      }}
    >
      <div className="col-sm-4">
        <label className="form-label small mb-1">Label</label>
        <input className="form-control form-control-sm" value={form.label} onChange={set('label')} required />
      </div>
      <div className="col-sm-2">
        <label className="form-label small mb-1">Price</label>
        <input
          type="number"
          step="0.01"
          min="0"
          className="form-control form-control-sm"
          value={form.price}
          onChange={set('price')}
          required
        />
      </div>
      <div className="col-sm-2">
        <label className="form-label small mb-1">Currency</label>
        <input
          className="form-control form-control-sm"
          value={form.currency}
          onChange={set('currency')}
          maxLength={3}
          required
        />
      </div>
      <div className="col-sm-2">
        <label className="form-label small mb-1">Featured days</label>
        <input
          type="number"
          min="0"
          className="form-control form-control-sm"
          value={form.featured_duration_days ?? ''}
          onChange={set('featured_duration_days')}
          placeholder="—"
        />
      </div>
      <div className="col-sm-2">
        <div className="form-check mt-3">
          <input
            className="form-check-input"
            type="checkbox"
            id="tier-active"
            checked={!!form.active}
            onChange={set('active')}
          />
          <label className="form-check-label small" htmlFor="tier-active">
            Active
          </label>
        </div>
      </div>
      <div className="col-12 d-flex gap-2 mt-2">
        <button type="submit" className="btn btn-primary btn-sm" disabled={submitting}>
          Save tier
        </button>
        {onCancel && (
          <button type="button" className="btn btn-link btn-sm text-muted" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

function PricingTiers() {
  const router = useRouter();
  const [tiers, setTiers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [editing, setEditing] = useState(null); // tier id being edited, or 'new', or null

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
      ({ data } = await adminService.getPricingTiers(token));
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
      setError(data?.error || 'Could not load pricing tiers.');
      setLoading(false);
      return;
    }
    setTiers(data.data || []);
    setLoading(false);
  }, [router]);

  useEffect(() => {
    load();
  }, [load]);

  const save = async (form, tierId) => {
    setSubmitting(true);
    setNotice(null);
    setError(null);
    const token = adminAuth.getToken();
    const payload = {
      label: form.label,
      price: form.price,
      currency: form.currency,
      featured_duration_days: form.featured_duration_days === '' ? null : form.featured_duration_days,
      active: !!form.active,
    };
    const { data, ok } = tierId
      ? await adminService.updatePricingTier(token, tierId, payload)
      : await adminService.createPricingTier(token, payload);
    setSubmitting(false);
    if (!ok) {
      setError(data?.error || 'Could not save the tier.');
      return;
    }
    setEditing(null);
    setNotice('Pricing tier saved.');
    load();
  };

  const activate = async (tier) => {
    // Activating = save the tier as active; the backend deactivates the rest.
    await save({ ...tier, active: true }, tier.id);
  };

  const remove = async (tier) => {
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Delete tier “${tier.label}”?`)) return;
    setSubmitting(true);
    setNotice(null);
    setError(null);
    const token = adminAuth.getToken();
    const { data, ok } = await adminService.deletePricingTier(token, tier.id);
    setSubmitting(false);
    if (!ok) {
      setError(data?.error || 'Could not delete the tier.');
      return;
    }
    setNotice('Pricing tier deleted.');
    load();
  };

  const activeCount = tiers.filter((t) => t.active).length;

  return (
    <main className="container py-4" style={{ maxWidth: 960 }}>
      <div className="d-flex justify-content-between align-items-center mb-4">
        <h1 className="tw-text-bamboo-slate mb-0" style={{ fontFamily: 'Buenard, Georgia, "Times New Roman", serif' }}>
          Pricing tiers
        </h1>
        <button type="button" className="btn btn-outline-secondary btn-sm" onClick={load}>
          Refresh
        </button>
      </div>

      <p className="text-muted small">
        New submissions are priced off the single <strong>active</strong> tier. Activating a
        tier automatically deactivates the others, so pricing stays deterministic.
      </p>

      {activeCount === 0 && !loading && (
        <div className="alert alert-warning">
          No tier is active — new submissions cannot be priced. Activate one below.
        </div>
      )}
      {notice && <div className="alert alert-success">{notice}</div>}
      {error && <div className="alert alert-danger">{error}</div>}

      {loading ? (
        <p className="text-muted">Loading…</p>
      ) : (
        <>
          <table className="table align-middle">
            <thead>
              <tr>
                <th>Label</th>
                <th>Price</th>
                <th>Featured days</th>
                <th>Status</th>
                <th className="text-end">Actions</th>
              </tr>
            </thead>
            <tbody>
              {tiers.map((tier) =>
                editing === tier.id ? (
                  <tr key={tier.id}>
                    <td colSpan={5}>
                      <TierForm
                        initial={{
                          label: tier.label,
                          price: tier.price,
                          currency: tier.currency,
                          featured_duration_days: tier.featured_duration_days ?? '',
                          active: tier.active,
                        }}
                        submitting={submitting}
                        onSubmit={(form) => save(form, tier.id)}
                        onCancel={() => setEditing(null)}
                      />
                    </td>
                  </tr>
                ) : (
                  <tr key={tier.id}>
                    <td>{tier.label}</td>
                    <td>{formatFee(tier.price, tier.currency)}</td>
                    <td>{tier.featured_duration_days ?? '—'}</td>
                    <td>
                      {tier.active ? (
                        <span className="badge bg-success">Active</span>
                      ) : (
                        <span className="badge bg-light text-dark">Inactive</span>
                      )}
                    </td>
                    <td className="text-end">
                      <div className="d-flex gap-2 justify-content-end">
                        {!tier.active && (
                          <button
                            type="button"
                            className="btn bamboo-btn bamboo-btn--secondary btn-sm"
                            disabled={submitting}
                            onClick={() => activate(tier)}
                          >
                            Activate
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn btn-outline-secondary btn-sm"
                          disabled={submitting}
                          onClick={() => setEditing(tier.id)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="btn btn-outline-danger btn-sm"
                          disabled={submitting}
                          onClick={() => remove(tier)}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>

          {editing === 'new' ? (
            <TierForm
              submitting={submitting}
              onSubmit={(form) => save(form, null)}
              onCancel={() => setEditing(null)}
            />
          ) : (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => setEditing('new')}
            >
              + New tier
            </button>
          )}
        </>
      )}
    </main>
  );
}

export default PricingTiers;
