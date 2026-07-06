# STYLE-PARITY-PLAN.md — Making `/a/events` look like 88bamboo.co

> **Status: audit + proposal only. No code has been changed. Do not implement until Han approves the "Owner Decisions Required" section.**
>
> Goal: make the 88 Bamboo Events frontend (a separate Next.js app served at `www.88bamboo.co/a/events` — actually the **naked apex** `88bamboo.co/a/events`, per plan §9 Option B — through Shopify App Proxy) feel visually seamless with the main Shopify-hosted `88bamboo.co` storefront.
>
> Sources read before writing this: `plan.md`, `PATTERN-SPEC.md`, and `frontend/88BAMBOO-SHOPIFY-STYLE-REFERENCE.md`. This is a **visual translation**, not a Liquid/theme port. No Shopify Liquid, sections, app code, checkout/customer JS, or theme JavaScript is copied into this app.

---

## 0. TL;DR of the gap

The Events app currently wears **Drink-X's brand skin**, not 88 Bamboo's storefront skin:

| Dimension | Current Events app | 88bamboo.co storefront (target) |
|---|---|---|
| Heading font | **Sora** (sans-serif, loaded in `_document.js`) | **Buenard**, serif, weight **400** |
| Body font | `Helvetica Neue`/Arial **sans-serif** (`globals.css`) | generic **serif** stack (Georgia/Times) |
| Primary green | `#0B4321` (Drink-X `custom-green`) | `#004f2d` buttons / `#0b4321` only for the header bar |
| Accent | `#DD9E54` orange (Drink-X) | `#fcc200` yellow strip + `#03652a`/`#1a6132` greens; **no orange** |
| Text colour | Bootstrap default `#212529` | `#3d4246` slate (UI) / `#000` (article body) |
| Buttons | stock Bootstrap `btn-success` (blue-green, sans, no tracking) | `.btn`: `#004f2d` bg, **cream `#f2f0e3`** text, Buenard, **UPPERCASE**, `letter-spacing:.08em`, radius **2px** |
| Navbar | placeholder — brand text only, no logo, no nav, no bars | logo-left 70px + inline nav + **"Just In" marquee** + **yellow reviews bar** |
| Footer | dark-green centered mini-footer | light `#f5f5f5` footer, quick-links + newsletter columns, social + copyright |
| Container | Bootstrap default `.container` (max 1140/1320) | `.page-width` **1200px**; article measure **~720–780px** |
| Cards | stock Bootstrap card, `shadow-sm`, fixed 180px crop | editorial blog card: native-ratio image, Buenard title, muted date, excerpt, `.btn--tertiary` "Read more" |
| Detail page width | `maxWidth: 860` | article-like **~740–780px** content measure |

Everything else (SSR, canonical tags, JSON-LD, sitemap, App Proxy, basePath, admin cookies, payment) is **untouched** by this work — it is purely presentational (CSS + markup class changes + font swap).

---

## Decisions Locked (owner, 2026-07-06)

The nine "Owner Decisions Required" (at the bottom of this doc) are resolved as follows:

- **Decision 1 — Navbar: FULL store-menu replica + an added "Events" button.** (Owner override of the recommendation.) The live `88bamboo.co` top menu was captured verbatim (Home, About Us, Editorial, Reviews, Cocktails, Community, Be A Guest Writer!, Bookmarks — with every dropdown item and href) and is reproduced in a shared `menuData.js`. All store links are **absolute** to `https://88bamboo.co`; a highlighted **Events** button (brand-styled) links to the events listing (`/`, i.e. `/a/events`).
- **Decision 7 — Footer: EXACT storefront replica, but the newsletter is NOT live.** (Owner override.) Light `#f5f5f5` two-block footer (Quick links + Newsletter) matching the store, `<hr>`, then social icons + `© {year}, 88 Bamboo`. The newsletter block is presentational (Subscribe links out to the store rather than posting). Non-functional Shopify checkout widgets (currency/locale/payment selectors) are omitted — replicating broken selectors would be *less* faithful than leaving them out.
- **Decisions 2, 3, 4, 5, 6, 8, 9 — per the recommendations:** left-aligned Buenard detail title; global brand tokens app-wide; new `.bamboo-btn` class (no Bootstrap `.btn` override); article-card shell + light event badges; admin gets brand tokens + keeps utility layout; homepage widget deferred; static "Just In" strip (no Shopify blog fetch).

