// ============================================================
// The problem, flattened for the CP-SAT service.
//
// The constraint-programming solver runs in Python, because OR-Tools has no
// JavaScript binding. That raises the one real danger of adding it: two
// implementations of the same school rules, drifting apart until the grid says
// a cell is fine and the solver refuses to use it.
//
// So the split is not "TypeScript does the UI, Python does the rules". Every
// domain rule stays here, in the code the live grid already uses — the bell
// geometry from buildSchedules, the block expansion from expandBlocks and
// expandCombined, the time-off and limit index from buildConstraintIndex. This
// module flattens their output into a transport format that carries no
// judgement of its own, and Python does nothing but the CP-SAT algebra over
// it. There is one source of truth for what a school's rules mean, and it is
// the one that was already here.
//
// The one thing Python re-derives is which (day, start) positions a lesson
// could take, and that is deliberate: the solver needs to know not only that a
// position is unavailable but WHY, so an infeasible problem can name the rules
// that collide. Baking the filtering in here would throw that away. The rule
// it applies — a cell key present in an entity's time-off set, or in the '*'
// set that covers every entity — is `timeOffBlocked`, reproduced in four lines
// and tested against this payload on both sides.
// ============================================================

import {
  buildSchedules, scheduleFor, expandBlocks, expandCombined, buildRoomPlan,
} from './generator'
import type { Block, CombinedUnit } from './generator'
import { buildConstraintIndex, cellKey } from './constraints'
import type { ConstraintIndex } from './constraints'
import { teacherIdsOf, WEEKDAYS } from './types'
import type {
  GeneratorInput, PlacedEntry, Room, RoomType, TeacherUnavailability, Weekday,
} from './types'

/** The whole-class occupancy token, matching the generator's own. */
const WHOLE = '__whole__'

// ── Wire format ──────────────────────────────────────────────
// Deliberately primitive: ids are strings, days and slots are indices into the
// arrays below. Nothing here needs to be interpreted to be understood.

export interface WireSchedule {
  key: string
  /** Weekday names, in the order the solver indexes them. */
  days: Weekday[]
  /** Teaching slot ids in period order; breaks are already excluded. */
  slotIds: string[]
  /** adjacentNext[i] — slot i and i+1 are consecutive periods, no break between. */
  adjacentNext: boolean[]
}

/** One class (or split group of one class) a lesson occupies. */
export interface WireClassSlot {
  homeroomId: string
  /** The occupancy token: '__whole__', or a split group id. */
  token: string
}

export interface WireLesson {
  id: string
  kind: 'requirement' | 'combined'
  /** The requirement or combined-class row this came from, for the report. */
  sourceId: string
  scheduleKey: string
  classes: WireClassSlot[]
  subjectId: string
  teacherIds: string[]
  roomType: RoomType
  /** Consecutive periods this lesson occupies. */
  size: number
  /** Periods of this subject this class may have in one day. */
  maxPerDay: number
  /** A pinned lesson, as [dayIndex, startIndex] in its own schedule. */
  fixedAt?: [number, number]
}

export interface WireLimit {
  scope: 'teacher' | 'subject' | 'homeroom'
  scopeId: string | null
  homeroomId: string | null
  period: 'day' | 'week'
  kind: 'max' | 'min'
  value: number
}

export interface WirePin {
  homeroomId: string
  classTeacherId: string | null
  /** cellKey — `${day}__${slotId}`. */
  key: string
}

export interface SolverPayload {
  schedules: WireSchedule[]
  /** slotId -> a config-wide chronological ordinal, for max-in-a-row. */
  clock: Record<string, number>
  /** slotId -> every slot sharing its wall-clock hour, its own id included. */
  clash: Record<string, string[]>
  lessons: WireLesson[]
  /** Entity id (or '*' for all) -> the cell keys it is unavailable for. */
  timeOff: {
    teacher: Record<string, string[]>
    homeroom: Record<string, string[]>
    subject: Record<string, string[]>
  }
  pins: WirePin[]
  /** Teacher id, or '*', -> most consecutive periods allowed. */
  maxInARow: Record<string, number>
  limits: WireLimit[]
  /**
   * How many rooms of each shared type exist. Ordinary classrooms are absent
   * on purpose: a class owns its room for the week and is only ever in one
   * lesson at a time, so classroom contention is not a real constraint.
   */
  roomCapacity: Partial<Record<RoomType, number>>
}

const setToArray = (map: Map<string, Set<string>>): Record<string, string[]> => {
  const out: Record<string, string[]> = {}
  for (const [id, keys] of map) out[id] = [...keys]
  return out
}

