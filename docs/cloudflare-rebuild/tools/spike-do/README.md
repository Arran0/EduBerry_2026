# Spike: does DigitalOcean (Bangalore) fit EdZee's multi-tenant model?

`verify.sh` checks that a DigitalOcean managed Postgres cluster supports the way EdZee keeps schools apart ([11](../../11-tenancy-and-control-plane.md)):

- a database per school;
- shared `anon` and `authenticated` roles;
- a login role per school that can open only its own database;
- row-level security as the signed-in user, through the `auth.uid()` shim;
- the extensions the app uses, in an `extensions` schema;
- SECURITY DEFINER helpers and the `auth.users` trigger;
- a new school cloned from a template database;
- `pg_dump` and `pg_restore` without superuser rights.

On 5 Nov 2026 all 16 checks passed on a local Postgres 16 with an admin set up like DigitalOcean's `doadmin` (CREATEROLE and CREATEDB, no superuser, no BYPASSRLS). Running it on a real cluster confirms DigitalOcean's own restrictions, which its docs do not fully list.

## Run it on a real cluster (about 15 minutes, a few cents)

1. DigitalOcean console → Databases → Create. Choose:
   - PostgreSQL 17;
   - datacenter **Bangalore (BLR1)**;
   - the smallest plan (1 GiB, about $15 a month, billed by the hour).
   Leave **Trusted sources** empty while testing.
2. When it is ready, copy the **doadmin** connection string (Connection details → Connection string). Also click **Download CA certificate**.
3. On the Mac:

   ```sh
   brew install libpq && brew link --force libpq     # psql, pg_dump, pg_restore
   cd ~/EduBerry_2026 && git pull
   cd docs/cloudflare-rebuild/tools/spike-do
   read -rs DO_ADMIN_URL && export DO_ADMIN_URL      # paste the doadmin string, press Enter
   bash verify.sh
   ```

4. Measure speed from India with the S4 script, using the same string and the downloaded certificate:

   ```sh
   cd ../spike-s4 && npm install
   export DO_DB_URL="$DO_ADMIN_URL" DO_CA=~/Downloads/ca-certificate.crt
   read -rs NEON_URL && export NEON_URL
   read -rs SUPABASE_ANON_KEY && export SUPABASE_ANON_KEY
   node latency.mjs --label home-wifi
   ```

5. Paste both outputs into the chat, then **destroy the cluster** so it stops billing.
