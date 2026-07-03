// Layout-private footer (PATTERN-SPEC §B4.2.4).
import Link from 'next/link';

const FooterBar = () => (
  <footer className="py-4 mt-5" style={{ backgroundColor: '#0B4321', color: '#FFFCF6' }}>
    <div className="container text-center">
      <div className="mb-2">
        <Link href="/submit" className="text-decoration-none me-3" style={{ color: '#FFFCF6' }}>
          List an event
        </Link>
        <Link href="/account" className="text-decoration-none" style={{ color: '#FFFCF6' }}>
          Manage your listings
        </Link>
      </div>
      <small>© 2026 88 Bamboo · Events</small>
    </div>
  </footer>
);

export default FooterBar;
