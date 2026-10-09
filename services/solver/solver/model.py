"""The CP-SAT model.

Two things a heuristic cannot do, and the only reasons this service exists:

  * **Prove.** ``prove()`` asks whether a complete timetable exists at all. A
    heuristic that fails has only ever told you it failed; CP-SAT either places
    every period or returns a *minimal set of rules that cannot all hold*. That
    set is what an administrator can act on.

  * **Bound.** ``optimise()`` minimises the same quality score the in-browser
    solver minimises, and reports how far from optimal the answer is. The
    heuristic has no idea how good its week is. This does.

The quality score is deliberately the *same* score, term for term and weight
for weight, as ``softPenalty`` in src/lib/timetable/generator.ts. Two solvers
optimising two different definitions of "good" would produce two incomparable
timetables and no way to tell which to keep.

Weights are scaled to integers because CP-SAT is an integer solver; divide the
objective by ``SCALE`` to get a number comparable with the browser's penalty.
"""

from __future__ import annotations

import time
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any, Iterable

from ortools.sat.python import cp_model

from .payload import WHOLE, Lesson, Problem, Schedule, TimeOff, cell_key

#: The class day-load term divides by the number of days in a class's week, so
#: every weight is multiplied by a number all of 1..7 divide into. The objective
#: is therefore in units of 1/SCALE of the browser solver's penalty.
SCALE = 420

#: Soft weights, matching softPenalty() in generator.ts exactly.
W_SUBJECT_REPEAT = 6
W_TEACHER_SPAN = 3
W_MIN_SHORTFALL = 4
W_UNFILLED_PIN = 8

#: Completeness and quality are optimised in separate stages rather than
#: weighted against each other in one objective. Folding them together needs a
#: coefficient on "unplaced period" big enough to dominate every quality term —
#: 42,000,000 once scaled — and a coefficient that size flattens the linear
#: relaxation CP-SAT derives its bounds from. Measured: one combined objective
#: left 7 periods unplaced after 60s and reported a lower bound of zero, which
#: is no bound at all. Staged, completeness is settled first with small numbers
#: and quality is then minimised with completeness held fixed, which is also
#: the only arrangement where "how much better can this get" has an answer.
#:
#: Stage one weighs unplaced periods and NOTHING else. Letting it also push
#: per-day cap overruns down looks harmless and is not: a cap overrun is a
#: quality trade, so stage one would drive it below whatever the caller's own
#: week needed, pin it there, and thereby throw that week out of the feasible
#: region — discarding the very warm start the stage exists to protect.
W_STAGE1_UNPLACED = 1_000

#: Exceeding a subject's per-day cap, when optimising.
#:
#: Not a hard rule here, because it is not a hard rule in the browser solver
#: either: placeBlock's relaxed pass puts a period over the cap at a cost of
#: 100 rather than leave it unplaced. Modelling the cap as hard made this
#: service report 42 unplaced periods where the browser reported 2 — not
#: because it searched worse, but because it was answering a stricter question.
#: Two solvers have to be asked the same question to be compared.
W_OVER_CAP = 100


# ── What a relaxable rule is called ──────────────────────────
# One assumption literal per thing an administrator can actually change. The
# conflict report is only useful if every name in it maps to a screen.


def timeoff_tag(scope: str, entity: str) -> str:
    return f"timeoff:{scope}:{entity}"


def block_tag(source_id: str) -> str:
    return f"block:{source_id}"


def maxperday_tag(homeroom_id: str, subject_id: str) -> str:
    return f"maxperday:{homeroom_id}:{subject_id}"


def room_tag(room_type: str) -> str:
    return f"room:{room_type}"


def maxrow_tag(teacher_id: str) -> str:
    return f"maxinarow:{teacher_id}"


def pin_tag(homeroom_id: str) -> str:
    return f"pin:{homeroom_id}"


def limit_tag(i: int, limit: Any) -> str:
    scope = limit.scope_id or "all"
    return f"limit:{limit.kind}:{limit.scope}:{scope}:{limit.period}:{i}"


