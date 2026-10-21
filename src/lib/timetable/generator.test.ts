import { describe, it, expect } from 'vitest'
import {
  generateTimetable, buildSchedules, teacherDayPenalty, PREFERRED_RUN,
} from './generator'
import { computeHealth } from './health'
import { teacherIdsOf } from './types'
import type {
  GeneratorInput, PeriodSlot, Requirement, TimetableConfig, SlotGroup, Weekday, PlacedEntry,
  CombinedClassInput, Room,
} from './types'

// ── Fixtures ─────────────────────────────────────────────────

const DAYS: Weekday[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday']

const config = (over: Partial<TimetableConfig> = {}): TimetableConfig => ({
  id: 'cfg', name: 'Main', academic_year: '2026-2027', working_days: DAYS,
  is_active: true, created_by: null, created_at: '', updated_at: '', ...over,
})

/** `count` back-to-back teaching periods, positions 1..count. */
const slots = (count: number, groupId: string | null = null, startHour = 9): PeriodSlot[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `${groupId ?? 'base'}-s${i + 1}`,
    config_id: 'cfg',
    group_id: groupId,
    position: i + 1,
    label: `Period ${i + 1}`,
    start_time: `${String(startHour + i).padStart(2, '0')}:00`,
    end_time: `${String(startHour + i).padStart(2, '0')}:45`,
    is_break: false,
    created_at: '', updated_at: '',
  }))

const requirement = (over: Partial<Requirement> & Pick<Requirement, 'id' | 'homeroom_id' | 'subject_id'>): Requirement => ({
  config_id: 'cfg', teacher_id: null, teacher_ids: [], periods_per_week: 1,
  room_type: 'classroom', max_per_day: 1, min_block: 1, max_block: 1, group_id: null,
  created_at: '', updated_at: '', ...over,
})

const run = (over: Partial<GeneratorInput> & Pick<GeneratorInput, 'requirements'>) =>
  generateTimetable({
    config: config(), slots: slots(6), unavailability: [], rooms: [], seed: 7, ...over,
  })

/** The placed periods of one requirement, as [day, slot position] runs. */
function runsOf(entries: PlacedEntry[], subjectId: string, slotList: PeriodSlot[]) {
  const pos = new Map(slotList.map((s) => [s.id, s.position]))
  const byDay = new Map<string, number[]>()
  for (const e of entries) {
    if (e.subjectId !== subjectId) continue
    const arr = byDay.get(e.day) ?? []
    arr.push(pos.get(e.slotId) ?? -1)
    byDay.set(e.day, arr)
  }
  return [...byDay.values()].map((a) => a.sort((x, y) => x - y))
}

// ── Consecutive blocks ───────────────────────────────────────

