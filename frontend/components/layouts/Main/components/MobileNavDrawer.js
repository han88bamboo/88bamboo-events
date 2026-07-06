// MobileNavDrawer — off-canvas mobile navigation (reference §7). A slide-in panel
// with the full store menu as collapsible accordions plus the Events CTA. Built
// as a self-contained controlled React component (no Bootstrap-JS offcanvas init)
// so it works regardless of when the Bootstrap bundle finishes loading.
import { useState } from 'react';
import Link from 'next/link';

import { STORE_MENU, storeUrl } from '../menuData';

const MobileNavDrawer = ({ open, onClose }) => {
  const [expanded, setExpanded] = useState(null); // label of the open accordion

  const toggle = (label) => setExpanded((cur) => (cur === label ? null : label));

  return (
    <>
      {/* Dimmed backdrop */}
      <div
        role="presentation"
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.4)',
          opacity: open ? 1 : 0,
          visibility: open ? 'visible' : 'hidden',
          transition: 'opacity 0.25s ease, visibility 0.25s ease',
          zIndex: 1045,
        }}
      />
      {/* Panel */}
      <div
        aria-hidden={!open}
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          bottom: 0,
          width: '85%',
          maxWidth: 340,
          background: '#fff',
          transform: open ? 'translateX(0)' : 'translateX(-100%)',
          transition: 'transform 0.25s ease',
          zIndex: 1046,
          overflowY: 'auto',
          padding: '16px 20px',
        }}
      >
        <div className="d-flex justify-content-between align-items-center mb-2">
          <span className="bamboo-nav-link" style={{ fontSize: 18 }}>Menu</span>
          <button
            type="button"
            className="btn-close"
            aria-label="Close menu"
            onClick={onClose}
          />
        </div>

        {/* Events — the app's own section, active here. A normal nav item. */}
        <Link
          href="/"
          className="bamboo-drawer-link bamboo-drawer-link--active"
          onClick={onClose}
        >
          Events
        </Link>

        {STORE_MENU.map((entry) => {
          // Mega-menu and plain-dropdown parents both collapse to one accordion;
          // groups are flattened so the mega-menu's column headers appear inline
          // (as bold links) followed by their child links.
          const children = entry.groups
            ? entry.groups.flatMap((g) => [{ ...g, isHead: true }, ...g.items])
            : entry.items;

          if (children) {
            return (
              <div key={entry.label}>
                <button
                  type="button"
                  className="bamboo-drawer-link d-flex justify-content-between align-items-center"
                  onClick={() => toggle(entry.label)}
                  aria-expanded={expanded === entry.label}
                >
                  <span>{entry.label}</span>
                  <i className={`bi ${expanded === entry.label ? 'bi-chevron-up' : 'bi-chevron-down'}`} />
                </button>
                {expanded === entry.label && (
                  <div>
                    {children.map((it) => (
                      <a
                        key={it.label + it.href}
                        href={storeUrl(it.href)}
                        className={`bamboo-drawer-sublink${it.isHead ? ' bamboo-drawer-sublink--head' : ''}`}
                        onClick={onClose}
                      >
                        {it.label}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            );
          }
          return (
            <a
              key={entry.label}
              href={storeUrl(entry.href)}
              className="bamboo-drawer-link"
              onClick={onClose}
            >
              {entry.label}
            </a>
          );
        })}
      </div>
    </>
  );
};

export default MobileNavDrawer;
