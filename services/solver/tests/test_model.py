"""What the CP-SAT model has to get right.

Small instances on purpose. The point of these is not that the solver can
solve a school — it can — but that the model says what the rest of the app
means, and that the two mistakes found while building it stay fixed.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from solver.payload import parse_problem  # noqa: E402
from solver.solve import optimise, prove  # noqa: E402

DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday"]


def problem(
    *,
    lessons: list[dict],
    slots: int = 4,
    days: list[str] | None = None,
    time_off: dict | None = None,
    adjacent: list[bool] | None = None,
    **extra,
) -> dict:
    day_list = days if days is not None else DAYS
    return {
        "schedules": [
            {
                "key": "__base__",
                "days": day_list,
                "slotIds": [f"s{i}" for i in range(slots)],
                "adjacentNext": (
                    adjacent if adjacent is not None else [True] * max(0, slots - 1)
                ),
            }
        ],
        "clock": {f"s{i}": i for i in range(slots)},
        "clash": {f"s{i}": [f"s{i}"] for i in range(slots)},
        "lessons": lessons,
        "timeOff": time_off or {"teacher": {}, "homeroom": {}, "subject": {}},
        "pins": [],
        "maxInARow": {},
        "limits": [],
        "roomCapacity": {},
        **extra,
    }


def lesson(
    lid: str,
    *,
    classes: list[str],
    subject: str = "sub",
    teachers: list[str] | None = None,
    size: int = 1,
    max_per_day: int = 1,
    kind: str = "requirement",
    source: str | None = None,
    room_type: str = "classroom",
) -> dict:
    return {
        "id": lid,
        "kind": kind,
        "sourceId": source or lid,
        "scheduleKey": "__base__",
        "classes": [{"homeroomId": c, "token": "__whole__"} for c in classes],
        "subjectId": subject,
        "teacherIds": teachers if teachers is not None else ["t1"],
        "roomType": room_type,
        "size": size,
        "maxPerDay": max_per_day,
    }


# ── Feasibility ──────────────────────────────────────────────


def test_places_every_period_of_a_simple_week():
    p = parse_problem(problem(lessons=[lesson(f"L{i}", classes=["hr1"]) for i in range(4)]))
    r = prove(p, budget_s=20)
    assert r.status == "feasible"
    assert len(r.placements) == 4
    # One class cannot be in two lessons at once.
    cells = {(x.day, x.start) for x in r.placements}
    assert len(cells) == 4


def test_a_teacher_cannot_be_in_two_classes_at_once():
    # One slot, one day, one teacher, two classes that both need them.
    p = parse_problem(
        problem(
            slots=1,
            days=["monday"],
            lessons=[
                lesson("L1", classes=["hr1"], teachers=["t1"]),
                lesson("L2", classes=["hr2"], teachers=["t1"]),
            ],
        )
    )
    assert prove(p, budget_s=20).status == "impossible"


def test_two_classes_may_share_a_period_with_different_teachers():
    p = parse_problem(
        problem(
            slots=1,
            days=["monday"],
            lessons=[
                lesson("L1", classes=["hr1"], teachers=["t1"]),
                lesson("L2", classes=["hr2"], teachers=["t2"]),
            ],
        )
    )
    assert prove(p, budget_s=20).status == "feasible"


def test_a_combined_lesson_fills_every_member_class_at_once():
    p = parse_problem(
        problem(
            slots=1,
            days=["monday"],
            lessons=[
                lesson("C1", classes=["hr1", "hr2"], kind="combined", teachers=["t1"]),
                # hr1 is now busy in that one slot, so this cannot also go there.
                lesson("L1", classes=["hr1"], teachers=["t2"], subject="other"),
            ],
        )
    )
    assert prove(p, budget_s=20).status == "impossible"


# ── Explaining an impossible week ────────────────────────────


def test_names_the_two_rules_that_collide_and_nothing_else():
    """A double whose subject is only allowed in two non-adjacent periods.

    This is the real case that prompted the service: the browser solver could
    only report "could not fit", which reads as bad luck.
    """
    # Four periods a day; a break between 1 and 2 splits the day into pairs.
    blocked = [
        f"{day}__s{i}"
        for day in DAYS
        for i in range(4)
        if not (day == "monday" and i == 0) and not (day == "friday" and i == 0)
    ]
    p = parse_problem(
        problem(
            lessons=[lesson("B1", classes=["hr1"], size=2, max_per_day=2, source="req1")],
            time_off={"teacher": {}, "homeroom": {}, "subject": {"sub": blocked}},
        )
    )
    r = prove(p, budget_s=30)
    assert r.status == "impossible"
    rules = {c["rule"] for c in r.conflicts}
    assert rules == {"time_off", "consecutive_periods"}, r.conflicts
    # Minimal: nothing else is blamed.
    assert len(r.conflicts) == 2


def test_relaxing_the_block_makes_the_same_week_possible():
    """Which is the advice the conflict above is meant to produce."""
    blocked = [
        f"{day}__s{i}"
        for day in DAYS
        for i in range(4)
        if not (day == "monday" and i == 0) and not (day == "friday" and i == 0)
    ]
    # The same demand as two single periods instead of one double.
    p = parse_problem(
        problem(
            lessons=[
                lesson("S1", classes=["hr1"], size=1, source="req1"),
                lesson("S2", classes=["hr1"], size=1, source="req1"),
            ],
            time_off={"teacher": {}, "homeroom": {}, "subject": {"sub": blocked}},
        )
    )
    assert prove(p, budget_s=30).status == "feasible"


def test_reports_each_independent_conflict_rather_than_just_one():
    """One core is not the whole story, and fixing one thing is not enough."""
    off_a = [f"{d}__s{i}" for d in DAYS for i in range(4)]  # subject a: nowhere
    off_b = [f"{d}__s{i}" for d in DAYS for i in range(4)]  # subject b: nowhere
    p = parse_problem(
        problem(
            lessons=[
                lesson("L1", classes=["hr1"], subject="a", source="reqA"),
                lesson("L2", classes=["hr2"], subject="b", teachers=["t2"], source="reqB"),
            ],
            time_off={"teacher": {}, "homeroom": {}, "subject": {"a": off_a, "b": off_b}},
        )
    )
    r = prove(p, budget_s=30)
    assert r.status == "impossible"
    assert len({c["group"] for c in r.conflicts}) == 2, r.conflicts


def test_time_off_for_all_teachers_is_honoured():
    p = parse_problem(
        problem(
            slots=1,
            days=["monday"],
            lessons=[lesson("L1", classes=["hr1"], teachers=["t1"])],
            time_off={"teacher": {"*": ["monday__s0"]}, "homeroom": {}, "subject": {}},
        )
    )
    assert prove(p, budget_s=20).status == "impossible"


# ── The per-day cap ──────────────────────────────────────────


def test_each_lesson_is_held_to_its_own_per_day_cap():
    """Regression: the tightest cap in the bucket is not everyone's cap.

    A class can have a subject as a once-a-day single AND as a two-period
    double. Taking the minimum of the two caps made the double unplaceable and
    reported a conflict that did not exist — on real data, three of them.
    """
    p = parse_problem(
        problem(
            lessons=[
                lesson("D1", classes=["hr1"], size=2, max_per_day=2, source="reqDouble"),
                lesson("S1", classes=["hr1"], size=1, max_per_day=1, source="reqSingle"),
            ],
        )
    )
    r = prove(p, budget_s=20)
    assert r.status == "feasible", r.conflicts


def test_the_cap_still_bites_when_it_should():
    # Two single periods of one subject, cap 1 a day, and only one day to use.
    p = parse_problem(
        problem(
            days=["monday"],
            lessons=[
                lesson("S1", classes=["hr1"], max_per_day=1, source="r"),
                lesson("S2", classes=["hr1"], max_per_day=1, source="r"),
            ],
        )
    )
    r = prove(p, budget_s=20)
    assert r.status == "impossible"
    assert "max_per_day" in {c["rule"] for c in r.conflicts}, r.conflicts


# ── Optimising ───────────────────────────────────────────────


def test_optimise_returns_a_complete_week():
    p = parse_problem(problem(lessons=[lesson(f"L{i}", classes=["hr1"]) for i in range(4)]))
    r = optimise(p, budget_s=20)
    assert r.status in ("optimal", "feasible")
    assert r.unplacedPeriods == 0
    assert len(r.placements) == 4


def test_optimise_never_places_less_than_the_week_it_was_given():
    """The guarantee the button depends on: improving cannot cost a lesson."""
    lessons = [lesson(f"L{i}", classes=["hr1"], subject=f"sub{i}") for i in range(4)]
    p = parse_problem(problem(lessons=lessons))
    hint = {f"L{i}": (i, 0) for i in range(4)}
    r = optimise(p, budget_s=20, hint=hint)
    assert r.unplacedPeriods == 0
    assert len(r.placements) == 4


def test_optimise_hands_back_the_caller_week_when_it_cannot_beat_it():
    """The regression behind "the solver returned no timetable".

    `AddHint` is a suggestion, not a solution. On a school-sized problem CP-SAT
    routinely spends the whole budget without completing a solution from it and
    returns nothing — so "Tidy up this week" reported failure and changed
    nothing while a complete week sat in the request it had just been handed.

    Sized to be genuinely out of reach in the budget below (49k variables in
    ~1s), with a hint that is a real, conflict-free week: one teacher per
    class, one lesson per cell. Whatever the later stages manage, the result
    must still carry that week.
    """
    lessons, hint = [], {}
    for c in range(30):
        for k in range(30):
            lid = f"L{c}_{k}"
            lessons.append(
                lesson(lid, classes=[f"hr{c}"], subject=f"sub{k % 9}",
                       teachers=[f"t{c}"], max_per_day=9)
            )
            hint[lid] = (k // 8, k % 8)
    p = parse_problem(problem(lessons=lessons, slots=8, days=DAYS))

    r = optimise(p, budget_s=1.2, hint=hint)

    assert r.status != "unknown", "a week it could not improve on must still come back"
    assert len(r.placements) == len(lessons)
    assert r.unplacedPeriods == 0
    assert r.penalty is not None


def test_optimise_prefers_a_period_over_the_cap_to_a_period_missing():
    """The same trade the browser solver's relaxed pass makes."""
    # Three periods of one subject, one day, cap of 1 a day. Something has to give.
    p = parse_problem(
        problem(
            days=["monday"],
            lessons=[lesson(f"S{i}", classes=["hr1"], max_per_day=1, source="r") for i in range(3)],
        )
    )
    r = optimise(p, budget_s=20)
    assert r.unplacedPeriods == 0, "a placeable period should not be left out"
    assert r.overCapPeriods > 0, "and the trade should be reported, not hidden"


