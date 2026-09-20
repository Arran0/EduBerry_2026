---
name: webapp-performance-audit
description: Systematically audit and fix web app performance across ten categories — overfetched/uncompressed JSON, illogical DB writes, sequential-dependency bottlenecks, non-optimistic UI, non-static hosting, waterfall requests, N+1 queries, missing DB indexes, React re-render churn, and missing caching/pagination. Use when asked to make an app "faster," do a "performance audit/pass," or investigate slow pages/APIs. Especially tuned for Next.js + Supabase/Postgres stacks (RLS-aware), but the ten categories generalize to any web app + SQL database.
---

# Web app performance audit

Ten categories, grouped by where the fix lives. Work top-down: start with whatever page/flow the
user named (a specific page beats a whole-app sweep — fix it, verify it, then widen scope only if
asked). For each category, the fix pattern below is mechanical once you've found an instance —
spend your effort on finding real instances with `grep`/`Read`, not on re-deriving the pattern.

## Frontend / API layer

### 1. Uncompressed / overfetched JSON
Look for `.select('*')` where the caller only reads a handful of fields, and for queries with no
row cap (`.limit()`) that only need to check existence or a few rows. Also check whether a shared
fetch function is being called with default (unfiltered) args from a caller that only needs a
narrow slice — e.g. a "fetch all fees" helper called from a "does this student have overdue fees"
card with no status filter.
- **Fix, narrow-consumer case**: don't change the shared function's default behavior (other
  callers may need the full shape) — add an optional param (extra `.select()` columns, a
  `statuses` filter, a `withX` boolean to skip an expensive join) and have only the narrow caller
  opt in. This is additive and backward-compatible.
- **Fix, join-only-for-a-count-nobody-shows case**: if a joined/counted value (e.g.
  `member_count`) is fetched but never rendered by a particular caller, add a flag to skip that
  extra query entirely for that caller.
- Server response compression (gzip/brotli) is usually handled by the host/framework already
  (Next.js `compress: true` is the default; Vercel/most PaaS compress at the edge regardless) —
  verify this before "fixing" it; don't add redundant compression config.

### 2. Illogical DB write methods
Grep for a loop (`for`/`.map`/`.forEach`) that calls `.insert()`/`.update()`/`.upsert()` or an RPC
**once per iteration** instead of one batched call.
- **Fix, table writes**: replace the loop with one `.insert(arrayOfRows)` /
  `.upsert(arrayOfRows, { onConflict })` — Postgres/PostgREST accept an array.
- **Fix, RPC writes**: if the existing RPC only accepts a single id, add a sibling RPC that accepts
  an array (`p_ids uuid[]`) and does the same upsert via `INSERT ... SELECT ... FROM unnest($1)`
  (see the Supabase RLS section below for how to ship this via a migration). Keep the original
  single-id RPC for callers that only ever handle one row — add the batch form alongside it, don't
  force every caller through an array.

### 3. Single dependency bottleneck (waterfalls)
Grep for `await a(); await b();` where `b` doesn't use anything `a` returned — this serializes two
independent round trips for no reason. Also check "load flow" hooks/contexts (auth, session) don't
force complete serialization ahead of unrelated widgets.
- **Fix**: `const [a, b] = await Promise.all([fnA(), fnB()])`. Inside a single fetch function that
  does its own multi-step round trips (audience lookup, then submissions lookup, etc.), check each
  step's actual data dependency — if step 2 doesn't need step 1's result, parallelize them too.
- Not everything sequential is a bug: a genuine dependency (must know the user's role before
  deciding which query to run) is correct serialization — don't force `Promise.all` where the
  second call needs the first's output.

### 4. Non-optimistic rendering
Grep for a mutation handler that `await`s a DB write before calling `setState` with the new value,
when the new value is already known client-side before the write resolves.
- **Fix**: call `setState` (or the local cache update) immediately after you have the value to
  show, then fire the DB write and only log/rollback on error — don't block the UI update on it.
  Genuinely can't go optimistic when the "new value" is server-computed (e.g. a generated ID) —
  in that case the wait is real, not a bug.

