// core/utils/shopifyProxy.js — Shopify App Proxy signature verification for the
// frontend (server-side only). Parity with the backend middleware
// (backend/shopify_proxy.py); gated by the same SHOPIFY_PROXY_VERIFY flag.
//
// Public event pages are fetched by Shopify (server-side) and delivered under
// www.88bamboo.co/a/events/*. Call verifyProxyRequest(ctx) inside a page's
// getServerSideProps to reject unsigned direct hits when the flag is on.
// Locally the flag is false (no proxy exists), so this is a no-op pass.
import crypto from 'crypto';

function isTruthy(value) {
  return String(value).toLowerCase() === 'true' ||
    String(value) === '1' ||
    String(value).toLowerCase() === 'yes';
}

/**
 * Verify a Shopify App Proxy signature from parsed query params.
 * Shopify sorts all params except `signature`, joins them as `key=value` with no
 * separator, and HMAC-SHA256 hex-digests that string with the shared secret.
 *
 * @param {Object} query - parsed query params (e.g. ctx.query)
 * @param {string} secret - SHOPIFY_SHARED_SECRET
 * @returns {boolean}
 */
export function verifyProxySignature(query, secret) {
  if (!secret) return false;
  const provided = query.signature;
  if (!provided) return false;

  const message = Object.keys(query)
    .filter((k) => k !== 'signature')
    .sort()
    .map((k) => `${k}=${Array.isArray(query[k]) ? query[k].join(',') : query[k]}`)
    .join('');

  const computed = crypto
    .createHmac('sha256', secret)
    .update(message)
    .digest('hex');

  try {
    return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(provided));
  } catch {
    return false; // length mismatch => invalid
  }
}

function isDataRequest(ctx) {
  // Next serves getServerSideProps for client-side <Link> transitions from its
  // internal data endpoint, whose path always contains `/_next/data/` (basePath
  // is irrelevant — the segment is present with or without it).
  const url = ctx.req?.url || ctx.resolvedUrl || '';
  return typeof url === 'string' && url.includes('/_next/data/');
}

function proxyQueryFromRequest(ctx) {
  // ctx.query is the one reliable superset of every query key: Shopify's signed
  // proxy params (shop, timestamp, path_prefix, signature, …) PLUS Next's merged
  // dynamic route params (e.g. slug). It is the only source that survives a
  // _next/data transition, where Next strips the query off ctx.req.url and
  // ctx.resolvedUrl entirely.
  const proxyQuery = { ...ctx.query };

  // The dynamic route param needs opposite handling per request shape:
  //   • Full page load (https://…/a/events/<slug>): Next injects `slug` into
  //     ctx.query from the PATH; it was never in the URL Shopify signed, so it is
  //     synthetic and MUST be stripped or the HMAC diverges.
  //   • _next/data transition (…/<slug>.json?slug=<slug>): the SAME key is a real,
  //     Shopify-signed query param, so it MUST be kept for the HMAC to match.
  // Stripping unconditionally (the earlier fix) is correct for the first and wrong
  // for the second — the exact reversal being fixed here.
  if (!isDataRequest(ctx)) {
    Object.keys(ctx.params || {}).forEach((key) => delete proxyQuery[key]);
  }
  return proxyQuery;
}

/**
 * Guard for getServerSideProps. Returns { valid: true } when verification is
 * disabled or the signature checks out; otherwise { valid: false }.
 *
 * On dynamic routes (e.g. pages/[slug].js), Next.js merges route params into
 * ctx.query even when they were not part of the real URL. On client-side
 * _next/data transitions, those same params ARE real, Shopify-signed query keys.
 * Strip the synthetic ones only for full page loads (see proxyQueryFromRequest).
 *
 * @param {import('next').GetServerSidePropsContext} ctx
 */
export function verifyProxyRequest(ctx) {
  if (!isTruthy(process.env.SHOPIFY_PROXY_VERIFY)) return { valid: true };
  const proxyQuery = proxyQueryFromRequest(ctx);
  const ok = verifyProxySignature(proxyQuery, process.env.SHOPIFY_SHARED_SECRET);
  return { valid: ok };
}
