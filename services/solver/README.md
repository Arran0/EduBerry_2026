# Timetable constraint solver (CP-SAT)

A private HTTP service that answers the two questions the in-browser solver
cannot answer about its own output.

| | In-browser solver (`src/lib/timetable/`) | This service |
|---|---|---|
| Finds a complete week | Yes, in ~15s, stoppable, streams progress | Slower, and no better |
| Says a week is **impossible** | No — only "could not fit" | Yes, with a proof |
| Names the rules that collide | No | Yes, minimal and independent |
| Improves a week's quality | Yes, local search | Yes, ~60% further on real data |
| Proves a week optimal | No | Not at this size either (see below) |

Generate is unchanged and does not call this. The service backs two buttons:
**Can this be built?** and **Improve this week**.

## Why Python

OR-Tools has no JavaScript binding — not on npm under any name, and Google
ships CP-SAT for C++, Python, Java and .NET only. That is the entire reason
this is a separate process.

## The one rule about changing this code

**Every school rule lives in TypeScript.** `src/lib/timetable/solverPayload.ts`
flattens the output of `buildSchedules`, `expandBlocks`, `expandCombined` and
`buildConstraintIndex` — the same functions the draggable grid uses — into a
transport format with no judgement in it. This package turns that into CP-SAT
algebra and nothing else.

That is not tidiness. Two implementations of "when may this lesson sit here"
drift, and the symptom is a grid that calls a cell free next to a solver that
refuses to use it. If you find yourself deciding a scheduling question in
Python, the decision belongs on the other side of the wire.

The exceptions are deliberate and small:

- **Which positions a lesson may take** is re-derived here, because the solver
  must know not just that a position is unavailable but *why* — that is what
  makes a conflict report possible. The rule applied is `timeOffBlocked`, four
  lines, mirrored in `payload.py`.
- **Rooms** are not modelled individually. CP-SAT is given the capacity of each
  shared facility and guarantees it is never oversubscribed; which particular
  lab a lesson lands in is assigned back in TypeScript by `buildRoomPlan`,
  which already owns the home-room rule.

`src/lib/timetable/solverPayload.test.ts` and `tests/test_model.py` check both
sides of the wire.

## Endpoints

Both take `{ problem, budgetSeconds, hint? }` and require `X-Solver-Secret`.

### `POST /prove`

Is a complete timetable possible? Every rule an administrator could change is
attached to a CP-SAT assumption literal. If the model is infeasible, CP-SAT
returns a subset of those literals that cannot all hold — a proof, not a guess.

One core is not the whole story: CP-SAT returns *a* sufficient subset, so a
school with three unrelated problems would be told about one, fix it, and be
told it is still impossible. Each core is therefore recorded, its rules
released, and the question asked again, up to `MAX_CONFLICT_ROUNDS` or the
budget. `conflictsTruncated` says whether the list is "all of them" or "at
least these".

Core extraction only happens in CP-SAT's sequential core-based search, so
`prove` ignores any worker count and runs single-threaded. Parallel search
returns an empty core.

### `POST /optimise`

The best week within the budget, in two stages:

1. **Completeness** — fewest periods left unplaced. Seeded with the caller's
   own week and bounded by it, so it can only match or improve on what it was
   given.
2. **Quality** — the same score `softPenalty` in `generator.ts` minimises, with
   stage one's completeness pinned.

Three things about this are load-bearing, each learned the hard way on real
data (34 classes, 1287 required periods):

- **Always pass a `hint`.** Cold, CP-SAT left 42 periods unplaced where the
  browser left 2 — finding *a* complete timetable is what a good heuristic is
  already excellent at. Warm-started, it matches the browser's completeness and
  improves quality from 517 to 205.
- **Stages, not one weighted objective.** Folding completeness and quality into
  one objective needs a coefficient of ~42,000,000 on an unplaced period, which
  flattens the linear relaxation CP-SAT draws its bounds from.
- **Stage one must not pin cap overruns.** It optimises completeness blind to
  quality, so it would drive overruns below whatever the caller's week needed,
  pin that, and thereby throw the warm start out of the feasible region.

A period over a subject's per-day cap is preferred to a period missing — the
same trade `placeBlock`'s relaxed pass makes in the browser. It is counted and
returned in `overCapPeriods`, never taken silently.

## Known limit: no usable optimality bound

`penaltyBound` comes back at 0 even after four minutes on a real school. CP-SAT
improves the week substantially but cannot prove how close to optimal it is at
this model size (~95k booleans, ~42k constraints). Treat the number as a floor,
not a claim. If bounds matter, the day-balance deviation terms are the ones to
reformulate first — they are what keeps the relaxation loose.

## Deploying

The service must be **private**: it has no notion of who is asking, and a
timetable problem contains every class, teacher and subject in the school.
`src/app/api/timetable/solve/route.ts` is the authenticated front door and
reads two variables:

- `SOLVER_INTERNAL_URL` — where this service is
- `SOLVER_SHARED_SECRET` — the same value this service is given

Without them the route returns 503 with a clear message and the rest of the app
is unaffected.

### Option A — one Vercel project, Vercel Services

Keeps one deployment, one preview URL, skew protection, and a private binding
instead of a public URL. A service with no top-level rewrite is unreachable
from the internet.

The catch: every service needs a `root` **subdirectory**, and this app's
Next.js project sits at the repository root. That means moving it (e.g. to
`apps/web/`) before this config is valid — a restructure that was deliberately
not done unilaterally.

```json
{
  "services": {
    "web":    { "root": "apps/web" },
    "solver": {
      "root": "services/solver",
      "entrypoint": "main:app",
      "bindings": [
        { "type": "service", "service": "solver", "format": "url",
          "env": "SOLVER_INTERNAL_URL" }
      ]
    }
  },
  "rewrites": [{ "source": "/(.*)", "destination": { "service": "web" } }]
}
```

The binding belongs on the *calling* service (`web`); it is shown here for
shape. `solver` has no rewrite, so it stays private.

### Option B — a second Vercel project (no restructure)

Deploy `services/solver` as its own project, set `SOLVER_INTERNAL_URL` to its
production URL and give both projects the same `SOLVER_SHARED_SECRET`. The
route code is identical either way.

Because the URL is then public, the shared secret stops being defence in depth
and becomes the only control. Put Deployment Protection in front of it as well.

## Running locally

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/pip install pytest && .venv/bin/python -m pytest tests -q
SOLVER_SHARED_SECRET=dev .venv/bin/python -m uvicorn main:app --port 8099
```
