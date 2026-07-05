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

        {/* Events CTA first — the app's own purpose. */}
        <Link href="/" className="bamboo-btn w-100 mb-3" onClick={onClose}>
          Browse events
        </Link>

        {STORE_MENU.map((entry) =>
          entry.items ? (
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
                  {entry.items.map((it) => (
                    <a
                      key={it.label + it.href}
                      href={storeUrl(it.href)}
                      className="bamboo-drawer-sublink"
                      onClick={onClose}
                    >
                      {it.label}
                    </a>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <a
              key={entry.label}
              href={storeUrl(entry.href)}
              className="bamboo-drawer-link"
              onClick={onClose}
            >
              {entry.label}
            </a>
          ),
        )}
      </div>
    </>
  );
};

export default MobileNavDrawer;
