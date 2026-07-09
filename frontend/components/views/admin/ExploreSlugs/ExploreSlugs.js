// ExploreSlugs — the admin "Explore / SEO" tab (EXPLORE-LAYER-PLAN §7A / D3b). The
// owner's ONLY control surface for the Explore layer: promote a place/facet URL into the
// sitemap allowlist (and optionally pin it to index via force_index), see each promoted
// URL's live upcoming count + whether it still resolves, and remove one. It does NOT edit
// slugs/H1s/filters — those are auto-derived in code; this only curates PROMOTION.
//
// Structure mirrors PricingTiers (guarded list + add + remove CRUD): same session guard,
// load/refresh, notice/error banners, and inline table. Backed by the admin-guarded
// GET/POST/DELETE /admin/explore-slugs endpoints (Phase C).
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';

import { adminService } from '@/core/services/admin';
import { adminAuth } from '@/core/services/adminAuth';

function AddForm({ submitting, onSubmit }) {
  const [path, setPath] = useState('');
  const [forceIndex, setForceIndex] = useState(true);

  return (
    <form
      className="row g-2 align-items-end border rounded p-3 mb-3 bg-light"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(path, forceIndex, () => setPath(''));
      }}
    >
      <div className="col-sm-7">
        <label className="form-label small mb-1" htmlFor="explore-path">
          Path below <code>/explore</code>
        </label>
        <input
          id="explore-path"
          className="form-control form-control-sm"
          value={path}
          onChange={(e) => setPath(e.target.value)}
          placeholder="singapore  or  singapore/wine-tastings"
          required
        />
      </div>
      <div className="col-sm-3">
        <div className="form-check mt-3">
          <input
            className="form-check-input"
            type="checkbox"
            id="explore-force-index"
            checked={forceIndex}
            onChange={(e) => setForceIndex(e.target.checked)}
          />
          <label className="form-check-label small" htmlFor="explore-force-index">
            Force index
          </label>
        </div>
      </div>
      <div className="col-sm-2 d-grid">
        <button type="submit" className="btn btn-primary btn-sm" disabled={submitting}>
          Promote
        </button>
      </div>
    </form>
  );
}

function ExploreSlugs() {
  const router = useRouter();
  const [slugs, setSlugs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [submitting, setSubmitting] = useState(false);

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
      ({ data } = await adminService.getExploreSlugs(token));
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
      setError(data?.error || 'Could not load promoted URLs.');
      setLoading(false);
      return;
    }
    setSlugs(data.data || []);
    setLoading(false);
  }, [router]);

  useEffect(() => {
    load();
  }, [load]);

  const add = async (path, forceIndex, reset) => {
    setSubmitting(true);
    setNotice(null);
    setError(null);
    const token = adminAuth.getToken();
    const { data, ok } = await adminService.createExploreSlug(token, path, forceIndex);
    setSubmitting(false);
    if (!ok) {
      setError(data?.error || 'Could not promote that URL.');
      return;
    }
    // The POST reports 0-count paths (pre-seeding) — surface the warning but keep the row.
    setNotice(
      data?.data?.warning_empty
        ? `Promoted “${data.data.path}” — note it currently has 0 upcoming events.`
        : `Promoted “${data.data.path}”.`,
    );
    reset();
    load();
  };

  const remove = async (slug) => {
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Remove “${slug.path}” from the sitemap allowlist?`)) return;
    setSubmitting(true);
    setNotice(null);
    setError(null);
    const token = adminAuth.getToken();
    const { data, ok } = await adminService.deleteExploreSlug(token, slug.id);
    setSubmitting(false);
    if (!ok) {
      setError(data?.error || 'Could not remove the URL.');
      return;
    }
    setNotice('Promoted URL removed.');
    load();
  };

  return (
    <main className="container py-4" style={{ maxWidth: 960 }}>
      <div className="d-flex justify-content-between align-items-center mb-4">
        <h1 className="tw-text-bamboo-slate mb-0" style={{ fontFamily: 'Buenard, Georgia, "Times New Roman", serif' }}>
          Explore / SEO
        </h1>
        <button type="button" className="btn btn-outline-secondary btn-sm" onClick={load}>
          Refresh
        </button>
      </div>

      <p className="text-muted small">
        Promote a place or place/facet URL into <code>sitemap.xml</code>. Everything under{' '}
        <code>/explore</code> still renders and can rank on its own — this list is your
        amplification lever. <strong>Force index</strong> pins a page to <code>index</code>{' '}
        even below the usual 3-upcoming-events threshold (useful when pre-seeding a city).
      </p>

      {notice && <div className="alert alert-success">{notice}</div>}
      {error && <div className="alert alert-danger">{error}</div>}

      <AddForm submitting={submitting} onSubmit={add} />

      {loading ? (
        <p className="text-muted">Loading…</p>
      ) : slugs.length === 0 ? (
        <p className="text-muted">No promoted URLs yet. Add one above.</p>
      ) : (
        <table className="table align-middle">
          <thead>
            <tr>
              <th>Path</th>
              <th>Upcoming</th>
              <th>Status</th>
              <th className="text-end">Actions</th>
            </tr>
          </thead>
          <tbody>
            {slugs.map((slug) => (
              <tr key={slug.id}>
                <td>
                  <code>/explore/{slug.path}</code>
                </td>
                <td>{slug.upcoming_count}</td>
                <td>
                  <div className="d-flex gap-1 flex-wrap">
                    {slug.force_index ? (
                      <span className="badge bg-success">Force index</span>
                    ) : (
                      <span className="badge bg-light text-dark">Auto (≥3)</span>
                    )}
                    {!slug.resolves && <span className="badge bg-warning text-dark">Unresolved</span>}
                  </div>
                </td>
                <td className="text-end">
                  <button
                    type="button"
                    className="btn btn-outline-danger btn-sm"
                    disabled={submitting}
                    onClick={() => remove(slug)}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}

export default ExploreSlugs;