def demand_tag(lesson: Lesson) -> str:
    return f"periods:{lesson.kind}:{lesson.source_id}"


@dataclass
class Placement:
    """One way a lesson could sit: a run of periods on one day."""

    var: Any
    day: int
    start: int
    size: int

    @property
    def slots(self) -> range:
        return range(self.start, self.start + self.size)


@dataclass
class Built:
    model: cp_model.CpModel
    problem: Problem
    #: lesson id -> every placement variable for it
    placements: dict[str, list[Placement]]
    #: lesson id -> the "this lesson has no period" variable, in optimise mode
    unplaced: dict[str, Any]
    #: tag -> assumption literal, in prove mode
    assumptions: dict[str, Any] = field(default_factory=dict)
    objective_terms: list[Any] = field(default_factory=list)
    #: Per-day cap overrun variables, when the cap is soft.
    over_cap: list[Any] = field(default_factory=list)
    completeness_terms: list[Any] = field(default_factory=list)
    unplaced_periods_terms: list[Any] = field(default_factory=list)


class Builder:
    """Turns a Problem into a CP-SAT model.

    ``relaxable`` makes every rule an administrator could change conditional on
    an assumption literal, so an infeasible model can name the rules that
    collide. ``soft_demand`` lets periods go unplaced at a large penalty instead
    of making the model infeasible, so optimise always returns a usable week.
    """

    def __init__(self, problem: Problem, *, relaxable: bool, soft_demand: bool):
        self.p = problem
        self.relaxable = relaxable
        self.soft_demand = soft_demand
        self.m = cp_model.CpModel()
        self.placements: dict[str, list[Placement]] = {}
        self.single_placements: dict[str, list[Placement]] = {}
        self.unplaced: dict[str, Any] = {}
        self._assumptions: dict[str, Any] = {}
        self.objective_terms: list[Any] = []
        #: Per-day cap overruns, when the cap is soft. Reported, never silent.
        self.over_cap: list[Any] = []
        #: Stage-one objective: get the week complete, at small coefficients.
        self.completeness_terms: list[Any] = []
        #: Unplaced periods on their own, for pinning stage one's result.
        self.unplaced_periods_terms: list[Any] = []

    # ── Assumption literals ──────────────────────────────────

    def lit(self, tag: str) -> Any | None:
        """The literal standing for "this rule holds", or None when it is hard."""
        if not self.relaxable:
            return None
        if tag not in self._assumptions:
            self._assumptions[tag] = self.m.NewBoolVar(tag)
        return self._assumptions[tag]

    def forbid(self, var: Any, tag: str) -> None:
        """Rule out a placement, blaming `tag` so a conflict can name it."""
        guard = self.lit(tag)
        if guard is None:
            self.m.Add(var == 0)
        else:
            self.m.Add(var == 0).OnlyEnforceIf(guard)

    def at_most(self, terms: Iterable[Any], bound: int, tag: str) -> None:
        terms = list(terms)
        if not terms:
            return
        guard = self.lit(tag)
        if guard is None:
            # AddAtMostOne is a clause, not a linear inequality — CP-SAT
            # propagates it far harder, and almost every bound here is 1.
            if bound == 1:
                self.m.AddAtMostOne(terms)
            else:
                self.m.Add(sum(terms) <= bound)
        else:
            self.m.Add(sum(terms) <= bound).OnlyEnforceIf(guard)

    # ── Variables ────────────────────────────────────────────

    def _blocked_reason(
        self, lesson: Lesson, sched: Schedule, day: int, slot: int
    ) -> str | None:
        """Why this lesson may not use this cell, if a time-off rule says so.

        The *reason* is the point. Filtering these positions out silently —
        which is all a heuristic can do — is what makes an impossible timetable
        look like bad luck.
        """
        key = cell_key(sched.days[day], sched.slot_ids[slot])
        t = self.p.time_off
        if TimeOff._blocked(t.subject, lesson.subject_id, key):
            return timeoff_tag("subject", lesson.subject_id)
        for c in lesson.classes:
            if TimeOff._blocked(t.homeroom, c.homeroom_id, key):
                return timeoff_tag("homeroom", c.homeroom_id)
        if lesson.teacher_ids:
            for teacher in lesson.teacher_ids:
                if TimeOff._blocked(t.teacher, teacher, key):
                    return timeoff_tag("teacher", teacher)
        elif TimeOff._blocked(t.teacher, None, key):
            return timeoff_tag("teacher", "*")
        return None

    def _pin_reason(
        self, lesson: Lesson, sched: Schedule, day: int, slot: int
    ) -> str | None:
        """A cell reserved for a class teacher this lesson does not have."""
        key = cell_key(sched.days[day], sched.slot_ids[slot])
        for pin in self.p.pins:
            if pin.key != key:
                continue
            if not any(c.homeroom_id == pin.homeroom_id for c in lesson.classes):
                continue
            satisfied = (
                pin.class_teacher_id in lesson.teacher_ids
                if pin.class_teacher_id
                else not lesson.teacher_ids
            )
            if not satisfied:
                return pin_tag(pin.homeroom_id)
        return None

    def build_placements(self) -> None:
        for lesson in self.p.lessons:
            sched = self.p.schedule_of(lesson)
            runs: list[Placement] = []
            singles: list[Placement] = []
            for day in range(len(sched.days)):
                for start in range(len(sched.slot_ids)):
                    if sched.runs_fit(start, lesson.size):
                        v = self.m.NewBoolVar(f"{lesson.id}_d{day}_s{start}")
                        runs.append(Placement(v, day, start, lesson.size))
                    # A block whose consecutive-periods requirement is relaxed
                    # becomes that many single periods instead — which is the
                    # fix an administrator would actually make, so the model
                    # has to be able to say it.
                    if lesson.is_block and self.relaxable:
                        v = self.m.NewBoolVar(f"{lesson.id}_split_d{day}_s{start}")
                        singles.append(Placement(v, day, start, 1))
            self.placements[lesson.id] = runs
            self.single_placements[lesson.id] = singles

            for group in (runs, singles):
                for pl in group:
                    for slot in pl.slots:
                        reason = self._blocked_reason(lesson, sched, pl.day, slot)
                        if reason:
                            self.forbid(pl.var, reason)
                            break
                        pin = self._pin_reason(lesson, sched, pl.day, slot)
                        if pin:
                            self.forbid(pl.var, pin)
                            break

    def build_demand(self) -> None:
        """Every required period gets placed — or is accounted for as unplaced."""
        for lesson in self.p.lessons:
            runs = [p.var for p in self.placements[lesson.id]]
            singles = [p.var for p in self.single_placements[lesson.id]]

            if lesson.fixed_at is not None:
                day, start = lesson.fixed_at
                exact = [
                    p.var
                    for p in self.placements[lesson.id]
                    if p.day == day and p.start == start
                ]
                if exact:
                    # A pin is a hard fact about where the lesson is. If that
                    # cell is also marked time off, the two rules collide and
                    # the conflict report is supposed to say so.
                    #
                    # Every OTHER position has to be ruled out explicitly.
                    # Forcing the pinned one to 1 and leaving the rest free let
                    # the solver satisfy the pin and then place the same lesson
                    # a second time somewhere else, which put a pinned lesson
                    # into the week twice.
                    self.m.AddExactlyOne(exact)
                    for pl in self.placements[lesson.id]:
                        if (pl.day, pl.start) != (day, start):
                            self.m.Add(pl.var == 0)
                    for v in singles:
                        self.m.Add(v == 0)
                    continue

            block_lit = self.lit(block_tag(lesson.source_id)) if lesson.is_block else None

            if block_lit is None:
                total = runs
                want = 1
                if singles:
                    for v in singles:
                        self.m.Add(v == 0)
            else:
                # Either one contiguous run, or `size` separate single periods.
                self.m.Add(sum(runs) == 1).OnlyEnforceIf(block_lit)  # reified: stays linear
                self.m.Add(sum(singles) == 0).OnlyEnforceIf(block_lit)
                self.m.Add(sum(runs) == 0).OnlyEnforceIf(block_lit.Not())
                self.m.Add(sum(singles) == lesson.size).OnlyEnforceIf(block_lit.Not())
                continue

            if self.soft_demand:
                gap = self.m.NewBoolVar(f"unplaced_{lesson.id}")
                self.unplaced[lesson.id] = gap
                self.m.AddExactlyOne(total + [gap]) if want == 1 else self.m.Add(
                    sum(total) + gap == want
                )
                self.completeness_terms.append(W_STAGE1_UNPLACED * lesson.size * gap)
                self.unplaced_periods_terms.append(lesson.size * gap)
            else:
                guard = self.lit(demand_tag(lesson))
                if guard is None:
                    self.m.Add(sum(total) == want)
                else:
                    self.m.Add(sum(total) == want).OnlyEnforceIf(guard)

    # ── Coverage index ───────────────────────────────────────

    def covers(self, lesson: Lesson) -> list[tuple[Any, int, int]]:
        """(variable, day, slot) — if the variable is true, the lesson is there."""
        out: list[tuple[Any, int, int]] = []
        for group in (self.placements[lesson.id], self.single_placements[lesson.id]):
            for pl in group:
                for slot in pl.slots:
                    out.append((pl.var, pl.day, slot))
        return out

    # ── Hard constraints ─────────────────────────────────────

    def build_class_occupancy(self) -> None:
        """A class is in one lesson at a time; parallel split groups coexist.

        Mirrors ``homeroomFree``: a whole-class lesson blocks the cell outright,
        a group lesson only blocks its own group.
        """
        whole: dict[tuple[str, str, int], list[Any]] = defaultdict(list)
        by_group: dict[tuple[str, str, int, str], list[Any]] = defaultdict(list)

        for lesson in self.p.lessons:
            sched = self.p.schedule_of(lesson)
            for var, day, slot in self.covers(lesson):
                key_day = sched.days[day]
                slot_id = sched.slot_ids[slot]
                for c in lesson.classes:
                    if c.token == WHOLE:
                        whole[(c.homeroom_id, key_day, self.p.clock.get(slot_id, slot))].append(var)
                    else:
                        by_group[
                            (c.homeroom_id, key_day, self.p.clock.get(slot_id, slot), c.token)
                        ].append(var)

        for key, terms in whole.items():
            if len(terms) > 1:
                self.m.AddAtMostOne(terms)
        # A group shares the cell with other groups, never with the whole class
        # and never with itself.
        for (hr, day, clock, _token), terms in by_group.items():
            combined = terms + whole.get((hr, day, clock), [])
            if len(combined) > 1:
                self.m.AddAtMostOne(combined)

    def build_teacher_occupancy(self) -> None:
        """A teacher is in one period at a time, across every bell schedule.

        Keyed on the config-wide clock rather than the slot id, which is what
        makes two overlapping periods of different schedules one booking.
        """
        busy: dict[tuple[str, str, int], list[Any]] = defaultdict(list)
        for lesson in self.p.lessons:
            sched = self.p.schedule_of(lesson)
            for var, day, slot in self.covers(lesson):
                slot_id = sched.slot_ids[slot]
                clock = self.p.clock.get(slot_id, slot)
                for teacher in lesson.teacher_ids:
                    busy[(teacher, sched.days[day], clock)].append(var)
        for terms in busy.values():
            if len(terms) > 1:
                self.m.AddAtMostOne(terms)
        self._teacher_busy_terms = busy

    def build_max_per_day(self) -> None:
        """Periods of one subject a class may have in a day.

        Each lesson is held to its OWN cap, not to the tightest cap in the
        bucket. That distinction is not pedantry: a class can have Outdoor as a
        once-a-day single requirement and also as a two-period combined double,
        and taking the minimum of the two caps makes the double unplaceable and
        reports a conflict that does not exist. The browser solver checks each
        lesson against its own cap as it places it, so this does the same —
        "if this lesson is on this day, the day's total must fit ITS cap".
        """
        # bucket -> day -> the period variables in it
        periods: dict[tuple[str, str, str], dict[str, list[Any]]] = defaultdict(
            lambda: defaultdict(list)
        )
        # bucket -> day -> lesson -> that lesson's own period variables
        by_lesson: dict[
            tuple[str, str, str], dict[str, dict[str, list[Any]]]
        ] = defaultdict(lambda: defaultdict(lambda: defaultdict(list)))
        caps: dict[str, int] = {}

        for lesson in self.p.lessons:
            sched = self.p.schedule_of(lesson)
            caps[lesson.id] = lesson.max_per_day
            for var, day, _slot in self.covers(lesson):
                day_name = sched.days[day]
                for c in lesson.classes:
                    bucket = (c.homeroom_id, lesson.subject_id, c.token)
                    periods[bucket][day_name].append(var)
                    by_lesson[bucket][day_name][lesson.id].append(var)

        for bucket, days in by_lesson.items():
            for day_name, lessons in days.items():
                total = periods[bucket][day_name]
                for lesson_id, own in lessons.items():
                    cap = caps[lesson_id]
                    if cap >= len(total):
                        continue  # the cap cannot bite on this day
                    # True when this lesson has any period on this day.
                    here = self.m.NewBoolVar("")
                    self.m.AddMaxEquality(here, own)
                    guard = self.lit(maxperday_tag(bucket[0], bucket[1]))
                    if guard is not None:
                        # Proving a week impossible asks whether the rules as
                        # written can be met, so here the cap is hard and
                        # relaxing it is something the report may recommend.
                        self.m.Add(sum(total) <= cap).OnlyEnforceIf([here, guard])
                        continue
                    if self.soft_demand:
                        # Optimising asks for the best usable week, and a period
                        # over the cap beats a period missing — the same trade
                        # the browser solver makes.
                        over = self.m.NewIntVar(0, len(total), "")
                        self.m.Add(over >= sum(total) - cap).OnlyEnforceIf(here)
                        self.over_cap.append(over)
                        self.objective_terms.append(W_OVER_CAP * SCALE * over)
                    else:
                        self.m.Add(sum(total) <= cap).OnlyEnforceIf(here)

    def build_rooms(self) -> None:
        """Shared facilities are a pool with a real capacity.

        Ordinary classrooms are absent on purpose — a class owns its room for
        the week and is only ever in one lesson at a time, so two classes having
        a lesson in the same period is not a room clash.
        """
        if not self.p.room_capacity:
            return
        pools: dict[tuple[str, str, int], list[Any]] = defaultdict(list)
        for lesson in self.p.lessons:
            if lesson.room_type not in self.p.room_capacity:
                continue
            sched = self.p.schedule_of(lesson)
            for var, day, slot in self.covers(lesson):
                clock = self.p.clock.get(sched.slot_ids[slot], slot)
                pools[(lesson.room_type, sched.days[day], clock)].append(var)
        for (room_type, _day, _clock), terms in pools.items():
            self.at_most(terms, self.p.room_capacity[room_type], room_tag(room_type))

    def build_max_in_a_row(self) -> None:
        """Most consecutive periods a teacher may be asked to teach."""
        if not self.p.max_in_a_row:
            return
        clocks = sorted(set(self.p.clock.values()))
        for teacher in {t for l in self.p.lessons for t in l.teacher_ids}:
            cap = self.p.max_row_for(teacher)
            if cap is None or cap <= 0:
                continue
            days = {d for s in self.p.schedules.values() for d in s.days}
            for day in days:
                # Any window of cap+1 consecutive periods must hold a free one.
                for i in range(len(clocks) - cap):
                    window = clocks[i : i + cap + 1]
                    terms = [
                        v
                        for c in window
                        for v in self._teacher_busy_terms.get((teacher, day, c), [])
                    ]
                    self.at_most(terms, cap, maxrow_tag(teacher))

    def _limit_buckets(self, limit: Any) -> dict[str, list[Any]]:
        """Mirrors ``limitBucketsFor`` in src/lib/timetable/constraints.ts."""
        buckets: dict[str, list[Any]] = defaultdict(list)
        for lesson in self.p.lessons:
            sched = self.p.schedule_of(lesson)
            for var, day, _slot in self.covers(lesson):
                day_name = sched.days[day]
                suffix_day = f"|{day_name}" if limit.period == "day" else ""
                for c in lesson.classes:
                    if limit.homeroom_id and limit.homeroom_id != c.homeroom_id:
                        continue
                    hr = f"|{limit.homeroom_id}" if limit.homeroom_id else ""
                    if limit.scope == "teacher":
                        for t in lesson.teacher_ids:
                            if limit.scope_id in (None, t):
                                buckets[f"teacher:{t}{hr}{suffix_day}"].append(var)
                    elif limit.scope == "subject":
                        if limit.scope_id in (None, lesson.subject_id):
                            buckets[f"subject:{lesson.subject_id}{hr}{suffix_day}"].append(var)
                    else:
                        if limit.scope_id in (None, c.homeroom_id):
                            buckets[f"homeroom:{c.homeroom_id}{hr}{suffix_day}"].append(var)
        return buckets

    def build_limits(self) -> None:
        for i, limit in enumerate(self.p.limits):
            buckets = self._limit_buckets(limit)
            if limit.kind == "max":
                for terms in buckets.values():
                    self.at_most(terms, limit.value, limit_tag(i, limit))
            else:
                # A min target is a goal, not a rule: short of it costs, it does
                # not make the week impossible. Same as the browser solver.
                for terms in buckets.values():
                    short = self.m.NewIntVar(0, limit.value, "")
                    self.m.Add(short >= limit.value - sum(terms))
                    self.objective_terms.append(W_MIN_SHORTFALL * SCALE * short)

    # ── Soft objective ───────────────────────────────────────

    def build_subject_spread(self) -> None:
        """Teaching one subject twice in a day costs, so the week spreads out.

        Counts LESSONS, not periods: a double is one lesson in two slots, and
        charging it as a repeat would make splitting every block look like an
        improvement.
        """
        by_day: dict[tuple[str, str, str, int], list[Any]] = defaultdict(list)
        for lesson in self.p.lessons:
            sched = self.p.schedule_of(lesson)
            for group in (self.placements[lesson.id], self.single_placements[lesson.id]):
                for pl in group:
                    for c in lesson.classes:
                        by_day[(c.homeroom_id, lesson.subject_id, c.token, pl.day)].append(pl.var)
        for terms in by_day.values():
            if len(terms) < 2:
                continue
            repeats = self.m.NewIntVar(0, len(terms), "")
            self.m.Add(repeats >= sum(terms) - 1)
            self.objective_terms.append(W_SUBJECT_REPEAT * SCALE * repeats)

    def build_day_balance(self) -> None:
        """Level each class's week against the length of its own week."""
        loads: dict[tuple[str, int], list[Any]] = defaultdict(list)
        class_days: dict[str, int] = {}
        for lesson in self.p.lessons:
            sched = self.p.schedule_of(lesson)
            for var, day, _slot in self.covers(lesson):
                for c in lesson.classes:
                    loads[(c.homeroom_id, day)].append(var)
                    class_days[c.homeroom_id] = max(1, len(sched.days))

        totals: dict[str, list[Any]] = defaultdict(list)
        for (hr, _day), terms in loads.items():
            totals[hr].extend(terms)

        for (hr, _day), terms in loads.items():
            days = class_days[hr]
            total = totals[hr]
            # |load - total/days|, kept integral by scaling both sides by days.
            dev = self.m.NewIntVar(0, len(total) * days, "")
            self.m.Add(dev >= sum(terms) * days - sum(total))
            self.m.Add(dev >= sum(total) - sum(terms) * days)
            self.objective_terms.append((SCALE // days) * dev)

    def build_teacher_compactness(self) -> None:
        """Idle periods stranded between two of a teacher's lessons cost.

        The same ``span - count`` measure the browser solver uses, so a week
        improved here is improved by the score the admin already sees.
        """
        clocks = sorted(set(self.p.clock.values()))
        if not clocks:
            return
        index_of = {c: i for i, c in enumerate(clocks)}
        per_day: dict[tuple[str, str], dict[int, list[Any]]] = defaultdict(
            lambda: defaultdict(list)
        )
        for (teacher, day, clock), terms in self._teacher_busy_terms.items():
            per_day[(teacher, day)][index_of[clock]].extend(terms)

        for (teacher, day), slots in per_day.items():
            if len(slots) < 2:
                continue
            busy_bools: list[tuple[int, Any]] = []
            for i, terms in slots.items():
                b = self.m.NewBoolVar(f"busy_{teacher}_{day}_{i}")
                self.m.Add(sum(terms) == b)
                busy_bools.append((i, b))
            count = sum(b for _, b in busy_bools)
            any_busy = self.m.NewBoolVar("")
            self.m.AddMaxEquality(any_busy, [b for _, b in busy_bools])
            lo = self.m.NewIntVar(0, len(clocks) - 1, "")
            hi = self.m.NewIntVar(0, len(clocks) - 1, "")
            for i, b in busy_bools:
                self.m.Add(lo <= i).OnlyEnforceIf(b)
                self.m.Add(hi >= i).OnlyEnforceIf(b)
            # Minimising the term pulls lo and hi tight, so they only need to be
            # valid bounds rather than exactly the first and last period.
            stranded = self.m.NewIntVar(0, len(clocks), "")
            self.m.Add(stranded >= hi - lo + 1 - count).OnlyEnforceIf(any_busy)
            self.objective_terms.append(W_TEACHER_SPAN * SCALE * stranded)

    def build_pin_quality(self) -> None:
        """A pinned period the class teacher does not end up taking costs."""
        for pin in self.p.pins:
            if not pin.class_teacher_id:
                continue
            day_name, slot_id = pin.key.split("__", 1)
            filled: list[Any] = []
            for lesson in self.p.lessons:
                if pin.class_teacher_id not in lesson.teacher_ids:
                    continue
                if not any(c.homeroom_id == pin.homeroom_id for c in lesson.classes):
                    continue
                sched = self.p.schedule_of(lesson)
                for var, day, slot in self.covers(lesson):
                    if sched.days[day] == day_name and sched.slot_ids[slot] == slot_id:
                        filled.append(var)
            miss = self.m.NewBoolVar("")
            if filled:
                self.m.Add(sum(filled) + miss >= 1)
            else:
                self.m.Add(miss == 1)
            self.objective_terms.append(W_UNFILLED_PIN * SCALE * miss)

    # ── Assembly ─────────────────────────────────────────────

    def build(self, *, with_objective: bool) -> Built:
        self.build_placements()
        self.build_demand()
        self.build_class_occupancy()
        self.build_teacher_occupancy()
        self.build_max_per_day()
        self.build_rooms()
        self.build_max_in_a_row()
        self.build_limits()
        if with_objective:
            self.build_subject_spread()
            self.build_day_balance()
            self.build_teacher_compactness()
            self.build_pin_quality()
            # The objective is chosen per stage by the caller, not here.
        return Built(
            model=self.m,
            problem=self.p,
            placements=self.placements,
            unplaced=self.unplaced,
            assumptions=dict(self._assumptions),
            objective_terms=self.objective_terms,
            over_cap=self.over_cap,
            completeness_terms=self.completeness_terms,
            unplaced_periods_terms=self.unplaced_periods_terms,
        )
