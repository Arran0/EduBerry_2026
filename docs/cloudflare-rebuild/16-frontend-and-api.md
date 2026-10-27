# Front End and API

As of 27 Oct 2026. Part of the [Cloudflare rebuild docs](README.md).

## Summary

- **The browser app becomes a static single-page app** (Vite + React + React Router) served from Workers Static Assets, where requests are free. Today's 68 real pages are already client components; Next.js server rendering is used only to stamp a CSP nonce, which a static build does not need.
- **Components move almost unchanged.** A small compatibility layer provides `useRouter`, `usePathname`, `useSearchParams`, `useParams`, `Link` and `dynamic` with the same shapes as Next's, so the 307 components and 79 files that import `next/navigation` need no rewrite.
- **The browser stops talking to the database.** Today 126 files import the Supabase client and about 136 files run queries. In the target every query becomes an API call to `/api/<section>/<action>`, implemented by the school object.
- **One API call per screen** replaces today's waterfall of small queries. This is a cost requirement as much as a speed one: the cost study puts today's pattern at 2.7× the bill.
- **A preparation step can start in the current repository now:** move every query out of pages and components into `src/lib/*` functions. After that, swapping the data layer is a change to `src/lib` only.

## What the front end is today

| Part | Today |
| --- | --- |
| Framework | Next.js 15.5 App Router, React 19, Tailwind 3.4, TypeScript |
| Pages | 86 `page.tsx`: 68 client components, 18 server components that only redirect (old URLs) |
| Layout | One root layout with `AuthProvider`, `PageConfigProvider`, `ProfileCardProvider`, `BottomNavProvider`; `await headers()` forces dynamic rendering for the CSP nonce |
| Components | 307 `.tsx` files under `src/components`, grouped by feature |
| Data access | `src/lib/*` (180 files, ~31,000 lines) plus direct queries in 51 page files and 10 component files |
| Contexts | Auth (479 lines, most of it Supabase session handling), PageConfig (branding and themes cached in `localStorage` to avoid a flash), AcademicYear, BottomNav, ProfileCard |
| Hooks | 22, including live transport, leave realtime, server-paged lists, school clock |
| Next-specific APIs | `next/navigation` in 79 files (`useRouter` 103 uses, `useSearchParams` 36, `useParams` 29, `usePathname` 8, `redirect` 19); `next/link` 55 files; `next/dynamic` 40 files; `next/image` 4 files; no `next/font` |
| Dynamic routes | 20 (`[id]`, `[examId]`, `[studentId]`, `[runId]`, `[token]`, `[certNo]`, ...) |
| Heavy client libraries | `@react-pdf/renderer` (WebAssembly layout engine), `xlsx` (SheetJS), `leaflet` + `react-leaflet`, `framer-motion`, `qrcode`, Razorpay checkout script |
| Security headers | `src/middleware.ts` sets a nonce-based CSP for pages; `next.config.js` sets HSTS, nosniff, frame options, referrer and permissions policy |
| PWA | `public/manifest.json` (static, "EduBerry"), `public/sw.js` (install, activate, push, notification click) |
| Sessions | Supabase tokens in `localStorage`, with cross-tab locking and timeout handling (`src/lib/supabase.ts`, ~300 lines) |

## Target front end

### Build and hosting

| Item | Target |
| --- | --- |
| Build | Vite, output to `apps/web/dist` |
| Hosting | Workers Static Assets on the router Worker: `not_found_handling: "single-page-application"`; `run_worker_first` for `/api/*`, `/files/*`, `/hooks/*`, `/manifest.webmanifest`, `/favicon` |
| Routing | React Router; one route per current `page.tsx`, the 18 redirect pages become redirect entries |
| Code splitting | One lazy chunk per route (`React.lazy`), plus the existing `next/dynamic` splits mapped to `lazy` |
| Caching | Hashed assets cached for a year (`immutable`); `index.html` `no-cache` so a deploy is picked up on the next load |
| Version check | The API returns the build id in a header; when it differs from the running bundle's, the app reloads at the next navigation |