describe('double and triple period blocks', () => {
  it('places a double as two adjacent periods on one day', () => {
    const teaching = slots(6)
    const result = run({
      slots: teaching,
      requirements: [
        requirement({
          id: 'r1', homeroom_id: 'hr1', subject_id: 'sci',
          periods_per_week: 2, max_per_day: 2, min_block: 2, max_block: 2,
        }),
      ],
    })

    expect(result.unplacedCount).toBe(0)
    const runs = runsOf(result.entries, 'sci', teaching)
    expect(runs).toHaveLength(1)
    expect(runs[0]).toHaveLength(2)
    expect(runs[0][1] - runs[0][0]).toBe(1)
  })

  it('keeps every period of a block on the same day and contiguous', () => {
    const teaching = slots(8)
    const result = run({
      slots: teaching,
      requirements: [
        requirement({
          id: 'r1', homeroom_id: 'hr1', subject_id: 'art',
          periods_per_week: 6, max_per_day: 3, min_block: 3, max_block: 3,
        }),
      ],
    })

    expect(result.unplacedCount).toBe(0)
    const runs = runsOf(result.entries, 'art', teaching)
    expect(runs).toHaveLength(2) // 6 periods as two triples, on different days
    for (const r of runs) {
      expect(r).toHaveLength(3)
      expect(r[2] - r[0]).toBe(2)
    }
  })

  it('tags every period of a block with one shared block key', () => {
    const result = run({
      requirements: [
        requirement({
          id: 'r1', homeroom_id: 'hr1', subject_id: 'lab',
          periods_per_week: 4, max_per_day: 2, min_block: 2, max_block: 2,
        }),
      ],
    })
    const placed = result.entries.filter((e) => e.subjectId === 'lab')
    expect(placed).toHaveLength(4)

    const byKey = new Map<string, number>()
    for (const e of placed) {
      expect(e.blockKey).toBeTruthy()
      byKey.set(e.blockKey!, (byKey.get(e.blockKey!) ?? 0) + 1)
    }
    expect([...byKey.values()]).toEqual([2, 2])
  })

  it('leaves single periods unkeyed', () => {
    const result = run({
      requirements: [requirement({ id: 'r1', homeroom_id: 'hr1', subject_id: 'eng', periods_per_week: 3 })],
    })
    for (const e of result.entries) expect(e.blockKey ?? null).toBeNull()
  })

  it('never straddles a break', () => {
    // Periods 1,2 then a break at 3, then 4,5 — a double may not span 2→4.
    const teaching: PeriodSlot[] = [
      ...slots(2),
      { id: 'brk', config_id: 'cfg', group_id: null, position: 3, label: 'Lunch', start_time: '11:00', end_time: '11:30', is_break: true, created_at: '', updated_at: '' },
      ...slots(2, null, 12).map((s, i) => ({ ...s, id: `base-s${i + 4}`, position: i + 4 })),
    ]
    const result = run({
      slots: teaching,
      requirements: [
        requirement({
          id: 'r1', homeroom_id: 'hr1', subject_id: 'pe',
          periods_per_week: 2, max_per_day: 2, min_block: 2, max_block: 2,
        }),
      ],
    })
    expect(result.unplacedCount).toBe(0)
    const placed = result.entries.filter((e) => e.subjectId === 'pe').map((e) => e.slotId).sort()
    // Either both in the morning pair or both in the afternoon pair.
    expect(
      JSON.stringify(placed) === JSON.stringify(['base-s1', 'base-s2']) ||
        JSON.stringify(placed) === JSON.stringify(['base-s4', 'base-s5']),
    ).toBe(true)
  })

  it('survives the local search: blocks stay whole with other subjects competing', () => {
    // The soft penalty charges a class for repeating a subject in a day. Before
    // block keys existed the optimiser cashed that in by pulling doubles apart.
    const teaching = slots(6)
    const result = run({
      slots: teaching,
      requirements: [
        requirement({ id: 'r1', homeroom_id: 'hr1', subject_id: 'chem', periods_per_week: 4, max_per_day: 2, min_block: 2, max_block: 2 }),
        requirement({ id: 'r2', homeroom_id: 'hr1', subject_id: 'eng', periods_per_week: 5 }),
        requirement({ id: 'r3', homeroom_id: 'hr1', subject_id: 'math', periods_per_week: 5 }),
        requirement({ id: 'r4', homeroom_id: 'hr1', subject_id: 'hist', periods_per_week: 4 }),
      ],
    })

    expect(result.unplacedCount).toBe(0)
    const runs = runsOf(result.entries, 'chem', teaching)
    expect(runs).toHaveLength(2)
    for (const r of runs) {
      expect(r).toHaveLength(2)
      expect(r[1] - r[0]).toBe(1)
    }
  })
})

// ── Slot groups (multiple bell schedules) ────────────────────

describe('slot groups', () => {
  const primary: SlotGroup = {
    id: 'g-primary', config_id: 'cfg', name: 'Primary',
    working_days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
    position: 1, color: null, created_by: null, created_at: '', updated_at: '',
  }
  const secondary: SlotGroup = {
    ...primary, id: 'g-secondary', name: 'Secondary',
    working_days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'],
    position: 2,
  }

  it('schedules each homeroom against its own group slots and days', () => {
    const all = [...slots(4, 'g-primary', 9), ...slots(7, 'g-secondary', 9)]
    const result = generateTimetable({
      config: config(),
      slots: all,
      slotGroups: [primary, secondary],
      homeroomGroupIds: { hrP: 'g-primary', hrS: 'g-secondary' },
      requirements: [
        requirement({ id: 'r1', homeroom_id: 'hrP', subject_id: 'eng', periods_per_week: 5 }),
        requirement({ id: 'r2', homeroom_id: 'hrS', subject_id: 'eng', periods_per_week: 6 }),
      ],
      unavailability: [], rooms: [], seed: 11,
    })

    expect(result.unplacedCount).toBe(0)
    const pIds = new Set(slots(4, 'g-primary').map((s) => s.id))
    const sIds = new Set(slots(7, 'g-secondary').map((s) => s.id))
    for (const e of result.entries) {
      if (e.homeroomId === 'hrP') expect(pIds.has(e.slotId)).toBe(true)
      if (e.homeroomId === 'hrS') expect(sIds.has(e.slotId)).toBe(true)
    }
    // Only Secondary may use Saturday.
    const satHomerooms = new Set(result.entries.filter((e) => e.day === 'saturday').map((e) => e.homeroomId))
    expect(satHomerooms.has('hrP')).toBe(false)
  })

  it('never books one teacher into two groups at the same hour', () => {
    // Both bands start at 09:00, so period 1 of each is the same wall-clock hour.
    const all = [...slots(3, 'g-primary', 9), ...slots(3, 'g-secondary', 9)]
    const result = generateTimetable({
      config: config(),
      slots: all,
      slotGroups: [primary, secondary],
      homeroomGroupIds: { hrP: 'g-primary', hrS: 'g-secondary' },
      requirements: [
        requirement({ id: 'r1', homeroom_id: 'hrP', subject_id: 'eng', teacher_id: 't1', teacher_ids: ['t1'], periods_per_week: 5 }),
        requirement({ id: 'r2', homeroom_id: 'hrS', subject_id: 'mus', teacher_id: 't1', teacher_ids: ['t1'], periods_per_week: 5 }),
      ],
      unavailability: [], rooms: [], seed: 3,
    })

    // One teacher, two bands: every placement must sit at a distinct hour.
    const hourOf = (slotId: string) => all.find((s) => s.id === slotId)!.start_time
    const seen = new Set<string>()
    for (const e of result.entries) {
      const stamp = `${e.day}|${hourOf(e.slotId)}`
      expect(seen.has(stamp)).toBe(false)
      seen.add(stamp)
    }
    expect(result.conflicts.filter((c) => c.kind === 'teacher_double_booked')).toHaveLength(0)
  })

  it('falls back to the base schedule for unassigned homerooms', () => {
    const all = [...slots(5), ...slots(3, 'g-primary', 9)]
    const result = generateTimetable({
      config: config(),
      slots: all,
      slotGroups: [primary],
      homeroomGroupIds: { hrP: 'g-primary' },
      requirements: [
        requirement({ id: 'r1', homeroom_id: 'hrBase', subject_id: 'eng', periods_per_week: 5 }),
      ],
      unavailability: [], rooms: [], seed: 5,
    })
    expect(result.unplacedCount).toBe(0)
    const baseIds = new Set(slots(5).map((s) => s.id))
    for (const e of result.entries) expect(baseIds.has(e.slotId)).toBe(true)
  })
})

