# Submission Process Review — 88 Bamboo Events vs. Eventbrite

*Analysis only — no code changed. Prepared 2026-07-06. Scope (per owner): the event
**submission process** and the **single-event listing page**, with a deliberate deep-dive on
**location/address handling and maps**.*

---

## 1. How our submission works today

### 1.1 The flow

One web form at `/a/events/submit` ([`SubmitEvent.js`](frontend/components/views/landingPages/SubmitEvent/SubmitEvent.js)),
submitted in **two server round-trips** ([`scripts/submissions.py`](backend/scripts/submissions.py)):

1. **3a — `POST /submissions`** (multipart): validate every field against the live DB taxonomy,
   validate + upload the image to S3, return a "held" payload. **Nothing is written to the DB yet.**
2. **3b — `POST /submissions/create-intent`** (JSON): re-validate server-side, authorise a
   manual-capture Stripe hold (USD 5), then persist `events` + `event_versions` + `files` +
   `payments` in one transaction and email the submitter + admin.

Supporting flows: **re-submit prefill** (an archived listing links back with `?resubmit=`), and
**magic-link edits** (a pre-approval edit link is emailed so a still-pending submitter can amend).

There is exactly **one submission channel** — this form. No CSV/bulk import, no API intake, no
"duplicate from a past event" beyond the resubmit prefill.

### 1.2 The fields — mandatory vs optional

Authoritative rules live in [`submission_validation.py`](backend/submission_validation.py); the
form mirrors them client-side for fast feedback but the server is authoritative.

| Field | Required? | Type / control | Stored as | Validation |
|---|---|---|---|---|
| Event name | **Required** | text | `event_versions.name` VARCHAR(500) | non-empty, ≤500 |
| Your email (submitter) | **Required** | email | `events.submitter_email` | structural email check |
| Start date/time | **Required** | `datetime-local` | `start_datetime` TIMESTAMPTZ | ISO-parseable |
| End date/time | **Required** | `datetime-local` | `end_datetime` TIMESTAMPTZ | parseable, ≥ start |
| Country | **Required** | **free-text input** | `country` VARCHAR(255) | non-empty only |
| City | **Required** | **free-text input** | `city` VARCHAR(255) | non-empty only |
| Event format | **Required** | single-select (DB taxonomy) | `event_format` | must be an active label |
| Drink categories | **Required (≥1)** | checkboxes (DB taxonomy) | `drink_categories` TEXT[] | all from active labels |
| Event image | **Required** | file (JPEG/PNG/WebP ≤5 MB) | `files` row + `image_url` | MIME **and** magic-byte checked |
| Payment (USD 5 hold) | **Required** | Stripe Elements | `payments` row | card authorised (manual capture) |
| Public contact email | Optional | email | `contact_email` | validated only if supplied |
| Venue name | Optional | text | `venue_name` VARCHAR(500) | ≤500 |
| **Venue address** | Optional | **free-text input** | `venue_address` **TEXT** | none — stored verbatim |
| Description | Optional | plain `<textarea>` | `description` TEXT | none (rendered `pre-wrap`) |
| Event link | Optional | `url` input | `link` TEXT | HTML type only, no server check |
| Submitter type | Optional | **free-text input** | `submission_type` | free-form ("bar, brand, agency") |

Anti-abuse: a hidden **honeypot** (`company_url`) and **per-IP rate limiting** (5 / 10 min).
Dedupe on (email + name + start-date) **flags** but does not block.

### 1.3 Address / location handling — the key finding

**We do not use Google, Mapbox, or any geocoding/places service. Confirmed by a repo-wide search —
there is no `geocode`, `latitude`, `longitude`, `places`, `mapbox`, or map library anywhere in the
code.** Location is captured as **four independent free-text fields**: `venue_name`, `venue_address`,
`city`, `country`. Specifically:

