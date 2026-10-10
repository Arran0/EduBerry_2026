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

describe('teacher idle gaps', () => {
  // A teacher with period 1 and period 6 and nothing between has four free
  // periods in the middle of their day. That is spacing, not a defect.
  const gappy: PlacedEntry[] = [
    { homeroomId: 'hr1', day: 'monday', slotId: 's1', subjectId: 'eng', teacherId: 't1', teacherIds: ['t1'], roomId: null, isLocked: false },
    { homeroomId: 'hr1', day: 'monday', slotId: 's6', subjectId: 'eng', teacherId: 't1', teacherIds: ['t1'], roomId: null, isLocked: false },
  ]
  const r = () => report({
    entries: gappy,
    requirements: [requirement({ id: 'r1', homeroom_id: 'hr1', subject_id: 'eng', periods_per_week: 2, max_per_day: 2 })],
  })

  it('is not scored as a category', () => {
    const keys = r().components.map((c) => c.key)
    expect(keys).not.toContain('gaps')
    expect(keys).toEqual(['coverage', 'clash', 'constraints', 'spread', 'balance'])
  })

  it('is not raised as an issue or a suggestion', () => {
    const report0 = r()
    expect(report0.issues.some((i) => /idle|gap/i.test(i.message))).toBe(false)
    expect(report0.suggestions.some((s) => /idle|gap|stranded/i.test(s.title + s.detail))).toBe(false)
  })

  it('leaves the weights summing to one so the score still reaches 100', () => {
    const total = r().components.reduce((n, c) => n + c.weight, 0)
    expect(total).toBeCloseTo(1, 6)
  })
})

describe('the breakdown footnotes', () => {
  it('explains every category it shows', () => {
    for (const c of report().components) {
      expect(c.help.length).toBeGreaterThan(20)
      expect(c.help.endsWith('.')).toBe(true)
    }
  })
})

// ── Lessons that can never be placed ─────────────────────────
// Time off can leave a lesson with nowhere legal to sit at all. The solver can
// only report that afterwards, as "could not fit", which reads as bad luck and
// sends the admin back to Generate. Knowable before a single period is placed,
// so it is said up front and by name.

describe('lessons time off has left nowhere to sit', () => {
  /** Time off for a subject in every cell except the ones listed. */
  const subjectOffExcept = (
    subjectId: string, keep: { day: Weekday; slot: string }[], slotList: PeriodSlot[],
  ) => {
    const kept = new Set(keep.map((k) => `${k.day}__${k.slot}`))
    const out = []
    for (const day of DAYS) {
      for (const s of slotList) {
        if (kept.has(`${day}__${s.id}`)) continue
        out.push({
          id: `off-${day}-${s.id}`, config_id: 'cfg', scope: 'subject' as const,
          scope_id: subjectId, homeroom_id: null, type: 'time_off' as const,
          value: null, day, slot_id: s.id, created_at: '', updated_at: '',
        })
      }
    }
    return out
  }

  it('names a double whose only free periods are never back-to-back', () => {
    const slotList = slots(6)
    // Assembly is allowed in exactly two periods all week, on different days,
    // so it can never run as the double it is set up as.
    const r = report({
      slots: slotList,
      constraints: subjectOffExcept('assembly', [
        { day: 'monday', slot: slotList[0].id },
        { day: 'friday', slot: slotList[0].id },
      ], slotList),
      requirements: [
        requirement({
          id: 'r1', homeroom_id: 'hr1', subject_id: 'assembly',
          periods_per_week: 2, max_per_day: 2, min_block: 2, max_block: 2,
        }),
      ],
    })
    const s = r.suggestions.find((x) => /period they are allowed to use/.test(x.title))
    expect(s).toBeDefined()
    expect(s!.detail).toContain('assembly')
    expect(s!.detail).toContain('HR1')
    expect(s!.detail).toContain('2 back-to-back periods')
    expect(s!.detail).toContain('never more than 1 of them in a row')
  })

  it('names a lesson with more periods to place than cells to put them in', () => {
    const slotList = slots(6)
    const r = report({
      slots: slotList,
      constraints: subjectOffExcept('music', [
        { day: 'monday', slot: slotList[0].id },
        { day: 'tuesday', slot: slotList[1].id },
      ], slotList),
      requirements: [
        requirement({ id: 'r1', homeroom_id: 'hr1', subject_id: 'music', periods_per_week: 5 }),
      ],
    })
    const s = r.suggestions.find((x) => /period they are allowed to use/.test(x.title))
    expect(s!.detail).toContain('asks for 5 periods but time off leaves it only 2')
  })

  it('says nothing when every lesson has somewhere it could go', () => {
    const r = report({
      requirements: [
        requirement({ id: 'r1', homeroom_id: 'hr1', subject_id: 'eng', periods_per_week: 5 }),
      ],
    })
    expect(r.suggestions.some((x) => /period they are allowed to use/.test(x.title))).toBe(false)
  })

  it('counts an unplaced combined lesson as missing coverage', () => {
    const slotList = slots(6)
    const combined = [{
      id: 'cmb1', subjectId: 'assembly', teacherId: null, teacherIds: [], roomId: null,
      roomType: 'classroom' as const, periodsPerWeek: 2, maxPerDay: 2, minBlock: 2, maxBlock: 2,
      members: [{ homeroomId: 'hr1', groupId: null }, { homeroomId: 'hr2', groupId: null }],
    }]
    // Nothing placed for it: scoring only timetable_requirements used to call
    // this a perfect week.
    const r = report({ slots: slotList, combined, requirements: [] })
    expect(r.issues.some((i) => /assembly/.test(i.message) && /short by 2/.test(i.message))).toBe(true)
    const coverage = r.components.find((c) => c.key === 'coverage')
    expect(coverage!.score).toBe(0)
  })
})

