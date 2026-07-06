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

Sequencing rationale: EP-1 ships the visible Eventbrite gaps with **zero schema/data-model risk**;
EP-2 is the one phase that changes the data model (isolated + reversible, all new columns nullable);
EP-3 is pure frontend UX. EP-4 is the regression gate before merge.

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
| DB schema | [`database/schema.sql`](database/schema.sql) | — | **lat/lng/place_id/postcode/region cols** (no timezone) | — |
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
- [ ] **(EP-2 prereq)** Owner sets up Google Cloud: enable **Places API**, create a **referrer-restricted browser key**, provide it as `NEXT_PUBLIC_MAPS_BROWSER_KEY` in `.env.local.example` + Vercel. *(Needed only when EP-2 starts — the EP-1 embed map is keyless.)*

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

### Phase EP-2 — Location & coordinates (A2, A3 + server-side enforcement) — the schema phase
- [ ] **Schema.** Add nullable columns to `event_versions` in [`database/schema.sql`](database/schema.sql): `latitude NUMERIC(9,6)`, `longitude NUMERIC(9,6)`, `place_id TEXT`, `postcode VARCHAR(32)`, `region VARCHAR(255)`. Keep `venue_address` as the Google-formatted display string. **No `timezone` column** (D-3). *(Local re-seed via `docker compose down -v`; prod is a hand-applied `ALTER TABLE` — note it for Phase-7 deploy.)*
- [ ] **Validators (D-2/D-6).** Extend `validate_submission`: accept/clean the new fields, range-check lat/lng, **require a valid Google selection when an address is supplied** (address present ⇒ coords + place_id present, else reject — "please choose your address from the suggestions"), and **validate country against the canonical list**. Add all to the returned `cleaned` dict so every INSERT site gets them.
- [ ] **Persist — submit.** [`scripts/submissions.py`](backend/scripts/submissions.py) create-intent INSERT carries the 5 new columns.
- [ ] **Persist — edits.** [`event_versioning.create_edit_version`](backend/event_versioning.py) INSERT + **carry-forward** of coords when an edit doesn't change the address (mirrors the image carry-forward).
- [ ] **Serialise — edit context.** [`scripts/edits.py`](backend/scripts/edits.py) `/context` returns the new fields so the edit form prefills them; verify [`scripts/account.py`](backend/scripts/account.py) rides the shared helper.
- [ ] **Public read.** Add the new columns to `_PUBLIC_COLUMNS` in [`scripts/events.py`](backend/scripts/events.py) (listing + detail + widget all inherit it).
- [ ] **Submit/edit forms.** Wire the Google Places Autocomplete widget (browser key `NEXT_PUBLIC_MAPS_BROWSER_KEY`) into [`SubmitEvent.js`](frontend/components/views/landingPages/SubmitEvent/SubmitEvent.js) + [`EditEvent.js`](frontend/components/views/publicPages/EditEvent/EditEvent.js): on suggestion-pick, populate `venue_address`, `city`, `country`, `postcode`, `region`, hidden `lat`/`lng`/`place_id`. **Block submit if an address was typed but not selected** (client mirror of the server rule).
- [ ] **Admin edit.** Extend `buildContext` in [`AdminEditModal.js`](frontend/components/views/admin/AdminEditModal/AdminEditModal.js) to pass the new fields through.
- [ ] **Detail page.** Upgrade [`EventDetail.js`](frontend/components/views/publicPages/EventDetail/EventDetail.js) to an **exact-pin** map (`q=<lat>,<lng>`) when coords exist (else the A1 address-string embed).
- [ ] **JSON-LD.** [`core/utils/seo.js`](frontend/core/utils/seo.js): add `geo` (`GeoCoordinates`) when coords exist, and `postalCode`/`addressRegion` to the `PostalAddress`.
- [ ] (Optional stretch) admin panels show a mini-map / coords for review.
- [ ] Unit tests: lat/lng range, address-selection-required rule, country-list membership, carry-forward-on-edit.

  Round notes (EP-2): _(fill in)_

