// MobileNavDrawer — the mobile menu, rebuilt to open the same way as the
// 88bamboo.co storefront: a FULL-WIDTH panel that drops down under the header
// (not a side off-canvas), with a multi-level DRILL-DOWN — tapping a section
// slides to a sub-panel (with a back button) showing its groups, and tapping a
// group slides to its links. Mirrors the store's mobile-nav-wrapper behaviour
// without porting any theme JS. Controlled by NavBar (open / onClose); the
// hamburger there toggles it and swaps to an X.
import { useState, useEffect } from 'react';
import Link from 'next/link';

import { STORE_MENU, storeUrl } from '../menuData';

// Normalise STORE_MENU (+ the events-native Events tab) into a drill-down tree.
// A node with `children` is drillable; a node with only `href` is a leaf link.
const leaf = (it) => ({ label: it.label, href: it.href });
const groupNode = (g) =>
  g.items && g.items.length
    ? { label: g.label, href: g.href, children: g.items.map(leaf) }
    : { label: g.label, href: g.href };
const topNode = (e) => {
  if (e.groups) return { label: e.label, children: e.groups.map(groupNode) };
  if (e.items) return { label: e.label, children: e.items.map(leaf) };
  return { label: e.label, href: e.href };
};
const ROOT_NODES = [
  ...STORE_MENU.map(topNode),
  { label: 'Events', href: '/', internal: true, active: true },
];

const MobileNavDrawer = ({ open, onClose }) => {
  const [trail, setTrail] = useState([]); // stack of drilled-into nodes

  // Always return to the root when the menu is dismissed.
  useEffect(() => {
    if (!open) setTrail([]);
  }, [open]);

  const current = trail[trail.length - 1] || null;
  // A drilled section repeats its own page link (if it has one) at the top, then
  // its children — exactly like the store's mobile drill panels.
  const items = current
    ? [...(current.href ? [{ ...current, self: true }] : []), ...current.children]
    : ROOT_NODES;

  const drillInto = (node) => setTrail((t) => [...t, node]);
  const back = () => setTrail((t) => t.slice(0, -1));

  const renderRow = (node, i) => {
    const drillable = node.children && node.children.length && !node.self;
    if (drillable) {
      return (
        <button
          type="button"
          key={node.label + i}
          className="bamboo-mm__row bamboo-mm__row--parent"
          onClick={() => drillInto(node)}
        >
          <span>{node.label}</span>
          <span className="bamboo-mm__chevron" aria-hidden="true" />
        </button>
      );
    }
    const cls = `bamboo-mm__row bamboo-mm__row--link${node.active ? ' bamboo-mm__row--active' : ''}`;
    if (node.internal) {
      return (
        <Link key={node.label + i} href={node.href} className={cls} onClick={onClose}>
          {node.label}
        </Link>
      );
    }
    return (
      <a key={node.label + i} href={storeUrl(node.href)} className={cls} onClick={onClose}>
        {node.label}
      </a>
    );
  };

  return (
    <div id="BambooMobileMenu" className={`bamboo-mobile-menu d-lg-none${open ? ' is-open' : ''}`} aria-hidden={!open}>
      {current && (
        <button type="button" className="bamboo-mm__back" onClick={back}>
          <span className="bamboo-mm__back-arrow" aria-hidden="true" />
          <span>{current.label}</span>
        </button>
      )}
      {/* keyed on depth so each drill remounts and slides in */}
      <div className="bamboo-mm__panel" key={trail.length}>
        {items.map(renderRow)}
      </div>
    </div>
  );
};

export default MobileNavDrawer;
