# EXPLORE-LAYER-PLAN.md — 88 Bamboo Events "Explore" SEO layer

> Companion to `plan.md`, `eventbrite-parity-plan.md`, and `eventbrite-specific-page-parity-plan.md`.
> Same ground rules apply (CLAUDE.md §1: surgical changes, surface decisions before coding, no Drink-X repo).
> **This is a planning document only — no code is written until the owner resolves the decisions in §3.**
> The AI updates the checklist (§10) every working round.

---

## 1. What we're building (and how it differs from what exists)

Today the app has ONE public discovery surface: the listing page at `/a/events` (`pages/index.js` →
`EventListing.js`). It is filter-driven, but every filter lives in **query params** (`?country=Singapore&category=Wine`).
Query-param pages are weak SEO: Google treats them as one page with parameters, rarely indexes the combinations,
and they don't read like destinations.

The **Explore layer** adds a second discovery surface: a set of **clean, static-looking, individually-indexable
URLs** — one per meaningful *place × topic* combination — each rendered as a real landing page (breadcrumb, H1,
intro copy, filter modules, event grid) and each pointing Google at a distinct, keyword-rich address:

```
/a/events/explore                          → hub: all explore cities
/a/events/explore/singapore                → "Explore Singapore Events and Things to do in Singapore"
/a/events/explore/hong-kong                → "Explore Hong Kong Events and Things to do in Hong Kong"
/a/events/explore/singapore/masterclasses  → "Whisky & Drinks Masterclasses in Singapore"
/a/events/explore/singapore/festivals      → "Drinks Festivals in Singapore"
/a/events/explore/hong-kong/wine-tastings  → "Wine Tastings in Hong Kong"
```

These are the pages that should rank for searches like *"drink events in Singapore"*, *"wine tastings Hong Kong"*,
*"bar takeovers Bangkok"*. They are **generated entirely from already-approved (`current_status='published'`)
listings** — no new content to write per city; the copy is templated, the events are live data.

**Crucially, this is a NEW surface, not a rewrite.** The existing `/a/events` listing, the detail pages, the
submit/pay/approve flow, the schema, and the backend `/events` API all stay exactly as they are. The Explore layer
is almost entirely: (a) new frontend routes, (b) a deterministic code helper that derives URL slugs ↔ existing
filters from live data (no owner config), (c) thin backend aggregate endpoints for counts + a small admin CRUD, and
(d) SEO plumbing (titles, canonicals, sitemap, interlinks).

### What we already have that this builds on (no change needed)
| Asset | File | Reused for Explore |
|---|---|---|
| Public listing API with filters | `backend/scripts/events.py` `GET /events` | The exact same query drives every explore grid — we just pass fixed params (`country`, `city`, `category`, `format`, `date_from/to`) derived from the URL. |
| Distinct-countries endpoint | `GET /events/countries` | Pattern to copy for a distinct-**cities**-with-counts endpoint. |
| Canonical/JSON-LD/SEO helpers | `core/utils/seo.js` | Extend with explore-URL + `ItemList`/`CollectionPage` builders. |
| App-Proxy dynamic-route fix | `core/utils/shopifyProxy.js` (commit `75b7f94`) | **Already strips `ctx.params` before HMAC** — so nested dynamic routes (`/explore/[city]/[facet]`) verify correctly through the proxy. This was the one thing that would otherwise 404 every explore page; it's done. |
| Card + filter UI | `EventListing.js` | The event grid card (`EventCard`) and the filter-group markup are lifted into a shared component both surfaces use. |
| Sitemap route | `pages/sitemap.xml.js` | Extended to emit explore URLs. |
| Taxonomy in DB | `drink_categories`, `event_formats` | The label set the facet slugs are deterministically derived from (§4). |
| Existing `/events` filters | `country`, `city`, `category`, `format` | Every derived place/facet resolves to these exact filter params — no new query surface. |

---

## 2. The core design problem: URL grammar

Everything hinges on **which combinations become path segments (crawlable, indexable) vs. which stay query
params (on-page only, not indexed).** Get this wrong and we either (a) generate thousands of thin/near-empty pages
Google penalises, or (b) fail to rank for the phrases the owner wants.

The desired page vibes span several different facet *types*:

| Owner's example | Place | Drink category | Event format | Date window | Price |
|---|---|---|---|---|---|
| Drink Events in Singapore | Singapore | (all) | (all) | — | — |
| Wine Tastings in Hong Kong | Hong Kong | Wine | Tasting | — | — |
| Whisky Masterclasses **This Weekend** in Singapore | Singapore | Whisky | Masterclass | this weekend | — |
| Food & Drink **Trade Events** in Tokyo | Tokyo | (all) | Trade event | — | — |
| **Bar Takeovers** in Bangkok | Bangkok | (all) | Bar takeover | — | — |
| **Free** Drinks Events in Singapore | Singapore | (all) | (all) | — | free |