// ── Health scoring ───────────────────────────────────────────

describe('health scoring', () => {
  const baseSlots = slots(6)

  const health = (entries: PlacedEntry[], reqs: Requirement[]) =>
    computeHealth({
      entries, requirements: reqs, constraints: [], slots: baseSlots,
      config: config(), homerooms: [{ id: 'hr1', class_teacher_id: null }], unavailability: [],
    })

  it('does not count a double period as poor subject spread', () => {
    const asDouble: PlacedEntry[] = [
      { homeroomId: 'hr1', day: 'monday', slotId: 'base-s1', subjectId: 'sci', teacherId: null, roomId: null, isLocked: false, blockKey: 'blk1' },
      { homeroomId: 'hr1', day: 'monday', slotId: 'base-s2', subjectId: 'sci', teacherId: null, roomId: null, isLocked: false, blockKey: 'blk1' },
    ]
    const asTwoSingles = asDouble.map((e) => ({ ...e, blockKey: null }))
    const req = [requirement({ id: 'r1', homeroom_id: 'hr1', subject_id: 'sci', periods_per_week: 2, max_per_day: 2, min_block: 2, max_block: 2 })]

    const spread = (r: ReturnType<typeof health>) => r.components.find((c) => c.key === 'spread')!.score
    expect(spread(health(asDouble, req))).toBe(100)
    // Two unrelated periods of the same subject on one day still read as a clump.
    expect(spread(health(asTwoSingles, req))).toBeLessThan(100)
  })
})

// ── Combined lessons ─────────────────────────────────────────

