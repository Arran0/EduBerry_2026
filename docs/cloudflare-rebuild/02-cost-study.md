# Cost Study: Schools of up to 10,000 Users on Cloudflare

As of 27 Oct 2026. Part of the [Cloudflare rebuild docs](README.md). Prices are Cloudflare's published list prices on that date; the model is [`tools/costmodel.py`](tools/costmodel.py), so every number here can be re-run with other assumptions.

## Summary

- **A typical 10,000-user school costs about $13 a month on Cloudflare** in its first year, and about $19 if most students and parents use the app every day. A 3,000-user school costs about $4 and a 1,000-user school under $1.50.
- **The account's first school costs about $6 in total**, because the $5 Workers Paid plan includes 10 million requests, 25 billion rows read and 50 million rows written a month.
- **Durable Objects and D1 cost the same to within 5%** in year one. By year three D1 is about 15% dearer for large schools, because its SQL storage is $0.75 against Durable Objects' $0.20 per GB-month.
- **Rows written are 60% of the bill.** Every indexed column written counts as an extra row. GPS position fixes alone are about $2.60 of a 10,000-user school's monthly cost; keeping only the latest fix in SQL and the trail in R2 would cut that by about 90%.
- **Today's chatty browser code would more than double the bill.** At today's measured 500 database requests per active staff member a day, 50 large schools cost about $1,470 a month instead of $550. Consolidating each screen into one API call is a cost requirement, not only a speed one.
- **Shared D1 costs the same per row but cannot hold these schools** (10 GB cap, one thread). See [01-architecture-options.md](01-architecture-options.md).

## Where the workload numbers come from

The model starts from the one school running today and scales it to larger schools.

| Measured on the live school, 14–27 Oct 2026 | Value |
| --- | --- |
| Accounts | 1,177 (92% students, 7% staff, 1% drivers and others) |
| Active users on a school day | about 80, nearly all staff (75% of staff sign in daily) |
| Requests from signed-in users | about 500 per active staff member per school day |
| Rows read per request | about 160, including row-level security checks and background jobs |
| Rows changed | about 9,100 a day; about 0.22 per request |
| Database growth | 192 MB in about 9 months: 0.22 MB per user per year |
| File growth | about 1.0 GB in about 9 months: 1.1 MB per user per year |
| Peak | 23% of the day's sessions start between 08:00 and 09:00 IST |

The live school has almost no student or parent usage yet, so student and parent activity is a scenario rather than a measurement:

| Scenario | Staff active daily | Students or parents active daily | Daily active users at 10,000 users |
| --- | --- | --- | --- |
| Low (like today) | 75% | 2% | about 710 |
| Typical | 75% | 30% | about 3,300 |
| High | 75% | 70% | about 7,000 |

Per-user assumptions for the rebuilt app:

| Assumption | Value | Reasoning |
| --- | --- | --- |
| API calls per active staff member per day | 150 | One call per screen instead of today's ~500 browser queries |
| API calls per active student or parent per day | 40 | Home, announcements, attendance, fees, bus |
| Rows read per API call | 200 | Today's 160, plus growth in table size |
| Rows written | Attendance (1 per student), staff punches (3 per staff), GPS (1 per bus per 15 s for 3 hours), absence messages, user edits (10% of calls, 3 rows each), all ×3 for index rows | Index rows count as writes in D1 and Durable Objects |
| Buses | 1 per 200 users | 50 buses at 10,000 users |
| School days per month | 24 equivalents | 22 school days plus light weekends |
| Database growth | 0.20 MB per user per year | Measured 0.22 on Postgres |
| File growth | 1.2 MB per user per year | Measured 1.1 |
| Logs kept | 10% of invocations | Workers Logs bills per event after 20 million a month |

Workload per school per month that results:

