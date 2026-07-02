# PLAN.md — 88 Bamboo Events Listing System

> **This is the master working document for the AI coding assistant building this project.**
> It is fully self-contained: everything you need is in this file plus `PATTERN-SPEC.md` in this repo.
> You do **NOT** have — and must never request — access to the Drink-X repository (`drinkx-monorepo`).
> `PATTERN-SPEC.md` is the authoritative, annotated extraction of every Drink-X pattern worth mirroring.
> Where this file says "mirror the X pattern (SPEC §Y)", read that section of PATTERN-SPEC.md and replicate the documented pattern.
> Where PATTERN-SPEC.md carries an annotation like "EVENTS APP:" or "⚠️", that annotation OVERRIDES the surrounding Drink-X description.
> **After each working session, update the checklist at the bottom of this file** — mark items done, add discovered sub-tasks, note blockers.

---

## 1. Mission (what we're building and for whom)

The owner runs 88bamboo.co, a Shopify-hosted publication covering the global beverage and hospitality industry. We are adding a **self-serve paid events listing system**: businesses, bars, brands, agencies, and organisers submit drinks/hospitality events, pay a small fee (USD 5 default), and the listing goes live **only after the owner approves it** in a custom admin dashboard. It is a curated listings billboard, NOT a ticketing platform. The full submission + payment flow is automated; approval is the only human step.

The owner is a "vibe coder" — building with AI assistance, limited programming depth. Explain terms when they matter, say plainly when something is a dashboard task for the owner vs code for you to write, and never leave gaps for them to silently fill.

**The single most important constraint:** public event pages must live at **`www.88bamboo.co/a/events/...`** on the apex domain and be fully Google-indexable. This is achieved with **Shopify App Proxy**: users and Google only ever see the apex URL; Shopify server-side-fetches the HTML from a backstage Vercel origin. The address bar never leaves `www.88bamboo.co`.

---

## 2. Ground rules for the AI

1. **No Drink-X repo access.** Everything transferable is in `PATTERN-SPEC.md`. Never ask for the repo; never invent details about it. If the SPEC doesn't cover something, ASK the owner or make a clearly-flagged reasonable choice consistent with the SPEC's conventions.
2. **Annotations win.** PATTERN-SPEC.md documents Drink-X as-is, then annotations mark corrections and divergences for this app. Annotation > body text.
3. **Secrets are never hardcoded** — always environment variables. Never ask the owner to paste secret values into chat; tell them which env var to set and where.
4. **Local first.** The entire flow must run and be provable on the owner's machine (docker-compose + Stripe test mode + local mailer) before any cloud deployment work.
5. **Update the checklist** (Section 10) at the end of every round: check off completed items, append newly-discovered tasks under the right phase, and record open questions under "Blockers / questions".

---

## 3. Resolved infrastructure facts (do not re-ask these)

| Fact | Value |
|---|---|
| AWS account / region | `851725425890` / `ap-southeast-1` (Singapore) |
| VPC for events resources | `vpc-0d2c20f48f851c971` |
| Database | NEW isolated **RDS PostgreSQL** instance (`db.t4g.micro`, single-AZ, private). Reference: the existing `drinkxprod` is plain RDS Postgres (NOT Aurora) |
| Backend compute | NEW ECS cluster `88bamboo-events`, ONE public **Fargate** service `events-api` behind a NEW ALB with an ACM cert for `events-api.88bamboo.co` |
| Frontend hosting | **Vercel** — new project, monorepo root directory `frontend/`, Framework Next.js, Node 24, **region `sin1`**, auto-deploy: feature branch → Preview, `main` → Production |
| ECR | registry `851725425890.dkr.ecr.ap-southeast-1.amazonaws.com`, ONE new repo `be-88bamboo-events` (backend only — frontend ships via Vercel, no image) |
| Image storage | NEW **public** S3 bucket (mirror the public-image pattern, SPEC §A5) |
| Email | AWS SES, **already out of sandbox** (50k/day). Verify domain identity 88bamboo.co (root); from-address events@88bamboo.co. SES DKIM CNAMEs are additive and do not affect existing M365/Mailchimp mail. |
| DNS | ALL records for 88bamboo.co are added in **Shopify Admin → Settings → Domains → manage DNS** |
| Google Search Console | 88bamboo.co likely already verified (existing TXT records) — go straight to sitemap submission |
| Secrets storage | Backend: `.env` file baked into the image + ECS task env (no Secrets Manager/SSM). Frontend: **Vercel dashboard env vars** |
| Deploy | Backend: manual `docker-build.sh` → `docker-push.sh` (ECR) → `aws ecs update-service --force-new-deployment`. Frontend: git push (Vercel) |

