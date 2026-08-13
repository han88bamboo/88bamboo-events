// LocationFields — the shared location block for the submit + edit forms (EP-2).
// Encapsulates the four coupled concerns so both forms stay in sync:
//   • Venue name (optional, free text)
//   • Venue address via the Google Places Autocomplete (new PlaceAutocompleteElement).
//     On a suggestion pick it captures venue_address (formatted), latitude,
//     longitude, place_id + postcode from the SAME selection (no extra geocode) and
//     helpfully fills the city. A typed-but-unselected address is flagged as
//     "pending" so the parent can block submit (mirrors the server's D-2 rule).
//   • Country (required) from the canonical /geo list (single source of truth).
//   • State/Territory/Region (required) — a dependent dropdown shown only for the
//     countries where /geo says requires_region (large federal countries + HK /
//     Macau / Taiwan, whose single region equals the country name and is
//     auto-selected).
//
// The parent owns the field values; LocationFields calls onChange(patch) to merge
// updates and onValidationChange(errors) to report its own blocking messages.
import { useEffect, useMemo, useRef, useState } from 'react';

import { geoService } from '@/core/services/geo';
import { loadPlacesLibrary } from '@/core/utils/googleMaps';

// Prepend a non-empty legacy value the canonical list doesn't contain, so editing
// an old listing whose country/region predates the controlled lists never blanks
// it (mirrors formOptions.withLegacyValue; EP-2 backward-compat D-4).
function withValue(list, value) {
  const v = (value || '').trim();
  if (v && !list.includes(v)) return [v, ...list];
  return list;
}

// Resets an address selection to "none entered". Every field captured from a
// Google pick is cleared together — a half-cleared selection (an address with no
// coordinates, or coordinates with no address) is exactly what the server's
// clean-data rule rejects. Shared by the Clear button and the emptied-box path so
// neither can leave a stale address behind.
const CLEARED_ADDRESS = {
  venue_address: '',
  latitude: '',
  longitude: '',
  place_id: '',
  postcode: '',
};

