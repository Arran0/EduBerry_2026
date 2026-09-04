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

// ── Slot geometry ────────────────────────────────────────────
// Teaching slots in order, plus whether each is position-adjacent to the
// next (no break slot between them) so blocks never straddle a break.

interface SlotGeometry {
  teachingSlots: PeriodSlot[]
  slotIds: string[]
  slotOrder: Map<string, number> // slotId -> index in teachingSlots
  adjacentNext: boolean[] // adjacentNext[i] = slot i and i+1 are consecutive periods
}

function slotGeometry(all: PeriodSlot[]): SlotGeometry {
  const teachingSlots = all.filter((s) => !s.is_break)
  const slotIds = teachingSlots.map((s) => s.id)
  const slotOrder = new Map(teachingSlots.map((s, i) => [s.id, i]))
  const adjacentNext: boolean[] = []
  for (let i = 0; i < teachingSlots.length - 1; i++) {
    adjacentNext.push(teachingSlots[i + 1].position === teachingSlots[i].position + 1)
  }
  return { teachingSlots, slotIds, slotOrder, adjacentNext }
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
  placements: PlacedEntry[] = []

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
    const sk = `${p.homeroomId}|${p.subjectId}|${hrToken(p.groupId)}|${p.day}`
    this.subjectDay.set(sk, (this.subjectDay.get(sk) ?? 0) + 1)
    this.dayLoad.set(`${p.homeroomId}|${p.day}`, (this.dayLoad.get(`${p.homeroomId}|${p.day}`) ?? 0) + 1)
    for (let r = 0; r < limits.length; r++) {
      const rule = limits[r]
      if (rule.kind !== 'max') continue
      for (const bucket of limitBucketsFor(rule, p, p.day)) {
        const bk = `${r}|${bucket}`
        this.limitCounts.set(bk, (this.limitCounts.get(bk) ?? 0) + 1)
      }
    }
    this.placements.push(p)
  }

  removeCell(p: PlacedEntry, slotIdx: number, limits: LimitRule[]) {
    const idx = this.placements.indexOf(p)
    if (idx >= 0) this.placements.splice(idx, 1)
    const key = cellKey(p.day, p.slotId)
    this.homeroomBusy.get(p.homeroomId)?.get(key)?.delete(hrToken(p.groupId))
    for (const t of teachersOf(p)) {
      this.teacherBusy.get(t)?.delete(key)
      this.teacherDaySlots.get(`${t}|${p.day}`)?.delete(slotIdx)
    }
    if (p.roomId) this.roomUsedAt.get(key)?.delete(p.roomId)
    const sk = `${p.homeroomId}|${p.subjectId}|${hrToken(p.groupId)}|${p.day}`
    this.subjectDay.set(sk, Math.max(0, (this.subjectDay.get(sk) ?? 0) - 1))
    const dk = `${p.homeroomId}|${p.day}`
    this.dayLoad.set(dk, Math.max(0, (this.dayLoad.get(dk) ?? 0) - 1))
    for (let r = 0; r < limits.length; r++) {
      const rule = limits[r]
      if (rule.kind !== 'max') continue
      for (const bucket of limitBucketsFor(rule, p, p.day)) {
        const bk = `${r}|${bucket}`
        this.limitCounts.set(bk, Math.max(0, (this.limitCounts.get(bk) ?? 0) - 1))
      }
    }
  }

  // Occupy a combined class into one day+slot: the teacher and room are used
  // ONCE, but every member homeroom's cell is filled. Returns the entries.
  occupyCombined(unit: CombinedUnit, day: Weekday, slotId: string, slotIdx: number): PlacedEntry[] {
    const key = cellKey(day, slotId)
    const combinedKey = `${unit.combinedId}__${day}__${slotId}`
    const made: PlacedEntry[] = []
    for (const m of unit.members) {
      const hr = m.homeroomId
      const token = hrToken(m.groupId)
      const p: PlacedEntry = {
        homeroomId: hr, day, slotId, subjectId: unit.subjectId,
        teacherId: unit.teacherId, teacherIds: unit.teacherIds,
        roomId: unit.roomId, isLocked: false,
        groupId: m.groupId, splitKey: null, combinedKey,
      }
      if (!this.homeroomBusy.has(hr)) this.homeroomBusy.set(hr, new Map())
      const cm = this.homeroomBusy.get(hr)!
      if (!cm.has(key)) cm.set(key, new Set())
      cm.get(key)!.add(token)
      const sk = `${hr}|${unit.subjectId}|${token}|${day}`
      this.subjectDay.set(sk, (this.subjectDay.get(sk) ?? 0) + 1)
      this.dayLoad.set(`${hr}|${day}`, (this.dayLoad.get(`${hr}|${day}`) ?? 0) + 1)
      this.placements.push(p)
      made.push(p)
    }
    for (const t of teachersOf(unit)) {
      if (!this.teacherBusy.has(t)) this.teacherBusy.set(t, new Set())
      this.teacherBusy.get(t)!.add(key)
      const tk = `${t}|${day}`
      if (!this.teacherDaySlots.has(tk)) this.teacherDaySlots.set(tk, new Set())
      this.teacherDaySlots.get(tk)!.add(slotIdx)
    }
    if (unit.roomId) {
      if (!this.roomUsedAt.has(key)) this.roomUsedAt.set(key, new Set())
      this.roomUsedAt.get(key)!.add(unit.roomId)
    }
    return made
  }
}

