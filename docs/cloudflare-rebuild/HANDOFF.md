# Handoff prompt for the new repository

Paste the block below as the first message of a Claude session in the new repository (the clone that becomes the multi-tenant app). Written 5 Nov 2026.

```text
You are building EdZee, the multi-tenant rebuild of the EduBerry school app, in this repository, a clone of arran0/EduBerry_2026. EduBerry is today's one-school app; EdZee is the product name from now on (domains like <slug>.edzee.in are placeholders until registered).

1. Get the latest plan first
- The plan lives in docs/cloudflare-rebuild/. If it lacks 04-database-and-region-options.md, HANDOFF.md or tools/spike-s4/, bring docs/cloudflare-rebuild/ over from arran0/EduBerry_2026 main (commit 20bbd32 or later) before anything else.
- Read, in order: README.md, 01, 02, 04, 10, 11, 12, 13, 14, 16, 90, 91, 92. Section docs 20–37 when you work on that section.

2. Decisions already made (do not reopen without new evidence)
- Each school keeps its own Postgres 17 database on Neon in Singapore (aws-ap-southeast-1). New and small schools are databases in shared "pod" projects (about 20 per project); large or premium schools get a project of their own.
- Everything else runs on Cloudflare: one router Worker (Hono) with the static SPA on Workers Static Assets, R2 for files, Queues, a KV host cache, the platform database on Neon through Hyperdrive, and one SchoolHub Durable Object per school for live sockets and the job timer (it holds no school data).
- Tables, functions, triggers and row-level security move unchanged with pg_dump/pg_restore. Only the 11 Supabase hooks listed in doc 13 change.
- Our own sign-in: auth.users kept with the same ids and column names; a 15-minute access token signed per school plus an HttpOnly refresh cookie; auth.uid() from request.jwt.claims or Neon's pg_session_jwt (spike S2 decides).
- Phase 1 keeps today's PostgREST queries through Neon's Data API behind a /api/db proxy; phase 2 moves each screen to one endpoint.
- Nothing scheduled runs in Postgres, so databases sleep at night.
- A school can use the app seconds after checkout: provisioning takes a database from a pool of ready ones (doc 11).
- MongoDB and India-hosted Postgres were costed and set aside (doc 04); India-hosted Postgres stays a per-school fallback if a contract demands it.

3. Where things stand
- The live app still runs on Supabase project tgxxqzeaqxiwoqzopcku (mps-web, Mumbai) and Vercel. Do not change it, except through small migrations the user reviews and runs.
- The user has created a Neon project for the spikes: EdZee2027, id shiny-smoke-43180905, aws-ap-southeast-1, Postgres 17, autoscaling 0.25–2 CU. It is on Neon's free plan (1 GB per branch, 6 hours of restore history), which is enough for the 207 MB live database. Do every experiment on a Neon branch, never on its default branch. Move to the Launch plan before any school uses it.
- The user's claude.ai account has the Neon connector, so the Neon tools may already be available; check before asking for keys.
- Spike S4 part A (docs/cloudflare-rebuild/tools/spike-s4) runs on the user's Mac in India; ask for its results.
- Nothing of the new platform is built yet. Next is milestone M0, spikes S1–S8 (docs 01 and 92).

4. Connecting to Neon and Supabase
- Never write a connection string, password or API key into the repository or ask for one in the chat. Ask the user to add them as environment variables or secrets in the session's environment settings:
  - DATABASE_URL: Neon direct string, for restores and migrations;
  - DATABASE_URL_POOLED: the -pooler string, for the app and tests;
  - NEON_API_KEY: a key limited to the project.
- Alternatively, the user can connect the Neon connector in claude.ai.
- Check .gitignore covers any .env file before creating one.
- Reading the live Supabase database with read-only queries is fine. Any change to it goes in a SQL file that the user runs after review.

5. First tasks, one at a time, with the user
- S1: restore the live database into a Neon branch, following "Moving each school's data from Supabase" in doc 13:
  1. Prepare the roles, the extensions schema, and the auth schema with its shim.
  2. Copy the needed columns of auth.users.
  3. Run pg_dump from Supabase. The user runs it on the Mac unless a Supabase database URL is in the environment.
  4. Run pg_restore into the Neon branch.
  5. Apply the adaptation migration.
  6. Report every error.
  If the user has not confirmed that school data may be stored in Singapore (doc 04), use an anonymised copy.
- S2: the auth.uid() shim, and the row-level security matrix per role (doc 91).
- S3: the Data API against today's query catalogue (doc 16).
- S4 part B once S1 is done, then S5–S8 as in doc 01.
- Record each spike's result in the spikes table of doc 01 and in the README progress log.

6. How the user wants to work
- Keep chat replies short and direct.
- When the user must run something, give exact Mac terminal steps. The old repo is at /Users/arran/EduBerry_2026; ask where the clone lives.
- Docs: plain English, short sentences, tables. Update the docs whenever a decision or fact changes.
- Commit with clear messages. Push to the branch you are given, and to main when the user asks (they have liked a push to main at the end of each round).
- No pull requests unless asked. Never force-push. Never print or commit secrets.

7. Open decisions waiting on the user
- Is storing school data in Singapore acceptable (doc 04)?
- Import the one auth user that has no profile?
- Delete the resolved transport no_gps alerts before the move?
- Which modules each plan includes?
```
