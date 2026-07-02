#!/bin/sh
# seed-admin.sh — seeds the single MVP admin user from environment variables so
# no credentials are ever committed to source (plan §7; secrets-in-env rule).
#
# The Postgres image runs every *.sql and *.sh in /docker-entrypoint-initdb.d
# once on first boot, in filename order. "seed-admin.sh" sorts AFTER "schema.sql"
# (C-locale: 's','e' > 's','c'), so the admin_users table already exists here.
#
# Reads (supplied via database/.env -> the db container's environment):
#   ADMIN_EMAIL          the admin login email
#   ADMIN_PASSWORD_HASH  the client-style password hash (see database/make-admin-hash.js)
# Postgres provides POSTGRES_USER / POSTGRES_DB automatically.
#
# If either var is unset, the seed is skipped with instructions — the admin can
# be added later as a documented one-off step (see database/README.md).
set -e

if [ -z "$ADMIN_EMAIL" ] || [ -z "$ADMIN_PASSWORD_HASH" ]; then
    echo "seed-admin: ADMIN_EMAIL / ADMIN_PASSWORD_HASH not set — skipping admin seed."
    echo "seed-admin: to add the admin later, set both in database/.env and re-seed with"
    echo "seed-admin:   docker compose down -v && docker compose up --build"
    echo "seed-admin: (generate the hash with: node database/make-admin-hash.js <email> <password>)"
    exit 0
fi

# :'var' quotes the value safely — no string interpolation into the SQL text.
psql -v ON_ERROR_STOP=1 \
     -v email="$ADMIN_EMAIL" \
     -v hash="$ADMIN_PASSWORD_HASH" \
     --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<'EOSQL'
INSERT INTO admin_users (email, password_hash, role, active)
VALUES (lower(trim(:'email')), :'hash', 'owner', TRUE)
ON CONFLICT (email) DO NOTHING;
EOSQL

echo "seed-admin: admin user '$ADMIN_EMAIL' seeded."