**The two subdomains and their jobs (never conflate):**
- `events.88bamboo.co` → CNAME to **Vercel**. Backstage only: the App Proxy fetch origin + where the owner opens the admin dashboard. Users never navigate here.
- `events-api.88bamboo.co` → CNAME to the events **ALB**. The public Flask API.

---

## 4. Architecture

**Monorepo layout** (mirror the monorepo shape, SPEC §A1/§B1): `frontend/` = Next.js app `events-web`; `backend/` = Flask API `events-api`; `database/` = plain `.sql` schema files; plus `docker-compose.yml` for local.

```
                      Shopify App Proxy (prefix a, subpath events)
www.88bamboo.co/a/events/*  ────────────►  events-web on VERCEL
(the ONLY URL users/Google see)            Next.js, basePath '/a/events', region sin1
                                           backstage origin: events.88bamboo.co
                                                │
browser (public pages) ─────────────────────────┤ NEXT_PUBLIC_API_URL (CORS)
                                                ▼
events-api.88bamboo.co ──► events ALB ──► events-api (Flask/Fargate) — PUBLIC
                                                ├─► RDS PostgreSQL (private)
                                                ├─► S3 public images 
                                                ├─► SES (88bamboo.co)
                                                └─► Stripe
```

**Frontend (`events-web`):** Next.js 16, **Pages Router**, React 19, **JavaScript (no TypeScript)**, Tailwind + Bootstrap (SPEC §B). `getServerSideProps` SSR for all public event pages. Mirror the client/server API base-URL split pattern (SPEC §B2, the `core/config/api.js` pattern: browser uses `NEXT_PUBLIC_API_URL`; SSR can use `API_INTERNAL_URL` when set). Mirror the services-layer fetch organisation (SPEC §B2) and component/styling organisation (SPEC §B4). **`basePath: '/a/events'`** in next.config. **Do NOT implement any apex→www redirect** (Drink-X has one; it would break proxying — SPEC annotation). Add the events image bucket host to `images.remotePatterns`.

**Backend (`events-api`):** Flask 3.0.2, Python 3.11, gunicorn/gevent on port 5000, `/health` endpoint (SPEC §A1). One Blueprint per file in `scripts/`, auto-registered by the loader pattern (SPEC §A2). Database access via the pooled `DatabaseManager` pattern with parameterized `%s` psycopg2 queries — **no ORM, no Alembic** (SPEC §A3). Config via `.env` + `os.getenv` (SPEC §A4). S3 uploads server-side via the `s3Images.py` pattern — `put_object`, uuid key, public URL stored in DB, `PURPOSE` env selecting bucket/creds (SPEC §A5). SES via `boto3 sesv2` (SPEC §A7). Scheduled jobs via APScheduler (SPEC §A1/§A8 — scripts/scheduled_tasks.py, APScheduler 3.10.4). CORS: allow `https://www.88bamboo.co` and `https://events.88bamboo.co` in production; permissive locally.

**Public vs backstage:** everything user-facing renders through the proxy at the apex. The admin dashboard lives at route `/a/events/admin` but is opened directly at `https://events.88bamboo.co/a/events/admin` because Shopify's proxy strips cookies and the admin auth needs them.