| School | Daily active | Requests | Rows read | Rows written | Database | Files | Peak requests/s |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1,000 users, typical | 330 | 0.54 M | 91 M | 0.76 M | 0.2 GB/yr | 1.2 GB/yr | 4 |
| 3,000 users, typical | 990 | 1.6 M | 274 M | 2.3 M | 0.6 GB/yr | 3.6 GB/yr | 12 |
| 10,000 users, low | 710 | 2.9 M | 418 M | 5.4 M | 2 GB/yr | 12 GB/yr | 21 |
| 10,000 users, typical | 3,290 | 5.4 M | 912 M | 7.6 M | 2 GB/yr | 12 GB/yr | 39 |
| 10,000 users, high | 6,970 | 9.0 M | 1,619 M | 10.8 M | 2 GB/yr | 12 GB/yr | 65 |

Peak is 25% of the day's requests in the busiest hour with a 2.5× burst inside it. Even the high case is under 7% of a Durable Object's soft limit of about 1,000 requests a second, so one object per school has room, provided no single request holds the school's thread for long (see the architecture doc).

## Price sheet used

All on the Workers Paid plan ($5 a month per account). "Included" is per account per month, shared by every school.

| Product | Included | Price beyond |
| --- | --- | --- |
| Worker requests | 10 million | $0.30 per million |
| Worker CPU time | 30 million ms | $0.02 per million ms |
| Static asset requests | Unlimited | Free |
| Durable Object requests (incl. RPC, alarms; WebSocket messages at 20:1) | 1 million | $0.15 per million |
| Durable Object duration (only while running) | 400,000 GB-s | $12.50 per million GB-s |
| SQL rows read (D1 and Durable Objects) | 25 billion | $0.001 per million |
| SQL rows written (D1 and Durable Objects) | 50 million | $1.00 per million |
| SQL storage, Durable Objects | 5 GB | $0.20 per GB-month |
| SQL storage, D1 | 5 GB | $0.75 per GB-month |
| R2 storage | 10 GB | $0.015 per GB-month; no egress fees |
| R2 Class A (writes, lists) / Class B (reads) | 1 M / 10 M | $4.50 / $0.36 per million |
| Queues | 1 million operations | $0.40 per million (about 3 per message) |
| Email Service | 3,000 emails | $0.35 per 1,000 |
| Workers Logs | 20 million events | $0.60 per million (changes to Cloudflare Observability pricing on 1 Dec 2026) |
| Cloudflare for SaaS custom hostnames | 100 | $0.10 per hostname per month |
| Workers for Platforms (option E only) | — | $25 a month |
| Containers (timetable solver) | 25 GiB-h memory, 375 vCPU-min | $0.0000025 per GiB-s, $0.000020 per vCPU-s |

## Results

### Cost of one more school on a large account

This is the number to price plans against: the account's included usage is already used up by other schools, so every unit is paid for.

| School size | Low | Typical | High |
| --- | --- | --- | --- |
| 1,000 users | $0.94 | $1.37 | $2.00 |
| 3,000 users | $2.62 | $3.92 | $5.79 |
| 10,000 users, year 1 | $8.50 | $12.85 | $19.05 |
| 10,000 users, year 3 | — | $14.01 | $20.21 |

Durable Objects shown; D1 is within 5% in year one and about 15% dearer by year three for 10,000-user schools.

### A fleet of 10,000-user schools, typical usage, year one

| Schools | Durable Objects | DO, worst case duration | D1 per school | D1 + Workers for Platforms | Per school (DO) |
| --- | --- | --- | --- | --- | --- |
| 1 | $5.69 | $5.69 | $5.03 | $30.03 | $5.69 |
| 10 | $60 | $75 | $61 | $86 | $6.05 |
| 50 | $548 | $640 | $544 | $569 | $10.96 |
| 200 | $2,467 | $2,849 | $2,457 | $2,482 | $12.34 |

"Worst case duration" assumes each school's object never goes idle during 14 school hours a day, for example because a timer or an open outbound connection stops it hibernating. It adds about $1.90 per school, so it is worth avoiding but not alarming.

### Same fleet, high usage, year three

