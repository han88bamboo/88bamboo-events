// adminFormat.js — small shared formatters for the Phase-4B admin panels. Mirrors
// the inline helpers in ReviewQueue (kept there untouched); factored out here so
// LiveListings / PricingTiers / Analytics don't each redefine them.

export function formatDateTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
}

// Fee/price comes back from the API as a numeric string (Flask serialises the
// NUMERIC as a string). Render as "USD 15" (whole) or "USD 15.50".
export function formatFee(amount, currency) {
  if (amount == null || amount === '') return '—';
  const num = Number(amount);
  if (Number.isNaN(num)) return `${currency || ''} ${amount}`.trim();
  const text = Number.isInteger(num) ? String(num) : num.toFixed(2);
  return `${currency || 'USD'} ${text}`;
}

// A human "time left" string for the expiring-soon countdown, from an ISO
// timestamp relative to now. Negative windows read as "expired".
export function timeLeft(isoValue, now = Date.now()) {
  if (!isoValue) return '—';
  const target = new Date(isoValue).getTime();
  if (Number.isNaN(target)) return '—';
  let ms = target - now;
  if (ms <= 0) return 'expired';
  const days = Math.floor(ms / 86400000);
  ms -= days * 86400000;
  const hours = Math.floor(ms / 3600000);
  ms -= hours * 3600000;
  const mins = Math.floor(ms / 60000);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}