**App Proxy mechanics:** Shopify signs proxied requests (HMAC, query-param signature). Middleware verifies it using `SHOPIFY_SHARED_SECRET` — but ONLY when `SHOPIFY_PROXY_VERIFY=true`; locally it's `false` because no proxy exists there. Proxied responses are cookie-stripped, so nothing served through the proxy may depend on cookies (magic-link editing uses a URL token instead).

**SEO (non-negotiable, mirror SPEC §B3):** every event detail page is SSR full HTML with `<title>`, meta description, **schema.org/Event JSON-LD** (name, startDate, endDate, eventStatus, location w/ PostalAddress, image, description), and `<link rel="canonical">` to `https://www.88bamboo.co/a/events/<slug>`. Canonical-slug enforcement via `getServerSideProps` redirect (SPEC §B3 pattern). Slugs = name + city, deduped with a short suffix. A sitemap page route (SPEC §B3 `sitemap.xml.js` pattern) lists all approved event URLs at `/a/events/sitemap.xml`. Expired events stay public/indexable, clearly badged "This event is over."

---

## 5. Deliberate divergences from the SPEC (do not copy these Drink-X behaviours)

1. **Stripe.** Drink-X uses Subscriptions with price IDs (SPEC §A4 Stripe annotation). This app uses **PaymentIntents with `capture_method=manual`** — all payment code is NEW. Reuse only the shape: secret key from env, `client_secret` to the client, Stripe Elements, webhook handler verified with `STRIPE_WEBHOOK_SECRET`.
2. **basePath + no redirect.** Drink-X serves at domain root with an apex→www redirect. This app: `basePath '/a/events'`, no redirect.
3. **Admin auth carve-out.** MVP mirrors the Drink-X auth pattern (SPEC §A6: client-hashed password, cookie + localStorage session, `getServerSideProps` page guard) — BUT the four backend endpoints that move money or change live listings (**approve, reject/refund, capture, unpublish**) MUST verify the admin session server-side before acting. Drink-X leaves backend routes unguarded (SPEC §A6 ⚠️ annotation); these four cannot be. Also omit everything the SPEC flags as not applicable: social sign-in, APNs/Firebase push, the users/producers/venues account tables — this app has only `admin_users` + magic links.

---

## 6. Payment rules (exact behaviour)

USD 5 default, single tier at launch, tiers configurable in admin (data model supports more). Flow: submitter completes form + image → `events-api` creates & confirms a PaymentIntent (`capture_method=manual`) → card **authorised, not charged** → store `payment_intent_id` + Stripe's **`capture_before`** expiry timestamp (read it per intent; never hardcode 7 days) → status `pending_review` → emails to admin (new submission) and submitter (under review).

- **Approve** → capture the PaymentIntent → publish → approval email.
- **Reject** → cancel the PaymentIntent (free release, no fee) → rejection email with admin-editable reason.
- **Hard rule — no authorisation ever expires unactioned:** an **hourly job** finds payments still `authorised` + `pending_review` with `capture_before` within 24h, **cancels** them (free), marks `auto_rejected_expired`, emails the submitter to resubmit. NEVER auto-capture unapproved submissions (capture-then-refund forfeits the Stripe fee).
- **Admin reminders:** daily pending digest + alerts at 48h and 24h before any expiry; dashboard shows an expiring-soon countdown.
- **PayNow is excluded** from MVP (immediate-payment only; incompatible with hold/capture).
- **Failure states to handle:** authorise-succeeds-but-DB-save-fails → cancel the intent in the same flow (no orphan holds); save-succeeds-but-authorise-fails → mark `payment_failed`, prompt retry, don't notify admin; approve-but-capture-fails (card died) → keep pending, email submitter to re-pay via a fresh intent, don't publish; validate the image BEFORE creating any PaymentIntent; abandoned checkout → nothing persisted (or an expiring draft); duplicates → dedupe on (email + event name + date) and flag in dashboard.

---

## 7. Data model (plain SQL, applied with `psql -f`; local auto-seed via `/docker-entrypoint-initdb.d`)

Follow the SPEC §A3 SQL conventions (SERIAL PKs, FKs `ON DELETE SET NULL`, parameterized queries).

