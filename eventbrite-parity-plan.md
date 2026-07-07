# EVENTBRITE-PARITY-PLAN.md — 88 Bamboo Events

> **Working document for the AI coding assistant** implementing the Eventbrite-parity upgrades to
> the event **submission process** and the **single-event listing page**.
> Companion to [`plan.md`](plan.md) (the master build plan) and
> [`SUBMISSION-VS-EVENTBRITE.md`](SUBMISSION-VS-EVENTBRITE.md) (the gap analysis this plan executes).
> Follow [`CLAUDE.md`](CLAUDE.md): surface every decision **before** writing code, make surgical
> changes, keep the pipeline runnable after each step, and add cheap unit tests for data-processing
> functions.
>
> **Scope (owner, 2026-07-06): implement Tracks A, B, and D from the gap analysis — everything
> EXCEPT Track C** (add-to-calendar, online/hybrid/TBD events, multi-image gallery, rich text,
> recurring events). Those stay out of scope for this plan.
>
> **Scope addition (owner, 2026-07-08): EP-6 — multi-date scheduling.** One piece of Track C is
> now pulled IN: an event may run on **several explicit dates**, each with its own start/end time
> (Eventbrite's "schedule" — the submitter picks the date(s), then a small table lets them enter a
> start and end time per date). This is a **hand-entered schedule of occurrences, NOT rule-based
> recurrence** (no "every Tuesday" RRULE) — rule-based recurrence, add-to-calendar, online/hybrid,
> multi-image, and rich text remain out of scope. (There is no EP-5; the owner numbered this EP-6.)
>
> **Update the checklist + round log at the bottom of this file after every working session** —
> mark items `[x]`/`[~]`, append discovered sub-tasks, and record any new owner decisions.

Legend: `[ ]` todo · `[x]` done · `[~]` in progress/partial.

---

## 1. What we are building (from the gap analysis)

| ID | Item | Effort | Phase |
|---|---|---|---|
| A1 | Map + "Get directions" on the detail page — from the address string, **no schema change** | S | EP-1 |
| A2 | Address **Google-validated** (must pick from the Places dropdown) → **store lat/lng/place_id from the selection** → exact-pin map | M | EP-2 |
| A3 | **Structured address** components (street / postcode / region) from the same selection | M | EP-2 |
| B1 | **Country as a controlled dropdown** (ISO list) — stops filter drift | S | EP-1 |
| B2 | **Submitter type → dropdown** (bar / brand / agency / …) | S | EP-1 |
| B3 | **Server-side URL validation/normalisation** for `link` | S | EP-1 |
| B4 | **Description helper** — character counter + gentle min-length | S | EP-1 |
| B5 | **Static local-time note** (a line telling readers/submitters times are local to the event location) — no backend, no timezone column | S | EP-1 |
| D1 | **Image preview + drag-and-drop** (single required image — NOT multi-image, which is Track C) | S–M | EP-3 |
| D2 | **Inline per-field validation** (replace the top error list) | S–M | EP-3 |
| D3 | **Multi-step wizard** submission layout | M | EP-3 |
| E1 | **Multi-date model** — per-date `event_occurrences` (own start/end) + derived summary; validate + persist + carry-forward | M–L | EP-6 |
| E2 | **Schedule-table form UI** — single date by default, "Add another date" reveals a date/start/end table (shared `ScheduleFields`) | M | EP-6 |
| E3 | **Detail-page schedule + per-occurrence JSON-LD** (+ admin schedule display) | S–M | EP-6 |

Sequencing rationale: EP-1 ships the visible Eventbrite gaps with **zero schema/data-model risk**;
EP-2 is the one phase that changes the data model (isolated + reversible, all new columns nullable);
EP-3 is pure frontend UX. EP-4 is the regression gate before merge. **EP-6 (added 2026-07-08)** is a
second, isolated data-model change — a new `event_occurrences` child table with the existing
`start_datetime`/`end_datetime` retained as a *derived summary*, so the large existing read surface is
unchanged and only the detail page + forms + the new table are net-new (same "additive, nullable, no
backfill, reversible" discipline as EP-2).

---

## 2. Cross-cutting design decisions (RESOLVED with owner 2026-07-06)

These shape multiple phases. All resolved with the owner; kept here as the rationale of record.

- **D-1 — Maps/geocoding provider. DECIDED: Google** (owner: "follow Eventbrite; if not possible, go
  with Google" — Eventbrite uses **Google Maps** for its geocoding + event-page map, so this is the
  same choice either way). Mapbox / OSM alternatives dropped.
- **D-2 — Address entry & coordinates. DECIDED: the address is only accepted once selected from the
  Google Places dropdown — NO pure free-text address (owner: "important, to ensure clean data").** The
  browser Places Autocomplete widget captures `lat`/`lng`/`place_id` + structured components into
  **hidden form fields** as part of that selection; the server **re-validates** they are present and in
  range (lat ∈ [-90,90], lng ∈ [-180,180]) and rejects an address typed without a valid selection
  (mirrors the "server re-validates the held payload, never trusts blindly" pattern in
  [`submissions.py`](backend/scripts/submissions.py)).
  - **Is a separate geocode step needed? No.** The coordinates are returned *inside the same dropdown
    selection* — there is no extra API call or cost. We **store** them because it is free, proves the
    address was Google-validated (clean data), and lets the detail page render an **exact pin** instead
    of re-resolving the address string on every page view. So EP-2 keeps lat/lng/place_id, framed as
    "captured from the required selection," not a standalone geocode.
  - **Keys:** the Places Autocomplete widget needs a **referrer-restricted browser key**
    (`NEXT_PUBLIC_MAPS_BROWSER_KEY`, EP-2). The **detail-page embed map itself needs no key** — it uses
    the keyless `https://www.google.com/maps?q=…&output=embed` iframe (address string in EP-1; exact
    `lat,lng` once coords exist in EP-2). No server key, no billed Static/Embed API.
- **D-3 — Timezone. DECIDED: keep it simple — NO timezone handling, NO `timezone` column, NO backend
  work** (owner). Instead show a **static informational line** on the detail page and the submit form:
  *times are assumed to be the local time at the event's location.* The existing UTC-pinned,
  hydration-safe wall-clock rendering in
  [`publicFormat.js`](frontend/components/views/publicPages/publicFormat.js) is unchanged. (This
  replaces the earlier "annotate the zone" idea; B5 is now just a copy line, moved to EP-1.)
- **D-4 — Backward compatibility. DECIDED: all new columns nullable, no backfill.** Existing published
  events have no coordinates and free-text countries. New `event_versions` columns are nullable; reads
  treat missing coords as "unknown" and the detail map falls back to the A1 address-string embed. The
  country dropdown (B1) **accepts and preserves** any legacy value it doesn't recognise (renders it as a
  selected option) so no live listing is orphaned. **No data migration required.**
- **D-6 — Server-side "not free text" enforcement lands in EP-2, per the owner's grouping.** EP-1 makes
  **country** a client-side dropdown (owner: "EP1 — dropdown"). The *server-side* guarantees that
  country is one of the canonical list AND that an address carries a valid Google selection are an
  **EP-2** concern (owner filed both under "EP2"). Until then EP-1's dropdown already constrains normal
  submissions.
- **D-5 — Single source of validation.** [`submission_validation.validate_submission`](backend/submission_validation.py)
  is shared by submit, magic-link edit, account edit, and admin edit. Every new/changed field rule goes
  **there once**, and every INSERT site (submissions create-intent, [`event_versioning.create_edit_version`](backend/event_versioning.py))
  must carry the new columns or they silently drop on edit.

---

## 3. Ripple map (files each change touches)

Because the location/address fields flow through submit **and** every edit path, adding columns is a
multi-file change. This table is the authoritative "don't miss one" checklist for EP-2 (EP-1/EP-3 rows
are lighter).

