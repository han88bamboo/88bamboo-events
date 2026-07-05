// ReviewsBar — the yellow "Over 2,500+ in-depth reviews" strip from the storefront
// (reference §6). Links go to the MAIN store's review pages (absolute URLs), so a
// visitor can cross back into 88bamboo.co content. It sits at the top of the main
// content on every page, matching the store's stacking order.
import { REVIEWS_BAR } from '../menuData';

const ReviewsBar = () => (
  <nav className="bamboo-reviews-bar py-2 px-3" aria-label="88 Bamboo reviews">
    <div className="page-width d-flex flex-wrap align-items-center justify-content-center gap-2 small">
      <span className="bamboo-reviews-bar__label">Over 2,500+ in-depth reviews:</span>
      {REVIEWS_BAR.map((r, i) => (
        <span key={r.href} className="d-inline-flex align-items-center">
          {i > 0 && <span className="mx-2 text-muted d-none d-sm-inline">|</span>}
          <a href={r.href} target="_blank" rel="noopener noreferrer">
            {r.label}
          </a>
        </span>
      ))}
    </div>
  </nav>
);

export default ReviewsBar;
