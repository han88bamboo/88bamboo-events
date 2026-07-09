-- ex1-explore-sitemap.sql — Explore SEO layer (EXPLORE-LAYER-PLAN §4) Phase C.
--
-- HAND-APPLY THIS TO THE LIVE DATABASE (there is no migration framework — SPEC
-- §A3). It is idempotent-friendly (IF NOT EXISTS guards) so a re-run is safe.
-- Local dev does NOT need this file: schema.sql already contains the same DDL and
-- is auto-applied on a fresh `docker compose up` (re-seed with
-- `docker compose down -v`). This directory is a SUBFOLDER of ./database so the
-- Postgres init hook (top-level *.sql only) never auto-runs it.
--
--   psql "$DATABASE_URL" -f database/migrations/ex1-explore-sitemap.sql
--
-- It adds ONE new table — the owner-curated sitemap/index amplification allowlist,
-- edited from the admin dashboard's "Explore / SEO" tab (D3b). Purely additive:
-- the table starts EMPTY, every explore place/facet page still renders on demand
-- and can rank via internal links; this list only controls what is broadcast in
-- sitemap.xml and (optionally) force-indexed. There are NO explore_places /
-- explore_facets tables — both are data-derived (D2/D3). As in EP-2/EP-6/EP-7,
-- take a pg_dump backup first, then apply from inside the VPC via the bastion.

BEGIN;

-- explore_sitemap_slugs — the owner-curated amplification allowlist (D2/D3b). One
-- row per place/facet URL below /explore the owner promotes into sitemap.xml and
-- (optionally) pins to index. See schema.sql for the full rationale.
CREATE TABLE IF NOT EXISTS explore_sitemap_slugs (
    id          SERIAL PRIMARY KEY,
    path        VARCHAR(255) NOT NULL UNIQUE,   -- below /explore: 'singapore' or 'singapore/wine-tastings'
    force_index BOOLEAN NOT NULL DEFAULT TRUE,  -- pin index,follow even below the >=3-events threshold
    created_by  INTEGER REFERENCES admin_users(id) ON DELETE SET NULL,  -- who promoted it (audit)
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMIT;
