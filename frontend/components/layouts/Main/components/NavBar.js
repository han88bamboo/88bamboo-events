// NavBar — a FULL replica of the 88bamboo.co storefront header (STYLE-PARITY-PLAN
// Decision 1): logo left (70px), the complete store menu with dropdowns, plus an
// added brand "Events" button that links to this app's listing. Store links are
// absolute to 88bamboo.co (they leave the events app back into the main site);
// only the Events CTA is a relative next/link resolved under basePath.
//
// Desktop dropdowns use the Bootstrap dropdown JS bundle (loaded in _app.js).
// Mobile uses a self-contained slide-in drawer (MobileNavDrawer).
import { useState } from 'react';
import Link from 'next/link';

import { STORE_MENU, LOGO_URL, STORE_ORIGIN, storeUrl } from '../menuData';
import MobileNavDrawer from './MobileNavDrawer';

const NavBar = () => {
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <header className="bamboo-navbar">
      <div className="bamboo-navbar__row d-flex align-items-center py-2 gap-3">
        {/* Logo (left). Plain <img> so no next.config remotePatterns entry is
            needed; links back to the main store home. */}
        <a href={STORE_ORIGIN} className="d-inline-flex align-items-center flex-shrink-0" aria-label="88 Bamboo home">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={LOGO_URL} alt="88 Bamboo" className="bamboo-logo" />
        </a>

        {/* Desktop menu */}
        <nav className="d-none d-lg-block flex-grow-1" aria-label="Main">
          <ul className="nav align-items-center justify-content-center mb-0">
            {STORE_MENU.map((entry) =>
              entry.items ? (
                <li className="nav-item dropdown" key={entry.label}>
                  <button
                    type="button"
                    className="nav-link bamboo-nav-link dropdown-toggle"
                    data-bs-toggle="dropdown"
                    aria-expanded="false"
                  >
                    {entry.label}
                  </button>
                  <ul className="dropdown-menu">
                    {entry.items.map((it) => (
                      <li key={it.label + it.href}>
                        <a className="dropdown-item" href={storeUrl(it.href)}>
                          {it.label}
                        </a>
                      </li>
                    ))}
                  </ul>
                </li>
              ) : (
                <li className="nav-item" key={entry.label}>
                  <a className="nav-link bamboo-nav-link" href={storeUrl(entry.href)}>
                    {entry.label}
                  </a>
                </li>
              ),
            )}
          </ul>
        </nav>

        {/* Right side: Events CTA (desktop) + hamburger (mobile) */}
        <div className="d-flex align-items-center gap-2 ms-auto flex-shrink-0">
          <Link href="/" className="bamboo-btn bamboo-btn--small d-none d-lg-inline-block">
            Events
          </Link>
          <button
            type="button"
            className="btn bamboo-nav-link d-lg-none fs-3 p-1 lh-1"
            aria-label="Open menu"
            onClick={() => setDrawerOpen(true)}
          >
            <i className="bi bi-list" />
          </button>
        </div>
      </div>

      <MobileNavDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
    </header>
  );
};

export default NavBar;
