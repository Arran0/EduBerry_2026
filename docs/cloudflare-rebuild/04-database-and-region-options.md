# Database and Region Options: MongoDB, Firebase, DigitalOcean, India-hosted Postgres and Neon

As of 5 Nov 2026. Part of the [rebuild docs](README.md). Neon has no Indian region, which raised two questions: should the rebuild use MongoDB instead, and what would an India-hosted database cost? This doc compares the realistic hosts for a multi-tenant EduBerry, using the same workload model as the [cost study](02-cost-study.md). The numbers come from `db_options()` in [`tools/costmodel.py`](tools/costmodel.py).

## Summary

- **MongoDB is the most expensive choice in both money and effort.** It does have Indian regions. But it would cost 3–10 times as much per school as Neon. It would also mean rewriting the whole data layer:
  - 221 tables with 541 foreign keys;
  - 304 SQL functions, 172 triggers and 699 row-level security policies;
  - about 1,400 query call sites;
  - all of the fee and payroll logic, which today relies on SQL transactions and row locks.
- **Postgres is available in India, so the region is not a reason to change the type of database.** Supabase (Mumbai, today's host), AWS Aurora and RDS (Mumbai) all run Postgres in India. Moving a school between Postgres hosts is a dump and restore.
- **Neon in Singapore stays the cheapest overall.** For a 10,000-user school it costs about $30 a month, or $15 in a pod. That is because the database sleeps when nobody uses it, and an unused trial school costs almost nothing.
- **The cheapest India-hosted option depends on school size:**
  - For schools under about 5,000 users: a Supabase project per school in Mumbai costs about the same as Neon ($10–16 a month).
  - At 10,000 users: a Supabase project costs about $62, twice Neon. A shared RDS server in Mumbai costs $35–68, depending on high availability.
  - Neither sleeps, so every signed-up school costs money from day one.
- **Recommendation:**
  1. Keep Postgres and stay on Neon in Singapore.
  2. Measure the real latency from India this week (spike S4).
  3. Confirm that no school contract requires storage in India.
  4. If either check fails, use India-hosted Postgres for the schools that need it. Nothing in the design has to change except where those schools' databases live.

## Lessons from running on Supabase today

The live school runs on a Supabase **Micro** compute: 1 GB of RAM, a shared CPU, and 60 direct connections. On 5 Nov 2026, 43 of those 60 were open, 21 of them held by Supabase's API (PostgREST). The limits felt so far come from that size:

| Problem felt | Cause on Supabase | Neon | DigitalOcean |
| --- | --- | --- | --- |
| Running out of compute | A fixed size per project (Micro $10, Small $15, Medium $60, Large $110); on Micro and Small, a disk IO budget that throttles to the baseline when used up; resizing restarts the database | Autoscales between a floor and a ceiling (for example 0.25–2 CU) as load changes, with no restart; billed by the CU-hour actually used | Fixed size; resizing is manual |
| Connection limit | 60 direct connections and 200 pooled clients on Micro, shared by everything in the project | Up to 10,000 pooled clients per database; Workers use the HTTP driver, which holds no connections | 97 connections on 4 GiB and 21 pools per cluster, shared by every school on the cluster |
| Inflexible pricing | Pro is $25 per organisation plus each project's compute size. The $599 Team plan adds compliance, SSO and support, not capacity | Pay per CU-hour and GB; nothing to pick per school beyond the autoscaling range | A fixed price per cluster or droplet |

In EdZee each school has its own database, so one school's load never uses up another school's limits. That holds on Neon projects and Supabase projects; on pods and shared servers, schools share a compute or a cluster.

## The two concerns behind "no servers in India"

| Concern | What it means for EduBerry |
| --- | --- |
| **Speed** | A round trip from India to Singapore takes about 30–60 ms more than one to Mumbai. With one API call per screen (phase 2), a screen gets about that much slower, and the Worker runs next to the database. Today's chatty screens (phase 1) cross several times and feel it more; that is why [16](16-frontend-and-api.md) moves the busiest screens to single calls first. Spike S4 measures this from real Indian networks before anything is decided |
| **Where data is stored** | India's Digital Personal Data Protection Act, 2023 does not, as written, require personal data to stay in India: transfers abroad are allowed unless the government restricts the destination country. Children's data needs verifiable parental consent wherever it is stored. A school's contract, a state government or a school board can still require India storage. This is not legal advice; check contracts before promising either way |

## Cost per school

USD per school per month, typical usage, year one, on a running account. Each figure includes the school's share of Cloudflare (Workers, R2, queues, hub, logs), which is about $0.30 at 1,000 users and $2.70 at 10,000.

| Host | 1,000 users | 3,000 users | 10,000 users | Sleeps when idle? |
| --- | --- | --- | --- | --- |
| **Neon, project per school (Singapore)** | **$9** | **$19** | **$30** | Yes, after 5 minutes; wakes in under a second |
| **Neon, pods of about 20 schools (Singapore)** | **$4** | **$9** | **$15** | Yes, when every school in the pod is idle |
| Supabase, project per school (Mumbai) | $10 | $16 | $62 | No |
| AWS Aurora Serverless v2, per school (Mumbai) | $20 | $41 | $63 | Yes, but resuming takes about 15 seconds |
| Shared AWS RDS server, database per school, single-AZ (Mumbai) | $10 | $21 | $35 | No |
| Same, Multi-AZ (a standby server) | $21 | $42 | $68 | No |
| Same, Multi-AZ with 1-year reserved pricing | $14 | $27 | $45 | No |
| MongoDB Atlas, cluster per school (Mumbai) | $59 (Flex $8–30 if under its limits) | $147 | $149–397 (M20–M30) | No |
| MongoDB Atlas, shared M40 clusters (Mumbai) | $48 | $96 | $154 | No |

Assumptions:

- Each school needs its busy data in memory: about 1 GB at 1,000 users, 2 GB at 3,000 and 3 GB at 10,000. This is the same rule the cost study uses for Neon.
- Neon is awake about 333 hours a month (school days, evenings, a nightly job window).
- Always-on hosts bill all 730 hours.
- Shared servers hold as many schools as fit in 16 GB: about 16 schools of 1,000 users, 8 of 3,000 or 5 of 10,000.
- Supabase compute sizes:
  - Micro, 1 GB, $10;
  - Small, 2 GB, $15;
  - Medium, 4 GB, $60, plus one Pro organisation fee.
- Aurora: $0.12 per ACU-hour, where 1 ACU is about 2 GB; storage $0.10 per GB, before I/O charges.
- RDS: `db.r6g.large`, 16 GB, $0.225 an hour.
- MongoDB Atlas:
  - M10 (2 GB) $0.08 an hour;
  - M20 (4 GB) $0.20;
  - M30 (8 GB) $0.54;
  - M40 (16 GB) $1.04.
  - Atlas prices include a three-node replica set.
- AWS and Atlas list prices are for US East. Mumbai list prices are usually somewhat higher, so their rows are lower bounds.

### A fleet of 50 schools of 10,000 users

| Host | Per month |
| --- | --- |
| Neon pods (Singapore) | about $760 |
| Neon, project per school (Singapore) | about $1,490 |
| Shared RDS, single-AZ (Mumbai) | about $1,770 |
| Shared RDS, Multi-AZ, reserved (Mumbai) | about $2,260 |
| Supabase, project per school (Mumbai) | about $3,140 |
| Aurora Serverless v2 (Mumbai) | about $3,130 |
| MongoDB Atlas, shared M40 (Mumbai) | about $7,710 |
| MongoDB Atlas, cluster per school (Mumbai) | $7,430–19,830 |

### Schools that sign up but barely use the app

With checkout opening the app straight away, some schools will sign up and use it lightly or not at all.

| Host | Cost of such a school |
| --- | --- |
| Neon | Almost nothing: the database sleeps; about $0.02 a month of storage |
| Supabase | At least $10 a month for its project from the first day |
| Shared RDS | Its share of a server that runs all month |
| MongoDB Atlas | At least $8 (Flex) or $57 (M10) a month |

## What each choice costs in work

Money is not the only cost. The rebuild's effort depends on how much of today's app survives:

| Host | Database logic | Phase 1 (today's browser queries kept) | Other work | Effort |
| --- | --- | --- | --- | --- |
| Neon | Moves as is | Yes, through Neon's Data API | As in docs 10–17 | Baseline |
| Supabase (Mumbai) | Moves as is (it is already there) | Yes, PostgREST is built in | Could keep Supabase Auth, Storage and Realtime per project, but `pg_cron` keeps every project awake and each school pays for a full project | Least |
| Aurora or RDS (Mumbai) | Moves as is | No Data API: either run PostgREST ourselves per school, or move every screen to Worker endpoints before cutover | Connection pooling from Workers (Hyperdrive allows 25 configurations, so shared servers need our own pooler); no branching for tests and previews | Baseline plus a few months |
| MongoDB | Rewritten: every function, trigger and policy becomes application code; tenant and role checks move into every query | No | Every screen's data access, the importer, money and payroll transactions, reports | Largest: more than the Durable Object design rejected on 5 Nov |

## DigitalOcean (Bangalore), checked on 5 Nov 2026

DigitalOcean runs managed Postgres (versions 15–18), droplets, Spaces and Functions in Bangalore (BLR1). It supports the extensions the app uses: `pgcrypto`, `uuid-ossp`, `btree_gist` and `pg_stat_statements`, plus `pg_cron` on the Standard edition. The admin user `doadmin` is not a superuser.

### Does the multi-tenant model work on it?

Yes, at the database level. [`tools/spike-do/verify.sh`](tools/spike-do/verify.sh) checks every piece of the school-isolation model with an admin restricted like `doadmin` (CREATEROLE and CREATEDB, no superuser, no BYPASSRLS). On a local Postgres 16, all 16 checks passed:

| Check | Result |
| --- | --- |
| Shared `anon` and `authenticated` roles; a database per school | Pass |
| A login role per school, NOINHERIT, that can open only its own database | Pass. Another school's login gets "permission denied for database" |
| Row-level security as the user: `set local role` plus `request.jwt.claims`, read by the `auth.uid()` shim | Pass. A student sees one profile and a teacher sees all; writing someone else's row is refused; the login role alone reads nothing |
| `SECURITY DEFINER` helpers, the `auth.users` trigger, `pgcrypto` in an `extensions` schema, a `btree_gist` exclusion constraint | Pass |
| A new school cloned from a template database | Pass, in about 0.2 seconds, so instant sign-up works without a pool of ready databases |
| `pg_dump` and `pg_restore` without superuser rights | Pass |

DigitalOcean's docs do not list `doadmin`'s exact rights. Run the same script on a real Bangalore cluster to confirm them before committing ([`tools/spike-do/README.md`](tools/spike-do/README.md)).

### What changes around the database

| Area | Neon design | On DigitalOcean |
| --- | --- | --- |
| Where the API runs | Cloudflare Workers, querying Neon over HTTPS | **Servers in Bangalore next to the database** (App Platform or droplets), keeping a small connection pool per school. Workers would have to open a new connection to Bangalore for every request, and Hyperdrive allows only 25 configurations, not one per school database. Cloudflare stays in front for the static app, CDN, firewall and R2 |
| Phase 1 (today's browser queries) | Neon's Data API | No Data API. Either run PostgREST per school on the API servers (about 30 MB each), or move every screen to an endpoint before cutover |
| Database exposure | Public endpoint with TLS | Trusted sources can limit the database to the API servers only, which is safer |
| Sleeping when idle | Yes | No: clusters run all month |
| High availability | Built into Neon's storage | From 30 Nov 2026, new **Standard** clusters are limited to 4 GiB and cannot add a standby node. A standby needs the **Advanced** edition (8 GiB from about $130 per node, the standby the same again), or our own droplets |
| Connections | Pooled by Neon (10,000 clients) | 97 connections on a 4 GiB cluster, and 21 PgBouncer pools per cluster. About 10 schools per cluster if each holds a few connections, unless we run our own PgBouncer |
| Scheduled jobs | Hub timer, so the database sleeps | `pg_cron` works on Standard (but not Advanced), but `pg_net` does not, so the outbox drains still need our own worker |
| Restore | Per school (project) or per pod | Per cluster, the last 7 days, into a new cluster; one school is then copied back with `pg_dump` |
| Test and preview databases | Neon branches in seconds | Postgres in Docker for CI; a restored cluster for staging |
| Limits | 100 projects on Launch | 10 clusters per account by default (raised on request) |

### Cost per school

USD per month, including the Cloudflare share, from `db_options()`:

| Host | 1,000 users | 3,000 | 10,000 |
| --- | --- | --- | --- |
| Neon pods (Singapore) | $4 | $9 | $15 |
| Neon, project per school (Singapore) | $9 | $19 | $30 |
| Supabase, project per school (Mumbai) | $10 | $16 | $62 |
| DigitalOcean managed, Standard 4 GiB, no standby | $15 | $31 | $63 |
| DigitalOcean managed, Advanced 8 GiB with standby | $33 | $66 | $132 |
| DigitalOcean droplets with Postgres run by us, with standby | $11 | $22 | $36 |

The DigitalOcean API servers in Bangalore add about $50–100 a month in total, shared by all schools.

### Verdict

- **DigitalOcean works for the multi-tenant model.** It is the fastest option for Indian users, with the API and the database in the same Bangalore datacentre.
- **It is not cheaper than the alternatives unless we run Postgres ourselves.**
  - Its managed Postgres costs more than Supabase in Mumbai at every size.
  - High availability needs the Advanced edition.
  - Running Postgres on droplets is cheaper, but then backups, failover, upgrades and monitoring are our job.
- **It also means more of our own infrastructure:** API servers, PostgREST per school for phase 1, connection pooling, and no sleeping or branching.
- **Where it fits:**
  - When storing data in India is required, Supabase in Mumbai is the simpler first step.
  - DigitalOcean droplets suit large schools later, once there is someone to run the database.
  - If India storage is not required, Neon stays cheapest and simplest. Spike S4 decides whether its speed is acceptable.

## Firebase (Firestore), checked on 5 Nov 2026

Firestore runs in Mumbai and Delhi, and Firebase Auth can import today's bcrypt passwords. But Firestore is a document database like MongoDB, so it has the same problem: every table, function, trigger and policy is rewritten.

| Area | Today (Postgres) | On Firestore |
| --- | --- | --- |
| Tables | 221 tables, 541 foreign keys | Collections with copied data; no joins, so screens that join tables need duplicated fields kept in step |
| Logic | 304 SQL functions, 172 triggers | Cloud Functions, rewritten one by one |
| Who sees what | 699 row-level security policies | Security Rules, rewritten. A rule can look up only a few other documents, so rules such as "teacher of this classroom" or "approver on this leave" need extra copied data |
| Money | Fee allocation and payroll in single SQL transactions with row locks | Firestore transactions, with tighter limits on size and contention |
| Reports | SQL over the year's rows | Totals kept up to date by functions, or every document read and billed |
| Billing | Compute hours | Every document read and written. A 10,000-user school reading about 30 documents per screen would cost roughly $40–150 a month, more if reports read raw data; a bug that loops can run up the bill |
| Several schools | A database per school | One Firebase project with a school field on every document, guarded by rules (one mistake shows one school's data to another), or a Google Cloud project per school |

Firebase Data Connect puts Postgres (Cloud SQL) behind Firebase, in Mumbai too, but it replaces row-level security with its own access layer and runs an always-on Cloud SQL instance. If Google's Postgres in India were wanted, plain Cloud SQL or AlloyDB in Mumbai would sit in the same place as AWS RDS in the table above.

## What would make each option the right one

| If… | Then… |
| --- | --- |
| Spike S4 shows screens under 300 ms from India and no contract needs India storage | **Neon in Singapore**, with small schools in pods (the current design) |
| Some schools must keep data in India | Those schools on India-hosted Postgres: a Supabase project in Mumbai while small, a shared RDS server in Mumbai once there are several large ones. The rest stay on Neon. The Worker already looks up each school's connection string, so a mixed fleet needs only a second database driver path |
| Every school must keep data in India | Supabase in Mumbai, project per school, for the first years; shared RDS in Mumbai when large schools make it cheaper. Expect a higher price per school and plan the price list for it |
| Neon opens an Indian region | Move schools there with a dump and restore, school by school |
| Anyone proposes MongoDB or Firebase again | The answer above stands: dearer per school, no row-level security, and a full rewrite of the logic that handles money |

## Open questions

- [ ] Do any current or prospective schools' contracts require data to stay in India?
- [ ] Spike S4: real latency from Indian networks (Jio, Airtel, school broadband) to Neon Singapore, per screen.
- [ ] If India storage becomes a paid add-on, what price covers the extra cost?

## Sources

- MongoDB Atlas pricing (updated 29 Sep 2026): <https://www.mongodb.com/pricing>
- Aurora Serverless v2 scaling to zero: <https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-serverless-v2-auto-pause.html>
- Aurora pricing overview: <https://www.bytebase.com/blog/understanding-aws-aurora-pricing.md>
- RDS instance prices: <https://instances.vantage.sh/aws/rds/db.t4g.medium>
- DigitalOcean Managed PostgreSQL pricing (Standard Edition limited to 4 GiB for new clusters from 30 Nov 2026): <https://docs.digitalocean.com/products/databases/postgresql/details/pricing/>
- Neon pricing and regions: <https://neon.com/pricing>, <https://neon.com/docs/introduction/regions>
- Supabase pricing: <https://supabase.com/pricing>
- Firestore pricing: <https://cloud.google.com/firestore/pricing>
- DigitalOcean PostgreSQL limits, extensions, pricing and regional availability: <https://docs.digitalocean.com/products/databases/postgresql/details/limits/>, <https://docs.digitalocean.com/products/databases/postgresql/details/supported-extensions/>, <https://www.digitalocean.com/pricing/managed-databases>, <https://www.digitalocean.com/pricing/droplets>, <https://docs.digitalocean.com/platform/regional-availability/>
- Supabase compute sizes, connections and disk IO budget: <https://supabase.com/docs/guides/platform/compute-and-disk>
