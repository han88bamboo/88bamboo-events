# EVENTBRITE-SPECIFIC-PAGE-PARITY-PLAN.md — 88 Bamboo Events (single-event page IA)

> **Working document for the AI coding assistant** implementing the Eventbrite-parity **layout /
> information-architecture** upgrades to the **public single-event page** ([`EventDetail.js`](frontend/components/views/publicPages/EventDetail/EventDetail.js)).
> Companion to [`plan.md`](plan.md), [`eventbrite-parity-plan.md`](eventbrite-parity-plan.md) (the
> submission + detail-page *feature* plan this borrows its anatomy from), and the analysis doc
> [`eventbrite-specific-page-parity.md`](eventbrite-specific-page-parity.md) (the gap list this executes).
> Follow [`CLAUDE.md`](CLAUDE.md): surface every decision **before** writing code, make surgical
> changes, keep 88bamboo runnable after each step, verify layout at BOTH viewports before ticking a box.
>
> **Update the checklist + round log at the bottom after every working session** — mark items
> `[x]`/`[~]`, append discovered sub-tasks, record any new owner decisions.

Legend: `[ ]` todo · `[x]` done · `[~]` in progress/partial.

---

## 0. Scope & guardrails (READ FIRST)

**HARD GUARDRAIL — theme untouched.** Every item in this plan changes only **LAYOUT, POSITION, and
INFORMATION ORDERING / PRESENTATION**. No font, colour, button, border, or **icon-style** changes.
We borrow Eventbrite's *information architecture* (what shows, in what order, grouped how, positioned
where, how it reflows) while our look-and-feel stays **exactly** as it is. Every new element must be
built from **classes already in the repo** (Bootstrap grid/spacing utilities + the existing
`card`/`shadow-sm`/`badge-bamboo`/`article-title`/`bamboo-prose`/`bamboo-btn*` classes). If closing a
gap would require a theme change, it is **OUT OF SCOPE** and recorded in §7 "Excluded (theme changes)",
never silently adopted.

**In scope (this plan):** the public detail page's block order, a two-column desktop split with a
right-hand summary + CTA, promoting the now-existing organiser name and the multi-date schedule, a
"More events" related row, and "Read more" description truncation.

**Out of scope:** the submission form, the edit/admin surfaces, the backend, the schema, JSON-LD data
shape (SP-1 does not change what data is emitted, only where the *visible* facts sit). No new npm deps.

---

## 1. What we are building

| ID | Item | Phase | Notes |
|---|---|---|---|
| L1 | **Two-column desktop layout** — content (left) + a **summary/CTA panel** (right), mirroring the existing [`ManageEvent.js`](frontend/components/views/publicPages/ManageEvent/ManageEvent.js) grid recipe | SP-1 | Owner: two columns, right-hand summary — **but not a "rail"**; reuse the ManageEvent pattern neatly |
| L2 | **Summary/CTA panel** (presentational `EventSummaryCard`): schedule/When, Where, Organised by, Contact, + the "Visit event website" CTA | SP-1 | The "nicer than a basic `When:/Where:` form" treatment = an existing Bootstrap `card` |
| L3 | **Reorder the left column** — image above the title (Eventbrite-faithful), facts promoted into the summary panel; mobile reflows to one column with the panel inline | SP-1 | Pure source reorder; image keeps its 600px cap (banner = OUT OF SCOPE, §7) |
| L4 | **CTA in two places** — the "Visit event website" button in the summary panel **and** preserved at the bottom | SP-1 | Owner: include it in the facts block **and** keep the bottom one |
| P1 | **Paragraph spacing in the description** — split on newlines into `<p>` blocks so single returns render as neatly-spaced paragraphs (no double-return needed) | SP-1 | Owner request; pure spacing/markup, replaces the `pre-wrap` blob |
| R1 | **"More events" related row** — reuse `EventCard` before the edit-link footer | SP-2 | Needs a small SSR list passed into the page |
| T1 | **"Read more" description truncation** | SP-3 | `excerptOf` helper already exists in-repo |