def test_a_pinned_lesson_stays_where_it_was_put():
    fixed = lesson("L1", classes=["hr1"])
    fixed["fixedAt"] = [2, 1]
    p = parse_problem(problem(lessons=[fixed, lesson("L2", classes=["hr1"], subject="other")]))
    r = optimise(p, budget_s=20)
    placed = {x.lessonId: (x.day, x.start) for x in r.placements}
    assert placed["L1"] == (2, 1)


# ── Shared facilities ────────────────────────────────────────


def test_a_lab_is_a_pool_with_a_capacity():
    # One lab, one period in the week, two classes that both need it.
    p = parse_problem(
        problem(
            slots=1,
            days=["monday"],
            lessons=[
                lesson("L1", classes=["hr1"], teachers=["t1"], room_type="science_lab"),
                lesson("L2", classes=["hr2"], teachers=["t2"], room_type="science_lab"),
            ],
            roomCapacity={"science_lab": 1},
        )
    )
    assert prove(p, budget_s=20).status == "impossible"
    p2 = parse_problem(
        problem(
            slots=1,
            days=["monday"],
            lessons=[
                lesson("L1", classes=["hr1"], teachers=["t1"], room_type="science_lab"),
                lesson("L2", classes=["hr2"], teachers=["t2"], room_type="science_lab"),
            ],
            roomCapacity={"science_lab": 2},
        )
    )
    assert prove(p2, budget_s=20).status == "feasible"