// One occurrence of a combined class to place (periods_per_week → N units).
interface CombinedUnit {
  combinedId: string
  subjectId: string
  teacherId: string | null
  teacherIds: string[]
  roomId: string | null
  members: { homeroomId: string; groupId: string | null }[]
}

// ── Construction ─────────────────────────────────────────────

interface BuildArgs {
  days: Weekday[]
  geo: SlotGeometry
  blocks: Block[]
  combined: CombinedUnit[]
  locked: PlacedEntry[]
  index: ConstraintIndex
  roomsByType: Map<RoomType, Room[]>
  rng: () => number
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

function pickRoomForBlock(
  roomsByType: Map<RoomType, Room[]>,
  roomUsedAt: Map<string, Set<string>>,
  type: RoomType,
  keys: string[],
): { ok: boolean; roomId: string | null } {
  const list = roomsByType.get(type) ?? []
  if (list.length === 0) return { ok: true, roomId: null } // school doesn't track this room type
  for (const room of list) {
    const clash = keys.some((k) => roomUsedAt.get(k)?.has(room.id))
    if (!clash) return { ok: true, roomId: room.id }
  }
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
  const { geo, index, roomsByType, rng } = args
  const size = block.size
  if (start + size > geo.slotIds.length) return null
  // Contiguous with no break between.
  for (let j = start; j < start + size - 1; j++) {
    if (!geo.adjacentNext[j]) return null
  }

  const keys: string[] = []
  const token = hrToken(block.groupId)
  const blockTeachers = teachersOf(block)
  const busySets = blockTeachers.map((t) => state.teacherBusy.get(t))

  for (let j = start; j < start + size; j++) {
    const slotId = geo.slotIds[j]
    const key = cellKey(day, slotId)
    keys.push(key)
    if (!state.homeroomFree(block.homeroomId, key, token)) return null
    // Every teacher of a co-taught lesson has to be free and not timed off.
    if (busySets.some((s) => s?.has(key))) return null
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

  // Max-in-a-row (hard) — checked for every teacher of the lesson.
  for (const t of blockTeachers) {
    const maxRow = effectiveMaxInARow(index, t)
    if (maxRow == null) continue
    const union = new Set(state.teacherDaySlots.get(`${t}|${day}`) ?? [])
    for (let j = start; j < start + size; j++) union.add(j)
    if (longestRun(union) > maxRow) return null
  }

  const room = pickRoomForBlock(roomsByType, state.roomUsedAt, block.roomType, keys)
  if (!room.ok) return null

  const dl = state.dayLoad.get(`${block.homeroomId}|${day}`) ?? 0
  const penalty = sdc * 6 + dl * 1 + (relaxMaxPerDay && sdc + size > block.maxPerDay ? 100 : 0) + rng() * 0.5

  return { roomId: room.roomId, penalty }
}

function placeBlock(state: SolveState, block: Block, args: BuildArgs, relax: boolean): boolean {
  const { days, geo, index } = args
  let best: { day: Weekday; start: number; roomId: string | null; penalty: number } | null = null

  for (const day of days) {
    for (let start = 0; start + block.size <= geo.slotIds.length; start++) {
      const scored = scoreBlock(state, block, day, start, args, relax)
      if (!scored) continue
      if (!best || scored.penalty < best.penalty) {
        best = { day, start, roomId: scored.roomId, penalty: scored.penalty }
      }
    }
  }

  if (!best) return false
  for (let j = best.start; j < best.start + block.size; j++) {
    const slotId = geo.slotIds[j]
    const p: PlacedEntry = {
      homeroomId: block.homeroomId,
      day: best.day,
      slotId,
      subjectId: block.subjectId,
      teacherId: block.teacherId,
      teacherIds: block.teacherIds,
      roomId: best.roomId,
      isLocked: false,
      groupId: block.groupId,
      // Parallel group lessons in one cell share a split key.
      splitKey: block.groupId ? `${block.homeroomId}__${best.day}__${slotId}` : null,
    }
    state.occupyCell(p, j, index.limits)
  }
  return true
}

function buildOnce(args: BuildArgs): { state: SolveState; unplaced: Block[]; unplacedCombined: CombinedUnit[] } {
  const { blocks, combined, locked, geo, index } = args
  const state = new SolveState()
  for (const l of locked) {
    const idx = geo.slotOrder.get(l.slotId) ?? 0
    state.occupyCell(l, idx, index.limits)
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
  return { state, unplaced, unplacedCombined }
}

// Scores a combined unit at day+start (size 1). Null if any hard rule blocks it.
function scoreCombined(state: SolveState, unit: CombinedUnit, day: Weekday, start: number, args: BuildArgs): number | null {
  const { geo, index } = args
  const slotId = geo.slotIds[start]
  const key = cellKey(day, slotId)
  const unitTeachers = teachersOf(unit)
  for (const t of unitTeachers) {
    if (state.teacherBusy.get(t)?.has(key)) return null
    if (timeOffBlocked(index.teacherTimeOff, t, key)) return null
  }
  if (unitTeachers.length === 0 && timeOffBlocked(index.teacherTimeOff, null, key)) return null
  if (timeOffBlocked(index.subjectTimeOff, unit.subjectId, key)) return null
  if (unit.roomId && state.roomUsedAt.get(key)?.has(unit.roomId)) return null
  for (const m of unit.members) {
    if (!state.homeroomFree(m.homeroomId, key, hrToken(m.groupId))) return null
    if (timeOffBlocked(index.homeroomTimeOff, m.homeroomId, key)) return null
  }
  for (const t of unitTeachers) {
    const maxRow = effectiveMaxInARow(index, t)
    if (maxRow == null) continue
    const union = new Set(state.teacherDaySlots.get(`${t}|${day}`) ?? [])
    union.add(start)
    if (longestRun(union) > maxRow) return null
  }
  let penalty = 0
  for (const m of unit.members) penalty += state.dayLoad.get(`${m.homeroomId}|${day}`) ?? 0
  return penalty + args.rng() * 0.5
}

function placeCombinedUnit(state: SolveState, unit: CombinedUnit, args: BuildArgs): boolean {
  const { days, geo } = args
  let best: { day: Weekday; start: number; penalty: number } | null = null
  for (const day of days) {
    for (let start = 0; start < geo.slotIds.length; start++) {
      const penalty = scoreCombined(state, unit, day, start, args)
      if (penalty == null) continue
      if (!best || penalty < best.penalty) best = { day, start, penalty }
    }
  }
  if (!best) return false
  state.occupyCombined(unit, best.day, geo.slotIds[best.start], best.start)
  return true
}

// ── Soft-penalty scoring (global) ────────────────────────────

function softPenalty(
  placements: PlacedEntry[],
  geo: SlotGeometry,
  days: Weekday[],
  index: ConstraintIndex,
): number {
  let penalty = 0
  const slotOrder = geo.slotOrder

  const subjDay = new Map<string, number>()
  const hrDay = new Map<string, number>()
  for (const p of placements) {
    subjDay.set(`${p.homeroomId}|${p.subjectId}|${p.day}`, (subjDay.get(`${p.homeroomId}|${p.subjectId}|${p.day}`) ?? 0) + 1)
    hrDay.set(`${p.homeroomId}|${p.day}`, (hrDay.get(`${p.homeroomId}|${p.day}`) ?? 0) + 1)
  }
  for (const count of subjDay.values()) if (count > 1) penalty += (count - 1) * 6

  const hrTotals = new Map<string, number[]>()
  for (const [k, v] of hrDay) {
    const hr = k.split('|')[0]
    if (!hrTotals.has(hr)) hrTotals.set(hr, [])
    hrTotals.get(hr)!.push(v)
  }
  for (const loads of hrTotals.values()) {
    const avg = loads.reduce((a, b) => a + b, 0) / Math.max(1, days.length)
    for (const l of loads) penalty += Math.abs(l - avg)
  }

  const teacherDaySlots = new Map<string, Set<number>>()
  for (const p of placements) {
    for (const t of teachersOf(p)) {
      const k = `${t}|${p.day}`
      if (!teacherDaySlots.has(k)) teacherDaySlots.set(k, new Set())
      teacherDaySlots.get(k)!.add(slotOrder.get(p.slotId) ?? 0)
    }
  }
  for (const set of teacherDaySlots.values()) {
    const idxs = [...set].sort((a, b) => a - b)
    const span = idxs[idxs.length - 1] - idxs[0] + 1
    penalty += (span - idxs.length) * 3
  }

  penalty += minTargetShortfall(placements, days, index)
  penalty += unfilledPins(placements, index) * 8

  return penalty
}

// Sum of unmet min-per-day / min-per-week targets (soft).
function minTargetShortfall(placements: PlacedEntry[], days: Weekday[], index: ConstraintIndex): number {
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

// ── Bounded local search ─────────────────────────────────────
// Relocates unlocked SINGLE-period placements to better empty cells.
// Multi-period blocks are left where construction put them.

function localSearch(state: SolveState, args: BuildArgs, iterations: number): void {
  const { days, geo, index } = args
  let current = softPenalty(state.placements, geo, days, index)

  // Only relocate plain whole-class single lessons. Split-group lessons and
  // combined-class lessons are structurally tied to their cell and must not be
  // moved independently (that would drop their split/combined key).
  const movable = () => state.placements.filter((p) => !p.isLocked && !p.groupId && !p.combinedKey)

  for (let it = 0; it < iterations; it++) {
    const pool = movable()
    if (pool.length === 0) return
    const p = pool[Math.floor(args.rng() * pool.length)]
    const slotIdx = geo.slotOrder.get(p.slotId) ?? 0

    state.removeCell(p, slotIdx, index.limits)
    const block: Block = {
      requirementId: '',
      homeroomId: p.homeroomId,
      subjectId: p.subjectId,
      teacherId: p.teacherId,
      teacherIds: teachersOf(p),
      roomType: roomTypeOf(p, args.roomsByType),
      size: 1,
      maxPerDay: Number.POSITIVE_INFINITY,
      groupId: p.groupId ?? null,
    }
    const before = current
    const placed = placeBlock(state, block, args, true)
    if (!placed) {
      state.occupyCell(p, slotIdx, index.limits)
      continue
    }
    const after = softPenalty(state.placements, geo, days, index)
    if (after > before) {
      const moved = state.placements[state.placements.length - 1]
      const movedIdx = geo.slotOrder.get(moved.slotId) ?? 0
      state.removeCell(moved, movedIdx, index.limits)
      state.occupyCell(p, slotIdx, index.limits)
    } else {
      current = after
    }
  }
}

function roomTypeOf(p: PlacedEntry, roomsByType: Map<RoomType, Room[]>): RoomType {
  if (!p.roomId) return 'classroom'
  for (const [type, rooms] of roomsByType) if (rooms.some((r) => r.id === p.roomId)) return type
  return 'classroom'
}

// ── Public API ───────────────────────────────────────────────

export function generateTimetable(input: GeneratorInput): GeneratorResult {
  const days = input.config.working_days
  const geo = slotGeometry(input.slots)

  const index = buildConstraintIndex(input.constraints ?? [], input.homerooms ?? [])
  mergeLegacyUnavailability(index, input.unavailability)

  const roomsByType = new Map<RoomType, Room[]>()
  for (const r of input.rooms) {
    if (!roomsByType.has(r.room_type)) roomsByType.set(r.room_type, [])
    roomsByType.get(r.room_type)!.push(r)
  }

  const locked = (input.locked ?? []).map((p) => ({ ...p, isLocked: true }))
  const blocks = expandBlocks(input.requirements, locked)
  const combined = expandCombined(input.combined ?? [], locked)

  if (geo.slotIds.length === 0 || days.length === 0) {
    return {
      entries: locked,
      conflicts: [{ kind: 'unplaced_lesson', message: 'No teaching periods or working days are configured.' }],
      unplacedCount: blocks.reduce((n, b) => n + b.size, 0),
      softPenalty: 0,
      ok: false,
    }
  }

  const baseSeed = input.seed ?? 12345
  const RESTARTS = 8
  let best: { state: SolveState; unplaced: Block[]; unplacedCombined: CombinedUnit[] } | null = null

  const totalUnplaced = (a: { unplaced: Block[]; unplacedCombined: CombinedUnit[] }) =>
    a.unplaced.reduce((n, b) => n + b.size, 0) + a.unplacedCombined.length

  for (let r = 0; r < RESTARTS; r++) {
    const rng = makeRng(baseSeed + r * 7919)
    const args: BuildArgs = { days, geo, blocks, combined, locked, index, roomsByType, rng }
    const attempt = buildOnce(args)
    if (
      !best ||
      totalUnplaced(attempt) < totalUnplaced(best) ||
      (totalUnplaced(attempt) === totalUnplaced(best) &&
        softPenalty(attempt.state.placements, geo, days, index) <
          softPenalty(best.state.placements, geo, days, index))
    ) {
      best = attempt
    }
  }

  const finalState = best!.state
  const lsRng = makeRng(baseSeed + 104729)
  localSearch(
    finalState,
    { days, geo, blocks, combined, locked, index, roomsByType, rng: lsRng },
    Math.min(2000, finalState.placements.length * 40),
  )

  const conflicts = detectConflicts(finalState.placements, input.unavailability, input.constraints, input.homerooms)
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
    unplacedCount += 1
    conflicts.push({
      kind: 'unplaced_lesson',
      message: 'Could not fit a combined-class period — a member class, the teacher, or the room was busy every slot.',
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
    softPenalty: softPenalty(finalState.placements, geo, days, index),
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

// Expands combined classes into per-period units, subtracting periods already
// satisfied by locked entries (counted by distinct combined_key per class).
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
    while (remaining-- > 0) {
      units.push({
        combinedId: c.id,
        subjectId: c.subjectId,
        teacherId: c.teacherId,
        teacherIds: teacherIdsOf({ teacherId: c.teacherId, teacherIds: c.teacherIds }),
        roomId: c.roomId,
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
): GeneratorConflict[] {
  const conflicts: GeneratorConflict[] = []
  const teacherAt = new Map<string, PlacedEntry[]>()
  const roomAt = new Map<string, PlacedEntry[]>()
  const homeroomAt = new Map<string, PlacedEntry[]>()

  for (const e of entries) {
    const key = cellKey(e.day, e.slotId)
    // A co-taught period books every one of its teachers at that cell.
    for (const t of teachersOf(e)) push(teacherAt, `${t}|${key}`, e)
    if (e.roomId) push(roomAt, `${e.roomId}|${key}`, e)
    push(homeroomAt, `${e.homeroomId}|${key}`, e)
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
): Set<string> {
  const keys = new Set<string>()
  const teacherAt = new Map<string, PlacedEntry[]>()
  const roomAt = new Map<string, PlacedEntry[]>()
  for (const e of entries) {
    const k = cellKey(e.day, e.slotId)
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
