-- schema.sql — 88 Bamboo Events: full data model + non-secret seed data.
-- plan.md §7; SQL conventions per PATTERN-SPEC §A3 (SERIAL PKs, FK ON DELETE
-- SET NULL, raw SQL / no ORM, no migration framework).
--
-- Local: auto-applied by the Postgres container's /docker-entrypoint-initdb.d
-- hook on first boot, in filename order:
--     00-init.sql   -> extensions
--     schema.sql    -> this file (tables + pricing/taxonomy seed)
--     seed-admin.sh -> the single admin user, from env (never hardcoded)
-- Deployed (Phase 7): apply by hand against RDS with `psql -f database/schema.sql`.
--
-- The file is self-contained: it re-declares the extensions (idempotent) so it
-- also works when applied on its own to a fresh RDS instance.
--
-- Convention notes for this app:
--   * Timestamps use TIMESTAMPTZ. Drink-X (SPEC §A3.5) used bare TIMESTAMP, but
--     this is a global events board spanning many countries, so we store
--     timezone-aware instants. Flagged deliberately.
--   * All FKs are ON DELETE SET NULL per the SPEC convention; every FK column is
--     therefore nullable. Full version history is retained (plan §7), so rows are
--     never expected to be hard-deleted in normal operation.

-- ---------------------------------------------------------------------------
-- Extensions (also enabled in 00-init.sql; repeated here for standalone use).
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pg_trgm;   -- trigram fuzzy/ILIKE keyword search (plan §8)
CREATE EXTENSION IF NOT EXISTS unaccent;  -- accent-insensitive matching

-- ===========================================================================
-- Taxonomy + pricing (standalone reference tables; drive the submission form).
-- ===========================================================================

-- pricing_tiers — configurable listing prices. One row seeded (USD 5 standard);
-- the data model supports more/featured tiers (plan §6, deferred UI to Phase 2).
CREATE TABLE pricing_tiers (
    id                     SERIAL PRIMARY KEY,
    label                  VARCHAR(255) NOT NULL,
    price                  NUMERIC(10, 2) NOT NULL,           -- major currency units (e.g. 5.00)
    currency               VARCHAR(3) NOT NULL DEFAULT 'USD', -- ISO-4217
    featured_duration_days INTEGER,                           -- NULL = not a featured tier
    active                 BOOLEAN NOT NULL DEFAULT TRUE
);

-- drink_categories — multi-select taxonomy for the "Drink Category" field.
CREATE TABLE drink_categories (
    id     SERIAL PRIMARY KEY,
    label  VARCHAR(255) NOT NULL UNIQUE,
    active BOOLEAN NOT NULL DEFAULT TRUE
);

-- event_formats — single-select taxonomy for the "Event Format" field.
CREATE TABLE event_formats (
    id     SERIAL PRIMARY KEY,
    label  VARCHAR(255) NOT NULL UNIQUE,
    active BOOLEAN NOT NULL DEFAULT TRUE
);

-- ===========================================================================
-- Admin.
-- ===========================================================================