describe('combined lessons', () => {
  const combinedInput = (
    over: Partial<CombinedClassInput> & Pick<CombinedClassInput, 'id' | 'subjectId' | 'members'>,
  ): CombinedClassInput => ({
    teacherId: null, teacherIds: [], roomId: null, roomType: 'classroom',
    periodsPerWeek: 1, maxPerDay: 1, minBlock: 1, maxBlock: 1, ...over,
  })

  const members = [
    { homeroomId: 'hrA', groupId: null },
    { homeroomId: 'hrB', groupId: null },
    { homeroomId: 'hrC', groupId: null },
  ]

  it('still places a single period in every member class', () => {
    const result = run({
      requirements: [],
      combined: [combinedInput({ id: 'c1', subjectId: 'assembly', members })],
    })
    expect(result.unplacedCount).toBe(0)
    const placed = result.entries.filter((e) => e.subjectId === 'assembly')
    expect(placed).toHaveLength(3)
    // One period, shared: same day and slot for all three classes.
    expect(new Set(placed.map((e) => `${e.day}|${e.slotId}`)).size).toBe(1)
    expect(new Set(placed.map((e) => e.combinedKey)).size).toBe(1)
  })

  it('schedules an assembly double as two adjacent periods', () => {
    const teaching = slots(6)
    const result = run({
      slots: teaching,
      requirements: [],
      combined: [combinedInput({
        id: 'c1', subjectId: 'assembly', members,
        periodsPerWeek: 2, maxPerDay: 2, minBlock: 2, maxBlock: 2,
      })],
    })

    expect(result.unplacedCount).toBe(0)
    const placed = result.entries.filter((e) => e.subjectId === 'assembly')
    expect(placed).toHaveLength(6) // 2 periods × 3 classes

    // One day, two back-to-back periods, and one block key across the lot.
    expect(new Set(placed.map((e) => e.day)).size).toBe(1)
    const runs = runsOf(result.entries.filter((e) => e.homeroomId === 'hrA'), 'assembly', teaching)
    expect(runs).toHaveLength(1)
    expect(runs[0][1] - runs[0][0]).toBe(1)
    const keys = new Set(placed.map((e) => e.blockKey))
    expect(keys.size).toBe(1)
    expect([...keys][0]).toBeTruthy()
  })

  it('finds a room of the requested type when none is pinned', () => {
    const hall: Room = { id: 'hall', name: 'Hall', room_type: 'other', capacity: null, created_by: null, created_at: '', updated_at: '' }
    const lab: Room = { ...hall, id: 'lab', name: 'Lab', room_type: 'science_lab' }
    const result = run({
      requirements: [],
      rooms: [hall, lab],
      combined: [combinedInput({ id: 'c1', subjectId: 'assembly', members, roomType: 'other' })],
    })
    expect(result.unplacedCount).toBe(0)
    for (const e of result.entries) expect(e.roomId).toBe('hall')
  })

  it('keeps a pinned room over the room type', () => {
    const hall: Room = { id: 'hall', name: 'Hall', room_type: 'other', capacity: null, created_by: null, created_at: '', updated_at: '' }
    const result = run({
      requirements: [],
      rooms: [hall],
      combined: [combinedInput({ id: 'c1', subjectId: 'assembly', members, roomId: 'hall', roomType: 'classroom' })],
    })
    expect(result.unplacedCount).toBe(0)
    for (const e of result.entries) expect(e.roomId).toBe('hall')
  })

  it('refuses to exceed its own max per day', () => {
    // Two working days with plenty of free periods each. Four periods a week at
    // one a day needs four days, so two of them cannot be placed — without the
    // cap the solver would happily stack them into the days it has.
    const twoDays = config({ working_days: ['monday', 'tuesday'] })
    const capped = generateTimetable({
      config: twoDays, slots: slots(6), requirements: [], unavailability: [], rooms: [], seed: 9,
      combined: [combinedInput({
        id: 'c1', subjectId: 'assembly', members, periodsPerWeek: 4, maxPerDay: 1,
      })],
    })
    expect(capped.unplacedCount).toBe(2)
    const perDay = new Map<string, number>()
    for (const e of capped.entries.filter((x) => x.homeroomId === 'hrA')) {
      perDay.set(e.day, (perDay.get(e.day) ?? 0) + 1)
    }
    expect([...perDay.values()].every((n) => n <= 1)).toBe(true)

    // Raising the cap to two a day fits all four in the same two days.
    const loose = generateTimetable({
      config: twoDays, slots: slots(6), requirements: [], unavailability: [], rooms: [], seed: 9,
      combined: [combinedInput({
        id: 'c1', subjectId: 'assembly', members, periodsPerWeek: 4, maxPerDay: 2,
      })],
    })
    expect(loose.unplacedCount).toBe(0)
    expect(loose.entries.filter((e) => e.homeroomId === 'hrA')).toHaveLength(4)
  })

  it('reports a block it cannot fit, counting every period of it', () => {
    // Two teaching periods with a break between them: no two are adjacent, so
    // a double can never be placed.
    const teaching: PeriodSlot[] = [
      ...slots(1),
      { id: 'brk', config_id: 'cfg', group_id: null, position: 2, label: 'Lunch', start_time: '10:00', end_time: '10:30', is_break: true, created_at: '', updated_at: '' },
      { ...slots(1, null, 11)[0], id: 'base-s3', position: 3 },
    ]
    const result = run({
      slots: teaching,
      requirements: [],
      combined: [combinedInput({
        id: 'c1', subjectId: 'assembly', members,
        periodsPerWeek: 2, maxPerDay: 2, minBlock: 2, maxBlock: 2,
      })],
    })
    expect(result.unplacedCount).toBe(2)
    expect(result.conflicts.some((c) => c.kind === 'block_unplaceable')).toBe(true)
    expect(result.ok).toBe(false)
  })

  it('says so when its classes follow different period groups', () => {
    const primary: SlotGroup = {
      id: 'g-primary', config_id: 'cfg', name: 'Primary', working_days: DAYS,
      position: 1, color: null, created_by: null, created_at: '', updated_at: '',
    }
    const result = generateTimetable({
      config: config(),
      slots: [...slots(4, 'g-primary', 9), ...slots(4, null, 9)],
      slotGroups: [primary],
      homeroomGroupIds: { hrA: 'g-primary' },
      requirements: [],
      combined: [combinedInput({
        id: 'c1', subjectId: 'assembly',
        members: [{ homeroomId: 'hrA', groupId: null }, { homeroomId: 'hrB', groupId: null }],
      })],
      unavailability: [], rooms: [], seed: 4,
    })
    expect(result.unplacedCount).toBe(1)
    expect(result.conflicts.some((c) => /different period groups/.test(c.message))).toBe(true)
  })
})

