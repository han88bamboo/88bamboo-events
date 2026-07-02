// Layout-private footer (PATTERN-SPEC §B4.2.4). Scaffold placeholder.
const FooterBar = () => (
  <footer className="py-4 mt-5" style={{ backgroundColor: '#0B4321', color: '#FFFCF6' }}>
    <div className="container text-center">
      <small>© {new Date().getFullYear()} 88 Bamboo · Events</small>
    </div>
  </footer>
);

export default FooterBar;