/**
 * Pinned entries become lessons fixed to their cell rather than lessons with
 * one legal position: a pin whose cell has since been marked time off would
 * make the whole problem infeasible, and reporting that as "your pins and your
 * time off collide" is exactly the point.
 */
function fixedPosition(
  entries: PlacedEntry[],
  lesson: { classes: WireClassSlot[]; subjectId: string; size: number },
  days: Weekday[],
  slotIds: string[],
): [number, number] | undefined {
  const first = lesson.classes[0]
  if (!first) return undefined
  const mine = entries.filter(
    (e) =>
      e.homeroomId === first.homeroomId &&
      (e.groupId ?? WHOLE) === first.token &&
      e.subjectId === lesson.subjectId,
  )
  if (mine.length === 0) return undefined
  // The earliest period of the run is where the lesson starts.
  let best: [number, number] | undefined
  for (const e of mine) {
    const d = days.indexOf(e.day)
    const s = slotIds.indexOf(e.slotId)
    if (d < 0 || s < 0) continue
    if (!best || d < best[0] || (d === best[0] && s < best[1])) best = [d, s]
  }
  return best
}

/** Legacy teacher_unavailability rows, merged the way the generator merges them. */
function mergeUnavailability(index: ConstraintIndex, unavail: TeacherUnavailability[]): void {
  for (const u of unavail) {
    if (!index.teacherTimeOff.has(u.teacher_id)) index.teacherTimeOff.set(u.teacher_id, new Set())
    index.teacherTimeOff.get(u.teacher_id)!.add(cellKey(u.day, u.slot_id))
  }
}

export function buildSolverPayload(input: GeneratorInput): SolverPayload {
  const sched = buildSchedules(
    input.config, input.slots, input.slotGroups ?? [], input.homeroomGroupIds ?? {},
  )
  const index = buildConstraintIndex(input.constraints ?? [], input.homerooms ?? [])
  mergeUnavailability(index, input.unavailability ?? [])

  const locked = (input.locked ?? []).map((p) => ({ ...p, isLocked: true }))
  // Pinned lessons are modelled, not subtracted: the solver has to see them to
  // be able to say that they are what makes the week impossible. So expansion
  // runs against no locked entries and the pins become fixed positions below.
  const blocks: Block[] = expandBlocks(input.requirements, [])
  const combined: CombinedUnit[] = expandCombined(input.combined ?? [], [])

  const schedules: WireSchedule[] = sched.order.map((g) => ({
    key: g.key,
    days: WEEKDAYS.filter((d) => g.days.includes(d)),
    slotIds: g.slotIds,
    adjacentNext: g.adjacentNext,
  }))
  const scheduleOf = new Map(schedules.map((s) => [s.key, s]))

  const lessons: WireLesson[] = []
  let n = 0

  for (const b of blocks) {
    const geo = scheduleFor(sched, b.homeroomId)
    const wire = scheduleOf.get(geo.key)
    if (!wire) continue // a schedule with no teaching periods holds nothing
    const classes: WireClassSlot[] = [{ homeroomId: b.homeroomId, token: b.groupId ?? WHOLE }]
    const lesson: WireLesson = {
      id: `R${n++}`,
      kind: 'requirement',
      sourceId: b.requirementId,
      scheduleKey: geo.key,
      classes,
      subjectId: b.subjectId,
      teacherIds: b.teacherIds.length > 0 ? b.teacherIds : teacherIdsOf(b),
      roomType: b.roomType,
      size: b.size,
      maxPerDay: b.maxPerDay,
    }
    lessons.push(lesson)
  }

  for (const u of combined) {
    // Every member class has to share one week for the lesson to exist at all.
    const keys = new Set(u.members.map((m) => scheduleFor(sched, m.homeroomId).key))
    const key = keys.size === 1 ? [...keys][0] : null
    const wire = key ? scheduleOf.get(key) : undefined
    if (!wire) continue // reported separately as a period-group mismatch
    lessons.push({
      id: `C${n++}`,
      kind: 'combined',
      sourceId: u.combinedId,
      scheduleKey: wire.key,
      classes: u.members.map((m) => ({ homeroomId: m.homeroomId, token: m.groupId ?? WHOLE })),
      subjectId: u.subjectId,
      teacherIds: u.teacherIds,
      roomType: u.roomType,
      size: u.size,
      maxPerDay: u.maxPerDay,
    })
  }

  // Fix the pinned ones in place, one pinned lesson per pinned run.
  if (locked.length > 0) {
    const claimed = new Set<string>()
    for (const lesson of lessons) {
      const wire = scheduleOf.get(lesson.scheduleKey)!
      const at = fixedPosition(locked, lesson, wire.days, wire.slotIds)
      if (!at) continue
      const token = `${lesson.classes[0].homeroomId}|${lesson.subjectId}|${at[0]}|${at[1]}`
      if (claimed.has(token)) continue // another lesson of the same requirement has it
      claimed.add(token)
      lesson.fixedAt = at
    }
  }

  // Only shared facilities are a real pool. buildRoomPlan is reused so the
  // definition of "shared" stays in one place.
  const plan = buildRoomPlan(input.rooms, [
    ...(input.homerooms ?? []).map((h) => h.id),
    ...input.requirements.map((r) => r.homeroom_id),
  ])
  const roomCapacity: Partial<Record<RoomType, number>> = {}
  for (const [type, rooms] of plan.byType) {
    if (type === 'classroom') continue
    roomCapacity[type] = rooms.length
  }

  return {
    schedules,
    clock: Object.fromEntries(sched.clock),
    clash: Object.fromEntries(sched.clash),
    lessons,
    timeOff: {
      teacher: setToArray(index.teacherTimeOff),
      homeroom: setToArray(index.homeroomTimeOff),
      subject: setToArray(index.subjectTimeOff),
    },
    pins: index.pins.map((p) => ({
      homeroomId: p.homeroomId, classTeacherId: p.classTeacherId, key: p.key,
    })),
    maxInARow: Object.fromEntries(index.maxInARow),
    limits: index.limits.map((l) => ({
      scope: l.scope, scopeId: l.scopeId, homeroomId: l.homeroomId,
      period: l.period, kind: l.kind, value: l.value,
    })),
    roomCapacity,
  }
}

