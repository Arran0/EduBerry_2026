"""The two questions this service answers.

``prove``    — does a complete timetable exist, and if not, which rules collide?
``optimise`` — the best week it can find, and how far that is from optimal.
"""

from __future__ import annotations

import time
from dataclasses import asdict, dataclass, field
from typing import Any

from ortools.sat.python import cp_model

from .model import SCALE, Builder, Built
from .payload import Problem

#: Guard rail, in case a caller forgets to pass one. The HTTP layer sets a real
#: budget from the platform's own request timeout.
DEFAULT_BUDGET_S = 50.0


@dataclass
class PlacedLesson:
    """Where a lesson ended up, as indices into its own schedule."""

    lessonId: str
    day: int
    start: int
    size: int


@dataclass
class SolveResult:
    status: str
    placements: list[PlacedLesson] = field(default_factory=list)
    unplaced: list[str] = field(default_factory=list)
    unplacedPeriods: int = 0
    #: The quality score, on the same scale as the browser solver's penalty.
    penalty: float | None = None
    #: The best score that could still exist. Equal to `penalty` when proven optimal.
    penaltyBound: float | None = None
    #: Periods placed over a subject's per-day cap. Surfaced because the
    #: optimiser is allowed to make that trade, so it must be visible.
    overCapPeriods: int = 0
    conflicts: list[dict[str, Any]] = field(default_factory=list)
    #: True when the search stopped before it ran out of conflicts to find, so
    #: the list is "at least these" rather than "all of them". Telling an admin
    #: they have four problems when they have six is worse than saying so.
    conflictsTruncated: bool = False
    wallTimeMs: int = 0
    #: Model size, for the diagnostics line in the UI.
    variables: int = 0
    constraints: int = 0

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        return d


def _read_placements(built: Built, solver: cp_model.CpSolver) -> list[PlacedLesson]:
    out: list[PlacedLesson] = []
    for lesson in built.problem.lessons:
        for pl in built.placements.get(lesson.id, ()):
            if solver.Value(pl.var):
                out.append(
                    PlacedLesson(lessonId=lesson.id, day=pl.day, start=pl.start, size=pl.size)
                )
    return out


def _solver(budget_s: float, workers: int) -> cp_model.CpSolver:
    s = cp_model.CpSolver()
    s.parameters.max_time_in_seconds = max(1.0, budget_s)
    s.parameters.num_search_workers = max(1, workers)
    # A school timetable has enormous symmetry (interchangeable periods), and
    # without this the search spends its budget re-deriving the same week.
    s.parameters.symmetry_level = 2
    return s


#: A school with a dozen independent problems does not need a thirteenth
#: reported; it needs the list to stay readable.
MAX_CONFLICT_ROUNDS = 12


