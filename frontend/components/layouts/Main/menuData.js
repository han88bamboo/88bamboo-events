// menuData.js — the 88bamboo.co storefront navigation, captured verbatim from the
// live site (2026-07-06) so the Events navbar/footer are a FULL replica of the
// store (STYLE-PARITY-PLAN Decision 1/7). These are the MAIN-STORE links, so they
// are absolute URLs to https://88bamboo.co — NOT Next.js routes. Only the Events
// app's own links (the "Events" CTA, footer events links) use relative paths that
// next/link resolves under basePath '/a/events'.
//
// This is plain data, not Shopify Liquid — no theme logic is ported.

export const STORE_ORIGIN = 'https://88bamboo.co';

// White-on-transparent brand logo, 70px (reference §6). Loaded via a plain <img>
// (not next/image) so it needs no next.config remotePatterns entry.
export const LOGO_URL =
  'https://88bamboo.co/cdn/shop/files/88B_New_Logo_-_white_face_transparent_background_300x300.png?v=1655894111';

// Resolve a captured href to a full URL. Relative paths (/pages/…, /blogs/…) are
// prefixed with the store origin; already-absolute links pass through untouched.
export const storeUrl = (path) =>
  /^https?:\/\//.test(path) ? path : `${STORE_ORIGIN}${path}`;

// Top-level menu. `items` present => dropdown parent; otherwise a direct link.
export const STORE_MENU = [
  { label: 'Home', href: '/' },
  {
    label: 'About Us',
    items: [
      { label: 'About Us', href: '/pages/about-us-1' },
      { label: 'Contact Us', href: '/pages/contact-us' },
      { label: 'Send Us (Reviews, Samples, News)', href: '/pages/send-us' },
    ],
  },
  {
    label: 'Editorial',
    items: [
      { label: 'The Bamboo Post', href: '/blogs/news' },
      { label: 'News & New Releases', href: '/blogs/news' },
      { label: 'Special Features', href: '/blogs/features' },
      { label: 'Interviews', href: '/blogs/interviews' },
      { label: 'Distiller & Brewery Spotlights', href: '/blogs/brand-spotlights' },
      { label: 'DuRhum', href: '/blogs/durhum' },
      { label: 'Rhythm & Booze', href: '/blogs/the-rhythm-and-booze-with-felipe-schrieberg' },
      { label: 'Bottoms Up with Joe', href: '/blogs/bottoms-up-with-joe-micallef' },
      { label: 'Nostalgic Drams', href: '/blogs/88-bamboo-philippines-88-tagay/tagged/whiskyph' },
      { label: 'Japanese Whisky Dictionary', href: '/blogs/japanese-whisky-dictionary' },
      { label: 'Trooper Beers and Tunes', href: '/blogs/craft-beer' },
      { label: "Sku's (Not So) Recent Drinks", href: '/blogs/skus-not-so-recent-drinks' },
      { label: 'Sicklehut', href: '/blogs/sicklehut' },
      { label: 'SG Alcohol Guy', href: '/blogs/sg-alcohol-guy' },
      { label: 'John Go', href: '/blogs/john-go' },
      { label: "What's Happening", href: '/blogs/whats-on' },
      { label: 'Escapades', href: '/blogs/escapades' },
      { label: 'Bar Directory', href: '/pages/bar-directory' },
      { label: 'Prints', href: '/blogs/prints' },
      { label: 'Books', href: '/pages/library' },
      { label: 'TV', href: '/blogs/tv' },
      { label: 'New to Whisky?', href: '/pages/whisky-101' },
      { label: 'New to Japanese Sake?', href: '/pages/sake-101' },
      { label: 'New to Craft Beer?', href: '/pages/craft-beer-101' },
      { label: 'New to Tequila or Mezcal?', href: '/pages/tequila-mezcal-101' },
      { label: 'Explained in 3 Mins', href: '/blogs/explained-in-3-minutes' },
    ],
  },
  {
    label: 'Reviews',
    items: [
      { label: 'All Reviews', href: '/pages/all-our-reviews' },
      { label: 'Whisky', href: '/blogs/whisky-reviews' },
      { label: 'Rum', href: '/blogs/rum-reviews' },
      { label: 'Saké', href: '/blogs/sake' },
      { label: 'Wines & Bubblies', href: '/blogs/wine-reviews' },
      { label: 'Craft Beer', href: '/blogs/craft-beer' },
      { label: 'Gin', href: '/blogs/gin' },
      { label: 'Tequila/Mezcal', href: '/blogs/tequila-mezcal-reviews' },
      { label: 'And Everything Else', href: '/blogs/everything-nice' },
    ],
  },
  {
    label: 'Cocktails',
    items: [
      { label: 'Recipes', href: '/blogs/cocktail-recipes' },
      { label: "Miya's Tipsy Diaries", href: 'https://88bamboo.myshopify.com/blogs/cocktail-recipes/tagged/miyas-tipsy-diaries' },
      { label: 'I (Shanty) Try Drinks', href: '/blogs/itrydrinks' },
      { label: "Nick's Boston Baijiu Bar", href: 'https://88bamboo.co/blogs/cocktail-recipes/tagged/thenickromancer' },
      { label: 'All Cocktail Recipes', href: '/blogs/cocktail-recipes' },
      { label: 'Liqueur Lowdown', href: '/blogs/liqueur-lowdown' },
    ],
  },
  {
    label: 'Community',
    items: [
      { label: 'Whisky Club Asia Facebook Group', href: 'https://www.facebook.com/groups/whiskyclubasia' },
      { label: '88 Bamboo Japan', href: '/blogs/88-bamboo-japan-88%E7%AB%B9%E6%97%A5%E6%9C%AC' },
      { label: '88 Bamboo Hong Kong', href: '/blogs/88-bamboo-hong-kong-88%E7%AB%B9%E9%A6%99%E6%B8%AF' },
      { label: '88 Bamboo Taiwan', href: '/blogs/88-bamboo-taiwan-88%E7%AB%B9-%E5%8F%B0%E6%B9%BE' },
      { label: '88 Bamboo Philippines', href: '/blogs/88-bamboo-philippines-88-tagay' },
      { label: '88 Bamboo Thailand', href: '/blogs/88-bamboo-thailand-88-%E0%B9%84%E0%B8%9C%E0%B9%88-1' },
      { label: '88 Bamboo Vietnam', href: '/blogs/88-bamboo-vietnam-88-cay-tre' },
      { label: '88 Bamboo Indonesia', href: '/blogs/88-bamboo-indonesia-88-bambu' },
      { label: '88 Bamboo Korea', href: '/blogs/88-bamboo-korea-88-%EB%8C%80%EB%82%98%EB%AC%B4' },
    ],
  },
  { label: 'Be A Guest Writer!', href: 'https://88bamboo.co/pages/send-us' },
  { label: 'Bookmarks', href: '/pages/my-bookmarks' },
];

