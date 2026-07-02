# database/

Plain-SQL schema + seed for 88 Bamboo Events (no ORM, no migration framework —
PATTERN-SPEC §A3). The local Postgres container auto-applies everything here on
**first boot** via `/docker-entrypoint-initdb.d`, in filename order:

| Order | File | Purpose |
|------:|------|---------|
| 1 | `00-init.sql` | Enable `pg_trgm` / `unaccent` extensions |
| 2 | `schema.sql` | All 10 tables + non-secret seed (pricing tier, taxonomy) |
| 3 | `seed-admin.sh` | The single admin user, from env vars (never hardcoded) |

> Postgres runs init files **only once**, on an empty data volume. To re-apply
> after changing any file: `docker compose down -v && docker compose up --build`.

## Setting the admin credentials (required, never hardcoded)

The admin login uses a client-computed hash string (PATTERN-SPEC §A6); nothing
secret is stored in source. Steps:

1. Generate the hash from the email + a password of your choice:
   ```bash
   node database/make-admin-hash.js owner@88bamboo.co 'your-password'
   ```
   It prints a number (e.g. `-1234567890`).
2. Put both values in `database/.env` (git-ignored):
   ```dotenv
   ADMIN_EMAIL=owner@88bamboo.co
   ADMIN_PASSWORD_HASH=-1234567890
   ```
3. Seed:
   ```bash
   docker compose down -v && docker compose up --build
   ```
   On boot you'll see `seed-admin: admin user '...' seeded.` in the `db` logs.

If `ADMIN_EMAIL` / `ADMIN_PASSWORD_HASH` are blank, the admin seed is skipped
(the rest of the schema still loads). You can add the admin later by setting the
vars and re-seeding, or by running the same INSERT by hand against a running db:

```bash
docker compose exec db psql -U events -d events \
  -c "INSERT INTO admin_users (email, password_hash, role, active)
      VALUES ('owner@88bamboo.co', '-1234567890', 'owner', TRUE)
      ON CONFLICT (email) DO NOTHING;"
```

## Deployed (Phase 7)

Apply the schema by hand against RDS (it re-declares the extensions, so it is
self-contained), then seed the admin the same way:

```bash
psql "postgresql://<user>:<pass>@<RDS_HOST>:5432/<db>" -f database/schema.sql
```
