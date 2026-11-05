# Cost Efficiency

As of 5 Nov 2026. Part of the [rebuild docs](README.md). The design is a Neon Postgres project per school with Cloudflare for everything else ([01](01-architecture-options.md)). This is a living checklist: the practices that keep each school cheap to run, what each is worth against the [cost study](02-cost-study.md), and where each one stands today and in the rebuild. Update it when a practice lands or a measurement changes.

## 1. Where the money goes

From the cost study, for 50 schools of 10,000 users each, one Neon project per school, typical use, year one (about $30 per school a month):

| Item | Share |
| --- | --- |
| Neon compute (CU-hours while the database is awake) | 89% |
| Worker requests | 5% |
| Neon storage and restore history | 3% |
| Worker CPU | 1% |
| R2 | 1% |
| Live-update hub, logs, email, queues, plan | 1% |

Three consequences follow:

1. **Hours awake and compute size cost most.** Neon bills compute for every minute a school's database is awake, whether or not anyone is using it, and suspends it after 5 idle minutes. Anything that wakes it at night (a job every few minutes, a monitoring ping, an open connection) is the biggest leak: a 10,000-user school whose database never slept would cost about $58 instead of $30. Size is set by memory: the school's busy data should fit in RAM.
2. **Request count matters for speed more than money.** Today's browser fires about 500 database requests per active staff member a day; rebuilt with one call per screen it would be about 150. On Neon that moves the bill by only about 15% ($34 instead of $30), but every query crosses from India to Singapore at 30–60 ms a round trip, so a chatty screen gets slower than today.
3. **Bytes on the wire are nearly free.** Egress from Workers and R2 is not billed, and compression is automatic. Payload tricks matter far less than wake-ups and round trips.

## 2. The common advice, checked against our numbers

| Practice | Worth it here? | Why | Today | Rebuild |
| --- | --- | --- | --- | --- |
| **Batch requests: one call per screen** | **Yes, the biggest speed lever** | Each query is a 30–60 ms round trip to Singapore; on the bill today's pattern adds about 15% | Many screens fire 5–15 queries on load (home: 8 direct queries plus about a dozen from its cards) | `POST /api/<screen>/load` returns everything a screen shows ([16](16-frontend-and-api.md)) |
| **Batch small lookups made in the same tick** | Yes | Turns N requests into 1 without changing screens | Done for signed file URLs: every private file on a screen is signed in one request (`lib/privateFiles.ts`) | Same pattern for any per-item lookup |
| **Debounce inputs** | Yes, cheap | Each keystroke in a search box is a request | Most search boxes wait 200 ms (`setTimeout`; `useDebounce` exists in 4 places) | One shared `useDebounce(300)` for every search box |
| **Throttle continuous actions** | Yes, where they hit the server | Scrolling and resizing are UI-only here; the server-facing stream is GPS | GPS throttled to one fix per 5 s moving, 20 s parked | Positions persist only on events ([36](36-transport.md)) |
| **WebSockets or SSE instead of polling** | Yes | A hibernating socket costs nothing while idle; a poll that reaches the database keeps its compute awake | Polling: unread task comments, the operations board refresh, the online-payment status (every 3 s), the SOS button, a midnight check each minute | One socket per user on the school's hub; polling only as fallback ([14](14-jobs-messaging-realtime.md)) |
| **Stale-while-revalidate (TanStack Query or SWR)** | Yes | Removes repeat requests for data already on screen, and dedupes identical requests from several components | Ad hoc module caches (fee `cache.ts`, `personCache`), refetch on every mount elsewhere | TanStack Query with a `staleTime` per kind of data: settings and branding long, attendance and live data short |
| **Cache headers and ETags** | Partly | A `304` still costs a Worker request and usually a database call; it saves bytes, which are free here. The real win is edge caching of **shared** responses, which skips the database entirely and never wakes a sleeping one | Static assets cached by Vercel | `Cache-Control: public, s-maxage` plus the Cache API for per-school public data (branding, login settings, certificate verification, GTFS); `private, no-store` for personal data |
| **Cache API responses in a service worker** | **No**, except static assets | Classroom smartboards and shared family phones make cached personal data a leak, and a cached response can outlive a revoked permission | `sw.js` handles push only | Static assets and the school's public branding only |
| **Fetch only the fields the UI needs** | Partly | Postgres reads whole rows from its pages anyway, so trimming columns saves bandwidth and serialisation, not much compute. What matters is indexes, `LIMIT` and pagination | This round replaced the `select('*')` reads of profiles with a fixed column list; many other tables still use `*` | Typed selects per screen, keyset pagination, summary tables for reports |
| **Brotli or gzip** | Already free | Cloudflare compresses text responses automatically | Vercel compresses | Nothing to do; keep `Content-Type: application/json` |
| **Binary formats (Protobuf, MessagePack)** | **No** | Payloads are small JSON and bytes are free; it would add build and debugging cost for no saving | — | — |
| **Optimistic UI** | Yes, mostly for feel | Saves the refetch after each change; a small cost win, a large UX one | A few screens (attendance marking, task check-offs) | Every mutation returns the changed row and version; the client updates its cache instead of refetching |
| **Move logic to the edge** | Partly | The Worker runs next to the user, but the database is in Singapore. Logic stays in SQL functions so a screen crosses once; routes with several dependent queries use Smart Placement to run near the database | Supabase in Mumbai, Vercel functions | Workers + a Neon database per school ([10](10-target-architecture.md)) |

