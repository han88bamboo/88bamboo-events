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

function queryFromUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return null;

  const parsed = new URL(rawUrl, 'http://localhost');
  const query = {};
  parsed.searchParams.forEach((value, key) => {
    if (query[key] === undefined) {
      query[key] = value;
    } else if (Array.isArray(query[key])) {
      query[key].push(value);
    } else {
      query[key] = [query[key], value];
    }
  });
  return query;
}

function queryHasSignature(query) {
  return Boolean(query && query.signature);
}

function proxyQueryFromRequest(ctx) {
  // Next's ctx.query includes synthetic dynamic params. The request URL query is
  // the source of truth for what Shopify actually signed, including _next/data
  // client transitions where the dynamic param is a real query key.
  const fromResolvedUrl = queryFromUrl(ctx.resolvedUrl);
  if (queryHasSignature(fromResolvedUrl)) return fromResolvedUrl;

  const fromReqUrl = queryFromUrl(ctx.req?.url);
  if (queryHasSignature(fromReqUrl)) return fromReqUrl;

  // Defensive fallback for non-Next test contexts: preserve the earlier fix for
  // full page loads where dynamic params exist in ctx.query but not the URL.
  const proxyQuery = { ...ctx.query };
  Object.keys(ctx.params || {}).forEach((key) => delete proxyQuery[key]);
  return proxyQuery;
}

/**
 * Guard for getServerSideProps. Returns { valid: true } when verification is
 * disabled or the signature checks out; otherwise { valid: false }.
 *
 * On dynamic routes (e.g. pages/[slug].js), Next.js merges route params into
 * ctx.query even when they were not part of the real URL. On client-side
 * _next/data transitions, those same params can be real query keys. Verify the
 * actual request URL query so both shapes match what Shopify signed.
 *
 * @param {import('next').GetServerSidePropsContext} ctx
 */
export function verifyProxyRequest(ctx) {
  if (!isTruthy(process.env.SHOPIFY_PROXY_VERIFY)) return { valid: true };
  const proxyQuery = proxyQueryFromRequest(ctx);
  const ok = verifyProxySignature(proxyQuery, process.env.SHOPIFY_SHARED_SECRET);
  return { valid: ok };
}
