/** @type {import('next').NextConfig} */

// events-web Next.js config (PATTERN-SPEC §B1/§B3, plan §4).
//
// KEY DIVERGENCES from Drink-X (deliberate — plan §5):
//   - basePath '/a/events' so every asset/link resolves through the Shopify App
//     Proxy at www.88bamboo.co/a/events. (Drink-X runs at domain root.)
//   - NO apex->www redirects(). Drink-X 308-redirects the bare apex to www; here
//     that would break proxying, so it is intentionally omitted.
const nextConfig = {
  reactStrictMode: true,

  // Serve the whole app under the App Proxy subpath.
  basePath: '/a/events',

  // Shopify App Proxy appends a trailing slash to the proxy-ROOT request only:
  // a visit to www.88bamboo.co/a/events reaches this app as '/a/events/' (subpaths
  // like '/a/events/submit' are forwarded verbatim, no added slash). With Next's
  // default trailing-slash handling that '/a/events/' 308-redirects to '/a/events',
  // which Shopify re-proxies back to '/a/events/' — an infinite redirect loop that
  // makes the public listing page unreachable. Skipping the auto-redirect lets the
  // index page serve '/a/events/' directly. (Do NOT use trailingSlash:true instead —
  // that would force redirects on the verbatim subpaths and break them.)
  skipTrailingSlashRedirect: true,

  images: {
    // next/image only loads from this allowlist. Add the events image bucket
    // host(s) — the public S3 bucket is created in Phase 7, so both regional
    // forms are pre-allowed (dev us-east-1 / prod ap-southeast-1), plus Shopify
    // CDN and a placeholder host for scaffolding.
    remotePatterns: [
      { protocol: 'https', hostname: '*.s3.ap-southeast-1.amazonaws.com' },
      { protocol: 'https', hostname: '*.s3.us-east-1.amazonaws.com' },
      { protocol: 'https', hostname: 'cdn.shopify.com' },
      { protocol: 'https', hostname: 'placehold.co' },
    ],
  },

  // NOTE: no redirects() here on purpose (see divergence note above).
};

export default nextConfig;