// ── Rooms ────────────────────────────────────────────────────

describe('rooms', () => {
  const classrooms = (n: number): Room[] =>
    Array.from({ length: n }, (_, i) => ({
      id: `room${i}`, name: `Room ${i}`, room_type: 'classroom' as const,
      capacity: null, created_by: null, created_at: '', updated_at: '',
    }))

  /** `hrCount` classes, each needing `each` ordinary periods a week. */
  const school = (hrCount: number, each: number): Requirement[] =>
    Array.from({ length: hrCount }, (_, h) =>
      requirement({
        id: `r${h}`, homeroom_id: `hr${h}`, subject_id: 'eng',
        teacher_id: `t${h}`, teacher_ids: [`t${h}`],
        periods_per_week: each, max_per_day: each,
      }),
    )

  it('does not make classes queue for a classroom — two classes may have a lesson at once', () => {
    // The whole point: a school with 2 rooms on record and 10 classes still gets
    // a full timetable. Treating the classroom list as a hard capacity would cap
    // it at 2 lessons per period and throw the rest away.
    const result = run({
      slots: slots(5),
      rooms: classrooms(2),
      requirements: school(10, 5),
    })
    expect(result.unplacedCount).toBe(0)
    expect(result.entries).toHaveLength(50)
    // And several classes really are taught in the same period.
    const perCell = new Map<string, number>()
    for (const e of result.entries) {
      const k = `${e.day}|${e.slotId}`
      perCell.set(k, (perCell.get(k) ?? 0) + 1)
    }
    expect(Math.max(...perCell.values())).toBeGreaterThan(2)
  })

  it('gives a class one room for the whole week instead of moving it every period', () => {
    const result = run({
      slots: slots(5),
      rooms: classrooms(4),
      requirements: school(4, 5),
    })
    expect(result.unplacedCount).toBe(0)
    const roomsPerClass = new Map<string, Set<string | null>>()
    for (const e of result.entries) {
      if (!roomsPerClass.has(e.homeroomId)) roomsPerClass.set(e.homeroomId, new Set())
      roomsPerClass.get(e.homeroomId)!.add(e.roomId)
    }
    expect(roomsPerClass.size).toBe(4)
    for (const set of roomsPerClass.values()) expect(set.size).toBe(1)
    // Four classes, four rooms — each class owns a different one.
    const owned = new Set([...roomsPerClass.values()].map((s) => [...s][0]))
    expect(owned.size).toBe(4)
    expect(owned.has(null)).toBe(false)
  })

  it('leaves a class roomless rather than unscheduled when the list is short', () => {
    const result = run({
      slots: slots(5),
      rooms: classrooms(2),
      requirements: school(5, 5),
    })
    expect(result.unplacedCount).toBe(0)
    const roomless = result.entries.filter((e) => e.roomId === null)
    expect(roomless.length).toBe(15) // the 3 classes past the end of the list
    expect(result.conflicts.filter((c) => c.kind === 'room_double_booked')).toHaveLength(0)
  })

  it('still treats a lab as scarce — it is a shared resource, a classroom is not', () => {
    const lab: Room[] = [{
      id: 'lab1', name: 'Lab 1', room_type: 'science_lab', capacity: null,
      created_by: null, created_at: '', updated_at: '',
    }]
    // Two classes, one lab, one period in the week: only one lesson can happen.
    const result = run({
      slots: slots(1),
      config: config({ working_days: ['monday'] }),
      rooms: lab,
      requirements: [
        requirement({ id: 'r1', homeroom_id: 'hr1', subject_id: 'sci', room_type: 'science_lab' }),
        requirement({ id: 'r2', homeroom_id: 'hr2', subject_id: 'sci', room_type: 'science_lab' }),
      ],
    })
    expect(result.entries).toHaveLength(1)
    expect(result.unplacedCount).toBe(1)
  })

  it('never double-books a room it did assign', () => {
    const result = run({
      slots: slots(4),
      rooms: classrooms(3),
      requirements: school(8, 4),
    })
    const seen = new Map<string, number>()
    for (const e of result.entries) {
      if (!e.roomId) continue
      const k = `${e.roomId}|${e.day}|${e.slotId}`
      seen.set(k, (seen.get(k) ?? 0) + 1)
    }
    expect([...seen.values()].every((n) => n === 1)).toBe(true)
    expect(result.conflicts.filter((c) => c.kind === 'room_double_booked')).toHaveLength(0)
  })
})

