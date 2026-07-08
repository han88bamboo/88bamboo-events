-- mi1-additional-images.sql — post-go-live "multi-image submission upload"
-- migration (plan.md backlog, up to 6 images + carousel).
--
-- HAND-APPLY THIS TO THE LIVE DATABASE (there is no migration framework — SPEC
-- §A3). It is idempotent-friendly (IF NOT EXISTS guards) so a re-run is safe.
-- Local dev does NOT need this file: schema.sql already contains the same DDL and
-- is auto-applied on a fresh `docker compose up` (re-seed with
-- `docker compose down -v`). This directory is a SUBFOLDER of ./database so the
-- Postgres init hook (top-level *.sql only) never auto-runs it.
--
--   psql "$DATABASE_URL" -f database/migrations/mi1-additional-images.sql
--
-- It adds TWO nullable-safe columns to the existing `files` table. Purely
-- additive, NO backfill: existing rows (the one-per-version feature-image
-- row written by scripts/submissions.py) keep sort_order=0 and url=NULL and are
-- never read by the new carousel/gallery code, which only reads sort_order > 0.
-- As in EP-2/EP-6/EP-7, take a pg_dump backup first, then apply from inside the
-- VPC via the bastion (aws ssm start-session --target i-006f461be066cc1b4
-- --region ap-southeast-1, then psql).

BEGIN;

ALTER TABLE files
    ADD COLUMN IF NOT EXISTS sort_order INT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS url        TEXT;

COMMIT;