### 5. Non-static hosting
Check whether pages that could be static (marketing/login shells, content that's the same for
every visitor) are forced dynamic — an app-wide `Cache-Control: no-store` header, or every page
under `'use client'`/`export const dynamic = 'force-dynamic'` with no exceptions. But **verify the
blanket dynamic behavior is actually accidental before changing it** — a session-driven app
(account switch mid-tab, personalized dashboards) legitimately needs `no-store` on authenticated
routes; check for a comment explaining the choice before "fixing" it. Genuinely safe targets:
build-hashed static assets (`_next/static/*`) should get `max-age=31536000, immutable` regardless
of the blanket rule (a more specific header rule wins); truly public unauthenticated pages can be
allowed to prerender.

### 9. Re-render madness (React)
Grep list-rendering components for: inline object/array/function literals passed as props to a
`memo`-wrapped child (defeats the memoization every render); a callback recreated per list item
without `useCallback`; an expensive derived value (`.filter().sort().map()` chains) recomputed
every render without `useMemo`; state lifted to a common ancestor that re-renders a large
subtree on every keystroke of an unrelated input.
- **Fix**: wrap the expensive computation in `useMemo` keyed on its real inputs; wrap
  per-item callbacks passed to memoized children in `useCallback`; move state that only one
  small subtree needs down into that subtree instead of a shared parent.
- Don't blanket-wrap everything in `useMemo`/`useCallback` speculatively — that's its own
  overhead and noise. Only fix spots where a render actually recomputes something non-trivial or
  where a memoized child's memoization is being defeated.

### 10. Lack of caching and pagination
Grep for "fetch all X" queries feeding a list UI with no `.limit()`/cursor and no page size —
especially ones whose row count grows with usage (all students, all classrooms, all payroll
records) rather than being naturally small (a config table with a dozen rows). Also check for
config/reference data (fee heads, academic years, site settings) refetched on every page
mount instead of cached for the session.
- **Fix, unbounded list**: add `.limit()` + a "load more"/cursor pattern; if the UI already
  slices client-side to a small visible window (infinite-scroll reveal), the fix is usually
  trimming the *joined* data (see category 1), not the row limit itself, since all rows may
  need to become reachable via scroll.
- **Fix, refetched static-ish data**: cache in a context/React Query/SWR keyed by session, or at
  minimum hoist the fetch above the component that remounts.

## Database layer (Postgres / Supabase)

### 7. N+1 database queries
Grep for a query **inside** a `.map()`/loop over rows from a previous query, where a single
`.in('col', arrayOfIds)` would return the same data in one round trip.
- **Fix**: collect the ids from the first query, issue one `.in()` query for all of them, then
  join client-side with a `Map`. Watch for this specifically in "for every X, fetch its Y" grading
  queues, roster hydration, and per-row detail lookups feeding a list.

### 6 & 8 (DB-side): missing indexes and per-row auth overhead
Use `mcp__Supabase__get_advisors(type: "performance")` — don't guess at missing indexes from code
alone when a live Supabase connection is available. Its result can be very large (100K+ chars);
save it to a file and process with `python3`/`jq`, don't try to read it inline. Key lint
categories and their fixes:

- **`unindexed_foreign_keys`**: a FK column with no covering index. Don't blindly index every
  hit — split into *relationally-queried* columns (join/filter targets: `*_id` columns like
  `academic_year_id`, `fee_head_id`, `structure_id`) versus *pure audit-trail actor columns*
  (`created_by`, `approved_by`, `verified_by`, …) that the app only displays, never filters by.
  Index the former; skip the latter unless you can show the app actually queries by them — every
  index has real write-side cost, so index what's used.
- **`auth_rls_initplan`**: an RLS policy calls `auth.uid()` (or a custom `STABLE` wrapper like a
  `get_user_role()` helper) unwrapped, so Postgres re-evaluates it **per row** instead of once per
  statement. Fix by wrapping in a scalar subquery: `auth.uid()` → `(select auth.uid())`. Only wrap
  **niladic** (no-argument) STABLE functions this way — a helper that takes a per-row column as an
  argument (e.g. `is_owner(row.user_id)`) can't be hoisted the same way, because its result
  legitimately varies per row; don't wrap those.