-- admin_users — one row for MVP, seeded by seed-admin.sh from env vars.
-- password_hash holds the client-computed hash string (SPEC §A6); the backend
-- string-compares it. Hardening (bcrypt/argon2 + real sessions) is Phase 2.
CREATE TABLE admin_users (
    id            SERIAL PRIMARY KEY,
    email         VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role          VARCHAR(50) NOT NULL DEFAULT 'owner',
    active        BOOLEAN NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ===========================================================================
-- Core listing tables.
-- events <-> event_versions form a circular FK (an event points at its live
-- version; every version points back at its event). We create `events` first
-- without the published_version_id constraint, then add it after
-- `event_versions` exists (see the ALTER TABLE below).
-- ===========================================================================

-- events — the stable identity of a listing. The live content lives in whichever
-- event_versions row published_version_id points at (NULL until first approval).
CREATE TABLE events (
    id                   SERIAL PRIMARY KEY,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    published_version_id INTEGER,               -- FK -> event_versions(id) added below; NULL until first approval
    submitter_email      VARCHAR(255) NOT NULL,
    current_status       VARCHAR(50) NOT NULL DEFAULT 'pending_review',  -- e.g. pending_review / published / unpublished / rejected / expired / withdrawn
    slug                 VARCHAR(255) UNIQUE,   -- canonical URL slug (plan §4); NULL until a slug is assigned
    -- Self-serve account management (customer "my listings" dashboard).
    -- archived: the customer took this off their active board — either withdrew a
    --   pending submission or unpublished a live one (goes to an archive, not
    --   deleted). Distinguishes a CUSTOMER unpublish (archived = TRUE) from an
    --   ADMIN unpublish (archived stays FALSE), which gates self-serve re-publish.
    archived             BOOLEAN NOT NULL DEFAULT FALSE,
    -- republish_count: how many times the customer has re-published this listing
    --   after unpublishing it. Self-serve re-publish is allowed only while this is
    --   < 1 ("re-publish only once" — stops flip-flopping).
    republish_count      INTEGER NOT NULL DEFAULT 0
);

-- event_versions — immutable content snapshots. A new row is created on every
-- (pre- or post-approval) edit; prior versions are retained (plan §7 versioning).
CREATE TABLE event_versions (
    id               SERIAL PRIMARY KEY,
    event_id         INTEGER REFERENCES events(id) ON DELETE SET NULL,
    version_number   INTEGER NOT NULL DEFAULT 1,
    approval_status  VARCHAR(50) NOT NULL DEFAULT 'pending_review'
                     CHECK (approval_status IN ('pending_review', 'approved', 'rejected', 'auto_rejected_expired')),
    name             VARCHAR(500) NOT NULL,
    start_datetime   TIMESTAMPTZ,
    end_datetime     TIMESTAMPTZ,
    venue_name       VARCHAR(500),
    venue_address    TEXT,
    country          VARCHAR(255),
    city             VARCHAR(255),
    description      TEXT,
    link             TEXT,                       -- external event/info URL
    contact_email    VARCHAR(255),
    image_url        TEXT,                       -- public S3 URL of the hero image (full record in `files`)
    submission_type  VARCHAR(50),                -- submitter type / channel (free-form for MVP)
    drink_categories TEXT[],                     -- multi-select labels from drink_categories
    event_format     VARCHAR(255),               -- single-select label from event_formats
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    reviewed_at      TIMESTAMPTZ,                -- set when approved/rejected
    rejection_reason TEXT                        -- admin-editable reason (plan §6 reject)
);

-- Now that event_versions exists, wire the circular FK from events.
ALTER TABLE events
    ADD CONSTRAINT events_published_version_fk
    FOREIGN KEY (published_version_id) REFERENCES event_versions(id) ON DELETE SET NULL;

-- payments — one Stripe PaymentIntent per submitted version (manual capture,
-- plan §6). `capture_before` is read from Stripe per intent, never hardcoded.
CREATE TABLE payments (
    id                SERIAL PRIMARY KEY,
    event_version_id  INTEGER REFERENCES event_versions(id) ON DELETE SET NULL,
    provider          VARCHAR(50) NOT NULL DEFAULT 'stripe',
    payment_intent_id VARCHAR(255),
    amount            NUMERIC(10, 2) NOT NULL,           -- major currency units (matches pricing_tiers.price)
    currency          VARCHAR(3) NOT NULL DEFAULT 'USD',
    status            VARCHAR(50) NOT NULL DEFAULT 'authorised'
                      CHECK (status IN ('authorised', 'captured', 'cancelled', 'auto_released')),
    capture_before    TIMESTAMPTZ,                       -- Stripe's authorisation expiry; drives the hourly auto-release job
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    captured_at       TIMESTAMPTZ
);

-- magic_links — passwordless edit links. Store only the token hash, never the
-- raw token (plan §7). 30-min expiry, single-use (tolerate ~3 uses in app logic).
CREATE TABLE magic_links (
    id         SERIAL PRIMARY KEY,
    event_id   INTEGER REFERENCES events(id) ON DELETE SET NULL,  -- set for a per-event edit link
    email      VARCHAR(255),                                      -- set for an account-wide dashboard link (event_id NULL)
    token_hash VARCHAR(255) NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at    TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- admin_actions — audit log of admin decisions (approve/reject/capture/unpublish).
CREATE TABLE admin_actions (
    id            SERIAL PRIMARY KEY,
    admin_user_id INTEGER REFERENCES admin_users(id) ON DELETE SET NULL,
    event_id      INTEGER REFERENCES events(id) ON DELETE SET NULL,
    action        VARCHAR(100) NOT NULL,
    details       JSONB,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- files — uploaded assets in the public S3 bucket (SPEC §A5). `image` now;
-- `press_release_pdf` reserved for a later PDF-intake phase (plan §7).
CREATE TABLE files (
    id               SERIAL PRIMARY KEY,
    event_version_id INTEGER REFERENCES event_versions(id) ON DELETE SET NULL,
    s3_key           TEXT NOT NULL,
    file_type        VARCHAR(50) NOT NULL DEFAULT 'image'
                     CHECK (file_type IN ('image', 'press_release_pdf')),
    content_type     VARCHAR(255),
    size_bytes       BIGINT,
    uploaded_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    is_public        BOOLEAN NOT NULL DEFAULT TRUE
);

-- event_messages — the admin⇄submitter conversation thread for a listing
-- (post-launch feature). One row per message; the "thread" is every row for an
-- event, oldest-first. Web-link replies only: the submitter never emails us back,
-- they reply on a page (magic-link token). A thread is OPEN only while the event
-- is 'pending_review'; once it goes live / is withdrawn the thread freezes
-- (enforced in the endpoints, not by a column). read_by_admin drives the admin's
-- unread badge; email_sent records whether the outbound email fired for an admin
-- message.
CREATE TABLE event_messages (
    id            SERIAL PRIMARY KEY,
    event_id      INTEGER REFERENCES events(id) ON DELETE SET NULL,
    sender        VARCHAR(20) NOT NULL CHECK (sender IN ('admin', 'submitter')),
    admin_user_id INTEGER REFERENCES admin_users(id) ON DELETE SET NULL,  -- set only for sender='admin'
    body          TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    read_by_admin BOOLEAN NOT NULL DEFAULT FALSE,   -- a submitter reply starts unread; admin messages are read by definition
    email_sent    BOOLEAN NOT NULL DEFAULT FALSE     -- whether the notification email was dispatched (admin messages)
);

-- ---------------------------------------------------------------------------
-- Indexes — support the documented query patterns.
-- ---------------------------------------------------------------------------
CREATE INDEX idx_events_current_status       ON events (current_status);            -- listing/admin filtering (plan §8)
CREATE INDEX idx_event_versions_event_id     ON event_versions (event_id);          -- version history lookups
CREATE INDEX idx_event_versions_approval     ON event_versions (approval_status);   -- pending queue (plan §6)
CREATE INDEX idx_payments_event_version_id   ON payments (event_version_id);
CREATE INDEX idx_payments_status_capture     ON payments (status, capture_before);  -- hourly auto-release scan (plan §6)
CREATE INDEX idx_magic_links_token_hash      ON magic_links (token_hash);           -- edit-link validation
CREATE INDEX idx_files_event_version_id      ON files (event_version_id);
CREATE INDEX idx_event_messages_event_id     ON event_messages (event_id, created_at);  -- thread reads + unread scan

-- ===========================================================================
-- SEED DATA (non-secret). The admin user is seeded separately from env by
-- seed-admin.sh so no credentials ever live in source control.
-- ===========================================================================

-- Pricing: single launch tier — USD 5 standard (plan §6/§7).
INSERT INTO pricing_tiers (label, price, currency, featured_duration_days, active)
VALUES ('Standard', 5.00, 'USD', NULL, TRUE);

-- Drink Category taxonomy (multi-select) — plan §7.
INSERT INTO drink_categories (label) VALUES
    ('Whisky'),
    ('Wine'),
    ('Sake'),
    ('Beer'),
    ('Cocktails'),
    ('Rum'),
    ('Gin'),
    ('Tequila/Mezcal'),
    ('Cognac/Brandy'),
    ('Baijiu'),
    ('Other');

-- Event Format taxonomy (single-select) — plan §7.
INSERT INTO event_formats (label) VALUES
    ('Bar takeover'),
    ('Masterclass'),
    ('Tasting'),
    ('Dinner'),
    ('Festival'),
    ('Launch'),
    ('Competition'),
    ('Trade event'),
    ('Other');