Sequencing: **SP-1** is the big IA change (self-contained, presentational, no data/SSR change). **SP-2**
adds one SSR fetch + reuses an existing component. **SP-3** is a pure client-side collapse. **SP-4** is
the both-viewports regression gate before it's called done.

---

## 2. Reconciliation with the analysis doc (Step 0)

The analysis doc [`eventbrite-specific-page-parity.md`](eventbrite-specific-page-parity.md) was written
**2026-07-07**. **Two schema phases shipped to `main` on 2026-07-08 AFTER it** — EP-6 multi-date
(`0bb6d7a`) and EP-7 organiser (`70184d1`) — so parts of the doc are **stale**. Verified against the
current [`EventDetail.js`](frontend/components/views/publicPages/EventDetail/EventDetail.js),
`_PUBLIC_COLUMNS` ([`events.py:43`](backend/scripts/events.py:43)), and `globals.css`.

**Corrections (doc said → actually true now):**

1. **Organiser entity — doc says "we don't model it"; we now DO.** Doc §5 marks Organiser
   `N — needs an organiser entity we don't model`; §8 repeats "no organiser entity; today only
   `contact_email` renders." **Corrected:** EP-7 added a public, per-event, snapshotted
   `organiser_name` (in `_PUBLIC_COLUMNS`), rendered today as an **"Organised by" row buried in the
   `dl`** at [`EventDetail.js:117–124`](frontend/components/views/publicPages/EventDetail/EventDetail.js:117).
   → This flips from an excluded "new data" item to a **theme-neutral promote/reorder** (surface it
   near the title, as Eventbrite does) — item **L2/L3**.

2. **"Quick-facts / duration" — doc predates EP-6; it is partly built.** Doc §8 candidate #6 (surface
   duration/schedule) is superseded: the **"When" block already renders the full per-date schedule
   with an "N dates" heading** at [`EventDetail.js:91–108`](frontend/components/views/publicPages/EventDetail/EventDetail.js:91),
   and `occurrence_count` is a public scalar. What remains is only its **position** (still below the
   600px image) — handled by the reorder in **L3**.

3. **All `file:line` citations in the doc are shifted ~+8 lines** by the EP-6/EP-7 insertions
   (e.g. title `:62`→**`:70`**, `dl` `:82`→**`:90`**, description `:129`→**`:159`**, link button
   `:135`→**`:165`**, edit footer `:148`→**`:178`**, `where` string `:16`→**`:24`**). This plan uses
   the corrected numbers.

**Confirmed still accurate (doc holds):** single 760px centred `article-measure` column, no rail, no
sticky node ([`:58`](frontend/components/views/publicPages/EventDetail/EventDetail.js:58)); image capped
600px below the title ([`:79–88`](frontend/components/views/publicPages/EventDetail/EventDetail.js:79));
description renders **full, never truncated** ([`:159–163`](frontend/components/views/publicPages/EventDetail/EventDetail.js:159));
CTA is one **conditional inline** button at the bottom ([`:165–176`](frontend/components/views/publicPages/EventDetail/EventDetail.js:165));
**no related-events row**; **no price** by design; **FAQ still unmodelled**. `excerptOf`
([`EventListing.js:101`](frontend/components/views/publicPages/EventListing/EventListing.js:101)) and
`EventCard` ([`:110`](frontend/components/views/publicPages/EventListing/EventListing.js:110)) still
exist and are reusable.

---

## 3. Decisions (RESOLVED with owner, 2026-07-08)