### Compatibility layer

A file `apps/web/src/next-compat.ts` (and module aliases in the Vite config) maps `next/navigation`, `next/link` and `next/dynamic` to React Router and React equivalents with the same signatures. `next/image` (4 files) becomes a plain `<img>`. This keeps the component move mechanical; individual components can drop the shim later.

### Sessions in the browser

- No tokens in JavaScript. The session is an `HttpOnly` cookie ([12](12-auth-and-permissions.md)).
- On load the app calls `GET /api/auth/me` (user, profile, permissions, school branding version).
- Sign-in and sign-out are plain `POST`s; other tabs learn about them through a `BroadcastChannel` message and a re-check of `/api/auth/me`.
- The ~300 lines of token refresh, cross-tab locking and timeout handling in `src/lib/supabase.ts` and most of `AuthContext.tsx` go away.

### Security headers

| Header | Target |
| --- | --- |
| CSP | `default-src 'self'; script-src 'self' 'wasm-unsafe-eval' https://checkout.razorpay.com; connect-src 'self' <map tiles>; img-src 'self' data: blob: <map tiles>; object-src 'none'; base-uri 'self'; frame-ancestors 'self'; form-action 'self'` — no nonce needed because the static `index.html` has no inline script |
| Others | HSTS, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` (camera, geolocation, payment for Razorpay) carried over from `next.config.js`, set by the Worker and the static `_headers` file |

### PWA

- `/manifest.webmanifest` is generated per school (name, short name, theme colour, icons from the school's branding) instead of the static file.
- `sw.js` keeps its push and notification-click handlers; no offline caching of pages is added for launch.
- The driver app keeps its IndexedDB buffer for GPS fixes taken without signal.

## API conventions

### Shape

| Rule | Detail |
| --- | --- |
| Path | `/api/<section>/<action>`, e.g. `/api/fees/student-summary`, `/api/attendance/mark-homeroom` |
| Method | `POST` with a JSON body for everything except file downloads, the live socket and public `GET` pages; one shape keeps the client simple and maps one-to-one onto object methods |
| Validation | Zod schemas in `packages/shared`, used by both the client (types) and the Worker (validation) |
| Response | `{ ok: true, data }` or `{ ok: false, error: { code, message, field? } }`, with HTTP status matching (`400`, `401`, `403`, `404`, `409`, `429`, `503`) |
| Idempotency | Money and messaging actions (`fees.collect`, `fees.onlineOrder`, `payroll.payout`, `wa.send`) accept an `Idempotency-Key`; the object stores keys for 24 hours and replays the first result |
| Compatibility | During a gradual deploy old bundles call the new API; actions only gain optional fields, and a removed action stays as a shim for one release |
| Errors | User-facing messages written in plain words by the object; technical detail only in logs |

### One call per screen

Each screen gets a loader action that returns everything it needs, joined on the server:

| Today (home page, staff) | Target |
| --- | --- |
| Profile, site settings version, attendance time zone, server time, holidays, day timings (twice), today's punch, tasks for the week, unread comment count, teams, team members, leave approvals, announcements feed, classrooms, homerooms... (a dozen or more requests, several in sequence) | `POST /api/home/load` → one object call returning profile summary, today's attendance state and clock, week's tasks, notification counts, pinned announcements, quick links |

Actions that change data return the updated rows the screen shows, so the screen does not have to reload.

### Mapping today's server routes

The 57 Next.js API routes become Worker handlers. Most of their logic moves into the school object; the Worker keeps only what must run outside it.

| Group | Routes today | Target |
| --- | --- | --- |
| Admin user management | 12 under `/api/admin/*` | `admin.*` actions; password hashing in the Worker |
| Auth | `/api/auth/forgot-password` | `/api/auth/*` (sign-in, sign-out, me, forgot, redeem) |
| Fees | 19 under `/api/fees/*` (collect, invoices, online order and verify, payments and reversal, refunds, instruments, reminders, years, cron drain, public pay and verify links, Razorpay and UPI webhooks) | `fees.*` actions; webhooks under `/hooks/<schoolId>/...`; public `/pay/<token>` and `/verify/receipt/<token>` pages call public actions |
| Bus fees and bus payroll | 6 under `/api/bus/*` | Folded into fees and payroll modules; webhooks under `/hooks` |
| Salary and payroll | 6 under `/api/salary/*`, `/api/payroll/*` | `payroll.*` actions; payout webhooks under `/hooks` |
| Transport | `/api/transport/ingest`, `/api/transport/notify/drain` | GPS ingest under `/hooks/<schoolId>/gps/<deviceKey>`; notify and drain replaced by the outbox queue |
| Notifications | `/api/push/subscribe`, `/api/push/unsubscribe`, `/api/announcements/notify`, `/api/leave/notify` | `push.subscribe`/`unsubscribe`; notify routes removed (server-side outbox) |
| WhatsApp | `/api/whatsapp/webhook` | `/hooks/<schoolId>/whatsapp` |
| Exams | `/api/exam/create`, `/api/exam/submit` | `exams.*` actions |
| Timetable | `/api/timetable/solve` | `timetable.solve`, which starts the solver container |
| Certificates | `/api/certificates/verify/[certNo]` | Public `certificates.verify` action |
| Analytics | `/api/analytics/team` | `tasks.teamAnalytics` |
| Leave | `/api/leave/notify` | Removed (server-side outbox) |
| Favicon | `/api/favicon` | `/favicon` in the Worker, from the school's R2 prefix |

### Settings and branding cache

`PageConfigContext` keeps its warm-start cache in `localStorage` (it prevents a flash of default colours). The version check uses `settings.version` from `/api/auth/me` instead of the `site_settings_version` RPC.

## Preparation that can start in the current repository

These steps reduce risk and can be merged to today's app before the rebuild starts:

1. **Move direct queries out of pages and components.** 51 page files and 10 component files call `supabase.from(...)` or `.rpc(...)` directly. Move each into a named function in `src/lib/<section>.ts`. Afterwards, every database touch in the browser is in `src/lib`.
2. **Group per-screen loads.** Where a page fires several queries on load, wrap them in one `load<Screen>()` function in `src/lib`. This defines the future loader action's response shape.
3. **Stop storing full storage URLs** in new rows: store the path and build the URL in one helper. Existing rows are rewritten by the importer anyway.
4. **Remove the hard-coded school name** from `BRANDING_DEFAULTS` and `LOGIN_DEFAULTS` (the README already requires neutral defaults).

## Alternatives considered

| Option | Why not chosen |
| --- | --- |
| Keep Next.js and run it on Workers (OpenNext or vinext) | Works, but every page navigation runs Worker code (billed requests and CPU) to render pages that are client-rendered anyway, and keeps the framework coupling. A fallback if the compatibility layer meets a blocker |
| Next.js static export (`output: 'export'`) | Dynamic routes would need every id known at build time; not workable for `[examId]`, `[runId]` and the rest |

## Parity checklist

- [ ] Every route in `src/app/**/page.tsx` exists in the new router, including the 18 redirects.
- [ ] Deep links (`/more/exam/<id>/grade/<studentId>`, `/pay/<token>`, `/verify/<certNo>`) load directly from a cold start.
- [ ] No flash of default branding on load.
- [ ] Desktop and mobile layouts unchanged.
- [ ] PDF previews, spreadsheet exports, maps and Razorpay checkout work under the new CSP.
- [ ] Push notifications and notification clicks work after the service-worker move.
- [ ] Each screen's first load makes one API call (plus static assets).