/**
 * A week the browser solver already found, expressed as the CP-SAT model's own
 * lesson positions.
 *
 * This is what makes the service worth calling. Asked cold, CP-SAT spends its
 * budget discovering a mediocre week from nothing — measured at 42 unplaced
 * periods against the browser's 2 on a real school, because finding *a*
 * complete timetable is the part a good heuristic is already excellent at.
 * Started from the heuristic's answer, every second of the budget goes into
 * improving a week that was already usable, and the result can only be better
 * than what it was given.
 *
 * Lessons are matched to placed runs by shape — class, subject, group and
 * length — because the solver's lesson ids are positional and the entries
 * carry no id of their own. Each run claims one unused lesson.
 */
export function buildSolverHint(
  payload: SolverPayload,
  entries: PlacedEntry[],
): Record<string, [number, number]> {
  const scheduleOf = new Map(payload.schedules.map((s) => [s.key, s]))

  // Group the placed periods into the runs they represent: a block is one run,
  // a combined lesson is one run however many classes it fills, and anything
  // else is a single period.
  const runs = new Map<string, PlacedEntry[]>()
  for (const e of entries) {
    // blockKey first, and that ordering matters: a combined key embeds the day
    // and the slot, so every period of a combined double carries a DIFFERENT
    // one. Grouping by it split each double into two single periods that then
    // matched no lesson at all, and the warm start silently lost them.
    const key = e.blockKey
      ? `b:${e.blockKey}`
      : e.combinedKey
        ? `c:${e.combinedKey}`
        : `s:${e.homeroomId}|${e.groupId ?? WHOLE}|${e.day}|${e.slotId}`
    const arr = runs.get(key)
    if (arr) arr.push(e)
    else runs.set(key, [e])
  }

  // Lessons available to claim, by shape. A combined lesson is identified by
  // the whole set of classes it fills, sorted, because the entries of one run
  // arrive in no particular order and its first row is not necessarily the
  // lesson's first member.
  const pool = new Map<string, WireLesson[]>()
  const shapeOf = (classes: string[], subjectId: string, size: number) =>
    `${[...classes].sort().join(',')}|${subjectId}|${size}`
  for (const lesson of payload.lessons) {
    if (lesson.classes.length === 0) continue
    const shape = shapeOf(
      lesson.classes.map((c) => `${c.homeroomId}:${c.token}`),
      lesson.subjectId,
      lesson.size,
    )
    const arr = pool.get(shape)
    if (arr) arr.push(lesson)
    else pool.set(shape, [lesson])
  }

  const hint: Record<string, [number, number]> = {}
  for (const run of runs.values()) {
    const head = run[0]
    // A combined run holds one period per member class, so its length in
    // periods is the number of distinct cells, not the number of rows.
    const cells = new Set(run.map((e) => `${e.day}__${e.slotId}`))
    const size = cells.size
    const classes = [
      ...new Set(run.map((e) => `${e.homeroomId}:${e.groupId ?? WHOLE}`)),
    ]
    const shape = shapeOf(classes, head.subjectId, size)
    const candidates = pool.get(shape)
    const lesson = candidates?.shift()
    if (!lesson) continue // the draft has something the requirements no longer ask for

    const wire = scheduleOf.get(lesson.scheduleKey)
    if (!wire) continue
    const day = wire.days.indexOf(head.day)
    // The run starts at its earliest period.
    let start = Infinity
    for (const e of run) {
      const i = wire.slotIds.indexOf(e.slotId)
      if (i >= 0 && i < start) start = i
    }
    if (day >= 0 && Number.isFinite(start)) hint[lesson.id] = [day, start]
  }
  return hint
}

