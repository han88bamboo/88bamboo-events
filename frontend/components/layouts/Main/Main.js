// Main layout — the default site chrome (PATTERN-SPEC §B4.2.4), restyled to match
// the 88bamboo.co storefront (STYLE-PARITY-PLAN §6). Stacking order mirrors the
// store, top-to-bottom: green "Just In" marquee → header/nav → yellow reviews bar
// (top of main content) → page content → footer.
import AnnouncementMarquee from './components/AnnouncementMarquee';
import NavBar from './components/NavBar';
import ReviewsBar from './components/ReviewsBar';
import FooterBar from './components/FooterBar';

const Main = ({ children }) => (
  <>
    <AnnouncementMarquee />
    <NavBar />
    {/* Reviews bar sits flush under the nav (like the store); the .main-content
        top padding then provides the gap BELOW it, before the page content. A
        <div> wrapper (not <main>) keeps each page's own view as the single <main>. */}
    <ReviewsBar />
    <div className="main-content" id="MainContent">
      {children}
    </div>
    <FooterBar />
  </>
);

export default Main;
