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

-- pricing_tiers — configurable listing prices. One row seeded (USD 15 standard);
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

-- countries — canonical country list: the SINGLE source of truth for the
-- submission form's required country dropdown AND server-side validation (EP-2).
-- Replaces the former hardcoded frontend list so "US / USA / United States" drift
-- is impossible. requires_region = TRUE means the form must also collect a
-- State/Territory/Region from country_regions (large federal countries, plus
-- Hong Kong / Macau / Taiwan whose region resolves to themselves).
CREATE TABLE countries (
    id              SERIAL PRIMARY KEY,
    name            VARCHAR(255) NOT NULL UNIQUE,
    requires_region BOOLEAN NOT NULL DEFAULT FALSE,
    active          BOOLEAN NOT NULL DEFAULT TRUE
);

-- country_regions — the standard subdivisions (states / provinces / regions) for
-- the countries where requires_region = TRUE (ISO 3166-2 style names). The FK is
-- ON DELETE CASCADE — NOT the app-wide SET NULL — because a subdivision is
-- meaningless without its country and these are static reference rows that never
-- join the versioned listing graph (flagged deliberately, same spirit as the
-- TIMESTAMPTZ note above).
CREATE TABLE country_regions (
    id         SERIAL PRIMARY KEY,
    country_id INTEGER NOT NULL REFERENCES countries(id) ON DELETE CASCADE,
    name       VARCHAR(255) NOT NULL,
    active     BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE (country_id, name)
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
    -- Location coordinates + structured address, captured from the REQUIRED Google
    -- Places selection at submit (EP-2, A2/A3). All nullable, no backfill: legacy
    -- events keep NULL coords and the detail page falls back to the address-string
    -- map. venue_address stays the Google-formatted display string; region is the
    -- controlled country_regions subdivision when the country requires one.
    latitude         NUMERIC(9, 6),
    longitude        NUMERIC(9, 6),
    place_id         TEXT,
    postcode         VARCHAR(32),
    region           VARCHAR(255),
    -- Public event-organiser name (EP-7 F2). Optional, nullable, no backfill:
    -- legacy versions have NULL and render with no "Organised by" line. Snapshotted
    -- per version like the other content; the display string keeps the submitter's
    -- original casing. Ownership/uniqueness is enforced via event_organiser_names
    -- (below), keyed to the authenticated submitter email — NOT stored here.
    organiser_name   VARCHAR(255),
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
    is_public        BOOLEAN NOT NULL DEFAULT TRUE,
    -- Post-go-live "additional images" feature (plan.md backlog). sort_order > 0
    -- marks an ADDITIONAL image (detail-page carousel, 1..5, upload order); the
    -- default 0 is the untouched existing feature-image row, which this feature
    -- never reads (the feature image is, and stays, event_versions.image_url).
    sort_order       INT NOT NULL DEFAULT 0,
    -- Public URL for an additional-image row (the local stub's URL is
    -- request-host-dependent, so it must be stored, not reconstructed from
    -- s3_key). NULL on the existing feature-image row — nothing reads it there.
    url              TEXT
);

-- event_occurrences — the per-date schedule of a version (EP-6 multi-date
-- scheduling). One row per explicit date the event runs, each with its own
-- start/end instant. This is a HAND-ENTERED schedule of occurrences, NOT
-- rule-based recurrence (no RRULE). event_versions.start_datetime/end_datetime are
-- kept as a DERIVED SUMMARY (MIN(starts_at) / MAX(ends_at)); the validator/persist
-- layer is the single writer of both the scalars and these rows so they never
-- drift, which keeps the large existing read surface (listing filter/sort,
-- is_past, upcoming/past toggle, widget, hourly auto-expire) reading the scalars
-- unchanged. Backward-compatible + additive: legacy versions have ZERO occurrence
-- rows and reads treat "no rows" as a single implied occurrence from the scalars
-- (no backfill). The FK is ON DELETE CASCADE — NOT the app-wide SET NULL — because
-- an occurrence is meaningless without its immutable version snapshot and must be
-- re-snapshotted per version, exactly like the country_regions rationale above.
CREATE TABLE event_occurrences (
    id               SERIAL PRIMARY KEY,
    event_version_id INTEGER NOT NULL REFERENCES event_versions(id) ON DELETE CASCADE,
    starts_at        TIMESTAMPTZ NOT NULL,
    ends_at          TIMESTAMPTZ NOT NULL,
    sort_order       INTEGER NOT NULL DEFAULT 0
);