**Assets captured from the live store (2026-07-06):** logo `https://88bamboo.co/cdn/shop/files/88B_New_Logo_-_white_face_transparent_background_300x300.png` (loaded via plain `<img>` so `next.config` `remotePatterns` is untouched); the yellow reviews-bar links (Whisky/Rum/Sake/Wine/Beer/Mezcal/Gin/Everything-else via the store's `tinyurl` review shortlinks); Facebook/Instagram/TikTok socials.

---

## Implementation Task Checklist (update as work lands)

Legend: `[ ]` todo · `[x]` done · `[~]` partial.

**Foundation**
- [x] `menuData.js` — shared store menu + reviews-bar links + socials + logo/origin constants.
- [x] `_document.js` — swap Sora → Buenard (Google Fonts).
- [x] `globals.css` — `:root` brand tokens, base type (serif body, Buenard 400 headings, h6, links), `.bamboo-btn` family, `.page-width`/`.article-measure`/`.main-content`, form-control polish, reviews/marquee bar + nav dropdown + `.event-card` styles, mobile input 16px.
- [x] `tailwind.config.mjs` — replace Drink-X palette with `bamboo-*` tokens + Buenard/serif families.
- [x] Global class swaps: `tw-text-custom-green`→`tw-text-bamboo-slate` (16), `'Sora, sans-serif'`→Buenard stack (17), `btn-success`→`bamboo-btn` (22), `btn-outline-success`→`bamboo-btn bamboo-btn--secondary` (8).

**Chrome**
- [x] `NavBar.js` — full store-menu replica (logo-left, inline nav + dropdowns) + Events button.
- [x] `AnnouncementMarquee.js` — static "Just In" brand strip.
- [x] `ReviewsBar.js` — yellow reviews strip with store review links.
- [x] `MobileNavDrawer.js` — full-width drop-down mobile menu with the store's
  multi-level drill-down (Round 4; was an off-canvas accordion).
- [x] `Main.js` — stack: marquee → nav → reviews bar → `main-content` → footer.
- [x] `FooterBar.js` — exact storefront footer replica (non-live newsletter).

**Public views**
- [x] `EventListing.js` — `.page-width`, editorial `EventCard` (native-ratio image, Buenard title, muted date, excerpt, tertiary CTA), rebranded list/calendar + view toggles.
- [x] `EventDetail.js` — `.article-measure` (~760px), left-aligned Buenard ~32px title, centered featured image, rebranded badges/CTA.
- [x] `SubmitEvent.js` + `CheckoutStep.js` — headings/buttons/form polish (structure unchanged).
- [x] Secondary public views (`ManageEvent`, `EditEvent`, `MyEvents`, `Conversation`, `pages/manage.js`, `pages/account.js`) — font/button rebrand pass.

**Admin (light)**
- [x] Admin views inherit brand tokens; `AdminLogin` + panels button/font rebrand; utility layout kept.

**Verify**
- [x] `next build` (or lint) passes; no leftover `Sora`/`custom-green`/`btn-success` references.
- [ ] Owner visual QA through the live App Proxy (logo path, store links, mobile drawer). *(owner step)*

---

## 1. Current Events frontend files that control layout & styling

**Global styling / config**
- `frontend/pages/_document.js` — loads the **Sora** Google font (to be replaced with Buenard + serif).
- `frontend/pages/_app.js` — global CSS import order (Bootstrap → `globals.css` → toastify). Bootstrap JS bundle loaded client-side.
- `frontend/styles/globals.css` — near-empty; sets sans-serif `body` font + white bg. **This is where brand tokens + base overrides will live.**
- `frontend/tailwind.config.mjs` — `tw-`-prefixed, `important:true`; carries the Drink-X palette (`custom-green #0B4321`, `custom-orange #DD9E54`, etc.).
- `frontend/postcss.config.js` — Tailwind/autoprefixer pipeline (no change expected).
- `frontend/next.config.mjs` — `basePath`, `skipTrailingSlashRedirect`, image `remotePatterns`. **Do not touch** (App-Proxy-critical).

**Layout chrome**
- `frontend/components/layouts/Main/Main.js` — nav + content + footer wrapper.
- `frontend/components/layouts/Main/components/NavBar.js` — placeholder navbar (brand text only).
- `frontend/components/layouts/Main/components/FooterBar.js` — dark-green mini footer.
- `frontend/components/layouts/Main/index.js`, `.../layouts/index.js` — barrel exports.
- `frontend/components/WithLayout.js` — HOC that wraps a view in a layout. (No visual change.)

**Public views (the pages users + Google see)**
- `frontend/components/views/publicPages/EventListing/EventListing.js` — listing page: search, filters, grid/list/calendar, cards.
- `frontend/components/views/publicPages/EventDetail/EventDetail.js` — single-event page (`maxWidth:860`).
- `frontend/components/views/publicPages/publicFormat.js` — date/`isPastEvent` helpers (logic only; no visual change).
- `frontend/components/views/publicPages/EditEvent/…`, `ManageEvent/…`, `MyEvents/…`, `Conversation/…` — magic-link edit + manage flows (secondary public surfaces).
- `frontend/pages/index.js`, `pages/[slug].js`, `pages/submit.js`, `pages/manage.js`, `pages/edit.js`, `pages/account.js`, `pages/my-events/*` — thin page wrappers (SSR + `<Head>`). **SEO/`<Head>` blocks stay as-is.**

**Submission form**
- `frontend/components/views/landingPages/SubmitEvent/SubmitEvent.js` — the submit form.
- `frontend/components/views/landingPages/SubmitEvent/CheckoutStep.js` — Stripe Elements step (**payment UI — visual-only tweaks, no logic touch**).

**Admin (events origin, not proxied)**
- `frontend/components/views/admin/AdminDashboard/AdminDashboard.js` — tabbed shell.
- `frontend/components/views/admin/{ReviewQueue,LiveListings,Inbox,PricingTiers,Analytics,AdminLogin,AdminEditModal,ConversationPanel}/…`, `adminFormat.js` — dashboard panels.
- `frontend/pages/admin/index.js`, `pages/admin/login.js` — admin pages.

**Homepage widget (NOT part of Next routing)**
- `frontend/public/widget/events-widget.js` — standalone JS the owner pastes into the Shopify theme. Already has its own inline card styles. **Out of scope for the app-CSS work**, but see Decision 8.

---

## 2. Gaps between current Events UI and the Shopify reference

1. **Fonts (biggest single gap).** Sora + Helvetica are wrong on both counts. Target is Buenard (serif, 400) headings and a serif body stack. The whole storefront is serif; the events app is entirely sans-serif.
2. **Colour system.** The Drink-X `#0B4321`/`#DD9E54` palette must give way to the storefront tokens (§1 of the reference): `#004f2d` buttons, cream button text, `#3d4246` UI text, `#000` body copy, `#fcc200` yellow strip, `#f5f5f5` footer, `#1a6132`/`#03652a` green accents. **No orange anywhere** in the target.
3. **Buttons.** Stock `btn-success` (Bootstrap teal-green, sans, rounded 6px) vs the storefront `.btn` (dark green, cream label, Buenard, uppercase, `.08em` tracking, 2px radius, brighter-green `#009c59` hover). Every CTA in the app uses `btn-success`/`btn-outline-success`.
4. **Navbar.** No logo, no nav links, no "Just In" marquee, no yellow reviews bar. The storefront's identity lives almost entirely in these top bars, so the app currently reads as a different site.
5. **Footer.** Dark-green centered strip vs the light `#f5f5f5` two-column (quick links + newsletter) footer with social icons + copyright.
6. **Container widths / vertical rhythm.** Bootstrap defaults vs `.page-width` 1200px and the 55px/35px section rhythm; `.main-content` top padding 55/35.
7. **Detail-page measure.** `maxWidth:860` is wider than the storefront's article measure (~720–780px) and lacks the Buenard ~32px centered title treatment.
8. **Cards.** Bootstrap card with hard 180px image crop + `shadow-sm` vs the editorial blog card (native-ratio image, Buenard 22px title, small muted date, excerpt, outlined tertiary "Read more"). This is the single biggest "editorial feel" lever.
9. **Links.** Default Bootstrap link blue vs `#3d4246` un-underlined links, green accent in prose.
10. **Form controls.** Input borders `#949494`, 2px radius, 16px on mobile (iOS no-zoom) — currently Bootstrap defaults.
11. **Headings weight.** Buenard is **400** — headings must **not** be bold. Current Bootstrap headings are 500+.

---

## 3. Exact files proposed to edit

**Global (do first — everything inherits):**
- `frontend/pages/_document.js` — swap Sora font `<link>` for **Buenard** (Google Fonts).
- `frontend/styles/globals.css` — add the brand token block (`:root` custom properties), base `body`/heading/link/`.btn`/form overrides, the `.page-width`/article-measure utilities, and the reviews/announcement bar styles. **This file carries ~90% of the parity work.**
- `frontend/tailwind.config.mjs` — replace the Drink-X palette with storefront tokens (`bamboo-green`, `bamboo-green-hi`, `bamboo-slate`, `bamboo-cream`, `bamboo-yellow`, `bamboo-footer`, …) and Buenard/serif font families, so `tw-` utilities and any `tw-text-custom-green` references resolve to brand values.

**Layout chrome:**
- `frontend/components/layouts/Main/components/NavBar.js` — rebuild as logo-left + inline nav + bars (see §6).
- `frontend/components/layouts/Main/components/FooterBar.js` — rebuild as the light two-column footer (see §6).
- `frontend/components/layouts/Main/Main.js` — add the top bars (marquee + reviews bar) above the nav and the `.main-content` padding wrapper, matching the storefront stack order.

**Public views:**
- `frontend/components/views/publicPages/EventListing/EventListing.js` — container width, heading font, button classes, and the card redesign (`EventCard`). Calendar/list keep their structure; only classes/tokens change.
- `frontend/components/views/publicPages/EventDetail/EventDetail.js` — article-like measure, Buenard title, button/badge classes.
- `frontend/components/views/landingPages/SubmitEvent/SubmitEvent.js` — heading font + button classes + form-control polish (structure unchanged).
- `frontend/components/views/landingPages/SubmitEvent/CheckoutStep.js` — button classes only (no payment logic).

**Secondary public views (light pass for consistency):**
- `ManageEvent/`, `EditEvent/`, `MyEvents/`, `Conversation/` views — swap `btn-success`→brand `.btn`, heading fonts; no structural change.

**Admin (lighter pass — see Decision 6):**
- `AdminLogin`, `AdminDashboard`, and panels — brand tokens/buttons/fonts inherited from globals; keep the utility/dashboard layout.

**Explicitly NOT edited:** `next.config.mjs`, `core/utils/seo.js`, `pages/sitemap.xml.js`, `core/utils/shopifyProxy.js`, `core/services/*`, `core/config/api.js`, all `<Head>`/`getServerSideProps` SEO blocks, `public/widget/events-widget.js`.

---

## 4. Components to create or replace

**Create (new, small, presentational only):**
- `components/layouts/Main/components/AnnouncementMarquee.js` — the "Just In 👉 …" marquee bar. In the storefront it shows the latest `news` article title; here it becomes a **static branded strip** or an events tagline (see Decision 9 — we do **not** fetch the Shopify blog).
- `components/layouts/Main/components/ReviewsBar.js` — the yellow `#fcc200` strip with review-category links pointing to `88bamboo.co` review pages (absolute URLs to the main store).
- `components/layouts/Main/components/MobileNavDrawer.js` — off-canvas hamburger drawer (Bootstrap offcanvas or a small custom slide-in) reproducing the storefront's mobile nav behaviour without porting `theme.js`.
- (Optional) `components/common/BrandButton.js` — thin wrapper emitting the storefront `.btn` classes, if we prefer a component over raw classes. **Recommended: use CSS classes, skip the wrapper** (fewer moving parts).

**Replace (in place, not new files):**
- `NavBar.js` and `FooterBar.js` — rewritten bodies (same file paths, same exports).
- `EventCard` (inner component inside `EventListing.js`) — restyled to the editorial blog card.

No new **routes**, no new pages, no new services. Every new file is a layout partial.

---

## 5. CSS / token changes (fonts, colours, spacing, containers, buttons, links, cards)

Proposed token block for `globals.css` `:root` (mirrors reference §1, Drink-X names dropped):

```css
:root {
  /* colours */
  --bamboo-bg:            #ffffff;
  --bamboo-text:          #3d4246;  /* UI / nav / headings */
  --bamboo-body-text:     #000000;  /* article/RTE body */
  --bamboo-green:         #004f2d;  /* primary button bg */
  --bamboo-green-hi:      #009c59;  /* button hover */
  --bamboo-green-header:  #0b4321;  /* announcement bar bg */
  --bamboo-green-link:    #1a6132;  /* prose link accent */
  --bamboo-green-h6:      #03652a;
  --bamboo-button-text:   #f2f0e3;  /* cream */
  --bamboo-yellow:        #fcc200;  /* reviews bar */
  --bamboo-border:        #e8e9eb;
  --bamboo-border-form:   #949494;
  --bamboo-footer-bg:     #f5f5f5;
  --bamboo-footer-text:   #3d4246;
  /* type */
  --font-heading: "Buenard", Georgia, "Times New Roman", serif; /* weight 400 */
  --font-body:    Georgia, "Times New Roman", serif;
  /* layout */
  --page-width: 1200px;
  --article-measure: 760px;   /* detail-page readable column */
  --radius: 2px;
  --section-spacing: 55px;
  --section-spacing-sm: 35px;
}
```

- **Fonts:** `body { font-family: var(--font-body); color: var(--bamboo-body-text); }`; `h1–h6, .btn, nav { font-family: var(--font-heading); font-weight: 400; }`. h6 special-cased to serif **700** `#03652a` (reference §2/§3). Detail-title rule: `~32px` desktop / `~26px` mobile, centered, Buenard 400.
- **Buttons:** define a storefront-accurate `.btn` override (green bg, cream text, uppercase, `letter-spacing:.08em`, `font-size:14px`, `radius:2px`, `padding:10px 18px` desktop / `8px 15px` mobile, hover `#009c59`) plus `.btn--secondary` (transparent, green text/border), `.btn--tertiary` (transparent, slate text/border — card "Read more"), `.btn--small`. **Because Bootstrap is imported globally and `!important` is only on Tailwind**, the safest route is a **dedicated `.bamboo-btn` class** rather than overriding Bootstrap's `.btn` (avoids specificity fights across every Bootstrap component that reuses `.btn`). See Decision 4.
- **Links:** `a { color: var(--bamboo-text); text-decoration: none; }`, hover ≈ `#2d3134`; `.rte a`/prose links inherit body text with the green underline accent.
- **Containers:** a `.page-width { max-width:1200px; margin:0 auto; padding:0 22px; }` (desktop gutter widens to 55px via a media query) and `.article-measure { max-width:760px; margin:0 auto; }`. Listing uses `.page-width`; detail uses `.article-measure`.
- **Cards:** `.event-card` — native-ratio image via `padding-top` wrapper (no forced 180px crop), Buenard 22px title, `.article__date`-style small muted date, excerpt clamp, `.bamboo-btn--tertiary` "Read more". 3-up on desktop (`medium-up--one-third` ≈ Bootstrap `col-lg-4`), stacked on mobile.
- **Form controls:** inputs get `border:1px solid var(--bamboo-border-form)`, `radius:2px`, `font-size:16px` on mobile.
- **Spacing:** `.main-content { padding-top:35px; }` → `55px` at ≥750px; section rhythm via the tokens.

---

## 6. Navbar & footer handling

**Navbar** (rebuild `NavBar.js` + add bars in `Main.js`):
- **Logo left**, `max-width:70px`, transparent PNG. We host the 88 Bamboo logo as a static asset under `frontend/public/` (served at `/a/events/...` through the proxy). Links to `88bamboo.co` (store home) — **absolute URL**, since the store home is not part of this Next app.
- **Inline nav links** in Buenard, colour `#3d4246`, pointing to the main store's top-level sections (**absolute URLs to `88bamboo.co`**) plus the events-native links ("List an event" → `/submit`, "All events" → `/`). Exact link set is a **Decision** (see Decision 1).
- **"Just In" marquee** + **yellow reviews bar** rendered above the nav (see §4). Reviews-bar links point to the store's review pages (absolute).
- **Mobile:** hamburger → off-canvas drawer.

**Footer** (rebuild `FooterBar.js`):
- Light `#f5f5f5` bg, `#3d4246` text, `.page-width` inner.
- Two columns: **Quick links** (events-native: List an event, All events, Manage your listing, plus store links) and **Newsletter** (see Decision 7 — a real Shopify newsletter needs the store's form action; we likely link out or show a simplified block).
- `<hr>` divider, then a bottom row: social icons (Facebook, Instagram, TikTok — absolute links to the store's socials), and `© {year}, 88 Bamboo`.
- **No currency/locale/payment selectors** (Shopify-specific; not applicable here — reference §8 lists them but they're store-checkout features).

---

## 7. Article-like sizing on event detail pages

- Wrap the detail content in `.article-measure` (~760px) instead of `maxWidth:860`.
- Title: `<h1>` styled like `.article__title` — Buenard 400, **~32px desktop / ~26px mobile, centered** (reference §3). (Left-aligned is an alternative — see Decision 2.)
- Body: serif `#000`, paragraph bottom margin ~19px, `line-height:1.5`, `white-space:pre-wrap` retained for organiser text.
- Featured image: `max-width:600px; margin:0 auto; object-fit:cover` (reference §12) rather than the current full-width 420px cap.
- Meta (`When`/`Where`/`Contact`) stays as a definition list but restyled with slate labels; the "Visit event website" CTA becomes `.bamboo-btn--secondary`.
- The badges (format + categories) keep their position but recolour to the green-subtle / slate scheme.

---

## 8. Event listing cards → editorial feel

- **Image on top**, native aspect ratio preserved (`padding-top` percentage wrapper), lazy-loaded, no hard crop.
- **Title** in Buenard 22px (`h3.article__title` equivalent), linked.
- **Small muted date** (`formatDateRange`) in the `.article__date` style, plus venue/city line.
- **Short excerpt** — first ~150 chars of `description` (add a truncation helper in the view; falls back to the location line when empty).
- **`.bamboo-btn--tertiary btn--small` "View event"** pill at the bottom.
- Format/category badges recoloured to green-subtle + slate, kept minimal (they're a practical events affordance the storefront blog cards don't have — see Decision 5).
- Grid: 3-up desktop, stacked mobile, `55px`/`22px` gutters.
- **List view + calendar view keep their current structure** (they're events-specific utility affordances, not storefront analogues); only fonts/colours/badges are rebranded.

---

## 9. Mobile / responsive changes

- Breakpoints follow the reference: mobile ≤749px, `medium-up` ≥750px. We map these onto Bootstrap's grid (`sm`/`md`/`lg`) already in use — no new breakpoint system.
- **Inputs `font-size:16px` on mobile** (prevents iOS auto-zoom).
- **Mobile nav** = off-canvas drawer with a hamburger↔X toggle; nested links collapse. Exact animation is not styling-critical (reference §7).
- Cards stack full-width on mobile; the reviews/marquee bars wrap/scroll gracefully.
- Detail title falls back to ~26px on mobile; article measure becomes full-width-minus-gutter.
- `.main-content` top padding 35px mobile / 55px desktop.

---

## 10. Risks (App Proxy, basePath, SSR, SEO, admin cookies)

| Risk | Likelihood | Mitigation |
|---|---|---|
| **Font swap causes CLS / FOUT** on SSR pages Google crawls | Low | Use `display=swap`, `preconnect` (already present), keep serif system fallback in the stack so unstyled state already looks near-final. No layout dependence on Buenard metrics. |
| **New `<link>`/asset paths break under basePath/App Proxy** (a `/`-absolute asset would resolve to the apex root, not `/a/events/...`) | Medium | Load fonts from Google's absolute CDN (unaffected by basePath). Serve the logo from `frontend/public/` and reference it via `next/image`/`<img>` so basePath is auto-prepended — **never** a hand-written `/logo.png`. Verify through the live proxy. |
| **Absolute store links** (nav/footer/reviews bar → `88bamboo.co`) accidentally written relative | Medium | All store links are **fully-qualified `https://88bamboo.co/...`**; only events-native links use `next/link` relative paths. Documented in the components. |
| **Global CSS overrides bleed into admin** and break dashboard readability | Low–Med | Tokens are additive; admin keeps Bootstrap layout. If any dashboard control regresses, scope the aggressive overrides (button/serif body) behind a `.bamboo-public` class on public layouts only (see Decision 3). |
| **Overriding Bootstrap `.btn` globally** cascades into every Bootstrap component using `.btn` (modals, pagination, nav) | Medium | Prefer a **new `.bamboo-btn` class**, not a blanket `.btn` override (Decision 4). |
| **SSR/hydration mismatch** from the marquee if it fetches dynamic content | Low | The marquee is **static** (no Shopify blog fetch) — no client/server divergence. |
| **SEO regressions** (canonical/JSON-LD/sitemap) | Very low | Those live in `core/utils/seo.js`, `pages/[slug].js` `<Head>`, and `sitemap.xml.js` — **explicitly not edited**. Visual work touches only view bodies/CSS. |
| **Admin cookie/session** affected | None | Auth logic (`adminAuth`, SSR cookie guard) is untouched; only presentational classes change on admin views. |
| **`tw-text-custom-green` references** break when the palette is renamed | Low | Grep for `custom-green`/`custom-orange` and update the handful of usages in the same commit as the Tailwind rename (found in `EventListing.js`, `EventDetail.js`, `SubmitEvent.js` today). |
| **Payment UI (`CheckoutStep`) regressions** | Low | Only button classes change; Stripe Elements iframe styling is Stripe-controlled and left alone. |

---

## 11. Staged implementation order (small commits)

1. **Tokens + fonts (foundation).** `_document.js` (Buenard), `globals.css` (`:root` tokens + base body/heading/link rules), `tailwind.config.mjs` (palette + font families rename). Grep-fix `custom-green`/`custom-orange` usages. → *Verify: pages still SSR, no console errors, headings render serif.*
2. **Buttons + forms.** Add `.bamboo-btn` family + form-control polish in `globals.css`; swap `btn-success`→brand classes across public views. → *Verify: every CTA is green/cream/uppercase; forms submit unchanged.*
3. **Navbar + top bars.** Rebuild `NavBar.js`, add marquee + reviews bar in `Main.js`, add logo asset + mobile drawer. → *Verify through the live App Proxy that logo/asset paths resolve under `/a/events`.*
4. **Footer.** Rebuild `FooterBar.js` (light two-column). → *Verify links (relative events-native vs absolute store).*
5. **Listing cards + container.** `.page-width`, editorial `EventCard`. List/calendar rebrand only. → *Verify grid/list/calendar all still filter + navigate.*
6. **Detail page article sizing.** `.article-measure`, Buenard title, image treatment, badges. → *Verify canonical/JSON-LD unchanged in page source.*
7. **Submit + secondary public views polish.** Fonts/buttons on `SubmitEvent`, `CheckoutStep`, `ManageEvent`, `EditEvent`, `MyEvents`, `Conversation`.
8. **Admin light pass.** Confirm inherited tokens read well; scope-fix anything that regressed.
9. **Responsive QA pass.** Mobile drawer, input zoom, card stacking, detail title fallback.

Each step is an independent, revertible commit. Steps 1–2 are prerequisites; 3–8 are largely parallel-safe.

---

## Parity Gap Audit — Round 2 (2026-07-06)

Side-by-side review of the live `88bamboo.co/pages/about-us-1` (reference) vs
`88bamboo.co/a/events/` (ours). Every gap below is tied to a specific line of our
code. Facts marked **Confirmed (computed)** were read from `getComputedStyle` in a
running preview; **Confirmed (code)** are direct from source; **Uncertain** means I
could not verify the reference's exact value from the screenshot and it needs a
live check against the store. Paths are relative to `frontend/`.

Legend: 🔴 regression to fix · 🟡 intentional divergence (a locked decision) · ⚪ needs a decision.

### A. Global — heading type scale is missing (root cause of several gaps)

**Gap A1 🔴 — All headings render at the wrong size.**
- Observed: reference article title (`About Us`) is a large ~32px serif; our listing `<h1>` "Drinks & hospitality events" is tiny. Footer "Quick links"/newsletter headings are oversized vs the reference's small ones.
- Confirmed (computed): our listing `main h1` = **16px**; footer `.h4` = **23.3px**.
- Code cause: `styles/globals.css:56-61` styles `h1..h5, .h1..h5` for **font-family / weight / colour only — no `font-size`**. The storefront type scale (reference §3: h1 29px, h2 22px, h3 22px, h4 14px, h5 12px, h6 16px) was never ported. Two knock-on effects:
  1. Bare elements (`<h1 className="mb-0">` in `EventListing.js:397`, submit/admin h1s) fall to **16px** because Tailwind's Preflight (`@tailwind base` at `globals.css:5`, loaded *after* Bootstrap per `pages/_app.js:5-7`) resets `h1..h6 { font-size: inherit }` → 16px, and nothing restores a size.
  2. Class-based headings (`<h4 className="h4">` in `FooterBar.js:27,44`) get **Bootstrap's** `.h4` size (~23px), not the storefront's 14px.
- Note: `.article-title` (`globals.css:104-112`, event detail) and `.event-card__title` (`globals.css:383-390`, cards) DO set explicit sizes, so those two are correct — which is why the event-card titles look right while the page `<h1>` does not.

### B. Top marquee (green "Just In" bar)

**Gap B1 🟡 — Marquee text is static, not the latest article.**
- Observed: reference shows "Just In 👉 Vinexpo Asia To Make Hong Kong Permanent Home" (live latest `news` article); ours shows "Just In 👉 Discover upcoming drinks & hospitality events".
- Code cause: hard-coded string in `components/layouts/Main/components/AnnouncementMarquee.js:11`. This is **Decision 9** (static strip, no Shopify-blog fetch) — intentional.

**Gap B2 🔴 — Marquee text is the wrong weight and font.** *(Measured live 2026-07-06 from `theme.scss.css` + markup.)*
- Reference (measured): `.announcement-bar__message { font-size: 0.875em (≈14px desktop) / 0.75em (≈12px small); font-weight: 700; color:#fff; background:#0B4321; padding: 7.33px 55px }`, `.announcement-bar { text-align:center }`. It inherits the **body serif** font (not Buenard). The dynamic title portion carries an inline `font-style: oblique` (italic); the "Just In 👉" lead-in is upright. Markup: `<p class="announcement-bar__message"><span>Just In 👉</span> <span style="font-style:oblique">…title…</span></p>`. (Also `.marquee-container` is `position:sticky; top:0; z-index:1000; height:36px/30px` — a sticky bar.)
- Ours: `globals.css:230-234` — `.bamboo-marquee a/span { font-size:14px; font-family: var(--font-heading) }` (Buenard), **weight 400**, centered, not sticky.
- Fix: set the marquee to **font-weight 700** and the **body serif** font (drop Buenard), keep ~14px/centered. Our copy is static (Decision 9) so the oblique tail is optional. Sticky behaviour is a separate nicety — flag but not required.

### C. Header / navbar

**Gap C1 🔴 — Header content is boxed to 1200px; the store header is full-bleed.** *(Resolved live 2026-07-06.)*
- Measured (live `theme.scss.css`): the store `.site-header` is **NOT wrapped in `.page-width`**. It is full-width: `.site-header { padding: 0 30px; background:white; border-bottom:1px solid #e8e9eb }`, with `.site-header__logo { padding-left: 22px; text-align:left }`. So the logo sits ~30px from the viewport's left edge on any width. (`.page-width { max-width:1200px }` is real, but the store applies it to body content + footer — **not** the header.)
- Ours (confirmed computed): nav inner wrapper `maxWidth: 1200px` — `NavBar.js:20` wraps the header row in `.page-width` (`globals.css:80-85`), so on wide screens it centers to a 1200 band and the logo indents.
- Fix: make the navbar **full-width with ~30px side padding** (not `.page-width`). Keep the footer on `.page-width` (that matches the store).

**Gap C2 🟡 — No search icon and no currency (SGD ▾) selector.** *(Owner decision 2026-07-06: do NOT replicate — leave out.)*
- Observed: reference header right side has a search (magnifier) icon and an "SGD ▾" currency selector; ours has neither.
- Code cause: `NavBar.js:63-77` renders only the Events CTA + hamburger on the right. Search and currency were never built (search = a store feature; currency = a Shopify storefront/checkout widget).
- Resolution: **omit** — owner confirmed no need to replicate search or currency. No change required.

**Gap C3 🟡 — There is an extra green "Events" button.**
- Observed: ours has a green EVENTS button the reference lacks.
- Code cause: `NavBar.js:64-67`. Intentional — the added Events CTA is part of **Decision 1**.

**Gap C4 🔴 — Dropdown carets are Bootstrap triangles, not chevrons.**
- Observed: reference dropdown indicators are thin "v" chevrons; ours are filled triangles.
- Code cause: `NavBar.js:36` uses Bootstrap's `dropdown-toggle` class, whose `::after` draws a solid triangle. The storefront uses a chevron icon (reference §6, `icon-chevron-down`).

### D. Yellow reviews bar

**Gap D1 🔴 — Reviews text is centered and boxed to 1200px, so it wraps to two lines.** *(Reference measured live 2026-07-06.)*
- Reference (measured): `.reviews-bar { padding: 13px 50px (desktop) / 13px 15px (mobile) }`, full-width (NOT `.page-width`), `margin-bottom: 2.5rem` (inline). The words are in `<span class="reviews-bar-words" style="display:block; width:100%">`, **left-aligned** (no centering), separated by " | ".
- Ours (confirmed computed): reviews inner wrapper `justifyContent: center`, `maxWidth: 1200px` — `ReviewsBar.js:9` uses `.page-width … justify-content-center` + `flex-wrap`. The yellow `<nav>` background (`ReviewsBar.js:8`) is already full-width (matches); only the inner alignment/width differ.
- Fix: drop `.page-width` + `justify-content-center`; make the content full-width, **left-aligned**, `padding: 13px 50px`. That removes the two-line wrap.

**Gap D2 🔴 — A ~55px white gap sits above the reviews bar.**
- Observed: reference reviews bar is flush under the nav; ours has whitespace above it.
- Confirmed (computed): `.main-content` `padding-top: 55px`.
- Code cause: `Main.js:16-17` renders `<ReviewsBar/>` *inside* `<div className="main-content">`, and `globals.css:93-98` gives `.main-content` `padding-top: 35px` (mobile) / `55px` (desktop). So the section padding pushes the yellow bar down. In the storefront the reviews bar precedes the padded content region.

**Gap D3 🟡 — Reviews text size is slightly off (weight already matches).** *(Measured live 2026-07-06.)*
- Reference (measured): `.reviews-bar-words { font-size: 95% (≈15.2px desktop) / 75% (≈12px mobile) }`; the label and every link are inline `font-weight:bold` and links `text-decoration:underline`.
- Ours: `ReviewsBar.js:9` uses Bootstrap `.small` (**0.875em ≈ 14px**) and `globals.css:248-252` already sets links `font-weight:700` + underline, label bold.
- Verdict: **weight/underline already correct.** Only the size differs slightly (14px vs ~15px desktop). Minor — will nudge to ~95%/15px while fixing D1 so it's a single touch; not worth a standalone change otherwise.

### E. Footer

**Gap E1 🔴 — Footer headings oversized.** Same root cause as **A1** (`FooterBar.js:27,44` use `<h4 className="h4">` → ~23px; storefront `.h4` is 14px).

**Gap E2 🔴 — Quick links are one long vertical column; the reference uses two columns.**
- Observed: reference footer menu is laid out in two columns; ours is a single stacked list.
- Code cause: `FooterBar.js:28` renders a single `<ul className="list-unstyled">`. No multi-column styling.

**Gap E3 🟡 — Extra events-native links at the top of Quick links.**
- Observed: ours starts with "Browse events / List an event / Manage your listing", which the store footer doesn't have.
- Code cause: `FooterBar.js:15-19,29-33` (`EVENTS_LINKS`). Intentional (events app's own actions), but it also lengthens the single column (compounds E2).

**Gap E4 🔴 — Newsletter "Subscribe" button label is near-invisible (slate on green).**
- Observed: reference SUBSCRIBE label is clearly readable; ours is faint.
- Confirmed (computed): the Subscribe `<a>` has `color: rgb(61,66,70)` (slate `#3d4246`) on `background: rgb(0,79,45)` (green) — dark-on-dark.
- Code cause: specificity bug. `globals.css:325-327` `.bamboo-footer a { color: var(--bamboo-text) }` (0,2,0) beats `.bamboo-btn { color: var(--bamboo-button-text) }` (0,1,0) at `globals.css:143`, because the button is an `<a class="bamboo-btn">` inside `.bamboo-footer` (`FooterBar.js:56-61`). The cream label is overridden to slate. (A hover underline from `globals.css:329-331` also leaks onto it.)

**Gap E5 🟡 — Payment icons missing.** *(Owner decision 2026-07-06: omit — do NOT add.)*
- Observed: reference footer shows Amex / Apple Pay / Mastercard / Maestro / Visa icons; ours shows none.
- Code cause: `FooterBar.js:68-84` renders only social icons + copyright — no payment row.
- Resolution: **omit** — owner confirmed. The events app takes no payment at the footer, so the store's checkout payment badges are intentionally left out. No change required.

**Gap E6 🔴 — Bottom-row arrangement differs.**
- Observed: reference bottom = payment icons (left) + social icons (right) on one row, then a centered copyright below. Ours = social icons (left) + copyright (right) on one row, no payment.
- Code cause: `FooterBar.js:68-84` — a single `justify-content-between` row with social on the left and copyright on the right.

**Gap E7 🟡 — Social set uses a TikTok icon; the reference shows a Tumblr glyph.** *(Owner decision 2026-07-06: keep the TikTok icon.)*
- Observed: reference third social icon is a Tumblr "t"; ours is TikTok.
- Code cause: `menuData.js:130-134` `SOCIAL_LINKS` uses `icon: 'bi-tiktok'`. Per reference §8 the store wires TikTok through the **Tumblr** social slot, so it renders a Tumblr glyph that links to TikTok.
- Resolution: **keep the TikTok icon** — owner confirmed. Ours is the clearer/correct glyph for the actual destination. No change required.

### F. Not visible in these screenshots (still to verify)

**Gap F1 ⚪ — Event detail page (`.article-measure`, ~760px) is not in either screenshot.** Its title uses `.article-title` (correct size) so it likely fares better than the listing `<h1>`, but it should be checked once A1 is fixed, since its badges/prose share the same tokens.

### Round-2 summary — what to fix vs leave *(updated 2026-07-06 with owner decisions + live measurements)*

- **Fix (🔴), all now with confirmed target values:**
  - **A1** heading type scale — port the storefront scale (h1 29px, h2 22px, h3 22px, h4 14px, h5 12px, h6 16px) so bare `<h1>`s stop collapsing to 16px and `.h4`s stop rendering at ~23px. *Biggest single fix — corrects the tiny page title AND the oversized footer headings (E1).*
  - **B2** marquee → font-weight 700, body serif (not Buenard).
  - **C1** navbar → full-width with ~30px side padding (not `.page-width`).
  - **C4** dropdown carets → chevron icons, not Bootstrap triangles.
  - **D1** reviews bar → full-width, left-aligned, `padding: 13px 50px` (removes the two-line wrap); **D3** nudge size to ~15px in the same edit.
  - **D2** reviews gap → move `<ReviewsBar>` above the `.main-content` padding (or drop the padding above it).
  - **E2** quick links → two columns.
  - **E4** Subscribe button → fix the `.bamboo-footer a` specificity so the cream label shows.
  - **E6** footer bottom row → match the store's arrangement (with payment icons omitted per E5).
- **Leave / omit (🟡), owner-confirmed:** B1 static marquee, C2 search + currency (omit), C3 Events button, E3 events links, E5 payment icons (omit), E7 keep TikTok icon.

Every ⚪ from the first pass is now resolved (owner decisions on C2/E5/E7; live measurements on B2/C1/D1/D3).

**Round-2 fixes — APPLIED & verified 2026-07-06.** The whole 🔴 set has been implemented and confirmed via computed styles in a running preview:
- A1 — `globals.css` now sets the storefront type scale → listing `<h1>` = **29px**, footer `.h4` = **14px** (were 16px / 23px).
- B2 — marquee is now **font-weight 700 / Georgia (body serif)**.
- C1 — navbar uses `.bamboo-navbar__row` (full-width, 22/30px padding) → logo `left: 30px` (was boxed to 1200px).
- C4 — Bootstrap triangle caret replaced with a CSS chevron.
- D1/D3 — reviews bar is full-width, **left-aligned** (`justify: normal`), `padding: 13px 50px`, `font-size: 15.2px` — no more two-line wrap on wide screens.
- D2 — `<ReviewsBar>` moved above `.main-content` so it sits flush under the nav.
- E2 — footer quick links render in **2 columns**.
- E4 — `.bamboo-footer a:not(.bamboo-btn)` fix → Subscribe label is **cream (#f2f0e3)** again.
- E6 — footer bottom row: social icons right, copyright centered below (payment icons omitted per E5).

Files touched: `styles/globals.css`, `components/layouts/Main/{Main.js, components/NavBar.js, components/ReviewsBar.js, components/FooterBar.js}`. `next build` passes.

---

## Parity Gap Audit — Round 3 (2026-07-06)

Owner flagged four navbar-behaviour gaps by comparing `88bamboo.co/pages/about-us-1`
(reference) with `88bamboo.co/a/events/`. Reference values were measured live from
`theme.scss.css?v=59715874…` + the page markup (not guessed). Paths relative to `frontend/`.

Legend: 🔴 fix · 🟡 intentional · ⚪ needs a decision.

**Gap G1 🔴 — The "Events" button sticks out on its own.** *(Owner override of the locked Decision 1 / Round-2 Gap C3.)*
- Observed: reference has a single uniform nav row (Home … Bookmarks); ours renders a
  standalone green `.bamboo-btn` "Events" pill on the far right, visually detached.
- Owner instruction (2026-07-06): make Events **just another nav item, to the right of
  Bookmarks**, not a button on its own.
- Code cause: `NavBar.js:64-67` rendered Events as a `bamboo-btn bamboo-btn--small` in the
  right-hand flex group (outside the `<ul>`).
- Fix: render Events as the last `<li>` in the nav `<ul>`, styled as a normal
  `.bamboo-nav-link` (kept as a relative `next/link`). This **supersedes** the earlier
  "keep the green Events button" locked decision.

**Gap G2 🔴 — Nav links have no hover/active underline.**
- Reference (measured): each top-level link wraps a `.site-nav__label { border-bottom:1px
  solid transparent }`. On `:hover`/`:focus` the label goes `color:#1A6132; border-bottom-color:
  #1A6132`. The **current section** uses `.site-nav__link--active .site-nav__label { color:
  #1A6132; font-weight:bold; border-bottom-color:#1A6132 }` — i.e. green, bold, underlined.
- Ours: `globals.css` `.bamboo-nav-link:hover` only changed the whole-link colour; no
  underline, no active state, and labels weren't wrapped in a span.
- Fix: wrap every nav label in `.bamboo-nav-link__label` (border-bottom underline);
  add `:hover/:focus` and `.bamboo-nav-link--active` rules mirroring the store. Events is
  the active section here, so it always shows the green/bold/underlined state.

**Gap G3 🔴 — Header is not sticky on scroll.**
- Reference: the store header stack stays pinned to the top on scroll (`.marquee-container
  { position:sticky; top:0; z-index:1000 }`, header directly beneath).
- Ours: `.bamboo-navbar` had no positioning → scrolled away with the page.
- Fix: `.bamboo-navbar { position:sticky; top:0; z-index:1030 }`. Verified via preview:
  `position:sticky, top:0, z-index:1030`, and **no overflow-clipping/transformed ancestor**
  between the navbar and the scroll root (would break sticky) — confirmed none.

**Gap G4 🔴 — Dropdowns are flat lists, not the store's organised mega-menus.**
- Reference (parsed live from `#SiteNav`): the top menu is **two-level**. About Us,
  Editorial and Cocktails open **centered multi-column mega-menus** whose columns are bold
  header-links (`site-nav__child-link--parent`) with child links beneath — About Us = 2
  cols, **Editorial = 5 cols** (The Bamboo Post / Columns / Lifestyle / Library / Beginner
  Series), Cocktails = 2 cols (Recipes / Bar Essentials). Reviews and Community are **plain
  single-column dropdown boxes** (no group headers). CSS: `.site-nav__childlist { padding:
  11px 17px }`, `.site-nav__dropdown .site-nav__link { padding:4px 15px 5px }`,
  `.site-nav__child-link--parent { font-weight:700 }`, mega dropdown centered & `width:auto`.
- Ours: `menuData.js` flattened Editorial to 25 loose items; `NavBar.js` rendered every
  dropdown as one Bootstrap `.dropdown-menu` column.
- Fix: restructure `STORE_MENU` to carry the store's real nesting — `groups` (mega) vs
  `items` (plain) — captured verbatim incl. the group header hrefs and Community's
  native-language suffixes. Rebuild `NavBar.js` to render `groups`→centered mega-menu band
  and `items`→plain box, using **pure-CSS hover/focus-within** (dropped the Bootstrap
  dropdown JS). `MobileNavDrawer.js` flattens `groups` so column headers show inline (bold)
  above their children in the accordion.

### Round-3 fixes — APPLIED & verified 2026-07-06

Confirmed via computed styles in a running preview at 1280px + a production `next build`:
- **G1** — Events is now the last nav `<li>` (right of Bookmarks); order reads Home, About
  Us, Editorial, Reviews, Cocktails, Community, Be A Guest Writer!, Bookmarks, **Events**.
- **G2** — Events label computes `font-weight:700`, `color/border-bottom rgb(26,97,50)`
  (#1A6132); non-active links get the same underline on hover.
- **G3** — `.bamboo-navbar` computes `position:sticky; top:0; z-index:1030`; no clipping
  ancestor.
- **G4** — 3 mega-menus + 2 plain dropdowns; **Editorial mega = 5 columns on one row**
  (matches the reference screenshot); mobile drawer shows Editorial as 5 bold group headers
  + child links (30 rows). Default state: mega-menus `display:none` (open on hover/focus).

Files touched: `components/layouts/Main/menuData.js`, `components/layouts/Main/components/
{NavBar.js, MobileNavDrawer.js}`, `styles/globals.css`. `next build` passes; no console/
server errors.

**Note — locked decision changed:** Decision 1 / Round-2 Gap C3 ("keep the added green
Events button") is **superseded** by G1 per the owner's 2026-07-06 instruction. The Events
tab remains (it's still the app's own section), but as a plain nav item, not a button.

### Round-3 follow-ups (owner spot-checks, 2026-07-06)

**Gap G5 🔴 — Marquee text weight didn't match the store.** *(Corrects Round-2 Gap B2.)*
- Root cause: Round-2 read `.announcement-bar__message { font-weight: 700 }` — but that
  base rule is **overridden by a LATER base rule `font-weight: 400`** in the same
  `theme.scss.css` (verified: no inline weight on the message/spans; the title span only
  carries `font-style: oblique`). The store actually renders **400**, so our 700 looked
  heavier than the store's banner.
- Fix: `globals.css` `.bamboo-marquee a/span` → `font-weight: 400` (Georgia serif, 14px
  unchanged). Verified computed = 400 / Georgia / 14px.

**Gap G6 🔴 — Mega-menus closed before the cursor could reach them.**
- Root cause: mega-menu `<li>`s are `position: static`, so the panel anchors to
  `.bamboo-navbar` bottom, leaving a **~23px dead zone** (nav-row padding + border) between
  the tab and the panel. Crossing it dropped `:hover` and closed the menu. (Plain
  dropdowns anchor to their own `<li>` → no gap → the owner correctly saw no issue there.)
- Fix: a transparent `.bamboo-megamenu::before` hover-bridge (`top:-28px; height:28px`,
  full width) — a descendant of the trigger `<li>`, so hovering the gap keeps the menu
  open. Verified geometry: bridge spans y 98→126, overlapping the button bottom (104) and
  reaching the panel top (126) — a continuous hoverable path (`bridgesGap: true`). The
  bridge only exists while the panel is open (`display:block`), so it never blocks the
  closed navbar.

Files touched (follow-ups): `styles/globals.css`.

---

## Parity Gap Audit — Round 4 (2026-07-06) — Mobile navbar

Owner asked to match the **mobile** navbar behaviour to the store (excluding the SGD
currency selector). Reference behaviour parsed live from `theme.scss.css` +
`#MobileNav` markup. Paths relative to `frontend/`.

**Gap H1 🔴 — Hamburger menu opened the wrong way (off-canvas accordion vs the
store's full-width drill-down).**
- Reference: the mobile nav is a **full-width panel that drops down under the header**
  (`.mobile-nav-wrapper`), with a **multi-level drill-down** — tap a section → it
  slides to a sub-panel (with a back button) of its groups; tap a group → its links
  (`.sub-nav--is-open .mobile-nav { translate3d(-100%…) }`, `.third-nav--is-open …
  translate3d(-200%…)`, `.mobile-nav__return-btn`). Rows: `padding:15px 30px;
  font-size:16px`. Hamburger toggles to an X (`icon-hamburger` ↔ `icon-close`).
- Ours (before): `MobileNavDrawer.js` was an **85%-width left off-canvas** drawer with
  **accordion** (expand-in-place) submenus and a static "Browse events" button — a
  different open pattern entirely.
- Fix: rebuilt `MobileNavDrawer.js` as a full-width drop-down (`.bamboo-mobile-menu`,
  `position:absolute; top:100%` of the sticky header) with a **drill-down stack** built
  from `STORE_MENU` (sections → groups → links; a drilled section repeats its own page
  link at the top, like the store). `NavBar.js` hamburger now **toggles** and swaps
  `bi-list` ↔ `bi-x-lg`. Verified on a production server (the dev server's Next-16
  overlay bug breaks hydration): click opens a **full-width** panel flush under the
  header (top 126 ≈ header bottom 127), X icon shows, Editorial → 5 group rows → "The
  Bamboo Post" → self-link + 4 child links, back button pops one level.

**Gap H2 🔴 — Marquee text too large on mobile.**
- Reference: `.announcement-bar__message` is `0.75em` (~12px) on mobile, `0.875em`
  (~14px) ≥750px. Ours was a flat 14px.
- Fix: `globals.css` — `@media (max-width:749px)` sets the marquee to 12px. Verified
  computed: 12px mobile / 14px desktop.

**Gap H3 🟡 — Search icon on the mobile header.** *(Owner decision 2026-07-06: OMIT.)*
- Reference mobile header right side is `[search] [SGD] [hamburger]`. SGD was already
  excluded (Gap C2). Asked the owner about the search magnifier; owner chose to **omit**
  it, so the events mobile header stays **logo + hamburger** (Decision C2 preserved). No
  change.

### Round-4 fixes — APPLIED & verified 2026-07-06

Verified on a production build/server at 375px (dev server unusable — Next 16
`handleStaticIndicator` overlay bug breaks hydration there):
- **H1** — full-width drop-down drill-down menu; hamburger ↔ X; 3-level drill
  (section → group → links) with self-link + back button; store links absolute,
  Events (active) internal. Desktop re-checked: mega-menus + sticky + Events-active all
  still correct; mobile menu hidden ≥992px.
- **H2** — marquee 12px mobile / 14px desktop.
- **H3** — omitted per owner.

Files touched: `components/layouts/Main/components/{MobileNavDrawer.js, NavBar.js}`,
`styles/globals.css`. `next build` passes. (Old `.bamboo-drawer-*` off-canvas CSS +
markup removed as now-unused.)

---

## Owner Decisions Required

### Decision 1: Navbar — recreate the Shopify nav exactly, or a simplified Events-compatible version?

**What needs deciding:**
Whether the events navbar reproduces the full storefront top nav (all store menu items + dropdowns), or a lighter bar that carries 88 Bamboo's identity (logo + a few links) plus events-native actions.

**Recommended option:**
A **simplified brand-consistent navbar**: 88 Bamboo logo (left, links to `88bamboo.co`), a small set of absolute links to the main store's top sections, plus events-native items ("All events", "List an event"), the "Just In" strip, and the yellow reviews bar.

**Why:**
The storefront's full nav is Liquid-driven from a Shopify menu we can't (and per plan shouldn't) port; hard-coding the entire menu here would drift out of sync the moment the store's menu changes. A logo + reviews bar + a handful of links reproduces ~90% of the *visual* identity while keeping the events app's own actions primary. It also avoids maintaining a duplicate of the store's IA.

**Alternative options:**
- **Full replica of the store menu (hard-coded).** Most seamless *if* the menu never changes; high maintenance, drifts silently, and duplicates store IA. Risk: Medium.
- **Minimal (logo + "All events / List an event" only, no store links).** Cleanest and lowest-maintenance, but feels more like a standalone microsite than "part of 88bamboo.co." Risk: Low.

**Files affected:** `NavBar.js`, `Main.js`, new `AnnouncementMarquee.js`, `ReviewsBar.js`, `MobileNavDrawer.js`, a logo asset in `public/`.

**Risk level:** Medium (link correctness under App Proxy; content sync).

---

### Decision 2: Event detail title — centered ~32px (article style) or left-aligned?

**What needs deciding:**
Whether the event `<h1>` mimics the storefront's centered `.article__title` (200% / ~32px) or stays left-aligned.

**Recommended option:**
**Left-aligned Buenard ~30–32px.** Match the storefront's font/size but keep left alignment.

**Why:**
Event pages are structured content (date, venue, CTA) more than long-form prose. Centered titles read well over centered editorial articles but look awkward above a left-aligned definition list and buttons. Left alignment keeps the Buenard/size parity without fighting the page's information layout.

**Alternative options:**
- **Fully centered like articles.** Maximum article parity; slightly awkward over structured event metadata. Risk: Low.
- **Keep current smaller Sora-replaced h1.** Least work; misses the editorial cue. Risk: Low.

**Files affected:** `EventDetail.js`, `globals.css`.

**Risk level:** Low.

---

### Decision 3: Apply brand styling globally, or isolate it under a public-only wrapper?

**What needs deciding:**
Whether the serif body / aggressive base overrides apply to the entire app (including admin) or only to public (proxied) pages via a scoping class.

**Recommended option:**
**Global brand tokens + base type, applied app-wide** — this is a standalone origin, so there's no risk of leaking into the Shopify theme. Keep the *layout* utility feel of admin (tables, tabs) but let it inherit the brand palette/fonts.

**Why:**
Simplicity and consistency: one token source, admin still looks "88 Bamboo" (Decision 6 keeps its dashboard ergonomics). Scoping everything behind a class doubles the CSS surface for little benefit given admin and public never render together.

**Alternative options:**
- **Scope brand skin under `.bamboo-public`** on public layouts only; admin stays stock Bootstrap. Safer if we worry about dashboard readability regressions; more CSS plumbing. Risk: Low.
- **Global including admin fully restyled to match public.** Prettier admin, but risks harming dense-data legibility. Risk: Medium.

**Files affected:** `globals.css`, `Main.js` (and admin layout if scoped).

**Risk level:** Low.

---

### Decision 4: Override Bootstrap `.btn`, or introduce a new `.bamboo-btn` class?

**What needs deciding:**
How to deliver the storefront button look given Bootstrap is imported globally.

**Recommended option:**
**Introduce `.bamboo-btn` (+ `--secondary`/`--tertiary`/`--small`)** and swap CTA classes to it, rather than overriding Bootstrap's `.btn`.

**Why:**
Bootstrap reuses `.btn` inside pagination, modals, close buttons, nav — a blanket override cascades unpredictably (especially with the uppercase/tracking/serif rules). A dedicated class gives pixel-accurate storefront buttons on our CTAs while leaving Bootstrap components intact.

**Alternative options:**
- **Override `.btn` globally.** Fewer class edits in views; risk of visual regressions across Bootstrap widgets. Risk: Medium.
- **Tailwind `tw-` component classes.** Consistent with the `important:true` setup, but verbose per-button. Risk: Low.

**Files affected:** `globals.css`, all public views with CTAs, `CheckoutStep.js`.

**Risk level:** Low–Medium.

---

### Decision 5: Event cards — mirror 88 Bamboo article cards, or a more practical event layout?

**What needs deciding:**
Whether listing cards look like the storefront blog cards or lean into event-specific affordances (date/format/category badges).

**Recommended option:**
**Article-card visual shell + minimal event affordances.** Native-ratio image, Buenard title, muted date, excerpt, tertiary "Read more" — *plus* a small date/format badge that blog cards don't have.

**Why:**
The editorial shell delivers the "feels like 88bamboo.co" goal; the light event badges serve the listing's actual job (scanning by date/type). It's the best of both without inventing a foreign visual language.

**Alternative options:**
- **Pure article-card clone (no badges).** Most seamless; slightly less scannable as an events board. Risk: Low.
- **Practical event tile (prominent date block, compact).** Best usability for a dense board; least storefront-like. Risk: Low.

**Files affected:** `EventListing.js` (`EventCard`), `globals.css`.

**Risk level:** Low.

---

### Decision 6: Admin — fully match the public site, or keep a cleaner utility/dashboard style?

**What needs deciding:**
How far the brand skin goes into the admin dashboard.

**Recommended option:**
**Brand palette + fonts, utility layout.** Admin adopts the colours/typography (so it's recognisably 88 Bamboo) but keeps its dense tabbed tables, not article measures or editorial cards.

**Why:**
Admin is a private operational tool; the owner needs fast scanning of queues, not editorial styling. Inheriting tokens keeps it on-brand at near-zero cost while preserving ergonomics.

**Alternative options:**
- **Leave admin exactly as-is (stock Bootstrap).** Zero risk, but slightly off-brand. Risk: Low.
- **Fully restyle admin like public pages.** Prettier; risks harming data density/legibility. Risk: Medium.

**Files affected:** admin views (light), `globals.css`.

**Risk level:** Low.

---

### Decision 7: Footer — replicate the Shopify footer (incl. newsletter) or a lighter Events footer?

**What needs deciding:**
Whether to reproduce the storefront footer including a working newsletter signup, and whether to include currency/locale/payment selectors.

**Recommended option:**
**Lighter Events footer, visually matched.** Same `#f5f5f5` look, quick-links + a newsletter block, social icons, copyright — but the newsletter either **links to the store's signup** or posts to the store's existing form action; **omit** currency/locale/payment selectors.

**Why:**
The selectors are Shopify-checkout features with no meaning in the events app; wiring a live newsletter would mean reproducing the store's Shopify/Mailchimp integration, which is out of scope. A matched-looking footer that hands newsletter signups back to the store stays seamless without importing store logic.

**Alternative options:**
- **Exact footer replica with a live newsletter.** Most seamless; requires the store's newsletter form endpoint + risks importing Shopify-specific behaviour (against the brief). Risk: Medium–High.
- **Minimal footer (events links + copyright only).** Lowest effort; less storefront-like. Risk: Low.

**Files affected:** `FooterBar.js`, `globals.css`.

**Risk level:** Low (recommended) / Medium–High (full replica).

---

### Decision 8: Rebrand the homepage widget (`events-widget.js`) in this pass, or leave it?

**What needs deciding:**
The pasted-into-Shopify widget already has its own inline card styles. Do we align its typography/colours to the new tokens now?

**Recommended option:**
**Leave it out of this pass; note it as a fast-follow.** Align its inline styles to the finalised tokens in a separate small commit once the app parity is signed off.

**Why:**
The widget renders inside the Shopify theme (already the target aesthetic), executes as standalone JS, and is a different risk surface (owner re-pastes / re-verifies through the proxy). Bundling it here widens blast radius for little gain; it's cleanly separable.

**Alternative options:**
- **Rebrand the widget in the same effort.** One fewer follow-up; adds an unrelated verification step (owner must re-check the embed on the live store). Risk: Medium.
- **Never touch it.** Fine if its current cards already look acceptable on the store. Risk: Low.

**Files affected:** `public/widget/events-widget.js` (only if chosen).

**Risk level:** Low (defer) / Medium (do now).

---

### Decision 9: "Just In" marquee — static strip, or reproduce the store's latest-article behaviour?

**What needs deciding:**
The storefront marquee shows the latest `news` blog article title. Do we replicate that (fetch the store blog) or show a static/events strip?

**Recommended option:**
**Static branded strip** (e.g. "Drinks & hospitality events, curated by 88 Bamboo" or a link to the store's Just In). No Shopify blog fetch.

**Why:**
Fetching the store's blog means an extra cross-origin dependency, SSR/hydration complexity, and coupling to Shopify content — all against the "no Shopify logic" brief and risky for a proxied SSR page. A static strip keeps the visual cue without the dependency.

**Alternative options:**
- **Fetch the store's latest article** (client-side after hydration). Most faithful; adds a network dependency + potential CLS + Shopify coupling. Risk: Medium.
- **Omit the marquee entirely.** Simplest; loses a recognisable storefront element. Risk: Low.

**Files affected:** new `AnnouncementMarquee.js`, `Main.js`.

**Risk level:** Low (static) / Medium (dynamic).

---

## Non-Goals

This work will **not**:

- change any **payment logic** (Stripe PaymentIntents, capture/cancel flow, `CheckoutStep` behaviour, webhooks) — only button *classes* on the checkout step;
- change **backend APIs** — no endpoint, query, or response-shape changes (this is frontend-only; no display-data change is required for parity);
- change **Shopify App Proxy** behaviour, signing, or the `verifyProxyRequest` guard;
- change **`basePath`** (`/a/events`), `skipTrailingSlashRedirect`, or `next.config.mjs`;
- change **canonical URL logic** (`core/utils/seo.js`, `<link rel=canonical>`), JSON-LD, or Open Graph tags;
- change **sitemap logic** (`pages/sitemap.xml.js`);
- change **admin authentication** (`adminAuth`, SSR cookie guards, the four server-verified money/listing endpoints);
- add an **apex→www redirect** (would break proxying);
- copy any **Shopify Liquid, sections, theme JS, checkout/customer logic, or app code** into this Next app — the theme is a *visual reference only*;
- rebuild the **list or calendar views'** structure (rebrand only);
- (per Decision 8, recommended) rebrand the **homepage widget** in this pass.

---

## Implementation Preview (plain-English, for the owner)

After these changes, here's what you'll actually see at `88bamboo.co/a/events`:

- **The whole events section will read as "88 Bamboo."** Text switches from the current modern sans-serif (Sora/Helvetica) to the same **serif fonts as your main site** — Buenard for headings, a classic serif for body text. Colours change from the current dark-green-and-orange to your storefront's **dark green, slate-grey text, cream buttons, and the yellow "reviews" strip** — the orange disappears entirely.
- **A proper top of the page.** Instead of a bare "88 Bamboo Events" line, you'll get your **logo on the left**, a small set of navigation links, the **"Just In" strip**, and the familiar **yellow reviews bar** — so a visitor arriving from the main site barely notices they've moved.
- **Buttons everywhere will match your store** — dark green with cream, uppercase, subtly spaced letters, square-ish corners, brightening to a lighter green on hover. This includes "List an event," "Manage your listings," and the "Continue/Pay" buttons on the form.
- **The events listing page** will use your site's **1200px width, spacing, and typography**, and the event cards will look like your **blog/article cards** — a photo on top at its natural shape, a serif title, a small muted date, a short teaser, and an outlined "View event" button — with small date/format tags added so the board stays easy to scan.
- **Event detail pages** will use a **narrower, article-like reading column** (~760px) with a large serif title, so an individual event feels like reading one of your editorial articles rather than a product page.
- **The submit form keeps its clean, simple layout** — same fields, same steps — but the fonts, buttons, input styling, and spacing all match the main site.
- **A light grey footer** replaces the dark-green strip, with quick links, a newsletter block, your social icons, and the copyright line — matching the storefront footer's look.
- **On phones**, the menu becomes a slide-in drawer with a hamburger button, cards stack neatly, and form fields won't trigger the annoying iOS zoom.
- **Your admin dashboard** picks up the same brand colours and fonts so it looks like part of 88 Bamboo, while keeping its fast, table-based working layout.

Nothing about how events are submitted, paid for, approved, indexed by Google, or served through your Shopify domain changes — this is purely how it all *looks*.

---

*End of STYLE-PARITY-PLAN.md — awaiting owner sign-off on the nine decisions above before any implementation.*