function LocationFields({ values, onChange, onValidationChange, initialCountries }) {
  const [countries, setCountries] = useState(initialCountries || []);
  const [mapsReady, setMapsReady] = useState(false);
  const [mapsFailed, setMapsFailed] = useState(false);
  const [addressPending, setAddressPending] = useState(false);
  const containerRef = useRef(null);
  // The mounted PlaceAutocompleteElement, so "Clear address" can reset its text box.
  const autocompleteRef = useRef(null);
  // The widget's text as of the previous input event. Lets the handler below tell
  // "the user just emptied the box" from "the box was already empty", which the
  // event alone cannot express.
  const lastTextRef = useRef('');

  // Keep the latest values/onChange reachable from the once-mounted Google event
  // listeners (avoids stale-closure reads of venue_address/city).
  const valuesRef = useRef(values);
  valuesRef.current = values;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Fetch the canonical country/region list once (single source of truth — /geo).
  useEffect(() => {
    if (countries.length) return undefined;
    let cancelled = false;
    geoService
      .getGeo()
      .then((g) => {
        if (!cancelled && g?.countries?.length) setCountries(g.countries);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const countryNames = useMemo(() => countries.map((c) => c.name), [countries]);
  const selectedCountry = useMemo(
    () => countries.find((c) => c.name === values.country),
    [countries, values.country],
  );
  const requiresRegion = !!selectedCountry?.requires_region;
  const regionOptions = selectedCountry?.regions || [];

  // City-state style (HK / Macau / Taiwan): a single region equal to the country —
  // auto-select it so the user isn't asked to pick from a list of one.
  useEffect(() => {
    if (
      requiresRegion &&
      regionOptions.length === 1 &&
      values.region !== regionOptions[0]
    ) {
      onChange({ region: regionOptions[0] });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requiresRegion, regionOptions.join('|')]);

  // Report blocking validation up to the parent (address pending / region missing).
  useEffect(() => {
    if (!onValidationChange) return;
    const errs = [];
    if (addressPending) {
      errs.push('Please choose your address from the suggestions so we can map it.');
    }
    if (requiresRegion && !(values.region || '').trim()) {
      errs.push('State/Territory/Region is required.');
    }
    onValidationChange(errs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addressPending, requiresRegion, values.region]);

  // ---- Google Places Autocomplete (new PlaceAutocompleteElement) ----
  useEffect(() => {
    let cancelled = false;
    let element = null;
    let onInput = null;

    loadPlacesLibrary()
      .then((lib) => {
        if (cancelled || !containerRef.current) return;
        // eslint-disable-next-line new-cap
        element = new lib.PlaceAutocompleteElement();
        element.style.width = '100%';
        containerRef.current.appendChild(element);
        autocompleteRef.current = element;
        setMapsReady(true);

        // A place chosen from the dropdown → pull everything from ONE selection.
        element.addEventListener('gmp-select', async (ev) => {
          try {
            const prediction = ev.placePrediction;
            const place = prediction ? prediction.toPlace() : ev.place;
            await place.fetchFields({
              fields: ['formattedAddress', 'location', 'addressComponents', 'id'],
            });
            const comps = place.addressComponents || [];
            const pick = (type) => comps.find((c) => (c.types || []).includes(type));
            const postal = pick('postal_code');
            const locality = pick('locality') || pick('postal_town');
            const loc = place.location;
            const lat = typeof loc?.lat === 'function' ? loc.lat() : loc?.lat;
            const lng = typeof loc?.lng === 'function' ? loc.lng() : loc?.lng;

            const patch = {
              venue_address: place.formattedAddress || '',
              latitude: lat == null ? '' : lat,
              longitude: lng == null ? '' : lng,
              place_id: place.id || '',
              postcode: postal ? postal.longText || postal.shortText || '' : '',
            };
            if (locality && !valuesRef.current.city) {
              patch.city = locality.longText || locality.shortText || '';
            }
            onChangeRef.current(patch);
            // The box now holds the formatted address; keep the "previous text"
            // in step so a later backspace-to-empty is seen as a real clear.
            lastTextRef.current = patch.venue_address;
            setAddressPending(false);
          } catch {
            /* a failed field fetch just leaves the previous selection intact */
          }
        });

        // Typed-but-not-selected detection (best-effort mirror of the server rule):
        // while the box text differs from the last selected address, it's pending.
        onInput = (ev) => {
          const text = (ev.target?.value ?? '').trim();
          const hadText = lastTextRef.current;
          lastTextRef.current = text;

          if (!text) {
            setAddressPending(false);
            // An emptied box means "no address" — drop the stored selection too,
            // or the form would submit an address the user can no longer see.
            // Guarded on the box HAVING had text: the edit form prefills
            // venue_address while this widget starts blank, so a stray empty
            // input event must not wipe a saved address nobody touched.
            if (hadText && valuesRef.current.venue_address) {
              onChangeRef.current({ ...CLEARED_ADDRESS });
            }
            return;
          }

          setAddressPending(text !== (valuesRef.current.venue_address || ''));
        };
        element.addEventListener('input', onInput);
      })
      .catch(() => {
        if (!cancelled) setMapsFailed(true);
      });

    return () => {
      cancelled = true;
      if (element) {
        if (onInput) element.removeEventListener('input', onInput);
        element.remove();
        autocompleteRef.current = null;
      }
    };
    // Mount once; listeners read fresh values via refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reset the address back to "none entered". This is the escape hatch from the
  // blocking pending state (text typed but no suggestion picked): the widget's own
  // text box has to be emptied too, or the stale text keeps re-flagging pending.
  // It also clears the stored selection, so an emptied box can never submit a
  // previously-picked address that is no longer on screen.
  const clearAddress = () => {
    const element = autocompleteRef.current;
    if (element) {
      // The widget's text box lives in the light DOM in current builds and the
      // shadow DOM in others; clear whichever is present.
      const input =
        element.querySelector('input') || element.shadowRoot?.querySelector('input');
      if (input) input.value = '';
    }
    lastTextRef.current = '';
    setAddressPending(false);
    onChange({ ...CLEARED_ADDRESS });
  };

  return (
    <>
      <div className="mb-3">
        <label className="form-label" htmlFor="venue_name">
          Venue/Restaurant/Bar Name (add floor number, unit number or door number if applicable)
        </label>
        <input
          id="venue_name"
          className="form-control"
          value={values.venue_name || ''}
          onChange={(e) => onChange({ venue_name: e.target.value })}
          maxLength={500}
        />
      </div>

      <div className="mb-3">
        <label className="form-label" htmlFor="venue_address_search">
          Venue address
        </label>
        {/* Not required by the validator, but a listing without a mapped address
            loses its map pin — hence the nudge rather than an asterisk. */}
        <div className="form-text text-danger mt-0 mb-1">
          Strongly recommended to fill in, unless your location cannot be found on Google
        </div>
        {/* The PlaceAutocompleteElement mounts into this container once Maps loads. */}
        <div ref={containerRef} />
        {!mapsReady && !mapsFailed && (
          <input
            id="venue_address_search"
            className="form-control"
            placeholder="Loading address search…"
            disabled
          />
        )}
        {mapsFailed && (
          <>
            <input
              id="venue_address_search"
              className="form-control"
              value={values.venue_address || ''}
              onChange={(e) =>
                onChange({
                  venue_address: e.target.value,
                  latitude: '',
                  longitude: '',
                  place_id: '',
                  postcode: '',
                })
              }
              placeholder="Address search unavailable"
            />
            <div className="form-text text-warning">
              Address search is unavailable. Leave this blank, or note that a typed
              address without a map pin is rejected on submit.
            </div>
          </>
        )}
        {mapsReady && (
          <div className="d-flex justify-content-between align-items-start gap-3">
            <div className="form-text">
              {values.venue_address
                ? `Selected: ${values.venue_address}`
                : 'Start typing and choose your address from the suggestions.'}
            </div>
            {/* Shown whenever there is something to clear: a half-typed address
                (the blocking pending state) or a picked one the user wants to
                change. Without it, a submitter stuck on "choose from the
                suggestions" has no way out but a page reload. */}
            {(addressPending || values.venue_address) && (
              <button
                type="button"
                className="btn btn-link btn-sm p-0 text-nowrap"
                onClick={clearAddress}
              >
                Clear address
              </button>
            )}
          </div>
        )}
      </div>

      <div className="row">
        <div className="col-md-6 mb-3">
          <label className="form-label" htmlFor="country">
            Country <span className="text-danger">*</span>
          </label>
          <select
            id="country"
            className="form-select"
            value={values.country || ''}
            onChange={(e) => onChange({ country: e.target.value, region: '' })}
            required
          >
            <option value="">Choose…</option>
            {withValue(countryNames, values.country).map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div className="col-md-6 mb-3">
          <label className="form-label" htmlFor="city">
            City <span className="text-danger">*</span>
          </label>
          <input
            id="city"
            className="form-control"
            value={values.city || ''}
            onChange={(e) => onChange({ city: e.target.value })}
            required
          />
        </div>
      </div>

      {requiresRegion && (
        <div className="mb-3">
          <label className="form-label" htmlFor="region">
            State / Territory / Region <span className="text-danger">*</span>
          </label>
          <select
            id="region"
            className="form-select"
            value={values.region || ''}
            onChange={(e) => onChange({ region: e.target.value })}
            required
            // A single option (HK/Macau/Taiwan) is auto-selected above; lock it.
            disabled={regionOptions.length === 1}
          >
            <option value="">Choose…</option>
            {withValue(regionOptions, values.region).map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
      )}
    </>
  );
}

export default LocationFields;