// Yellow reviews-bar links (reference §6; store's tinyurl review shortlinks).
export const REVIEWS_BAR = [
  { label: 'Whisky Reviews', href: 'https://tinyurl.com/whisky-reviews' },
  { label: 'Rum Reviews', href: 'https://tinyurl.com/rum-reviews' },
  { label: 'Sake Reviews', href: 'https://tinyurl.com/sakereviews' },
  { label: 'Wine Reviews', href: 'https://tinyurl.com/wine-reviewss' },
  { label: 'Beer Reviews', href: 'https://tinyurl.com/craft-beer-reviews' },
  { label: 'Mezcal Reviews', href: 'https://tinyurl.com/tequila-mezcal-review' },
  { label: 'Gin Reviews', href: 'https://tinyurl.com/gin-reviews' },
  { label: 'Cognac, Shochu, Baijiu & More', href: 'https://tinyurl.com/everything-else-review' },
];

// Footer quick links (store's footer menu, reference §8).
export const FOOTER_LINKS = [
  { label: 'The Bamboo Post', href: '/blogs/whisky-reviews' },
  { label: 'About Us', href: '/pages/about-us-1' },
  { label: 'Privacy Policy', href: '/policies/privacy-policy' },
  { label: 'Terms of Service', href: '/policies/terms-of-service' },
  { label: 'Contact Us', href: '/pages/contact-us' },
  { label: 'Join Whisky Club Asia!', href: 'https://www.facebook.com/groups/whiskyclubasia' },
];

// Social links (reference §8). rel/icon handled in the footer.
export const SOCIAL_LINKS = [
  { label: 'Facebook', href: 'https://facebook.com/88.bamboo', icon: 'bi-facebook' },
  { label: 'Instagram', href: 'https://www.instagram.com/88.bamboo/', icon: 'bi-instagram' },
  { label: 'TikTok', href: 'https://www.tiktok.com/@88.bamboo', icon: 'bi-tiktok' },
];