def test_ordinary_classrooms_are_not_contended():
    """Two classes having a lesson in the same period is not a room clash."""
    p = parse_problem(
        problem(
            slots=1,
            days=["monday"],
            lessons=[
                lesson("L1", classes=["hr1"], teachers=["t1"]),
                lesson("L2", classes=["hr2"], teachers=["t2"]),
                lesson("L3", classes=["hr3"], teachers=["t3"]),
            ],
        )
    )
    assert prove(p, budget_s=20).status == "feasible"


# ── Blocks and breaks ────────────────────────────────────────


def test_a_double_never_straddles_a_break():
    # Four periods with a break between index 1 and 2: runs are [0,1] and [2,3].
    p = parse_problem(
        problem(
            days=["monday"],
            slots=4,
            adjacent=[True, False, True],
            lessons=[lesson("B1", classes=["hr1"], size=2, max_per_day=2)],
        )
    )
    r = prove(p, budget_s=20)
    assert r.status == "feasible"
    start = r.placements[0].start
    assert start in (0, 2), "a double has to start at the head of a run"


def test_a_double_is_impossible_when_no_run_is_long_enough():
    # Every period is isolated, so nothing can be consecutive.
    p = parse_problem(
        problem(
            slots=3,
            adjacent=[False, False],
            lessons=[lesson("B1", classes=["hr1"], size=2, max_per_day=2, source="req1")],
        )
    )
    r = prove(p, budget_s=20)
    assert r.status == "impossible"
    assert "consecutive_periods" in {c["rule"] for c in r.conflicts}, r.conflicts


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-q"]))
