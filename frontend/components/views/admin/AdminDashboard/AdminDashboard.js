// AdminDashboard — the Phase-4B backstage shell (plan §6/§7/§8). A thin tabbed
// container over four self-contained panels:
//   Pending      -> the proven 4A ReviewQueue (approve / reject)
//   Live listings-> LiveListings (unpublish, past badges, version history)
//   Pricing      -> PricingTiers (CRUD, single-active invariant)
//   Analytics    -> Analytics (status counts + expiring-soon countdown)
//
// Each panel fetches its own data client-side with the Bearer session token (the
// API is a different origin from this backstage app — plan §5.3) and owns its
// header/refresh/sign-out, mirroring ReviewQueue. This shell only tracks the
// active tab and guards the session on mount.
import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';

import ReviewQueue from '@/components/views/admin/ReviewQueue';
import LiveListings from '@/components/views/admin/LiveListings';
import PricingTiers from '@/components/views/admin/PricingTiers';
import Analytics from '@/components/views/admin/Analytics';
import { adminAuth } from '@/core/services/adminAuth';

const TABS = [
  { key: 'pending', label: 'Pending review' },
  { key: 'live', label: 'Live listings' },
  { key: 'pricing', label: 'Pricing' },
  { key: 'analytics', label: 'Analytics' },
];

function AdminDashboard() {
  const router = useRouter();
  const [tab, setTab] = useState('pending');

  // Client-side session guard (the SSR cookie guard already gates the page; this
  // catches a token cleared after navigation).
  useEffect(() => {
    if (!adminAuth.getToken()) router.replace('/admin/login');
  }, [router]);

  return (
    <div>
      <div className="container pt-4" style={{ maxWidth: 960 }}>
        <ul className="nav nav-tabs">
          {TABS.map((t) => (
            <li className="nav-item" key={t.key}>
              <button
                type="button"
                className={`nav-link ${tab === t.key ? 'active' : ''}`}
                onClick={() => setTab(t.key)}
              >
                {t.label}
              </button>
            </li>
          ))}
        </ul>
      </div>

      {tab === 'pending' && <ReviewQueue />}
      {tab === 'live' && <LiveListings />}
      {tab === 'pricing' && <PricingTiers />}
      {tab === 'analytics' && <Analytics />}
    </div>
  );
}

export default AdminDashboard;