describe('daily balance', () => {
  const balanceOf = (entries: PlacedEntry[], homeroomIds: string[]) =>
    report({
      entries,
      homerooms: homeroomIds.map((id) => ({ id, class_teacher_id: null })),
    }).components.find((c) => c.key === 'balance')!.score

  /** `perDay` periods in every class, on every day. */
  const evenWeek = (classes: number, perDay: number): PlacedEntry[] => {
    const out: PlacedEntry[] = []
    for (let c = 0; c < classes; c++) {
      for (const day of DAYS) {
        for (let p = 0; p < perDay; p++) {
          out.push({
            homeroomId: `hr${c}`, day, slotId: `s${p + 1}`, subjectId: `sub${p}`,
            teacherId: null, roomId: null, isLocked: false,
          })
        }
      }
    }
    return out
  }

  it('is full marks for a week with the same load every day', () => {
    const ids = Array.from({ length: 4 }, (_, i) => `hr${i}`)
    expect(balanceOf(evenWeek(4, 4), ids)).toBe(100)
  })

  /** 4 periods a day, plus a 5th on Monday — the ordinary odd remainder. */
  const slightlyUneven = (classes: number): PlacedEntry[] => {
    const out = evenWeek(classes, 4)
    for (let c = 0; c < classes; c++) {
      out.push({
        homeroomId: `hr${c}`, day: 'monday', slotId: 's5', subjectId: 'extra',
        teacherId: null, roomId: null, isLocked: false,
      })
    }
    return out
  }

  it('does not fall apart as the school gets bigger', () => {
    // The regression. The old metric SUMMED every class-day's deviation
    // instead of averaging it, so a week whose periods simply do not divide
    // evenly into five days — which is most weeks — scored 0 the moment the
    // school had more than a dozen classes, and scored the same as a week
    // with every lesson crammed onto one day. Balance is a property of the
    // shape of a week, not of how many classes share that shape.
    const ids = (n: number) => Array.from({ length: n }, (_, i) => `hr${i}`)
    const small = balanceOf(slightlyUneven(2), ids(2))
    const large = balanceOf(slightlyUneven(34), ids(34))
    // Equal bar float noise — the metric is scale-invariant by construction.
    expect(large).toBeCloseTo(small, 6)
    // And a near-even week is a good one, not a zero.
    expect(large).toBeGreaterThan(60)
  })

  it('marks down a week stacked onto fewer days', () => {
    // 20 periods for one class, all on Monday and Tuesday: three empty days.
    const lumpy: PlacedEntry[] = []
    for (const day of ['monday', 'tuesday'] as Weekday[]) {
      for (let p = 0; p < 6; p++) {
        lumpy.push({
          homeroomId: 'hr0', day, slotId: `s${p + 1}`, subjectId: `sub${p}`,
          teacherId: null, roomId: null, isLocked: false,
        })
      }
    }
    const stacked = balanceOf(lumpy, ['hr0'])
    const even = balanceOf(evenWeek(1, 4), ['hr0'])
    expect(stacked).toBeLessThan(even)
    expect(stacked).toBeLessThan(50)
  })

  it('counts a class’s empty day as the imbalance it is', () => {
    // Four days of four periods and one day of none scores worse than four
    // days of four periods in a four-day week, where nothing is missing.
    const fourOfFive: PlacedEntry[] = []
    for (const day of ['monday', 'tuesday', 'wednesday', 'thursday'] as Weekday[]) {
      for (let p = 0; p < 4; p++) {
        fourOfFive.push({
          homeroomId: 'hr0', day, slotId: `s${p + 1}`, subjectId: `sub${p}`,
          teacherId: null, roomId: null, isLocked: false,
        })
      }
    }
    expect(balanceOf(fourOfFive, ['hr0'])).toBeLessThan(100)
  })
})
