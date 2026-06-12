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
//   - a teacher is never double-booked at the same day+slot
//   - a room is never double-booked at the same day+slot
//   - teacher unavailability is respected
//   - a placement uses a room of the required type when such rooms exist
//
// Soft constraints (penalty-scored, minimized):
//   - spread a subject across distinct days (respect max_per_day)
//   - minimize teacher idle gaps within a day
//   - balance a homeroom's daily lesson load
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
  Weekday,
} from './types'

// ── Utilities ────────────────────────────────────────────────

const cellKey = (day: Weekday, slotId: string) => `${day}__${slotId}`

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

// A single lesson to place (a requirement of N periods/week → N lessons).
interface Lesson {
  requirementId: string
  homeroomId: string
  subjectId: string
  teacherId: string | null
  roomType: RoomType
  maxPerDay: number
}

// ── Solver working state ─────────────────────────────────────

class SolveState {
  homeroomBusy = new Map<string, Set<string>>() // homeroomId -> cellKeys
  teacherBusy = new Map<string, Set<string>>() // teacherId -> cellKeys
  roomUsedAt = new Map<string, Set<string>>() // cellKey -> roomIds
  subjectDay = new Map<string, number>() // `${hr}|${subj}|${day}` -> count
  dayLoad = new Map<string, number>() // `${hr}|${day}` -> count
  placements: PlacedEntry[] = []

  occupy(p: PlacedEntry) {
    const key = cellKey(p.day, p.slotId)
    if (!this.homeroomBusy.has(p.homeroomId)) this.homeroomBusy.set(p.homeroomId, new Set())
    this.homeroomBusy.get(p.homeroomId)!.add(key)
    if (p.teacherId) {
      if (!this.teacherBusy.has(p.teacherId)) this.teacherBusy.set(p.teacherId, new Set())
      this.teacherBusy.get(p.teacherId)!.add(key)
    }
    if (p.roomId) {
      if (!this.roomUsedAt.has(key)) this.roomUsedAt.set(key, new Set())
      this.roomUsedAt.get(key)!.add(p.roomId)
    }
    this.subjectDay.set(
      `${p.homeroomId}|${p.subjectId}|${p.day}`,
      (this.subjectDay.get(`${p.homeroomId}|${p.subjectId}|${p.day}`) ?? 0) + 1,
    )
    this.dayLoad.set(`${p.homeroomId}|${p.day}`, (this.dayLoad.get(`${p.homeroomId}|${p.day}`) ?? 0) + 1)
    this.placements.push(p)
  }
}

// ── Construction ─────────────────────────────────────────────

interface BuildArgs {
  days: Weekday[]
  slotIds: string[]
  lessons: Lesson[]
  locked: PlacedEntry[]
  unavail: Map<string, Set<string>>
  roomsByType: Map<RoomType, Room[]>
  rng: () => number
}

function pickRoom(
  roomsByType: Map<RoomType, Room[]>,
  roomUsedAt: Map<string, Set<string>>,
  type: RoomType,
  key: string,
): { ok: boolean; roomId: string | null } {
  const list = roomsByType.get(type) ?? []
  if (list.length === 0) return { ok: true, roomId: null } // school doesn't track this room type
  const used = roomUsedAt.get(key)
  const free = used ? list.filter((r) => !used.has(r.id)) : list
  if (free.length === 0) return { ok: false, roomId: null }
  return { ok: true, roomId: free[0].id }
}

function buildOnce(args: BuildArgs): { state: SolveState; unplaced: Lesson[] } {
  const { days, slotIds, lessons, locked, unavail, roomsByType, rng } = args
  const state = new SolveState()
  for (const l of locked) state.occupy(l)

  const unplaced: Lesson[] = []
  // Most-constrained lessons first (special rooms, assigned teachers), shuffled within ties.
  const ordered = shuffle(lessons, rng).sort((a, b) => rank(b) - rank(a))

  for (const lesson of ordered) {
    const placed = placeLesson(state, lesson, days, slotIds, unavail, roomsByType, rng, false)
    if (!placed) {
      // Relax the soft max_per_day cap and try once more before giving up.
      const relaxed = placeLesson(state, lesson, days, slotIds, unavail, roomsByType, rng, true)
      if (!relaxed) unplaced.push(lesson)
    }
  }
  return { state, unplaced }
}

function rank(l: Lesson): number {
  let r = 0
  if (l.roomType !== 'classroom') r += 5
  if (l.teacherId) r += 2
  return r
}

