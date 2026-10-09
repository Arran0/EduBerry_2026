// ============================================================
// Timetable generator — a pure, UI-free constraint solver.
//
// Strategy: randomized greedy construction with several restarts
// (keep the best feasible attempt), followed by a bounded local
// search that reduces soft-constraint penalty without ever breaking
// a hard constraint or moving a locked cell.
//
// Hard constraints (never violated):
//   - one lesson per homeroom cell
//   - a teacher / room is never double-booked at the same day+slot
//   - teacher / homeroom / subject time-off (Round 3 constraints,
//     plus the legacy teacher_unavailability list)
//   - a placement uses a room of the required type when such rooms exist
//   - teacher max-periods-in-a-row (Round 3)
//   - max per day / max per week for teacher / subject / homeroom (Round 3)
//   - pinned cells are reserved for the homeroom's class teacher (Round 3)
//   - consecutive-period blocks stay contiguous with no break between (Round 4)
//
// Soft constraints (penalty-scored, minimized):
//   - spread a subject across distinct days (respect max_per_day)
//   - minimize teacher idle gaps within a day
//   - balance a homeroom's daily lesson load
//   - meet min per day / per week targets (Round 3)
//   - fill pinned class-teacher cells (Round 3)
// ============================================================

import type {
  GeneratorInput,
  GeneratorResult,
  GeneratorConflict,
  PlacedEntry,
  PeriodSlot,
  Requirement,
  Room,
  RoomType,
  TeacherUnavailability,
  TimetableConstraint,
  HomeroomLite,
  CombinedClassInput,
  SlotGroup,
  SolverEffort,
  SolveDiagnostics,
  TimetableConfig,
  Weekday,
} from './types'
import { teacherIdsOf } from './types'
import {
  buildConstraintIndex,
  cellKey,
  limitBucketsFor,
  placementTeachers,
  timeOffBlocked,
  effectiveMaxInARow,
  type ConstraintIndex,
  type LimitRule,
  type PinRule,
} from './constraints'

// Every teacher of a lesson-ish object, primary first and de-duped. Round 8
// allows a period to be co-taught, so clash / time-off / limit checks must run
// once per teacher instead of once per period.
const teachersOf = (x: { teacherId: string | null; teacherIds?: string[] }): string[] =>
  placementTeachers({ homeroomId: '', subjectId: '', teacherId: x.teacherId, teacherIds: x.teacherIds })

// ── Utilities ────────────────────────────────────────────────