| Layer | File | EP-1 | EP-2 (schema) | EP-3 |
|---|---|:--:|:--:|:--:|
| DB schema | [`database/schema.sql`](database/schema.sql) | — | **lat/lng/place_id/postcode/region cols** (no timezone) **+ NEW `countries`/`country_regions` tables + seed** | — |
| DB migration | [`database/migrations/ep2-location.sql`](database/migrations/ep2-location.sql) (NEW) | — | **hand-apply to prod** (ALTER + geo tables + seed, idempotent) | — |
| Geo API | [`backend/scripts/geo.py`](backend/scripts/geo.py) + [`backend/geo_reference.py`](backend/geo_reference.py) (NEW) | — | `/geo` endpoint + `load_geo` loader (single source of truth) | — |
| Location UI | [`frontend/components/common/LocationFields`](frontend/components/common/LocationFields/LocationFields.js) + [`core/utils/googleMaps.js`](frontend/core/utils/googleMaps.js) + [`core/services/geo.js`](frontend/core/services/geo.js) (NEW) | — | shared PlaceAutocompleteElement + country/region dropdowns | — |
| Admin edit endpoint | [`backend/scripts/admin.py`](backend/scripts/admin.py) | — | geo-validate + serialise new cols in list queries | — |
| Validators | [`backend/submission_validation.py`](backend/submission_validation.py) | URL, submission_type | lat/lng range, structured addr, country-list + address-selection enforcement | — |
| Submit persist | [`backend/scripts/submissions.py`](backend/scripts/submissions.py) | passes new fields through | INSERT new cols | — |
| Edit versioning | [`backend/event_versioning.py`](backend/event_versioning.py) | — | INSERT + carry-forward new cols | — |
| Edit context | [`backend/scripts/edits.py`](backend/scripts/edits.py) | — | serialise new cols | — |
| Account edit | [`backend/scripts/account.py`](backend/scripts/account.py) | — | verify reuse of shared helper | — |
| Public read | [`backend/scripts/events.py`](backend/scripts/events.py) | — | add cols to `_PUBLIC_COLUMNS` | — |
| Submit form | [`SubmitEvent.js`](frontend/components/views/landingPages/SubmitEvent/SubmitEvent.js) | B1/B2/B3/B4 | autocomplete + hidden coords | wizard, preview, inline |
| Edit form | [`EditEvent.js`](frontend/components/views/publicPages/EditEvent/EditEvent.js) | B1/B2 | autocomplete + coords | inline |
| Admin edit | [`AdminEditModal.js`](frontend/components/views/admin/AdminEditModal/AdminEditModal.js) | — | `buildContext` new fields | — |
| Detail page | [`EventDetail.js`](frontend/components/views/publicPages/EventDetail/EventDetail.js) | **map + directions + local-time note** | exact-pin map | — |
| SEO JSON-LD | [`core/utils/seo.js`](frontend/core/utils/seo.js) | — | add `geo` + `postalCode`/`region` | — |
| Admin display | [`ReviewQueue.js`](frontend/components/views/admin/ReviewQueue/ReviewQueue.js) / [`LiveListings.js`](frontend/components/views/admin/LiveListings/LiveListings.js) | — | show map/coords (optional) | — |
| Shared consts | `frontend/core/constants/*` (NEW) | ISO country list, submitter types | — | — |

---

## 4. CHECKLIST

### Phase EP-0 — Owner prerequisites & decisions
- [x] **D-1 provider = Google** (Eventbrite uses Google Maps). *(resolved 2026-07-06)*
- [x] **D-2 = Google-validated address only** (must pick from the Places dropdown; coords captured from the selection, no separate geocode). **D-3 = no timezone, static note only. D-4 = nullable cols, no backfill. B1 = dropdown.** *(all resolved 2026-07-06)*
- [x] **(EP-2 prereq)** Google **Places API** browser key. Owner added `NEXT_PUBLIC_MAPS_BROWSER_KEY` on Vercel (2026-07-07) and to `frontend/.env.local.example`. EP-2 wired it into `docker-compose.yml` `events-web` (mirrors `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`) so the autocomplete works on `localhost:8080` when the key is exported. *(Not needed for EP-1 — its embed map is keyless; absent key ⇒ address field degrades to plain text.)*

### Phase EP-1 — Cheap wins, no schema change (A1, B1, B2, B3, B4, B5-note)
- [x] **A1 — Detail-page map + directions.** [`EventDetail.js`](frontend/components/views/publicPages/EventDetail/EventDetail.js) renders a lazy **keyless** `<iframe>` (`https://www.google.com/maps?q=<encoded address>&output=embed`) from the `venue_address, city, country` string (venue NAME dropped — a name alone geocodes poorly), plus a "Get directions" link. Shown only when an address exists. Plain `<iframe>` (no `next/image`) so **no `next.config` change** needed. *(EP-2 swaps the query to exact `lat,lng`; address-string form stays the legacy fallback.)*
- [x] **B5-note — local-time line.** Static note on the detail page ("Local time at the event location." under the When row) and the submit form ("Enter the times in the event's own local time…") (D-3). No backend, no column.
- [x] **B1 — Country dropdown.** New [`frontend/core/constants/formOptions.js`](frontend/core/constants/formOptions.js) (`COUNTRIES` + `withLegacyValue`); `country` in [`SubmitEvent.js`](frontend/components/views/landingPages/SubmitEvent/SubmitEvent.js) + [`EditEvent.js`](frontend/components/views/publicPages/EditEvent/EditEvent.js) is now a `<select>` that **preserves any unrecognised legacy value**. *(Server-side country-list enforcement is EP-2 per D-6.)*
- [x] **B2 — Submitter type dropdown.** `submission_type` is now a `<select>` (`SUBMITTER_TYPES`: Bar / Brand / Agency / Distributor / Venue / Event organiser / Other) in both forms; column stays free-form, legacy values preserved.
- [x] **B3 — URL validation.** `_looks_like_url` + `MAX_URL_LEN` added to [`submission_validation.py`](backend/submission_validation.py); `link` now requires an http(s) scheme + dotted host, length-capped. Shared by submit + all edit paths (validator is the single source).
- [x] **B4 — Description helper.** Character counter + "tell attendees what to expect" hint under the description textarea in [`SubmitEvent.js`](frontend/components/views/landingPages/SubmitEvent/SubmitEvent.js). Non-blocking, client-only.
- [x] Unit tests: 3 URL cases added to [`test_submission_validation.py`](backend/tests/test_submission_validation.py) (optional-when-blank, valid accepted, invalid rejected). **Full backend suite 72 green.** Verified against the running docker stack: submit page shows both dropdowns + note; detail page renders the map iframe (encoded address), directions link, and local-time note; `/edit` compiles.

  Round notes (EP-1): shipped 2026-07-06. **CHOSEN / discovered:**
  - **Countries hardcoded, not DB taxonomy** ([`formOptions.js`](frontend/core/constants/formOptions.js)): unlike drink categories / event formats, the country + submitter-type lists are stable reference data, so a constant avoids a DB round-trip. `withLegacyValue(list, value)` prepends any non-list legacy value so editing an old listing never blanks it (D-4).
  - **Server-side country/type enforcement deferred to EP-2** (D-6) — EP-1 only constrains the input; `validate_submission` still accepts any country string, so existing edit/admin paths are unaffected this round.
  - **Map query drops the venue name** — geocoding `"LMDW bar, 9 Jln Pakis, …"` is less reliable than the address alone; the venue name still shows in the "Where" text line.
  - **Keyless embed** (`output=embed`) needs no Google key, so the map works in local dev today; the browser key is only needed for EP-2's Places Autocomplete.
  - No new deps. No schema change. `next.config` untouched (iframe, not `next/image`).

  **Owner verification checklist (EP-1)** — handed to owner 2026-07-07 (browse `http://localhost:8080/a/events`):
  - [ ] Submit form: country + submitter-type are dropdowns; description shows a char counter; local-time note under Starts/Ends; a full submit with `4242…` reaches the pending/confirmation state.
  - [ ] Detail page: map renders, "Get directions" opens Maps, "Local time…" note under When.
  - [ ] Edit paths (magic-link `/edit`, account dashboard, admin modal): country/type dropdowns **prefill the existing value, including a legacy value not in the list**; saving doesn't blank them.
  - [ ] B3: a bad link (`example.com`, `myevent`) is rejected server-side; a valid `https://…` passes.
  - [ ] Regression: listing-page country filter still works; existing events still render.

