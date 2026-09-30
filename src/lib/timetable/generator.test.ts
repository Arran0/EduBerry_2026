import { describe, it, expect } from 'vitest'
import { generateTimetable } from './generator'
import type {
  GeneratorInput, PeriodSlot, Requirement, TimetableConfig, SlotGroup, Weekday, PlacedEntry,
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
