---
name: cleaning-up-codebases
description: Find and safely remove dead code from a codebase — unused exports, orphaned files, commented-out blocks, unused dependencies, and superseded duplicate implementations. Use when asked to "clean up the codebase," "remove dead code," "find unused code," or as a follow-on step after a refactor/feature-removal to sweep up what's left behind. Produces a verified, low-risk deletion list rather than a blind grep sweep.
---

# Cleaning up codebases

Dead code removal is safe only when "unused" is *proven*, not guessed. A false positive here
deletes working code. This skill is a verification-first method: every deletion candidate must
survive an actual reference check before it's touched.

## The five categories, in order of confidence

Work through these in order — each is progressively harder to verify with certainty, so front-load
the cheap, high-confidence wins.

1. **Orphaned files** — a `.ts`/`.tsx`/`.js` file nothing imports. Highest confidence: if grep for
   the filename (bare and via every path-alias form the project uses, e.g. `@/lib/foo` and
   `./foo` and `../foo`) turns up only the file's own definition, it's dead.
2. **Unused exported symbols** — a function/component/hook/type exported from a file that *is*
   used, but this particular export isn't imported anywhere else. Check each export individually;
   a file being "used" doesn't mean every export from it is.
3. **Unused dependencies** — a package in `package.json` never imported in source. Check server
   code (API routes, edge functions) as well as client code before flagging — a dependency used
   only in one API route is still used.
4. **Duplicate/superseded implementations** — two functions that do the same thing where one is
   provably unreferenced. Same verification as #1/#2; don't rely on "this looks newer" as the sole
   signal — check imports.
5. **Commented-out code blocks** — multi-line blocks of actual code inside comments (not
   docstrings, not explanatory prose). Lowest risk to remove (it isn't running either way) but
   still confirm it isn't a deliberately-kept reference implementation (check for a nearby comment
   explaining why it's kept before deleting).

Root-level one-off scripts (migration runners, seed scripts, `test-*.js` at the repo root) are a
separate case: they're entry points, not imports, so the reference-check method doesn't apply.
Flag them by content review instead ("this references a table/feature that no longer exists") and
say so explicitly rather than asserting they're dead with the same confidence as an import-checked
file.

## Verification method (do this before proposing any deletion)

For every candidate symbol or file:

1. **Grep for every way it could be referenced**: the bare name, and — for files — every import
   path form the project actually uses (relative `./`/`../` *and* the path-alias form like `@/`,
   since a codebase can use either or both for the same file).
2. **Exclude the definition site itself** from the match count — you're checking for *other*
   referrers, not confirming the symbol exists.
3. **Check non-`.ts`/`.tsx` consumers too**: config files, `.mdx`, dynamic `import()` calls,
   string-based route tables, and test files. A symbol referenced only from a test file is not
   dead — flag that separately as "used only in tests," don't delete it.
4. **A zero-match result is your evidence.** Cite it: "grep for `fetchFoo` across `src/` returns
   only its own definition at `lib/foo.ts:42`" — not "looks unused."
5. **When delegating this search to a subagent**, tell it explicitly to verify via grep before
   reporting a finding, and to report the zero-match evidence per finding — a search agent that
   skims for "looks unreferenced" will produce false positives that cost more to double-check than
   they save.

Anything that doesn't clear this bar goes in a separate "needs manual review" list, not the
deletion list — never delete on a hunch.

## Applying deletions

- **Batch by category**, not all at once — delete orphaned files first, run the build/typecheck,
  then move to unused exports, etc. If something breaks, you know which batch caused it.
- **Run the project's typecheck and test suite after every batch** (e.g. `tsc --noEmit`, the test
  runner). A file that "nothing imports" per grep but is still reachable via a dynamic path or a
  barrel re-export you missed will surface here, not in the grep pass.
- **Removing an export**: also check whether it was the *only* export from its file — if so, the
  file itself may now be a candidate too, in the next batch (don't chain-delete in one pass).
- **Unused dependency removal**: delete from `package.json`, then reinstall and re-run the build —
  a transitive dependency masquerading as unused (re-exported by another package) will fail loudly
  here.
- **Never delete under time pressure without the verification step**, even when a task description
  says "clean up dead code" as a secondary/incidental ask alongside other work — the same rigor
  applies whether it's the primary task or a bonus.

## Report format

When reporting findings (whether to the user or before applying fixes), group by category and give
each entry as `file:line — symbol/file name — why it's dead (with the grep evidence)`. This is
also the right shape for a subagent's return report — see the verification method above.
