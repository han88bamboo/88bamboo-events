// FooterBar — an exact visual replica of the 88bamboo.co storefront footer
// (STYLE-PARITY-PLAN Decision 7; reference §8): light #f5f5f5 background, two
// blocks (Quick links + Newsletter), a divider, then social icons + copyright.
//
// The newsletter is PRESENTATIONAL ONLY — "no live newsletter" (owner). The
// Subscribe control links out to the store rather than posting anywhere, so no
// Shopify/Mailchimp logic is reproduced. Shopify-checkout-only widgets
// (currency/locale/payment selectors) are omitted — a broken selector would be
// less faithful than none.
import Link from 'next/link';

import { FOOTER_LINKS, SOCIAL_LINKS, STORE_ORIGIN, storeUrl } from '../menuData';

// Events-app-native quick links (relative — resolved under basePath by next/link).
const EVENTS_LINKS = [
  { label: 'Browse events', href: '/' },
  { label: 'List an event', href: '/submit' },
  { label: 'Manage your listing', href: '/account' },
];

const FooterBar = () => (
  <footer className="bamboo-footer mt-5 py-5">
    <div className="page-width">
      <div className="row g-4">
        {/* Block 1 — Quick links (events-native first, then the store's footer menu) */}
        <div className="col-12 col-md-6">
          <h4 className="h4 mb-3">Quick links</h4>
          <ul className="list-unstyled mb-0">
            {EVENTS_LINKS.map((l) => (
              <li className="mb-2" key={l.label}>
                <Link href={l.href}>{l.label}</Link>
              </li>
            ))}
            {FOOTER_LINKS.map((l) => (
              <li className="mb-2" key={l.label}>
                <a href={storeUrl(l.href)}>{l.label}</a>
              </li>
            ))}
          </ul>
        </div>

        {/* Block 2 — Newsletter (presentational; links out to the store) */}
        <div className="col-12 col-md-6">
          <h4 className="h4 mb-3">
            Subscribe to receive the latest recommendations, releases and exclusive
            offers.
          </h4>
          <div className="d-flex flex-column flex-sm-row gap-2" style={{ maxWidth: 420 }}>
            <input
              type="email"
              className="form-control"
              placeholder="Email address"
              aria-label="Email address"
            />
            {/* Non-live: hands the signup back to the main store. */}
            <a
              href={`${STORE_ORIGIN}/pages/send-us`}
              className="bamboo-btn flex-shrink-0"
            >
              Subscribe
            </a>
          </div>
        </div>
      </div>

      <hr className="bamboo-footer__hr" />

      <div className="d-flex flex-column flex-sm-row justify-content-between align-items-center gap-3">
        <div className="bamboo-footer__social">
          {SOCIAL_LINKS.map((s) => (
            <a
              key={s.label}
              href={s.href}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={s.label}
            >
              <i className={`bi ${s.icon}`} />
            </a>
          ))}
        </div>
        <small>© {new Date().getFullYear()}, 88 Bamboo</small>
      </div>
    </div>
  </footer>
);

export default FooterBar;