// Deterministic-with-seed PRNG (mulberry32).
function makeRng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function shuffle<T>(arr: T[], rng: () => number): T[] {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// A contiguous block of `size` periods to place (a requirement of
// periods_per_week = 4 with min_block = 2 → two blocks of size 2).
interface Block {
  requirementId: string
  homeroomId: string
  subjectId: string
  teacherId: string | null
  teacherIds: string[] // every teacher, primary first (co-teaching)
  roomType: RoomType
  size: number
  maxPerDay: number
  groupId: string | null // null = whole class; else a parallel split group
}

// Occupancy token for a homeroom cell: whole-class lessons block the cell,
// group lessons only block their own group (parallel groups coexist).
const WHOLE = '__whole__'
const hrToken = (groupId: string | null | undefined) => groupId ?? WHOLE

// Identifies the LESSON a period belongs to: every period of a block shares
// one id, a single period is its own. Used wherever "how many lessons" is the
// question rather than "how many periods".
const unitIdOf = (p: PlacedEntry) => (p.blockKey ? `blk:${p.blockKey}` : `one:${p.slotId}`)
const subjectDayKey = (p: PlacedEntry) =>
  `${p.homeroomId}|${p.subjectId}|${hrToken(p.groupId)}|${p.day}`

// ── Slot geometry ────────────────────────────────────────────
// Teaching slots in order, plus whether each is position-adjacent to the
// next (no break slot between them) so blocks never straddle a break.
//
// Round 9: a config can run several bell schedules at once (slot groups), so
// geometry is per group and each homeroom is solved against its own week. The
// base schedule — config.working_days plus the slots with group_id null — is
// keyed BASE and used by every homeroom not assigned to a group, which is
// exactly the old single-schedule behaviour when no groups exist.

const BASE = '__base__'
const groupKey = (id: string | null | undefined) => id ?? BASE

export interface SlotGeometry {
  key: string // groupKey
  name: string
  days: Weekday[]
  teachingSlots: PeriodSlot[]
  slotIds: string[]
  slotOrder: Map<string, number> // slotId -> index within this schedule
  adjacentNext: boolean[] // adjacentNext[i] = slot i and i+1 are consecutive periods
}

/**
 * Every schedule in play, plus the cross-schedule bookkeeping that only matters
 * once more than one exists:
 *
 *  - `clock` is a config-wide chronological ordinal per slot. A teacher's
 *    max-in-a-row and idle-gap scoring compare periods across schedules, so
 *    they need one shared number line rather than per-schedule indices.
 *  - `clash` maps a slot to every slot (its own included) that occupies the
 *    same wall-clock time in another schedule. A teacher or room booked in
 *    Primary period 3 is unavailable for an overlapping Secondary period, and
 *    only this map can see that — the two are different slot rows.
 */
export interface Schedules {
  geoms: Map<string, SlotGeometry>
  order: SlotGeometry[] // stable display order
  byHomeroom: Map<string, string> // homeroomId -> groupKey
  /**
   * The schedule a class follows when it has not been put in a period group.
   * Normally the base schedule — but an admin who moves the school's periods
   * into a group leaves the base with none, and a class landing on an empty
   * week places nothing at all. Falling back to the first real schedule keeps
   * a forgotten class on a timetable instead of silently emptying it.
   */
  fallbackKey: string
  clock: Map<string, number> // slotId -> chronological ordinal
  clash: Map<string, string[]> // slotId -> overlapping slotIds, itself first
  multi: boolean // more than one schedule is in play
}

const minutes = (t: string | null): number | null => {
  if (!t) return null
  const m = t.match(/^(\d{1,2}):(\d{2})/)
  return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : null
}

function geometryOf(key: string, name: string, days: Weekday[], slots: PeriodSlot[]): SlotGeometry {
  const teachingSlots = slots.filter((s) => !s.is_break).sort((a, b) => a.position - b.position)
  const slotIds = teachingSlots.map((s) => s.id)
  const slotOrder = new Map(teachingSlots.map((s, i) => [s.id, i]))
  const adjacentNext: boolean[] = []
  for (let i = 0; i < teachingSlots.length - 1; i++) {
    adjacentNext.push(teachingSlots[i + 1].position === teachingSlots[i].position + 1)
  }
  return { key, name, days, teachingSlots, slotIds, slotOrder, adjacentNext }
}

/**
 * Two slots from different schedules collide when their clock times overlap.
 * Schedules built without timings fall back to the period number: "period 3"
 * of one band is assumed to run against "period 3" of another.
 */
function slotsCollide(a: PeriodSlot, b: PeriodSlot): boolean {
  const aStart = minutes(a.start_time)
  const aEnd = minutes(a.end_time)
  const bStart = minutes(b.start_time)
  const bEnd = minutes(b.end_time)
  if (aStart != null && aEnd != null && bStart != null && bEnd != null) {
    return aStart < bEnd && bStart < aEnd
  }
  return a.position === b.position
}

export function buildSchedules(
  config: Pick<TimetableConfig, 'working_days'>,
  slots: PeriodSlot[],
  slotGroups: SlotGroup[] = [],
  homeroomGroupIds: Record<string, string | null> = {},
): Schedules {
  const geoms = new Map<string, SlotGeometry>()
  geoms.set(
    BASE,
    geometryOf(BASE, 'Base schedule', config.working_days, slots.filter((s) => !s.group_id)),
  )
  const groups = [...slotGroups].sort((a, b) => a.position - b.position)
  for (const g of groups) {
    geoms.set(
      g.id,
      geometryOf(
        g.id,
        g.name,
        g.working_days.length > 0 ? g.working_days : config.working_days,
        slots.filter((s) => s.group_id === g.id),
      ),
    )
  }

  // Where an unassigned class goes: the base schedule when it has periods,
  // otherwise the first group that does.
  const baseHasSlots = (geoms.get(BASE)?.teachingSlots.length ?? 0) > 0
  const fallbackKey = baseHasSlots
    ? BASE
    : groups.find((g) => (geoms.get(g.id)?.teachingSlots.length ?? 0) > 0)?.id ?? BASE

  const byHomeroom = new Map<string, string>()
  for (const [hr, gid] of Object.entries(homeroomGroupIds)) {
    const key = groupKey(gid)
    byHomeroom.set(hr, geoms.has(key) ? key : fallbackKey)
  }

  // A schedule with no teaching slots can't hold anything, so it is dropped
  // from the display order — but kept in `geoms` so a homeroom pointed at it
  // still resolves (to an empty week) instead of silently falling back to base.
  const order = [geoms.get(BASE)!, ...groups.map((g) => geoms.get(g.id)!)].filter(
    (g) => g.teachingSlots.length > 0,
  )

  const all = [...geoms.values()].flatMap((g) => g.teachingSlots)
  const positionIn = new Map<string, number>()
  for (const g of geoms.values()) g.teachingSlots.forEach((s, i) => positionIn.set(s.id, i))
  const sorted = [...all].sort((a, b) => {
    const am = minutes(a.start_time)
    const bm = minutes(b.start_time)
    if (am != null && bm != null && am !== bm) return am - bm
    return (positionIn.get(a.id) ?? 0) - (positionIn.get(b.id) ?? 0)
  })
  const clock = new Map<string, number>()
  sorted.forEach((s, i) => clock.set(s.id, i))

  const clash = new Map<string, string[]>()
  const multi = order.length > 1
  for (const s of all) {
    if (!multi) {
      clash.set(s.id, [s.id])
      continue
    }
    const hits = [s.id]
    for (const o of all) {
      if (o.id === s.id || o.group_id === s.group_id) continue
      if (slotsCollide(s, o)) hits.push(o.id)
    }
    clash.set(s.id, hits)
  }

  return { geoms, order, byHomeroom, fallbackKey, clock, clash, multi }
}

/** The schedule a homeroom is solved against. */
export const scheduleFor = (sched: Schedules, homeroomId: string): SlotGeometry =>
  sched.geoms.get(sched.byHomeroom.get(homeroomId) ?? sched.fallbackKey) ??
  sched.geoms.get(BASE)!

/** Every cell key a booking at day+slot occupies, overlapping bands included. */
function busyKeys(sched: Schedules, day: Weekday, slotId: string): string[] {
  const ids = sched.clash.get(slotId)
  if (!ids || ids.length === 1) return [cellKey(day, slotId)]
  return ids.map((id) => cellKey(day, id))
}

// ── Rooms ────────────────────────────────────────────────────
/**
 * Where lessons physically sit.
 *
 * A school is not a pool of interchangeable rooms. A class owns a room and the
 * teachers come to it; only special facilities — labs, computer rooms — are a
 * shared resource that classes queue for. That is how every real timetabler
 * (Untis, aSc, FET) models it, and scheduling ordinary lessons out of one
 * global classroom pool instead is actively destructive: a school that entered
 * 6 rooms for 34 classes can then place only 6 lessons in any period, so two
 * thirds of its week cannot be built at all, and the lessons that do land get
 * scattered across the week looking for a free room.
 *
 * So:
 *   - every class is given its own classroom for the whole week, and an
 *     ordinary whole-class lesson always goes there. A class can only be in one
 *     lesson at a time, so its room is never contended — two classes having
 *     maths in the same period is not a conflict, and nothing here treats it as
 *     one;
 *   - a class with no classroom on record gets none. Rooms the admin never
 *     entered must not cost lessons;
 *   - special room types keep the exclusive shared pool with full clash
 *     checking. A lab really is scarce, and refusing a lesson when every lab is
 *     busy is the right answer;
 *   - parallel split groups cannot all sit in the class's room, so the groups
 *     beyond the first take any other free classroom, and none if there is none.
 */
export interface RoomPlan {
  byType: Map<RoomType, Room[]>
  classrooms: Room[]
  homeRoom: Map<string, string | null> // homeroomId -> the room it owns
}

/**
 * Hands each class its own classroom. `homeroomIds` is sorted so the same
 * school always gets the same assignment, run to run — a class that keeps
 * changing rooms between generations is unusable to the people reading it.
 */
export function buildRoomPlan(rooms: Room[], homeroomIds: string[]): RoomPlan {
  const byType = new Map<RoomType, Room[]>()
  for (const r of rooms) {
    if (!byType.has(r.room_type)) byType.set(r.room_type, [])
    byType.get(r.room_type)!.push(r)
  }
  const classrooms = byType.get('classroom') ?? []
  const homeRoom = new Map<string, string | null>()
  const ordered = [...new Set(homeroomIds)].sort()
  ordered.forEach((id, i) => homeRoom.set(id, classrooms[i]?.id ?? null))
  return { byType, classrooms, homeRoom }
}

// ── Solver working state ─────────────────────────────────────

class SolveState {
  // homeroomId -> cellKey -> set of occupancy tokens (WHOLE or groupId)
  homeroomBusy = new Map<string, Map<string, Set<string>>>()
  teacherBusy = new Map<string, Set<string>>() // teacherId -> cellKeys
  roomUsedAt = new Map<string, Set<string>>() // cellKey -> roomIds
  subjectDay = new Map<string, number>() // `${hr}|${subj}|${group}|${day}` -> count
  dayLoad = new Map<string, number>() // `${hr}|${day}` -> count
  teacherDaySlots = new Map<string, Set<number>>() // `${teacher}|${day}` -> slot indices
  limitCounts = new Map<string, number>() // `${ruleIdx}|${bucket}` -> count
  // `${hr}|${subj}|${group}|${day}` -> the distinct LESSONS there. A double is
  // one lesson in two periods, so spread scoring counts this, not subjectDay.
  // Kept as a set so a lesson's periods add and remove idempotently.
  subjectDayUnits = new Map<string, Set<string>>()
  // `${homeroom}__${day}__${slot}` -> the teachers in that cell, for pin checks.
  cellTeachers = new Map<string, Set<string>>()
  // Reference counts behind the two sets above. A set entry is only really
  // gone once the last placement holding it leaves, and counting is what makes
  // that an O(1) check instead of a scan of every placement in the school.
  private cellTeacherRefs = new Map<string, number>()
  private subjectUnitRefs = new Map<string, number>()
  placements: PlacedEntry[] = []
  // Where each placement sits in `placements`, so removing one is O(1).
  private placementAt = new Map<PlacedEntry, number>()
  blockSeq = 0 // names each multi-period block it places

  // Can a lesson with this token occupy the homeroom cell? Whole-class lessons
  // need an empty cell; a group coexists with other (different) groups only.
  homeroomFree(homeroomId: string, key: string, token: string): boolean {
    const tokens = this.homeroomBusy.get(homeroomId)?.get(key)
    if (!tokens || tokens.size === 0) return true
    if (token === WHOLE || tokens.has(WHOLE)) return false
    return !tokens.has(token)
  }

  occupyCell(p: PlacedEntry, slotIdx: number, limits: LimitRule[]) {
    const key = cellKey(p.day, p.slotId)
    if (!this.homeroomBusy.has(p.homeroomId)) this.homeroomBusy.set(p.homeroomId, new Map())
    const cellMap = this.homeroomBusy.get(p.homeroomId)!
    if (!cellMap.has(key)) cellMap.set(key, new Set())
    cellMap.get(key)!.add(hrToken(p.groupId))
    for (const t of teachersOf(p)) {
      if (!this.teacherBusy.has(t)) this.teacherBusy.set(t, new Set())
      this.teacherBusy.get(t)!.add(key)
      const tk = `${t}|${p.day}`
      if (!this.teacherDaySlots.has(tk)) this.teacherDaySlots.set(tk, new Set())
      this.teacherDaySlots.get(tk)!.add(slotIdx)
    }
    if (p.roomId) {
      if (!this.roomUsedAt.has(key)) this.roomUsedAt.set(key, new Set())
      this.roomUsedAt.get(key)!.add(p.roomId)
    }
    const sk = subjectDayKey(p)
    this.subjectDay.set(sk, (this.subjectDay.get(sk) ?? 0) + 1)
    this.addSubjectUnit(sk, unitIdOf(p))
    this.dayLoad.set(`${p.homeroomId}|${p.day}`, (this.dayLoad.get(`${p.homeroomId}|${p.day}`) ?? 0) + 1)
    // Every rule is counted, not just the max ones: the hard check below only
    // reads max, but min shortfalls are scored on every candidate move and a
    // live count turns that from a scan into a lookup.
    for (let r = 0; r < limits.length; r++) {
      for (const bucket of limitBucketsFor(limits[r], p, p.day)) {
        const bk = `${r}|${bucket}`
        this.limitCounts.set(bk, (this.limitCounts.get(bk) ?? 0) + 1)
      }
    }
    // Who is teaching this class in this cell — what a class-teacher pin asks.
    this.addCellTeachers(`${p.homeroomId}__${key}`, teachersOf(p))
    this.push(p)
  }

  private push(p: PlacedEntry) {
    this.placementAt.set(p, this.placements.length)
    this.placements.push(p)
  }

  /** Swap-removes in O(1); order is not meaningful, only membership. */
  private drop(p: PlacedEntry) {
    const i = this.placementAt.get(p)
    if (i === undefined) return
    const last = this.placements[this.placements.length - 1]
    this.placements[i] = last
    this.placementAt.set(last, i)
    this.placements.pop()
    this.placementAt.delete(p)
  }

  private addCellTeachers(ck: string, teachers: string[]) {
    if (!this.cellTeachers.has(ck)) this.cellTeachers.set(ck, new Set())
    const set = this.cellTeachers.get(ck)!
    for (const t of teachers) {
      const rk = `${ck}|${t}`
      this.cellTeacherRefs.set(rk, (this.cellTeacherRefs.get(rk) ?? 0) + 1)
      set.add(t)
    }
  }

  private removeCellTeachers(ck: string, teachers: string[]) {
    const set = this.cellTeachers.get(ck)
    if (!set) return
    for (const t of teachers) {
      const rk = `${ck}|${t}`
      const n = (this.cellTeacherRefs.get(rk) ?? 0) - 1
      if (n > 0) this.cellTeacherRefs.set(rk, n)
      else {
        this.cellTeacherRefs.delete(rk)
        set.delete(t)
      }
    }
  }

  removeCell(p: PlacedEntry, slotIdx: number, limits: LimitRule[]) {
    this.drop(p)
    const key = cellKey(p.day, p.slotId)
    this.homeroomBusy.get(p.homeroomId)?.get(key)?.delete(hrToken(p.groupId))
    for (const t of teachersOf(p)) {
      this.teacherBusy.get(t)?.delete(key)
      this.teacherDaySlots.get(`${t}|${p.day}`)?.delete(slotIdx)
    }
    if (p.roomId) this.roomUsedAt.get(key)?.delete(p.roomId)
    const sk = subjectDayKey(p)
    this.subjectDay.set(sk, Math.max(0, (this.subjectDay.get(sk) ?? 0) - 1))
    // A block's other periods keep the lesson present, so the id only leaves
    // the bucket once none of its periods are on that day any more.
    this.removeSubjectUnit(sk, unitIdOf(p))
    const dk = `${p.homeroomId}|${p.day}`
    this.dayLoad.set(dk, Math.max(0, (this.dayLoad.get(dk) ?? 0) - 1))
    for (let r = 0; r < limits.length; r++) {
      for (const bucket of limitBucketsFor(limits[r], p, p.day)) {
        const bk = `${r}|${bucket}`
        this.limitCounts.set(bk, Math.max(0, (this.limitCounts.get(bk) ?? 0) - 1))
      }
    }
    this.removeCellTeachers(`${p.homeroomId}__${key}`, teachersOf(p))
  }

  private addSubjectUnit(sk: string, unit: string) {
    if (!this.subjectDayUnits.has(sk)) this.subjectDayUnits.set(sk, new Set())
    const rk = `${sk}|${unit}`
    this.subjectUnitRefs.set(rk, (this.subjectUnitRefs.get(rk) ?? 0) + 1)
    this.subjectDayUnits.get(sk)!.add(unit)
  }

  private removeSubjectUnit(sk: string, unit: string) {
    const rk = `${sk}|${unit}`
    const n = (this.subjectUnitRefs.get(rk) ?? 0) - 1
    if (n > 0) this.subjectUnitRefs.set(rk, n)
    else {
      this.subjectUnitRefs.delete(rk)
      this.subjectDayUnits.get(sk)?.delete(unit)
    }
  }

  /**
   * Occupies a combined lesson across `slotIds` (one period, or the run of a
   * double/triple) on one day: the teacher and room are used ONCE per period,
   * but every member homeroom's cell is filled. Returns the entries.
   */
  occupyCombined(
    unit: CombinedUnit,
    day: Weekday,
    slotIds: string[],
    clockIdx: number[],
    roomId: string | null,
  ): PlacedEntry[] {
    const made: PlacedEntry[] = []
    // Every period of a multi-period combined lesson shares one block key, so
    // it moves and pins as a unit like any other block.
    const blockKey = slotIds.length > 1 ? `blk${++this.blockSeq}` : null
    slotIds.forEach((slotId, i) => {
      const key = cellKey(day, slotId)
      const combinedKey = `${unit.combinedId}__${day}__${slotId}`
      for (const m of unit.members) {
        const hr = m.homeroomId
        const token = hrToken(m.groupId)
        const p: PlacedEntry = {
          homeroomId: hr, day, slotId, subjectId: unit.subjectId,
          teacherId: unit.teacherId, teacherIds: unit.teacherIds,
          roomId, isLocked: false,
          groupId: m.groupId, splitKey: null, combinedKey, blockKey,
        }
        if (!this.homeroomBusy.has(hr)) this.homeroomBusy.set(hr, new Map())
        const cm = this.homeroomBusy.get(hr)!
        if (!cm.has(key)) cm.set(key, new Set())
        cm.get(key)!.add(token)
        const sk = `${hr}|${unit.subjectId}|${token}|${day}`
        this.subjectDay.set(sk, (this.subjectDay.get(sk) ?? 0) + 1)
        this.addSubjectUnit(sk, unitIdOf(p))
        this.dayLoad.set(`${hr}|${day}`, (this.dayLoad.get(`${hr}|${day}`) ?? 0) + 1)
        this.push(p)
        made.push(p)
      }
      for (const t of teachersOf(unit)) {
        if (!this.teacherBusy.has(t)) this.teacherBusy.set(t, new Set())
        this.teacherBusy.get(t)!.add(key)
        const tk = `${t}|${day}`
        if (!this.teacherDaySlots.has(tk)) this.teacherDaySlots.set(tk, new Set())
        this.teacherDaySlots.get(tk)!.add(clockIdx[i])
        for (const m of unit.members) this.addCellTeachers(`${m.homeroomId}__${key}`, [t])
      }
      if (roomId) {
        if (!this.roomUsedAt.has(key)) this.roomUsedAt.set(key, new Set())
        this.roomUsedAt.get(key)!.add(roomId)
      }
    })
    return made
  }
}

// One occurrence of a combined class to place. A combined lesson is expanded
// the same way an ordinary requirement is (Round 10): periods_per_week becomes
// N units of `size` contiguous periods, so an assembly can be a double.
interface CombinedUnit {
  combinedId: string
  subjectId: string
  teacherId: string | null
  teacherIds: string[]
  // A pinned room, if the lesson must be somewhere specific; otherwise the
  // solver finds a free room of `roomType`.
  roomId: string | null
  roomType: RoomType
  size: number
  maxPerDay: number
  members: { homeroomId: string; groupId: string | null }[]
}

// ── Construction ─────────────────────────────────────────────

interface BuildArgs {
  sched: Schedules
  blocks: Block[]
  combined: CombinedUnit[]
  locked: PlacedEntry[]
  index: ConstraintIndex
  rooms: RoomPlan
  rng: () => number
  /** Lets the repair phase stop mid-way instead of overrunning the budget. */
  outOfTime?: () => boolean
}

function rank(b: Block): number {
  let r = 0
  if (b.roomType !== 'classroom') r += 5
  // Each extra teacher is one more calendar to dodge, so co-taught blocks are
  // harder to place and go earlier.
  r += teachersOf(b).length * 2
  r += (b.size - 1) * 3 // larger blocks are harder to place — do them first
  return r
}

// Longest run of consecutive integers in a set (used for max-in-a-row).
function longestRun(indices: Set<number>): number {
  let best = 0
  for (const i of indices) {
    if (indices.has(i - 1)) continue // not a run start
    let len = 1
    while (indices.has(i + len)) len++
    if (len > best) best = len
  }
  return best
}

// `keys` are the cell keys a booking would occupy — the block's own periods
// plus, when several bell schedules overlap, the colliding periods of the other
// bands, so one room isn't handed to two schedules running at the same hour.
function pickRoom(
  plan: RoomPlan,
  roomUsedAt: Map<string, Set<string>>,
  homeroomId: string,
  type: RoomType,
  keys: string[],
): { ok: boolean; roomId: string | null } {
  const free = (id: string) => !keys.some((k) => roomUsedAt.get(k)?.has(id))

  if (type === 'classroom') {
    const home = plan.homeRoom.get(homeroomId) ?? null
    if (home) {
      if (free(home)) return { ok: true, roomId: home }
      // Only a parallel split group can find the class's own room taken — the
      // other half of the class is in it. Any free classroom will do.
      for (const room of plan.classrooms) if (free(room.id)) return { ok: true, roomId: room.id }
    }
    // No classroom on record for this class, or every one of them busy. An
    // unentered room is missing data, not a missing room: schedule the lesson
    // without one rather than throw the lesson away.
    return { ok: true, roomId: null }
  }

  const list = plan.byType.get(type) ?? []
  if (list.length === 0) return { ok: true, roomId: null } // school doesn't track this room type
  for (const room of list) if (free(room.id)) return { ok: true, roomId: room.id }
  return { ok: false, roomId: null }
}

// Attempts to score a block placement on `day` starting at teaching-slot
// index `start`. Returns the room + penalty, or null if any hard constraint
// blocks it. Does not mutate state.
function scoreBlock(
  state: SolveState,
  block: Block,
  day: Weekday,
  start: number,
  args: BuildArgs,
  relaxMaxPerDay: boolean,
): { roomId: string | null; penalty: number } | null {
  const { sched, index, rooms, rng } = args
  const geo = scheduleFor(sched, block.homeroomId)
  const size = block.size
  if (start + size > geo.slotIds.length) return null
  // Contiguous with no break between.
  for (let j = start; j < start + size - 1; j++) {
    if (!geo.adjacentNext[j]) return null
  }

  const keys: string[] = [] // the block's own cells
  const bookKeys: string[] = [] // those plus the cells they collide with
  const token = hrToken(block.groupId)
  const blockTeachers = teachersOf(block)
  const busySets = blockTeachers.map((t) => state.teacherBusy.get(t))

  for (let j = start; j < start + size; j++) {
    const slotId = geo.slotIds[j]
    const key = cellKey(day, slotId)
    keys.push(key)
    const booked = busyKeys(sched, day, slotId)
    bookKeys.push(...booked)
    if (!state.homeroomFree(block.homeroomId, key, token)) return null
    // Every teacher of a co-taught lesson has to be free and not timed off.
    // "Free" spans every schedule: a teacher in an overlapping period of
    // another band is just as unavailable as one in this band.
    if (busySets.some((set) => set && booked.some((k) => set.has(k)))) return null
    if (blockTeachers.length === 0) {
      if (timeOffBlocked(index.teacherTimeOff, null, key)) return null
    } else if (blockTeachers.some((t) => timeOffBlocked(index.teacherTimeOff, t, key))) {
      return null
    }
    if (timeOffBlocked(index.homeroomTimeOff, block.homeroomId, key)) return null
    if (timeOffBlocked(index.subjectTimeOff, block.subjectId, key)) return null
    // Pinned cells are reserved for the homeroom's class teacher — who only has
    // to be one of the lesson's teachers, not its only one.
    for (const pin of index.pins) {
      if (pin.homeroomId !== block.homeroomId || pin.key !== key) continue
      const satisfied = pin.classTeacherId
        ? blockTeachers.includes(pin.classTeacherId)
        : blockTeachers.length === 0
      if (!satisfied) return null
    }
  }

  // Subject-per-day cap (the requirement's own max_per_day, soft/relaxable).
  const sdc = state.subjectDay.get(`${block.homeroomId}|${block.subjectId}|${token}|${day}`) ?? 0
  if (!relaxMaxPerDay && sdc + size > block.maxPerDay) return null

  // Round-3 max limits (hard).
  for (let r = 0; r < index.limits.length; r++) {
    const rule = index.limits[r]
    if (rule.kind !== 'max') continue
    for (const bucket of limitBucketsFor(rule, block, day)) {
      const current = state.limitCounts.get(`${r}|${bucket}`) ?? 0
      if (current + size > rule.value) return null
    }
  }

  // Max-in-a-row (hard) — checked for every teacher of the lesson, on the
  // config-wide clock so consecutive periods count even across bell schedules.
  for (const t of blockTeachers) {
    const maxRow = effectiveMaxInARow(index, t)
    if (maxRow == null) continue
    const union = new Set(state.teacherDaySlots.get(`${t}|${day}`) ?? [])
    for (let j = start; j < start + size; j++) union.add(sched.clock.get(geo.slotIds[j]) ?? j)
    if (longestRun(union) > maxRow) return null
  }

  const room = pickRoom(rooms, state.roomUsedAt, block.homeroomId, block.roomType, bookKeys)
  if (!room.ok) return null

  const dl = state.dayLoad.get(`${block.homeroomId}|${day}`) ?? 0
  const penalty = sdc * 6 + dl * 1 + (relaxMaxPerDay && sdc + size > block.maxPerDay ? 100 : 0) + rng() * 0.5

  return { roomId: room.roomId, penalty }
}

function placeBlock(state: SolveState, block: Block, args: BuildArgs, relax: boolean): boolean {
  const geo = scheduleFor(args.sched, block.homeroomId)
  let best: { day: Weekday; start: number; roomId: string | null; penalty: number } | null = null

  for (const day of geo.days) {
    for (let start = 0; start + block.size <= geo.slotIds.length; start++) {
      const scored = scoreBlock(state, block, day, start, args, relax)
      if (!scored) continue
      if (!best || scored.penalty < best.penalty) {
        best = { day, start, roomId: scored.roomId, penalty: scored.penalty }
      }
    }
  }

  if (!best) return false
  occupyBlockAt(state, block, best.day, best.start, best.roomId, args)
  return true
}

/** Books a block into a known-good cell run and returns the rows it made. */
function occupyBlockAt(
  state: SolveState,
  block: Block,
  day: Weekday,
  start: number,
  roomId: string | null,
  args: BuildArgs,
): PlacedEntry[] {
  const { sched, index } = args
  const geo = scheduleFor(sched, block.homeroomId)
  // A double/triple is several rows that mean one lesson. They all carry the
  // same block key so the local search below, the grids, and a later reload
  // can tell the block apart from two unrelated periods of the same subject —
  // without it, anything that moves one period silently breaks the block.
  const blockKey = block.size > 1 ? `blk${++state.blockSeq}` : null
  const made: PlacedEntry[] = []
  for (let j = start; j < start + block.size; j++) {
    const slotId = geo.slotIds[j]
    const p: PlacedEntry = {
      homeroomId: block.homeroomId,
      day,
      slotId,
      subjectId: block.subjectId,
      teacherId: block.teacherId,
      teacherIds: block.teacherIds,
      roomId,
      isLocked: false,
      groupId: block.groupId,
      // Parallel group lessons in one cell share a split key.
      splitKey: block.groupId ? `${block.homeroomId}__${day}__${slotId}` : null,
      blockKey,
    }
    state.occupyCell(p, sched.clock.get(slotId) ?? j, index.limits)
    made.push(p)
  }
  return made
}

/**
 * The lesson a run of placed periods represents, as something placeBlock can
 * re-place. The per-day cap is deliberately infinite: it was honoured when the
 * lesson was first built, and the spread penalty — not a hard refusal — is what
 * keeps a move from stacking a subject onto one day.
 */
function blockFromUnit(unit: PlacedEntry[], roomsByType: Map<RoomType, Room[]>): Block {
  return {
    requirementId: '',
    homeroomId: unit[0].homeroomId,
    subjectId: unit[0].subjectId,
    teacherId: unit[0].teacherId,
    teacherIds: teachersOf(unit[0]),
    roomType: roomTypeOf(unit[0], roomsByType),
    size: unit.length,
    maxPerDay: Number.POSITIVE_INFINITY,
    groupId: unit[0].groupId ?? null,
  }
}

/** A lesson the repair phase is allowed to push out of the way. */
const isEvictable = (p: PlacedEntry) => !p.isLocked && !p.groupId && !p.combinedKey

/**
 * Ejection repair — the phase that actually gets the last periods placed.
 *
 * Construction is greedy: each lesson takes the best cell free at the moment
 * it is dealt with, and a lesson dealt with late can find every cell it is
 * allowed to use already taken. Nothing afterwards used to rescue it. The
 * local search below only shuffles lessons that are already placed to tidy the
 * week, so whatever construction dropped stayed dropped for the whole run, and
 * the only hope of a complete timetable was a restart that happened to deal
 * the lessons in a luckier order. On a school whose week is 55% full and
 * comfortably feasible that still left two or three periods unplaced on every
 * single run — which is not a timetable anyone can use.
 *
 * So: for a period with nowhere to go, find the cells where the ONLY thing in
 * the way is another lesson that could itself sit somewhere else, move that
 * lesson out, and take its place. Cheapest first — the fewest lessons
 * displaced — and the whole exchange is rolled back unless every displaced
 * lesson finds a new home, so a repair can never make the week worse than it
 * was. This is the standard ejection move from the timetabling literature, and
 * it is what separates a greedy pass from a solver.
 */
function repairUnplaced(state: SolveState, unplaced: Block[], args: BuildArgs): Block[] {
  if (unplaced.length === 0) return unplaced
  const { sched, index, rooms, rng, outOfTime } = args

  /** cellKey -> the periods sitting in it, across every class. */
  let atCell = new Map<string, PlacedEntry[]>()
  const reindex = () => {
    atCell = new Map()
    for (const p of state.placements) push(atCell, cellKey(p.day, p.slotId), p)
  }
  reindex()

  // Every period of a block has to move with it, so a blocker is a whole run.
  const unitOf = (p: PlacedEntry): PlacedEntry[] =>
    p.blockKey ? state.placements.filter((q) => q.blockKey === p.blockKey) : [p]

  /** How many periods per lesson we are willing to displace to seat one. */
  const MAX_EVICTIONS = 3
  /** Candidate cells tried per unplaced lesson, cheapest first. */
  const MAX_CANDIDATES = 24

  const stillUnplaced: Block[] = []

  for (const block of unplaced) {
    if (outOfTime?.()) {
      stillUnplaced.push(block)
      continue
    }
    const geo = scheduleFor(sched, block.homeroomId)
    const token = hrToken(block.groupId)
    const mine = new Set(teachersOf(block))

    // Which lessons stand between this one and each cell run it could occupy.
    const candidates: { day: Weekday; start: number; evict: PlacedEntry[][] }[] = []
    for (const day of geo.days) {
      position: for (let start = 0; start + block.size <= geo.slotIds.length; start++) {
        for (let j = start; j < start + block.size - 1; j++) {
          if (!geo.adjacentNext[j]) continue position // a break splits the run
        }
        const evict = new Map<PlacedEntry[], true>()
        const byKey = new Map<string, PlacedEntry[]>() // de-dupes a block hit twice
        for (let j = start; j < start + block.size; j++) {
          const slotId = geo.slotIds[j]
          const here = cellKey(day, slotId)
          for (const k of busyKeys(sched, day, slotId)) {
            for (const p of atCell.get(k) ?? []) {
              // Two ways a placed period stands in the way: it holds this
              // class's cell, or it has one of this lesson's teachers in a
              // period that overlaps.
              const takesMyCell =
                p.homeroomId === block.homeroomId &&
                cellKey(p.day, p.slotId) === here &&
                !state.homeroomFree(block.homeroomId, here, token)
              const takesMyTeacher = teachersOf(p).some((t) => mine.has(t))
              if (!takesMyCell && !takesMyTeacher) continue
              // A pinned lesson, a split group or a combined lesson is not
              // ours to move, so this cell run is simply not available.
              if (!isEvictable(p)) continue position
              const id = p.blockKey ?? `${p.homeroomId}__${cellKey(p.day, p.slotId)}`
              if (byKey.has(id)) continue
              const unit = unitOf(p)
              byKey.set(id, unit)
              evict.set(unit, true)
            }
          }
        }
        // Nothing in the way means construction already tried and refused this
        // cell on a rule no amount of moving can change.
        const units = [...evict.keys()]
        if (units.length === 0) continue
        if (units.reduce((n, u) => n + u.length, 0) > MAX_EVICTIONS) continue
        candidates.push({ day, start, evict: units })
      }
    }

    // Fewest periods displaced first; ties broken randomly so restarts of the
    // same deadlock try different exchanges.
    const cost = (c: { evict: PlacedEntry[][] }) => c.evict.reduce((n, u) => n + u.length, 0)
    const shuffled = shuffle(candidates, rng).sort((a, b) => cost(a) - cost(b))

    let seated = false
    for (const cand of shuffled.slice(0, MAX_CANDIDATES)) {
      const seqBefore = state.blockSeq
      const clockOf = (p: PlacedEntry) => sched.clock.get(p.slotId) ?? 0
      const lift = (unit: PlacedEntry[]) => {
        for (const p of unit) state.removeCell(p, clockOf(p), index.limits)
      }
      const restore = (unit: PlacedEntry[]) => {
        for (const p of unit) state.occupyCell(p, clockOf(p), index.limits)
      }

      for (const unit of cand.evict) lift(unit)

      // With the blockers gone, scoreBlock is the arbiter: time off, pins,
      // max-per-day, the round-3 limits, max-in-a-row and rooms are all its
      // business, and re-deriving any of them here would only drift from it.
      const fit = scoreBlock(state, block, cand.day, cand.start, args, true)
      if (!fit) {
        for (const unit of cand.evict) restore(unit)
        state.blockSeq = seqBefore
        continue
      }

      const seatedRows = occupyBlockAt(state, block, cand.day, cand.start, fit.roomId, args)
      // Each displaced lesson now has to find a home of its own. Rooms it used
      // are free again, and the cell it came from is taken by the lesson we
      // just seated, so this is a genuine re-placement.
      const rehomed: PlacedEntry[][] = []
      let allRehomed = true
      for (const unit of cand.evict) {
        const at = state.placements.length
        if (!placeBlock(state, blockFromUnit(unit, rooms.byType), args, true)) {
          allRehomed = false
          break
        }
        rehomed.push(state.placements.slice(at))
      }

      if (allRehomed) {
        seated = true
        reindex()
        break
      }

      // Put everything back exactly as it was.
      for (const unit of rehomed) lift(unit)
      lift(seatedRows)
      for (const unit of cand.evict) restore(unit)
      state.blockSeq = seqBefore
    }

    if (!seated) stillUnplaced.push(block)
  }

  return stillUnplaced
}

function buildOnce(args: BuildArgs): { state: SolveState; unplaced: Block[]; unplacedCombined: CombinedUnit[] } {
  const { blocks, locked, sched, index } = args
  const state = new SolveState()
  for (const l of locked) {
    state.occupyCell(l, sched.clock.get(l.slotId) ?? 0, index.limits)
  }
  // Pinned blocks already carry keys from an earlier solve; keep the counter
  // past them so a fresh block never reuses one.
  for (const l of locked) {
    const n = l.blockKey?.match(/^blk(\d+)$/)
    if (n) state.blockSeq = Math.max(state.blockSeq, parseInt(n[1], 10))
  }

  // Combined classes are the most constrained (they occupy many homerooms at
  // once), so place them first.
  const unplacedCombined: CombinedUnit[] = []
  for (const unit of args.combined) {
    if (!placeCombinedUnit(state, unit, args)) unplacedCombined.push(unit)
  }

  const unplaced: Block[] = []
  const ordered = shuffle(blocks, args.rng).sort((a, b) => rank(b) - rank(a))

  for (const block of ordered) {
    if (!placeBlock(state, block, args, false)) {
      if (!placeBlock(state, block, args, true)) unplaced.push(block)
    }
  }
  // Greedy placement is done; now go back for the lessons it had nowhere to
  // put. Repairing inside the attempt rather than only on the winner is what
  // makes the restart comparison honest — attempts are chosen on their
  // unplaced count, and an unrepaired count is not the count that matters.
  return { state, unplaced: repairUnplaced(state, unplaced, args), unplacedCombined }
}

/**
 * Scores a combined unit starting at `start` on `day`, over its `size`
 * periods. Null if any hard rule blocks it. Returns the room to use, which is
 * the pinned one when the lesson has one and otherwise a free room of the
 * right type for the whole run.
 */
function scoreCombined(
  state: SolveState, unit: CombinedUnit, day: Weekday, start: number, args: BuildArgs,
): { roomId: string | null; penalty: number } | null {
  const { sched, index, rooms } = args
  const geo = combinedSchedule(sched, unit)
  if (!geo) return null
  const size = unit.size
  if (start + size > geo.slotIds.length) return null
  // A block has to be contiguous with no break slot inside it.
  for (let j = start; j < start + size - 1; j++) {
    if (!geo.adjacentNext[j]) return null
  }

  const unitTeachers = teachersOf(unit)
  const bookKeys: string[] = []

  for (let j = start; j < start + size; j++) {
    const slotId = geo.slotIds[j]
    const key = cellKey(day, slotId)
    const booked = busyKeys(sched, day, slotId)
    bookKeys.push(...booked)
    for (const t of unitTeachers) {
      const busy = state.teacherBusy.get(t)
      if (busy && booked.some((k) => busy.has(k))) return null
      if (timeOffBlocked(index.teacherTimeOff, t, key)) return null
    }
    if (unitTeachers.length === 0 && timeOffBlocked(index.teacherTimeOff, null, key)) return null
    if (timeOffBlocked(index.subjectTimeOff, unit.subjectId, key)) return null
    if (unit.roomId && booked.some((k) => state.roomUsedAt.get(k)?.has(unit.roomId!))) return null
    for (const m of unit.members) {
      if (!state.homeroomFree(m.homeroomId, key, hrToken(m.groupId))) return null
      if (timeOffBlocked(index.homeroomTimeOff, m.homeroomId, key)) return null
    }
  }

  // Daily cap, counted on the member class that already has the most of this
  // subject today — one class over the cap is enough to refuse the placement.
  let sdc = 0
  for (const m of unit.members) {
    const n = state.subjectDay.get(`${m.homeroomId}|${unit.subjectId}|${hrToken(m.groupId)}|${day}`) ?? 0
    if (n > sdc) sdc = n
  }
  if (sdc + size > unit.maxPerDay) return null

  // Max-in-a-row (hard), on the config-wide clock.
  for (const t of unitTeachers) {
    const maxRow = effectiveMaxInARow(index, t)
    if (maxRow == null) continue
    const union = new Set(state.teacherDaySlots.get(`${t}|${day}`) ?? [])
    for (let j = start; j < start + size; j++) union.add(sched.clock.get(geo.slotIds[j]) ?? j)
    if (longestRun(union) > maxRow) return null
  }

  // A pinned room was already checked above; otherwise find one of the type the
  // lesson asks for that is free across every period of the run.
  let roomId = unit.roomId
  if (!roomId) {
    // A combined lesson fills many classes at once, so "the class's own room"
    // means the first member's — the one place every member is free by the time
    // the lesson is booked.
    const picked = pickRoom(
      rooms, state.roomUsedAt, unit.members[0]?.homeroomId ?? '', unit.roomType, bookKeys,
    )
    if (!picked.ok) return null
    roomId = picked.roomId
  }

  let penalty = sdc * 6
  for (const m of unit.members) penalty += state.dayLoad.get(`${m.homeroomId}|${day}`) ?? 0
  return { roomId, penalty: penalty + args.rng() * 0.5 }
}

/**
 * The one schedule a combined lesson can run in. Its member classes all sit in
 * the same period, so they have to share a bell schedule — a lesson spanning
 * two bands has no common slot and is reported unplaceable rather than
 * silently scheduled against one band's clock.
 */
function combinedSchedule(sched: Schedules, unit: CombinedUnit): SlotGeometry | null {
  let geo: SlotGeometry | null = null
  for (const m of unit.members) {
    const g = scheduleFor(sched, m.homeroomId)
    if (!geo) geo = g
    else if (g.key !== geo.key) return null
  }
  return geo
}

function placeCombinedUnit(state: SolveState, unit: CombinedUnit, args: BuildArgs): boolean {
  const geo = combinedSchedule(args.sched, unit)
  if (!geo) return false
  let best: { day: Weekday; start: number; roomId: string | null; penalty: number } | null = null
  for (const day of geo.days) {
    for (let start = 0; start + unit.size <= geo.slotIds.length; start++) {
      const scored = scoreCombined(state, unit, day, start, args)
      if (!scored) continue
      if (!best || scored.penalty < best.penalty) {
        best = { day, start, roomId: scored.roomId, penalty: scored.penalty }
      }
    }
  }
  if (!best) return false
  const slotIds = geo.slotIds.slice(best.start, best.start + unit.size)
  const clocks = slotIds.map((id, i) => args.sched.clock.get(id) ?? best!.start + i)
  state.occupyCombined(unit, best.day, slotIds, clocks, best.roomId)
  return true
}

// ── Soft-penalty scoring (global) ────────────────────────────

function softPenalty(
  placements: PlacedEntry[],
  sched: Schedules,
  index: ConstraintIndex,
): number {
  let penalty = 0

  // "Spread a subject across the week" counts LESSONS, not periods: a double
  // period is one lesson sitting in two slots, so charging it the repeat
  // penalty would make splitting every block look like an improvement — which
  // is precisely what the local search used to do to them.
  const subjDay = new Map<string, number>()
  const hrDay = new Map<string, number>()
  const countedUnits = new Set<string>()
  for (const p of placements) {
    const dayKey = `${p.homeroomId}|${p.subjectId}|${p.day}`
    const unit = p.blockKey ? `blk:${p.blockKey}` : `one:${p.slotId}|${p.groupId ?? ''}`
    if (!countedUnits.has(`${dayKey}|${unit}`)) {
      countedUnits.add(`${dayKey}|${unit}`)
      subjDay.set(dayKey, (subjDay.get(dayKey) ?? 0) + 1)
    }
    hrDay.set(`${p.homeroomId}|${p.day}`, (hrDay.get(`${p.homeroomId}|${p.day}`) ?? 0) + 1)
  }
  for (const count of subjDay.values()) if (count > 1) penalty += (count - 1) * 6

  const hrTotals = new Map<string, number[]>()
  for (const [k, v] of hrDay) {
    const hr = k.split('|')[0]
    if (!hrTotals.has(hr)) hrTotals.set(hr, [])
    hrTotals.get(hr)!.push(v)
  }
  for (const [hr, loads] of hrTotals) {
    // Each class is levelled against the length of ITS OWN week — bands can
    // run a different number of days.
    const dayCount = Math.max(1, scheduleFor(sched, hr).days.length)
    const avg = loads.reduce((a, b) => a + b, 0) / dayCount
    for (const l of loads) penalty += Math.abs(l - avg)
  }

  const teacherDaySlots = new Map<string, Set<number>>()
  for (const p of placements) {
    for (const t of teachersOf(p)) {
      const k = `${t}|${p.day}`
      if (!teacherDaySlots.has(k)) teacherDaySlots.set(k, new Set())
      teacherDaySlots.get(k)!.add(sched.clock.get(p.slotId) ?? 0)
    }
  }
  for (const set of teacherDaySlots.values()) {
    const idxs = [...set].sort((a, b) => a - b)
    const span = idxs[idxs.length - 1] - idxs[0] + 1
    penalty += (span - idxs.length) * 3
  }

  penalty += minTargetShortfall(placements, index)
  penalty += unfilledPins(placements, index) * 8

  return penalty
}

// Sum of unmet min-per-day / min-per-week targets (soft).
function minTargetShortfall(placements: PlacedEntry[], index: ConstraintIndex): number {
  let penalty = 0
  for (let r = 0; r < index.limits.length; r++) {
    const rule = index.limits[r]
    if (rule.kind !== 'min') continue
    const buckets = new Map<string, number>()
    for (const p of placements) {
      for (const key of limitBucketsFor(rule, p, p.day)) {
        buckets.set(key, (buckets.get(key) ?? 0) + 1)
      }
    }
    if (rule.period === 'week') {
      for (const count of buckets.values()) if (count < rule.value) penalty += (rule.value - count) * 4
    } else {
      // Per-day min: only score days the entity actually teaches (avoids
      // penalising every empty weekday for a once-a-week subject).
      for (const count of buckets.values()) if (count < rule.value) penalty += (rule.value - count) * 4
    }
  }
  return penalty
}

// `homeroom__day__slot__teacher` for every (co-)teacher actually in a cell —
// the lookup a class-teacher pin is checked against.
function pinFillSet(placements: PlacedEntry[]): Set<string> {
  const filled = new Set<string>()
  for (const p of placements) {
    for (const t of teachersOf(p)) filled.add(`${p.homeroomId}__${p.day}__${p.slotId}__${t}`)
  }
  return filled
}

function unfilledPins(placements: PlacedEntry[], index: ConstraintIndex): number {
  if (index.pins.length === 0) return 0
  const filled = pinFillSet(placements)
  let n = 0
  for (const pin of index.pins) {
    const [day, slotId] = pin.key.split('__')
    const want = `${pin.homeroomId}__${day}__${slotId}__${pin.classTeacherId}`
    if (!pin.classTeacherId || !filled.has(want)) n++
  }
  return n
}

// ── Scoped penalty (what one move can change) ────────────────
//
// softPenalty() rebuilds every term over every placement. Running that once
// per candidate move is what forced the old move cap: at 2000 classes-worth of
// periods a single pass is ~O(n), so a few thousand moves was all the budget
// allowed, which came to under two attempts per lesson.
//
// A move only ever touches one homeroom, that lesson's teachers, and two days.
// Scoring just those terms before and after gives the SAME accept/reject
// decision as a full rescan, at a cost that doesn't grow with the school.

interface PenaltyCtx {
  sched: Schedules
  index: ConstraintIndex
  // Periods per homeroom and the days in its week — both constant while the
  // local search runs, because a move never changes how much a class is taught.
  hrTotal: Map<string, number>
  hrWeek: Map<string, Weekday[]>
  // Pins grouped by the class they belong to; most configs have none at all.
  pinsByHomeroom: Map<string, PinRule[]>
  minRules: { idx: number; rule: LimitRule }[]
}

function makePenaltyCtx(state: SolveState, sched: Schedules, index: ConstraintIndex): PenaltyCtx {
  const hrTotal = new Map<string, number>()
  for (const p of state.placements) hrTotal.set(p.homeroomId, (hrTotal.get(p.homeroomId) ?? 0) + 1)
  const hrWeek = new Map<string, Weekday[]>()
  for (const hr of hrTotal.keys()) hrWeek.set(hr, scheduleFor(sched, hr).days)
  const pinsByHomeroom = new Map<string, PinRule[]>()
  for (const pin of index.pins) {
    const arr = pinsByHomeroom.get(pin.homeroomId)
    if (arr) arr.push(pin)
    else pinsByHomeroom.set(pin.homeroomId, [pin])
  }
  const minRules = index.limits
    .map((rule, idx) => ({ idx, rule }))
    .filter(({ rule }) => rule.kind === 'min')
  return { sched, index, hrTotal, hrWeek, pinsByHomeroom, minRules }
}

/**
 * The slice of the soft penalty that one class's week contributes, for a lesson
 * of this subject taught by these teachers.
 *
 * Mirrors softPenalty() term for term over that slice. A move relocates a
 * lesson within a single class's week, so everything outside the slice is
 * identical before and after and cancels out of the comparison — the
 * accept/reject decision is the same one a full rescan would make. The cost is
 * bounded by days in a week and teachers on a lesson, not by the size of the
 * school, which is what the old move cap was really protecting against.
 */
function scopedPenalty(
  state: SolveState,
  ctx: PenaltyCtx,
  homeroomId: string,
  subjectId: string,
  groupId: string | null,
  teachers: string[],
): number {
  let penalty = 0
  const token = hrToken(groupId)
  const days = ctx.hrWeek.get(homeroomId) ?? []

  // Same subject more than once in a day — counted in LESSONS, so a double
  // costs what one lesson costs.
  for (const day of days) {
    const n = state.subjectDayUnits.get(`${homeroomId}|${subjectId}|${token}|${day}`)?.size ?? 0
    if (n > 1) penalty += (n - 1) * 6
  }

  // The class's daily load against its own weekly average. The average holds
  // still during the search, so only the days the lesson moved between differ.
  const avg = (ctx.hrTotal.get(homeroomId) ?? 0) / Math.max(1, days.length)
  for (const day of days) {
    penalty += Math.abs((state.dayLoad.get(`${homeroomId}|${day}`) ?? 0) - avg)
  }

  // Idle gaps in each teacher's day. A teacher may also teach other classes,
  // but only the days of THIS class's week can have changed.
  for (const t of teachers) {
    for (const day of days) {
      const set = state.teacherDaySlots.get(`${t}|${day}`)
      if (!set || set.size === 0) continue
      let lo = Infinity
      let hi = -Infinity
      for (const i of set) {
        if (i < lo) lo = i
        if (i > hi) hi = i
      }
      penalty += (hi - lo + 1 - set.size) * 3
    }
  }

  // Unmet minimum targets, read off the live bucket counts.
  if (ctx.minRules.length > 0) {
    const probe = {
      homeroomId, subjectId,
      teacherId: teachers[0] ?? null, teacherIds: teachers,
    }
    const seen = new Set<string>()
    for (const { idx, rule } of ctx.minRules) {
      for (const day of rule.period === 'day' ? days : [days[0]]) {
        for (const bucket of limitBucketsFor(rule, probe, day)) {
          const bk = `${idx}|${bucket}`
          if (seen.has(bk)) continue
          seen.add(bk)
          const count = state.limitCounts.get(bk) ?? 0
          if (count < rule.value) penalty += (rule.value - count) * 4
        }
      }
    }
  }

  // Class-teacher pins on this class.
  const pins = ctx.pinsByHomeroom.get(homeroomId)
  if (pins) {
    for (const pin of pins) {
      const filled =
        !!pin.classTeacherId &&
        (state.cellTeachers.get(`${homeroomId}__${pin.key}`)?.has(pin.classTeacherId) ?? false)
      if (!filled) penalty += 8
    }
  }

  return penalty
}

// ── Bounded local search ─────────────────────────────────────
// Two neighbourhoods, which is what the school-timetabling literature settles
// on as the minimum that actually improves a timetable:
//
//   RELOCATE — lift one lesson and re-place it in the best free cell.
//   SWAP     — exchange the cells of two lessons.
//
// Relocation alone stalls almost immediately on a full week: once the good
// cells are taken, the only improving move for a badly-placed lesson is to
// trade with whatever is sitting in the cell it wants, and relocation can never
// make that trade. Swapping is what lets the search keep going.
//
// A double or triple period is ONE lesson here: it is lifted and re-placed
// whole, never picked apart period by period.

function localSearch(
  state: SolveState,
  args: BuildArgs,
  iterations: number,
  // Stops early when this says so — used to hold the solve to a time budget
  // without having to guess an iteration count up front.
  shouldStop?: () => boolean,
): number {
  const { sched, index } = args
  const ctx = makePenaltyCtx(state, sched, index)
  let done = 0

  // Only move plain whole-class lessons. Split-group lessons and
  // combined-class lessons are structurally tied to their cell and must not be
  // moved independently (that would drop their split/combined key).
  const isMovable = (p: PlacedEntry) => !p.isLocked && !p.groupId && !p.combinedKey

  // One move candidate: a single period, or every period of one block.
  const units = (): PlacedEntry[][] => {
    const blocks = new Map<string, PlacedEntry[]>()
    const out: PlacedEntry[][] = []
    for (const p of state.placements) {
      if (!isMovable(p)) continue
      if (!p.blockKey) {
        out.push([p])
        continue
      }
      const arr = blocks.get(p.blockKey)
      if (arr) arr.push(p)
      else blocks.set(p.blockKey, [p])
    }
    // A block whose periods were somehow scattered is not a block any more —
    // leave it alone rather than re-placing it as a contiguous run elsewhere.
    for (const arr of blocks.values()) if (arr.length > 1) out.push(arr)
    return out
  }

  const clockOf = (p: PlacedEntry) => sched.clock.get(p.slotId) ?? 0
  const restore = (unit: PlacedEntry[]) => {
    for (const p of unit) state.occupyCell(p, clockOf(p), index.limits)
  }
  const lift = (unit: PlacedEntry[]) => {
    for (const p of unit) state.removeCell(p, clockOf(p), index.limits)
  }

  const blockOf = (unit: PlacedEntry[]) => blockFromUnit(unit, args.rooms.byType)

  /**
   * The penalty of everything the given lessons can change, counted once per
   * distinct class/subject/teacher slice. A swap touches two lessons that may
   * share a class or a teacher, and adding two overlapping slices would weight
   * the shared terms double and distort the comparison.
   */
  const scopeOf = (heads: PlacedEntry[]): number => {
    const seen = new Set<string>()
    let total = 0
    for (const h of heads) {
      const group = h.groupId ?? null
      const key = `${h.homeroomId}|${h.subjectId}|${group}`
      if (seen.has(key)) continue
      seen.add(key)
      total += scopedPenalty(state, ctx, h.homeroomId, h.subjectId, group, teachersOf(h))
    }
    return total
  }

  // Where a unit currently sits, as a day plus a start index into its own
  // schedule — the address a swap hands to the other lesson.
  const addressOf = (unit: PlacedEntry[]) => {
    const geo = scheduleFor(sched, unit[0].homeroomId)
    let start = Infinity
    for (const p of unit) {
      const i = geo.slotOrder.get(p.slotId)
      if (i !== undefined && i < start) start = i
    }
    return { geo, day: unit[0].day, start }
  }

  // The movable pool only changes when a move is accepted, so it is built once
  // and patched rather than rescanned for every iteration.
  const pool = units()

  /** Relocates one lesson to the best cell it can reach. */
  const relocate = (unit: PlacedEntry[]): boolean => {
    const before = scopeOf([unit[0]])
    const seqBefore = state.blockSeq
    lift(unit)
    const countBefore = state.placements.length
    if (!placeBlock(state, blockOf(unit), args, true)) {
      restore(unit)
      state.blockSeq = seqBefore
      return false
    }
    const moved = state.placements.slice(countBefore)
    if (scopeOf([moved[0]]) > before) {
      lift(moved)
      state.blockSeq = seqBefore
      restore(unit)
      return false
    }
    const i = pool.indexOf(unit)
    if (i >= 0) pool[i] = moved
    return true
  }

  /**
   * Exchanges the cells of two lessons. Only equal-length lessons trade, so
   * each one lands in exactly the run the other vacated and a double never
   * decays into two singles. Both destinations are checked against every hard
   * constraint — with the pair already lifted, so each lesson is free to take
   * the cell the other just left.
   */
  const swap = (a: PlacedEntry[], b: PlacedEntry[]): boolean => {
    if (a === b || a.length !== b.length) return false
    if (a[0].homeroomId === b[0].homeroomId && a[0].subjectId === b[0].subjectId) return false
    const addrA = addressOf(a)
    const addrB = addressOf(b)
    if (addrA.start === Infinity || addrB.start === Infinity) return false
    // A lesson can only take a day and a period that exist in its own week —
    // two classes on different bell schedules have neither in common.
    if (!addrA.geo.days.includes(addrB.day) || !addrB.geo.days.includes(addrA.day)) return false
    if (addrB.start + a.length > addrA.geo.slotIds.length) return false
    if (addrA.start + b.length > addrB.geo.slotIds.length) return false

    const before = scopeOf([a[0], b[0]])
    const seqBefore = state.blockSeq
    lift(a)
    lift(b)

    const blockA = blockOf(a)
    const blockB = blockOf(b)
    const fitA = scoreBlock(state, blockA, addrB.day, addrB.start, args, true)
    const fitB = fitA ? scoreBlock(state, blockB, addrA.day, addrA.start, args, true) : null
    if (!fitA || !fitB) {
      restore(a)
      restore(b)
      state.blockSeq = seqBefore
      return false
    }

    const newA = occupyBlockAt(state, blockA, addrB.day, addrB.start, fitA.roomId, args)
    const newB = occupyBlockAt(state, blockB, addrA.day, addrA.start, fitB.roomId, args)
    if (scopeOf([newA[0], newB[0]]) > before) {
      lift(newA)
      lift(newB)
      state.blockSeq = seqBefore
      restore(a)
      restore(b)
      return false
    }
    const ia = pool.indexOf(a)
    if (ia >= 0) pool[ia] = newA
    const ib = pool.indexOf(b)
    if (ib >= 0) pool[ib] = newB
    return true
  }

  for (let it = 0; it < iterations; it++) {
    if (pool.length === 0) break
    // Reading the clock every iteration would cost more than a move does; a
    // sample every 256 holds a budget measured in seconds closely enough.
    if (shouldStop && (it & 255) === 0 && it > 0 && shouldStop()) break
    done++

    const unit = pool[Math.floor(args.rng() * pool.length)]
    // Relocation is the cheaper move and finds the easy wins, so it stays the
    // common case; swapping is what breaks the deadlock once they run out.
    if (pool.length > 1 && args.rng() < 0.35) {
      swap(unit, pool[Math.floor(args.rng() * pool.length)])
    } else {
      relocate(unit)
    }
  }
  return done
}

function roomTypeOf(p: PlacedEntry, roomsByType: Map<RoomType, Room[]>): RoomType {
  if (!p.roomId) return 'classroom'
  for (const [type, rooms] of roomsByType) if (rooms.some((r) => r.id === p.roomId)) return type
  return 'classroom'
}

// ── Public API ───────────────────────────────────────────────

/**
 * Default effort, scaled to the size of the problem.
 *
 * Restarts are the expensive, high-value phase — they are what decides whether
 * every lesson gets placed at all — so they get most of the budget. Moves are
 * cheap now that each one is scored against only the class it touches, so the
 * ceiling is generous and the clock is what actually stops it.
 */
function resolveEffort(effort: SolverEffort | undefined, periods: number): Required<SolverEffort> {
  return {
    budgetMs: effort?.budgetMs ?? 4000,
    maxRestarts: effort?.maxRestarts ?? 24,
    minRestarts: effort?.minRestarts ?? 4,
    maxMoves: effort?.maxMoves ?? Math.max(20_000, periods * 400),
  }
}

export function generateTimetable(input: GeneratorInput, effort?: SolverEffort): GeneratorResult {
  const sched = buildSchedules(
    input.config,
    input.slots,
    input.slotGroups ?? [],
    input.homeroomGroupIds ?? {},
  )

  const index = buildConstraintIndex(input.constraints ?? [], input.homerooms ?? [])
  mergeLegacyUnavailability(index, input.unavailability)

  const locked = (input.locked ?? []).map((p) => ({ ...p, isLocked: true }))
  const blocks = expandBlocks(input.requirements, locked)
  const combined = expandCombined(input.combined ?? [], locked)

  // Every class the solve touches, so each one can be handed its own room.
  const rooms = buildRoomPlan(input.rooms, [
    ...(input.homerooms ?? []).map((h) => h.id),
    ...input.requirements.map((r) => r.homeroom_id),
    ...combined.flatMap((u) => u.members.map((m) => m.homeroomId)),
    ...locked.map((l) => l.homeroomId),
  ])

  const periods =
    blocks.reduce((n, b) => n + b.size, 0) + combined.reduce((n, u) => n + u.size, 0)
  const limits = resolveEffort(effort, periods)
  const startedAt = Date.now()
  const outOfTime = () => Date.now() - startedAt >= limits.budgetMs

  const anyWeek = sched.order.some((g) => g.slotIds.length > 0 && g.days.length > 0)
  if (!anyWeek) {
    return {
      entries: locked,
      conflicts: [{ kind: 'unplaced_lesson', message: 'No teaching periods or working days are configured.' }],
      unplacedCount: blocks.reduce((n, b) => n + b.size, 0),
      softPenalty: 0,
      ok: false,
      diagnostics: {
        restarts: 0, restartCeiling: limits.maxRestarts,
        moves: 0, moveCeiling: limits.maxMoves,
        elapsedMs: Date.now() - startedAt, hitBudget: false,
      },
    }
  }

  const baseSeed = input.seed ?? 12345
  let best: { state: SolveState; unplaced: Block[]; unplacedCombined: CombinedUnit[] } | null = null
  let bestUnplaced = Infinity
  let bestPenalty = Infinity

  const totalUnplaced = (a: { unplaced: Block[]; unplacedCombined: CombinedUnit[] }) =>
    a.unplaced.reduce((n, b) => n + b.size, 0) +
    a.unplacedCombined.reduce((n, u) => n + u.size, 0)

  // Construction: keep the best of several randomized attempts. It gets at
  // most 60% of the budget, so there is always time left to tidy the winner.
  const buildDeadline = startedAt + limits.budgetMs * 0.6
  let restarts = 0
  for (let r = 0; r < limits.maxRestarts; r++) {
    const rng = makeRng(baseSeed + r * 7919)
    const args: BuildArgs = { sched, blocks, combined, locked, index, rooms, rng, outOfTime }
    const attempt = buildOnce(args)
    restarts++
    const un = totalUnplaced(attempt)
    // The winner's penalty is cached rather than recomputed per comparison.
    const pen = un <= bestUnplaced ? softPenalty(attempt.state.placements, sched, index) : Infinity
    if (!best || un < bestUnplaced || (un === bestUnplaced && pen < bestPenalty)) {
      best = attempt
      bestUnplaced = un
      bestPenalty = pen
    }
    // The clock may end construction, but never before it has had its floor of
    // attempts: a school slow enough to blow the deadline on its first attempt
    // is exactly the one that needs several.
    if (restarts >= limits.minRestarts && r + 1 < limits.maxRestarts && Date.now() >= buildDeadline) break
  }

  const finalState = best!.state
  const lsRng = makeRng(baseSeed + 104729)
  const moves = localSearch(
    finalState,
    { sched, blocks, combined, locked, index, rooms, rng: lsRng, outOfTime },
    limits.maxMoves,
    outOfTime,
  )
  const elapsedMs = Date.now() - startedAt
  const diagnostics: SolveDiagnostics = {
    restarts,
    restartCeiling: limits.maxRestarts,
    moves,
    moveCeiling: limits.maxMoves,
    elapsedMs,
    // Capped by the clock rather than by finishing: one of the two phases
    // stopped short of what it was allowed to do.
    hitBudget: (restarts < limits.maxRestarts || moves < limits.maxMoves) && outOfTime(),
  }

  const conflicts = detectConflicts(
    finalState.placements, input.unavailability, input.constraints, input.homerooms, sched.clash,
  )
  let unplacedCount = 0
  for (const b of best!.unplaced) {
    unplacedCount += b.size
    conflicts.push({
      kind: b.size > 1 ? 'block_unplaceable' : 'unplaced_lesson',
      message:
        b.size > 1
          ? `Could not fit a ${b.size}-period block — try adding contiguous slots or reducing the block size.`
          : 'Could not fit a required period — try adding slots/days or relaxing constraints.',
      homeroomId: b.homeroomId,
      subjectId: b.subjectId,
      teacherId: b.teacherId ?? undefined,
    })
  }
  for (const u of best!.unplacedCombined) {
    unplacedCount += u.size
    conflicts.push({
      kind: u.size > 1 ? 'block_unplaceable' : 'unplaced_lesson',
      message: !combinedSchedule(sched, u)
        ? 'Its classes follow different period groups, so this combined lesson has no period they all share. Put them in one period group, or split the lesson.'
        : u.size > 1
          ? `Could not fit a ${u.size}-period combined block — no day had ${u.size} back-to-back periods that every member class, the teacher and the room were free for and allowed to use. Time off for the subject or any member class counts: see the health panel for which.`
          : 'Could not fit a combined-class period — every period was either taken or marked time off for a member class, the teacher or the subject.',
      subjectId: u.subjectId,
      teacherId: u.teacherId ?? undefined,
    })
  }
  // Report unfilled class-teacher pins (soft).
  for (const pin of pinsUnfilledList(finalState.placements, index)) {
    conflicts.push({
      kind: 'pin_unfilled',
      message: 'A pinned class-teacher period could not be filled by the class teacher.',
      homeroomId: pin.homeroomId,
    })
  }

  const hardKinds = new Set<GeneratorConflict['kind']>([
    'teacher_double_booked', 'room_double_booked', 'homeroom_double_booked',
    'no_room_available', 'time_off_violated', 'max_in_a_row_exceeded',
  ])

  return {
    entries: finalState.placements,
    conflicts,
    unplacedCount,
    diagnostics,
    softPenalty: softPenalty(finalState.placements, sched, index),
    ok: unplacedCount === 0 && !conflicts.some((c) => hardKinds.has(c.kind)),
  }
}

function mergeLegacyUnavailability(index: ConstraintIndex, unavail: TeacherUnavailability[]): void {
  for (const u of unavail) {
    if (!index.teacherTimeOff.has(u.teacher_id)) index.teacherTimeOff.set(u.teacher_id, new Set())
    index.teacherTimeOff.get(u.teacher_id)!.add(cellKey(u.day, u.slot_id))
  }
}

// Expands requirements into contiguous blocks, subtracting periods already
// satisfied by locked placements (same homeroom + subject).
function expandBlocks(requirements: Requirement[], locked: PlacedEntry[]): Block[] {
  const lockedCount = new Map<string, number>()
  for (const p of locked) {
    const k = `${p.homeroomId}|${p.subjectId}|${hrToken(p.groupId)}`
    lockedCount.set(k, (lockedCount.get(k) ?? 0) + 1)
  }
  const blocks: Block[] = []
  for (const req of requirements) {
    const k = `${req.homeroom_id}|${req.subject_id}|${hrToken(req.group_id)}`
    let remaining = req.periods_per_week - (lockedCount.get(k) ?? 0)
    if (remaining <= 0) continue
    const minB = Math.max(1, req.min_block ?? 1)
    const maxB = Math.max(minB, req.max_block ?? 1)
    const sizes: number[] = []
    while (remaining >= minB) {
      const size = Math.min(maxB, remaining)
      sizes.push(size)
      remaining -= size
    }
    if (remaining > 0) sizes.push(remaining) // leftover shorter than minB
    for (const size of sizes) {
      blocks.push({
        requirementId: req.id,
        homeroomId: req.homeroom_id,
        subjectId: req.subject_id,
        teacherId: req.teacher_id,
        teacherIds: teacherIdsOf(req),
        roomType: req.room_type,
        size,
        maxPerDay: req.max_per_day,
        groupId: req.group_id ?? null,
      })
    }
  }
  return blocks
}

/**
 * Expands combined classes into units to place, subtracting periods already
 * satisfied by locked entries (counted by distinct combined_key per class).
 *
 * periods_per_week is split into contiguous blocks exactly as `expandBlocks`
 * does for ordinary requirements, so min_block = max_block = 2 schedules the
 * lesson as doubles. The default 1/1 produces one unit per period, which is
 * what combined lessons did before Round 10.
 */
function expandCombined(list: CombinedClassInput[], locked: PlacedEntry[]): CombinedUnit[] {
  const lockedKeys = new Map<string, Set<string>>() // combinedId -> set of combinedKeys
  for (const p of locked) {
    if (!p.combinedKey) continue
    const combinedId = p.combinedKey.split('__')[0]
    if (!lockedKeys.has(combinedId)) lockedKeys.set(combinedId, new Set())
    lockedKeys.get(combinedId)!.add(p.combinedKey)
  }
  const units: CombinedUnit[] = []
  for (const c of list) {
    if (c.members.length === 0 || !c.subjectId) continue
    const done = lockedKeys.get(c.id)?.size ?? 0
    let remaining = c.periodsPerWeek - done
    if (remaining <= 0) continue

    const minB = Math.max(1, c.minBlock ?? 1)
    const maxB = Math.max(minB, c.maxBlock ?? 1)
    const sizes: number[] = []
    while (remaining >= minB) {
      const size = Math.min(maxB, remaining)
      sizes.push(size)
      remaining -= size
    }
    if (remaining > 0) sizes.push(remaining) // leftover shorter than minB

    for (const size of sizes) {
      units.push({
        combinedId: c.id,
        subjectId: c.subjectId,
        teacherId: c.teacherId,
        teacherIds: teacherIdsOf({ teacherId: c.teacherId, teacherIds: c.teacherIds }),
        roomId: c.roomId,
        roomType: c.roomType ?? 'classroom',
        size,
        maxPerDay: Math.max(1, c.maxPerDay ?? 1),
        members: c.members,
      })
    }
  }
  return units
}

function pinsUnfilledList(placements: PlacedEntry[], index: ConstraintIndex): { homeroomId: string }[] {
  if (index.pins.length === 0) return []
  const filled = pinFillSet(placements)
  const out: { homeroomId: string }[] = []
  for (const pin of index.pins) {
    const [day, slotId] = pin.key.split('__')
    const want = `${pin.homeroomId}__${day}__${slotId}__${pin.classTeacherId}`
    if (!pin.classTeacherId || !filled.has(want)) out.push({ homeroomId: pin.homeroomId })
  }
  return out
}

// ── Conflict detection (used live by the editable grid) ──────

function push<T>(map: Map<string, T[]>, key: string, value: T) {
  if (!map.has(key)) map.set(key, [])
  map.get(key)!.push(value)
}

/**
 * One stable id per wall-clock period across every bell schedule. Slots that
 * overlap in time all resolve to the same id (the smallest of the group), so
 * a teacher double-booked across two bands collides on a plain map lookup.
 * With one schedule, or no clash map, a slot is its own canonical id.
 */
function canonicalSlot(clash: Map<string, string[]> | undefined, slotId: string): string {
  const ids = clash?.get(slotId)
  if (!ids || ids.length <= 1) return slotId
  let min = slotId
  for (const id of ids) if (id < min) min = id
  return min
}

// How many independent lessons occupy a teacher/room at one cell. Entries that
// share a combined_key are one combined lesson, so they collapse to a single unit.
function occupancyCount(list: PlacedEntry[]): number {
  const combined = new Set<string>()
  let solo = 0
  for (const e of list) {
    if (e.combinedKey) combined.add(e.combinedKey)
    else solo++
  }
  return combined.size + solo
}

export function detectConflicts(
  entries: PlacedEntry[],
  unavailability: TeacherUnavailability[],
  constraints: TimetableConstraint[] = [],
  homerooms: HomeroomLite[] = [],
  // Round 9: slotId -> the slots of other bell schedules it overlaps in time.
  // Without it, two bands running at the same hour look like different cells
  // and a teacher booked in both reads as free. Omit it for a single schedule.
  slotClash?: Map<string, string[]>,
): GeneratorConflict[] {
  const conflicts: GeneratorConflict[] = []
  const teacherAt = new Map<string, PlacedEntry[]>()
  const roomAt = new Map<string, PlacedEntry[]>()
  const homeroomAt = new Map<string, PlacedEntry[]>()
  // Everything that shares a wall-clock slot is filed under one canonical key,
  // so an overlap across bands lands in the same bucket as a plain clash.
  const timeKey = (day: Weekday, slotId: string) => cellKey(day, canonicalSlot(slotClash, slotId))

  for (const e of entries) {
    const key = timeKey(e.day, e.slotId)
    // A co-taught period books every one of its teachers at that cell.
    for (const t of teachersOf(e)) push(teacherAt, `${t}|${key}`, e)
    if (e.roomId) push(roomAt, `${e.roomId}|${key}`, e)
    push(homeroomAt, `${e.homeroomId}|${cellKey(e.day, e.slotId)}`, e)
  }

  for (const [k, list] of teacherAt) {
    // Combined-class entries share one combined_key and count as one lesson.
    if (occupancyCount(list) > 1) {
      const e = list[0]
      conflicts.push({
        kind: 'teacher_double_booked',
        message: 'Teacher is booked for more than one class at the same time.',
        teacherId: k.split('|')[0],
        day: e.day,
        slotId: e.slotId,
      })
    }
  }
  for (const [, list] of roomAt) {
    if (occupancyCount(list) > 1) {
      const e = list[0]
      conflicts.push({
        kind: 'room_double_booked',
        message: 'A room is assigned to more than one class at the same time.',
        day: e.day,
        slotId: e.slotId,
        homeroomId: e.homeroomId,
      })
    }
  }
  for (const [, list] of homeroomAt) {
    if (list.length <= 1) continue
    // Parallel split groups may share a cell; only flag a real overlap
    // (two whole-class lessons, a whole-class over a group, or the same
    // group twice).
    const tokens = list.map((e) => e.groupId ?? '__whole__')
    const hasWhole = tokens.includes('__whole__')
    const dupGroup = new Set(tokens).size !== tokens.length
    if (hasWhole || dupGroup) {
      const e = list[0]
      conflicts.push({
        kind: 'homeroom_double_booked',
        message: 'A class has more than one lesson in the same period.',
        homeroomId: e.homeroomId,
        day: e.day,
        slotId: e.slotId,
      })
    }
  }

  const index = buildConstraintIndex(constraints, homerooms)
  mergeLegacyUnavailability(index, unavailability)

  for (const e of entries) {
    const key = cellKey(e.day, e.slotId)
    for (const t of teachersOf(e)) {
      if (!timeOffBlocked(index.teacherTimeOff, t, key)) continue
      conflicts.push({
        kind: 'time_off_violated',
        message: 'Teacher is scheduled during a period they marked unavailable.',
        teacherId: t, day: e.day, slotId: e.slotId,
      })
    }
    if (timeOffBlocked(index.homeroomTimeOff, e.homeroomId, key)) {
      conflicts.push({
        kind: 'time_off_violated',
        message: 'Class has a lesson during its time-off period.',
        homeroomId: e.homeroomId, day: e.day, slotId: e.slotId,
      })
    }
    if (e.subjectId && timeOffBlocked(index.subjectTimeOff, e.subjectId, key)) {
      conflicts.push({
        kind: 'time_off_violated',
        message: 'Subject is scheduled during its time-off period.',
        subjectId: e.subjectId, day: e.day, slotId: e.slotId,
      })
    }
    for (const pin of index.pins) {
      if (
        pin.homeroomId === e.homeroomId && pin.key === key && pin.classTeacherId &&
        !teachersOf(e).includes(pin.classTeacherId)
      ) {
        conflicts.push({
          kind: 'time_off_violated',
          message: 'A pinned period is filled by someone other than the class teacher.',
          homeroomId: e.homeroomId, day: e.day, slotId: e.slotId,
        })
      }
    }
  }

  // Note: max-in-a-row is enforced precisely by the generator during
  // construction. The live path lacks slot ordering, so it is not re-flagged
  // here to avoid false positives.

  return conflicts
}

// Set of cell keys (homeroom__day__slot) involved in a hard conflict — used by
// the editable grid to highlight problem cells.
export function conflictCellKeys(
  entries: PlacedEntry[],
  unavailability: TeacherUnavailability[],
  constraints: TimetableConstraint[] = [],
  homerooms: HomeroomLite[] = [],
  slotClash?: Map<string, string[]>,
): Set<string> {
  const keys = new Set<string>()
  const teacherAt = new Map<string, PlacedEntry[]>()
  const roomAt = new Map<string, PlacedEntry[]>()
  for (const e of entries) {
    const k = cellKey(e.day, canonicalSlot(slotClash, e.slotId))
    for (const t of teachersOf(e)) push(teacherAt, `${t}|${k}`, e)
    if (e.roomId) push(roomAt, `${e.roomId}|${k}`, e)
  }
  const mark = (e: PlacedEntry) => keys.add(`${e.homeroomId}__${e.day}__${e.slotId}`)
  for (const list of teacherAt.values()) if (occupancyCount(list) > 1) list.forEach(mark)
  for (const list of roomAt.values()) if (occupancyCount(list) > 1) list.forEach(mark)

  const index = buildConstraintIndex(constraints, homerooms)
  mergeLegacyUnavailability(index, unavailability)
  for (const e of entries) {
    const key = cellKey(e.day, e.slotId)
    const eTeachers = teachersOf(e)
    if (eTeachers.some((t) => timeOffBlocked(index.teacherTimeOff, t, key))) mark(e)
    else if (timeOffBlocked(index.homeroomTimeOff, e.homeroomId, key)) mark(e)
    else if (e.subjectId && timeOffBlocked(index.subjectTimeOff, e.subjectId, key)) mark(e)
    else {
      for (const pin of index.pins) {
        if (
          pin.homeroomId === e.homeroomId && pin.key === key && pin.classTeacherId &&
          !eTeachers.includes(pin.classTeacherId)
        ) {
          mark(e)
          break
        }
      }
    }
  }
  return keys
}