- `venue_address` is a single plain `<input>` ([`SubmitEvent.js:359`](frontend/components/views/landingPages/SubmitEvent/SubmitEvent.js)) —
  **no autocomplete, no suggestions, no structure** (no street/postcode/state). Whatever the user
  types is stored as-is in a `TEXT` column and is **not even required**.
- `country` and `city` are also free text, so the same place arrives as "USA" / "US" / "United
  States". This already matters: the listing page's **country filter and "prioritise country"
  selector** are populated from these raw strings ([`EventListing.js:433`](frontend/components/views/publicPages/EventListing/EventListing.js)),
  so spelling drift silently fragments the filter.
- **No coordinates are stored, so no map can be drawn.** The detail page shows location as a joined
  text string only.

### 1.4 How the single-event page presents it

[`EventDetail.js`](frontend/components/views/publicPages/EventDetail/EventDetail.js): hero image,
format + category badges, a `<dl>` with **When** (formatted range), **Where** (`venue_name,
venue_address, city, country` joined with commas — plain text, no link), **Contact** (mailto),
description (`white-space: pre-wrap`), and an outbound "Visit event website" button.

For SEO, [`seo.js`](frontend/core/utils/seo.js) emits schema.org `Event` JSON-LD with a
`Place` + `PostalAddress` (streetAddress/locality/country) — but **no `geo` (lat/lng)** block,
because we have no coordinates. **There is no map, no "get directions", and no add-to-calendar.**

---

## 2. How Eventbrite does it

### 2.1 Submission ("Create an event" wizard)

Eventbrite uses a **multi-step wizard**, not one long form. The relevant differences:

- **Event type up front:** single vs **recurring**; and location as **in-person venue / online /
  "TBD"**. A creator with no venue yet can publish with just **city + state** and fill the address
  later. ([Eventbrite create-events docs](https://www.eventbrite.com/platform/docs/create-events),
  [beginner's guide](https://zapier.com/blog/how-to-use-eventbrite/))
- **Location via "smart search" (address autocomplete):** the creator types and picks from
  suggestions; Eventbrite resolves the venue to a structured **Venue object that carries
  latitude/longitude** alongside the address, using Google/geocoding services under the hood.
  ([by-location docs](https://www.eventbrite.com/platform/docs/by-location),
  [Eventbrite ↔ Google Maps](https://www.make.com/en/integrations/eventbrite/google-maps))
- **Rich "About this event":** structured content blocks (headings, text, images, video), not a
  single plain textarea. A **hero image plus a gallery**, an event **summary**, and **tags**.
- **Tickets / registration** and a customisable **order form** with required/optional custom
  questions ([registration form template](https://www.eventbrite.com/blog/event-registration-form-template-ds00/)),
  plus **save-as-draft**.

The *strictly required-to-publish* set is small (name, date/time, a location choice, at least one
ticket) — the depth is optional but **structured**.

### 2.2 The event page — how the map appears

Because the venue is geocoded at entry, the Venue object stores **lat/lng**, so the public event
page renders a **Google map centred on those coordinates with a pin**, next to the formatted
address, plus **"Get directions"**. ("When you input the location with full address, a Google map of
the location can be viewed." — [venue help](https://www.eventbrite.com/help/en-us/articles/807809/how-to-add-a-venue-to-your-organization/),
[create-an-event page guide](https://www.eventbrite.com/blog/how-to-create-an-event-page-that-attendees-love/).)
The page also offers **add-to-calendar**, organiser profile, share, and refund policy.

**The mechanism to copy:** *geocode the address once, at submission time → store coordinates →
render a map from coordinates on the detail page.* Eventbrite does the expensive/ambiguous part
(address → point) **once, when the human is present to confirm the suggestion**, and every page view
afterwards is a cheap map render.

---

## 3. Side-by-side gap summary

| Dimension | 88 Bamboo (today) | Eventbrite | Gap |
|---|---|---|---|
| Address entry | free text, optional, no help | autocomplete → structured + geocoded | **Large** |
| Coordinates stored | none | lat/lng | **Large** |
| Map on event page | none | Google map + pin + directions | **Large** |
| Country/city integrity | free text (drifts) | resolved from picker | **Medium** |
| Description | plain textarea | structured rich blocks | Medium |
| Images | 1 required (gallery backlogged) | hero + gallery + video | Medium |
| Event type | physical only, implicit | in-person / online / hybrid / TBD | Medium |
| Add-to-calendar | none | yes | Small |
| Recurring events | none | yes | Large (likely out of scope) |
| Form shape | one page, two-round submit | multi-step wizard w/ draft | Medium (ours is fine for a $5 board) |
| Anti-abuse | honeypot + rate limit + manual review | captcha + trust systems | Already solid |

Our submit→hold→approve→capture money flow and review discipline are genuinely good and *not* worth
disturbing. The gaps that matter for your stated priority are all in **location + map + place-data
quality**.

---

## 4. Options to improve — grouped, with effort

Effort scale: **S** ≈ a few hours, isolated. **M** ≈ 1–2 days, touches form + backend + maybe
schema. **L** ≈ multi-day, ripples across schema, admin, public pages, filters. Each option notes
the files it would touch.

### Track A — Location & maps (your primary ask)

**A1. Add a map to the event page with *zero* schema change — address-embed.** *(Effort: S)*
Render a map on `EventDetail.js` using the **Google Maps Embed API** (or an OpenStreetMap iframe)
with `q=<venue_address, city, country>`, and add a **"Get directions"** link
(`https://www.google.com/maps/dir/?api=1&destination=<encoded address>`). No coordinates, no
geocoding bill, no migration — Google geocodes the query string at render time.
- *Touches:* `EventDetail.js` only (+ one API-key env var for the embed).
- *Trade-off:* map accuracy depends entirely on how cleanly the user typed the address; a vague
  address centres on the city. Good enough to visually validate the priority quickly.

**A2. Geocode at submission time and store lat/lng — the "proper" Eventbrite model.** *(Effort: M)*
Add an **address autocomplete** to the submit form (Google Places Autocomplete, Mapbox Search, or
free-tier Nominatim); when the user picks a suggestion, capture `lat`/`lng` (and ideally the
structured components). Persist them and render an **exact-pin map** on the detail page from the
stored coordinates.
- *Touches:* `schema.sql` (add `latitude`/`longitude` NUMERIC to `event_versions`, + optionally
  `place_id`, `postcode`, `region`), `submission_validation.py` (accept/validate the new fields),
  `scripts/submissions.py` (persist them in the 3b INSERT), `SubmitEvent.js` (autocomplete widget +
  hidden lat/lng fields), `EventDetail.js` (pin map), `seo.js` (add JSON-LD `geo` → better rich
  results), and the admin edit/version views so coordinates survive edits.
- *Trade-off:* introduces an external key + per-request cost and one new dependency; needs a
  fallback path when the user types a free address without picking a suggestion (keep the current
  free-text as the graceful degradation). This is the highest-value single upgrade for you.

**A3. Structured address fields.** *(Effort: M, natural companion to A2)*
Replace the single `venue_address` line with street / postcode / state so JSON-LD gains
`postalCode` + `addressRegion` and the data is queryable. Largely subsumed by A2 if the autocomplete
returns components.

> **Recommended sequencing for the location goal:** ship **A1** first (hours, no risk, immediately
> answers "can we show a map?"), then decide whether the accuracy of **A2** justifies the external
> geocoder. A1 → A2 is additive, not throwaway.

### Track B — Place-data quality (cheap wins, help everything else)

- **B1. Country as a controlled dropdown (ISO list).** *(S)* Stops "US/USA/United States" drift that
  already fragments your country filter + "prioritise country" selector. Touches `SubmitEvent.js`
  and, if you want to enforce it, `submission_validation.py`.
- **B2. `submission_type` → dropdown** (bar / brand / agency / distributor / other). *(S)* Turns a
  free-text column into analysable data. Form + validation only.
- **B3. Server-side URL validation/normalisation** for `link`. *(S)* Currently only the browser
  checks it.
- **B4. Description helper** — character counter + gentle min-length. *(S)* Better listings, no
  schema change.
- **B5. Explicit event timezone.** *(M)* `datetime-local` is wall-clock/naive but you store
  `TIMESTAMPTZ` across many countries — a Tokyo event entered as `18:00` can render/rank wrong.
  Capture an IANA timezone (often derivable from A2's geocode). Touches form, validation, storage,
  and the date formatters.

### Track C — Feature parity (larger, optional)

- **C1. Add-to-calendar (.ics / Google link) on the detail page.** *(S)* Pure win, no dependency,
  no schema change — arguably do this alongside A1.
- **C2. Online / hybrid / "TBD" event type.** *(M–L)* Add an event-type field; when online, capture
  a join URL instead of a venue; ripples into detail rendering, filters, and JSON-LD
  (`eventAttendanceMode` is currently hard-coded to `OfflineEventAttendanceMode` in `seo.js`).
- **C3. Multi-image gallery.** *(M)* Already fully specced in your backlog (`plan.md` → "Multi-image
  submission upload"); the `files` table already supports N rows.
- **C4. Rich-text (or lightweight Markdown) description.** *(M)* Storage is already `TEXT`; the work
  is a safe editor + sanitised render.
- **C5. Recurring events.** *(L)* Big data-model change; likely out of scope for a paid single-event
  board — flag as "probably don't".

### Track D — Form UX

- **D1. Image preview + drag-and-drop.** *(S–M)* Already in your backlog; pure frontend.
- **D2. Inline per-field validation** (vs the top error list). *(S–M)* `SubmitEvent.js` only.
- **D3. Multi-step wizard.** *(M)* Matches Eventbrite's feel, but for a single $5 listing your
  one-page form is arguably *better* (less friction). Low priority.

---

## 5. Recommendation

For the goal you named — **location handling + showing a map, plus tightening how place info is
presented** — the leverage is lopsided toward a few small items:

1. **A1 + C1 + B1** (all **S**, no schema change, ~half a day total): a map + directions +
   add-to-calendar on the event page, and a country dropdown to stop filter drift. This closes the
   most *visible* Eventbrite gap immediately and de-risks the rest.
2. **Then A2 (+A3/B5)** (**M**) if you want Eventbrite-grade pin accuracy and richer JSON-LD — this
   is the one upgrade that meaningfully changes the data model, so treat it as its own phase with a
   free-text fallback preserved.
3. **Defer C2–C5 and D3** unless a real user need appears; C3/D1 are already queued in your backlog
   and can ride along.

Everything here is **additive to your existing submit→hold→review→capture pipeline** — none of it
requires touching the payment or approval logic, which is the part worth leaving alone.

---

### Sources
- [Eventbrite — Creating an Event (Platform docs)](https://www.eventbrite.com/platform/docs/create-events)
- [Eventbrite — Search by location / Venue object](https://www.eventbrite.com/platform/docs/by-location)
- [Eventbrite — Add a venue to your organization (Help Center)](https://www.eventbrite.com/help/en-us/articles/807809/how-to-add-a-venue-to-your-organization/)
- [Eventbrite — Create online/in-person hybrid events](https://www.eventbrite.com/help/en-us/articles/448640/create-online-in-person-hybrid-events/)
- [Eventbrite — How to create an event page attendees love](https://www.eventbrite.com/blog/how-to-create-an-event-page-that-attendees-love/)
- [Eventbrite — Event registration form template](https://www.eventbrite.com/blog/event-registration-form-template-ds00/)
- [Zapier — How to use Eventbrite (beginner's guide)](https://zapier.com/blog/how-to-use-eventbrite/)
- [Make — Eventbrite ↔ Google Maps integration](https://www.make.com/en/integrations/eventbrite/google-maps)
- [Google — Places Autocomplete API](https://developers.google.com/maps/documentation/places/web-service/place-autocomplete)