- `events` — id, created_at, published_version_id (FK→event_versions, nullable until first approval), submitter_email, current_status, slug (unique).
- `event_versions` — id, event_id FK, version_number, approval_status (`pending_review`/`approved`/`rejected`/`auto_rejected_expired`), name, start_datetime, end_datetime, venue_name, venue_address, country, city, description, link, contact_email, image reference, submission_type, drink_categories (multi), event_format (single), created_at, reviewed_at, rejection_reason.
- `payments` — id, event_version_id FK, provider, payment_intent_id, amount, currency, status (`authorised`/`captured`/`cancelled`/`auto_released`), capture_before, created_at, captured_at.
- `pricing_tiers` — id, label, price, currency, featured_duration_days (nullable), active. Seed one row: USD 5 standard.
- `magic_links` — id, event_id FK, token_hash (never the raw token), expires_at, used_at, created_at.
- `admin_users` — id, email, password_hash, role, active. One row for MVP.
- `admin_actions` — id, admin_user_id, event_id, action, details JSON, created_at.
- `files` — id, event_version_id FK, s3_key, file_type (`image` now; `press_release_pdf` reserved for a later PDF-intake phase), content_type, size_bytes, uploaded_at, is_public.
- 'drink_categories' - id, label, active
- 'event_formats' - id, label, active

**Versioning behaviour:** pre-approval edit → new `event_versions` row (`pending_review`), prior retained. Post-approval edit → live version keeps serving; new pending version awaits approval; on approval, repoint `published_version_id`. Full history always retained. Edits are free at MVP.

**Magic links:** random token, store hash only, 30-min expiry, single-use but tolerate ~3 uses (email scanners pre-click), fresh link per edit request.

**Taxonomy (stored in DB, not hardcoded):** Drink Category (multi-select): Whisky, Wine, Sake, Beer, Cocktails, Rum, Gin, Tequila/Mezcal, Cognac/Brandy, Baijiu, Other. Event Format (single-select): Bar takeover, Masterclass, Tasting, Dinner, Festival, Launch, Competition, Trade event, Other.

---

## 8. Public experience requirements

- **Listing page `/a/events`:** grid + list views (calendar view is Phase-2), filters (date range, drink category, event format, country/city), keyword search across name/venue/description via simple server-side SQL (`ILIKE`), upcoming/past toggle with past events visually muted and badged. Default sort: soonest upcoming first; a **manual country selector** surfaces the chosen country's events first (automatic geolocation is Phase-2).
- **Detail pages `/a/events/<slug>`:** SSR + JSON-LD + canonical, as in Section 4.
- **Homepage widget:** a small standalone JS file (NOT part of Next routing) the owner pastes into the Shopify theme as `<script>` + `<div>`; fetches upcoming events from a public read-only API endpoint; renders responsive branded cards; no iframe.
- **Submitter emails (via SES):** received/under-review, approved, rejected (with reason), magic link, edit received, edit approved. Review-window wording: "Thanks for your submission! Listings are usually reviewed within 3 business days. While we review, your card shows a temporary authorisation (a hold, not a charge). If we approve your listing, it goes live and the USD 5 is charged then. If we reject it, the hold is released and you are never charged. If we can't review it within the authorisation window, the hold is automatically released with no charge and you're welcome to resubmit."
- **Basic abuse controls:** honeypot form field + rate limiting on the submission endpoint. CAPTCHA only if abuse appears.

---

## 9. Two environments (local + production)

**Backend:** ONE `.env` with a LOCAL block active and a PRODUCTION block commented out (toggle before building for deploy — SPEC §C1/§A4 pattern). `PURPOSE=development|production` selects bucket/region/credential source (local: `.env` AWS keys; prod: the ECS task IAM role).

**Frontend:** local `.env.local` (git-ignored) for dev; production/preview env vars live in the **Vercel dashboard** — there is NO `.env.production` file.