def prove(problem: Problem, *, budget_s: float = DEFAULT_BUDGET_S) -> SolveResult:
    """Is a complete timetable possible, and if not, what makes it impossible?

    Every rule an administrator could change is attached to an assumption
    literal. When the model is infeasible CP-SAT returns a subset of those
    literals that cannot all hold at once — not a guess at the cause, a proof
    that those particular rules are in conflict.

    One core is rarely the whole story. CP-SAT returns *a* sufficient subset,
    so a school with three unrelated problems gets told about one of them,
    which is how an administrator ends up fixing something, regenerating, and
    being told it is still impossible. So each core is recorded, the rules in
    it are released, and the question is asked again until the week becomes
    possible. What comes back is every independent conflict, each one minimal.
    """
    started = time.monotonic()
    builder = Builder(problem, relaxable=True, soft_demand=False)
    built = builder.build(with_objective=False)

    lits = dict(built.assumptions)
    by_var = {lit.Index(): tag for tag, lit in lits.items()}
    assumed = set(lits)

    result = SolveResult(
        status="unknown",
        variables=len(built.model.Proto().variables),
        constraints=len(built.model.Proto().constraints),
    )
    groups: list[list[str]] = []
    placements: list[PlacedLesson] = []

    for round_no in range(MAX_CONFLICT_ROUNDS):
        remaining = budget_s - (time.monotonic() - started)
        if remaining <= 1.0:
            result.conflictsTruncated = bool(groups)
            if not groups:
                result.status = "unknown"
            break
        if round_no == MAX_CONFLICT_ROUNDS - 1 and groups:
            result.conflictsTruncated = True

        built.model.ClearAssumptions()
        built.model.AddAssumptions([lits[t] for t in sorted(assumed)])
        # Core extraction is only done by the sequential core-based search, so
        # this deliberately ignores any worker count the caller asked for. A
        # proof is the whole point of the call, and parallelism that silently
        # returns an empty core instead is not a trade worth making.
        solver = _solver(remaining, 1)
        status = solver.Solve(built.model)

        if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            placements = _read_placements(built, solver)
            result.status = "impossible" if groups else "feasible"
            break
        if status != cp_model.INFEASIBLE:
            # Out of time mid-round: what was found still holds, there may be more.
            if groups:
                result.conflictsTruncated = True
            else:
                result.status = "invalid" if status == cp_model.MODEL_INVALID else "unknown"
            break

        core = {by_var[i] for i in solver.SufficientAssumptionsForInfeasibility() if i in by_var}
        core &= assumed
        if not core:
            # Infeasible with nothing left to blame: the hard rules alone —
            # a class or a teacher in two places at once — cannot be met.
            result.status = "impossible"
            break
        groups.append(sorted(core))
        assumed -= core
        result.status = "impossible"

    result.wallTimeMs = int((time.monotonic() - started) * 1000)
    result.placements = placements
    result.conflicts = [
        {"group": i, **_describe(tag)} for i, group in enumerate(groups) for tag in group
    ]
    return result


