# Database and Region Options: MongoDB, Firebase, India-hosted Postgres and Neon

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
