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
    {/* A <div> wrapper (not <main>) so each page's own view supplies the single
        <main> landmark; the reviews bar sits at the very top of the content. */}
    <div className="main-content" id="MainContent">
      <ReviewsBar />
      {children}
    </div>
    <FooterBar />
  </>
);

export default Main;