function placeLesson(
  state: SolveState,
  lesson: Lesson,
  days: Weekday[],
  slotIds: string[],
  unavail: Map<string, Set<string>>,
  roomsByType: Map<RoomType, Room[]>,
  rng: () => number,
  relaxMaxPerDay: boolean,
): boolean {
  const hrBusy = state.homeroomBusy.get(lesson.homeroomId)
  const tBusy = lesson.teacherId ? state.teacherBusy.get(lesson.teacherId) : undefined
  const tUnavail = lesson.teacherId ? unavail.get(lesson.teacherId) : undefined

  let best: { p: PlacedEntry; penalty: number } | null = null

  for (const day of days) {
    const sdc = state.subjectDay.get(`${lesson.homeroomId}|${lesson.subjectId}|${day}`) ?? 0
    if (!relaxMaxPerDay && sdc + 1 > lesson.maxPerDay) continue
    for (const slotId of slotIds) {
      const key = cellKey(day, slotId)
      if (hrBusy?.has(key)) continue
      if (tBusy?.has(key)) continue
      if (tUnavail?.has(key)) continue
      const room = pickRoom(roomsByType, state.roomUsedAt, lesson.roomType, key)
      if (!room.ok) continue

      const dl = state.dayLoad.get(`${lesson.homeroomId}|${day}`) ?? 0
      const penalty = sdc * 6 + dl * 1 + (relaxMaxPerDay && sdc + 1 > lesson.maxPerDay ? 100 : 0) + rng() * 0.5

      if (!best || penalty < best.penalty) {
        best = {
          p: {
            homeroomId: lesson.homeroomId,
            day,
            slotId,
            subjectId: lesson.subjectId,
            teacherId: lesson.teacherId,
            roomId: room.roomId,
            isLocked: false,
          },
          penalty,
        }
      }
    }
  }

  if (!best) return false
  state.occupy(best.p)
  return true
}

// ── Soft-penalty scoring (global) ────────────────────────────

function softPenalty(placements: PlacedEntry[], slotOrder: Map<string, number>, days: Weekday[]): number {
  let penalty = 0

  // Subject clustering per homeroom/day.
  const subjDay = new Map<string, number>()
  const hrDay = new Map<string, number>()
  for (const p of placements) {
    subjDay.set(`${p.homeroomId}|${p.subjectId}|${p.day}`, (subjDay.get(`${p.homeroomId}|${p.subjectId}|${p.day}`) ?? 0) + 1)
    hrDay.set(`${p.homeroomId}|${p.day}`, (hrDay.get(`${p.homeroomId}|${p.day}`) ?? 0) + 1)
  }
  for (const count of subjDay.values()) if (count > 1) penalty += (count - 1) * 6

  // Homeroom daily-load balance.
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

  // Teacher idle gaps within a day.
  const teacherDaySlots = new Map<string, number[]>()
  for (const p of placements) {
    if (!p.teacherId) continue
    const k = `${p.teacherId}|${p.day}`
    if (!teacherDaySlots.has(k)) teacherDaySlots.set(k, [])
    teacherDaySlots.get(k)!.push(slotOrder.get(p.slotId) ?? 0)
  }
  for (const idxs of teacherDaySlots.values()) {
    idxs.sort((a, b) => a - b)
    const span = idxs[idxs.length - 1] - idxs[0] + 1
    penalty += (span - idxs.length) * 3 // empty slots wedged between taught periods
  }

  return penalty
}

// ── Bounded local search ─────────────────────────────────────
// Tries to relocate unlocked lessons to empty, hard-valid cells when
// doing so lowers the global soft penalty.

