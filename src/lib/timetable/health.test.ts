import { describe, it, expect } from 'vitest'
import { computeHealth } from './health'
import type {
  HealthInput,
} from './health'
import type { PeriodSlot, PlacedEntry, Requirement, TimetableConfig, Weekday } from './types'

const DAYS: Weekday[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday']

const config: TimetableConfig = {
  id: 'cfg', name: 'Main', academic_year: null, working_days: DAYS,
  is_active: true, created_by: null, created_at: '', updated_at: '',
}

const slots = (n: number): PeriodSlot[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `s${i + 1}`, config_id: 'cfg', group_id: null, position: i + 1, label: `P${i + 1}`,
    start_time: null, end_time: null, is_break: false, created_at: '', updated_at: '',
  }))

const requirement = (
  over: Partial<Requirement> & Pick<Requirement, 'id' | 'homeroom_id' | 'subject_id'>,
): Requirement => ({
  config_id: 'cfg', teacher_id: null, teacher_ids: [], periods_per_week: 1,
  room_type: 'classroom', max_per_day: 1, min_block: 1, max_block: 1, group_id: null,
  created_at: '', updated_at: '', ...over,
})

const report = (over: Partial<HealthInput> = {}) =>
  computeHealth({
    entries: [], requirements: [], constraints: [], slots: slots(6), config,
    homerooms: [{ id: 'hr1', class_teacher_id: null }], unavailability: [],
    homeroomName: (id) => id.toUpperCase(),
    teacherName: (id) => id.toUpperCase(),
    subjectName: (id) => id,
    ...over,
  })

describe('health suggestions', () => {
  it('says nothing to do when the week is complete and clean', () => {
    const entries: PlacedEntry[] = DAYS.map((day) => ({
      homeroomId: 'hr1', day, slotId: 's1', subjectId: 'eng',
      teacherId: null, roomId: null, isLocked: false,
    }))
    const r = report({
      entries,
      requirements: [requirement({ id: 'r1', homeroom_id: 'hr1', subject_id: 'eng', periods_per_week: 5 })],
    })
    expect(r.suggestions).toHaveLength(0)
    expect(r.hardViolations).toBe(0)
  })

  it('names the class that asks for more periods than its week holds', () => {
    // 5 days x 6 periods = 30 available; the class asks for 40.
    const r = report({
      requirements: [
        requirement({ id: 'r1', homeroom_id: 'hr1', subject_id: 'eng', periods_per_week: 40, max_per_day: 8 }),
      ],
    })
    const capacity = r.suggestions.find((s) => /Make room in the week/.test(s.title))
    expect(capacity).toBeDefined()
    expect(capacity!.detail).toContain('HR1')
    expect(capacity!.detail).toContain('40')
    expect(capacity!.detail).toContain('30')
  })

  it('counts periods marked time off against the week it offers', () => {
    const off = DAYS.map((day, i) => ({
      id: `c${i}`, config_id: 'cfg', scope: 'homeroom' as const, scope_id: 'hr1',
      homeroom_id: null, type: 'time_off' as const, value: null, day, slot_id: 's1',
      created_at: '', updated_at: '',
    }))
    const r = report({
      constraints: off,
      requirements: [
        requirement({ id: 'r1', homeroom_id: 'hr1', subject_id: 'eng', periods_per_week: 28, max_per_day: 6 }),
      ],
    })
    const capacity = r.suggestions.find((s) => /Make room in the week/.test(s.title))
    // 30 periods less 5 marked off = 25 available against 28 wanted.
    expect(capacity!.detail).toContain('25')
    expect(capacity!.detail).toContain('5 marked time off')
  })

  it('names a teacher booked beyond their own week', () => {
    // 30 periods in the week; one teacher is asked for 36 across three classes.
    const r = report({
      requirements: [1, 2, 3].map((n) =>
        requirement({
          id: `r${n}`, homeroom_id: `hr${n}`, subject_id: 'eng',
          teacher_id: 't1', teacher_ids: ['t1'], periods_per_week: 12, max_per_day: 4,
        }),
      ),
    })
    const load = r.suggestions.find((s) => /over-booked teachers/.test(s.title))
    expect(load).toBeDefined()
    expect(load!.detail).toContain('T1 36/30')
  })

  it('always offers another run when periods are missing', () => {
    const r = report({
      requirements: [requirement({ id: 'r1', homeroom_id: 'hr1', subject_id: 'eng', periods_per_week: 5 })],
    })
    expect(r.suggestions.some((s) => /Generate again/.test(s.title))).toBe(true)
  })

  it('does not blame capacity when the totals fit', () => {
    // 5 periods in a 30-period week: the shortfall cannot be about room.
    const r = report({
      requirements: [requirement({ id: 'r1', homeroom_id: 'hr1', subject_id: 'eng', periods_per_week: 5 })],
    })
    expect(r.suggestions.some((s) => /Make room in the week/.test(s.title))).toBe(false)
    expect(r.suggestions.some((s) => /Loosen what is pinning/.test(s.title))).toBe(true)
  })

  it('points at the clashes when lessons are placed but conflicting', () => {
    // One teacher in two classes at the same time.
    const entries: PlacedEntry[] = [
      { homeroomId: 'hr1', day: 'monday', slotId: 's1', subjectId: 'eng', teacherId: 't1', roomId: null, isLocked: false },
      { homeroomId: 'hr2', day: 'monday', slotId: 's1', subjectId: 'eng', teacherId: 't1', roomId: null, isLocked: false },
    ]
    const r = report({
      entries,
      requirements: [1, 2].map((n) =>
        requirement({
          id: `r${n}`, homeroom_id: `hr${n}`, subject_id: 'eng',
          teacher_id: 't1', teacher_ids: ['t1'], periods_per_week: 1,
        }),
      ),
    })
    expect(r.suggestions.some((s) => /Clear the clashes/.test(s.title))).toBe(true)
    expect(r.hardViolations).toBeGreaterThan(0)
  })

  it('suggests spreading when subjects bunch, but not for deliberate doubles', () => {
    // Seven classes each taught the same subject twice in one day. One repeat
    // is not worth advice; this many is.
    const classes = [1, 2, 3, 4, 5, 6, 7]
    const entries: PlacedEntry[] = classes.flatMap((n) => [
      { homeroomId: `hr${n}`, day: 'monday' as Weekday, slotId: 's1', subjectId: 'eng', teacherId: null, roomId: null, isLocked: false },
      { homeroomId: `hr${n}`, day: 'monday' as Weekday, slotId: 's4', subjectId: 'eng', teacherId: null, roomId: null, isLocked: false },
    ])
    const requirements = classes.map((n) =>
      requirement({ id: `r${n}`, homeroom_id: `hr${n}`, subject_id: 'eng', periods_per_week: 2, max_per_day: 2 }),
    )

    const bunched = report({ entries, requirements })
    expect(bunched.suggestions.some((s) => /bunching/.test(s.title))).toBe(true)

    // The same placements as declared doubles are one lesson each, not a clump.
    const asBlocks = report({
      entries: entries.map((e, i) => ({ ...e, blockKey: `blk${Math.floor(i / 2)}` })),
      requirements: requirements.map((r) => ({ ...r, min_block: 2, max_block: 2 })),
    })
    expect(asBlocks.suggestions.some((s) => /bunching/.test(s.title))).toBe(false)
  })
})
