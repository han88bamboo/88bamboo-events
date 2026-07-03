// core/utils/adminCookie.js — server-side admin-session cookie check for the
// getServerSideProps page guards (PATTERN-SPEC §A6: SSR reads the cookie directly
// from req.headers.cookie). This gates PAGE access only; the money/listing API
// actions are verified independently server-side (plan §5.3).
//
// Kept deliberately minimal — it only checks PRESENCE of the session cookie (the
// same UX as Drink-X, whose SSR guards test cookie presence). The token's
// signature/expiry is authoritatively checked by the backend on each guarded call.

const COOKIE_NAME = '88B_admin_session';

/**
 * @param {import('http').IncomingMessage} req
 * @returns {boolean} true if the admin session cookie is present and non-empty.
 */
export function hasAdminCookie(req) {
  const header = req?.headers?.cookie || '';
  return header
    .split(';')
    .map((c) => c.trim())
    .some((c) => c.startsWith(`${COOKIE_NAME}=`) && c.slice(COOKIE_NAME.length + 1).length > 0);
}