So a "page" can combine **place + (category and/or format) + optional date + optional price**. We cannot put every
combination in the path — that's a combinatorial explosion (cities × 10 categories × 8 formats × 7 dates × 2 prices
= tens of thousands of URLs, almost all empty). The recommended grammar keeps **paths shallow and human**, and
pushes everything else to query params that we deliberately keep out of the index:

```
/explore                         hub
/explore/<place>                 place landing            (indexable)
/explore/<place>/<facet>         place + ONE data-derived facet (indexable)
/explore/<place>/<facet>?date=this-weekend&category=whisky   deeper filters (on-page, noindex)
```

Where `<facet>` is a **data-derived slug** (§4) — a single drink category (`whisky`), a single event format
(`masterclasses`), or a category+format **pair** (`wine-tastings` = category Wine + format Tasting). Every valid
facet is generated in code from the taxonomy + the (category, format) combinations that actually occur in published
events; the slug and H1 are a deterministic function of the label (no config, no registry — see §4). Anything beyond
one facet (a second category, a date window, price) is applied as an on-page filter that updates query params but is
`noindex` + `rel=canonical`'d back to the bare facet page, so it never competes in search.

**RESOLVED (D1):** two-segment grammar adopted — `/explore/<place>/<facet>`, one data-derived facet per indexable
page; everything deeper is on-page query params, `noindex`, canonical'd back to the bare page.

---

## 3. DECISIONS — resolved 2026-07-08

Owner rulings recorded below. **Locked:** D1=two-segment, D2=auto-generate places (hybrid indexing), D4=on-page only
(future date-URL step noted), D5=drop `free`, D3=facets auto-generated (no config), D3b=admin sitemap tab. **Still
open (non-blocking, defaults stand):** D6 caching, D7 canonical policy, D9 copy voice.

