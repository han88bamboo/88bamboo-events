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

/**
 * Guard for getServerSideProps. Returns { valid: true } when verification is
 * disabled or the signature checks out; otherwise { valid: false }.
 *
 * On dynamic routes (e.g. pages/[slug].js), Next.js merges the route params
 * into ctx.query alongside the real query string. Shopify's signature is
 * only ever computed over the actual forwarded query string, so those
 * route-param keys (not real query params) must be stripped before
 * verifying, or every dynamic-route page fails signature verification.
 *
 * @param {import('next').GetServerSidePropsContext} ctx
 */
export function verifyProxyRequest(ctx) {
  if (!isTruthy(process.env.SHOPIFY_PROXY_VERIFY)) return { valid: true };
  const proxyQuery = { ...ctx.query };
  Object.keys(ctx.params || {}).forEach((key) => delete proxyQuery[key]);
  const ok = verifyProxySignature(proxyQuery, process.env.SHOPIFY_SHARED_SECRET);
  return { valid: ok };
}
