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
