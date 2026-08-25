# Supabase cost & performance

This app is almost entirely client-rendered — every Supabase read is a
browser-to-PostgREST round trip, so query shape directly drives the metered
egress/CPU/connection bill. This doc captures the conventions that came out
of a full cost audit and fix pass (branch `claude/supabase-cost-optimization-1tw3hp`),
so new code doesn't quietly reintroduce what was fixed.

## The four rules

1. **Never `select('*')` on `profiles` inside a join.** `profiles` is
   embedded from ~50 call sites across the app (task assignees, exam
   audiences, leave applicants, salary recipients, classroom members…). A
   wildcard select drags every column of every joined profile over the wire.
   Project only what the screen renders — usually
   `id, full_name, avatar_url, role`, occasionally `email`/`grade`/`section`
   for screens that need them. Before narrowing a site, grep its consuming
   component(s) for which fields of the embedded profile are actually read.

2. **RLS predicates wrap zero-argument auth calls in `(select ...)`.**
   `auth.uid()`, `auth.jwt()`, and `public.get_user_role()` are STABLE but
   not `IMMUTABLE`; used bare inside a policy's `USING`/`WITH CHECK`, Postgres
   re-evaluates them **per candidate row**. Wrapped as
   `(select auth.uid())`, the planner hoists them into a one-time InitPlan.
   Semantically identical, often an order of magnitude cheaper on large
   tables. Apply the same wrapping to any new custom RLS helper function too.

3. **Batch instead of looping per-row.** A `.map()` that issues one Supabase
   call per classroom/exam/date turns into hundreds of round trips once real
   data accumulates, even though it looks fine against a handful of test
   rows. Use `.in()` to fetch the whole batch in one call — see
   `fetchClassroomFilesBatch` in `src/lib/classrooms.ts` for the pattern
   (batches across classrooms in one round trip, date-filters only when a
   caller actually needs a narrower window).

4. **Every `.upload()` sets `cacheControl: '31536000'`**, and any photo
   upload goes through `src/lib/imageCompression.ts` first (canvas-resizes
   to ≤1600px and re-encodes to WebP, with a defensive fallback to the
   original file if compression fails for any reason). The Supabase Storage
   CDN default is a 1-hour TTL — without an explicit long `cacheControl`,
   every repeat view of an asset is billed egress instead of free cached
   egress.

## Other patterns worth knowing about

- **Counts:** prefer `count: 'planned'`/`'estimated'` over `'exact'` on large
  tables — `'exact'` forces a full scan. Avoid `{ head: true }` on a
  status-filtered PostgREST query against this project specifically — it's a
  documented quirk (see the comment above the attendance counter in
  `src/app/home/page.tsx`) where HEAD requests don't reliably reflect
  filters the way GET requests do.
- **Retention:** `pg_cron` runs three cleanup jobs — `bus_locations` (daily),
  `attendance_location_attempts` (90 days), stale `push_subscriptions`
  (180 days). If you add a new high-write, ever-growing table, give it a
  retention job rather than letting it grow unbounded — Supabase disk
  auto-grows but never shrinks back down.
- **Realtime:** only mount a realtime subscription for roles that actually
  need it. `LeaveNotificationsListener` in `ProtectedLayout.tsx` used to be
  mounted for every signed-in user, which meant concurrent peak connections
  tracked concurrent *users* rather than concurrent people who could receive
  a leave event.
- **Branding/theme defaults must stay neutral.** `BRANDING_DEFAULTS` and
  `LOGIN_DEFAULTS` in `src/lib/pageConfig.ts` render briefly on every page
  load before the admin's real `site_settings` values fetch (and, for
  returning visitors, before a `useLayoutEffect` in
  `src/contexts/PageConfigContext.tsx` applies a warm localStorage cache —
  chosen specifically because it runs before the browser's first paint,
  unlike `useEffect`). Keep these defaults a neutral white/grey rather than
  a specific brand colour, so an unloaded state never looks like a wrong or
  hardcoded theme; the shared `.brand-fade` CSS class (in `globals.css`)
  smooths over any colour change that does happen.

## What's already been done vs. what's still open

Narrowed to real, non-empty tables only — `bus_fees`, `school_fees`,
`driver_payroll_records`, and `feedbacks` are currently empty in production
(those features are pre-launch), so `src/lib/bus.ts`, `fees.ts`,
`driverSalary.ts`, and `feedback.ts` still have unnarrowed `profiles(*)`
embeds. Narrow them once those features have live data to verify against —
don't do it blind, since there's nothing to click-test against today.

Still open, lower priority than what's listed above:

- `src/lib/attendance.ts`'s per-date query in the late-staff report (N+1
  across a date range).
- Per-table review of RLS policies where a permissive `ALL` policy and a
  more specific `SELECT`/`UPDATE` policy overlap (~44 tables, e.g.
  `profiles`) — not auto-mergeable, since folding a `SELECT`-only condition
  into `ALL`'s `USING` clause would also widen `UPDATE`/`DELETE` visibility.
- The home-page admin fee summary (`school_fees`/`bus_fees` whole-table
  fetch) — no current cost impact since both tables are empty.

## Verifying a change

- `npx tsc --noEmit` and `npm run build` — but note `next build` deletes and
  rebuilds `.next`, which crashes a `next dev` server holding references to
  the old build. Stop the dev server first, or restart it after building.
- Check real egress with DevTools Network filtered to the Supabase host,
  comparing transferred bytes before/after on a heavy page (`/home`,
  `/more/exam`, the timetable admin screen).
- For storage changes: `curl -I` an uploaded object and confirm
  `cache-control: max-age=31536000`.
- For RLS changes: sign in as each affected role and confirm visibility is
  unchanged — a mistake here is a data leak or lockout, not just a
  performance regression.
