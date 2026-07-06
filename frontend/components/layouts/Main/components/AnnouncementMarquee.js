// AnnouncementMarquee — the green "Just In" strip that sits at the very top of
// every 88bamboo.co page (reference §6). On the store it shows the latest blog
// article; here it is a STATIC branded strip (STYLE-PARITY-PLAN Decision 9) so the
// proxied SSR page carries no cross-origin Shopify-blog dependency. It points at
// the events listing, reinforcing the events board as the "just in" thing here.
import Link from 'next/link';

const AnnouncementMarquee = () => (
  <div className="bamboo-marquee text-center py-2 px-3">
    {/* Relative link — next/link resolves it under basePath '/a/events'. */}
    <Link href="/">Just In 👉 Discover upcoming events &amp; promotions</Link>
  </div>
);

export default AnnouncementMarquee;
