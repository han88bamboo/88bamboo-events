// core/utils/googleMaps.js — lazy, memoised loader for the Google Maps JS "places"
// library used by the address autocomplete (EP-2). We load ON DEMAND from the
// form component (not a global <script> in _document) so the Maps SDK — and the
// Google cookies it sets — only load on the submit/edit pages that need it.
//
// Uses Google's official dynamic-import bootstrap ("importLibrary" pattern), which
// is the supported way to obtain the NEW PlaceAutocompleteElement (owner chose the
// new Places API over the deprecated Autocomplete widget). The browser key is
// NEXT_PUBLIC_MAPS_BROWSER_KEY (referrer-restricted; inlined at build time).

let placesPromise = null;

// Treat obvious placeholder values (from the .env templates) as "no key".
function keyConfigured(key) {
  if (!key) return false;
  const lowered = key.toLowerCase();
  return !(lowered.includes('replace') || lowered.includes('paste_your'));
}

// Inject Google's bootstrap loader exactly once, then resolve importLibrary.
function bootstrap(key) {
  // Official Google Maps JS API loader snippet, parameterised with our key. It
  // defines window.google.maps.importLibrary and loads the script on first use.
  /* eslint-disable */
  (g => { var h, a, k, p = "The Google Maps JavaScript API", c = "google", l = "importLibrary", q = "__ib__", m = document, b = window; b = b[c] || (b[c] = {}); var d = b.maps || (b.maps = {}), r = new Set, e = new URLSearchParams, u = () => h || (h = new Promise(async (f, n) => { await (a = m.createElement("script")); e.set("libraries", [...r] + ""); for (k in g) e.set(k.replace(/[A-Z]/g, t => "_" + t[0].toLowerCase()), g[k]); e.set("callback", c + ".maps." + q); a.src = `https://maps.${c}apis.com/maps/api/js?` + e; d[q] = f; a.onerror = () => h = n(Error(p + " could not load.")); a.nonce = m.querySelector("script[nonce]")?.nonce || ""; m.head.append(a) })); d[l] ? console.warn(p + " only loads once. Ignoring:", g) : d[l] = (f, ...n) => r.add(f) && u().then(() => d[l](f, ...n)) })({ key, v: "weekly" });
  /* eslint-enable */
}

/**
 * Load the Google Maps "places" library. Resolves to the library object (which
 * exposes PlaceAutocompleteElement). Rejects when the key is not configured or
 * the SDK fails to load — callers fall back to a plain text address input.
 * Memoised so the SDK loads at most once per session.
 */
export function loadPlacesLibrary() {
  if (placesPromise) return placesPromise;

  placesPromise = new Promise((resolve, reject) => {
    if (typeof window === 'undefined') {
      reject(new Error('Google Maps can only load in the browser.'));
      return;
    }
    const key = process.env.NEXT_PUBLIC_MAPS_BROWSER_KEY;
    if (!keyConfigured(key)) {
      reject(new Error('NEXT_PUBLIC_MAPS_BROWSER_KEY is not configured.'));
      return;
    }
    try {
      if (!window.google?.maps?.importLibrary) bootstrap(key);
      window.google.maps
        .importLibrary('places')
        .then(resolve)
        .catch(reject);
    } catch (err) {
      reject(err);
    }
  });

  // Don't cache a rejection permanently — allow a later retry (e.g. a transient
  // network failure) to attempt the load again.
  placesPromise.catch(() => {
    placesPromise = null;
  });
  return placesPromise;
}