## 3. Our own levers (bigger than most of the list)

| Lever | Effect | Where |
| --- | --- | --- |
| Let every school's database sleep from evening to morning: no job, poll, health check or open connection outside the school's job windows | A compute awake around the clock roughly doubles a school's bill | [14](14-jobs-messaging-realtime.md) |
| Jobs gathered into windows; the transport tick only between the first and last bus run of the day | Replaces five every-minute jobs that would keep the database awake all night | [14](14-jobs-messaging-realtime.md), [36](36-transport.md) |
| Right-size each school's autoscaling range | Each 0.25 CU off the floor saves about $9 a month at 333 hours awake | [11](11-tenancy-and-control-plane.md) |
| Pods for small schools | About half the compute per school | [11](11-tenancy-and-control-plane.md) |
| Stay under 100 projects per Neon organisation | The Scale plan doubles the compute price | [11](11-tenancy-and-control-plane.md) |
| Keep the working set small: summary tables for reports, old logs pruned to R2, GPS positions out of Postgres | Less memory needed, so a smaller compute; shorter queries | [13](13-data-layer.md), [36](36-transport.md) |
| Never write a row that has not changed (`UPDATE … WHERE new IS DISTINCT FROM old`), and no counters bumped on reads | Less WAL, restore history and vacuum work. Live example: a bus alert updated every minute for 24 days reached 33,901 occurrences | [36](36-transport.md) |
| Every index must earn its keep | Unused indexes cost memory and write time; `pg_stat_user_indexes` shows which | [13](13-data-layer.md) |
| Log sampling at 10% or less in production | Logging every call adds several dollars per school a month | [02](02-cost-study.md) |
| Serve public, shared data from the edge cache | Login pages, branding and certificate checks never wake the database | §2 |

## 4. Done in the current app (28 Oct 2026)

| Change | Before | After |
| --- | --- | --- |
| Admin home fee summary (`fee_home_summary`) | 5 queries, totalled in the browser | 1 call, totalled in the database |
| School Overview monthly chart (`fee_home_collections`) | 4 queries (two years list, two monthly, paged) | 1 call shared by both |
| Student overdue-fees card (`fetchOverdueBills`) | 1 query on the old tables | 1 query with the bill lines embedded |
| Private file links (`lib/privateFiles.ts`) | — | One signing request per screen, cached until near expiry |
| Profile searches (`profile_directory`) | — | One request per search, as before; email matching done in the database |

## 5. Checklist for every new screen or change

- [ ] The screen loads with **one** request (or two at most: the load call and a lazy panel).
- [ ] Search inputs are debounced (300 ms) and need at least 2 characters.
- [ ] No polling where a socket topic exists; any poll pauses when the tab is hidden.
- [ ] Nothing new touches the database on a timer outside the school's job windows.
- [ ] Reads use an index and a `LIMIT`; lists paginate by key, not offset.
- [ ] Writes touch only rows that change; no index added without a query that needs it.
- [ ] Reports read summary tables, not raw history.
- [ ] Mutations return the changed row; the client updates its cache instead of refetching.
- [ ] Public, shared responses carry `s-maxage`; personal ones `private, no-store`.

## 6. Measuring

- **Today (Supabase):** `pg_stat_statements` for calls and rows per query; the API request counts in the Supabase dashboard; the measurement queries in the [README](README.md#measuring-the-live-school-again).
- **Rebuild:** Neon's consumption figures per project (CU-hours, hours awake, compute size over the day) and Analytics Engine events per school and route (requests, database time, status), rolled up daily into `school_usage_daily` ([11](11-tenancy-and-control-plane.md)). Watch two numbers: hours awake overnight, which should be close to the job window, and average compute size while awake.
- Re-run `python3 docs/cloudflare-rebuild/tools/costmodel.py` with the measured figures after each milestone, and update §1.

## 7. Open items

- [ ] Adopt TanStack Query in the rebuild front end (decide in milestone M1).
- [ ] Move the unread-comment count and the operations-board refresh to the socket (after launch is fine).
- [ ] Set per-school budgets (CU-hours per active user, hours awake overnight) and alert when a school drifts above them.
- [ ] Measure hours awake and compute size on the first school after cutover and update the cost model.
