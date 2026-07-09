// Breadcrumbs — plain breadcrumb trail for the Explore pages (EXPLORE-LAYER-PLAN §6):
// Home › Events › Explore › {Place} › {Facet}. Rendering only; the BreadcrumbList
// JSON-LD builder is Phase E, so nothing structured is emitted here yet.
//
// `items` is an ordered list of { label, href?, external? }. The LAST item is the
// current page and is rendered unlinked/active. An `external` item (e.g. the store
// Home, which lives outside this app's basePath) renders a plain <a>; in-app items
// use next/link so basePath '/a/events' is prepended automatically.
import Link from 'next/link';

function Breadcrumbs({ items = [] }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-3">
      <ol className="breadcrumb small mb-0">
        {items.map((item, i) => {
          const isLast = i === items.length - 1;
          return (
            <li
              // Labels are unique within a trail, so a label key is stable here.
              key={item.label}
              className={`breadcrumb-item ${isLast ? 'active' : ''}`}
              aria-current={isLast ? 'page' : undefined}
            >
              {isLast || !item.href ? (
                item.label
              ) : item.external ? (
                <a href={item.href}>{item.label}</a>
              ) : (
                <Link href={item.href}>{item.label}</Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export default Breadcrumbs;
