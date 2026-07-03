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

**Magic links:** random token, store hash only, 24-hour expiry (widened from the original 30-min spec value post-Phase-5 — owner call, plan §10), single-use but tolerate ~3 uses (email scanners pre-click), fresh link per edit request.

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
- [x] Submission form (all fields + taxonomy selects + honeypot + rate limiting on the submission endpoint — §8 abuse controls). Frontend view `components/views/landingPages/SubmitEvent/` wired at `pages/submit.js` (`/a/events/submit`) via `WithLayout`+`Main`; service `core/services/submissions.js`. Backend `scripts/submissions.py` (POST `/submissions`, multipart): honeypot `company_url` (bot → benign 200, no work), per-IP rate limit 5/10min (`rate_limit.py`, in-memory — correct for the single gevent worker; needs a shared store if ever scaled out). Pure validators in `submission_validation.py` (all §7 fields, taxonomy-membership check, email/date rules).
- [x] Read-only taxonomy endpoint(s) to populate the selects from `drink_categories` / `event_formats` (not hardcoded — §7). `scripts/taxonomy.py` → GET `/taxonomy` returns active `{id,label}` rows; the form fetches it SSR in `getServerSideProps` and validates submissions against the live label sets.
- [x] Image upload: server-side → public bucket pattern (SPEC §A5); validate type/size BEFORE payment. `s3_images.py` mirrors §A5 (put_object, uuid key, `PURPOSE`-selected bucket/region/creds, public URL). Type (JPEG/PNG/WebP, declared **and** magic-byte) + size (`MAX_IMAGE_MB`, default 5, also enforced by Flask `MAX_CONTENT_LENGTH`) validated before any upload. **Local stub:** with no AWS keys, images write to `backend/uploads/` (git-ignored) and serve at `/uploads/<key>` (`scripts/uploads.py`) — the whole flow runs with zero AWS setup; set real dev keys for a dev bucket.
- [x] Stripe PaymentIntent manual-capture: authorise on submit; store intent id + `capture_before`. New `backend/payments.py` (all-new per §5.1 — NOT the §A4 subscription code): `create_manual_capture_intent` (create+confirm, `capture_method='manual'`, idempotency key, `expand=['latest_charge']`), `read_capture_before` (reads `charge.payment_method_details.card.capture_before` — verified via Stripe API docs, stored verbatim, never hardcoded), `to_minor_units` (currency-aware), `cancel_intent`. Secret key + pinned API version `2025-05-28.basil` from env.
- [x] Webhook endpoint (verified with `STRIPE_WEBHOOK_SECRET`). `scripts/payment.py` → POST `/payment/webhook`, HMAC-verified via `stripe.Webhook.construct_event`; refuses if the secret is unset/placeholder. Acts as a reconciler: maps `amount_capturable_updated→authorised`, `succeeded→captured`, `canceled→cancelled` onto the stored `payments` row (never creates rows). Local: `stripe listen --forward-to localhost:5001/payment/webhook`.
- [x] Persist submission (`events` + `event_versions` + `payments` + `files`) transactionally; cancel intent if save fails. New JSON endpoint POST `/submissions/create-intent` (re-posts the 3a held payload; **re-validates server-side**; does NOT re-upload the image). Amount+currency from the active `pricing_tiers` row. Authorise-first, then one-transaction persist (status `authorised` → event `pending_review`). Failure states (§6): DB-save-fails-after-authorise → `cancel_intent` (no orphan hold); card-declined → 402 retry, nothing persisted, no admin email. Dedupe on (email + name + start date) → flagged via an `admin_actions` `duplicate_flagged` row (no schema change).
- [x] Local proof: submit with 4242… → uncaptured authorisation visible in Stripe test dashboard. **Live-proven by the owner** with real `sk_test_`/`pk_test_` keys via `docker compose up --build` + `stripe listen --forward-to localhost:5001/payment/webhook`: (1) Stripe test dashboard shows an uncaptured USD 5.00 authorisation; (2) DB join `events`+`event_versions`+`payments` confirms `pending_review` / `pending_review` / `authorised` with a real `pi_…` id and `capture_before` = created_at + 7 days (Stripe's value, not hardcoded); (3) both §8 emails appear in `docker compose logs events-api` with the exact wording and the tier-driven `USD 5` fee.

  Discovered sub-tasks / notes:
  - **Persistence timing — CHOSEN: hold, do not draft.** Round 3a does NOT write the DB. `/submissions` validates everything, uploads the image (§A5), and RETURNS the validated event data + image URL as a "held" payload for 3b to consume when it creates the PaymentIntent; the `events`+`event_versions`+`files` write then happens transactionally with the intent (§6), which 3b re-validates first. Rationale over an explicit draft: a pending-looking draft would pollute the Phase-4 pending queue, and `event_versions.approval_status`'s CHECK has no `draft` value. Trade-off: an abandoned submission orphans its uploaded S3 object (acceptable — the spec requires uploading before payment; GC later). `payments` rows are 3b only.
  - **Verified end-to-end** via `docker compose up --build` (3 services healthy): `/taxonomy` serves the 11+9 seeded rows; empty POST → 400 with field errors; honeypot → benign 200; spoofed/oversized image → 400 before upload; valid submit → 200 held payload + stub image URL that GETs 200; 5/10min rate limit returns 429 on the 6th; `/a/events/submit` renders SSR with the taxonomy populated and honeypot present.
  - **Unit tests** (cheap marks, CLAUDE.md): `backend/tests/test_submission_validation.py` (15 cases: field rules, taxonomy membership, dedupe, image type/magic-byte/size) and `test_rate_limit.py` (window/limit/per-key). Run: `cd backend && python -m unittest discover -s tests`.
  - No new backend dependencies (hand-rolled limiter; boto3 already pinned). New env knobs: `S3_PUBLIC_BUCKET` (optional override), `MAX_IMAGE_MB` (default 5) — documented in `.env.example`.

  **Round 3b (payment + persist + mail) — CHOSEN designs / discovered sub-tasks:**
  - **Submit contract — CHOSEN: new `POST /submissions/create-intent` (JSON), NOT folded into the multipart endpoint.** Folding it in would force an image re-upload (forbidden); instead the client re-posts the 3a held `{event, image, payment_method_id, idempotency_key}`, the server re-validates it, and the image is reused via its `s3_key`/`url`. Same `submissions` blueprint (loader unchanged), same services/api-config split (`core/services/payments.js`).
  - **Ordering — CHOSEN: authorise-first, then persist transactionally** (matches §6's canonical sentence; makes "cancel intent on save failure" natural). The two §6 failure states map cleanly: *authorise-succeeds-but-DB-save-fails* → transaction rollback → `cancel_intent` (no orphan hold); *save-succeeds-but-authorise-fails* → a decline raises before any persist, so nothing is half-written → 402 retry, no admin notify. 3-D-Secure / non-`requires_capture` states are cancelled + 402'd (test card 4242 never hits this).
  - **Idempotency — CHOSEN: client-generated per-attempt UUID** (`crypto.randomUUID`), regenerated only on retry-after-decline, passed to Stripe's `idempotency_key`. Guards double-click/network double-authorise without blocking a genuine new-card retry (Stripe caches a declined response under a key for 24h). Server falls back to `derive_idempotency_key` (hash of email|name|start|s3_key) if the client omits it.
  - **Mailer — CHOSEN local backend: log-to-console** (`backend/mailer.py`; zero infra, never sends real mail). The `"mailer"` logger owns its own `StreamHandler` at `INFO` level (set directly on the logger, not via app-wide `logging.basicConfig`) so the console emails are always visible under gunicorn regardless of the rest of the app's logging config. Opt-in SMTP/MailHog if `MAIL_SERVER` is set. The `PURPOSE=production` path is AWS SES v2 (`boto3 sesv2`, raw MIME per §A7) — written to swap in cleanly at deploy but only runs in prod. Two Phase-3 emails in `backend/notifications.py` with the exact §8 wording (submitter under-review; admin new-submission), fee interpolated from the tier. Admin recipient = active `admin_users` row, falling back to `ADMIN_NOTIFY_EMAIL`.
  - **Dedupe** flagged (not blocked) via an `admin_actions(action='duplicate_flagged')` row so Phase-4's dashboard can surface it — avoided a schema change (no `duplicate` column exists).
  - **Out of scope (Phase 4), deliberately not built:** the hourly auto-release/APScheduler job. `payments.capture_before` is stored so that job can find these rows.
  - **New deps:** frontend `@stripe/stripe-js` + `@stripe/react-stripe-js` (run `npm install` in `frontend/`); backend `stripe` was already pinned. New env: `ADMIN_NOTIFY_EMAIL`, optional `MAIL_SERVER`/`MAIL_PORT`/`MAIL_USE_TLS`/`MAIL_USERNAME`/`MAIL_PASSWORD` (`.env.example`); `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` wired into `docker-compose` (`events-web`) from the shell env.
  - **Unit tests:** `backend/tests/test_payments.py` (13 cases: currency-aware minor-units incl. JPY/BHD/round-half-up, deterministic/ case-insensitive idempotency key, `capture_before` parsing incl. unexpanded-charge). Full suite now 28 tests, all green.
  - **Flags for a later cleanup (not fixed this round — surgical-change rule):**
    - `backend/scripts/submissions.py` imports `DEFAULT_MAX_IMAGE_BYTES` from `submission_validation` but never uses it (the cap comes from `_MAX_IMAGE_BYTES` via the `MAX_IMAGE_MB` env). Pre-existing dead import from 3a; harmless, remove when convenient.
    - The per-IP rate limiter (5/10min) is now **shared** across `POST /submissions` and `POST /submissions/create-intent`, so a normal submit→pay is 2 of the 5 calls. Fine for MVP; if card retries ever feel too tight, give create-intent its own limiter.
    - 3-D-Secure `requires_action` intents are cancelled + 402'd rather than completed with `handleNextAction`. Test card 4242 never triggers 3DS, but real EU cards can; wire the client-side `handleNextAction` step before go-live if EU traffic is expected.
  - **Phase-3b live-proof runbook (owner) — RUN, all three checks passed:** real `sk_test_…`/`pk_test_…` keys, `docker compose up --build`, `stripe listen --forward-to localhost:5001/payment/webhook` (whsec_ into `STRIPE_WEBHOOK_SECRET`, api restarted), submitted at `http://localhost:8080/a/events/submit` with `4242 4242 4242 4242`. Note for future code changes to `backend/`: `events-api` bakes source into the image (unlike `events-web`'s bind-mounted dev target), so a code change needs `docker compose up -d --build events-api`, not just a restart.

### Phase 4 — Admin + safety net
Split into two rounds: **4A = admin auth + review queue + approve/reject** (done below); **4B = live listings/unpublish, version history, pricing CRUD, analytics, APScheduler safety jobs** (remaining items).
- [x] Admin login (SPEC §A6 pattern) + `getServerSideProps` guard. Backend `POST /admin/login` (`scripts/admin.py`) string-compares a client-computed 32-bit hash against `admin_users.password_hash` (§A6) and issues a signed session token. Frontend: `core/services/adminAuth.js` (same `hashCode` as `make-admin-hash.js`; cookie + localStorage session), `pages/admin/login.js` + `pages/admin/index.js` opened DIRECTLY at the backstage origin (`http://localhost:8080/a/events/admin`), each with a `getServerSideProps` cookie guard (`core/utils/adminCookie.js`). No proxy verification on admin routes (proxy strips cookies — §4).
- [x] Server-side session check on approve / reject / capture / unpublish (the carve-out). approve + reject built and GUARDED (4A); **capture is folded into approve**; **unpublish added in 4B and GUARDED** (`admin_auth.admin_required`). Proven: `/admin/pending|approve|reject|unpublish|live|analytics|versions|pricing-tiers` all return 401 without a token; the money/listing writes never run unless the HMAC-signed token verifies (unpublish-without-token → 401 confirmed).
- [x] Pending queue with details + image; approve→capture+publish+email; reject→cancel+email (editable reason). `GET /admin/pending` returns every `pending_review` version with all §7 fields + `image_url` + payment (fee/status/`capture_before`) + the `duplicate_flagged` flag. Frontend `components/views/admin/ReviewQueue/`.
- [x] Live listings, unpublish, past events, version history, pricing-tier CRUD, analytics incl. expiring-soon countdown  *(4B)*. Backend `scripts/admin.py`: `GET /admin/live` (published + past + off-board, `is_past` flag), `POST /admin/unpublish` (guarded carve-out; `current_status='unpublished'`, logged), `GET /admin/versions?event_id=` (display-only version chain marking the published one), `GET /admin/analytics` (status counts + captured-revenue tally + expiring-soon scan on `capture_before`), pricing CRUD `GET/POST/PUT/DELETE /admin/pricing-tiers` with the **single-active invariant** enforced (writing a tier active deactivates the rest, so the submission flow's `active=TRUE ORDER BY id LIMIT 1` is deterministic; last-tier delete blocked). Frontend: tabbed `AdminDashboard` (Pending/Live/Pricing/Analytics) + `LiveListings` (unpublish, past badges, version-history expander), `PricingTiers` (CRUD), `Analytics` (status/payment tiles + minute-ticking expiring-soon countdown); shared `adminFormat.js`; new `adminService` methods; `apiClient.delete` aligned to return `{data,ok,status}`.
- [x] Hourly auto-release job + daily digest + 48h/24h alerts (APScheduler)  *(4B)*. `scripts/scheduled_tasks.py`: hourly `auto_release_expired` (authorised+`pending_review` within 24h of `capture_before` → `cancel_intent` free release, `payments='auto_released'`, version `'auto_rejected_expired'`, event `current_status='expired'`, submitter emailed; row re-read+`FOR UPDATE` inside the txn so it never races a manual approve; NEVER auto-captures), hourly send-once `send_expiry_alerts` (48h/24h admin alerts, deduped via `admin_actions` `expiry_alert_48h`/`_24h` markers keyed on `payment_id`), daily `send_pending_digest_job`. Wired in `app.py` via `start_scheduler(app, main_module=…)`, guarded by `scheduler_should_run` so it starts under gunicorn's single worker but only in the `WERKZEUG_RUN_MAIN` child under `python app.py` (**note:** compose `.env` sets `FLASK_DEBUG=True` even though it runs gunicorn — the guard keys off whether app.py is `__main__`, NOT `FLASK_DEBUG`, so gunicorn always starts it). New env `ENABLE_SCHEDULER` / `DIGEST_HOUR_UTC` (`.env.example`).
- [x] All transactional emails wired (local mailer). 4A added approval / rejection / re-pay; **4B added auto-released (submitter), daily pending-digest (admin), 48h/24h expiry-alert (admin)** in `notifications.py` (§8/§A7 wording). Magic-link + edit emails are Phase 5.

  **Round 4A (auth + review queue + approve/reject) — CHOSEN designs / discovered sub-tasks:**
  - **Session mechanism (the §5.3 carve-out) — CHOSEN: a stateless, HMAC-signed opaque token** (`backend/admin_auth.py`, stdlib `hmac`/`hashlib` — no new dependency, no session table). Login signs `{admin_user_id, email, exp}` (7-day TTL) with a server-only secret; each guarded request replays it in `Authorization: Bearer` and the server recomputes the HMAC (timing-safe) + checks expiry via the `@admin_required` decorator before acting. The token rides a **header, not a cookie**, because the API is a different origin from the backstage app (cookies wouldn't cross-origin). The cookie mirror exists only for the SSR page guard (§A6 UX). Secret from new `ADMIN_SESSION_SECRET` env (falls back to `SHOPIFY_SHARED_SECRET`, then a logged INSECURE dev default so local dev needs zero setup). Real hardening (bcrypt/argon2 + server sessions) stays DEFERRED (§10).
  - **Slug generation — CHOSEN: lands here, not stubbed for Phase 5** (publish needs a unique `events.slug`). `backend/slugs.py`: `slugify(name+city)` (accent-stripped, hyphenated) deduped with a `-2/-3/…` suffix, checked in the approve transaction so the slug is still free when written. Phase 5 consumes it for detail pages + canonical redirect.
  - **Approve ordering — CHOSEN: capture the hold, then publish transactionally.** `payments.capture_intent` charges the card; on success ONE transaction sets `payments.status='captured'`+`captured_at`, mints the slug, repoints `events.published_version_id`/`current_status='published'`/`slug`, sets the version `approved`+`reviewed_at`, and logs an `admin_actions` `approve` row (payment status set in the action's txn per §6; the webhook only reconciles). A rare capture-ok-but-DB-fails window is handled by an idempotent `already_captured` re-approve path (skips a second capture).
  - **Approve-but-capture-fails (§6 failure state) — handled:** a `stripe.error.StripeError` on capture keeps the version `pending_review`, does NOT publish, logs `capture_failed`, emails the submitter to resubmit (`send_repay_required`), and returns 402.
  - **Reject — CHOSEN: `cancel_intent` (free release, NOT a refund — nothing was captured)** then a txn sets `payments.status='cancelled'`, the version `rejected` + admin-editable `rejection_reason` + `reviewed_at`, the event `current_status='rejected'` (only when it has no live version — a rejected post-approval edit stays published, a 4B path), and logs a `reject` action. `send_rejected` carries the reason.
  - **Every approve/reject/capture-fail logged to `admin_actions`** (`admin_user_id` from the verified session, `event_id`, `action`, `details` JSON).
  - **New deps:** none (backend stdlib only; frontend reuses existing Stripe/Bootstrap deps).
  - **New env:** `ADMIN_SESSION_SECRET`, `PUBLIC_EVENT_BASE_URL` (both in `backend/.env.example`, both with safe local fallbacks). Owner: set a strong `ADMIN_SESSION_SECRET` before deploy.
  - **Unit tests:** `backend/tests/test_admin_auth.py` (6: round-trip, tamper, wrong-secret, expiry, boundary, garbage) + `test_slugs.py` (7: slugify normalisation + collision suffixes). Full suite now **41 tests, all green**.
  - **4A local proof — RUN end-to-end (this session, real `sk_test_` keys, `docker compose up`):** logged in as the seeded admin; `/admin/pending` 401s without a token and 200s with one, listing the two real authorised submissions from the 3b proof. **Approved** version 1 → real Stripe **capture** succeeded → `events` `published` + slug `maker-s-mark-masterclass-singapore` + `payments.status=captured`/`captured_at` set + approval email in the console mailer + `admin_actions` `approve` row. **Rejected** version 2 → `cancel_intent` → `payments.status=cancelled` + version `rejected` with the stored reason + rejection email + `reject` row. Idempotency verified (re-approve → 409, missing → 404, tampered token → 401). Frontend verified: `/admin` with no cookie 307-redirects to `/admin/login`; both pages render; CORS preflight allows the cross-origin `Authorization` call. *(Note to owner: this consumed the two prior pending test submissions — one test-mode `$5` was captured, one hold released.)*
  - **Out of scope (4B), deliberately not built:** standalone capture/unpublish endpoints, live-listing/version-history views, pricing CRUD, analytics/expiring-soon countdown, and the APScheduler auto-release/digest jobs.

  **Round 4B (live-listing management + safety jobs) — CHOSEN designs / discovered sub-tasks:**
  - **Scheduler single-fire guard — CHOSEN: key off whether `app.py` is `__main__`, not `FLASK_DEBUG`.** The compose `.env` carries `FLASK_DEBUG=True` yet runs **gunicorn** (not the Werkzeug reloader), so an earlier guard that vetoed on `FLASK_DEBUG` wrongly refused to start the jobs under compose. Fix: `start_scheduler(app, main_module=(__name__=="__main__"))`; the `WERKZEUG_RUN_MAIN` reloader dance only applies when `app.py` is run directly (`python app.py`). Under gunicorn (imported module, `main_module=False`) it always starts — natural single-fire on the one gevent worker. Verified in the container logs: "scheduler started: hourly auto-release + expiry alerts, daily digest at 08:00 UTC".
  - **Scaling caveat (flagged, not built):** single-fire relies on exactly one worker owning the jobs. The compose/gunicorn path is a single gevent worker, so it holds. If ever scaled to >1 worker/replica, gate `start_scheduler` behind a shared lock (e.g. a Postgres advisory lock) first — noted in `scheduled_tasks.start_scheduler`.
  - **Auto-release vs manual approve race — CHOSEN: re-read + `SELECT … FOR UPDATE OF p` inside the job's write txn.** Candidates are found by a cheap index-backed scan, then each is re-locked and re-checked (`status='authorised'` AND version `'pending_review'`) before acting, so a manual approve committing at the same instant is never clobbered. `cancel_intent` is best-effort (swallows Stripe errors) and we NEVER auto-capture (capture-then-refund would forfeit the Stripe fee — plan §6).
  - **24h alert / auto-release overlap (documented):** both target the 24h window; because the alert scan filters `status='authorised'`, once auto-release flips a row to `auto_released` it no longer alerts, so there's no duplicate storm — but on the exact tick a row crosses 24h the admin may get a 24h alert alongside the submitter's auto-release mail. Acceptable and matches the literal §6 wording.
  - **`events.current_status='expired'`** chosen as the free-form value the auto-release job stamps (no CHECK on the column) so expired rows drop out of the pending queue (version `approval_status` filter) and the live view (`current_status` filter).
  - **Pricing single-active invariant — CHOSEN:** writing any tier active deactivates all others in the same txn, guaranteeing the submission flow's `WHERE active=TRUE ORDER BY id LIMIT 1` resolves to exactly one row. Delete of the last remaining tier is blocked (submissions need one to price against). UI surfaces this (one "Active" badge; "Activate" moves it).
  - **Version history is DISPLAY-ONLY in 4B** (plan note): no edit endpoint exists yet (magic-link editing is Phase 5), so the version chain was proven by manually inserting a 2nd approved version and repointing `published_version_id` — the `GET /admin/versions` display tracked the move (v1→v2 `is_published`).
  - **`apiClient.delete`** changed to return `{data, ok, status}` (was throw-on-non-ok) — it had zero other callers, and the pricing UI needs the 409 body to show the "last tier" message.
  - **New deps:** none (APScheduler + pytz were already pinned in Phase 1). New env: `ENABLE_SCHEDULER`, `DIGEST_HOUR_UTC` (`.env.example`).
  - **Unit tests:** `backend/tests/test_scheduled_tasks.py` (17: `due_for_release` window, `alerts_due` send-once thresholds, `scheduler_should_run` guard across gunicorn / reloader-parent / reloader-child / opt-out). Full suite now **58 tests, all green**.
  - **4B local proof — RUN end-to-end this session** (`docker compose up -d --build db events-api`, real `sk_test_` key, jobs invoked via `docker compose exec -e ENABLE_SCHEDULER=false events-api python -c …`): seeded two near-expiry authorised+pending holds (A @20h, B @40h). `send_expiry_alerts` run 1 → 3 alerts (A 48h+24h, B 48h) in the console mailer; run 2 → **0** (send-once markers). `auto_release_expired` run 1 → released A (Stripe cancel best-effort, `payments=auto_released` / version `auto_rejected_expired` / event `expired`, submitter "resubmit" email, `admin_actions` `auto_released` logged); run 2 → **0** (idempotent, no re-act on the released row); B untouched (outside 24h). `send_pending_digest_job` → digest listing B with its capture deadline. Live-management API (seeded a published event with two approved versions): `GET /admin/live` lists it; `GET /admin/versions` shows v1 published; after a manual repoint to v2, shows v2 published; `POST /admin/unpublish` → `current_status='unpublished'` (leaves the live grouping) + `admin_actions` `unpublish` row (admin_user_id from the verified session); unpublish without a token → **401**. Pricing: creating a 2nd active tier deactivated the first (active_count=1, deterministic read returns one); last-tier delete → 409. Analytics returned status counts + captured-revenue + the expiring-soon list. Frontend `next build` compiles clean (Pending/Live/Pricing/Analytics dashboard).
  - **Note to owner:** this seeded 4B proof artifacts into the local DB (test events A/B, an unpublished "Rum Gala"); reset any time with `docker compose down -v && docker compose up --build`. The seeded `Standard` USD 5 tier was left ACTIVE.

### Phase 5 — Public pages + SEO
- [x] Listing page: grid + list, filters, search, upcoming/past toggle, country selector, soonest-first sort. `pages/index.js` (SSR first page, deep-linkable via URL query) → `components/views/publicPages/EventListing/`; grid+list toggle, keyword search, filters (when/date-range/category/format/country/city), a manual "prioritise country" selector, past events muted + "This event is over" badge, soonest-first sort. Client-side debounced refetch on filter change via `eventsService.getListing`.
- [x] Detail pages: SSR, JSON-LD, canonical, slug generation + canonical-slug redirect (SPEC §B3). `pages/[slug].js` + `components/views/publicPages/EventDetail/`. **Consumes** `events.slug` (did NOT rebuild `slugs.py`). `<title>`+meta+OG, schema.org/Event JSON-LD (name/startDate/endDate/eventStatus/location+PostalAddress/image/description — dates normalised to ISO-8601), `<link rel=canonical>` to the apex form via `core/utils/seo.js`. Canonical-slug redirect: backend `by_slug` matches case-insensitively + returns the canonical slug; `getServerSideProps` 308-redirects a non-canonical URL to `/<canonical-slug>`.
- [x] Sitemap route `/a/events/sitemap.xml`. `pages/sitemap.xml.js` (machine-route-as-page, no proxy guard); lists the listing page + every published event (`when=all` so past-dated published events stay indexable). Scale note: caps at 100 (the listing limit); paginate later if the board outgrows it (SPEC §B3 sitemap-listings/[page]).
- [x] Expired-event badge; pages stay live. Past-dated **published** events stay public and are badged "This event is over" (computed from `end_datetime < now()` via backend `is_past` + `publicFormat.isPastEvent`) — strictly distinct from `current_status='expired'` (auto-released holds, which the public gate excludes).
- [x] Magic-link editing end-to-end (pre- and post-approval versioning verified). New `backend/magic_links.py` (SHA-256 hashed token, expiry-gated so scanner pre-clicks don't burn it; TTL later widened to 24 hours — see the post-Phase-5 note below) + `scripts/edits.py` (`/edits/request-link` anti-enumeration, `/edits/context`, `/edits/submit`) + frontend `pages/manage.js` / `pages/edit.js` / `core/services/edits.js`. **Post-approval** edit → new pending version; approving it takes a NEW `approve()` branch that **repoints `published_version_id` and keeps the slug** (no capture — edits are free). **Pre-approval** edit → new pending version that **moves the authorised hold onto the new version** and marks the old pending version `rejected`("Superseded by a newer edit") so the queue carries exactly one pending version with the live hold; approving it then follows the normal first-approval capture+mint-slug path.
- [x] Homepage widget JS + embed snippet for the Shopify theme. `frontend/public/widget/events-widget.js` (served under basePath at `/a/events/widget/events-widget.js`) — standalone vanilla JS, no iframe, scoped/namespaced styles, `data-*` config, fetches `GET /events/widget` cross-origin from the API and links cards to the apex detail pages. Embed snippet + local-test snippet in `frontend/public/widget/README.md`.

  **Round 5 — CHOSEN designs / discovered sub-tasks:**
  - **Public gate (plan §5 heads-up).** Every read in `scripts/events.py` joins `events` → `event_versions pv ON pv.id = e.published_version_id` and filters `current_status='published'`, so `pending_review`/`unpublished`/`rejected`/`expired` never leak. `is_past` is computed in SQL (`end_datetime < now()`) so the "over" badge is decoupled from `current_status`.
  - **Keyword search** is `ILIKE` across name/venue_name/description with the `%…%` wildcards on the **param** (fully parameterized, no injection surface).
  - **Sort/param-binding bug found + fixed in this round:** the `preferred_country` ORDER BY `%s` must bind AFTER the WHERE params (psycopg2 binds by string position; ORDER BY follows WHERE) — the first draft bound it first and 500'd on any query combining a keyword/filter with the country selector. Now `(*where_params, *order_params, limit, offset)`. Verified with combined filters.
  - **Canonical dates for JSON-LD:** the API serialises TIMESTAMPTZ as RFC-1123 (`Tue, 28 Jul 2026 …`); `seo.js` normalises startDate/endDate to ISO-8601 (`Date→toISOString`) because schema.org expects ISO. Display formatting (`publicFormat`) reads the RFC-1123 form fine.
  - **Canonical base** derives from `NEXT_PUBLIC_BASE_URL + '/a/events'` (works locally as `http://localhost:8080/a/events`; prod `https://www.88bamboo.co/a/events`), with the apex hard-coded as the fallback per the SPEC §B3 annotation. No apex→www redirect (would break proxying).
  - **Magic-link "~3 uses" interpretation:** gate on EXPIRY, not a hard first-use lock — GET (`/context`, scanner pre-clicks) never consumes; `used_at` is stamped for audit on the first committed edit. Within the expiry window (24 hours as of the post-Phase-5 change below; originally 30 minutes at launch) the link tolerates the handful of hits it's meant to survive.
  - **Pre-approval edit request UX — RESOLVED via option (a).** `/edits/request-link` + the `manage` page identify an event by its **slug**, which a still-pending event does not have — so the **under-review confirmation email now carries a fresh pre-approval edit link** (`scripts/submissions.py` mints a `create_magic_link` inside the persist transaction; `notifications.send_under_review` includes the URL, expiry stated). A slug-less pending submitter self-serves an edit straight from that email. Verified end-to-end (submit via `pm_card_visa` → the under-review email contains `…/edit?token=…` → the link resolves with `is_published=false`). Post-approval editing remains reachable from the public detail page → `manage`.
  - **Edit images:** an edit carries the prior version's `image_url` forward (image re-upload on edit is out of MVP scope; documented in `edits.py`).
  - **New backend deps:** none (stdlib `secrets`/`hashlib`). **New frontend deps:** none. **New env:** none (reuses `PUBLIC_EVENT_BASE_URL`, `NEXT_PUBLIC_BASE_URL`).
  - **Unit tests:** `backend/tests/test_magic_links.py` (6: token uniqueness/entropy, SHA-256 hashing, determinism, never-equals-raw, empty handling). Full suite now **64 tests, all green**. Frontend `next build` compiles clean (routes `/`, `/[slug]`, `/edit`, `/manage`, `/sitemap.xml`, `/submit`, `/admin*`).
  - **Round-5 local proof — RUN end-to-end this session** (`docker compose up -d --build db events-api`, bind-mounted web hot-reload): (1) **Public reads** — `/events` returns ONLY the published event; unpublished/rejected/expired/pending slugs and `?when=all` all correctly excluded; `by_slug` published→200, non-published/unknown→404, UPPERCASE slug→200 returning the canonical lowercase slug; `/events/countries` and `/events/widget` OK; ILIKE search + category/format/country/city/date filters + combined filters all return correctly. (2) **Frontend SSR** — `/a/events` renders the grid; `/a/events/<slug>` emits `<link rel=canonical>` + valid schema.org/Event JSON-LD (ISO dates); `/a/events/sitemap.xml` lists the published event; UPPERCASE slug 308-redirects to canonical; widget JS served under basePath with correct content-type. (3) **Post-approval edit** — magic link (anti-enumeration verified: wrong email → generic 200, no token) → `/edits/submit` created v7 (pending, no payment) while v1 kept serving → admin `approve` took the **edit branch** (`edit:true`, no capture), repointed `published_version_id` 1→7, **kept the slug**, public detail then showed the updated content at the same URL, `admin_actions` `approve_edit` logged, edit-approved email sent. (4) **Pre-approval edit** — minted a link for pending event 4 → `/edits/submit` created v8, **moved the authorised hold** v4→v8 (still `authorised`, not cancelled), marked v4 `rejected`("Superseded by a newer edit"), and the pending queue then showed exactly one v8 carrying the hold.
  - **Note to owner:** this session mutated the local DB (event 1 now serves an edited v7; event 4 now has a superseded v4 + pending v8 with the moved hold). Reset any time with `docker compose down -v && docker compose up --build`.
  - **Post-launch fix — listing date hydration mismatch.** The public date helpers (`publicFormat.js`) formatted with `toLocaleString(undefined, …)` — no fixed locale/timeZone — so SSR (container, UTC/en-US) and the browser (viewer TZ/locale) produced different strings and React threw a recoverable hydration error on `/a/events` once an approved dated event rendered. Fixed by pinning `en-GB` + `timeZone:'UTC'` in `publicFormat.js` (listing + detail) and the standalone widget. **Product consequence (owner-confirmed):** event times display **as the organiser entered them** (stored naive-as-UTC), shown identically to every viewer — NOT converted to the viewer's local timezone. Standard for an events board; the only deterministic option since the venue timezone isn't stored.

  **Post-launch feature — customer "manage all my listings" account dashboard (plan §7, owner-requested).** A self-serve, email-authenticated dashboard so a customer can see and manage EVERY event they submitted, not just one at a time via a per-event link.
  - **Flow:** `/a/events/account` (enter email → generic "link sent", anti-enumeration) → emailed 24h magic link → `/a/events/my-events?token=…` (grid/list of ALL their events, full history, badged) → click into an event → `/a/events/my-events/<id>?token=…` where the actions live. No actions from the grid — you click in first (owner decision).
  - **Auth = account-scoped magic-link token** (new `magic_links.email` column, `event_id` NULL). The token proves email ownership and authorises ANY of that email's listings; every action re-checks `token-email == event.submitter_email` server-side. Cookie-free (URL token; the App Proxy strips cookies). Same hashed/24h/anti-enumeration shape as per-event links. Bearer scope is broader (all listings) but the link only ever goes to the owner's inbox.
  - **Actions + owner decisions (locked):** *Edit* (pending → pre-approval edit; live → post-approval edit; only after clicking in, never from the grid). *Withdraw* a pending listing → **releases the Stripe hold immediately** (cancel intent, free) + `current_status='withdrawn'`, `archived=TRUE`. *Unpublish* a live listing → off the public board, `current_status='unpublished'`, `archived=TRUE` (no money moves). *Re-publish* a customer-unpublished listing → **allowed ONCE** (`republish_count < 1`), gated on `archived=TRUE` so an ADMIN takedown can't be self-reversed. *Re-submit* a withdrawn/rejected/expired listing → deep-links to `/submit?resubmit=<id>&token=…` which **pre-fills a brand-new paid submission** with the old fields (fresh image + fresh fee; the old row stays archived).
  - **Schema (added to `database/schema.sql`; ALTERs applied to the running local DB, fresh boots get them via the init hook):** `events.archived BOOLEAN DEFAULT FALSE`, `events.republish_count INTEGER DEFAULT 0`, `magic_links.email VARCHAR(255)`. `current_status` gains the free-form value `'withdrawn'`. The admin pending queue now filters `AND e.archived = FALSE` so a withdrawn listing leaves the queue (its version row stays honestly `pending_review`). Public gate is unaffected (a published event is never archived by construction).
  - **New backend:** `scripts/account.py` (request-link/context/event/edit/withdraw/unpublish/republish, ownership-checked), `magic_links.create_account_link`/`resolve_account_token`, `notifications.send_account_link`. **Refactor:** the edit-versioning core (pre-/post-approval, hold-move + supersede) extracted to `event_versioning.py` and shared by BOTH `scripts/edits.py` (per-event) and `scripts/account.py` (account) — no duplicated versioning logic. Customer actions logged to `admin_actions` with `admin_user_id = NULL`.
  - **New frontend:** `pages/account.js`, `pages/my-events/index.js` + `pages/my-events/[eventId].js`, views `MyEvents/` + `ManageEvent/`, `core/services/account.js`; `EditEvent` refactored to take an `onSubmit` prop (transport-agnostic) so it serves both `/edit` and the account flow; `SubmitEvent` accepts a `resubmit` prefill; footer links to `/account`. **Kept both** manage paths (per-event `/manage` unchanged).
  - **Local proof — RUN end-to-end this session:** request-link (anti-enumeration: no-listings email → generic 200, no token); context lists all of an email's events; ownership 404 on a non-owned event, 401 on a bad token; unpublish → event drops from the public feed (404) → re-publish once OK → 2nd re-publish blocked (409 cap); pre-approval edit moved the hold onto the new version; withdraw released the hold (payment `cancelled`) + `withdrawn`/`archived` + dropped from the admin pending queue; re-submit pre-fills `/submit`; the refactored per-event `/edits/submit` still works. Frontend SSR of `/account`, `/my-events`, `/my-events/<id>` (correct per-status action buttons) all verified. Schema.sql re-validated on a throwaway Postgres. 64 backend tests green; `next build` clean.

  **Post-launch feature — calendar view on the public listing page (plan §8, was Phase-2, owner-requested).** A third view alongside Grid/List on `/a/events`, entirely frontend (no backend/DB/API change — reuses `GET /events`).
  - **Owner decisions (locked):** month grid (not week/agenda); **hand-rolled** (no calendar lib — zero new deps, full control over UTC bucketing, matches the self-contained-view pattern); **month nav replaces the Upcoming/Past toggle** in calendar view (the toggle is hidden and the fetch forces `when='all'` so past & future months both populate — all other filters/search still apply); **day chip → detail page, `+N more` → expand that day's list** below the grid.
  - **Timezone (critical):** every date op reads UTC fields (`getUTC*`, `Date.UTC`, `timeZone:'UTC'`), mirroring `publicFormat.js`'s UTC pinning, so a calendar day = the wall-clock day the organiser entered and there's **no locale/timezone hydration mismatch** (the same class of bug fixed post-launch at line 286). The calendar is client-only (rendered only when `view==='calendar'`, which is client state), so `Date.now()`/"today" never run during SSR.
  - **Design details:** Monday-start 7-col CSS grid, prev/next-month + "Today" nav; default month = the soonest **upcoming** event's month (falls back to current month) so a sparse board doesn't open empty; up to 2 event chips per day then a `+N more`; today highlighted, past days muted; multi-day events bucket on their **start** day. **Mobile (`<md`):** the grid is hidden and the visible month collapses to a stacked **agenda** grouped by day, reusing the existing list `EventCard`.
  - **All in one file** (`components/views/publicPages/EventListing/EventListing.js`): added pure helpers (`utcDayKey`, `buildMonthGrid`, `initialMonth`, `monthLabel`, `formatDayHeading`) + a `MonthCalendar` component + a Calendar button on the existing view toggle; parent `refetch` forces `when='all'` and the debounce effect now also keys off `view`. No new deps, no new env, no backend touch.
  - **Local proof — RUN this session:** reset DB (`down -v` + rebuild), seeded 8 published events across dates (one today, a 4-event cluster on one day, one next month, one past). `GET /events?when=all` returns all 8; the listing page compiles + serves 200 with clean web logs. The risk-bearing pure logic was verified in Node against the **live seeded API data**: UTC buckets land each event on its as-entered day (13 Jun past / 3 Jul today / ×4 on 5 Jul / 13 Jul / 7 Aug), `initialMonth()` opens on 2026-07 (soonest upcoming), the July grid computes `firstDow=2` (1 Jul = Wed, Mon-start) over 5 weeks, and the 4-event day yields "2 chips + '+2 more'". Visual browser check not done (Chrome extension not connected this session) — **owner to eyeball `http://localhost:8080/a/events` → Calendar**; the 8 seed events are in the local DB (reset with `down -v` any time).

  **Heads-up notes carried from Phases 3–4 (read before starting Phase 5):**
  - **Slug generation ALREADY EXISTS — do not rebuild it.** `backend/slugs.py` (`slugify`, `generate_unique_slug(cursor, name, city, exclude_event_id=…)`) is written and is applied inside admin `approve` (4A), so every published event already has a unique `events.slug`. Phase 5 detail pages + canonical-slug redirects should **consume `events.slug`**, not regenerate. The `exclude_event_id` arg exists for re-slugging an existing event if ever needed.
  - **"expired" is now TWO different things — do not conflate.** (1) The plan §8 public badge "This event is over" means a **published event whose `end_datetime` has passed** (past-dated) — these stay public/indexable. (2) 4B introduced `events.current_status='expired'` for **auto-released holds that were never approved** — these must **NOT** be public. So the public listing/detail must gate on `current_status='published'` (serving `published_version_id`), and compute the "over" badge from `end_datetime < now()`. Never surface `pending_review` / `unpublished` / `rejected` / `expired` rows publicly.
  - **Public read API endpoints don't exist yet — add them.** All current backend blueprints are either admin-guarded or write/utility; there is no public event-read endpoint. Add a new unguarded `scripts/` blueprint (e.g. `events.py`) for listing/detail/widget-feed reads (CORS already allows the apex + backstage origins in prod, permissive locally). The homepage widget calls `events-api.88bamboo.co` **directly cross-origin** from the Shopify theme (not via the proxy), so its feed endpoint must be CORS-open and cookie-free. `frontend/core/services/events.js` is still a scaffold placeholder — add the real `getUpcoming` / `getBySlug` / etc. there.
  - **Post-approval edit-approve must REPOINT, not re-slug.** Magic-link editing creates a new `pending_review` version on an already-published event; approving that edit must **repoint `events.published_version_id`** to the new version and **keep the existing slug** (the slug is stable per event) — i.e. a distinct code path from 4A's first-approval `approve` (which mints the slug). Note: admin `reject` (4A) already leaves a still-published event live when a post-approval edit is rejected (its `published_version_id is None` guard); the matching approve-side edit path is the Phase-5 addition.
  - **Magic links are cookie-free by design** (`magic_links` table exists: store `token_hash` only, expiry-gated (24 hours as of the post-Phase-5 change below), tolerate ~3 uses for email pre-scanners, fresh link per edit). Editing may run through the App Proxy, which strips cookies — so the edit session is carried by the URL token, never a cookie (plan §4/§7).
  - **basePath + canonical:** the app runs under `basePath '/a/events'`; the canonical/JSON-LD/sitemap URLs must be the **apex** form `https://www.88bamboo.co/a/events/<slug>` (derive from `NEXT_PUBLIC_BASE_URL` + basePath), with **no** apex→www redirect (it would break proxying — SPEC annotation).


### Phase 6 — Full local dry run (gate before any cloud work)
- [ ] Submit → pending → approve → captured + live page + emails
- [ ] Submit → reject → hold released + email
- [x] Auto-release job proven (simulate near-expiry) — done in Phase 4B (see the 4B local-proof note): seeded a ~20h-to-expiry authorised+pending hold, the hourly job cancelled it (free), marked `auto_released` / `auto_rejected_expired` / event `expired`, emailed the submitter, and a second run was a no-op.
- [x] Magic-link edit both pre- and post-approval — proven in the Round-5 local proof (post-approval: repoint + keep slug, no capture; pre-approval: new pending version with the hold moved onto it + old version superseded). Both are now self-serve: post-approval via the public detail page → `manage`; pre-approval via the edit link in the under-review confirmation email.
- [x] Page source shows JSON-LD + canonical — `/a/events/<slug>` SSR emits `<link rel=canonical>` (apex form) and a valid schema.org/Event JSON-LD block (ISO-8601 dates); verified this session.

### Phase 7 — AWS backend infra (owner + AI; Terraform or console/CLI — owner to choose)
- [ ] RDS instance created (endpoint/creds saved); schema applied
- [ ] Public S3 bucket 
- [ ] IAM task + execution roles; ECR repo `be-88bamboo-events`
- [ ] ACM cert `events-api.88bamboo.co` (validated via Shopify DNS); ALB; ECS cluster + service
- [ ] `events-api.88bamboo.co` CNAME added; `/health` responds over HTTPS
- [ ] SES domain identity 88bamboo.co verified (DKIM CNAMEs in Shopify DNS)
- [ ] Prod task env set (prod block values; test Stripe keys until go-live)
  - [ ] **Set a strong random `ADMIN_SESSION_SECRET`** (Phase 4A — signs the admin session token; it currently falls back to `SHOPIFY_SHARED_SECRET`/an INSECURE dev default if unset). Set `PUBLIC_EVENT_BASE_URL=https://www.88bamboo.co/a/events` (approval-email live link). Both templated in `backend/.env.example`.
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
- **Pre-approval edit request UX — RESOLVED (was: owner decision).** Implemented option (a): the "under review" confirmation email now includes a fresh pre-approval edit link (`scripts/submissions.py` mints it in the persist transaction; `notifications.send_under_review` carries the URL), so a slug-less pending submitter can self-serve an edit. Verified end-to-end this session. (Options (b) match-by-email+name and (c) leave-it were not needed.)
- **Magic-link expiry widened from 30 minutes to 24 hours (owner request, post-Phase-5).** `backend/magic_links.py DEFAULT_TTL_MINUTES` changed `30` → `60 * 24`; all comments + the two emails that state the duration (`send_magic_link`, `send_under_review`'s edit line) and the frontend `manage` page copy were updated to match. No schema change — `magic_links.expires_at` was always just `created_at + TTL`. Rationale: 30 minutes was too tight for a submitter to notice and act on the under-review email's pre-approval edit link. The gate-on-expiry (not hard single-use) design is unaffected — a 24-hour window still tolerates the handful of scanner/human hits it's meant to survive.

### Deferred to Phase-2 (do not build now, but schema already supports)
~~Calendar view~~ (DONE — post-launch, see the calendar-view note above) · automatic geolocation sorting · tiered/featured pricing UI · PDF press-release intake/extraction · multi-admin team · PayNow (pay-on-approval variant) · admin-auth hardening (bcrypt/argon2 + real server sessions)
