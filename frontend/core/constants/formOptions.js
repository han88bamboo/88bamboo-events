// core/constants/formOptions.js — shared option lists for the submission + edit
// forms. The SUBMITTER_TYPES list is stable reference data, so it stays a constant
// (avoids a DB round-trip). The former COUNTRIES constant was removed in EP-2: the
// country + region lists now come from the backend /geo endpoint (the single
// source of truth — see core/services/geo.js and components/common/LocationFields),
// so a country can never drift between the frontend list and the server's
// validation. `withLegacyValue` is still shared (submitter type + legacy values).

// Submitter type (the "who is listing this" channel). Free-form in the DB, but the
// input is constrained so the values stay analysable.
export const SUBMITTER_TYPES = [
  'Bar', 'Brand', 'Agency', 'Distributor', 'Venue', 'Event organiser', 'Other',
];

// Return the option list with `value` prepended when it is a non-empty value the
// canonical list doesn't already contain — so editing a LEGACY listing whose
// country/type predates the controlled list never silently loses or blanks it
// (Eventbrite-parity plan D-4, backward compatibility).
export function withLegacyValue(list, value) {
  const v = (value || '').trim();
  if (v && !list.includes(v)) return [v, ...list];
  return list;
}