// ── Local search: the swap neighbourhood ─────────────────────

describe('swapping two lessons', () => {
  it('keeps every lesson and every block intact through a long search', () => {
    // A dense week with nowhere free to relocate into is exactly where the
    // search leans on swaps; nothing it does may lose a lesson, split a double,
    // or double-book a teacher.
    const teaching = slots(6)
    const requirements: Requirement[] = []
    for (let h = 0; h < 6; h++) {
      requirements.push(requirement({
        id: `d${h}`, homeroom_id: `hr${h}`, subject_id: 'sci',
        teacher_id: `t${h}`, teacher_ids: [`t${h}`],
        periods_per_week: 4, max_per_day: 2, min_block: 2, max_block: 2,
      }))
      for (const s of ['eng', 'mat', 'his', 'geo']) {
        requirements.push(requirement({
          id: `${s}${h}`, homeroom_id: `hr${h}`, subject_id: s,
          teacher_id: `t${s}${h % 3}`, teacher_ids: [`t${s}${h % 3}`],
          periods_per_week: 5, max_per_day: 2,
        }))
      }
    }
    const result = generateTimetable(
      { config: config(), slots: teaching, requirements, unavailability: [], rooms: [], seed: 5 },
      { maxRestarts: 2, minRestarts: 1, maxMoves: 40_000, budgetMs: 10_000 },
    )

    expect(result.diagnostics.moves).toBeGreaterThan(0)
    // Nothing lost or duplicated: every class still has exactly its 24 periods.
    for (let h = 0; h < 6; h++) {
      expect(result.entries.filter((e) => e.homeroomId === `hr${h}`)).toHaveLength(24)
    }
    expect(result.conflicts.filter((c) => c.kind === 'teacher_double_booked')).toHaveLength(0)
    expect(result.conflicts.filter((c) => c.kind === 'homeroom_double_booked')).toHaveLength(0)

    // Every double is still one day, two adjacent periods.
    const blocks = new Map<string, PlacedEntry[]>()
    for (const e of result.entries) {
      if (!e.blockKey) continue
      const arr = blocks.get(e.blockKey) ?? []
      arr.push(e)
      blocks.set(e.blockKey, arr)
    }
    expect(blocks.size).toBeGreaterThan(0)
    const pos = new Map(teaching.map((s) => [s.id, s.position]))
    for (const arr of blocks.values()) {
      expect(arr).toHaveLength(2)
      expect(new Set(arr.map((e) => e.day)).size).toBe(1)
      const [a, b] = arr.map((e) => pos.get(e.slotId)!).sort((x, y) => x - y)
      expect(b - a).toBe(1)
    }
  })

  it('trades two lessons when the week is full and neither can simply move', () => {
    // Every cell of both classes is taken, so relocation has no empty cell to
    // reach — only an exchange can change anything. The search must still finish
    // with both weeks complete and no clash.
    const teaching = slots(2)
    const result = generateTimetable(
      {
        config: config({ working_days: ['monday'] }),
        slots: teaching,
        requirements: [
          requirement({ id: 'a1', homeroom_id: 'hr1', subject_id: 'eng', teacher_id: 't1', teacher_ids: ['t1'] }),
          requirement({ id: 'a2', homeroom_id: 'hr1', subject_id: 'mat', teacher_id: 't2', teacher_ids: ['t2'] }),
          requirement({ id: 'b1', homeroom_id: 'hr2', subject_id: 'eng', teacher_id: 't3', teacher_ids: ['t3'] }),
          requirement({ id: 'b2', homeroom_id: 'hr2', subject_id: 'mat', teacher_id: 't4', teacher_ids: ['t4'] }),
        ],
        unavailability: [], rooms: [], seed: 9,
      },
      { maxRestarts: 1, minRestarts: 1, maxMoves: 500, budgetMs: 5_000 },
    )
    expect(result.unplacedCount).toBe(0)
    expect(result.entries).toHaveLength(4)
    const cells = result.entries.map((e) => `${e.homeroomId}|${e.slotId}`)
    expect(new Set(cells).size).toBe(4)
  })
})

// ── Local search: the scoped-penalty approximation ───────────

