-- ep7-organiser.sql — EP-7 (Eventbrite-parity) submitter-login + public
-- organiser-name migration.
--
-- HAND-APPLY THIS TO THE LIVE DATABASE (there is no migration framework — SPEC
-- §A3). It is idempotent-friendly (IF NOT EXISTS guards) so a re-run is safe.
-- Local dev does NOT need this file: schema.sql already contains the same DDL and
-- is auto-applied on a fresh `docker compose up` (re-seed with
-- `docker compose down -v`). This directory is a SUBFOLDER of ./database so the
-- Postgres init hook (top-level *.sql only) never auto-runs it.
--
--   psql "$DATABASE_URL" -f database/migrations/ep7-organiser.sql
--
-- It adds ONE nullable column + ONE new registry table + its index. Purely
-- additive, NO backfill (F-D6, mirrors EP-2/EP-6): existing event_versions get a
-- NULL organiser_name and render with no "Organised by" line; the registry starts
-- empty and legacy events never retroactively claim a name. As in EP-2/EP-6, take a
-- pg_dump backup first, then apply from inside the VPC via the bastion (aws ssm
-- start-session --target i-006f461be066cc1b4 --region ap-southeast-1, then psql).

BEGIN;

-- Public event-organiser display name, snapshotted per version (nullable — see
-- schema.sql for the full rationale).
ALTER TABLE event_versions ADD COLUMN IF NOT EXISTS organiser_name VARCHAR(255);

-- event_organiser_names — the first-come-first-served + cross-account-unique
-- registry (normalised_name UNIQUE gives the race-proof claim). See schema.sql for
-- the full rationale. Standalone reference-style rows; no FK.
CREATE TABLE IF NOT EXISTS event_organiser_names (
    id              SERIAL PRIMARY KEY,
    normalised_name VARCHAR(255) NOT NULL UNIQUE,
    owner_email     VARCHAR(255) NOT NULL,
    display_name    VARCHAR(255) NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_event_organiser_names_owner
    ON event_organiser_names (owner_email);

COMMIT;
