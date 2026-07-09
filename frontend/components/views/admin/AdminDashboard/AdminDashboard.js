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
import Inbox from '@/components/views/admin/Inbox';
import ExploreSlugs from '@/components/views/admin/ExploreSlugs';
import { adminService } from '@/core/services/admin';
import { adminAuth } from '@/core/services/adminAuth';

const TABS = [
  { key: 'pending', label: 'Pending review' },
  { key: 'live', label: 'Live listings' },
  { key: 'inbox', label: 'Inbox' },
  { key: 'pricing', label: 'Pricing' },
  { key: 'analytics', label: 'Analytics' },
  { key: 'explore', label: 'Explore / SEO' },
];

function AdminDashboard() {
  const router = useRouter();
  const [tab, setTab] = useState('pending');
  const [unread, setUnread] = useState(0);

  // Client-side session guard (the SSR cookie guard already gates the page; this
  // catches a token cleared after navigation).
  useEffect(() => {
    if (!adminAuth.getToken()) router.replace('/admin/login');
  }, [router]);

  // Unread-reply badge on the Inbox tab. Refreshed on mount and whenever the tab
  // changes (opening a thread marks it read, so leaving Inbox should update it).
  useEffect(() => {
    const token = adminAuth.getToken();
    if (!token) return;
    let alive = true;
    (async () => {
      const { data } = await adminService.getInbox(token);
      if (!alive || data?.code !== 200) return;
      const total = (data.data || []).reduce((n, it) => n + Number(it.unread || 0), 0);
      setUnread(total);
    })();
    return () => {
      alive = false;
    };
  }, [tab]);

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
                {t.key === 'inbox' && unread > 0 && (
                  <span className="badge bg-danger rounded-pill ms-2">{unread}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      </div>

      {tab === 'pending' && <ReviewQueue />}
      {tab === 'live' && <LiveListings />}
      {tab === 'inbox' && <Inbox />}
      {tab === 'pricing' && <PricingTiers />}
      {tab === 'analytics' && <Analytics />}
      {tab === 'explore' && <ExploreSlugs />}
    </div>
  );
}

export default AdminDashboard;