// ── Reading the answer back ──────────────────────────────────

/** One lesson's position, as the solver service reports it. */
export interface WirePlacement {
  lessonId: string
  day: number
  start: number
  size: number
}

/**
 * The solver's answer as timetable rows.
 *
 * Rooms are assigned here rather than in the model. CP-SAT is given the
 * capacity of each shared facility and guarantees it is never oversubscribed,
 * so which particular lab a lesson lands in is a labelling job — and
 * `buildRoomPlan`/the home-room rule it follows already live on this side.
 * Teaching the Python model about individual rooms would be a second
 * definition of a rule that has one.
 */
export function materialisePlacements(
  payload: SolverPayload,
  placements: WirePlacement[],
  rooms: Room[],
  homeroomIds: string[],
): PlacedEntry[] {
  const lessonById = new Map(payload.lessons.map((l) => [l.id, l]))
  const scheduleOf = new Map(payload.schedules.map((s) => [s.key, s]))
  const plan = buildRoomPlan(rooms, homeroomIds)

  // cellKey -> room ids already taken, for the shared pools.
  const taken = new Map<string, Set<string>>()
  const claim = (key: string, roomId: string) => {
    const set = taken.get(key) ?? new Set<string>()
    set.add(roomId)
    taken.set(key, set)
  }
  const freeOfType = (type: RoomType, keys: string[]): string | null => {
    for (const room of plan.byType.get(type) ?? []) {
      if (!keys.some((k) => taken.get(k)?.has(room.id))) return room.id
    }
    return null
  }

  const out: PlacedEntry[] = []
  let blockSeq = 0

  for (const p of placements) {
    const lesson = lessonById.get(p.lessonId)
    if (!lesson) continue
    const wire = scheduleOf.get(lesson.scheduleKey)
    if (!wire) continue
    const day = wire.days[p.day]
    const slotIds = Array.from({ length: p.size }, (_, i) => wire.slotIds[p.start + i])
    if (!day || slotIds.some((s) => !s)) continue

    const keys = slotIds.map((s) => cellKey(day, s))
    const blockKey = p.size > 1 ? `blk${++blockSeq}` : null

    // A shared facility is booked once for the whole run; an ordinary lesson
    // sits in the class's own room.
    let sharedRoom: string | null = null
    if (lesson.roomType !== 'classroom') {
      sharedRoom = freeOfType(lesson.roomType, keys)
      if (sharedRoom) for (const k of keys) claim(k, sharedRoom)
    }

    slotIds.forEach((slotId, i) => {
      const key = keys[i]
      for (const c of lesson.classes) {
        const groupId = c.token === WHOLE ? null : c.token
        let roomId = sharedRoom
        if (lesson.roomType === 'classroom') {
          const home = plan.homeRoom.get(c.homeroomId) ?? null
          // Only a parallel split group can find the class's own room busy —
          // the other half of the class is in it.
          roomId = home && !taken.get(key)?.has(home) ? home : freeOfType('classroom', [key])
          if (roomId) claim(key, roomId)
        }
        out.push({
          homeroomId: c.homeroomId,
          day,
          slotId,
          subjectId: lesson.subjectId,
          teacherId: lesson.teacherIds[0] ?? null,
          teacherIds: lesson.teacherIds,
          roomId,
          isLocked: lesson.fixedAt !== undefined,
          groupId,
          splitKey: groupId ? `${c.homeroomId}__${day}__${slotId}` : null,
          combinedKey:
            lesson.kind === 'combined' ? `${lesson.sourceId}__${day}__${slotId}` : null,
          blockKey,
        })
      }
    })
  }
  return out
}
