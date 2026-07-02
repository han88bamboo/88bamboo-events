// Layout-private nav (PATTERN-SPEC §B4.2.4). Scaffold placeholder — links use
// next/link so basePath '/a/events' is applied automatically.
import Link from 'next/link';

const NavBar = () => (
  <nav className="navbar navbar-expand-lg" style={{ backgroundColor: '#FFFCF6', borderBottom: '1px solid #eee' }}>
    <div className="container">
      <Link href="/" className="navbar-brand fw-bold" style={{ color: '#0B4321' }}>
        88 Bamboo Events
      </Link>
    </div>
  </nav>
);

export default NavBar;