- **`multiple_permissive_policies`**: two-or-more `PERMISSIVE` policies apply to the same
  command (`SELECT`/`INSERT`/`UPDATE`/`DELETE`) on the same table/role, so Postgres evaluates both
  per query even though it will just OR them together. The extremely common shape is one `FOR ALL`
  admin policy plus one narrower `FOR SELECT` (or other single-command) policy. **The safe fix is
  a 4-way split, not folding the narrow policy's condition into the `ALL` policy's `USING`
  clause** — the latter looks tempting but silently broadens the `ALL` policy's read-check to
  every command it covers (including `DELETE`, and the read-side of `UPDATE`), which is a real
  security regression. Instead: drop the `ALL` policy and every narrower policy on that
  table/role, then create one explicit policy per command (`SELECT`/`INSERT`/`UPDATE`/`DELETE`),
  each `USING`/`WITH CHECK` built as `(the ALL policy's original clause) OR (the narrow policy's
  clause for that exact command, if one existed)` — commands with no narrower policy just keep the
  `ALL` policy's original clause alone, unchanged. For `UPDATE`, remember Postgres defaults a
  missing `WITH CHECK` to the `USING` clause — substitute that in explicitly rather than leaving it
  null when merging. This construction is provably behavior-preserving (it's exactly what Postgres
  already computes by ORing permissive policies) as long as you paste in the *original* clause text
  verbatim rather than re-deriving it by hand.
- **At scale (dozens of tables with the same shape)**: fetch every affected policy's exact
  `qual`/`with_check` in one query against `pg_policies`, write a small script to generate the
  DROP/CREATE statements mechanically per table (don't hand-write dozens of near-identical
  migrations — that's where typos creep in), and flag any table whose shape doesn't fit the
  common pattern (mixed roles across policies, more than one `ALL` policy, `RESTRICTIVE` policies
  present) for manual handling instead of forcing it through the generic transform.
- **Duplicate indexes**: two indexes on the identical column set are pure write overhead — drop
  the newer one, keep the original (check for a matching migration name/date if unsure which is
  "original").

## Verifying an RLS change before and after applying it (mandatory for policy edits)

RLS mistakes are security bugs, not just performance bugs — verify behavior is unchanged, don't
just trust that the SQL "looks right":

1. **Dry-run first**: wrap the generated SQL in `BEGIN; ... ROLLBACK;` and execute it once to catch
   syntax errors with zero risk, before applying for real.
2. **Apply in small batches** (10-15 tables per migration), not one giant migration — if a batch
   fails, you know exactly which tables are affected, and completed batches stay applied.
3. **Simulate real sessions to prove row-visibility didn't change**: Postgres lets you fake an
   authenticated request inside a transaction you roll back:
   ```sql
   BEGIN;
   SET LOCAL ROLE authenticated;
   SELECT set_config('request.jwt.claims', '{"sub":"<a real user uuid>","role":"authenticated"}', true);
   SELECT count(*) FROM the_table;  -- compare against the expected row count for that persona
   ROLLBACK;
   ```
   Run this for at least three personas per high-stakes table: an admin (should see everything),
   an ordinary owner (should see only their own row(s) — cross-check against a direct
   `WHERE owner_col = '<uuid>'` count computed the same way), and no claims set at all (should see
   zero rows). A mismatch means the merge broke something — stop and fix it before continuing to
   the next batch.
4. **Re-run the advisor after** to confirm the specific lint counts actually dropped (not just that
   the migration succeeded) — `apply_migration` returning success only means the SQL was valid, not
   that it achieved the intended fix.

## Reporting

Report findings grouped by category number (1-10), each as `file:line — one-sentence issue —
one-sentence fix`, ranked by impact within each category (a fix affecting every page load beats
one affecting an admin-only rare action). When you also apply fixes, say what you verified
(typecheck, tests, and — for any RLS change — the persona-simulation results) rather than just
asserting the fix is safe.