| Var | Local | Production | Lives in |
|---|---|---|---|
| `PURPOSE` (api) | development | production | backend `.env` / ECS env |
| `POSTGRES_HOST` (api) | `db` | events RDS endpoint | backend `.env` / ECS env |
| `STRIPE_SECRET_KEY` (api) | sk_test_… | sk_live_… | backend `.env` / ECS env |
| `STRIPE_WEBHOOK_SECRET` (api) | from `stripe listen` | prod webhook whsec_… | backend `.env` / ECS env |
| `SHOPIFY_SHARED_SECRET` (web+api) | set (unused locally) | custom-app secret | backend env + Vercel |
| `SHOPIFY_PROXY_VERIFY` (web+api) | `false` | `true` | backend env + Vercel |
| `NEXT_PUBLIC_API_URL` (web) | http://localhost:5001 | https://events-api.88bamboo.co | `.env.local` + Vercel |
| `API_INTERNAL_URL` (web) | http://backend:5000 (compose) | empty | `.env.local` + Vercel |
| `NEXT_PUBLIC_BASE_URL` (web) * derive canonical base from NEXT_PUBLIC_BASE_URL + basePath | http://localhost:8080 | https://www.88bamboo.co | `.env.local` + Vercel |
| SES sender (api) | local mailer / MailHog | events@88bamboo.co | backend env |

**Local stack:** `docker compose up --build` → `db` (Postgres 15, seeded from `database/*.sql`) + `events-api` + `events-web` (dev target, hot reload). Ports bound to 127.0.0.1; healthcheck-gated depends_on; re-seed with `down -v`. Local gotchas: no App Proxy locally (browse `http://localhost:8080/a/events`); Stripe webhooks via `stripe listen --forward-to localhost:5001/<webhook path>`; never send real email locally. **Local host ports (per docker-compose.yml): events-web 8080, events-api 5001→container 5000, db host 5433 (container Postgres stays 5432; the backend reaches it internally as `db:5432`).**

---

## 10. CHECKLIST — the AI updates this every round

Legend: `[ ]` todo · `[x]` done · `[~]` in progress/partial. Add sub-items as discovered. Keep notes short.

### Phase 0 — Prerequisites (owner)
- [x] Shopify custom app "88 Bamboo Events" created; App Proxy prefix `a`, subpath `events`, placeholder proxy URL; shared secret saved
- [x] Stripe test keys saved (pk_test / sk_test)
- [ ] Docker Desktop installed and running
- [ ] Stripe CLI installed
- [ ] `PATTERN-SPEC.md` committed into this repo (secrets redacted)

### Phase 1 — Scaffold
- [x] Monorepo structure: `frontend/`, `backend/`, `database/`, `docker-compose.yml`
- [x] Backend skeleton: Flask 3.0.2 / Py 3.11, blueprint auto-loader (`create_routes` in `backend/app.py`), pooled psycopg2 `DatabaseManager`, `/health` (+ `/health/db`), multi-stage gunicorn/gevent `Dockerfile.backend` (SPEC §A1–§A3)
- [x] Frontend skeleton: Next.js 16 Pages Router, JS, Tailwind (`tw-` prefix) + Bootstrap, `basePath '/a/events'`, NO apex redirect, api-config client/server split (`core/config/api.js`), services layer (`core/services/events.js`), Main layout + `WithLayout` (SPEC §B)
- [x] `.env` (backend, active LOCAL + commented PRODUCTION blocks — `.env.example` template + working git-ignored `.env`) and `.env.local` (frontend `.env.local.example`) templates
- [~] docker-compose: db (seeded from `database/*.sql`) + events-api (alias `backend`) + events-web (dev target, hot reload); 127.0.0.1-bound ports, healthcheck-gated `depends_on`. `docker compose config` validates; **full `docker compose up --build` health not yet proven** — Docker daemon not running in this session (Phase 0 prereq). Owner to run and confirm.
- [x] HMAC middleware gated by `SHOPIFY_PROXY_VERIFY` (backend `shopify_proxy.py` before_request, `/health` exempt; frontend parity helper `core/utils/shopifyProxy.js`). Verified: Python and Node digests match for identical input.

  Discovered sub-tasks / notes:
  - Backend `requirements.txt` is the trimmed §A8 baseline (Mongo/redis/PyJWT[crypto]/firebase-admin/PyMuPDF/pandas etc. omitted per annotations). Grows in Phases 3–4.
  - `database/00-init.sql` currently only enables `pg_trgm`/`unaccent`; the 10-table schema + seed land in Phase 2 as `01-schema.sql`/`02-seed.sql`.
  - APScheduler init is stubbed with a comment in `app.py` (wired in Phase 4).