-- event_organiser_names — the registry that makes a public organiser name
-- (EP-7 F2/F-D3) race-proof first-come-first-served + cross-account-unique. The
-- FIRST authenticated email to claim a normalised name OWNS it and may reuse it on
-- any number of their own events; a DIFFERENT email is rejected. normalised_name is
-- UNIQUE (case-insensitive + trimmed + punctuation/accent/whitespace-folded, per
-- F-D4) so the DB constraint itself resolves a submit-time race — the claim is
-- checked before the payment hold and re-checked + committed inside the persist
-- transaction (F-D5). display_name preserves the submitter's original casing for
-- display; owner_email is the AUTHENTICATED submitter email (the ownership key —
-- NEVER the public contact email, F-D2). Additive/no-backfill: the table starts
-- empty and legacy events never retroactively claim a name (F-D6). Standalone
-- reference-style rows (not part of the versioned listing graph); no FK.
CREATE TABLE event_organiser_names (
    id              SERIAL PRIMARY KEY,
    normalised_name VARCHAR(255) NOT NULL UNIQUE,
    owner_email     VARCHAR(255) NOT NULL,
    display_name    VARCHAR(255) NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
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
    read_by_submitter BOOLEAN NOT NULL DEFAULT FALSE, -- symmetric flag: an admin message starts unread-by-submitter; drives the dashboard bell. A submitter's own reply is inserted TRUE. Opening the thread on any surface marks the admin messages read.
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
CREATE INDEX idx_country_regions_country_id ON country_regions (country_id);   -- region dropdown lookups
CREATE INDEX idx_event_occurrences_version   ON event_occurrences (event_version_id);  -- per-version schedule reads (EP-6)
CREATE INDEX idx_event_organiser_names_owner  ON event_organiser_names (owner_email);   -- "my previous organiser names" dropdown (EP-7)

-- ===========================================================================
-- SEED DATA (non-secret). The admin user is seeded separately from env by
-- seed-admin.sh so no credentials ever live in source control.
-- ===========================================================================

-- Pricing: single launch tier — USD 15 standard (plan §6/§7).
INSERT INTO pricing_tiers (label, price, currency, featured_duration_days, active)
VALUES ('Standard', 15.00, 'USD', NULL, TRUE);

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

-- ---------------------------------------------------------------------------
-- Geo reference: canonical countries + their subdivisions (EP-2). Single source
-- of truth for the required country dropdown and the dependent region dropdown.
-- ---------------------------------------------------------------------------
-- Countries (canonical, controlled dropdown source). requires_region
-- drives the dependent State/Territory/Region select on the forms.
INSERT INTO countries (name, requires_region) VALUES
    ('Argentina', FALSE),
    ('Australia', TRUE),
    ('Austria', FALSE),
    ('Bahrain', FALSE),
    ('Bangladesh', FALSE),
    ('Belgium', FALSE),
    ('Brazil', TRUE),
    ('Bulgaria', FALSE),
    ('Cambodia', FALSE),
    ('Canada', TRUE),
    ('Chile', TRUE),
    ('Mainland China', TRUE),
    ('Colombia', FALSE),
    ('Croatia', FALSE),
    ('Cyprus', FALSE),
    ('Czech Republic', FALSE),
    ('Denmark', TRUE),
    ('Egypt', FALSE),
    ('Estonia', FALSE),
    ('Finland', FALSE),
    ('France', TRUE),
    ('Georgia', FALSE),
    ('Germany', FALSE),
    ('Greece', FALSE),
    ('Hong Kong', TRUE),
    ('Hungary', FALSE),
    ('Iceland', FALSE),
    ('India', FALSE),
    ('Indonesia', TRUE),
    ('Ireland', FALSE),
    ('Israel', FALSE),
    ('Italy', FALSE),
    ('Japan', FALSE),
    ('Jordan', FALSE),
    ('Kenya', FALSE),
    ('Kuwait', FALSE),
    ('Laos', FALSE),
    ('Latvia', FALSE),
    ('Lebanon', FALSE),
    ('Lithuania', FALSE),
    ('Luxembourg', FALSE),
    ('Macau', TRUE),
    ('Malaysia', FALSE),
    ('Malta', FALSE),
    ('Mexico', TRUE),
    ('Monaco', FALSE),
    ('Morocco', FALSE),
    ('Myanmar', FALSE),
    ('Nepal', FALSE),
    ('Netherlands', TRUE),
    ('New Zealand', TRUE),
    ('Nigeria', FALSE),
    ('Norway', FALSE),
    ('Oman', FALSE),
    ('Pakistan', FALSE),
    ('Peru', FALSE),
    ('Philippines', FALSE),
    ('Poland', FALSE),
    ('Portugal', TRUE),
    ('Qatar', FALSE),
    ('Romania', FALSE),
    ('Russia', TRUE),
    ('Saudi Arabia', FALSE),
    ('Serbia', FALSE),
    ('Singapore', FALSE),
    ('Slovakia', FALSE),
    ('Slovenia', FALSE),
    ('South Africa', TRUE),
    ('South Korea', FALSE),
    ('Spain', TRUE),
    ('Sri Lanka', FALSE),
    ('Sweden', FALSE),
    ('Switzerland', FALSE),
    ('Taiwan', TRUE),
    ('Thailand', FALSE),
    ('Turkey', FALSE),
    ('Ukraine', FALSE),
    ('United Arab Emirates', FALSE),
    ('United Kingdom', TRUE),
    ('United States', TRUE),
    ('Uruguay', FALSE),
    ('Vietnam', FALSE);

-- Country subdivisions (ISO 3166-2 style, standard commonly-used names).
-- Looked up by country name so the seed stays readable.
INSERT INTO country_regions (country_id, name)
SELECT id, r FROM countries, unnest(ARRAY[
    'Australian Capital Territory',
    'New South Wales',
    'Northern Territory',
    'Queensland',
    'South Australia',
    'Tasmania',
    'Victoria',
    'Western Australia'
]) AS r WHERE name = 'Australia';

INSERT INTO country_regions (country_id, name)
SELECT id, r FROM countries, unnest(ARRAY[
    'Acre',
    'Alagoas',
    'Amapá',
    'Amazonas',
    'Bahia',
    'Ceará',
    'Distrito Federal',
    'Espírito Santo',
    'Goiás',
    'Maranhão',
    'Mato Grosso',
    'Mato Grosso do Sul',
    'Minas Gerais',
    'Pará',
    'Paraíba',
    'Paraná',
    'Pernambuco',
    'Piauí',
    'Rio de Janeiro',
    'Rio Grande do Norte',
    'Rio Grande do Sul',
    'Rondônia',
    'Roraima',
    'Santa Catarina',
    'São Paulo',
    'Sergipe',
    'Tocantins'
]) AS r WHERE name = 'Brazil';

INSERT INTO country_regions (country_id, name)
SELECT id, r FROM countries, unnest(ARRAY[
    'Alberta',
    'British Columbia',
    'Manitoba',
    'New Brunswick',
    'Newfoundland and Labrador',
    'Northwest Territories',
    'Nova Scotia',
    'Nunavut',
    'Ontario',
    'Prince Edward Island',
    'Quebec',
    'Saskatchewan',
    'Yukon'
]) AS r WHERE name = 'Canada';

INSERT INTO country_regions (country_id, name)
SELECT id, r FROM countries, unnest(ARRAY[
    'Antofagasta',
    'Araucanía',
    'Arica y Parinacota',
    'Atacama',
    'Aysén',
    'Biobío',
    'Coquimbo',
    'Los Lagos',
    'Los Ríos',
    'Magallanes',
    'Maule',
    'O''Higgins',
    'Ñuble',
    'Santiago Metropolitan',
    'Tarapacá',
    'Valparaíso'
]) AS r WHERE name = 'Chile';

INSERT INTO country_regions (country_id, name)
SELECT id, r FROM countries, unnest(ARRAY[
    'Anhui',
    'Beijing',
    'Chongqing',
    'Fujian',
    'Gansu',
    'Guangdong',
    'Guangxi',
    'Guizhou',
    'Hainan',
    'Hebei',
    'Heilongjiang',
    'Henan',
    'Hubei',
    'Hunan',
    'Inner Mongolia',
    'Jiangsu',
    'Jiangxi',
    'Jilin',
    'Liaoning',
    'Ningxia',
    'Qinghai',
    'Shaanxi',
    'Shandong',
    'Shanghai',
    'Shanxi',
    'Sichuan',
    'Tianjin',
    'Tibet',
    'Xinjiang',
    'Yunnan',
    'Zhejiang'
]) AS r WHERE name = 'Mainland China';

INSERT INTO country_regions (country_id, name)
SELECT id, r FROM countries, unnest(ARRAY[
    'Capital Region',
    'Central Denmark',
    'North Denmark',
    'Southern Denmark',
    'Zealand'
]) AS r WHERE name = 'Denmark';

INSERT INTO country_regions (country_id, name)
SELECT id, r FROM countries, unnest(ARRAY[
    'Auvergne-Rhône-Alpes',
    'Bourgogne-Franche-Comté',
    'Bretagne',
    'Centre-Val de Loire',
    'Corse',
    'Grand Est',
    'Guadeloupe',
    'Guyane',
    'Hauts-de-France',
    'Île-de-France',
    'La Réunion',
    'Martinique',
    'Mayotte',
    'Normandie',
    'Nouvelle-Aquitaine',
    'Occitanie',
    'Pays de la Loire',
    'Provence-Alpes-Côte d''Azur'
]) AS r WHERE name = 'France';

INSERT INTO country_regions (country_id, name)
SELECT id, r FROM countries, unnest(ARRAY[
    'Hong Kong'
]) AS r WHERE name = 'Hong Kong';

INSERT INTO country_regions (country_id, name)
SELECT id, r FROM countries, unnest(ARRAY[
    'Aceh',
    'Bali',
    'Bangka Belitung Islands',
    'Banten',
    'Bengkulu',
    'Central Java',
    'Central Kalimantan',
    'Central Papua',
    'Central Sulawesi',
    'East Java',
    'East Kalimantan',
    'East Nusa Tenggara',
    'Gorontalo',
    'Highland Papua',
    'Jakarta',
    'Jambi',
    'Lampung',
    'Maluku',
    'North Kalimantan',
    'North Maluku',
    'North Sulawesi',
    'North Sumatra',
    'Papua',
    'Riau',
    'Riau Islands',
    'South Kalimantan',
    'South Papua',
    'South Sulawesi',
    'South Sumatra',
    'Southeast Sulawesi',
    'Southwest Papua',
    'West Java',
    'West Kalimantan',
    'West Nusa Tenggara',
    'West Papua',
    'West Sulawesi',
    'West Sumatra',
    'Yogyakarta'
]) AS r WHERE name = 'Indonesia';

INSERT INTO country_regions (country_id, name)
SELECT id, r FROM countries, unnest(ARRAY[
    'Macau'
]) AS r WHERE name = 'Macau';

INSERT INTO country_regions (country_id, name)
SELECT id, r FROM countries, unnest(ARRAY[
    'Aguascalientes',
    'Baja California',
    'Baja California Sur',
    'Campeche',
    'Chiapas',
    'Chihuahua',
    'Coahuila',
    'Colima',
    'Durango',
    'Guanajuato',
    'Guerrero',
    'Hidalgo',
    'Jalisco',
    'Mexico City',
    'Michoacán',
    'Morelos',
    'México',
    'Nayarit',
    'Nuevo León',
    'Oaxaca',
    'Puebla',
    'Querétaro',
    'Quintana Roo',
    'San Luis Potosí',
    'Sinaloa',
    'Sonora',
    'Tabasco',
    'Tamaulipas',
    'Tlaxcala',
    'Veracruz',
    'Yucatán',
    'Zacatecas'
]) AS r WHERE name = 'Mexico';

INSERT INTO country_regions (country_id, name)
SELECT id, r FROM countries, unnest(ARRAY[
    'Drenthe',
    'Flevoland',
    'Friesland',
    'Gelderland',
    'Groningen',
    'Limburg',
    'North Brabant',
    'North Holland',
    'Overijssel',
    'South Holland',
    'Utrecht',
    'Zeeland'
]) AS r WHERE name = 'Netherlands';

INSERT INTO country_regions (country_id, name)
SELECT id, r FROM countries, unnest(ARRAY[
    'Auckland',
    'Bay of Plenty',
    'Canterbury',
    'Gisborne',
    'Hawke''s Bay',
    'Manawatū-Whanganui',
    'Marlborough',
    'Nelson',
    'Northland',
    'Otago',
    'Southland',
    'Taranaki',
    'Tasman',
    'Waikato',
    'Wellington',
    'West Coast'
]) AS r WHERE name = 'New Zealand';

INSERT INTO country_regions (country_id, name)
SELECT id, r FROM countries, unnest(ARRAY[
    'Açores',
    'Aveiro',
    'Beja',
    'Braga',
    'Bragança',
    'Castelo Branco',
    'Coimbra',
    'Évora',
    'Faro',
    'Guarda',
    'Leiria',
    'Lisboa',
    'Madeira',
    'Portalegre',
    'Porto',
    'Santarém',
    'Setúbal',
    'Viana do Castelo',
    'Vila Real',
    'Viseu'
]) AS r WHERE name = 'Portugal';

INSERT INTO country_regions (country_id, name)
SELECT id, r FROM countries, unnest(ARRAY[
    'Adygea',
    'Altai Krai',
    'Altai Republic',
    'Amur',
    'Arkhangelsk',
    'Astrakhan',
    'Bashkortostan',
    'Belgorod',
    'Bryansk',
    'Buryatia',
    'Chechnya',
    'Chelyabinsk',
    'Chukotka',
    'Chuvashia',
    'Dagestan',
    'Ingushetia',
    'Irkutsk',
    'Ivanovo',
    'Jewish Autonomous Oblast',
    'Kabardino-Balkaria',
    'Kaliningrad',
    'Kalmykia',
    'Kaluga',
    'Kamchatka Krai',
    'Karachay-Cherkessia',
    'Karelia',
    'Kemerovo',
    'Khabarovsk Krai',
    'Khakassia',
    'Khanty-Mansi',
    'Kirov',
    'Komi',
    'Kostroma',
    'Krasnodar Krai',
    'Krasnoyarsk Krai',
    'Kurgan',
    'Kursk',
    'Leningrad',
    'Lipetsk',
    'Magadan',
    'Mari El',
    'Mordovia',
    'Moscow',
    'Moscow Oblast',
    'Murmansk',
    'Nenets',
    'Nizhny Novgorod',
    'North Ossetia–Alania',
    'Novgorod',
    'Novosibirsk',
    'Omsk',
    'Orenburg',
    'Oryol',
    'Penza',
    'Perm Krai',
    'Primorsky Krai',
    'Pskov',
    'Rostov',
    'Ryazan',
    'Saint Petersburg',
    'Sakha (Yakutia)',
    'Sakhalin',
    'Samara',
    'Saratov',
    'Smolensk',
    'Stavropol Krai',
    'Sverdlovsk',
    'Tambov',
    'Tatarstan',
    'Tomsk',
    'Tula',
    'Tuva',
    'Tver',
    'Tyumen',
    'Udmurtia',
    'Ulyanovsk',
    'Vladimir',
    'Volgograd',
    'Vologda',
    'Voronezh',
    'Yamalo-Nenets',
    'Yaroslavl',
    'Zabaykalsky Krai'
]) AS r WHERE name = 'Russia';

INSERT INTO country_regions (country_id, name)
SELECT id, r FROM countries, unnest(ARRAY[
    'Eastern Cape',
    'Free State',
    'Gauteng',
    'KwaZulu-Natal',
    'Limpopo',
    'Mpumalanga',
    'North West',
    'Northern Cape',
    'Western Cape'
]) AS r WHERE name = 'South Africa';

INSERT INTO country_regions (country_id, name)
SELECT id, r FROM countries, unnest(ARRAY[
    'Andalusia',
    'Aragon',
    'Asturias',
    'Balearic Islands',
    'Basque Country',
    'Canary Islands',
    'Cantabria',
    'Castile and León',
    'Castilla-La Mancha',
    'Catalonia',
    'Ceuta',
    'Extremadura',
    'Galicia',
    'La Rioja',
    'Madrid',
    'Melilla',
    'Murcia',
    'Navarre',
    'Valencia'
]) AS r WHERE name = 'Spain';

INSERT INTO country_regions (country_id, name)
SELECT id, r FROM countries, unnest(ARRAY[
    'Taiwan'
]) AS r WHERE name = 'Taiwan';

INSERT INTO country_regions (country_id, name)
SELECT id, r FROM countries, unnest(ARRAY[
    'England',
    'Northern Ireland',
    'Scotland',
    'Wales'
]) AS r WHERE name = 'United Kingdom';

INSERT INTO country_regions (country_id, name)
SELECT id, r FROM countries, unnest(ARRAY[
    'Alabama',
    'Alaska',
    'Arizona',
    'Arkansas',
    'California',
    'Colorado',
    'Connecticut',
    'Delaware',
    'District of Columbia',
    'Florida',
    'Georgia',
    'Hawaii',
    'Idaho',
    'Illinois',
    'Indiana',
    'Iowa',
    'Kansas',
    'Kentucky',
    'Louisiana',
    'Maine',
    'Maryland',
    'Massachusetts',
    'Michigan',
    'Minnesota',
    'Mississippi',
    'Missouri',
    'Montana',
    'Nebraska',
    'Nevada',
    'New Hampshire',
    'New Jersey',
    'New Mexico',
    'New York',
    'North Carolina',
    'North Dakota',
    'Ohio',
    'Oklahoma',
    'Oregon',
    'Pennsylvania',
    'Rhode Island',
    'South Carolina',
    'South Dakota',
    'Tennessee',
    'Texas',
    'Utah',
    'Vermont',
    'Virginia',
    'Washington',
    'West Virginia',
    'Wisconsin',
    'Wyoming'
]) AS r WHERE name = 'United States';
