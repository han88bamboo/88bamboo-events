-- 00-init.sql — runs first on the local Postgres container's first boot, via
-- /docker-entrypoint-initdb.d (PATTERN-SPEC §A3.6). Files run in filename order.
--
-- Extensions the events schema will rely on (trigram search for the keyword/ILIKE
-- listing search in plan §8). Enabling them here is idempotent and harmless.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- NOTE: The full schema + seed (all 10 tables, pricing tier, admin user,
-- taxonomy) lands in Phase 2 as 01-schema.sql / 02-seed.sql in this directory.
-- They will be auto-applied by the same init hook on the next `down -v` + `up`.
-- See plan.md checklist Phase 2 and §7 for the table definitions.