def optimise(
    problem: Problem,
    *,
    budget_s: float = DEFAULT_BUDGET_S,
    workers: int = 8,
    hint: dict[str, tuple[int, int]] | None = None,
) -> SolveResult:
    """The best week within the budget.

    Stage one gets the week complete: fewest periods left unplaced, and among
    those, fewest periods pushed over a subject's per-day cap. Stage two holds
    that result fixed and minimises quality — the same score the browser solver
    minimises — so the bound it reports answers a question worth asking: how
    much better could this week be *without* giving any of it up.

    Allowing a period over a per-day cap rather than leaving it unplaced is the
    same trade the browser solver makes in its relaxed pass. It is counted and
    returned, never silently taken.

    When the caller supplies a week, a stage ZERO runs first and pins it down.
    `AddHint` alone is only a suggestion: on a whole-school problem CP-SAT
    routinely spends both later stages without completing a solution from it
    and returns nothing at all — so "improve this week" reported that the
    solver had returned no timetable and changed nothing, while holding a
    perfectly good week in its hands the whole time. Solving once with the
    hinted variables FIXED is a verification pass rather than a search (half a
    second on 2,400 lessons), and it yields a result that can always be handed
    back. Everything after it can only be an improvement on that.
    """
    started = time.monotonic()
    builder = Builder(problem, relaxable=False, soft_demand=True)
    built = builder.build(with_objective=True)

    # A week the browser already found is a strong starting point: cold, CP-SAT
    # spends its budget rediscovering a complete timetable, which is the part a
    # good heuristic is already excellent at.
    if hint:
        for lesson_id, (day, start) in hint.items():
            for pl in built.placements.get(lesson_id, ()):
                built.model.AddHint(pl.var, 1 if (pl.day, pl.start) == (day, start) else 0)

    hinted_unplaced: int | None = None
    if hint is not None:
        hinted_unplaced = sum(l.size for l in problem.lessons if l.id not in hint)
        # Seeded with the caller's week and bounded by it, so nothing below can
        # cost the week a period.
        built.model.Add(sum(built.unplaced_periods_terms) <= hinted_unplaced)

    # ── Stage zero: the caller's own week, pinned ────────────
    floor: SolveResult | None = None
    if hint:
        built.model.Minimize(sum(built.objective_terms) if built.objective_terms else 0)
        stage0 = _solver(min(5.0, max(1.0, budget_s * 0.2)), workers)
        stage0.parameters.fix_variables_to_their_hinted_value = True
        status0 = stage0.Solve(built.model)
        if status0 in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            floor = _harvest(problem, built, stage0, started)
            # It is the caller's week, not an improvement on it, so there is no
            # bound to report — saying "optimal" of it would be a lie.
            floor.status = "feasible"
            floor.penaltyBound = None

    def apply_hint(values: dict[str, int] | None) -> None:
        """Re-seed the search. `None` restores the caller's own week."""
        built.model.ClearHints()
        if values is None:
            if not hint:
                return
            for lesson_id, (day, start) in hint.items():
                for pl in built.placements.get(lesson_id, ()):
                    built.model.AddHint(pl.var, 1 if (pl.day, pl.start) == (day, start) else 0)
            return
        for lesson in problem.lessons:
            for pl in built.placements.get(lesson.id, ()):
                built.model.AddHint(pl.var, values[pl.var.Name()])

    # Stage two is where the time pays off, so stage one gets a short slice
    # WHEN there is a week to fall back on: all it has to do then is confirm or
    # beat a completeness the caller already holds. With no hint there is
    # nothing to fall back on and stage one is the whole job, so it gets the
    # lion's share instead.
    spent0 = time.monotonic() - started
    stage1_budget = max(1.0, (budget_s - spent0) * (0.25 if hint else 0.75))

    # ── Stage one: completeness ──────────────────────────────
    stage1_values: dict[str, int] | None = None
    if built.completeness_terms:
        built.model.Minimize(sum(built.completeness_terms))
        stage1 = _solver(stage1_budget, workers)
        status1 = stage1.Solve(built.model)
        if status1 not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            # Either proven impossible at this completeness (the rules moved
            # under the caller's week since it was built), or simply out of
            # time — on a whole-school problem the latter is the common case,
            # not the odd one. Either way stage zero's week still stands, so
            # hand that back rather than nothing.
            if floor is not None:
                return floor
            return SolveResult(
                status="impossible" if status1 == cp_model.INFEASIBLE else "unknown",
                wallTimeMs=int((time.monotonic() - started) * 1000),
                variables=len(built.model.Proto().variables),
                constraints=len(built.model.Proto().constraints),
            )
        reached_unplaced = int(round(sum(stage1.Value(v) for v in built.unplaced_periods_terms)))
        # Carry stage one's result into stage two as a floor, so improving the
        # look of the week can never cost it a period. Only the unplaced count
        # is pinned — cap overruns stay a quality term stage two can trade.
        built.model.Add(sum(built.unplaced_periods_terms) <= reached_unplaced)
        # Only adopt stage one's week if it actually placed more than the
        # caller's did. Stage one optimises completeness blind to quality, so
        # its answer is routinely an ugly week of the same completeness —
        # measured at a quality score of 1133 against the 486 it was handed.
        # Starting stage two from the worse of two equally complete weeks and
        # asking it to climb back is a waste of the budget.
        if hinted_unplaced is None or reached_unplaced < hinted_unplaced:
            stage1_values = {
                pl.var.Name(): stage1.Value(pl.var)
                for lesson in problem.lessons
                for pl in built.placements.get(lesson.id, ())
            }
    else:
        reached_unplaced = 0

    apply_hint(stage1_values)
    improved = _stage_two(problem, built, started, budget_s, workers)
    # Stage two can run out of time having completed nothing, which is not a
    # reason to lose the week we already hold.
    if not improved.placements and floor is not None:
        floor.wallTimeMs = int((time.monotonic() - started) * 1000)
        return floor
    return improved


