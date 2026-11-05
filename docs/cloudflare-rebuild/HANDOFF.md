# Handoff prompt for the new repository

Paste the block below as the first message of a Claude session in the new repository (the clone that becomes EdZee). Written 5 Nov 2026.

```text
You are building EdZee, the multi-tenant version of the EduBerry school app, in this repository, a clone of arran0/EduBerry_2026. EduBerry is today's one-school app on Supabase and Vercel. EdZee serves every school from one deployment. Domains like <slug>.edzee.in are placeholders until registered.

1. Get the plan first
- The plan is in docs/cloudflare-rebuild/. If it lacks 04-database-and-region-options.md, HANDOFF.md, tools/spike-s4/ or tools/spike-do/, bring docs/cloudflare-rebuild/ over from arran0/EduBerry_2026 main (latest commit) before anything else.
- Read 13 (data layer) and 11 (tenancy) closely, then README, 01, 04, 10, 12, 14, 16, 90, 91, 92. Section docs 20–37 when you reach that section.

2. Decided; do not reopen
- Database: Neon Postgres 17 in Singapore (aws-ap-southeast-1), one database per school. New and small schools are databases in shared "pod" projects of about 20; large or premium schools get a project of their own. The owner confirmed Neon on 5 Nov 2026 after comparing MongoDB, Firebase, DigitalOcean and India-hosted Postgres (doc 04).
- Speed from India: published round trips to Singapore are 12–50 ms longer than to Mumbai (doc 01, "Spike S4, desk estimate"). That is accepted, with one call per screen for the busiest screens.
- Everything else on Cloudflare:
  - one router Worker (Hono) plus the static SPA;
  - R2, Queues and a KV host cache;
  - the platform database on Neon through Hyperdrive;
  - one SchoolHub Durable Object per school for live sockets and the job timer.
- Our own sign-in. auth.users is kept with the same ids and columns. auth.uid() reads request.jwt.claims, set per transaction by the Worker (spike S2 confirms, or switches to pg_session_jwt).
- Phase 1 keeps today's browser queries through Neon's Data API behind /api/db. Phase 2 moves each screen to one endpoint.
- Nothing scheduled runs inside Postgres; databases sleep at night.
- A school can use EdZee seconds after checkout (doc 11).

3. The database is NOT designed from scratch
EdZee's school database is today's live Supabase database, as it is: 221 tables, 304 functions, 172 triggers and 699 row-level security policies. Only the 11 Supabase hooks listed in doc 13 change. Do not redesign tables, rewrite functions or invent a new schema. docs/cloudflare-rebuild/reference/live-schema.md describes it, but the source of truth is the live database itself.

Build it in this order:
a) Baseline from live. The owner runs, on their Mac:
   pg_dump --schema-only --schema=public --no-owner --no-privileges
   against Supabase project tgxxqzeaqxiwoqzopcku (mps-web, Mumbai), plus a dump of the cron job list.
   This cloud container cannot reach Postgres ports (tested on 5 Nov 2026: port 5432 to Neon and Supabase is blocked), so dumps and big restores run on the Mac. Give exact commands.
   Commit the schema-only dump as db/baseline/supabase-public-schema.sql; it holds no data or secrets.
b) Preparation SQL, db/migrations/0000_prepare.sql:
   - the roles anon, authenticated and service_role (NOLOGIN);
   - per-database login roles app_worker and app_jobs, granted authenticated/anon WITH INHERIT FALSE;
   - an extensions schema with pgcrypto, uuid-ossp and btree_gist (pg_stat_statements as Neon allows);
   - the auth schema: our auth.users with the columns the functions use, auth.sessions, auth.one_time_tokens, and auth.uid(), auth.jwt() and auth.role() reading request.jwt.claims.
c) The baseline itself: db/migrations/0001_baseline.sql = the dump.
d) The adaptation migration, db/migrations/0002_adapt.sql (doc 13, "Supabase hooks and their replacements"):
   - drop the pg_net functions (fee_kick_drain, wa_kick_drain, transport_kick_drain, cleanup_net_responses);
   - drop the supabase_realtime publication;
   - drop the storage policies;
   - leave the runtime-URL settings unused;
   - grants as on Supabase.
e) Apply 0000–0002 to a Neon BRANCH and report every error. Start with schema only; load data only once the owner confirms that storing school data in Singapore is fine (doc 04), or use an anonymised copy.
f) Template and multi-tenancy checks. tools/spike-do/verify.sh is plain Postgres: run it against a Neon branch, with the branch's owner connection string as DO_ADMIN_URL. It checks:
   - shared roles, and a login role per school that can open only its own database;
   - row-level security as the user;
   - SECURITY DEFINER functions, extensions and triggers;
   - CREATE DATABASE ... TEMPLATE;
   - dump and restore.
   All 16 checks passed on local Postgres 16 with a non-superuser admin. Confirm on Neon, especially CREATE DATABASE ... TEMPLATE inside a pod project, which makes sign-up instant. If Neon refuses it, use the pool of ready databases in doc 11.
g) The platform database schema, db/platform/: schools, school_databases, school_db_credentials, ready_databases, db_pods, school_hosts, plans, school_features, provisioning_runs, school_migrations and the rest of the tables in doc 11.
h) tools/migrate, which applies db/migrations to every school database and records each run in school_migrations (doc 13).
Then continue with spikes S2 (auth.uid() and the RLS matrix per role, doc 91) and S3 (the Data API against today's query catalogue, doc 16), then the milestones in doc 92.

4. Connectors and secrets
- Neon: use the Neon connector (MCP tools such as list_projects, create_branch, run_sql, run_sql_transaction, describe_table_schema, compare_database_schema, prepare_database_migration and complete_database_migration, get_connection_string, provision_neon_data_api). If it is not loaded, ask the owner to enable it in claude.ai connector settings.
- The spike project is EdZee2027, id shiny-smoke-43180905: aws-ap-southeast-1, Postgres 17, autoscaling 0.25–2 CU. It is on Neon's free plan (1 GB per branch, 6 hours of restore history), enough for the 207 MB database. Work on branches, never on the default branch. Move to the Launch plan before any school uses it.
- Supabase: use the Supabase connector for read-only queries on the live database. Any change to live goes in a SQL file the owner reviews and runs.
- Never write a connection string, password or key into the repository, and never ask for one in the chat. Connection strings the owner needs on the Mac are entered with: read -rs VAR && export VAR. Check .gitignore covers any .env file before creating one.

5. How the owner works
- Short, direct replies.
- Exact Mac terminal steps whenever they must run something. The old repo is at /Users/arran/EduBerry_2026; ask where the clone is.
- Docs in plain English, short sentences and tables; update them whenever a decision or fact changes.
- Commit with clear messages. Push to your branch, and to main at the end of each round when the owner asks.
- No pull requests unless asked. Never force-push. Never print or commit secrets.

6. Open questions for the owner
- Is storing school data in Singapore acceptable? This decides real versus anonymised data in step e.
- Import the one auth user without a profile?
- Delete the resolved transport no_gps alerts before the move?
- Which modules each plan includes?
```
