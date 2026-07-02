-- 00-init.sql — runs first on the local Postgres container's first boot, via
-- /docker-entrypoint-initdb.d (PATTERN-SPEC §A3.6). Files run in filename order.
--
-- Extensions the events schema will rely on (trigram search for the keyword/ILIKE
-- listing search in plan §8). Enabling them here is idempotent and harmless.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- NOTE: The full schema + non-secret seed (all 10 tables, pricing tier,
-- taxonomy) live in schema.sql; the admin user is seeded from env by
-- seed-admin.sh. Init files run in filename order: 00-init.sql -> schema.sql ->
-- seed-admin.sh. All auto-applied by this init hook on the next `down -v` + `up`.
-- See plan.md §7 and database/README.md.
