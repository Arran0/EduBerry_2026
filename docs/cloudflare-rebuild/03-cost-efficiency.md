# Cost Efficiency

As of 28 Oct 2026. Part of the [Cloudflare rebuild docs](README.md). This is a living checklist: the practices that keep each school cheap to run, what each is worth against the [cost study](02-cost-study.md), and where each one stands today and in the rebuild. Update it when a practice lands or a measurement changes.

## 1. Where the money goes

From the cost study, for 50 schools of 10,000 users each on Durable Objects, typical use, year one (about $11 per school a month):

| Item | Share |
| --- | --- |
| SQL rows written (each written index entry counts as a row) | 60% |
| Worker requests | 14% |
| Durable Object requests | 7% |
| SQL rows read | 4% |
| Workers Logs (10% sampled) | 4% |
| Storage, CPU, R2, email, queues, plan | 11% |

Two consequences follow:

1. **Writes cost most.** Every index on a hot table and every needless `UPDATE` shows up on the bill. Request counts are second.
2. **Request count is set by the front end.** Today's browser fires about 500 database requests per active staff member a day. Rebuilt with one API call per screen, it would be about 150. Keeping today's pattern on Cloudflare costs **2.7×** as much: $29 instead of $11 per school a month.

Bytes on the wire are nearly free on Cloudflare: egress is not billed, and compression is automatic. So payload tricks matter far less than counting requests and rows.

## 2. The common advice, checked against our numbers

| Practice | Worth it here? | Why | Today | Rebuild |
| --- | --- | --- | --- | --- |
| **Batch requests: one call per screen** | **Yes, the biggest lever** | Requests are 21% of the bill and set the rows read; today's pattern is the 2.7× case | Many screens fire 5–15 queries on load (home: 8 direct queries plus about a dozen from its cards) | `POST /api/<screen>/load` returns everything a screen shows ([16](16-frontend-and-api.md)) |
| **Batch small lookups made in the same tick** | Yes | Turns N requests into 1 without changing screens | Done for signed file URLs: every private file on a screen is signed in one request (`lib/privateFiles.ts`) | Same pattern for any per-item lookup |
| **Debounce inputs** | Yes, cheap | Each keystroke in a search box is a request | Most search boxes wait 200 ms (`setTimeout`; `useDebounce` exists in 4 places) | One shared `useDebounce(300)` for every search box |
| **Throttle continuous actions** | Yes, where they hit the server | Scrolling and resizing are UI-only here; the server-facing stream is GPS | GPS throttled to one fix per 5 s moving, 20 s parked | Positions persist only on events ([36](36-transport.md)) |
| **WebSockets or SSE instead of polling** | Yes | A hibernating socket costs nothing while idle; incoming messages bill at 20:1 | Polling: unread task comments, the operations board refresh, the online-payment status (every 3 s), the SOS button, a midnight check each minute | One socket per user on the school object; polling only as fallback ([14](14-jobs-messaging-realtime.md)) |
| **Stale-while-revalidate (TanStack Query or SWR)** | Yes | Removes repeat requests for data already on screen, and dedupes identical requests from several components | Ad hoc module caches (fee `cache.ts`, `personCache`), refetch on every mount elsewhere | TanStack Query with a `staleTime` per kind of data: settings and branding long, attendance and live data short |
| **Cache headers and ETags** | Partly | A `304` still costs a Worker request and usually the school-object call; it saves bytes, which are free here. The real win is edge caching of **shared** responses, which skips the school object entirely | Static assets cached by Vercel | `Cache-Control: public, s-maxage` plus the Cache API for per-school public data (branding, login settings, certificate verification, GTFS); `private, no-store` for personal data |
| **Cache API responses in a service worker** | **No**, except static assets | Classroom smartboards and shared family phones make cached personal data a leak, and a cached response can outlive a revoked permission | `sw.js` handles push only | Static assets and the school's public branding only |
| **Fetch only the fields the UI needs** | Partly | Rows read are billed per row scanned, not per column, so trimming columns saves bandwidth and CPU, not rows. What matters is indexes, `LIMIT` and pagination | This round replaced the `select('*')` reads of profiles with a fixed column list; many other tables still use `*` | Typed selects per screen, keyset pagination, summary tables for reports |
| **Brotli or gzip** | Already free | Cloudflare compresses text responses automatically | Vercel compresses | Nothing to do; keep `Content-Type: application/json` |
| **Binary formats (Protobuf, MessagePack)** | **No** | Payloads are small JSON and bytes are free; it would add build and debugging cost for no saving | — | — |
| **Optimistic UI** | Yes, mostly for feel | Saves the refetch after each change; a small cost win, a large UX one | A few screens (attendance marking, task check-offs) | Every mutation returns the changed row and version; the client updates its cache instead of refetching |
| **Move logic to the edge** | That is the rebuild | Workers and the school object sit next to the user; no origin servers | Supabase in Mumbai, Vercel functions | Workers + one Durable Object per school ([10](10-target-architecture.md)) |

## 3. Our own levers (bigger than most of the list)

| Lever | Effect | Where |
| --- | --- | --- |
| Every index must earn its write cost | Each index removed from a hot table saves up to a third of that table's write cost | [13](13-data-layer.md) |
| Never write a row that has not changed (`UPDATE … WHERE new IS DISTINCT FROM old`), and no counters bumped on reads | Avoids write amplification. Live example: a bus alert updated every minute for 24 days reached 33,901 occurrences | [36](36-transport.md) |
| Positions and logs out of SQL: trail chunks per minute, one R2 file per run | About −18% for a 10,000-user school | [36](36-transport.md) |
| Summary tables maintained on write for reports and dashboards | Reports read hundreds of rows instead of hundreds of thousands | Section docs |
| Alarms only when there is work (for example the transport tick in the bus window only) | Removes up to 1,440 idle wake-ups a day per school | [14](14-jobs-messaging-realtime.md), [36](36-transport.md) |
| Log sampling at 10% or less in production | Logging every call adds about $5.90 per school a month | [02](02-cost-study.md) |
| Archive closed academic years | Keeps each database small and fast to scan | [13](13-data-layer.md) |
| Serve public, shared data from the edge cache | Skips the Worker-to-object call for the busiest anonymous pages | §2 |

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
- [ ] Reads use an index and a `LIMIT`; lists paginate by key, not offset.
- [ ] Writes touch only rows that change; no index added without a query that needs it.
- [ ] Reports read summary tables, not raw history.
- [ ] Mutations return the changed row; the client updates its cache instead of refetching.
- [ ] Public, shared responses carry `s-maxage`; personal ones `private, no-store`.

## 6. Measuring

- **Today (Supabase):** `pg_stat_statements` for calls and rows per query; the API request counts in the Supabase dashboard; the measurement queries in the [README](README.md#measuring-the-live-school-again).
- **Rebuild:** Analytics Engine events per school and method (requests, rows read, rows written, duration), rolled up daily into `school_usage_daily` ([11](11-tenancy-and-control-plane.md)). Watch rows written per active user per day; it is the number the bill follows.
- Re-run `python3 docs/cloudflare-rebuild/tools/costmodel.py` with the measured figures after each milestone, and update §1.

## 7. Open items

- [ ] Adopt TanStack Query in the rebuild front end (decide in milestone M1).
- [ ] Move the unread-comment count and the operations-board refresh to the socket (after launch is fine).
- [ ] Set per-school budgets (requests and rows written per active user) and alert when a school drifts above them.