- **SPP-D1 — Desktop frame = TWO columns, right-hand summary + CTA, NOT a "rail".** (owner) The whole
  page is **not** rebuilt as a conversion rail; instead we adopt a two-column split only for the detail
  body, reusing the **existing in-repo pattern** the owner flagged.
  - **Reuse target = [`ManageEvent.js`](frontend/components/views/publicPages/ManageEvent/ManageEvent.js)**
    (the submitter's manage page, which already runs a two-column "content + sticky messages column"
    layout when a listing has admin messages). **How it integrates neatly** — copy its exact,
    theme-neutral recipe:
    - A **container that widens only when the second column is present**: ManageEvent uses
      `<main className="container py-5" style={{ maxWidth: hasMessages ? 1140 : 820 }}>`
      ([`ManageEvent.js:263`](frontend/components/views/publicPages/ManageEvent/ManageEvent.js:263)).
      EventDetail today is a fixed 760px `article-measure`; SP-1 switches it to the same widened
      `container` (single-column events keep a narrow measure; the two-column layout uses the wider one).
    - `<div className="row g-4">` → `<div className="col-lg-8">` (content) + `<div className="col-lg-4
      d-none d-lg-block"><div className="position-sticky" style={{ top: '1rem' }}>…</div></div>`
      (summary), verbatim from [`ManageEvent.js:270–367`](frontend/components/views/publicPages/ManageEvent/ManageEvent.js:270).
    - The summary itself is an **existing Bootstrap `card shadow-sm`** with `card-header` + `card-body`
      ([`ManageEvent.js:113–119`](frontend/components/views/publicPages/ManageEvent/ManageEvent.js:113)) —
      **no new styling**, and it is exactly the "nicer than a bare `When:/Where:` form" treatment the
      owner asked for.
    - **Mobile reflow** copies ManageEvent's twice-rendered pattern: render the presentational
      `EventSummaryCard` **twice** — inline in the `col-lg-8` flow with `d-lg-none` (so on mobile it
      stacks right under the title/image), and in the `col-lg-4 d-none d-lg-block` sticky column for
      desktop — the same way ManageEvent renders `MessagesPanel` in both a desktop column and a mobile
      variant. It is presentational (no fetch), so rendering it twice is free.