### Phase EP-3 — Submission form UX (D1, D2, D3)
- [ ] **D1 — Image preview + drag-and-drop** for the single required image in [`SubmitEvent.js`](frontend/components/views/landingPages/SubmitEvent/SubmitEvent.js) (preview the selected file, drag-drop zone). **Single image only** — multi-image is Track C / the existing `plan.md` backlog, explicitly out of this plan.
- [ ] **D2 — Inline per-field validation** (show errors under each field on blur/submit) replacing the single top error list, in [`SubmitEvent.js`](frontend/components/views/landingPages/SubmitEvent/SubmitEvent.js) and optionally [`EditEvent.js`](frontend/components/views/publicPages/EditEvent/EditEvent.js). Keep the server as the authority.
- [ ] **D3 — Multi-step wizard** layout for the submit form (e.g. Details → Location → Description & image → Pay), preserving the existing two-request 3a/3b submit contract underneath. Frontend-only restructure; do not disturb the payment/persist flow.
- [ ] `next build` clean; manual walk-through of the wizard on mobile + desktop.

  Round notes (EP-3): _(fill in)_

### Phase EP-4 — Full regression gate (before merge)
- [ ] End-to-end local run (`docker compose up --build`, Stripe test + `stripe listen`): submit with Google-selected address → USD 5 hold → approve → published detail page shows the **exact-pin map + directions + local-time note**; a legacy event (no coords) still shows the **A1 address-string map**.
- [ ] Edit paths carry the new fields: magic-link edit, account dashboard edit, admin edit (pending + live) all prefill and persist coords/structured address without dropping them.
- [ ] Widget feed + JSON-LD validated (Google Rich Results test on a sample detail page); sitemap unaffected.
- [ ] Full backend unit suite green; document new env vars in the `.env*` templates and the deploy note (prod `ALTER TABLE`).

  Round notes (EP-4): _(fill in)_

---

## 5. Blockers / questions for the owner
- **[RESOLVED 2026-07-06] Provider (D-1):** Google (Eventbrite uses Google Maps).
- **[RESOLVED 2026-07-06] Map type:** keyless Google `output=embed` iframe (address string now, exact `lat,lng` in EP-2). Note: a Google iframe sets Google cookies on the detail page — acceptable.
- **[RESOLVED 2026-07-06] Address & country data quality (D-2/D-6):** no pure free-text — address must be picked from the Google dropdown (coords captured from the selection); country from the list. Server-side enforcement lands in EP-2.
- **[RESOLVED 2026-07-06] Timezone (D-3):** none — just a static "times are local to the event location" note.
- **[RESOLVED 2026-07-06] Order vs master plan:** this is an **add-on** run after `plan.md` (and `style-parity-plan.md`), which are largely done.
- **[OPEN — EP-2 prereq]** Owner to provision the Google **Places API** browser key (`NEXT_PUBLIC_MAPS_BROWSER_KEY`) before EP-2. Not needed for EP-1 (keyless embed).

---

## 6. Round log
_Append one entry per working session: date, phase touched, what shipped, decisions locked, tests, and anything discovered. Mirror the "CHOSEN designs / discovered sub-tasks" style used in `plan.md` §10._

- **2026-07-06 — Plan created.** Scope set to Tracks A/B/D (not C). Ripple map + phase breakdown drafted from a full read of the submit/edit/admin/versioning/read code.
- **2026-07-06 — Owner decisions locked** (§2/§5): Google provider; Google-validated-address-only (coords captured from the selection, no separate geocode); no timezone (static note only); nullable cols/no backfill; server-side enforcement in EP-2. Plan updated throughout.
- **2026-07-06 — EP-1 shipped + verified** (see the EP-1 round notes). A1 map + directions, B1 country dropdown, B2 submitter-type dropdown, B3 server-side URL validation (+3 tests, 72 green), B4 description counter, B5 local-time note. No schema change, no new deps. **Next: EP-2** once the owner provisions `NEXT_PUBLIC_MAPS_BROWSER_KEY`.
