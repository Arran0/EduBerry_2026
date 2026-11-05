# Cost Study: Schools of up to 10,000 Users on Neon and Cloudflare

As of 5 Nov 2026. Part of the [rebuild docs](README.md). Prices are list prices: Cloudflare read on 27 Oct 2026, Neon and Supabase on 5 Nov 2026. The model is [`tools/costmodel.py`](tools/costmodel.py); every number here can be re-run with other assumptions. The chosen design is Neon Postgres per school with Cloudflare for everything else ([01](01-architecture-options.md)); the Durable Object design is kept as the comparison.

## Summary

- **Today's school (about 1,200 users) costs about $14 a month on Neon and Cloudflare** if it is the only school: $5 for Workers Paid and about $9 of Neon compute. On Supabase it costs $25 today.
- **One more school on a running account costs** about **$9** (1,000 users), **$19** (3,000 users) and **$30** (10,000 users) a month, in Neon projects of their own. Usage level barely changes it: a 10,000-user school costs $29 with little use and $32 with heavy use.
- **Neon compute is almost the whole bill (about 90%).** Neon bills compute time while the database is awake, not rows. Two things decide it: how many hours a day the school's database is awake, and how much memory it needs to hold the school's busy data.
- **Pods halve it.** About 20 schools' databases sharing one Neon compute cost about $4.50 (1,000 users) to $15 (10,000 users) per school, because idle time and memory headroom are shared. The price is restore granularity and noisy neighbours ([01](01-architecture-options.md)).
- **Mind the 100-project line.** Neon's Launch plan holds 100 projects. Past that, one project per school needs the Scale plan, whose compute price is twice Launch's ($0.222 against $0.106 per CU-hour). Move small schools into pods before reaching 100.
- **It is dearer than the Cloudflare-only design** (about $13 a month for a 10,000-user school, $1.60 for a 1,000-user one) and cheaper than Supabase (about $60 for a 10,000-user school on Medium compute). The difference against the Cloudflare-only design pays for not rewriting the database.
- **Chattiness costs latency more than money on Neon.** Today's many-small-queries pattern adds about 15% to the bill (versus 2.7× on Durable Objects), but every query crosses from India to Singapore, so one call per screen still matters for speed ([03](03-cost-efficiency.md)).

## Where the workload numbers come from

The model starts from the one school running today and scales it.

| Measured on the live school, 14–27 Oct 2026 | Value |
| --- | --- |
| Accounts | 1,177 (92% students, 7% staff, 1% drivers and others) |
| Active users on a school day | about 80, nearly all staff (75% of staff sign in daily) |
| Requests from signed-in users | about 500 per active staff member per school day |
| Rows changed | about 9,100 a day |
| Database growth | 192 MB in about 9 months: 0.22 MB per user per year |
| File growth | about 1.0 GB in about 9 months: 1.1 MB per user per year |
| Peak | 23% of the day's sessions start between 08:00 and 09:00 IST |

Student and parent use is a scenario, not a measurement:

| Scenario | Staff active daily | Students or parents active daily | Daily active at 10,000 users |
| --- | --- | --- | --- |
| Low (like today) | 75% | 2% | about 710 |
| Typical | 75% | 30% | about 3,300 |
| High | 75% | 70% | about 7,000 |

## How Neon compute is estimated

Neon bills `compute size × hours awake`. A compute suspends after 5 idle minutes and wakes on the next query.

| Assumption | Value | Reasoning |
| --- | --- | --- |
| Hours awake per month | 22 school days × 13 h + 8 weekend days × 4 h + 30 nights × 0.5 h ≈ 333 h (10 h school days under 1,000 users) | Staff 07:00–17:00, students and parents into the evening; scheduled jobs gathered into one nightly window |
| Compute size while awake | 0.25 CU under 2,000 users, 0.5 CU under 6,000, 0.75 CU average at 10,000 (autoscaling between 0.5 and 1) | Memory first: the current year's attendance, fees and marks should fit in RAM (1 CU ≈ 4 GB) |
| CPU check | Postgres time of about 12 ms per screen call, 1 ms per GPS fix, ×3 for peaks | At 10,000 users this is about 0.15 CU, below the memory floor: memory, not CPU, sets the size |
| Storage | 0.20 GB per 1,000 users per year at $0.35 per GB-month; 0.3 GB of change history per school at $0.20 | Restore history kept 7 days on Launch |
| Pods | 20 schools per compute; each school's share is 45% of its own compute | Shared idle time and memory headroom |

Resulting CU-hours per school a month: about 83 (1,000 users), 167 (3,000) and 250 (10,000).

The biggest single risk to these numbers is **anything that keeps a compute awake when nobody is using the app**: a job every few minutes all night, a monitoring ping, an open connection. The design moves every scheduled job onto Cloudflare Cron Triggers and gathers them into windows, so that a school's database is idle from evening to morning ([14](14-jobs-messaging-realtime.md)). If a school's compute never slept, a 10,000-user school would cost about $58 a month instead of $30.

## Price sheet used

