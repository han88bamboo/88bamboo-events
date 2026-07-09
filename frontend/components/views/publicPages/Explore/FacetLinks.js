// FacetLinks — the real, crawlable internal links from a place page to its
// category-only and format-only facet pages (EXPLORE-LAYER-PLAN §7, D3). These are
// distinct from ExploreFilters' chips: the chips are client-side query-param toggles
// (not indexable hrefs), whereas these are plain <Link> anchors Google can follow to
// discover and pass equity to the facet pages. Per D3, PAIR facets (e.g. wine-tastings)
// are deliberately NOT listed here — they resolve on demand only, keeping the crawl
// surface bounded. Each entry is { slug, label }; the caller derives them from the
// facets actually present in this place's events.
import Link from 'next/link';

function LinkGroup({ label, placeSlugValue, facets }) {
  if (!facets.length) return null;
  return (
    <div className="mb-2">
      <div className="form-label small mb-1">{label}</div>
      <div className="d-flex flex-wrap gap-2">
        {facets.map((f) => (
          <Link
            key={f.slug}
            href={`/explore/${placeSlugValue}/${f.slug}`}
            className="badge rounded-pill bg-light text-dark text-decoration-none border"
          >
            {f.label}
          </Link>
        ))}
      </div>
    </div>
  );
}

function FacetLinks({ placeSlugValue, categories = [], formats = [] }) {
  if (!categories.length && !formats.length) return null;
  return (
    <nav aria-label="Browse by category or format" className="mb-4">
      <LinkGroup label="Browse by drink category" placeSlugValue={placeSlugValue} facets={categories} />
      <LinkGroup label="Browse by format" placeSlugValue={placeSlugValue} facets={formats} />
    </nav>
  );
}

export default FacetLinks;
