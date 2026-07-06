// core/constants/formOptions.js — shared option lists for the submission + edit
// forms (Eventbrite-parity plan EP-1, B1/B2). Kept as plain constants (not DB
// taxonomy): unlike drink categories / event formats, the country + submitter-type
// lists are stable reference data, so hardcoding them avoids a DB round-trip.
//
// Country names are the common English short names. A controlled dropdown (rather
// than a free-text input) stops the "US / USA / United States" drift that would
// otherwise fragment the listing page's country filter (backend/scripts/events.py
// /countries is DISTINCT on this column).

export const COUNTRIES = [
  'Argentina', 'Australia', 'Austria', 'Bahrain', 'Bangladesh', 'Belgium',
  'Brazil', 'Bulgaria', 'Cambodia', 'Canada', 'Chile', 'China', 'Colombia',
  'Croatia', 'Cyprus', 'Czech Republic', 'Denmark', 'Egypt', 'Estonia',
  'Finland', 'France', 'Georgia', 'Germany', 'Greece', 'Hong Kong', 'Hungary',
  'Iceland', 'India', 'Indonesia', 'Ireland', 'Israel', 'Italy', 'Japan',
  'Jordan', 'Kenya', 'Kuwait', 'Laos', 'Latvia', 'Lebanon', 'Lithuania',
  'Luxembourg', 'Macau', 'Malaysia', 'Malta', 'Mexico', 'Monaco', 'Morocco',
  'Myanmar', 'Nepal', 'Netherlands', 'New Zealand', 'Nigeria', 'Norway', 'Oman',
  'Pakistan', 'Peru', 'Philippines', 'Poland', 'Portugal', 'Qatar', 'Romania',
  'Saudi Arabia', 'Serbia', 'Singapore', 'Slovakia', 'Slovenia', 'South Africa',
  'South Korea', 'Spain', 'Sri Lanka', 'Sweden', 'Switzerland', 'Taiwan',
  'Thailand', 'Turkey', 'Ukraine', 'United Arab Emirates', 'United Kingdom',
  'United States', 'Uruguay', 'Vietnam',
];

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