### Phase EP-2 — Location & coordinates (A2, A3 + server-side enforcement) — the schema phase
- [x] **Schema.** Added nullable columns to `event_versions` in [`database/schema.sql`](database/schema.sql): `latitude NUMERIC(9,6)`, `longitude NUMERIC(9,6)`, `place_id TEXT`, `postcode VARCHAR(32)`, `region VARCHAR(255)`. `venue_address` stays the Google-formatted display string. **No `timezone` column** (D-3). *(Local re-seed via `docker compose down -v`; prod = the hand-applied migration below.)*
- [x] **NEW geo tables (owner: single source of truth).** `countries` (`name`, `requires_region`, `active`) + `country_regions` (`country_id` FK, `name`, `active`) in [`database/schema.sql`](database/schema.sql), seeded with 82 countries + 405 ISO-3166-2 subdivisions. `China`→**`Mainland China`**; Hong Kong / Macau / Taiwan are selectable countries; Russia added. 20 countries carry `requires_region = TRUE`.
- [x] **NEW geo endpoint + loader.** [`scripts/geo.py`](backend/scripts/geo.py) `GET /geo` → `{countries:[{name,requires_region,regions[]}]}`; [`geo_reference.load_geo`](backend/geo_reference.py) feeds the validators (keeps `submission_validation` DB-free).
- [x] **Validators (D-2/D-6).** [`validate_submission`](backend/submission_validation.py): accepts/cleans the 5 fields, range-checks lat/lng, **requires a Google selection when an address is supplied** (address ⇒ coords + place_id, else "please choose your address from the suggestions"), **validates country against the canonical DB list**, and **requires + validates a region** when the country needs one. New `geo` + `require_address_selection` params (edits pass `False` so legacy/prefilled addresses stay editable). All 5 fields added to `cleaned`.
- [x] **Persist — submit.** [`scripts/submissions.py`](backend/scripts/submissions.py) create-intent INSERT carries the 5 new columns; both submit endpoints load geo + validate against it.
- [x] **Persist — edits.** [`event_versioning.create_edit_version`](backend/event_versioning.py) INSERTs the 5 cols and **carries coords forward** from the source when the address is unchanged (mirrors the image carry-forward); a changed address brings its own coords.
- [x] **Serialise — edit context.** [`scripts/edits.py`](backend/scripts/edits.py) + [`scripts/account.py`](backend/scripts/account.py) `/context` return the new fields (coords cast to float) so the edit form prefills + carries them forward. Both pass `geo`, `require_address_selection=False`.
- [x] **Admin edit endpoint.** [`scripts/admin.py`](backend/scripts/admin.py) edit path also loads geo + validates (relaxed address rule) and its two list queries serialise the 5 cols so the admin form prefills.
- [x] **Public read.** Added the 5 cols to `_PUBLIC_COLUMNS` in [`scripts/events.py`](backend/scripts/events.py) (coords `::double precision` for jsonify). Listing + detail + widget all inherit it.
- [x] **Submit/edit forms.** New shared [`LocationFields`](frontend/components/common/LocationFields/LocationFields.js) used by [`SubmitEvent.js`](frontend/components/views/landingPages/SubmitEvent/SubmitEvent.js) + [`EditEvent.js`](frontend/components/views/publicPages/EditEvent/EditEvent.js): new **PlaceAutocompleteElement** (loaded on-demand via [`googleMaps.js`](frontend/core/utils/googleMaps.js), key `NEXT_PUBLIC_MAPS_BROWSER_KEY`) fills `venue_address`/lat/lng/`place_id`/`postcode`/`city` from one selection; **country from `/geo`** ([`geo.js`](frontend/core/services/geo.js), `COUNTRIES` removed from `formOptions.js`); **dependent required region dropdown**; blocks submit on typed-but-unselected address + missing region. Plain-input fallback when the Maps key is absent.
- [x] **Admin edit.** `buildContext` in [`AdminEditModal.js`](frontend/components/views/admin/AdminEditModal/AdminEditModal.js) passes the new fields through.
- [x] **Detail page.** [`EventDetail.js`](frontend/components/views/publicPages/EventDetail/EventDetail.js) renders an **exact-pin** map (`q=<lat>,<lng>`) + place_id-pinned directions when coords exist, else the A1 address-string embed. "Where" line shows the region.
- [x] **JSON-LD.** [`core/utils/seo.js`](frontend/core/utils/seo.js): adds `geo` (`GeoCoordinates`) when coords exist, plus `postalCode`/`addressRegion` on the `PostalAddress`.
- [x] (Optional stretch, ~~DEFERRED~~ **built in EP-4**) admin panels show a mini-map / coords for review. New shared [`AdminLocationMap`](frontend/components/views/admin/AdminLocationMap/AdminLocationMap.js) (keyless `output=embed` iframe, **same pattern as `EventDetail`**, no key/billing) added to **ReviewQueue** (`PendingCard`, open by default — few pending items) and **LiveListings** (`ListingRow`, collapsed behind a "Show map" toggle so a long list doesn't mount N iframes). Shows an exact pin + `lat, lng · region · postcode` line + directions when coords exist, and the address-string fallback (with a "no coordinates — approx." note) for legacy events. *(Admin edit form left untouched — it already carries coords forward; owner chose Review + Live panels, not a live-preview map in the edit modal.)*
- [x] Unit tests (backend suite **83 green**): lat/lng range, address-selection-required (+ relaxed-for-edits), country-list membership, region-required + region-in-list, region-dropped-for-non-region-country, carry-forward-when-unchanged + new-coords-when-changed. SQL validated by applying `schema.sql` + the prod migration (idempotent) to a throwaway Postgres; frontend `next build` clean.
- [x] **Docker/env wiring.** `NEXT_PUBLIC_MAPS_BROWSER_KEY` added to `docker-compose.yml` `events-web` (mirrors the Stripe key). Already in `frontend/.env.local.example` (owner).

  Round notes (EP-2): shipped 2026-07-07. **Owner decisions that expanded the original scope (surfaced + answered before coding):**
  - **Address = optional, Google-validated when provided** (recommended, accepted). Server rejects a typed-but-unselected address on submit; edits relax the rule so a legacy/prefilled address stays editable (coords carry forward).
  - **Country = strictly required + controlled**, and the country list gained **Hong Kong / Macau / Taiwan** as selectable countries with `China` renamed **`Mainland China`**.
  - **NEW: dependent State/Territory/Region dropdown**, *required* for 20 countries (USA, Mainland China, Australia, UK, Canada, France, Russia, Denmark, New Zealand, Brazil, Mexico, Chile, Indonesia, Netherlands, Portugal, Spain, South Africa + HK/Macau/Taiwan whose region = the country name, auto-selected). Validated server-side against the DB list.
  - **Single source of truth = a `/geo` endpoint** (owner chose this over accepting the Python/JS duplication): the frontend `COUNTRIES` constant was **removed**; country + region lists come from the DB via `/geo`. Cost: a small client fetch on the form (mirrors how `AdminEditModal` fetches taxonomy) + the two new tables to deploy.
  - **Places API = the new `PlaceAutocompleteElement`** (owner's pick): future-proof and the only Autocomplete enabled for new Google customers. Loaded on-demand (not a global script) so the Maps SDK/cookies only load on the submit/edit pages.
  - **CHOSEN / discovered:**
    - **Region seed lists are ISO-3166-2 "standard commonly-used" names** generated from a script; the large ones (Russia = 83 federal subjects, Indonesia = 38) are the standard but **the owner should sanity-check them** — they're editable in the DB (that's the point of the single source of truth).
    - **`country_regions` FK is `ON DELETE CASCADE`** (not the app-wide SET NULL) — a subdivision can't outlive its country and these are static reference rows; flagged in `schema.sql`.
    - **Client typed-but-unselected detection is best-effort** (the web-component's partial text isn't a clean API); the **server** is the authority via `require_address_selection` on submit.
    - **Edit-path address rule is relaxed** (`require_address_selection=False`): a small trade-off (an edit could in theory set a new coordinate-less address) accepted to keep legacy listings editable — edits are ownership-gated and lower-risk than fresh submissions.

  **Owner deploy note (prod DB):**
  - [x] **Migration applied to the LIVE prod RDS, 2026-07-06.** `database/migrations/ep2-location.sql` run against `drinkxprod`'s `events` database (from the Drink-X bastion EC2, `i-006f461be066cc1b4` — the shared RDS is private and only reachable from inside the VPC; `$DATABASE_URL` is not set in a plain shell, so it must be run from in-VPC, not a laptop). **Pre-migration inventory confirmed prod was exactly at the pre-EP-2 state** (all 11 original tables intact, `event_messages.read_by_submitter` already present from an earlier round — no other drift). Took a `pg_dump --no-owner --no-privileges` backup on the bastion first (33K, `events_prod_backup_20260706_1957.sql`). Migration committed cleanly; **post-migration verification confirmed**: `countries` + `country_regions` tables exist, `event_versions.latitude` exists, `countries` has 82 rows, `country_regions` has 405 rows.
  - Ensure `NEXT_PUBLIC_MAPS_BROWSER_KEY` is set on Vercel (**done** by owner 2026-07-07) — the referrer restriction must include the production apex/proxy origin.
  - Local dev needs **nothing extra**: `schema.sql` already carries the same DDL + seed (`docker compose down -v && up --build` to re-seed — the `-v` is required; a plain `up` keeps the old volume and the new tables/columns won't appear).
  - **How to reach prod for any future hand-applied SQL:** the RDS (`drinkxprod.cxoa4asusd0j.ap-southeast-1.rds.amazonaws.com`) is private — reach it via `aws ssm start-session --target i-006f461be066cc1b4 --region ap-southeast-1` (no SSH key needed, just IAM/SSM access) from AWS CloudShell, then `psql`/`pg_dump` from that bastion's shell. Watch the prompt: `psql`'s own prompt is `events=>` — running shell commands like `pg_dump`/`ls` only works at the plain bastion bash prompt, not inside `psql`.

  **Owner verification checklist (EP-2)** — on the running docker stack (`export NEXT_PUBLIC_MAPS_BROWSER_KEY=… && docker compose down -v && docker compose up --build`; Stripe test key + `stripe listen`), browse `http://localhost:8080/a/events`:
  - [ ] **Submit — address search:** the address field is a Google search box; typing shows suggestions; picking one fills the address (a "Selected: …" line shows) and auto-fills the city.
  - [ ] **Submit — country/region:** the country dropdown is populated from `/geo` and includes **Hong Kong, Macau, Taiwan, Mainland China** (and no plain "China"); choosing a region-required country (USA, Australia, UK, Canada, France, Russia, Denmark, NZ, Brazil, Mexico, Chile, Indonesia, Netherlands, Portugal, Spain, South Africa, Mainland China) reveals a **required** State/Territory/Region dropdown; choosing **HK/Macau/Taiwan** auto-fills the region with the country name.
  - [ ] **Server enforcement:** typing an address but NOT picking a suggestion → submit rejected with "Please choose your address from the suggestions…"; a region-required country with no region → rejected; a country not in the list → rejected.
  - [ ] **Happy path:** Google-selected address → `4242…` → USD 5 hold → approve in admin → the published detail page shows the **exact-pin** map + "Get directions" opens to that pin.
  - [ ] **Legacy event (no coords):** its detail page still shows the **address-string** map (no error), and its edit form still saves.
  - [ ] **Edit paths keep coords:** magic-link `/edit`, account dashboard, admin modal all prefill country/region/address; **saving without touching the address keeps the exact-pin** (coords carried forward); picking a NEW address moves the pin.
  - [ ] **JSON-LD:** `curl -s http://localhost:8080/a/events/<slug>` (or view-source) shows `"geo":{"@type":"GeoCoordinates",…}` and `addressRegion`/`postalCode` when coords exist.
  - [ ] **Fallback (no key):** with `NEXT_PUBLIC_MAPS_BROWSER_KEY` unset, the address field degrades to a plain text input and the form still submits with the address left blank.
  - [ ] **Regression:** listing-page country filter still works; existing events render.
  - [ ] **Prod DB:** `psql "$DATABASE_URL" -f database/migrations/ep2-location.sql` applied to the live DB before deploy; large region seed lists (Russia/Indonesia) sanity-checked.

### Phase EP-3 — Submission form UX (D1, D2, D3)
- [x] **D1 — Image preview + drag-and-drop** for the single required image in [`SubmitEvent.js`](frontend/components/views/landingPages/SubmitEvent/SubmitEvent.js). The image field is now a **dashed drop zone** (`onDragOver/Leave/Drop`) with the file picker inside it; a dropped OR picked file routes through the same `acceptFile()` → the existing type/size checks are unchanged. A **thumbnail preview** renders from a `URL.createObjectURL(imageFile)` object URL (plain `<img>`, revoked on change/unmount — no `next/image`, no leak) plus a "Selected: <name>" line. **Single image only** (multi-image = Track C, out of scope).
- [x] **D2 — Inline per-field validation** (errors shown under each field on blur / on a gated Next / on submit) replacing the single top error list, in **both** [`SubmitEvent.js`](frontend/components/views/landingPages/SubmitEvent/SubmitEvent.js) and [`EditEvent.js`](frontend/components/views/publicPages/EditEvent/EditEvent.js) *(owner chose Submit **+** Edit)*. Pure `buildFieldErrors()` returns a `{field: message}` map recomputed each render; a `touched` map + blur handlers gate reveal. The **top alert is now reserved for server/network errors** (the server stays the authority). The shared [`LocationFields`](frontend/components/common/LocationFields/LocationFields.js) is **untouched** — it already reports its own errors up via `onValidationChange`, so those (+ country/city required) are surfaced in one inline block within the Location step (integrate, don't duplicate); a wrapping `onBlur` marks that block touched.
- [x] **D3 — Multi-step wizard** layout for the submit form (**Details → Location → Description & image**, then the existing post-3a **Confirm & pay** screen). *(Owner: Pay stays on the current post-3a `CheckoutStep` screen — the wizard covers data-entry only, so the two-request 3a/3b contract, payment/persist flow, honeypot, and taxonomy//geo fetches are **untouched**.)* Hand-rolled — **no new deps** (owner). Single `fields`/`selectedCategories`/`imageFile`/`locationErrors`/`honeypot` state is unchanged and FormData is still assembled + submitted once, at the end. **All steps stay mounted** (inactive ones use the `hidden` attribute) so `LocationFields` never unmounts — the Google autocomplete isn't re-mounted and captured coords are retained (verified: values persist across Back/Next). Enter-to-submit / Next on a non-final step just advances; only the final step's "Continue" fires 3a.
- [x] `next build` clean; wizard walked on **mobile + desktop** via the preview server (see round notes).

  Round notes (EP-3): shipped 2026-07-07. **Owner decisions surfaced + answered before coding** (§5): (a) **Pay stays the post-3a screen** — wizard = data-entry steps only; (b) **D2 on Submit + Edit** (not Submit-only); (c) **hand-roll the wizard, no new deps**. **CHOSEN / discovered:**
  - **Steps kept mounted via `hidden`, not conditionally rendered** — this is the safe answer to the LocationFields watch-out: unmounting the Location step would tear down the `PlaceAutocompleteElement` + re-fetch `/geo` on every visit and reset its `addressPending` state. Because the coords already live in the parent `fields`, they survive regardless, but keeping the block mounted avoids the destructive re-mount entirely. With `noValidate` on the form, `required` fields inside a `hidden` step don't trigger browser validation.
  - **LocationFields NOT modified.** It's shared by submit + 3 edit paths (magic-link, account, admin); rather than add per-field-error props to it, the parent surfaces its upward-reported `locationErrors` (+ country/city required) as one inline block at the Location step. Consistent across Submit + Edit, zero risk to the admin/account callers.
  - **`imageError()` + `buildFieldErrors()` are pure module-scope helpers** so the validation logic is verifiable in isolation. **No JS unit test was added: the repo has no JS test runner** (tests are the backend Python suite; EP-1/EP-2 added there). EP-3 touches no backend/data-processing function, so adding Jest (a new dev-dep + config) would violate "surgical"; the defined EP-3 gate is `next build` clean + a manual walkthrough, both done. *(If the owner wants JS unit coverage going forward, that's a separate infra decision — flag it.)*
  - **Verified on the preview dev server (frontend standalone, no backend):** `next build` clean; `/a/events/submit` renders; the 3-step indicator + Next/Back work; a gated Next reveals inline errors and blocks advance (Details: 4 field errors + `.is-invalid`; Location: "Country/City is required"); Back preserves entered values (proves steps stay mounted); a dispatched file yields a `blob:` thumbnail + "Selected: <name>"; layout is clean on mobile (375px, indicator wraps) + desktop. **Not verifiable here (needs the docker stack + Stripe — owner):** a full submit → USD 5 hold → pending, and the `/geo`-populated country/region dropdowns (the standalone preview has no backend, so country shows only the placeholder). This mirrors the EP-1/EP-2 handoffs.

  **Owner verification checklist (EP-3)** — on the running docker stack (`export NEXT_PUBLIC_MAPS_BROWSER_KEY=… && docker compose up --build`; Stripe test key + `stripe listen`), browse `http://localhost:8080/a/events/submit`:
  - [ ] **Wizard:** three steps (Details → Location → Description & image); Next is blocked with inline errors until the step's required fields are filled; Back preserves everything (including a Google-selected address + its coords).
  - [ ] **D1:** dragging an image onto the drop zone (and the file picker) both show a thumbnail preview + "Selected: <name>"; an oversized/wrong-type file shows the inline image error.
  - [ ] **D2:** required fields show errors under each field on blur / on a blocked Next; the top red alert only appears for a server/network error.
  - [ ] **Contract intact:** completing all three steps → "Continue" reaches the **Confirm & pay** screen (image + name/city shown) → `4242 4242 4242 4242` → USD 5 hold → the "under review" confirmation. Approve in admin → published detail page still shows the exact-pin map.
  - [ ] **Edit paths (D2):** magic-link `/edit`, account dashboard, admin modal all show inline per-field errors and still save (no wizard on the edit form — inline validation only).
  - [ ] **Regression:** honeypot still rejects a filled `company_url`; re-submit prefill (`?resubmit=…&token=…`) still populates the wizard.

### Phase EP-4 — Full regression gate (before merge)
- [~] End-to-end local run (`docker compose up --build`, Stripe test + `stripe listen`): submit with Google-selected address → USD 5 hold → approve → published detail page shows the **exact-pin map + directions + local-time note**; a legacy event (no coords) still shows the **A1 address-string map**. **Code-confirmed** ([`EventDetail.js`](frontend/components/views/publicPages/EventDetail/EventDetail.js) picks `q=<lat,lng>` when coords exist, else the address string; local-time note present) + `next build` clean + backend suite green. **Owner-run (needs Stripe test card + `stripe listen` + the Maps key):** the actual card hold → approve → live pin, and the legacy fallback render — I can't drive Stripe/`/geo` from a bare frontend preview (same boundary as EP-1/EP-2/EP-3).
- [~] Edit paths carry the new fields: magic-link edit, account dashboard edit, admin edit (pending + live) all prefill and persist coords/structured address without dropping them. **Code-confirmed + unit-tested:** [`edits.py`](backend/scripts/edits.py)/[`account.py`](backend/scripts/account.py)/[`admin.py`](backend/scripts/admin.py) `/context` all serialise the 5 cols (coords `::double precision`); [`create_edit_version`](backend/event_versioning.py) INSERTs + carries coords forward when the address is unchanged; the carry-forward-vs-new-coords cases are in the **83-green** suite; [`AdminEditModal.buildContext`](frontend/components/views/admin/AdminEditModal/AdminEditModal.js) prefills all 5. **Owner-run:** the browser prefill/save on each of the three edit surfaces.
- [~] Widget feed + JSON-LD validated (Google Rich Results test on a sample detail page); sitemap unaffected. **Code-confirmed:** the widget feed inherits coords via `_PUBLIC_COLUMNS` ([`events.py`](backend/scripts/events.py) lat/lng `::double precision`); [`seo.js`](frontend/core/utils/seo.js) emits `geo`(`GeoCoordinates`) + `addressRegion`/`postalCode` when present; [`sitemap.xml.js`](frontend/pages/sitemap.xml.js) uses only `slug`/lastmod so it is **unaffected** by EP-2. **Owner-run:** paste a live detail URL into Google's Rich Results test.
- [x] Full backend unit suite green; document new env vars in the `.env*` templates and the deploy note (prod `ALTER TABLE`). **Backend suite 83 green** (unchanged — EP-4 adds no backend code). `NEXT_PUBLIC_MAPS_BROWSER_KEY` is documented in [`frontend/.env.local.example`](frontend/.env.local.example) (line 32) and wired in [`docker-compose.yml`](docker-compose.yml) `events-web` (line 71); the prod `ALTER TABLE` + geo-table migration is [`ep2-location.sql`](database/migrations/ep2-location.sql), recorded as applied to live in the EP-2 deploy note above.

  Round notes (EP-4): shipped 2026-07-07. **This round = the regression gate PLUS the one owner-requested build (the deferred admin mini-map).** No backend/contract/schema change; one new presentational frontend component + two wire-ins.
  - **Owner decision (surfaced before coding):** the deferred EP-2 stretch (admin mini-map/coords) is **IN**, on **Review queue + Live listings** (not the edit modal — its live-preview variant would mean hooking the shared `LocationFields` used by 4 callers, higher risk for no parity gain). Built as a shared [`AdminLocationMap`](frontend/components/views/admin/AdminLocationMap/AdminLocationMap.js).
  - **CHOSEN / discovered:**
    - **Reused the `EventDetail` keyless-embed pattern verbatim** rather than a new map integration — no API key, no billing, exact pin from stored coords with the address-string fallback (venue NAME dropped) for legacy events, identical to the public page. Zero new deps.
    - **Asymmetric default state by panel:** ReviewQueue opens the map (pending items are few and location is the thing being reviewed); LiveListings keeps it behind a "Show map" toggle (many rows) so the iframe — and its Google cookies — only mount on demand. Mirrors the existing "View history" toggle in `ListingRow`.
    - **`AdminEditModal` left untouched** — it already prefills/carries all 5 location fields (`buildContext`), so a preview map there is cosmetic; keeping it out honours "surgical" and avoids touching the shared `LocationFields`.
    - **Region-seed sanity-check (the remaining OPEN item):** documented a concrete how-to for the owner (see §5) — a `psql` query to list Russia's 83 / Indonesia's 38 subdivisions straight from the live `country_regions`, editable in place (the whole point of the single-source-of-truth `/geo`).
  - **Verified by me:** backend suite **83 green**; `next build` **clean** with the two panels compiled; widget/JSON-LD/sitemap confirmed by code inspection (above). **Not verifiable without the owner's stack (Stripe test key + `stripe listen` + `NEXT_PUBLIC_MAPS_BROWSER_KEY`):** the live end-to-end hold→approve→pin, the three edit surfaces in-browser, the Google Rich Results test, and the rendered admin mini-map (auth-gated panels can't be exercised from a bare preview). These are the `[~]` items above and the owner checklists below — same handoff boundary as every prior EP round.

### Phase EP-6 — Multi-date scheduling (E1, E2, E3) — the second schema phase

> Added 2026-07-08. Lets one event run on **several explicit dates**, each with its own start/end time
> (Eventbrite's "schedule"). NOT rule-based recurrence. Same additive/nullable/no-backfill discipline
> as EP-2. **Not yet started** — this section is the build spec; a fresh session implements it.

**Design decisions (RESOLVED with owner 2026-07-08):**
- **E-D1 — Model = a child `event_occurrences` table** (one row per date, its own start/end), **NOT a
  JSON column**, snapshotted per version like coords/image. **Keep `event_versions.start_datetime` /
  `end_datetime` as a DERIVED SUMMARY** = `MIN(start)` / `MAX(end)` across the version's occurrences.
  *Rationale:* the whole existing read surface (listing filter/sort, `is_past`, the upcoming/past
  toggle, the widget, basic JSON-LD, the hourly auto-expire job) reads those two scalars — keeping them
  as an authoritative summary means **that surface is unchanged**, and only the detail page + forms +
  the new table/serialisation are net-new. The validator/persist layer is the **single writer** of both
  the scalars and the occurrence rows, so they never drift.
- **E-D2 — Backward compat = no backfill (mirrors D-4).** Legacy versions have zero occurrence rows;
  reads treat "no rows" as **a single implied occurrence** built from the scalar `start/end`. Existing
  events keep working untouched. The new table + migration are purely additive.
- **E-D3 — Listing display = ONE card, full first→last range** (owner). `formatDateRange(summary_start,
  summary_end)` already renders this from the scalars, so the listing/board is effectively unchanged;
  add only an optional small "N dates" hint on the card + detail page.
- **E-D4 — Pricing = FLAT USD 5 per listing** regardless of date count (owner). **The payment flow
  (two-request hold + manual capture, `payments.py`) is UNTOUCHED** — no per-date multiplication.
- **E-D5 — Form = single date by default; an "Add another date" control reveals the schedule table**
  (owner). The common single-date case stays exactly as today; only multi-date submitters use the new
  table. New shared `ScheduleFields` component (parallels `LocationFields`), hosted in the EP-3 wizard's
  **Details** step (all steps stay mounted per EP-3, so nothing re-mounts).
- **E-D6 — Occurrence shape = one date + a start time + an end time on that date** (start < end,
  validated). **Out of scope:** overnight/multi-day *single* occurrences (an occurrence spanning past
  midnight), and any rule-based recurrence (RRULE). Cap the count at a sane max (≈50) server-side.

**Ripple map (EP-6):**

| Layer | File | EP-6 change |
|---|---|---|
| DB schema | [`database/schema.sql`](database/schema.sql) | **NEW `event_occurrences`** (`event_version_id` FK **ON DELETE CASCADE**, `starts_at`, `ends_at`, `sort_order`) + index on `event_version_id`. Scalar `start/end` on `event_versions` retained as summary. |
| DB migration | `database/migrations/ep6-occurrences.sql` (NEW) | additive/idempotent: `CREATE TABLE event_occurrences` + index. No backfill. Hand-apply to prod via the bastion. |
| Validators | [`submission_validation.py`](backend/submission_validation.py) | accept an **`occurrences`** array (`[{start,end}]`); require ≥1; each `start < end`; enforce the ≈50 cap; **derive** `cleaned["start_datetime"]=min`, `["end_datetime"]=max`; also expose `cleaned["occurrences"]`. A single-date submission (scalars only) is wrapped into one occurrence. Shared by submit + all edits. **Unit tests** (the cheap marks). |
| Submit persist | [`scripts/submissions.py`](backend/scripts/submissions.py) | after the `event_versions` INSERT, INSERT the occurrence rows in the **same transaction**. |
| Edit versioning | [`event_versioning.py`](backend/event_versioning.py) | re-snapshot occurrence rows into the **new** version (carry forward the source version's rows when the schedule is unchanged, like the coords/image carry-forward). |
| Edit context | [`scripts/edits.py`](backend/scripts/edits.py) + [`account.py`](backend/scripts/account.py) + [`admin.py`](backend/scripts/admin.py) | `/context` returns the version's **`occurrences`** (sorted) so the form prefills the table. |
| Public read | [`scripts/events.py`](backend/scripts/events.py) | the **detail-by-slug** response includes `occurrences`; the **listing + widget** feeds keep the summary scalars only (E-D3). |
| Submit/edit forms | [`SubmitEvent.js`](frontend/components/views/landingPages/SubmitEvent/SubmitEvent.js) + [`EditEvent.js`](frontend/components/views/publicPages/EditEvent/EditEvent.js) via **NEW shared `ScheduleFields`** | single date default + "Add another date" → date/start/end rows (add/remove/reorder), inline per-field validation (EP-3 pattern); emits `occurrences` into the existing `fields`/FormData. |
| Detail page | [`EventDetail.js`](frontend/components/views/publicPages/EventDetail/EventDetail.js) | render the **full schedule** (a list of each date's start–end) in the "When" block; keep the summary range + local-time note; "N dates" hint. |
| SEO JSON-LD | [`core/utils/seo.js`](frontend/core/utils/seo.js) | when >1 occurrence, emit an **array of `Event` objects** (one per occurrence, each own `startDate`/`endDate`) — Google's guidance for the same event on multiple dates; 1 occurrence keeps today's single `Event`. |
| Admin display | [`ReviewQueue.js`](frontend/components/views/admin/ReviewQueue/ReviewQueue.js) / [`LiveListings.js`](frontend/components/views/admin/LiveListings/LiveListings.js) | show the **schedule / date count** so a reviewer sees all dates before approving. |
| Widget | [`frontend/public/widget/events-widget.js`](frontend/public/widget/events-widget.js) | optional: append "+N more dates" to the date line (summary start unchanged). |

**Checklist:**
- [x] **Schema + migration.** `event_occurrences` in [`schema.sql`](database/schema.sql) (FK `ON DELETE CASCADE` — occurrences can't outlive their version, like `country_regions`) + `idx_event_occurrences_version`. NEW idempotent `database/migrations/ep6-occurrences.sql` (additive, no backfill). Local re-seed via `docker compose down -v`. **SQL validated on a throwaway Postgres:** schema applies clean; the migration applies to a pre-EP-6 DB and re-runs idempotently; FK cascade + `json_agg`/count round-trip confirmed.
- [x] **Validator.** `validate_submission` accepts `occurrences` (parse each `{start,end}` with `parse_datetime`), requires ≥1 valid row, `start < end` per row, enforces the 50 cap (`MAX_OCCURRENCES`), **derives the summary `start_datetime`/`end_datetime`** (MIN/MAX), and returns `cleaned["occurrences"]`. Single-date input (bare scalars, no array) is normalised into one occurrence so every old caller/test still passes. Shared by submit + magic-link + account + admin (single source, D-5). New `_validate_occurrences` helper.
- [x] **Persist — submit.** [`submissions.py`](backend/scripts/submissions.py) parses the multipart `occurrences` JSON field and INSERTs occurrence rows (`insert_occurrences`) in the create-intent transaction after the version row.
- [x] **Persist — edits.** [`create_edit_version`](backend/event_versioning.py) re-snapshots the occurrence rows onto the new version. Occurrences round-trip through the forms (like `drink_categories`), so an unchanged schedule is simply re-inserted — that IS the carry-forward.
- [x] **Serialise.** `/context` in [`edits.py`](backend/scripts/edits.py)/[`account.py`](backend/scripts/account.py) (via `fetch_occurrences`) + `pending()`/`live()` in [`admin.py`](backend/scripts/admin.py) (via `json_agg`) + the detail-by-slug read in [`events.py`](backend/scripts/events.py) return the sorted `occurrences`. Listing/widget keep the summary scalars + a cheap `occurrence_count`.
- [x] **Forms.** NEW shared [`ScheduleFields`](frontend/components/common/ScheduleFields/ScheduleFields.js) (single date default + "Add another date" → a date/start-time/end-time table, add/remove/collapse); wired into `SubmitEvent` (Details step) + `EditEvent` + `AdminEditModal` (via `buildContext`); reports its own errors up (EP-3 pattern, like `LocationFields`); emits `occurrences`. All wizard steps stay mounted (EP-3).
- [x] **Detail page.** [`EventDetail.js`](frontend/components/views/publicPages/EventDetail/EventDetail.js) renders the full per-date schedule + an "N dates" heading when >1; legacy single-occurrence events read identically to today (implied one occurrence from the scalars).
- [x] **JSON-LD.** [`seo.js`](frontend/core/utils/seo.js) emits an ARRAY of per-occurrence `Event` objects when >1 date; a single/legacy date keeps today's single `Event`.
- [x] **Admin display.** ReviewQueue lists every date + an "N dates" badge; LiveListings shows the "N dates" badge.
- [x] **Widget + listing.** "+N more dates" on the widget card and "· N dates" on the listing cards, both from `occurrence_count`.
- [x] **Regression + tests.** Single-date submit + all edit paths unchanged; legacy events (no rows) render one implied occurrence; listing/sort/`is_past`/auto-expire read the untouched summary scalars. **Backend suite 90 green** (7 new: single-date normalisation, multi-date MIN/MAX summary derivation, per-row start<end, equal-start-end rejected, missing-time rejected, cap enforcement, empty-array fallback); `next build` clean; ScheduleFields walked in the browser.
- [ ] **Prod.** Apply `ep6-occurrences.sql` to the live `drinkxprod`/`events` DB via the bastion (additive/safe); take a `pg_dump` backup first, as in EP-2. **(owner — one new table + index, no backfill.)**

  **Owner-verification checklist (EP-6)** — on the running docker stack (`docker compose down -v && docker compose up --build` to re-seed with the new table; Stripe test key + `stripe listen` + `NEXT_PUBLIC_MAPS_BROWSER_KEY`), browse `http://localhost:8080/a/events`:
  - [ ] **Single-date submit unchanged:** the Details step shows the usual Starts/Ends inputs; a normal one-date submit → USD 5 hold → pending, exactly as before (no schedule table needed).
  - [ ] **Add-a-date table:** "＋ Add another date" reveals a table (one date + start + end time per row); add/remove rows; "Use a single date instead" collapses back. An incomplete/`end ≤ start` row is blocked inline before the server round-trip.
  - [ ] **Multi-date happy path:** submit 3 dates → still ONE USD 5 hold (flat, E-D4) → approve in admin → the published detail page's "When" block lists all 3 dates with an "N dates" heading; the listing card shows the full first→last range + "· 3 dates"; the widget shows "+2 more dates".
  - [ ] **Edits keep the schedule:** magic-link `/edit`, account dashboard, and admin modal all prefill the multi-date table; saving without touching it preserves every date (a new version re-snapshots the same rows); changing/adding a date is reflected after approval.
  - [ ] **JSON-LD:** `view-source` on a multi-date detail page shows an ARRAY of `Event` objects, one per date with its own `startDate`/`endDate`; a single-date page still shows one `Event`.
  - [ ] **Legacy events (no occurrence rows):** an event submitted before EP-6 still renders one date on the detail page, still lists/sorts, still shows the correct past/upcoming badge, and its edit form opens in single-date mode.
  - [ ] **Prod DB:** `pg_dump` backup taken, then `ep6-occurrences.sql` applied to the live `events` DB via the bastion; verify `event_occurrences` exists.

  Round notes (EP-6): shipped 2026-07-08. **The second isolated schema phase** — a child `event_occurrences` table with the existing `start_datetime`/`end_datetime` kept as a derived summary, additive/no-backfill like EP-2. **CHOSEN / discovered:**
  - **Occurrences round-trip through the forms like `drink_categories`, NOT carried forward in the versioning layer like image/coords.** Every edit surface (magic-link, account, admin) uses `EditEvent`/`ScheduleFields`, which prefills the schedule from `/context` and re-emits it; `create_edit_version` just re-inserts `cleaned["occurrences"]` onto the new version. An unchanged schedule → the same rows re-inserted, which is the carry-forward — no source-reading special case needed. (Flagged: a hypothetical API caller that sends no `occurrences` would collapse a multi-date event to its single-date summary on edit; all shipped UIs send them.)
  - **Single date stays the byte-for-byte legacy path.** `ScheduleFields` in single mode renders the exact same two `datetime-local` inputs bound to `start_datetime`/`end_datetime`; the multipart `occurrences` field is `[]`, so the validator uses the unchanged scalar path. Only "Add another date" switches to the array/multi path. This keeps the common case — and every existing test — untouched.
  - **Occurrence rows use one DATE + a start time + an end time** (single-day per E-D6, no overnight), while the grandfathered single-date inputs keep the two full `datetime-local`s (an existing capability). A degenerate single-date `start == end` intentionally stays on the scalar path (no occurrence row) so re-validating the held 3b payload — whose occurrences the multi path checks with strict `start < end` — never disagrees with 3a.
  - **The summary is derived by the validator (the single writer)** so the ~18-file scalar read surface (listing filter/sort, `is_past`, upcoming/past toggle, widget, JSON-LD basic path, hourly auto-expire) is completely unchanged; only the detail-by-slug read fans out the full `occurrences`, and listing/widget get a cheap `occurrence_count` scalar for the "N dates" hint.
  - **Payment path untouched (E-D4):** `payments.py` and the two-request hold/manual-capture flow were not touched — flat USD 5 regardless of date count.
  - **No new deps; no JS test runner added** (repo has none — EP-3 precedent). Backend Python suite is the test surface (+7 EP-6 cases).
  - **Verified by me:** backend suite **90 green**; `next build` **clean**; SQL (schema + idempotent migration + `json_agg`/count/FK-cascade round-trip) validated on a throwaway Postgres; `ScheduleFields` walked in the browser (single↔multi toggle, add/remove/collapse, no console errors). **Owner-run (same boundary as prior rounds — needs Stripe + Maps key + a fresh `docker compose up -v`):** the live multi-date submit → single USD 5 hold → approve → published multi-date detail/listing/widget, the three edit surfaces, the JSON-LD array, the legacy-event fallback, and the prod migration.

---

## 5. Blockers / questions for the owner
- **[RESOLVED 2026-07-06] Provider (D-1):** Google (Eventbrite uses Google Maps).
- **[RESOLVED 2026-07-06] Map type:** keyless Google `output=embed` iframe (address string now, exact `lat,lng` in EP-2). Note: a Google iframe sets Google cookies on the detail page — acceptable.
- **[RESOLVED 2026-07-06] Address & country data quality (D-2/D-6):** no pure free-text — address must be picked from the Google dropdown (coords captured from the selection); country from the list. Server-side enforcement lands in EP-2.
- **[RESOLVED 2026-07-06] Timezone (D-3):** none — just a static "times are local to the event location" note.
- **[RESOLVED 2026-07-06] Order vs master plan:** this is an **add-on** run after `plan.md` (and `style-parity-plan.md`), which are largely done.
- **[RESOLVED 2026-07-07 — EP-2 prereq]** Google **Places API** browser key (`NEXT_PUBLIC_MAPS_BROWSER_KEY`) provisioned on Vercel + `.env.local.example`; wired into docker-compose.
- **[RESOLVED 2026-07-07 — EP-2 scope]** Owner: address optional-but-validated; country strictly required (HK/Macau/Taiwan as countries, `China`→`Mainland China`); **new required region dropdown** for 20 countries; **single source of truth = `/geo` endpoint + DB tables** (frontend country list removed); **new `PlaceAutocompleteElement`**. All implemented in EP-2.
- **[RESOLVED 2026-07-08 — EP-6 scope]** Owner pulled **multi-date scheduling** out of Track C into a new **EP-6**: an event may run on several explicit dates, each with its own start/end (hand-entered schedule, NOT RRULE recurrence). Decisions: **child `event_occurrences` table + derived summary scalars** (E-D1, keeps the existing read surface unchanged, no backfill E-D2); **listing shows one card, full first→last range** (E-D3); **flat USD 5, money path untouched** (E-D4); **single date by default, "Add another date" reveals the schedule table** (E-D5); **per-date single-day occurrences only, ≈50 cap** (E-D6). Build spec written as "Phase EP-6" above; **not yet implemented**. (No EP-5 — owner's numbering.)
- **[RESOLVED 2026-07-06]** `ep2-location.sql` applied to the live `drinkxprod`/`events` RDS via the bastion (see the deploy note above); verified. **[OPEN — owner, low priority]** sanity-check the large region seed lists (Russia/Indonesia) — they're DB-editable.
  - **How to sanity-check (plain steps, no engineering needed):** these lists are just rows in the `country_regions` table on the live DB — nothing is hardcoded, so you can read and fix them in place. Get onto the prod DB the same way EP-2's migration did — from AWS CloudShell: `aws ssm start-session --target i-006f461be066cc1b4 --region ap-southeast-1`, then `psql "$DATABASE_URL"` on the bastion (the prompt becomes `events=>`). Then, to LIST what got seeded for a country:
    ```sql
    SELECT cr.name FROM country_regions cr JOIN countries c ON c.id = cr.country_id
    WHERE c.name = 'Russia' ORDER BY cr.name;   -- 83 rows; try 'Indonesia' (38) too
    ```
    Read down the list — if a subdivision name looks wrong or one is missing, fix it directly, e.g. rename `UPDATE country_regions SET name='…' WHERE id=…;`, hide one `UPDATE country_regions SET active=false WHERE id=…;` (the form only shows `active` rows), or add one `INSERT INTO country_regions (country_id,name) SELECT id,'…' FROM countries WHERE name='Russia';`. No redeploy — the `/geo` endpoint reads the table live, so the submit/edit dropdowns update on the next page load. (These are the standard ISO-3166-2 "commonly-used" names generated in EP-2; the point of the single-source-of-truth design is exactly that you can correct them here without a code change.)

---

## 6. Round log
_Append one entry per working session: date, phase touched, what shipped, decisions locked, tests, and anything discovered. Mirror the "CHOSEN designs / discovered sub-tasks" style used in `plan.md` §10._

- **2026-07-06 — Plan created.** Scope set to Tracks A/B/D (not C). Ripple map + phase breakdown drafted from a full read of the submit/edit/admin/versioning/read code.
- **2026-07-06 — Owner decisions locked** (§2/§5): Google provider; Google-validated-address-only (coords captured from the selection, no separate geocode); no timezone (static note only); nullable cols/no backfill; server-side enforcement in EP-2. Plan updated throughout.
- **2026-07-06 — EP-1 shipped + verified** (see the EP-1 round notes). A1 map + directions, B1 country dropdown, B2 submitter-type dropdown, B3 server-side URL validation (+3 tests, 72 green), B4 description counter, B5 local-time note. No schema change, no new deps. Committed `3173b90`.
- **2026-07-07 — EP-2 prereq partly met + EP-1 handed to owner for verification.** Owner added `NEXT_PUBLIC_MAPS_BROWSER_KEY` on Vercel (still needs the local `.env.local` / compose copy for local EP-2 dev). EP-1 owner-verification checklist added above. **Next: EP-2** (Google Places Autocomplete + coordinate capture + schema change) — see the handover prompt issued this session.
- **2026-07-07 — EP-2 shipped.** A2/A3 + server-side enforcement. Owner answered the three open decisions and **expanded scope**: address optional-but-Google-validated; country strictly required with HK/Macau/Taiwan as countries and `China`→`Mainland China`; **new required dependent State/Territory/Region dropdown** for 20 countries; **single source of truth via a new `/geo` endpoint + `countries`/`country_regions` tables** (frontend `COUNTRIES` constant removed); **new `PlaceAutocompleteElement`** loaded on-demand. Delivered: 5 nullable `event_versions` cols + 2 geo tables (405 subdivisions) + prod migration; `validate_submission` coords/address-selection/country/region rules (+ `require_address_selection` relax for edits); persist + carry-forward across submit/magic-link/account/admin; `_PUBLIC_COLUMNS`; shared `LocationFields` (autocomplete + country/region + plain-input fallback); exact-pin detail map + place_id directions; JSON-LD `geo`/`postalCode`/`addressRegion`; docker-compose key. **Tests: backend 83 green** (11 new); SQL applied to a throwaway Postgres (schema + idempotent migration); `next build` clean. **Owner still to do:** run `psql -f database/migrations/ep2-location.sql` on prod; end-to-end verify on the running docker stack (submit with a Google address → exact-pin map; legacy event still maps by address; edits keep coords); sanity-check the large region seed lists. Committed to `main`.
- **2026-07-07 — EP-3 shipped.** Pure frontend submission-form UX, **no schema/backend contract change** (the two-request 3a/3b submit, payment/persist, honeypot, and taxonomy//geo fetches are all untouched). Owner answered the three surfaced decisions before coding: **Pay stays the post-3a screen** (wizard = data-entry only), **D2 on Submit + Edit**, **hand-roll the wizard (no new deps)**. Delivered: **D3** a 3-step wizard (Details → Location → Description & image) in [`SubmitEvent.js`](frontend/components/views/landingPages/SubmitEvent/SubmitEvent.js) with all steps kept mounted via `hidden` so `LocationFields` (Google autocomplete + captured coords) is never torn down; the single state object + one-shot FormData assembly are unchanged. **D2** inline per-field validation via pure `buildFieldErrors()` + a `touched` map in both [`SubmitEvent.js`](frontend/components/views/landingPages/SubmitEvent/SubmitEvent.js) and [`EditEvent.js`](frontend/components/views/publicPages/EditEvent/EditEvent.js); the top alert now only shows server/network errors; `LocationFields` left untouched (its upward-reported errors + country/city required are surfaced inline at the Location step — integrate, don't duplicate). **D1** a dashed drag-and-drop zone + object-URL thumbnail preview (revoked on change/unmount) for the single required image, reusing the existing type/size checks. **No new deps.** `imageError()`/`buildFieldErrors()` extracted as pure helpers; **no JS unit test** (repo has no JS runner — flagged; EP-3 touches no backend function). **Verified:** `next build` clean; walked the wizard on the preview server (mobile + desktop) — step nav, gated inline errors, state-preserving Back, `blob:` image preview all confirmed. **Owner still to do:** end-to-end on the docker stack (full submit → USD 5 hold → pending; `/geo` country/region; edit-path inline validation). Committed to `main`.
- **2026-07-08 — EP-6 shipped (multi-date scheduling).** Built the full E1/E2/E3 stack to the locked E-D1…E-D6 decisions. **Schema:** new child `event_occurrences` table (FK `ON DELETE CASCADE`, `starts_at`/`ends_at`/`sort_order`) + index in [`schema.sql`](database/schema.sql); idempotent additive [`ep6-occurrences.sql`](database/migrations/ep6-occurrences.sql) (no backfill). **Validator:** `validate_submission` now accepts an `occurrences` array (new `_validate_occurrences` helper — ≥1 valid row, strict `start < end`, 50-cap), **derives** the scalar summary MIN/MAX, and returns `cleaned["occurrences"]`; a bare single-date submission normalises to one occurrence (or, for a degenerate `start == end`, stays on the scalar path with no row) so every existing caller/test is unchanged. **Persist:** shared `insert_occurrences`/`fetch_occurrences` in [`event_versioning.py`](backend/event_versioning.py); submit + all three edit paths re-snapshot the schedule onto the new version (round-tripped through the forms, like `drink_categories`). **Serialise:** `/context` (edits/account), `pending()`/`live()` (admin `json_agg`), and detail-by-slug (`events.py`) return sorted `occurrences`; listing/widget keep the summary scalars + a cheap `occurrence_count`. **Frontend:** new shared [`ScheduleFields`](frontend/components/common/ScheduleFields/ScheduleFields.js) (single-date default + "Add another date" table) wired into `SubmitEvent`/`EditEvent`/`AdminEditModal`, reporting errors up like `LocationFields`; `EventDetail` renders the full schedule; `seo.js` emits a per-occurrence `Event` array when >1 date; ReviewQueue/LiveListings/listing cards/widget show the date count. **Payment path untouched** (flat USD 5, E-D4). **Verified:** backend **90 green** (+7 EP-6 tests), `next build` clean, SQL (schema + idempotent migration + `json_agg`/count/FK-cascade) validated on a throwaway Postgres, `ScheduleFields` walked in the browser. **Owner still to run:** the live docker+Stripe multi-date submit→hold→approve→published-schedule, the edit surfaces, the JSON-LD array, the legacy fallback, and the prod migration (see the EP-6 owner checklist). Committed to `main`.
- **2026-07-08 — EP-6 scoped (plan only, no code).** Owner added multi-date scheduling (Eventbrite "schedule": pick date(s) → a table per date for start/end times) — one piece of Track C pulled in as **EP-6**. Studied the full date-handling surface (~18 files read the scalar `start_datetime`/`end_datetime`: listing filter/sort, upcoming/past toggle, `is_past`, widget, JSON-LD, hourly auto-expire, version carry-forward, all four forms, admin display; one flat USD 5 payment per version). Locked six design decisions with the owner (E-D1…E-D6, §2/§5) — the linchpin being a **child `event_occurrences` table with the existing scalars kept as a derived summary**, so the large read surface stays unchanged and EP-6 is additive/no-backfill like EP-2. Wrote the full "Phase EP-6" build spec (ripple map + checklist + decisions) above. **No code written this session** (owner asked for plan + a handover prompt for a fresh implementation session).
- **2026-07-07 — EP-4 regression gate + admin mini-map.** Ran the full gate and folded in the one owner-requested build. **Owner decision (surfaced before coding):** the deferred EP-2 admin mini-map is IN, on **Review queue + Live listings** (not the edit modal). Delivered: a shared [`AdminLocationMap`](frontend/components/views/admin/AdminLocationMap/AdminLocationMap.js) that **reuses `EventDetail`'s keyless `output=embed` iframe** (no key, no billing) — exact pin + `lat, lng · region · postcode` line + directions when coords exist, address-string fallback for legacy events; wired into `ReviewQueue` (`PendingCard`, open by default) and `LiveListings` (`ListingRow`, behind a "Show map" toggle so a long list mounts no iframes until asked). **No backend/schema/contract change; no new deps.** **Verified by me:** backend suite **83 green**, `next build` **clean**; widget feed (coords via `_PUBLIC_COLUMNS`), JSON-LD (`geo`/`addressRegion`/`postalCode` in `seo.js`), and sitemap (slug-only, unaffected) confirmed by code inspection; env vars documented (`.env.local.example` L32 + `docker-compose.yml` L71). **Owner still to run (needs Stripe test key + `stripe listen` + the Maps key — same boundary as prior rounds):** the live submit→USD-5-hold→approve→exact-pin path, the legacy-event address-string fallback, the three edit surfaces prefilling/persisting coords in-browser, the Google Rich Results test, and the rendered admin mini-map (auth-gated). Also added a **plain-language how-to** for sanity-checking the Russia/Indonesia region seed lists directly on the live `country_regions` table (§5). Committed to `main`.
- **2026-07-06 — EP-2 migration applied to LIVE prod.** Diagnosed a `psql "$DATABASE_URL"` connection failure (empty env var → hit local Postgres, not prod; separately, the shared `drinkxprod` RDS is private and can only be reached from inside the VPC). Connected via `aws ssm start-session` onto the Drink-X bastion EC2 (no SSH key needed) and ran a read-only inventory query against the real prod DB: **confirmed no unrecorded drift** — all 11 original tables + `event_messages.read_by_submitter` were already present and correct; the only gap was exactly EP-2's own additions. Took a `pg_dump` backup on the bastion (33K), then applied `ep2-location.sql` inside `psql`; post-migration checks confirmed `countries`/`country_regions` exist with 82/405 rows and `event_versions.latitude` exists. No other prod changes needed. Deploy note + owner verification checklist updated above with the exact bastion-access steps for next time.
