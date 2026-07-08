# EVENTBRITE-SPECIFIC-PAGE-PARITY.md — single-event page information architecture

> **Pure-analysis pass (no code).** This document compares only the **layout, position, and
> presentation/ordering of information** between an Eventbrite event page and the equivalent
> 88bamboo event page. It is the whole output of this pass — no components were changed, no
> checklist updated.
>
> **Explicitly NOT in scope / NOT treated as differences:** fonts, type scale, colours,
> backgrounds, borders-as-styling, button styling, icon style, imagery style, brand voice/copy.
> The goal is to borrow Eventbrite's *information architecture* (what is shown, in what order,
> grouped how, positioned where, at what priority, and how it reflows) **without touching our
> theme**. Structure, not skin.
>
> **Every 88bamboo-side claim below is attributed to the exact source that produces it**
> (file:line), so nothing rests on screenshot impression. The Eventbrite side is described from live
> inspection (we don't have its source). Companion to [`plan.md`](plan.md) and
> [`eventbrite-parity-plan.md`](eventbrite-parity-plan.md). Feeds a later planning pass — it names
> gaps and cites where each lives; it does **not** design solutions or estimate effort.

---

## 1. Method

**Date of inspection:** 2026-07-07.

**Pages compared (both inspected live):**

| Side | URL | Notes |
|---|---|---|
| Eventbrite | `https://www.eventbrite.sg/e/the-new-roku-gin-noryo-tea-edition-pop-up-asias-smallest-tea-bar-tickets-1992801754693` | "Roku Gin Noryo Tea Edition Pop-up", a free multi-day drinks pop-up — a close content analogue to our listings. |
| 88bamboo | `https://www.88bamboo.co/a/events/tuak-sarawak-s-rice-wine-gets-three-days-in-kuching-malaysia-this-july-kuching` (**slug `tuak-sarawak-s-rice-wine-gets-three-days-in-kuching-malaysia-this-july-kuching`**, "Borneo Tuak Festival") | Chosen because it is **fully populated** — image, exact-pin map, long description, contact email, **and** a "Visit event website" link — so the comparison is apples-to-apples. |

The second live 88bamboo event (`sake-meguri-2026-singapore`) was also viewed; it is populated except it has **no** website link (so its [`EventDetail.js:135`](frontend/components/views/publicPages/EventDetail/EventDetail.js:135) `{event.link && …}` branch doesn't render), which is why the Tuak event was used as the representative page.

**Frontend source of truth read (this is what each gap is attributed to, not the screenshots):**
- [`EventDetail.js`](frontend/components/views/publicPages/EventDetail/EventDetail.js) — the entire visible detail body is this one component.
- [`pages/[slug].js`](frontend/pages/[slug].js) — the SSR wrapper: `<Head>` (title/meta/JSON-LD/canonical, not visible layout) + `WithLayout layout={Main} component={EventDetail}` ([`:76`](frontend/pages/[slug].js:76)).
- [`Main.js`](frontend/components/layouts/Main/Main.js) — the site frame: marquee → NavBar → ReviewsBar → `main-content` → FooterBar.
- [`publicFormat.js`](frontend/components/views/publicPages/publicFormat.js) — `formatDateRange` / `isPastEvent` (date presentation).
- [`EventListing.js`](frontend/components/views/publicPages/EventListing/EventListing.js) — the reusable `EventCard` ([`:110`](frontend/components/views/publicPages/EventListing/EventListing.js:110)) and the `excerptOf` truncation helper ([`:101`](frontend/components/views/publicPages/EventListing/EventListing.js:101)); relevant to the "More events" and "Read more" gaps.
- [`styles/globals.css`](frontend/styles/globals.css) — the tokens/classes that set the frame: `--page-width:1200px` / `--article-measure:760px` ([`:42`](frontend/styles/globals.css:42)), `.article-measure` centred column ([`:104`](frontend/styles/globals.css:104)), `.article-title` ([`:120`](frontend/styles/globals.css:120)), `.bamboo-prose` ([`:132`](frontend/styles/globals.css:132)), `.bamboo-navbar { position: sticky; top: 0 }` (the **only** sticky element), `.event-card*`, `.main-content` top padding.

**Viewports inspected:** desktop **~1280px** and mobile **~390px** (≈375 CSS px content), on both pages, scrolled top-to-bottom; on Eventbrite the collapsed states ("Read more", "Show map", the sticky card, the mobile bottom bar) were observed live.

**On screenshots:** inspection screenshots were captured live in this session (the Chrome tooling renders them into the conversation transcript rather than writing linkable image files to the repo), so there are no saved-file paths to link. They corroborate — but do not stand in for — the code citations above. *(Flagging honestly per CLAUDE.md rather than inventing file links.)*

---

## 2. Desktop layout skeleton (~1280px)

### Eventbrite
- Slim top nav bar (search, city, account) that scrolls away — not part of the event frame.
- **Two-column content frame**, centred, max-width:
  - **Left = content column** (~65%): everything descriptive.
  - **Right = a sticky conversion card** (~35%): price ("Free"), date range ("Jul 14–16"), primary CTA ("Reserve a spot"). It is `position: sticky` and **stays pinned through the entire scroll**, hero to footer. A **share** and a **save (heart)** icon sit just above it.
- **Hero/image:** full-content-width banner **above** the title (~16:6), spanning both columns, not full-bleed to the browser edge.
- **Above the fold:** hero, POPULAR badge, title, organiser, a **compact location line**, a **compact date/time line**, the "Overview" heading — **and** the sticky card (price + date + CTA).
- **Sticky/fixed:** only the right conversion card.

### 88bamboo (attributed to code)
- **Site frame** = [`Main.js`](frontend/components/layouts/Main/Main.js): `AnnouncementMarquee` ([`:12`](frontend/components/layouts/Main/Main.js:12)) → `NavBar` ([`:13`](frontend/components/layouts/Main/Main.js:13), **sticky** via `.bamboo-navbar{position:sticky;top:0;z-index:1030}` in globals.css) → `ReviewsBar` (yellow bar, [`:17`](frontend/components/layouts/Main/Main.js:17)) → `.main-content` ([`:18`](frontend/components/layouts/Main/Main.js:18)) → `FooterBar` ([`:21`](frontend/components/layouts/Main/Main.js:21)).
- **Single, narrow, centred article column — no second column, no rail, no sticky card.** The whole body is one flow: [`EventDetail.js:50`](frontend/components/views/publicPages/EventDetail/EventDetail.js:50) `<main className="article-measure py-5">`, and `.article-measure` = `max-width: 760px; margin: 0 auto` ([`globals.css:104`](frontend/styles/globals.css:104), token [`:43`](frontend/styles/globals.css:43)). There is no `aside`, no `sticky`, no grid anywhere in the component → the wide empty desktop margins and the absence of a rail are structural, from this single-column wrapper.
- **Hero/image:** rendered **below** the title, centred and **capped at 600px**: [`EventDetail.js:71–80`](frontend/components/views/publicPages/EventDetail/EventDetail.js:71) (`style={{ maxWidth: 600 }}`, `d-block mx-auto`). Deliberately not a banner (comment at `:72–73`).
- **Above the fold:** marquee, sticky nav, reviews bar, then (inside `main-content`, which adds `padding-top:35px`/`55px@≥750` — globals.css `.main-content` — plus `py-5` on the `<main>`) the "← All events" link ([`:51–53`](frontend/components/views/publicPages/EventDetail/EventDetail.js:51)), title ([`:62`](frontend/components/views/publicPages/EventDetail/EventDetail.js:62)), badges ([`:64–69`](frontend/components/views/publicPages/EventDetail/EventDetail.js:64)), and the top of the image. **Date, location, contact, map, and the only CTA are all below the fold** because they follow the image in source order (`dl` starts at [`:82`](frontend/components/views/publicPages/EventDetail/EventDetail.js:82)).
- **Sticky/fixed:** only the theme `NavBar` (`.bamboo-navbar`). **Nothing event-specific is pinned** — there is no `position: fixed`/`sticky` node inside `EventDetail.js`.

---

## 3. Mobile layout skeleton (~375–390px)

### Eventbrite
- Nav collapses to icons.
- **Single column**, same order as the desktop left column: hero → badge + share/save → title → organiser → compact location line → compact date line → Overview → ….
- **The right sticky card becomes a fixed STICKY BOTTOM BAR** (price + "Reserve a spot"), present from the first screen through the footer. This is the defining mobile reflow.
- Inside "Location", the address and the map thumbnail stay **side-by-side** even in the narrow column.

### 88bamboo (attributed to code)
- Nav collapses to a hamburger (`Main` → `NavBar`/`MobileNavDrawer`); reviews bar wraps; nav stays sticky.
- **Single column** — but note ours is *already* single-column at every width (§2), so there is **no reflow to speak of**: the same nodes stack. The only responsive behaviour in the body is the Bootstrap `dl` grid — `dt.col-sm-3` / `dd.col-sm-9` ([`EventDetail.js:83–99`](frontend/components/views/publicPages/EventDetail/EventDetail.js:83)) — which collapses label-over-value below the `sm` breakpoint. The map is `ratio ratio-16x9` full column width ([`:111`](frontend/components/views/publicPages/EventDetail/EventDetail.js:111)) at all sizes.
- **No sticky bottom bar, no persistent CTA.** There is no `position: fixed` element in the component; the only action is the inline "Visit event website" button at [`:135–146`](frontend/components/views/publicPages/EventDetail/EventDetail.js:135), which on mobile is reached only by scrolling past the whole description ([`:129–133`](frontend/components/views/publicPages/EventDetail/EventDetail.js:129)). There is **no price** anywhere — by design (listings billboard, not ticketing; [`plan.md`](plan.md) §1), so the event carries no price/registration field to surface.

---

## 4. Information architecture — order of blocks down the page

Two parallel ordered lists. The 88bamboo column cites the source line that emits each block.

| # | **Eventbrite** (left content column, live) | **88bamboo** (source line in [`EventDetail.js`](frontend/components/views/publicPages/EventDetail/EventDetail.js)) |
|--:|---|---|
| 1 | Hero **image** (full width, above title) | "← All events" back-link — [`:51–53`](frontend/components/views/publicPages/EventDetail/EventDetail.js:51) |
| 2 | "POPULAR" status badge | (optional "event is over" alert — [`:55–59`](frontend/components/views/publicPages/EventDetail/EventDetail.js:55)) |
| 3 | **Title** (h1) | **Title** `h1.article-title` — [`:62`](frontend/components/views/publicPages/EventDetail/EventDetail.js:62) |
| 4 | **Organiser** line (avatar · "by X" · followers · Follow) | Format + category **badges** — [`:64–69`](frontend/components/views/publicPages/EventDetail/EventDetail.js:64) |
| 5 | Compact **location** line (venue · city) | Featured **image** (capped 600px, centred) — [`:71–80`](frontend/components/views/publicPages/EventDetail/EventDetail.js:71) |
| 6 | Compact **date/time** line | **When** (`formatDateRange`) + "Local time…" note — [`:83–87`](frontend/components/views/publicPages/EventDetail/EventDetail.js:83) |
| 7 | **Overview** = description, **truncated** behind "Read more" | **Where** (venue, address, region, country — string built [`:16–24`](frontend/components/views/publicPages/EventDetail/EventDetail.js:16)) — [`:89–94`](frontend/components/views/publicPages/EventDetail/EventDetail.js:89) |
| 8 | **Good to know** — quick-facts chips (duration · age · format · doors) | **Contact** (email) — [`:96–103`](frontend/components/views/publicPages/EventDetail/EventDetail.js:96) |
| 9 | **Location** — venue, full address, "How do you want to get there?" (Driving/Transit/Biking/Walking) + map thumbnail + "Show map" | **Map** (`ratio 16x9` iframe) + "Get directions ↗" — [`:109–127`](frontend/components/views/publicPages/EventDetail/EventDetail.js:109) |
| 10 | **Frequently asked questions** (accordion) | **Description** (`bamboo-prose`, full, never truncated) — [`:129–133`](frontend/components/views/publicPages/EventDetail/EventDetail.js:129) |
| 11 | **Organized by** — organiser card (followers · hosting · Contact · Follow) + Report | **Visit event website** button (only if `event.link`) — [`:135–146`](frontend/components/views/publicPages/EventDetail/EventDetail.js:135) |
| 12 | **More events** — related-event cards | `hr` + "Are you the organiser? Request an edit link" — [`:148–155`](frontend/components/views/publicPages/EventDetail/EventDetail.js:148) |
| 13 | *(site footer)* | *(theme `FooterBar`)* |
| — | **Persistent right rail:** price + date + "Reserve a spot" (sticky) + share/save | *(none — no sticky/fixed node exists in the component)* |

**Sequencing gaps (each traceable above):**
- Eventbrite leads with the **image**, then front-loads **who/where/when as compact lines** before the body. Ours leads with **title** ([`:62`](frontend/components/views/publicPages/EventDetail/EventDetail.js:62)), then the **image** ([`:71`](frontend/components/views/publicPages/EventDetail/EventDetail.js:71)), then When/Where in the `dl` ([`:82`](frontend/components/views/publicPages/EventDetail/EventDetail.js:82)) — so facts sit *after* a 600px image.
- Eventbrite splits location into a top glance line **and** a full section; ours states it once in the `dl` ([`:89`](frontend/components/views/publicPages/EventDetail/EventDetail.js:89)) with the map right after ([`:109`](frontend/components/views/publicPages/EventDetail/EventDetail.js:109)).
- Eventbrite **truncates** the body; ours renders `event.description` in full ([`:129–133`](frontend/components/views/publicPages/EventDetail/EventDetail.js:129)) even though a truncation helper already exists in the codebase (`excerptOf`, [`EventListing.js:101`](frontend/components/views/publicPages/EventListing/EventListing.js:101)) — just not used here.
- Eventbrite keeps a standing price/CTA; ours has one **inline, conditional** button at [`:135`](frontend/components/views/publicPages/EventDetail/EventDetail.js:135).

---

## 5. Section-by-section delta table

`Theme-neutral? = Y` → adopting it is a pure structure/ordering/position change requiring no theme (font/colour/border/button) change. `N`/`OUT OF SCOPE` → adopting it as Eventbrite does would drag in theme **or** needs data we don't model (noted). The **88bamboo column names the exact source that owns each region**, so the planning pass knows precisely what to touch.

| Region | Eventbrite (layout/position/presentation) | 88bamboo (source that produces it) | Difference | Theme-neutral? |
|---|---|---|---|---|
| **Column frame** | Two columns + sticky right card | Single 760px centred column, no rail — [`EventDetail.js:50`](frontend/components/views/publicPages/EventDetail/EventDetail.js:50) `article-measure`; [`globals.css:104`](frontend/styles/globals.css:104) | We have no second column or aside at all | **Structure = Y** (adding a rail/sticky wrapper is layout). *A full 2-col redesign is large but still theme-neutral.* |
| **Hero image** | Full-width banner **above** title | Capped 600px, centred, **below** title — [`EventDetail.js:71–80`](frontend/components/views/publicPages/EventDetail/EventDetail.js:71) | Position + treatment | **Reorder = Y** (move `:71–80` above `:62`). *Banner treatment (`maxWidth:600` → full-bleed) = theme → OUT OF SCOPE.* |
| **Title** | Below image | Above image — [`:62`](frontend/components/views/publicPages/EventDetail/EventDetail.js:62) | Relative order vs image | **Y** |
| **Status/tags** | "POPULAR"; no category chips | Format + category badges — [`:64–69`](frontend/components/views/publicPages/EventDetail/EventDetail.js:64) | Different taxonomy; both chip rows | **Y** (ours is fine; no change needed) |
| **Date/time** | Compact line high up + echoed in card | Single `dl` "When" row below the image — [`:83–87`](frontend/components/views/publicPages/EventDetail/EventDetail.js:83) (`formatDateRange` [`publicFormat.js:32`](frontend/components/views/publicPages/publicFormat.js:32)) | EB surfaces earlier + redundantly | **Y** — reposition existing field |
| **Location (glance)** | One-line venue·city under the title | None as a glance line — folded into "Where" — [`:89–94`](frontend/components/views/publicPages/EventDetail/EventDetail.js:89) | EB gives an above-fold location | **Y** — reorder existing fields (`where` already built at [`:16–24`](frontend/components/views/publicPages/EventDetail/EventDetail.js:16)) |
| **Location (detail) + map** | Travel-mode links + map gated behind "Show map" | "Where" + a **map that renders immediately** + "Get directions" — [`:89–94`](frontend/components/views/publicPages/EventDetail/EventDetail.js:89), [`:109–127`](frontend/components/views/publicPages/EventDetail/EventDetail.js:109) | EB defers heavy map + adds travel modes; ours auto-loads | **Map position/lazy = Y** (the iframe is already `loading="lazy"`, [`:114`](frontend/components/views/publicPages/EventDetail/EventDetail.js:114)). *Travel-mode row = new affordance, not a reorder → optional.* |
| **Description** | "Overview", **truncated** ("Read more") | Full, always expanded — [`:129–133`](frontend/components/views/publicPages/EventDetail/EventDetail.js:129) | EB caps body height | **Y** — a truncation helper already exists (`excerptOf`, [`EventListing.js:101`](frontend/components/views/publicPages/EventListing/EventListing.js:101)); no theme change |
| **Good to know / Highlights** | Quick-facts chip strip (duration·age·format·doors) | None in the component | EB gives a scannable facts strip | **Partly Y:** duration (from `start`/`end`) + `event_format` ([`:65`](frontend/components/views/publicPages/EventDetail/EventDetail.js:65)) are data we have → chip strip = theme-neutral. *Age / "doors at" not modelled → OUT OF SCOPE.* |
| **FAQ** | Accordion of Q&A | None — no FAQ field on the event object | EB has structured FAQs | **N — new data field** (not theme, but beyond pure reorder). |
| **Organiser** | Prominent "Organized by" card (stats/Contact/Follow) | Only a "Contact" email row ([`:96–103`](frontend/components/views/publicPages/EventDetail/EventDetail.js:96)) + edit-link footer ([`:148–155`](frontend/components/views/publicPages/EventDetail/EventDetail.js:148)) | EB elevates organiser into a social card | **N — needs an organiser entity** we don't model. |
| **Price / CTA** | Sticky card (desktop) / sticky bottom bar (mobile): price + CTA, always visible | One inline "Visit event website" button near the bottom, conditional — [`:135–146`](frontend/components/views/publicPages/EventDetail/EventDetail.js:135); **no price field exists** | EB keeps the action permanently in reach; ours is buried + optional | **Y (structure)** — wrap/reposition the existing `:135` button as sticky; keep its `bamboo-btn--secondary` styling ([`:141`](frontend/components/views/publicPages/EventDetail/EventDetail.js:141)). |
| **Share / Save** | Share + save icons near top | None in the component | EB offers share/save | **N as a save-feature** (needs state/backend). A pure share link = new affordance → optional. |
| **Related events** | "More events" cards before footer | None on detail — but `EventCard` is reusable ([`EventListing.js:110`](frontend/components/views/publicPages/EventListing/EventListing.js:110)) | EB cross-links more events from the detail page | **Y** — reuse existing card + listing data; theme-neutral. |
| **Back / nav** | Global nav only | "← All events" at top — [`:51–53`](frontend/components/views/publicPages/EventDetail/EventDetail.js:51) | Ours already has a back-link | **Y** (no change needed; ours is arguably better) |

---

## 6. Above-the-fold priority

- **Eventbrite shows before any scroll:** image, title, organiser, a one-line **where**, a one-line **when**, and **price + primary CTA** (sticky card). Facts are front-loaded and compact; the long body is pushed down and truncated.
- **88bamboo shows before any scroll** — traceable to source order: marquee/nav/reviews-bar (theme frame, [`Main.js:12–17`](frontend/components/layouts/Main/Main.js:12)), then back-link ([`:51`](frontend/components/views/publicPages/EventDetail/EventDetail.js:51)), title ([`:62`](frontend/components/views/publicPages/EventDetail/EventDetail.js:62)), badges ([`:64`](frontend/components/views/publicPages/EventDetail/EventDetail.js:64)), and the top of the 600px image ([`:71`](frontend/components/views/publicPages/EventDetail/EventDetail.js:71)). Because When/Where/map/CTA all come **after** the image in the component ([`:82`](frontend/components/views/publicPages/EventDetail/EventDetail.js:82) onward), they sit below the fold.
- **Why ours differs:** `EventDetail.js` is authored as an **article** (back-link → title → hero → `dl` → prose → link), inheriting the storefront's editorial rhythm ([`Main.js`](frontend/components/layouts/Main/Main.js), `article-measure`/`article-title`/`bamboo-prose`), whereas Eventbrite is a **decision/conversion page** (facts + action first). The article ordering is the mechanism that demotes *when*/*where* and the CTA below the fold.

---

## 7. Responsive-behaviour differences (desktop ↔ mobile reflow)

| Behaviour | Eventbrite | 88bamboo (source) | Worth borrowing? |
|---|---|---|---|
| Primary CTA on mobile | Right card → fixed **bottom action bar** (always visible) | No persistent CTA; the inline button ([`EventDetail.js:135`](frontend/components/views/publicPages/EventDetail/EventDetail.js:135)) just stacks last | **Yes** — a sticky bottom "Visit event website" bar is the highest-value reflow to borrow, theme-neutral. |
| Two-column → one-column | Desktop 2-col collapses; card relocates to the bar | Already one column at every width ([`:50`](frontend/components/views/publicPages/EventDetail/EventDetail.js:50) `article-measure`) — nothing to collapse | N/A (we have no rail; the *idea* is the sticky bar above). |
| Location block | Address + map side-by-side on mobile | Address stacks above a full-width map (`ratio 16x9`, [`:111`](frontend/components/views/publicPages/EventDetail/EventDetail.js:111)) | Minor; ours is fine. |
| Section order across breakpoints | Identical (only the card relocates) | Identical — one flow, only the `dl` `col-sm-*` collapses ([`:83–99`](frontend/components/views/publicPages/EventDetail/EventDetail.js:83)) | Both stable; no reorder bug. |
| Progressive disclosure | "Read more"/"Show map" shorten mobile scroll | Everything expanded ([`:129`](frontend/components/views/publicPages/EventDetail/EventDetail.js:129) full body; map eager-mounts at [`:109`](frontend/components/views/publicPages/EventDetail/EventDetail.js:109)) | **Yes** — truncating the body shortens our mobile page and lifts the CTA. |

---

## 8. Candidate borrowable patterns (deduplicated; each cites the code that owns the gap)

Discrete structural/ordering gaps — **no solution design, no effort estimate** (that's the planning pass). Each names the exact line the planning pass would change.

1. **Front-load key facts above the description.** Move a compact **when** + **where** line under the title, before the body. *Owner:* the `dl` at [`EventDetail.js:82–104`](frontend/components/views/publicPages/EventDetail/EventDetail.js:82) currently sits **after** the image ([`:71`](frontend/components/views/publicPages/EventDetail/EventDetail.js:71)); `where` is already assembled at [`:16–24`](frontend/components/views/publicPages/EventDetail/EventDetail.js:16). *(Theme-neutral — reorder.)*
2. **Put the primary action in permanent reach.** Give the existing "Visit event website" button ([`:135–146`](frontend/components/views/publicPages/EventDetail/EventDetail.js:135), styled `bamboo-btn--secondary` [`:141`](frontend/components/views/publicPages/EventDetail/EventDetail.js:141)) a persistent position — sticky on desktop, fixed bottom bar on mobile — instead of only inline at the end. *(Theme-neutral; keep its styling. Applies only when `event.link` exists.)*
3. **Raise date/time above the fold.** Ensure "When" ([`:83–87`](frontend/components/views/publicPages/EventDetail/EventDetail.js:83)) is visible without scrolling past the 600px image ([`:78`](frontend/components/views/publicPages/EventDetail/EventDetail.js:78)). *(Theme-neutral — ordering.)*
4. **Consider image-above-title ordering.** Optionally move [`:71–80`](frontend/components/views/publicPages/EventDetail/EventDetail.js:71) above the title [`:62`](frontend/components/views/publicPages/EventDetail/EventDetail.js:62). *(Ordering = theme-neutral; do NOT adopt the full-bleed banner — the `maxWidth:600` cap at [`:78`](frontend/components/views/publicPages/EventDetail/EventDetail.js:78) is a theme choice → OUT OF SCOPE.)*
5. **Truncate long descriptions with "Read more".** The body at [`:129–133`](frontend/components/views/publicPages/EventDetail/EventDetail.js:129) always renders in full; a truncation helper already exists in-repo (`excerptOf`, [`EventListing.js:101`](frontend/components/views/publicPages/EventListing/EventListing.js:101)) and could inform a collapse. *(Theme-neutral interaction/layout.)*
6. **A compact "quick facts" chip strip** (duration derived from `start_datetime`/`end_datetime`; plus `event_format` already at [`:65`](frontend/components/views/publicPages/EventDetail/EventDetail.js:65)) between the facts and the body. *(Theme-neutral for data we have; age/"doors at" are unmodelled → leave out.)*
7. **Defer/lazy the map on mobile.** The map iframe eager-mounts at [`:109–127`](frontend/components/views/publicPages/EventDetail/EventDetail.js:109) (already `loading="lazy"` at [`:114`](frontend/components/views/publicPages/EventDetail/EventDetail.js:114), but always in the DOM); a "Show map" tap-to-load would shorten the page and drop a first-paint third-party embed. *(Theme-neutral — position/disclosure.)*
8. **A "More events" related row on the detail page**, reusing `EventCard` ([`EventListing.js:110–182`](frontend/components/views/publicPages/EventListing/EventListing.js:110)) before the edit-link footer ([`EventDetail.js:148`](frontend/components/views/publicPages/EventDetail/EventDetail.js:148)). *(Theme-neutral — reuse of existing component/data.)*

**Named but NOT theme-neutral / beyond pure reorder (record only, for the planning pass to triage):**
- **FAQ accordion** — no Q&A field on the event object → new data.
- **Organiser card** (follow/stats/contact) — no organiser entity; today only `contact_email` renders ([`:96–103`](frontend/components/views/publicPages/EventDetail/EventDetail.js:96)).
- **"How do you want to get there?" travel-mode links** and **share/save affordances** — new features, not reorderings of existing information.

---

*End of analysis. No application code was written or changed in this pass; no checklist was updated. Every 88bamboo-side gap above is anchored to a specific file:line rather than to a screenshot.*