| Product | Included | Price beyond |
| --- | --- | --- |
| Neon compute, Launch plan | — | $0.106 per CU-hour; 100 projects |
| Neon compute, Scale plan | — | $0.222 per CU-hour; 1,000 projects |
| Neon storage | — | $0.35 per GB-month |
| Neon change history (instant restore) | — | $0.20 per GB-month; 7 days on Launch, 30 on Scale |
| Neon egress | 500 GB per project | $0.10 per GB |
| Cloudflare Workers Paid | per account | $5 a month |
| Worker requests | 10 million | $0.30 per million |
| Worker CPU time | 30 million ms | $0.02 per million ms |
| Static asset requests | Unlimited | Free |
| Hyperdrive (platform database only) | Unlimited queries | Free on Workers Paid |
| Durable Object requests (live-update hub) | 1 million | $0.15 per million |
| R2 storage | 10 GB | $0.015 per GB-month; no egress fees |
| Queues | 1 million operations | $0.40 per million |
| Email Service | 3,000 emails | $0.35 per 1,000 |
| Workers Logs | 20 million events | $0.60 per million |
| Workers KV (host cache) | 10 million reads | $0.50 per million |
| Containers (timetable solver) | 25 GiB-h, 375 vCPU-min | per use |

## Results

### One more school on a running account

| School size | Low | Typical | High | In a pod (typical) |
| --- | --- | --- | --- | --- |
| 1,000 users | $9.12 | $9.23 | $9.39 | $4.38 |
| 3,000 users | $18.42 | $18.75 | $19.23 | $9.05 |
| 10,000 users, year 1 | $28.92 | $30.02 | $31.60 | $15.46 |
| 10,000 users, year 3 | — | $31.78 | $33.36 | — |

### A fleet of 10,000-user schools, typical usage, year one

| Schools | Neon, project per school | Per school | Neon pods | Per school | Durable Objects (comparison) | Supabase, Medium per school (comparison) |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | $32 | $32 | $18 | $18 | $6 | $75 |
| 10 | $297 | $30 | $151 | $15 | $60 | $615 |
| 50 | $1,489 | $30 | $761 | $15 | $548 | $3,015 |
| 100 | $2,990 | $30 | $1,534 | $15 | $1,184 | $6,015 |
| 200 | $11,796 | $59 | $3,089 | $15 | $2,467 | $12,015 |

At 200 schools, one project per school forces the Scale plan for every project, doubling compute. Pods, or a second Neon organisation, avoid that.

### Where the money goes

50 schools of 10,000 users, typical, year one, one project each ($1,489 a month):

| Item | $ per month | Share |
| --- | --- | --- |
| Neon compute | 1,324 | 89% |
| Worker requests | 79 | 5% |
| Neon storage and history | 38 | 3% |
| Worker CPU | 19 | 1% |
| R2 | 9 | 1% |
| Live-update hub, logs, email, queues, plan | 20 | 1% |

### The chatty-client effect

| Client | 10,000-user school, typical, one more on a running account |
| --- | --- |
| Rebuilt: one call per screen | $30.02 |
| As today: many browser queries | $34.29 |

On Neon each small query costs little compute, so the bill moves by about 15%. The cost is latency: each query is a round trip to Singapore.

## Levers that move the bill

| Lever | Effect | Where it is decided |
| --- | --- | --- |
| Let every school's database sleep from evening to morning | A compute awake around the clock roughly doubles a school's bill | [14](14-jobs-messaging-realtime.md) |
| Pods for small schools | About half the compute per school | [11](11-tenancy-and-control-plane.md) |
| Right-size the autoscaling range per school | Each 0.25 CU off the floor saves about $9 a month at 333 hours | [11](11-tenancy-and-control-plane.md) |
| Stay on Launch (under 100 projects per organisation) | Scale doubles the compute price | [11](11-tenancy-and-control-plane.md) |
| Cache public, shared reads at the edge | Fewer wake-ups for anonymous pages (branding, certificate checks) | [16](16-frontend-and-api.md) |
| Keep GPS trails out of Postgres | Fewer writes and less storage; the trail goes to R2 | [36](36-transport.md) |
| Summary tables for reports and dashboards | Shorter queries, smaller compute | Section docs |

## Compared with today

| Item | Today (Supabase + Vercel), per school | Rebuild (Neon + Cloudflare) |
| --- | --- | --- |
| Database and auth | Supabase Pro $25 a month per organisation (includes one Micro compute), plus $10 (Micro), $15 (Small) or $60 (Medium) per extra project | Neon compute and storage as above; sign-in is our own |
| Hosting and API | Vercel Pro $20 per team member a month, plus usage | Workers Paid $5 per account, plus usage |
| A school nobody uses | At least $10 a month of Supabase compute | About $0: its Neon compute is asleep |
| GPS gateway | DigitalOcean droplet, about $7.20 a month, shared | Unchanged |

## What this study does not cover

- **Messaging and payment fees** (Meta, SMS providers, Razorpay, banks) are the same on any hosting.
- **People's time.** The rebuild effort is the main cost of this move; the Neon design is chosen because it cuts that effort sharply.
- **Price changes.** Neon changed its pricing in 2025 and may again; re-run the model when it does.

## How to re-run

```sh
python3 docs/cloudflare-rebuild/tools/costmodel.py --users 10000 --scenario typical --year 1
python3 docs/cloudflare-rebuild/tools/costmodel.py --users 1200 --scenario low
python3 docs/cloudflare-rebuild/tools/costmodel.py --client asis   # today's chatty pattern
```

The Neon assumptions are in `neon_compute()`: hours awake, the memory floor by school size and the pod sharing factor. Measure them on the first school after cutover (Neon's console shows CU-hours per project) and update the model before pricing plans.