describe('the bounded search', () => {
  it('never leaves a school worse than the construction it started from', () => {
    // A move is accepted on a SCOPED penalty — the slice of the score it can
    // change — rather than a full rescan, and a swap sums the slices of two
    // lessons that may overlap. This is the test that the shortcut still agrees
    // with the real, global score it stands in for.
    const teaching = slots(8)
    const requirements: Requirement[] = []
    for (let h = 0; h < 12; h++) {
      for (let s = 0; s < 8; s++) {
        const double = s === 0
        requirements.push(requirement({
          id: `r${h}-${s}`, homeroom_id: `hr${h}`, subject_id: `sub${s}`,
          teacher_id: `t${(h % 4) * 8 + s}`, teacher_ids: [`t${(h % 4) * 8 + s}`],
          periods_per_week: s < 4 ? 5 : 4,
          max_per_day: double ? 2 : 1,
          min_block: double ? 2 : 1,
          max_block: double ? 2 : 1,
        }))
      }
    }
    const input = {
      config: config({ working_days: [...DAYS, 'saturday' as Weekday] }),
      slots: teaching, requirements, unavailability: [], rooms: [],
    }

    for (const seed of [1, 2, 3]) {
      const effort = { maxRestarts: 3, minRestarts: 3, budgetMs: 20_000 }
      const built = generateTimetable({ ...input, seed }, { ...effort, maxMoves: 0 })
      const searched = generateTimetable({ ...input, seed }, { ...effort, maxMoves: 60_000 })

      expect(searched.softPenalty).toBeLessThanOrEqual(built.softPenalty)
      expect(searched.unplacedCount).toBeLessThanOrEqual(built.unplacedCount)
      // It should not merely hold the line — the search is what makes a
      // generated timetable usable, and it has real work to do here.
      //
      // Not a 10x cut any more. That threshold was calibrated when the
      // objective MINIMISED stranded periods, so a packed week scored near
      // zero and the floor was near zero with it. The objective now prefers a
      // teacher's day spread out, and the residual is the deliberately cheap
      // stranded term — measured at 39 of 210 here, all of it stranded, with
      // no teacher run longer than two.
      expect(built.softPenalty).toBeGreaterThan(100)
      expect(searched.softPenalty).toBeLessThan(built.softPenalty * 0.4)
    }
    // Six full generations with a 20 s budget each: ~2 s on a laptop, ~7 s on
    // a GitHub runner — past vitest's 5 s default.
  }, 60_000)
})

// ── Ejection repair ──────────────────────────────────────────
// The phase that goes back for the periods greedy construction had nowhere to
// put. Without it, whatever construction dropped stayed dropped: a school whose
// week is comfortably feasible still came out with lessons missing from it,
// because a lesson dealt with late can find every cell it is allowed to use
// taken by lessons dealt with earlier.

describe('periods construction could not place', () => {
  /**
   * A tight week: every class needs every teacher exactly once, over one day
   * with a single period to spare. Every teacher is then busy for all but one
   * period, so a greedy pass that takes the best-looking cell for each lesson
   * in turn runs out of legal cells for the last few and has to displace
   * earlier lessons to finish. Construction alone leaves three or four periods
   * unplaced here, every seed.
   *
   * `spare` is what the repair has to work with: one lesson is displaced into
   * a free cell at a time, so the week needs somewhere for it to go. A week
   * with no free cell at all could only be completed by a chain of lessons
   * moving at once, which this does not attempt.
   */
  const tightWeek = (size: number, spare = 1) => {
    const teaching = slots(size + spare)
    const requirements: Requirement[] = []
    for (let h = 0; h < size; h++) {
      for (let t = 0; t < size; t++) {
        requirements.push(requirement({
          id: `r${h}-${t}`, homeroom_id: `hr${h}`, subject_id: `sub${t}`,
          teacher_id: `t${t}`, teacher_ids: [`t${t}`], periods_per_week: 1,
        }))
      }
    }
    return {
      config: config({ working_days: ['monday'] }),
      slots: teaching, requirements, unavailability: [], rooms: [],
    }
  }

  it('fills a week that is almost out of room', () => {
    const input = tightWeek(10)
    for (const seed of [1, 2, 3, 4, 5]) {
      const r = generateTimetable({ ...input, seed }, { budgetMs: 8000 })
      expect(r.unplacedCount).toBe(0)
      expect(r.entries).toHaveLength(100)
    }
  })

  it('does not break the week it repairs', () => {
    const r = generateTimetable({ ...tightWeek(10), seed: 42 }, { budgetMs: 8000 })
    // Displacing a lesson to seat another must leave both properly booked:
    // one lesson per class per period, one period per teacher at a time.
    const cells = new Set<string>()
    const teacherCells = new Set<string>()
    for (const e of r.entries) {
      const cell = `${e.homeroomId}|${e.day}|${e.slotId}`
      expect(cells.has(cell)).toBe(false)
      cells.add(cell)
      const tc = `${e.teacherId}|${e.day}|${e.slotId}`
      expect(teacherCells.has(tc)).toBe(false)
      teacherCells.add(tc)
    }
    expect(r.conflicts.filter((c) => c.kind === 'teacher_double_booked')).toHaveLength(0)
    expect(r.conflicts.filter((c) => c.kind === 'homeroom_double_booked')).toHaveLength(0)
  })

  it('never displaces a pinned lesson to make room', () => {
    const input = tightWeek(10)
    // Pin one lesson where the admin put it. Repair may move anything else.
    const pinned: PlacedEntry = {
      homeroomId: 'hr0', day: 'monday', slotId: input.slots[2].id, subjectId: 'sub0',
      teacherId: 't0', teacherIds: ['t0'], roomId: null, isLocked: true,
    }
    for (const seed of [11, 12, 13]) {
      const r = generateTimetable({ ...input, locked: [pinned], seed }, { budgetMs: 8000 })
      const still = r.entries.find(
        (e) => e.homeroomId === 'hr0' && e.subjectId === 'sub0' && e.isLocked,
      )
      expect(still).toBeDefined()
      expect(still!.slotId).toBe(input.slots[2].id)
      expect(still!.day).toBe('monday')
      expect(r.unplacedCount).toBe(0)
    }
  })
})

