// NavBar — a FULL replica of the 88bamboo.co storefront header (STYLE-PARITY-PLAN
// Decision 1): logo left (70px) + the complete store menu with the store's real
// mega-menus. Store links are absolute to 88bamboo.co (they leave the events app
// back into the main site); only the "Events" tab is a relative next/link resolved
// under basePath.
//
// Desktop dropdowns are pure CSS (hover / focus-within) — no Bootstrap dropdown JS —
// so a `groups` entry renders as a centered multi-column mega-menu and an `items`
// entry as a plain dropdown box, mirroring the store. Mobile uses the slide-in
// drawer (MobileNavDrawer). The header is sticky (see globals.css .bamboo-navbar).
import { useState } from 'react';
import Link from 'next/link';

import { STORE_MENU, LOGO_URL, STORE_ORIGIN, storeUrl } from '../menuData';
import MobileNavDrawer from './MobileNavDrawer';

// A top-level nav label + its caret. Shared by mega-menu and plain-dropdown parents.
const TopButton = ({ label }) => (
  <button type="button" className="nav-link bamboo-nav-link" aria-haspopup="true" aria-expanded="false">
    <span className="bamboo-nav-link__label">{label}</span>
    <span className="bamboo-caret" aria-hidden="true" />
  </button>
);

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
            {STORE_MENU.map((entry) => {
              // Mega-menu parent: centered, full-width band of bold-headed columns.
              if (entry.groups) {
                return (
                  <li className="nav-item bamboo-has-mega" key={entry.label}>
                    <TopButton label={entry.label} />
                    <div className="bamboo-megamenu">
                      <div className="bamboo-megamenu__inner">
                        {entry.groups.map((group) => (
                          <div className="bamboo-megamenu__col" key={group.label}>
                            <a className="bamboo-megamenu__head" href={storeUrl(group.href)}>
                              {group.label}
                            </a>
                            {group.items.map((it) => (
                              <a className="bamboo-megamenu__link" href={storeUrl(it.href)} key={it.label + it.href}>
                                {it.label}
                              </a>
                            ))}
                          </div>
                        ))}
                      </div>
                    </div>
                  </li>
                );
              }
              // Plain dropdown parent: a single left-aligned box of links.
              if (entry.items) {
                return (
                  <li className="nav-item bamboo-has-dropdown" key={entry.label}>
                    <TopButton label={entry.label} />
                    <div className="bamboo-dropdown">
                      {entry.items.map((it) => (
                        <a className="bamboo-megamenu__link" href={storeUrl(it.href)} key={it.label + it.href}>
                          {it.label}
                        </a>
                      ))}
                    </div>
                  </li>
                );
              }
              // Direct top-level link.
              return (
                <li className="nav-item" key={entry.label}>
                  <a className="nav-link bamboo-nav-link" href={storeUrl(entry.href)}>
                    <span className="bamboo-nav-link__label">{entry.label}</span>
                  </a>
                </li>
              );
            })}

            {/* Events — this app's own section, so it is the active tab here.
                A normal nav item (to the right of Bookmarks), not a button. */}
            <li className="nav-item" key="Events">
              <Link className="nav-link bamboo-nav-link bamboo-nav-link--active" href="/">
                <span className="bamboo-nav-link__label">Events</span>
              </Link>
            </li>
          </ul>
        </nav>

        {/* Right side: hamburger (mobile only). */}
        <div className="d-flex align-items-center gap-2 ms-auto flex-shrink-0">
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