def _harvest(
    problem: Problem,
    built: Built,
    solver: cp_model.CpSolver,
    started: float,
) -> SolveResult:
    """A solved model, read out as a result.

    Shared by stage zero and stage two so the week the caller gets back is
    described the same way whichever stage produced it.
    """
    result = SolveResult(
        status="feasible",
        wallTimeMs=int((time.monotonic() - started) * 1000),
        variables=len(built.model.Proto().variables),
        constraints=len(built.model.Proto().constraints),
    )
    result.placements = _read_placements(built, solver)
    gaps = [lid for lid, v in built.unplaced.items() if solver.Value(v)]
    by_id = {l.id: l for l in problem.lessons}
    result.unplaced = sorted(gaps)
    result.unplacedPeriods = sum(by_id[lid].size for lid in gaps if lid in by_id)
    result.overCapPeriods = sum(solver.Value(v) for v in built.over_cap)

    from .model import W_OVER_CAP

    # The objective in force is quality alone bar the cap term, which stage one
    # pinned, so the numbers below are directly comparable with the browser
    # solver's softPenalty.
    sunk = SCALE * W_OVER_CAP * result.overCapPeriods
    result.penalty = round((solver.ObjectiveValue() - sunk) / SCALE, 2)
    result.penaltyBound = round(max(0.0, solver.BestObjectiveBound() - sunk) / SCALE, 2)
    return result


def _stage_two(
    problem: Problem,
    built: Built,
    started: float,
    budget_s: float,
    workers: int,
) -> SolveResult:
    """Quality, with completeness already pinned.

    The model is expected to carry its floor on `unplaced_periods_terms` and a
    seeded hint before this is called.
    """
    spent = time.monotonic() - started
    remaining = max(1.0, budget_s - spent)
    built.model.Minimize(sum(built.objective_terms) if built.objective_terms else 0)
    solver = _solver(remaining, workers)
    status = solver.Solve(built.model)

    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return SolveResult(
            status={
                cp_model.INFEASIBLE: "impossible",
                cp_model.MODEL_INVALID: "invalid",
            }.get(status, "unknown"),
            wallTimeMs=int((time.monotonic() - started) * 1000),
            variables=len(built.model.Proto().variables),
            constraints=len(built.model.Proto().constraints),
        )

    result = _harvest(problem, built, solver, started)
    result.status = "optimal" if status == cp_model.OPTIMAL else "feasible"
    return result


# ── Turning a conflict core into something actionable ────────


def _describe(tag: str) -> dict[str, Any]:
    """One rule from the conflict core, as the UI needs it.

    The tag carries the entity ids rather than names: this service has no
    names, and resolving them belongs with the code that already has the
    classes, teachers and subjects loaded.
    """
    parts = tag.split(":")
    kind = parts[0]
    if kind == "timeoff":
        return {"tag": tag, "rule": "time_off", "scope": parts[1], "id": parts[2]}
    if kind == "block":
        return {"tag": tag, "rule": "consecutive_periods", "id": parts[1]}
    if kind == "maxperday":
        return {"tag": tag, "rule": "max_per_day", "homeroomId": parts[1], "subjectId": parts[2]}
    if kind == "room":
        return {"tag": tag, "rule": "room_capacity", "roomType": parts[1]}
    if kind == "maxinarow":
        return {"tag": tag, "rule": "max_in_a_row", "teacherId": parts[1]}
    if kind == "pin":
        return {"tag": tag, "rule": "class_teacher_pin", "homeroomId": parts[1]}
    if kind == "periods":
        return {"tag": tag, "rule": "required_periods", "source": parts[1], "id": parts[2]}
    if kind == "limit":
        return {
            "tag": tag,
            "rule": "limit",
            "limitKind": parts[1],
            "scope": parts[2],
            "id": parts[3],
            "period": parts[4],
        }
    return {"tag": tag, "rule": kind}