// ── What a teacher's day should look like ────────────────────

describe('a teacher’s day is spread, not packed', () => {
  it('prices a long unbroken run above a scattered day', () => {
    // Five periods back to back versus five spread across the day. Teachers
    // object to the first, so the objective has to as well.
    const packed = teacherDayPenalty([0, 1, 2, 3, 4])
    const spread = teacherDayPenalty([0, 2, 4, 6, 8])
    expect(packed).toBeGreaterThan(spread)
  })

  it('charges nothing for a pair, and more the longer the run gets', () => {
    expect(teacherDayPenalty([0, 1])).toBe(0)
    const three = teacherDayPenalty([0, 1, 2])
    const four = teacherDayPenalty([0, 1, 2, 3])
    const five = teacherDayPenalty([0, 1, 2, 3, 4])
    expect(three).toBeGreaterThan(0)
    expect(four).toBeGreaterThan(three)
    expect(five).toBeGreaterThan(four)
  })

  it('still prefers two lessons together to two at opposite ends of the day', () => {
    // The other extreme is its own unkindness: period 1 and period 8 strands
    // someone at school all day for two hours of teaching. Spreading wins,
    // but among equally spread weeks the less stranded one wins.
    expect(teacherDayPenalty([3, 4])).toBeLessThan(teacherDayPenalty([0, 7]))
  })

  it('never asks a teacher for more than a pair in a row when the week has room', () => {
    // Twelve classes, eight subjects each, four teachers' worth of load — the
    // same shape as the search test above. Under the previous objective this
    // produced 83 periods beyond a pair in a row, with runs of four.
    const requirements: Requirement[] = []
    for (let h = 0; h < 12; h++) {
      for (let s = 0; s < 8; s++) {
        requirements.push(requirement({
          id: `r${h}-${s}`, homeroom_id: `hr${h}`, subject_id: `sub${s}`,
          teacher_id: `t${(h % 4) * 8 + s}`, teacher_ids: [`t${(h % 4) * 8 + s}`],
          periods_per_week: s < 4 ? 5 : 4,
        }))
      }
    }
    const cfg = config({ working_days: [...DAYS, 'saturday' as Weekday] })
    const slots8 = slots(8)
    const r = generateTimetable(
      { config: cfg, slots: slots8, requirements, unavailability: [], rooms: [], seed: 1 },
      { maxRestarts: 3, minRestarts: 3, budgetMs: 20_000, maxMoves: 60_000 },
    )
    const sched = buildSchedules(cfg, slots8, [], {})

    const byTeacherDay = new Map<string, Set<number>>()
    for (const p of r.entries) {
      for (const t of teacherIdsOf(p)) {
        const k = `${t}|${p.day}`
        if (!byTeacherDay.has(k)) byTeacherDay.set(k, new Set())
        byTeacherDay.get(k)!.add(sched.clock.get(p.slotId) ?? 0)
      }
    }

    let longest = 0
    for (const set of byTeacherDay.values()) {
      const sorted = [...set].sort((a, b) => a - b)
      let run = 1
      for (let i = 1; i <= sorted.length; i++) {
        if (i < sorted.length && sorted[i] === sorted[i - 1] + 1) { run++; continue }
        if (run > longest) longest = run
        run = 1
      }
    }
    expect(byTeacherDay.size).toBeGreaterThan(100) // the sample is real
    expect(longest).toBeLessThanOrEqual(PREFERRED_RUN)
  }, 60_000)
})
