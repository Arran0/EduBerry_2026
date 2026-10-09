"""The problem as the Next.js app sends it.

Every field here is produced by ``src/lib/timetable/solverPayload.ts`` out of the
same functions the live grid uses. Nothing in this package decides what a
school rule means; it decides how to express one to CP-SAT. Keep it that way —
the moment a rule is reinterpreted here, the grid and the solver can disagree,
and the admin gets a cell the grid calls free and the solver refuses to use.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

WHOLE = "__whole__"


def cell_key(day: str, slot_id: str) -> str:
    """Mirrors ``cellKey`` in src/lib/timetable/constraints.ts."""
    return f"{day}__{slot_id}"


@dataclass(frozen=True)
class Schedule:
    """One bell schedule: its working days and its teaching periods in order."""

    key: str
    days: tuple[str, ...]
    slot_ids: tuple[str, ...]
    #: adjacent_next[i] — slot i and i+1 are consecutive periods, no break between.
    adjacent_next: tuple[bool, ...]

    def runs_fit(self, start: int, size: int) -> bool:
        """Can a `size`-period block start here without straddling a break?"""
        if start + size > len(self.slot_ids):
            return False
        return all(self.adjacent_next[j] for j in range(start, start + size - 1))


@dataclass(frozen=True)
class ClassSlot:
    homeroom_id: str
    #: Occupancy token: WHOLE, or a split group id.
    token: str


@dataclass(frozen=True)
class Lesson:
    id: str
    kind: str  # 'requirement' | 'combined'
    source_id: str
    schedule_key: str
    classes: tuple[ClassSlot, ...]
    subject_id: str
    teacher_ids: tuple[str, ...]
    room_type: str
    size: int
    max_per_day: int
    #: A pinned lesson, as (day index, start index) in its own schedule.
    fixed_at: tuple[int, int] | None = None

    @property
    def is_block(self) -> bool:
        return self.size > 1


@dataclass(frozen=True)
class Limit:
    scope: str  # 'teacher' | 'subject' | 'homeroom'
    scope_id: str | None
    homeroom_id: str | None
    period: str  # 'day' | 'week'
    kind: str  # 'max' | 'min'
    value: int


@dataclass(frozen=True)
class Pin:
    homeroom_id: str
    class_teacher_id: str | None
    key: str  # cell key


@dataclass
class TimeOff:
    """Cell keys an entity is unavailable for. The '*' entry covers every entity."""

    teacher: dict[str, set[str]] = field(default_factory=dict)
    homeroom: dict[str, set[str]] = field(default_factory=dict)
    subject: dict[str, set[str]] = field(default_factory=dict)

    @staticmethod
    def _blocked(table: dict[str, set[str]], entity: str | None, key: str) -> bool:
        """Mirrors ``timeOffBlocked`` in src/lib/timetable/constraints.ts."""
        if key in table.get("*", ()):
            return True
        return entity is not None and key in table.get(entity, ())


@dataclass
class Problem:
    schedules: dict[str, Schedule]
    clock: dict[str, int]
    clash: dict[str, tuple[str, ...]]
    lessons: tuple[Lesson, ...]
    time_off: TimeOff
    pins: tuple[Pin, ...]
    max_in_a_row: dict[str, int]
    limits: tuple[Limit, ...]
    room_capacity: dict[str, int]

    def schedule_of(self, lesson: Lesson) -> Schedule:
        return self.schedules[lesson.schedule_key]

    def max_row_for(self, teacher_id: str) -> int | None:
        """Mirrors ``effectiveMaxInARow``: the tighter of the teacher's and '*'."""
        values = [v for k, v in self.max_in_a_row.items() if k in ("*", teacher_id)]
        return min(values) if values else None


def _schedule(raw: dict[str, Any]) -> Schedule:
    return Schedule(
        key=raw["key"],
        days=tuple(raw["days"]),
        slot_ids=tuple(raw["slotIds"]),
        adjacent_next=tuple(bool(b) for b in raw.get("adjacentNext", [])),
    )


def _lesson(raw: dict[str, Any]) -> Lesson:
    fixed = raw.get("fixedAt")
    return Lesson(
        id=raw["id"],
        kind=raw["kind"],
        source_id=raw.get("sourceId", ""),
        schedule_key=raw["scheduleKey"],
        classes=tuple(
            ClassSlot(homeroom_id=c["homeroomId"], token=c.get("token") or WHOLE)
            for c in raw["classes"]
        ),
        subject_id=raw.get("subjectId") or "",
        teacher_ids=tuple(raw.get("teacherIds") or ()),
        room_type=raw.get("roomType") or "classroom",
        size=max(1, int(raw.get("size", 1))),
        # A non-positive or missing cap means "no cap", which is how the
        # TypeScript side treats an infinite maxPerDay on a re-placed lesson.
        max_per_day=int(raw["maxPerDay"]) if raw.get("maxPerDay") else 10**6,
        fixed_at=(int(fixed[0]), int(fixed[1])) if fixed else None,
    )


def parse_problem(raw: dict[str, Any]) -> Problem:
    time_off_raw = raw.get("timeOff") or {}
    return Problem(
        schedules={s["key"]: _schedule(s) for s in raw["schedules"]},
        clock={k: int(v) for k, v in (raw.get("clock") or {}).items()},
        clash={k: tuple(v) for k, v in (raw.get("clash") or {}).items()},
        lessons=tuple(_lesson(l) for l in raw.get("lessons", [])),
        time_off=TimeOff(
            teacher={k: set(v) for k, v in (time_off_raw.get("teacher") or {}).items()},
            homeroom={k: set(v) for k, v in (time_off_raw.get("homeroom") or {}).items()},
            subject={k: set(v) for k, v in (time_off_raw.get("subject") or {}).items()},
        ),
        pins=tuple(
            Pin(
                homeroom_id=p["homeroomId"],
                class_teacher_id=p.get("classTeacherId"),
                key=p["key"],
            )
            for p in raw.get("pins", [])
        ),
        max_in_a_row={k: int(v) for k, v in (raw.get("maxInARow") or {}).items()},
        limits=tuple(
            Limit(
                scope=l["scope"],
                scope_id=l.get("scopeId"),
                homeroom_id=l.get("homeroomId"),
                period=l["period"],
                kind=l["kind"],
                value=int(l["value"]),
            )
            for l in raw.get("limits", [])
        ),
        room_capacity={k: int(v) for k, v in (raw.get("roomCapacity") or {}).items()},
    )