### Phase 2 — Database
- [x] `database/schema.sql` per Section 7 (all 10 tables, conventions per SPEC §A3). Circular events↔event_versions FK added via post-create `ALTER TABLE`. TIMESTAMPTZ throughout (global board); FKs `ON DELETE SET NULL`; CHECK constraints on the enumerated status/type columns; indexes for the pending queue + hourly capture_before scan + magic-link lookup.
- [x] Seed: one pricing tier (USD 5 Standard), taxonomy (11 drink categories + 9 event formats) in `schema.sql`; admin user seeded from env by `database/seed-admin.sh` (never hardcoded — hash via `database/make-admin-hash.js`, vars in git-ignored `database/.env`; template `database/.env.example`; setup in `database/README.md`).
- [x] Local auto-seed verified: applied the whole `database/` init set in a throwaway `postgres:15-alpine` with the same `/docker-entrypoint-initdb.d` hook — all 10 tables present, seed counts correct (1/11/9/1), circular FK present, insert→repoint roundtrip OK, and the env-driven admin seed works (and cleanly skips when `ADMIN_*` unset). Full `docker compose up` not re-run this session, but the init behaviour it relies on is proven identically.

  Discovered sub-tasks / notes:
  - **Fixed a compose port bug:** `db` published `127.0.0.1:5433:5433`, but the container Postgres listens on 5432, so host access on 5433 never worked. Corrected to `5433:5432` per §9 ("db host 5433 … container Postgres stays 5432"). Backend still reaches it internally as `db:5432`.
  - Schema.sql re-declares the extensions (idempotent) so it also applies standalone to RDS in Phase 7.
  - Design choices flagged in-file: `drink_categories` stored as `TEXT[]` labels and `event_format` as a `TEXT` label on `event_versions` (taxonomy tables drive the form options rather than being FK'd per-selection); `image_url` denormalised on the version with the full record in `files` (avoids a second circular FK).

### Phase 3 — Core flow (CURRENT)
Split into two rounds: **3a = form + image upload** (below, first two items + notes); **3b = payment + transactional persist** (remaining items). Do not build payment code in 3a.
- [ ] Submission form (all fields + taxonomy selects + honeypot + rate limiting on the submission endpoint — §8 abuse controls)
- [ ] Read-only taxonomy endpoint(s) to populate the selects from `drink_categories` / `event_formats` (not hardcoded — §7)
- [ ] Image upload: server-side → public bucket pattern (SPEC §A5); validate type/size BEFORE payment
- [ ] Stripe PaymentIntent manual-capture: authorise on submit; store intent id + `capture_before`
- [ ] Webhook endpoint (verified with `STRIPE_WEBHOOK_SECRET`)
- [ ] Persist submission (`events` + `event_versions` + `payments` + `files`) transactionally; cancel intent if save fails
- [ ] Local proof: submit with 4242… → uncaptured authorisation visible in Stripe test dashboard

  Discovered sub-tasks / notes:
  - **Persistence timing:** the full write (`events` + `event_versions` + `files`) is transactional *with* the PaymentIntent and the intent is cancelled on save failure (§6). So round 3a must NOT fully persist a submission — either hold the validated form data + uploaded image URL, or write an explicit `draft` (§6 "abandoned checkout → nothing persisted, or an expiring draft"); record which was chosen. `payments` rows are written in 3b only.

### Phase 4 — Admin + safety net
- [ ] Admin login (SPEC §A6 pattern) + `getServerSideProps` guard
- [ ] Server-side session check on approve / reject / capture / unpublish (the carve-out)
- [ ] Pending queue with details + image; approve→capture+publish+email; reject→cancel+email (editable reason)
- [ ] Live listings, unpublish, past events, version history, pricing-tier CRUD, analytics incl. expiring-soon countdown
- [ ] Hourly auto-release job + daily digest + 48h/24h alerts (APScheduler)
- [ ] All transactional emails wired (local mailer)

### Phase 5 — Public pages + SEO
- [ ] Listing page: grid + list, filters, search, upcoming/past toggle, country selector, soonest-first sort
- [ ] Detail pages: SSR, JSON-LD, canonical, slug generation + canonical-slug redirect (SPEC §B3)
- [ ] Sitemap route `/a/events/sitemap.xml`
- [ ] Expired-event badge; pages stay live
- [ ] Magic-link editing end-to-end (pre- and post-approval versioning verified)
- [ ] Homepage widget JS + embed snippet for the Shopify theme


### Phase 6 — Full local dry run (gate before any cloud work)
- [ ] Submit → pending → approve → captured + live page + emails
- [ ] Submit → reject → hold released + email
- [ ] Auto-release job proven (simulate near-expiry)
- [ ] Magic-link edit both pre- and post-approval
- [ ] Page source shows JSON-LD + canonical

### Phase 7 — AWS backend infra (owner + AI; Terraform or console/CLI — owner to choose)
- [ ] RDS instance created (endpoint/creds saved); schema applied
- [ ] Public S3 bucket 
- [ ] IAM task + execution roles; ECR repo `be-88bamboo-events`
- [ ] ACM cert `events-api.88bamboo.co` (validated via Shopify DNS); ALB; ECS cluster + service
- [ ] `events-api.88bamboo.co` CNAME added; `/health` responds over HTTPS
- [ ] SES domain identity 88bamboo.co verified (DKIM CNAMEs in Shopify DNS)
- [ ] Prod task env set (prod block values; test Stripe keys until go-live)
- [ ] build/push/force-deploy scripts written and run

### Phase 8 — Vercel frontend
- [ ] Repo pushed to GitHub; Vercel project (root `frontend/`, Node 24, region `sin1`)
- [ ] Vercel env vars set (Production + Preview)
- [ ] Custom domain `events.88bamboo.co` added + CNAME in Shopify DNS → Valid
- [ ] Production deploy: `https://events.88bamboo.co/a/events` + `/a/events/admin` load

### Phase 9 — Connect + verify
- [ ] Stripe prod webhook → `events-api.88bamboo.co`; whsec into task env; redeploy
- [ ] Shopify App Proxy URL → `https://events.88bamboo.co`
- [ ] `https://www.88bamboo.co/a/events` loads on the apex; robots.txt does not block `/a/`
- [ ] Search Console: submit `a/events/sitemap.xml` (property likely already verified)

### Phase 10 — Go live
- [ ] Full production test in Stripe TEST mode (submit/approve/reject/edit)
- [ ] Switch to live keys (api env + Vercel publishable) + live webhook; redeploy
- [ ] One real USD 5 submission (refund after)
- [ ] Homepage widget pasted into the Shopify theme
- [ ] Monitoring habit: expiring-soon countdown + daily digest

### Blockers / questions for the owner
- **Docker Desktop not running** this session, so the scaffold was validated statically (`docker compose config`, Python `py_compile`, `package.json` JSON parse, HMAC py/node parity) but not booted end-to-end. Start Docker Desktop, then run `docker compose up --build` to confirm all three services come up healthy.
- Compose sets `API_INTERNAL_URL=http://backend:5000` and gives the `events-api` service a `backend` network alias, honouring the literal value in §9's table while keeping service names `events-api`/`events-web`. Flag if you'd prefer `API_INTERNAL_URL=http://events-api:5000` and dropping the alias.

### Deferred to Phase-2 (do not build now, but schema already supports)
Calendar view · automatic geolocation sorting · tiered/featured pricing UI · PDF press-release intake/extraction · multi-admin team · PayNow (pay-on-approval variant) · admin-auth hardening (bcrypt/argon2 + real server sessions)
