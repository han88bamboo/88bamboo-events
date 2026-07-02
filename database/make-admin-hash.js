// make-admin-hash.js — compute the admin password hash exactly the way the
// browser login will (PATTERN-SPEC §A6: the classic 32-bit signed JS hashCode of
// canonicalUsername + password). Run this once, then paste the printed number
// into database/.env as ADMIN_PASSWORD_HASH. The plaintext password is never
// stored anywhere.
//
// Canonical username for this app = the admin email, trimmed and lowercased.
// The frontend admin login MUST hash with the same canonicalisation, and
// seed-admin.sh stores the email lower(trim(...))'d to match.
//
// Usage:
//   node database/make-admin-hash.js <admin-email> <password>
//
// Example:
//   node database/make-admin-hash.js owner@88bamboo.co 's3cret!'  ->  -1234567890

const [, , email, password] = process.argv;

if (!email || !password) {
    console.error('Usage: node database/make-admin-hash.js <admin-email> <password>');
    process.exit(1);
}

const canonicalUsername = email.trim().toLowerCase();
const combined = canonicalUsername + password;

let hash = 0;
for (let i = 0; i < combined.length; i++) {
    hash = (hash << 5) - hash + combined.charCodeAt(i);
    hash |= 0; // force back to a 32-bit signed int each iteration
}

console.log(hash);