- **SPP-D2 — Image before the facts, Eventbrite-faithful order.** (owner: "follow how Eventbrite does
  it… the image goes before the facts") → left-column order becomes **image → title → badges →
  (summary panel on mobile) → description → map → More events**. Image is promoted **above** the title
  to match Eventbrite. *This is a one-line reorder and trivially flippable to title-first if the owner
  prefers on review.* The image **keeps its 600px cap** — a full-bleed banner is a theme choice
  (§7 excluded).
- **SPP-D3 — The summary panel is "nicer than a basic form".** (owner) Achieved purely by the `card`
  treatment above + grouping (schedule, place, organiser, contact, CTA) — **not** by Eventbrite-style
  calendar/pin/person **icons**, which are an icon-style/theme change (§7 excluded; available to opt
  into later as a separate theme decision).
- **SPP-D4 — Primary CTA in TWO places.** (owner) The "Visit event website" button appears **in the
  summary panel** *and* is **preserved inline at the bottom**
  ([`EventDetail.js:165–176`](frontend/components/views/publicPages/EventDetail/EventDetail.js:165),
  styling unchanged). Both are conditional on `event.link`. **No sticky/fixed floating action bar**
  (owner chose in-panel + bottom, not a pinned bar).
- **SPP-D5 — Optional adds = "More events" row + "Read more" truncation IN; "Show map" tap-to-load
  OUT.** (owner) SP-2 + SP-3 below. "Show map" deferral was **not** selected → not built.
- **SPP-D6 — Legacy/empty-data safety (mirrors EP D-4/E-D2/F-D6).** Every promoted field is already
  optional in the data: `organiser_name`, `contact_email`, coords, and multi-date all render
  conditionally today and must keep doing so. An event with none of them collapses gracefully to
  title + image + description + (single) date, and the two-column layout must degrade to a sensible
  single column when the summary panel would be near-empty (see SP-1 checklist).

---

## 4. Ripple map (files each phase touches)

| Layer | File | SP-1 | SP-2 | SP-3 |
|---|---|:--:|:--:|:--:|
| Detail view | [`EventDetail.js`](frontend/components/views/publicPages/EventDetail/EventDetail.js) | **two-col shell + reorder + CTA** | render More-events row | wire truncation |
| NEW sub-component | `EventDetail/EventSummaryCard.js` (NEW, presentational) | **the summary/CTA card** | — | — |
| Reuse reference | [`ManageEvent.js`](frontend/components/views/publicPages/ManageEvent/ManageEvent.js) | pattern source (read-only) | — | — |
| SSR wrapper | [`pages/[slug].js`](frontend/pages/[slug].js) | — | **fetch a small related list → prop** | — |
| Events service | [`core/services/events.js`](frontend/core/services/events.js) | — | reuse `getListing` (no change) | — |
| Card reuse | [`EventListing.js`](frontend/components/views/publicPages/EventListing/EventListing.js) | — | **export `EventCard`** (currently module-private) | maybe export `excerptOf` |
| Layout CSS | [`styles/globals.css`](frontend/styles/globals.css) | only if a **layout-only** utility is missing (grid/spacing) — **no themed styles** | — | — |

**Watch-outs:**
- `EventCard` and `excerptOf` are **not exported** today ([`EventListing.js:101`](frontend/components/views/publicPages/EventListing/EventListing.js:101),
  [`:110`](frontend/components/views/publicPages/EventListing/EventListing.js:110)). SP-2/SP-3 need a
  surgical `export` (or a thin shared module) — do **not** duplicate the component.
- `EventCard` needs `slug, name, image_url, drink_categories, event_format, start_datetime,
  end_datetime, occurrence_count, venue_name, city, country, description` — **all already in
  `_PUBLIC_COLUMNS`**, so the SP-2 related list needs no backend change; `getListing` already returns them.
- EventDetail is wrapped by `Main` → `.main-content`; switching its `<main>` from `article-measure` to
  `container` must **not** double the horizontal padding or fight the layout's existing top padding.
- Keep `.article-title` / `.bamboo-prose` on the content column so **typography is byte-for-byte
  unchanged** — only the wrapper changes.

---

## 5. CHECKLIST

### Phase SP-0 — Decisions & reconciliation
- [x] **Step 0 reconciliation** against current code (§2): organiser + multi-date now exist; line
  citations corrected. *(this session, 2026-07-08)*
- [x] **Owner decisions locked** (§3, SPP-D1…D6): two-column reusing the ManageEvent pattern; image
  before facts; card (not icons); CTA in panel + bottom; More-events + Read-more IN, Show-map OUT.
  *(this session)*

### Phase SP-1 — Two-column layout + summary/CTA panel + reorder (L1–L4)
- [x] **Read the reuse pattern.** Re-read [`ManageEvent.js:262–374`](frontend/components/views/publicPages/ManageEvent/ManageEvent.js:262)
  to copy the container-widen + `row g-4` + `col-lg-8`/`col-lg-4 d-none d-lg-block position-sticky`
  recipe exactly. → verify: no new CSS class introduced. *(done — only Bootstrap + existing utilities used.)*
- [x] **Extract `EventSummaryCard`** (NEW presentational component) holding: the schedule/"When" block
  (moved from [`:91–108`](frontend/components/views/publicPages/EventDetail/EventDetail.js:91),
  including the multi-date "N dates" list + local-time note), "Where"
  ([`:110–115`](frontend/components/views/publicPages/EventDetail/EventDetail.js:110)), "Organised by"
  ([`:117–124`](frontend/components/views/publicPages/EventDetail/EventDetail.js:117)), "Contact"
  ([`:126–133`](frontend/components/views/publicPages/EventDetail/EventDetail.js:126)), and the
  "Visit event website" CTA. Wrapped in a Bootstrap `card shadow-sm`. → verify:
  `next build` clean; every field still renders only when present (SPP-D6). *(done — `EventSummaryCard.js`,
  card-body only, no header needed; each Fact is conditional.)*
- [x] **Two-column shell in `EventDetail`.** Swap `<main className="article-measure py-5">`
  ([`:58`](frontend/components/views/publicPages/EventDetail/EventDetail.js:58)) for the widened
  `container` + `row g-4`; content in `col-lg-8`, `<EventSummaryCard>` in the sticky `col-lg-4
  d-none d-lg-block`, **and** a second `<EventSummaryCard className="d-lg-none">` inline in the content
  column for mobile. → verify at **desktop ≥992px** (panel sits right, sticky) **and mobile <992px**
  (panel inline under title/image) via the preview tools. *(verified: desktop col-lg-8=760px left +
  card=356px sticky right; mobile inline card `flex`, desktop col `display:none`.)*
- [x] **Reorder the content column (SPP-D2):** image ([`:79–88`](frontend/components/views/publicPages/EventDetail/EventDetail.js:79))
  above the title ([`:70`](frontend/components/views/publicPages/EventDetail/EventDetail.js:70)); the
  `dl` block is gone (its rows now live in the card); order = image → title → badges → (mobile card) →
  map → description → bottom CTA → edit footer. → verify: image keeps `maxWidth:600`; no `dl` left behind.
  *(done — `dl` fully removed; back-link/past-alert stay full-width above the row, edit footer below it.)*
- [x] **CTA in both places (SPP-D4):** button in `EventSummaryCard` **and** the existing bottom button
  kept ([`:165–176`](frontend/components/views/publicPages/EventDetail/EventDetail.js:165)). → verify:
  with `event.link` set, both show; with it absent, neither shows. *(verified: both conditional on `event.link`.)*
- [x] **P1 — Description paragraph spacing.** Replace the single `pre-wrap` blob
  ([`:159–163`](frontend/components/views/publicPages/EventDetail/EventDetail.js:159)) with paragraphs:
  split `event.description` on `/\n+/`, trim, drop empties, render each as a `<p>` inside
  `bamboo-prose` so the default paragraph margin gives natural spacing — a **single** return now reads
  as a spaced paragraph (no double-return needed). → verify: multi-paragraph text shows even spacing;
  a one-paragraph description is unchanged; no stray trailing gap. *(verified: fixture with 3
  single-return lines → 3 `<p>`s with default paragraph rhythm; `toParagraphs` helper is pure/exported-scope.)*
  *(Interacts with T1/SP-3 — the truncation must operate on the same paragraph model.)*
- [x] **Graceful degradation (SPP-D6):** every Fact + both CTAs render only when their field is present,
  so a sparse event collapses cleanly. **Decision made during build:** because the schedule ("When")
  is *always* present, the summary panel is *never* empty — so the layout renders two columns
  unconditionally (fixed `maxWidth:1140`), and no `hasMessages`-style narrow/wide fallback is needed
  (unlike ManageEvent, whose second column is optional). Verified with the fixture.
- [x] `next build` clean; walked at **both viewports**; console clean (no errors). → ticked; round-log below.

### Phase SP-2 — "More events" related row (R1)
- [ ] **SSR list.** In [`pages/[slug].js`](frontend/pages/[slug].js) `getServerSideProps`, after the
  event resolves, call `eventsService.getListing({ … })` for a small set of **other** upcoming events
  (exclude the current `slug`, cap ~3–6), pass as a `related` prop. → verify: page still 404s correctly
  for unknown slugs; a fetch failure degrades to `related: []` (never breaks the page).
- [ ] **Export `EventCard`** from [`EventListing.js`](frontend/components/views/publicPages/EventListing/EventListing.js)
  (surgical `export`, no duplication) and render a "More events" row (reuse the grid `view`) in
  `EventDetail` **before** the edit-link footer
  ([`:178`](frontend/components/views/publicPages/EventDetail/EventDetail.js:178)). Hidden entirely when
  `related` is empty. → verify: cards link correctly (`/<slug>`), theme unchanged, both viewports.
- [ ] `next build` clean; walked at both viewports. → tick + round-log entry.

### Phase SP-3 — "Read more" description truncation (T1)
- [ ] **Collapse the description** ([`:159–163`](frontend/components/views/publicPages/EventDetail/EventDetail.js:159)):
  render a truncated view with a "Read more"/"Show less" toggle (client `useState`), reusing/adapting
  the existing `excerptOf` idea ([`EventListing.js:101`](frontend/components/views/publicPages/EventListing/EventListing.js:101))
  — export it or lift a shared helper rather than re-implementing. Only truncate above a sensible
  length; short descriptions render in full with no toggle. → verify: long + short fixtures; toggle
  works; SSR renders the truncated text (no hydration mismatch); both viewports.
- [ ] `next build` clean; walked at both viewports. → tick + round-log entry.

### Phase SP-4 — Regression / verification gate
- [ ] **Both viewports, real data:** desktop shows content-left + summary-right (sticky); mobile shows
  one column with the summary inline under the title/image; image-above-title; CTA in panel + bottom;
  More-events row present; description truncated with a working toggle.
- [ ] **Legacy / sparse events:** an event with no organiser, no coords (address-string map fallback
  intact), single date, no `link`, and a short description renders cleanly at both viewports.
- [ ] **No theme drift:** typography (`article-title`/`bamboo-prose`), colours, badges, and buttons are
  visually identical to `main`; diff introduces **no** new themed CSS. → verify by `preview_inspect` on
  title/prose/badge/button computed styles vs a pre-change capture.
- [ ] **No data/SEO change:** JSON-LD, `<Head>`, canonical, and the widget/listing feeds are untouched
  (SP-1/SP-3 change only visible placement; SP-2 adds a read but emits no new page data). → verify by
  code inspection + `next build`.

---

## 6. Blockers / questions for the owner
- **[RESOLVED 2026-07-08]** Desktop frame (SPP-D1): two columns, right-hand summary, **not a rail**,
  reusing the `ManageEvent` pattern.
- **[RESOLVED 2026-07-08]** Image order (SPP-D2): image before the facts, promoted above the title
  (Eventbrite-faithful); 600px cap kept.
- **[RESOLVED 2026-07-08]** Summary "nicer than a form" (SPP-D3): via the Bootstrap `card` grouping,
  **not** new icons (icons = §7 excluded, opt-in later).
- **[RESOLVED 2026-07-08]** CTA (SPP-D4): in the summary panel **and** kept at the bottom; no floating bar.
- **[RESOLVED 2026-07-08]** Optional adds (SPP-D5): More-events + Read-more IN; Show-map OUT.
- **[OPEN — owner, on review]** Image **above** vs **below** the title: this plan promotes it above
  (Eventbrite order) per "follow how Eventbrite does it," but it is a one-line flip if you'd rather keep
  our title-first article convention. Flag on the SP-1 walkthrough.
- **[OPEN — owner, optional later]** Eventbrite-style facts **icons** (calendar/pin/person): excluded as
  an icon-style/theme change; say the word if you want them and we'll treat it as a separate theme item.

---

## 7. Excluded (theme changes / no data) — recorded, NOT silently adopted
Per the §0 guardrail, these Eventbrite behaviours would drag in a theme change or need data we don't
model, so they are explicitly out of this plan:
- **Full-bleed banner hero** — our image keeps its 600px cap ([`:86`](frontend/components/views/publicPages/EventDetail/EventDetail.js:86)); removing the cap is a theme choice.
- **Facts iconography** (calendar/pin/person glyphs) — icon-style change (SPP-D3).
- **"POPULAR"-style status styling / new chip visuals** — our `badge-bamboo` row stays as-is.
- **FAQ accordion** — no FAQ field on the event object (new data, not a reorder).
- **Share / Save (heart) affordances** — need new state/backend.
- **"How do you want to get there?" travel-mode links** — a new affordance, not a reorder.
- **Sticky/fixed floating action bar** — owner chose in-panel + bottom CTA instead (SPP-D4).
- **Price** — no price field; listings are a billboard, not ticketing (by design).

---

## 8. Round log
_Append one entry per working session: date, phase touched, what shipped, decisions locked, verification, discoveries._

- **2026-07-08 — Plan created (plan-only, no code).** Ran Step 0 reconciliation: found the analysis doc
  (2026-07-07) predates EP-6 (`0bb6d7a`) + EP-7 (`70184d1`, both 2026-07-08), so its "no organiser
  entity" and "no duration/quick-facts" claims are **stale** — `organiser_name` and the multi-date
  schedule both exist and render today (just positioned low); all `file:line` citations shifted ~+8
  lines (§2). Collaborated with the owner on the four IA decisions (§3): **two-column layout reusing the
  in-repo [`ManageEvent.js`](frontend/components/views/publicPages/ManageEvent/ManageEvent.js) recipe
  (widened `container` + `row g-4` + `col-lg-8`/`col-lg-4 sticky`, all existing Bootstrap classes)** with
  a right-hand summary **card** (not a rail, not icons); **image promoted above the title**; **CTA in the
  panel AND at the bottom**; **More-events + Read-more IN, Show-map OUT**. Wrote the phased checklist
  (SP-1 shell/card/reorder → SP-2 related row → SP-3 truncation → SP-4 gate), ripple map, and the
  "Excluded (theme changes)" section. **No application code written this session.**
- **2026-07-08 — SP-1 shipped + P1 added.** Owner added **P1** (natural paragraph spacing in the
  description) to the plan; built it with SP-1. **Delivered:** NEW presentational
  [`EventSummaryCard.js`](frontend/components/views/publicPages/EventDetail/EventSummaryCard.js)
  (When/schedule · Where · Organised by · Contact · "Visit event website" CTA, in a Bootstrap
  `card shadow-sm` with muted-small labels — the "nicer than a bare `When:/Where:` form" treatment,
  **no new themed styles**). [`EventDetail.js`](frontend/components/views/publicPages/EventDetail/EventDetail.js)
  rebuilt to the **ManageEvent two-column recipe**: `container` (`maxWidth:1140`) + `row g-4` +
  `col-lg-8` content / `col-lg-4 d-none d-lg-block` `position-sticky` summary, with the card **rendered
  twice** (inline `d-lg-none` on mobile, sticky right on desktop) exactly like ManageEvent's
  `MessagesPanel`. **Reorder (SPP-D2):** image promoted above the title; the old `dl` removed (its rows
  now live in the card); order = image → title → badges → (mobile card) → map → description → bottom CTA.
  **Dual CTA (SPP-D4):** button in the card **and** kept inline at the bottom, both `event.link`-gated.
  **P1:** `toParagraphs()` splits the description on `/\n+/` → one `<p>` per fragment, so a single
  return renders as a spaced paragraph (dropped the `pre-wrap` blob). **CHOSEN/discovered:** since
  "When" is always present the summary is never empty → the layout is unconditionally two-column (no
  narrow/wide fallback needed, unlike ManageEvent's optional messages column). **Verified by me:**
  `next build` **clean**; walked at **both viewports** via the preview tools using a throwaway fixture
  page (since the real `/[slug]` route needs the backend — same boundary as prior rounds; temp page
  deleted after) — desktop shows content-left(760px) + sticky summary-right(356px), mobile stacks
  image→title→badges→inline card, 3 single-return lines → 3 paragraphs, CTA in both places, console
  clean. **No new deps, no backend/schema/data change, no themed CSS.** Owner-run: the live page on the
  docker+backend stack. **Next: SP-2** (More-events row). Not yet committed (awaiting owner go-ahead).
