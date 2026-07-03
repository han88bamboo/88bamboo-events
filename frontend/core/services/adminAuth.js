// core/services/adminAuth.js — client-side admin "session" (PATTERN-SPEC §A6).
//
// Mirrors the Drink-X auth UX: the password is hashed IN THE BROWSER with the
// classic 32-bit signed JS hashCode of (canonicalUsername + password), where the
// canonical username is the admin email trimmed + lowercased — byte-identical to
// database/make-admin-hash.js so the seeded admin_users.password_hash matches.
//
// The "session" lives on the client: the signed token the backend returns is kept
// in localStorage (for API calls) AND mirrored to a cookie (so the page's
// getServerSideProps guard can see it during SSR). Unlike §A6 this token is
// actually verified server-side on the guarded actions (plan §5.3), but the
// storage shape is the same. Cookies are client-set / JS-readable (not HttpOnly)
// on purpose — SSR reads them. Full hardening (HttpOnly server sessions) deferred.

const TOKEN_KEY = '88B_admin_session';
const EMAIL_KEY = '88B_admin_email';
const COOKIE_MAX_AGE = 7 * 24 * 60 * 60; // 7 days — matches the backend token TTL

// The 32-bit signed hashCode, identical to make-admin-hash.js and §A6's login.
export function hashPassword(email, password) {
  const canonicalUsername = email.trim().toLowerCase();
  const combined = canonicalUsername + password;
  let hash = 0;
  for (let i = 0; i < combined.length; i++) {
    hash = (hash << 5) - hash + combined.charCodeAt(i);
    hash |= 0; // force back to a 32-bit signed int each iteration
  }
  return hash;
}

function setCookie(name, value) {
  if (typeof document === 'undefined') return;
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax`;
}

function clearCookie(name) {
  if (typeof document === 'undefined') return;
  document.cookie = `${name}=; path=/; max-age=0; SameSite=Lax`;
}

export const adminAuth = {
  setSession({ token, email }) {
    if (typeof window === 'undefined') return;
    localStorage.setItem(TOKEN_KEY, token);
    if (email) localStorage.setItem(EMAIL_KEY, email);
    setCookie(TOKEN_KEY, token);
    if (email) setCookie(EMAIL_KEY, email);
  },

  getToken() {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem(TOKEN_KEY);
  },

  getEmail() {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem(EMAIL_KEY);
  },

  isAuthenticated() {
    return !!this.getToken();
  },

  logout() {
    if (typeof window === 'undefined') return;
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(EMAIL_KEY);
    clearCookie(TOKEN_KEY);
    clearCookie(EMAIL_KEY);
  },
};