### D1 — URL grammar depth ✅ RESOLVED: two segments
`/explore/<place>/<facet>`, one data-derived facet per indexable page (a facet may encode a category+format pair
like `wine-tastings`). Deeper filters (date, extra category) are on-page query params, `noindex`, canonical → the
bare page. (Rejected: 3-segment `/place/category/format` — explodes page count; single-axis-only — can't express pairs.)

### D2 — Place model ✅ RESOLVED: auto-generate places (with hybrid indexing)
**Owner call:** don't maintain a places table — *render a place page for any place slug that has published events*,
let popularity emerge, and hand-pick the winners into the sitemap later. Adopted as a hybrid:
- **Render (no gate):** `/explore/<place>` resolves if `<place>` slugifies to a distinct published `country` **or**
  `city` value (else 404). Slug→filter resolution: a slug matching a country filters by `country`; a slug matching
  only a city filters by `city`. This auto-handles Singapore/Hong Kong (slug matches the country, which is also the
  city) and Tokyo/Bangkok (slug matches the city, country inferred). No `explore_places` table is created.
- **Index (thin-content guard):** a page below **≥3 upcoming events** renders but emits `noindex,follow`, so
  auto-generated sparse/junk pages never risk a thin-content penalty. Above the threshold → `index,follow`.
- **Sitemap (owner-curated amplification):** the sitemap does NOT auto-include every place. An owner-editable
  **allowlist** (`explore_sitemap_slugs` table, edited from the new admin "Explore / SEO" tab — D3b) lists the
  place/facet URLs the owner promotes. Pages can still rank before promotion (Google finds them via the hub's
  internal links); the sitemap is the owner's amplification lever, matching "the popular ones get added by me."
- **Known trade-offs accepted:** free-text city spelling variants ("Ho Chi Minh City" vs "Saigon") produce two
  separate pages; different cities can slugify to a collision. These stay `noindex` + unlinked unless promoted, so
  the blast radius is contained. If drift becomes a problem later, add a normalisation/alias map (Phase 2).
- **Hub internal-linking:** to avoid crawl-flooding Google with every long-tail place, the `/explore` hub links only
  the **top-N places by upcoming-event count** (plus anything on the sitemap allowlist). Long-tail pages still
  resolve directly but aren't broadcast.

> **Correction (owner was right, 2026-07-08):** facets ARE data-derivable too. Every event carries its
> `drink_categories` + `event_format`, so `SELECT DISTINCT` yields the live category set, format set, and the
> (category, format) pairs that actually occur. Slug + H1 are a deterministic *code* function of the label (slugify +
> simple pluralize + template), so **nothing is configured** — see D3. Places AND facets both auto-generate.

### D3 — Facets ✅ RESOLVED: auto-generated from data, NO config
Facets are derived in code from the live taxonomy + the (category, format) pairs present in published events. A
deterministic slug + H1 scheme (verified against the real labels) — **nothing for the owner to maintain:**

| Facet kind | Slug rule | H1 template | Examples (verified) |
|---|---|---|---|
| Category | `slugify(label)` (singular) | `{Category} Events in {place}` | `whisky`, `wine`, `tequila-mezcal`, `cognac-brandy` |
| Format | `pluralize(slugify(label))` | `{Format-plural} in {place}` | `masterclasses`, `festivals`, `bar-takeovers`, `trade-events` |
| Pair (cat+fmt) | `slugify(cat)-pluralize(slugify(fmt))` | `{Category} {Format-plural} in {place}` | `wine-tastings`, `whisky-masterclasses`, `beer-festivals` |

- **`pluralize` rule** (small pure code helper, not config): add `es` after `s/x/z/ch/sh`, `…y`→`…ies`, else `s`.
  Confirmed correct for all 8 format labels (`masterclass`→`masterclasses`, `launch`→`launches`, etc.).
- **`Other`** (present in both category and format taxonomies) is **excluded** — a catch-all with no SEO value; it
  never gets a facet page. This also removes the only slug collision between the two axes.
- **Which facets get PAGES:** any facet whose filter returns ≥1 published event *renders*; the rest 404. Category-
  and format-only facets are linked from each place page (the axes present there). **Pair** facets resolve on demand
  (a typed or admin-promoted URL works) but are NOT broadcast via internal links by default — that keeps the crawl
  surface bounded without configuration. Indexing still follows the ≥3-events threshold + owner sitemap allowlist.
- **Copy polish (deferrable, non-blocking):** two auto-H1s read slightly awkwardly — "Cocktails Events" (label is
  already plural) and "Tequila/Mezcal Events" (slash). Fine to ship; a tiny per-label display-override map can smooth
  them later if wanted. This is the *only* thing that would ever be "configured", and it's optional.

### D3b — Sitemap/index curation ✅ RESOLVED: admin dashboard tab
The one human-curated piece. A new **"Explore / SEO" tab in the existing admin dashboard** lets the owner add/remove
specific `<place>/<facet>` (and bare `<place>`) URLs to promote into `sitemap.xml` and pin to `index` — see the new
§7A for the full spec. Backed by the `explore_sitemap_slugs` table (§4), admin-session-guarded like the other
listing-mutating endpoints (plan.md §5 carve-out).

### D4 — Date windows ✅ RESOLVED: on-page only (indexable date-URLs = future step)
Date modules (Today, Tomorrow, This weekend, This week, Next week, This month, 3 months) are **on-page filter chips
only** — query param `?date=this-weekend`, `noindex`, canonical → the dateless page. Rationale: "this weekend"
resolves to different actual dates every week; a static indexable URL whose content churns daily hurts SEO.
**Future step (deferred, tracked in §10 Phase E as an incomplete item):** later we may mint indexable
`/explore/<place>/<facet>/this-weekend` URLs (as Eventbrite does) with careful canonical/lastmod handling once event
volume justifies it — e.g. the desired "Whisky Masterclasses This Weekend in Singapore" as its own URL.

### D5 — "Free" / price facet ✅ RESOLVED: dropped from launch
`free` is out of scope. Events have a *listing fee* (organiser→us) but **no attendee admission price / free flag** in
the schema, so "Free Drinks Events" can't be built without a submit-flow + `event_versions` change. Deferred to the
Phase 2 candidate list (§9). Original options retained for the record:
- **(A) Chosen — drop `free` from launch scope.** Ship without it; revisit once there's demand.
- (B) Add an optional `admission` field to the submit form + `event_versions` (e.g. `is_free BOOLEAN` or a
  `price_from NUMERIC`), backfilled NULL, surfaced as a `free` facet. This is a submit-flow + schema + validation +
  admin-edit change — a mini-project of its own, not just an explore concern.

### D6 — Rendering & caching strategy
The app currently uses **`getServerSideProps` (SSR) everywhere**. You said "cached … page". Options for explore:
- **(A) Recommended — keep SSR, add HTTP cache headers** (`Cache-Control: s-maxage=… stale-while-revalidate`, the
  pattern already used in `sitemap.xml.js`). Vercel's edge caches the HTML; consistent with the rest of the app;
  works cleanly through the App Proxy. ← **recommend**
- (B) `getStaticProps` + ISR (`revalidate`). True static, but `getStaticPaths` + basePath + App-Proxy signature
  interplay is fiddlier and the pages go stale between revalidations. More moving parts for marginal gain here.

### D7 — Relationship to the existing `/a/events` listing (cannibalisation)
Both surfaces can show "Singapore wine events". To avoid two pages competing for the same query:
- **(A) Recommended — Explore pages are THE canonical SEO surface.** The old `/a/events?...filtered` states get
  `noindex` (or `canonical` → the matching explore page when one exists); `/a/events` bare stays indexable as the
  master board. Explore pages cross-link back to the full board. ← **recommend**
- (B) Leave both indexable and let Google sort it out (not recommended — dilutes ranking).

### D8 — Multi-select filter groups vs. single canonical facet
Your on-page "filter groups for drink categories" implies a user can tick several categories at once. That's great
UX but produces non-canonical filter states. Recommendation: **the ticky filter groups update query params and
refetch client-side (like today's `EventListing`), but are `noindex`; only the single-facet path URLs are the
indexable canonicals.** (This is really a restatement of D1(A) + D7(A) — flagging it so the interaction is explicit.)

### D9 — Copy voice (default stands; override anytime)
- **Place H1/title:** "Explore {Place} Events and Things to do in {Place}" (your wording, verbatim).
- **Facet H1:** the deterministic templates in D3 (e.g. "Wine Tastings in Singapore"). Slugs auto-derived; the
  spellings you named (`hong-kong`, `tequila-mezcal`, `cognac-brandy`, `bar-takeovers`, `trade-events`) all fall out
  of the scheme automatically.
- **Intro paragraph:** templated boilerplate ("Discover upcoming {facet} in {place} — {N} events from the 88 Bamboo
  drinks & hospitality board…"). Owner-written per-place copy is a Phase 2 option.
- Non-blocking — the code ships these defaults; tell me to adjust wording whenever.

---

## 4. Data model additions (per resolved D2/D3)

**Places AND facets are data-driven → NO `explore_places`, NO `explore_facets` table.** Both are derived at request
time from data that already exists:
- **Places** — the distinct published `country`/`city` values in `event_versions`.
- **Facets** — the distinct `drink_categories` (unnested) + `event_format` labels + the (category, format) pairs
  that co-occur in published events. Slug/H1 come from the deterministic code scheme in D3.

The **only** new table is the owner's sitemap/index curation list (feeds the admin tab, D3b):

```sql
-- explore_sitemap_slugs — the owner-curated amplification allowlist (Decisions D2/D3b),
-- managed from the admin dashboard's "Explore / SEO" tab. One row per place/facet URL
-- the owner promotes into sitemap.xml and (optionally) pins to index. Everything NOT
-- listed still RENDERS on demand and can still rank via internal links; it just isn't
-- broadcast in the sitemap. Mirrors the existing reference-table conventions (SERIAL PK).
CREATE TABLE explore_sitemap_slugs (
    id          SERIAL PRIMARY KEY,
    path        VARCHAR(255) NOT NULL UNIQUE,   -- below /explore: 'singapore' or 'singapore/wine-tastings'
    force_index BOOLEAN NOT NULL DEFAULT TRUE,  -- pin index,follow even below the ≥3-events threshold
    created_by  INTEGER REFERENCES admin_users(id) ON DELETE SET NULL,  -- who promoted it (audit)
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Design notes (consistent with the repo's conventions):
- **No taxonomy duplication** — facet filters reuse the existing label columns (`event_versions.drink_categories`,
  `.event_format`) that `/events` already filters on; the derived facet set is computed, never stored.
- **Slug→place / slug→facet resolution needs no table** — at request time, build the valid place-slug set (slugify
  distinct country/city; country wins over city) and the valid facet-slug set (from taxonomy + co-occurring pairs),
  then match the URL against them (404 if no match / no events). A tiny in-request computation, cached by the SSR
  HTTP cache; can be memoised for a few minutes if needed.
- **`explore_sitemap_slugs` is the single source of truth for the sitemap + index-pinning**, edited only through the
  admin tab (D3b / §7A), and admin-session-guarded server-side (plan.md §5 carve-out — it changes what Google sees).

---

## 5. Backend changes (small)

All in `backend/scripts/events.py` (or a new `explore.py` blueprint, auto-registered by the loader). The existing
`GET /events` already does all the filtering; explore needs only **aggregates + a small admin CRUD**:

1. `GET /events/places` — distinct published **countries and cities** with **upcoming counts**, each tagged
   `kind` (`country`/`city`), for: (a) building/validating place slugs, (b) the hub's top-N list, (c) thin-content
   gating, (d) sitemap generation. Mirrors the existing `/events/countries` query, adding `count(*)`, an upcoming
   filter, and a UNION over the city column.
2. `GET /events/facets` — the derived facet set with upcoming counts: distinct unnested `drink_categories`,
   distinct `event_format`, and the co-occurring (category, format) pairs, each returned with its computed slug + H1
   + count. This is what feeds a place page's facet links and the admin tab's "available URLs" picker. (Single-axis
   facets could alternatively be derived frontend-side from the existing `/taxonomy` endpoint; the pairs + counts
   need SQL, so one endpoint is cleanest.)
3. **Admin sitemap CRUD** (new, admin-session-guarded — plan.md §5 carve-out) on `explore_sitemap_slugs`:
   `GET /admin/explore-slugs` (list), `POST /admin/explore-slugs` (add, validates the path resolves + reports its
   live count), `DELETE /admin/explore-slugs/<id>` (remove). Mirrors the existing guarded admin endpoints in
   `backend/scripts/admin.py` + `admin_auth.py`; writes an `admin_actions` audit row.
4. **No change to the core listing query** — the explore grid calls `GET /events?country=…&city=…&category=…&
   format=…&date_from=…&date_to=…&when=upcoming` exactly as-is. A place slug resolving to a country sets `country`;
   to a city sets `city` (slug derived FROM those exact published strings, then matched back — exact-match holds).
5. Facet coverage by the existing listing filters: category ✓, format ✓, pair = category+format ✓, country ✓, city
   ✓, date window via `date_from`/`date_to` ✓ (frontend computes it). **Free** ✗ (D5). No new filter params needed.

---

## 6. Frontend routes & components

New pages (Pages Router, JS, SSR, `verifyProxyRequest` guard at the top of each — the proxy fix already handles the
nested `ctx.params`):

```
pages/explore/index.js               → hub (top-N places by upcoming count + allowlisted slugs)
pages/explore/[place]/index.js       → place landing page (data-derived place)
pages/explore/[place]/[facet].js     → place + facet page
```

Each `getServerSideProps`:
1. `verifyProxyRequest(ctx)` (App-Proxy guard, no-op locally).
2. Resolve `place` against the distinct published country/city sets (country wins over city) → **404 if it matches
   nothing**. Resolve `facet` against the derived facet set (category / format / pair) → **404 if it doesn't decode
   to a real category/format/pair with ≥1 event**. (So any place+facet *with events* renders, but garbage slugs
   404 — no infinite thin-page surface.)
3. Build the `/events` filter params from the resolved place (country|city) + facet (category/format) + any on-page
   date window.
4. Fetch the first grid page SSR (crawlable) + the page's upcoming count.
5. Compute robots: `index,follow` if count ≥ threshold OR the slug is on the sitemap allowlist (`force_index`);
   else `noindex,follow`. Set `Cache-Control` (D6 default A).

Shared components (extract from `EventListing.js`, don't duplicate):
- `EventGrid` / `EventCard` — lift the existing grid card out so both surfaces share it (surgical: move, don't
  rewrite).
- `ExploreFilters` — the filter-group UI: drink-category chips, format chips, and the **date-window chips** (Today /
  Tomorrow / This weekend / This week / Next week / This month / 3 months). Chips update query params + client-refetch
  (reusing the debounced `eventsService.getListing` pattern already in `EventListing`), and are `noindex`.
- `Breadcrumbs` — Home › Events › Explore › {Place} › {Facet}, with `BreadcrumbList` JSON-LD.
- `ExplorePageShell` — H1 + templated intro + search prompt (a search box that deep-links into `/a/events?q=`).

**Date-window helper** (new `core/utils/dateWindows.js`): pure functions mapping `'this-weekend'` → concrete
`{date_from, date_to}` ISO instants, UTC-pinned to match the existing `EventListing` calendar convention (avoids the
hydration mismatch called out in that file). Unit-testable (plan §1 values cheap tests).

---

## 7. SEO specifics

- **Titles / H1 (per D9):**
  - Place: `<title>` and H1 = **"Explore {Place} Events and Things to do in {Place}"**.
  - Facet: H1 from the deterministic D3 template (e.g. "Wine Tastings in Hong Kong"); `<title>` mirrors it + " | 88
    Bamboo Events".
  - Meta description templated from place/facet + live count.
- **Canonicals:** each explore page's `rel=canonical` = its own clean apex URL
  (`https://www.88bamboo.co/a/events/explore/…`), built by extending `core/utils/seo.js`. Query-param filter states
  canonical back to the bare page (D1A/D4A/D8). This is the same apex-form logic `eventCanonicalUrl` already uses.
- **Structured data:** `CollectionPage` + `ItemList` of the events on the page (each item an `Event`, reusing
  `buildEventJsonLd`'s per-event shape), plus `BreadcrumbList`. New builders in `seo.js`.
- **Thin-content gating (D2):** below **≥3 upcoming events** → `<meta name="robots" content="noindex,follow">`,
  unless the slug is on the owner's `explore_sitemap_slugs` allowlist (`force_index`). Empty place (0 events) → still
  renders with an empty-state + "list your event" CTA, but `noindex`.
- **Sitemap (owner-curated, per D2):** extend `pages/sitemap.xml.js` to emit the explore hub + every URL on
  `explore_sitemap_slugs` (the owner's promoted set) that currently resolves. NOT every auto-generated place — the
  owner picks winners. As the URL count grows past the current single-file 100-cap note, split into a sitemap index
  (the growth path already flagged in that file).
- **Interlinking (the SEO multiplier):** hub → places → facets → events, and back up via breadcrumbs; place pages
  list their available facets; the main `/a/events` board links to the explore hub. Internal links are how these
  pages get crawled and pass equity.
- **No apex→www redirect, `skipTrailingSlashRedirect`** stay as-is; explore URLs live under the same basePath and
  proxy exactly like every other page (verified path via commit `75b7f94`).

---

## 7A. Admin dashboard "Explore / SEO" tab (Decision D3b)

A new tab in the existing admin dashboard (`components/views/admin/…`, opened at
`https://events.88bamboo.co/a/events/admin` where cookies survive — plan.md §4). It is the owner's control surface
for what gets promoted into the sitemap / pinned to index. **This is the only human-curated part of the whole layer.**

What it does:
- **Add a URL to promote** — the owner picks a place (from the derived places list, with live counts) and optionally
  a facet (from the derived facet list for that place, with live counts), or types a `place/facet` path. On save it
  validates the path *resolves to a real page* and shows its current upcoming-event count (warns, but still allows,
  if 0 — useful for pre-seeding a city you're about to fill). Writes an `explore_sitemap_slugs` row + `admin_actions`
  audit entry.
- **List / remove** promoted URLs, each showing its live count + current index state.
- **`force_index` toggle** per row — pin `index,follow` even below the ≥3-event threshold (for a page you're
  deliberately seeding).

What it deliberately does NOT do (keeps it simple, honours "I don't want to configure it"):
- No editing of slugs, H1s, or filter mappings — those are auto-derived in code. The tab only curates *promotion*,
  not the facet catalogue.

Backing: the admin CRUD endpoints in §5.3 (session-guarded server-side). Frontend service mirrors
`core/services/admin.js`. UI mirrors an existing admin tab (e.g. `PricingTiers` — a simple guarded list+add+remove
CRUD panel) so it drops into the current dashboard shell with no new patterns.

---

## 8. Risks / edge cases to handle

- **Thin/duplicate pages** — the biggest programmatic-SEO risk; mitigated by 404ing slugs with no matching events,
  noindex-below-threshold, and only broadcasting the owner-curated allowlist in the sitemap.
- **Free-text city drift** (accepted with auto-generate, D2) — "Ho Chi Minh City" vs "Saigon" produce two pages;
  both stay `noindex` + unlinked until promoted, containing the damage. A normalisation/alias map is the Phase 2 fix
  if drift becomes real.
- **Singapore/Hong Kong country==city ambiguity** — resolved by the "country wins over city" slug rule: the slug
  matches the country, filters by country (which for a city-state includes the city too).
- **`Other` taxonomy value** — excluded from facet generation (catch-all, no SEO value; also removes the one
  category/format slug collision).
- **Pair-facet explosion** — bounded by only rendering pairs with ≥1 real event and not auto-linking them; the crawl
  surface stays proportional to actual data.
- **Date-window content churn** — mitigated by keeping date windows out of the index (D4A).
- **Cannibalisation** with `/a/events` filters — mitigated by D7A canonical/noindex policy.
- **Cache staleness** — a newly-approved event won't appear on a cached explore page until `s-maxage` lapses;
  acceptable at a few minutes (`stale-while-revalidate`), same trade-off as the sitemap already makes.
- **Empty launch places** — a place page for a city with no events yet is legitimate (SEO seeding) but must be
  `noindex` + show a strong "be the first to list" CTA.

---

## 9. Out of scope for launch (candidate Phase 2)
- **Indexable date-window URLs** (D4) — e.g. `/explore/singapore/masterclasses/this-weekend`, "Whisky Masterclasses
  This Weekend in Singapore" as its own URL. Deferred but explicitly wanted later; tracked as an incomplete Phase E
  step below.
- The `free`/price facet (D5) — needs a submit-flow + `event_versions` schema change.
- Free-text city **normalisation/alias map** (the D2 drift fix).
- Region/neighbourhood sub-pages (e.g. `/explore/singapore/orchard`).
- Editor-written unique intro copy per place; a per-label H1 display-override map (the D3 copy-polish nicety).

---

## 10. CHECKLIST — the AI updates this every round
Legend: `[ ]` todo · `[x]` done · `[~]` in progress.

### Phase A — Decisions (owner)
- [x] D1 URL grammar → two-segment `/explore/<place>/<facet>`
- [x] D2 place model → auto-generate places from data; ≥3-events index threshold; owner-curated sitemap allowlist
- [x] D3 facets → auto-generated from taxonomy + event data (no config); deterministic slug/H1 scheme
- [x] D3b sitemap/index curation → new admin "Explore / SEO" dashboard tab
- [x] D4 date windows → on-page only (indexable date-URLs deferred to Phase 2)
- [x] D5 `free` → dropped from launch
- [x] D6 caching → SSR + `s-maxage`/`stale-while-revalidate` (locked §11)
- [x] D7 cannibalisation policy → explore canonical, filtered `/a/events` noindex (locked §11)
- [x] D9 copy voice + nav placement → defaults locked, no nav item at launch (locked §11)

### Phase B — Data / config
- [x] `explore_sitemap_slugs` table (the ONLY new table) — starts empty; owner adds winners via the admin tab.
      DDL in `database/schema.sql` (fresh local `docker compose up`) + hand-apply migration
      `database/migrations/ex1-explore-sitemap.sql` (idempotent `IF NOT EXISTS`, mirrors ep7).
- [x] NO `explore_places`, NO `explore_facets` table (both data-derived) — confirmed; none created.
- [x] `core/utils/exploreFacets.js` — deterministic slugify + pluralize + H1 templating (+ unit tests).
      No deviation from the D3 slug/H1 scheme. Tests: `core/utils/exploreFacets.test.mjs` (17 cases,
      all pass) run via Node's built-in runner, no new dependency: `cd frontend && node --test
      'core/utils/**/*.test.mjs'`. Also exports `buildFacetSlugMap`/`placeSlug`/`resolvePlaceSlug` +
      `resolveFacetSlug`/`resolvePlaceSlug` reversers for Phase C/D to reuse.

### Phase C — Backend
- [x] `GET /events/places` — distinct countries+cities with upcoming counts + `kind` tag. Added to
      `backend/scripts/events.py` (routes must live in the `/events` blueprint — the loader mounts by
      filename). UNION of the country + city columns over the published+upcoming set; a city-state
      returns two rows (kind='country' + kind='city'). Verified locally: counts match manual SQL.
- [x] `GET /events/facets` — distinct categories, formats, and REAL co-occurring (cat, fmt) pairs, each
      with upcoming counts. `Other` excluded from all three groups; past events excluded. Verified
      locally against manual SQL.
- [x] Admin CRUD on `explore_sitemap_slugs` (`GET/POST/DELETE /admin/explore-slugs`) in
      `backend/scripts/admin.py`, `@admin_required` (plan §5.3 carve-out), `admin_actions` audit row on
      every write. Verified: unauthenticated + bad-token → 401; POST validates the path resolves (422
      otherwise), reports the live count, allows count=0 with `warning_empty` (§7A pre-seeding), 409 on
      duplicate; DELETE 404s a missing id; GET annotates each row with live count + `resolves`.
- [x] Slug→place + slug→facet resolvers wired to real DB data + confirm `/events` filters cover every
      facet; unit-tested. Resolvers live in `backend/explore_facets.py` (see DEVIATION below);
      `count_explore_events` reuses the exact `/events` listing predicates (country|city, category via
      `= ANY`, format exact, published+upcoming). Tests: `backend/tests/test_explore_facets.py`
      (21 cases: pure slug parity with the JS module + cursor-driven resolution via a `FakeCursor`,
      matching the `test_slugs.py` convention).

> **DEVIATION / decision (owner, 2026-07-09) — slug/H1 location.** Plan §5.2's literal wording had
> `/events/facets` return "slug + H1". Resolved to keep slug/H1 DISPLAY single-source in the JS module
> (`frontend/core/utils/exploreFacets.js`): both `/events/places` and `/events/facets` return **RAW
> taxonomy labels + counts**, and the frontend derives every slug + H1. The one thing that can't be
> frontend-only — the admin `POST /admin/explore-slugs` path-validation — is backed by a MINIMAL Python
> port of only the slug *reversers* (`slugify_label`/`pluralize_slug`/`resolve_facet_slug`/
> `resolve_place_slug` + the cursor-driven `resolve_explore_path`/`count_explore_events`) in
> `backend/explore_facets.py`. `facetH1`/the H1 templates were deliberately NOT ported, so the H1
> scheme has one source of truth. Parallel tests (JS `exploreFacets.test.mjs` + Python
> `test_explore_facets.py`) guard the two slug implementations against drift.
>
> **Note on `/admin/explore-slugs` POST validation:** task called for "resolves to a page WITH events".
> Reconciled with §7A ("warns but still allows if 0, for pre-seeding") — the path must resolve
> STRUCTURALLY (real place; real facet if present) else 422, but a 0-event count is allowed and flagged
> via `warning_empty` in the response for the UI to surface.

### Phase D — Frontend
- [x] `core/utils/dateWindows.js` (+ unit tests). 7 window keys → UTC-pinned {date_from,date_to}
      matching EventListing's calendar convention. Tests: `core/utils/dateWindows.test.mjs`
      (10 cases; run with the exploreFacets suite via `cd frontend && node --test
      'core/utils/**/*.test.mjs'` → 27 pass).
- [x] Extract shared `EventGrid`/`EventCard` from `EventListing.js` → new
      `components/views/publicPages/EventListing/EventGrid.js` (MOVED verbatim: EventCard +
      excerptOf + truncateAtWordBoundary). EventListing.js re-exports EventCard/
      truncateAtWordBoundary so EventDetail's "More events" import is unchanged. Regression
      verified live: `/a/events` renders 4 cards, detail page 3 "More events" cards — identical.
- [x] `pages/explore/index.js` (hub) — top-N places by upcoming count from GET /events/places,
      country-wins dedupe by slug. Placeholder <title> + unconditional `noindex,follow`.
- [x] `pages/explore/[place]/index.js` (place) — verifyProxyRequest → resolvePlaceSlug (404 on
      miss) → SSR grid + accurate place count. Verified: /explore/singapore, /explore/tokyo render.
- [x] `pages/explore/[place]/[facet].js` (facet) — + resolveFacetSlug (404 on miss). Verified:
      wine-tastings (pair, 2 events), wine (cat), masterclasses (fmt); beer-festivals + garbage → 404.
- [x] `ExploreFilters` (category/format/date chips) — reuses EventListing's debounced
      eventsService.getListing pattern; shallow router.replace reflects on-page query params. Whole
      page is noindex in Phase D so no per-chip noindex needed (per plan). Chip-filter query path
      verified against the live API.
- [x] `Breadcrumbs` + `ExplorePageShell` (H1 + templated intro + /a/events?q= search box). Trail
      Home › Events › Explore › {Place} › {Facet} verified rendering on the facet page.
- [x] Admin "Explore / SEO" tab (`components/views/admin/ExploreSlugs/`, registered in
      AdminDashboard) — mirrors `PricingTiers` panel + `admin.js` service (getExploreSlugs/
      createExploreSlug/deleteExploreSlug). Backend GET/POST/DELETE + guard verified live with a
      real admin token (401 unauth; 422 unresolved path; warning_empty on 0-count; 404 missing id).

> **DEVIATIONS / notes (Phase D, 2026-07-09):**
> 1. **Hub "+ owner-allowlisted slugs" deferred to Phase E.** The hub lists top-N places only;
>    surfacing promoted slugs needs a PUBLIC read of `explore_sitemap_slugs` (only the
>    admin-guarded CRUD exists), which belongs with the Phase E sitemap/interlinking work.
> 2. **Facet-page upcoming count = SSR grid length** (display only). Place pages use the accurate
>    `/events/places` aggregate; a precise per-(place,facet) count is only needed for Phase E's ≥3
>    robots gating, so it's built there.
> 3. **Admin `force_index` is set at add-time** (checkbox) and shown per-row as a badge; there is
>    no in-place toggle because Phase C shipped only GET/POST/DELETE (no PUT). Changing it = remove
>    + re-add, or a Phase E PUT if wanted.
> 4. **Browser-click verification not re-driven here** (no connected browser in this env; desktop
>    browsers are read-tier). Interactive layers are faithful mirrors of proven in-repo patterns
>    (EventListing debounced refetch; PricingTiers CRUD) and their data/endpoints were verified via
>    curl. Owner should click through the chips + admin add/remove once in a real browser.
> 5. **Seed data:** 4 published events (`explore-*`, "Seed Venue", submitter `seed@88bamboo.co`)
>    were inserted into the local dev DB to walk the flow. Remove with
>    `DELETE FROM events WHERE slug LIKE 'explore-%';` (cascades to versions) if unwanted.

### Phase E — SEO plumbing
- [ ] Extend `core/utils/seo.js` (explore URLs, CollectionPage/ItemList/BreadcrumbList)
- [ ] Titles/H1/meta templates
- [ ] noindex-below-threshold gating
- [ ] Extend `sitemap.xml.js` to emit hub + `explore_sitemap_slugs` (owner-curated), not every auto-page
- [ ] Interlinking: hub↔place↔facet↔board (hub links top-N places to avoid crawl-flooding)
- [ ] ⏳ DEFERRED (Phase 2, per D4): indexable date-window URLs `/explore/<place>/<facet>/<date-window>` with
      canonical/lastmod handling — the "…This Weekend in…" page type. Not built at launch; left as a known next step.

### Phase F — Verify
- [ ] Local end-to-end: seed events across ≥2 places, walk hub→place→facet→event
- [ ] View-source check: correct `<title>`, canonical, JSON-LD, robots per page
- [ ] Confirm nested dynamic routes verify through the proxy in prod-like config

### Blockers / questions
- (populate as they arise)

---

## 11. Final defaults — LOCKED 2026-07-08 (owner: "lock in those defaults")
1. **Nav placement:** NOT in the store nav at launch. `/explore` is discovered via internal links (hub↔place↔facet↔
   board) + Google only. Revisit if the owner wants a nav item later.
2. **Caching (D6):** SSR + `Cache-Control: s-maxage / stale-while-revalidate` (same pattern as `sitemap.xml.js`).
   No ISR/`getStaticProps`.
3. **Cannibalisation (D7):** Explore pages are the canonical SEO surface. Filtered `/a/events?...` query states get
   `noindex`; the bare `/a/events` board stays indexable. Explore pages link back to the full board.
4. **H1 flavour:** plain auto-templates, no global flavour word — "Masterclasses in Singapore", "Whisky Events in
   Singapore", "Wine Tastings in Hong Kong". Adjustable later as a one-line template tweak if desired.

All decisions (D1–D9, D3b) are now resolved. Nothing left blocking implementation.
