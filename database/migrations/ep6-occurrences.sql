-- ep6-occurrences.sql — EP-6 (Eventbrite-parity) multi-date scheduling migration.
--
-- HAND-APPLY THIS TO THE LIVE DATABASE (there is no migration framework — SPEC
-- §A3). It is idempotent-friendly (IF NOT EXISTS guards) so a re-run is safe.
-- Local dev does NOT need this file: schema.sql already contains the same DDL and
-- is auto-applied on a fresh `docker compose up` (re-seed with
-- `docker compose down -v`). This directory is a SUBFOLDER of ./database so the
-- Postgres init hook (top-level *.sql only) never auto-runs it.
--
--   psql "$DATABASE_URL" -f database/migrations/ep6-occurrences.sql
--
-- It creates ONE new child table + its index. Purely additive, NO backfill:
-- existing event_versions keep their scalar start_datetime/end_datetime and have
-- ZERO occurrence rows; reads treat "no rows" as a single implied occurrence built
-- from those scalars (E-D2, mirrors EP-2's no-backfill). The scalars remain the
-- authoritative DERIVED SUMMARY (MIN(starts_at)/MAX(ends_at)), so the whole
-- existing read surface is unchanged. As in EP-2, take a pg_dump backup first, then
-- apply from inside the VPC via the bastion (aws ssm start-session --target
-- i-006f461be066cc1b4 --region ap-southeast-1, then psql).

BEGIN;

-- event_occurrences — per-date schedule of a version (see schema.sql for the full
-- rationale). FK ON DELETE CASCADE: an occurrence can't outlive its immutable
-- version snapshot (same spirit as country_regions, NOT the app-wide SET NULL).
CREATE TABLE IF NOT EXISTS event_occurrences (
    id               SERIAL PRIMARY KEY,
    event_version_id INTEGER NOT NULL REFERENCES event_versions(id) ON DELETE CASCADE,
    starts_at        TIMESTAMPTZ NOT NULL,
    ends_at          TIMESTAMPTZ NOT NULL,
    sort_order       INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_event_occurrences_version
    ON event_occurrences (event_version_id);

COMMIT;