| Schools | Durable Objects | D1 per school | Per school (DO) |
| --- | --- | --- | --- |
| 10 | $123 | $140 | $12.28 |
| 50 | $916 | $985 | $18.33 |
| 200 | $3,943 | $4,222 | $19.72 |

### Where the money goes

50 schools of 10,000 users, typical, year one, Durable Objects ($548 a month):

| Item | $ per month | Share |
| --- | --- | --- |
| SQL rows written | 331 | 60% |
| Worker requests | 79 | 14% |
| Durable Object requests | 40 | 7% |
| SQL rows read | 21 | 4% |
| Workers Logs (10% sampled) | 21 | 4% |
| SQL storage | 19 | 3% |
| Worker CPU | 19 | 3% |
| R2 | 9 | 2% |
| Workers Paid plan | 5 | 1% |
| Email, Queues, Durable Object duration | 5 | 1% |

### The chatty-client penalty

Same 50 schools if the rebuilt app kept today's pattern of many small queries from the browser (500 calls per active staff member, 120 per student, more rows read per call):

| Client | 50 schools, typical | Per school |
| --- | --- | --- |
| Rebuilt: one API call per screen | $548 | $10.96 |
| As today: many browser queries | $1,469 | $29.38 |

## Levers that move the bill

| Lever | Effect on a typical 10,000-user school | Where it is decided |
| --- | --- | --- |
| Store only each bus's latest position in SQL; batch the trail to R2 once a minute | About −$2.30 (−18%) | Adopted in [36-transport.md](36-transport.md) |
| Every index must earn its write cost; avoid counters updated on every read | Each index removed on a hot table saves up to a third of that table's write cost | Data-layer doc |
| One API call per screen, joins on the server | Avoids the 2.7× chatty penalty | Front-end and API doc |
| Keep log sampling at 10% or lower in production | Logging every invocation instead of 10% adds about $5.90 per school | Platform doc |
| Archive closed academic years to R2 | Keeps each school's database small and well under 10 GB | Data-layer doc |
| Read from summary tables for reports | Cuts rows read and keeps the school's thread free | Each section doc |

## Compared with today

Today each school is one Supabase project plus one Vercel project:

| Item | Today, per school | On Cloudflare |
| --- | --- | --- |
| Database and auth | Supabase Pro organisation $25 a month, plus compute per project: Micro $10, Small $15, Medium $60. A 10,000-user school with today's query pattern would likely need Medium or larger | Included in the usage above |
| Hosting | Vercel Pro $20 per team member a month, plus usage | Included in the usage above |
| GPS gateway | DigitalOcean droplet, about $7.20 a month, shared | Unchanged unless also moved (Containers) |
| Email | Cloudflare Email Service (already planned) | Same |
| Floor for a new school | At least $10 a month of Supabase compute, even if unused | About $0 until the school is used |

Supabase prices from [supabase.com/pricing](https://supabase.com/pricing), read 27 Oct 2026. The live project's compute size was not checked.

## What this study does not cover

- **Messaging charges.** WhatsApp (Meta) and SMS are billed by Meta or the provider per message, the same on any hosting.
- **Payment fees.** Razorpay and bank charges are unchanged.
- **The GPS gateway** (Traccar on DigitalOcean) stays as it is in this plan.
- **People's time.** The rebuild itself is the dominant cost of this move; this study prices running it.
- **Price changes.** Workers Logs moves to Cloudflare Observability pricing on 1 Dec 2026; re-run the model when that is published.

## How to re-run

```sh
python3 docs/cloudflare-rebuild/tools/costmodel.py --users 10000 --scenario typical --year 1
python3 docs/cloudflare-rebuild/tools/costmodel.py --users 3000 --scenario high --year 3
python3 docs/cloudflare-rebuild/tools/costmodel.py --client asis   # today's chatty pattern
```

Change the constants at the top of the script (prices, requests per user, rows per request, write amplification) to test other assumptions. Re-measure from the live database before trusting the model for pricing decisions; the queries used are listed in the [README](README.md#measuring-the-live-school-again).