function localSearch(
  state: SolveState,
  args: BuildArgs,
  slotOrder: Map<string, number>,
  iterations: number,
): void {
  const { days, slotIds, unavail, roomsByType, rng } = args
  let current = softPenalty(state.placements, slotOrder, days)

  const movable = () => state.placements.filter((p) => !p.isLocked)

  for (let it = 0; it < iterations; it++) {
    const pool = movable()
    if (pool.length === 0) return
    const p = pool[Math.floor(rng() * pool.length)]

    // Free p from occupancy, attempt a better cell, else restore.
    removePlacement(state, p)
    const lesson: Lesson = {
      requirementId: '',
      homeroomId: p.homeroomId,
      subjectId: p.subjectId,
      teacherId: p.teacherId,
      roomType: roomTypeOf(p, roomsByType),
      maxPerDay: Number.POSITIVE_INFINITY, // moves never tighten max_per_day here
    }
    const before = current
    const placed = placeLesson(state, lesson, days, slotIds, unavail, roomsByType, rng, true)
    if (!placed) {
      // Could not re-place anywhere (shouldn't happen) — restore original.
      state.occupy(p)
      continue
    }
    const after = softPenalty(state.placements, slotOrder, days)
    if (after > before) {
      // Worse: revert to the original placement.
      const moved = state.placements[state.placements.length - 1]
      removePlacement(state, moved)
      state.occupy(p)
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

function removePlacement(state: SolveState, p: PlacedEntry): void {
  const idx = state.placements.indexOf(p)
  if (idx >= 0) state.placements.splice(idx, 1)
  const key = cellKey(p.day, p.slotId)
  state.homeroomBusy.get(p.homeroomId)?.delete(key)
  if (p.teacherId) state.teacherBusy.get(p.teacherId)?.delete(key)
  if (p.roomId) state.roomUsedAt.get(key)?.delete(p.roomId)
  const sk = `${p.homeroomId}|${p.subjectId}|${p.day}`
  state.subjectDay.set(sk, Math.max(0, (state.subjectDay.get(sk) ?? 0) - 1))
  const dk = `${p.homeroomId}|${p.day}`
  state.dayLoad.set(dk, Math.max(0, (state.dayLoad.get(dk) ?? 0) - 1))
}

// ── Public API ───────────────────────────────────────────────

export function generateTimetable(input: GeneratorInput): GeneratorResult {
  const days = input.config.working_days
  const teachingSlots = input.slots.filter((s) => !s.is_break)
  const slotIds = teachingSlots.map((s) => s.id)
  const slotOrder = new Map(teachingSlots.map((s, i) => [s.id, i]))

  const unavail = new Map<string, Set<string>>()
  for (const u of input.unavailability) {
    if (!unavail.has(u.teacher_id)) unavail.set(u.teacher_id, new Set())
    unavail.get(u.teacher_id)!.add(cellKey(u.day, u.slot_id))
  }

  const roomsByType = new Map<RoomType, Room[]>()
  for (const r of input.rooms) {
    if (!roomsByType.has(r.room_type)) roomsByType.set(r.room_type, [])
    roomsByType.get(r.room_type)!.push(r)
  }

  const locked = (input.locked ?? []).map((p) => ({ ...p, isLocked: true }))
  const lessons = expandLessons(input.requirements, locked)

  // No teaching slots or working days → nothing can be placed.
  if (slotIds.length === 0 || days.length === 0) {
    return {
      entries: locked,
      conflicts: [
        {
          kind: 'unplaced_lesson',
          message: 'No teaching periods or working days are configured.',
        },
      ],
      unplacedCount: lessons.length,
      softPenalty: 0,
      ok: false,
    }
  }

  const baseSeed = input.seed ?? 12345
  const RESTARTS = 8
  let best: { state: SolveState; unplaced: Lesson[] } | null = null

  for (let r = 0; r < RESTARTS; r++) {
    const rng = makeRng(baseSeed + r * 7919)
    const args: BuildArgs = { days, slotIds, lessons, locked, unavail, roomsByType, rng }
    const attempt = buildOnce(args)
    if (
      !best ||
      attempt.unplaced.length < best.unplaced.length ||
      (attempt.unplaced.length === best.unplaced.length &&
        softPenalty(attempt.state.placements, slotOrder, days) <
          softPenalty(best.state.placements, slotOrder, days))
    ) {
      best = attempt
    }
  }

  const finalState = best!.state
  const lsRng = makeRng(baseSeed + 104729)
  localSearch(
    finalState,
    { days, slotIds, lessons, locked, unavail, roomsByType, rng: lsRng },
    slotOrder,
    Math.min(2000, finalState.placements.length * 40),
  )

  const conflicts = detectConflicts(finalState.placements, input.unavailability)
  for (const u of best!.unplaced) {
    conflicts.push({
      kind: 'unplaced_lesson',
      message: 'Could not fit a required period — try adding slots/days or relaxing constraints.',
      homeroomId: u.homeroomId,
      subjectId: u.subjectId,
      teacherId: u.teacherId ?? undefined,
    })
  }

  return {
    entries: finalState.placements,
    conflicts,
    unplacedCount: best!.unplaced.length,
    softPenalty: softPenalty(finalState.placements, slotOrder, days),
    ok: best!.unplaced.length === 0 && conflicts.every((c) => c.kind === 'unplaced_lesson'),
  }
}

// Expands requirements into individual lessons, subtracting any periods
// already satisfied by locked placements (same homeroom + subject).
function expandLessons(requirements: Requirement[], locked: PlacedEntry[]): Lesson[] {
  const lockedCount = new Map<string, number>()
  for (const p of locked) {
    const k = `${p.homeroomId}|${p.subjectId}`
    lockedCount.set(k, (lockedCount.get(k) ?? 0) + 1)
  }
  const lessons: Lesson[] = []
  for (const req of requirements) {
    const k = `${req.homeroom_id}|${req.subject_id}`
    let remaining = req.periods_per_week - (lockedCount.get(k) ?? 0)
    while (remaining-- > 0) {
      lessons.push({
        requirementId: req.id,
        homeroomId: req.homeroom_id,
        subjectId: req.subject_id,
        teacherId: req.teacher_id,
        roomType: req.room_type,
        maxPerDay: req.max_per_day,
      })
    }
  }
  return lessons
}

// Hard-constraint validator used by both the engine and the editable grid.
export function detectConflicts(
  entries: PlacedEntry[],
  unavailability: TeacherUnavailability[],
): GeneratorConflict[] {
  const conflicts: GeneratorConflict[] = []
  const teacherAt = new Map<string, PlacedEntry[]>()
  const roomAt = new Map<string, PlacedEntry[]>()
  const homeroomAt = new Map<string, PlacedEntry[]>()

  for (const e of entries) {
    const key = cellKey(e.day, e.slotId)
    if (e.teacherId) push(teacherAt, `${e.teacherId}|${key}`, e)
    if (e.roomId) push(roomAt, `${e.roomId}|${key}`, e)
    push(homeroomAt, `${e.homeroomId}|${key}`, e)
  }

  for (const [k, list] of teacherAt) {
    if (list.length > 1) {
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
    if (list.length > 1) {
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
    if (list.length > 1) {
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

  const unavail = new Map<string, Set<string>>()
  for (const u of unavailability) {
    if (!unavail.has(u.teacher_id)) unavail.set(u.teacher_id, new Set())
    unavail.get(u.teacher_id)!.add(cellKey(u.day, u.slot_id))
  }
  for (const e of entries) {
    if (e.teacherId && unavail.get(e.teacherId)?.has(cellKey(e.day, e.slotId))) {
      conflicts.push({
        kind: 'teacher_double_booked',
        message: 'Teacher is scheduled during a period they marked unavailable.',
        teacherId: e.teacherId,
        day: e.day,
        slotId: e.slotId,
      })
    }
  }

  return conflicts
}

function push<T>(map: Map<string, T[]>, key: string, value: T) {
  if (!map.has(key)) map.set(key, [])
  map.get(key)!.push(value)
}

// Set of cell keys (homeroom|day|slot) involved in a hard conflict — used by the
// editable grid to highlight problem cells. Re-derives per-entry granularity.
export function conflictCellKeys(
  entries: PlacedEntry[],
  unavailability: TeacherUnavailability[],
): Set<string> {
  const keys = new Set<string>()
  const teacherAt = new Map<string, PlacedEntry[]>()
  const roomAt = new Map<string, PlacedEntry[]>()
  for (const e of entries) {
    const k = cellKey(e.day, e.slotId)
    if (e.teacherId) push(teacherAt, `${e.teacherId}|${k}`, e)
    if (e.roomId) push(roomAt, `${e.roomId}|${k}`, e)
  }
  const mark = (e: PlacedEntry) => keys.add(`${e.homeroomId}__${e.day}__${e.slotId}`)
  for (const list of teacherAt.values()) if (list.length > 1) list.forEach(mark)
  for (const list of roomAt.values()) if (list.length > 1) list.forEach(mark)

  const unavail = new Map<string, Set<string>>()
  for (const u of unavailability) {
    if (!unavail.has(u.teacher_id)) unavail.set(u.teacher_id, new Set())
    unavail.get(u.teacher_id)!.add(cellKey(u.day, u.slot_id))
  }
  for (const e of entries) {
    if (e.teacherId && unavail.get(e.teacherId)?.has(cellKey(e.day, e.slotId))) mark(e)
  }
  return keys
}
