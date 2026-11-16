import { describe, it, expect } from 'vitest'
import { numberPeriods, periodsForDates, slotConfigIds, type TeacherTimetable } from './taskTimetable'
import { classLabel, sortClassLabels, taskDisplayTitle } from './taskClasses'
import type { EntryOverride } from './timetable/overrides'

const T = 'teacher-1'
const OTHER = 'teacher-2'

// Mon 19 Oct 2026 – Sun 25 Oct 2026.
const MON = '2026-10-19'
const TUE = '2026-10-20'

const slot = (id: string, groupId: string | null, position: number, isBreak = false) => ({
  id, config_id: 'cfg', group_id: groupId, position, is_break: isBreak,
})

const override = (over: Partial<EntryOverride> & Pick<EntryOverride, 'id' | 'homeroom_id' | 'day' | 'slot_id'>): EntryOverride => ({
  config_id: 'cfg', timetable_id: null, group_id: null, effective_from: MON, effective_to: MON,
  kind: 'replace', subject_id: null, teacher_id: null, teacher_ids: null, room_id: null, note: null,
  created_at: '2026-10-01T00:00:00Z', updated_at: '', created_by: null,
  ...over,
})

describe('numberPeriods', () => {
  it('numbers each group from 1 and skips breaks', () => {
    const { periodOf, countOf } = numberPeriods([
      slot('p1', 'primary', 1), slot('p2', 'primary', 2), slot('pb', 'primary', 3, true), slot('p3', 'primary', 4),
      slot('s1', 'secondary', 1), slot('s2', 'secondary', 2), slot('s3', 'secondary', 3), slot('s4', 'secondary', 4),
    ])
    expect(periodOf.get('p3')).toBe(3)
    expect(periodOf.get('s3')).toBe(3)
    expect(periodOf.has('pb')).toBe(false)
    expect(countOf.get('cfg|primary')).toBe(3)
    expect(countOf.get('cfg|secondary')).toBe(4)
  })
})

describe('slotConfigIds', () => {
  const cfg = (id: string, is_active: boolean, created_at: string) => ({ id, is_active, created_at })

  it('uses every active config', () => {
    expect(slotConfigIds([cfg('a', true, '2026-01-01'), cfg('b', false, '2026-06-01'), cfg('c', true, '2026-03-01')]))
      .toEqual(['a', 'c'])
  })

  it('falls back to the newest config while none is published', () => {
    expect(slotConfigIds([cfg('old', false, '2025-04-01'), cfg('new', false, '2026-04-01')])).toEqual(['new'])
  })

  it('is empty with no configs', () => {
    expect(slotConfigIds([])).toEqual([])
  })
})

describe('periodsForDates', () => {
  const base = (): TeacherTimetable => ({
    periodCount: 8,
    cells: [
      { homeroomId: 'hr7b', day: 'monday', slotId: 's1', groupId: null },
      { homeroomId: 'hr7c', day: 'monday', slotId: 's3', groupId: null },
      // A combined lesson: two classes in one period.
      { homeroomId: 'hr8a', day: 'tuesday', slotId: 's2', groupId: null },
      { homeroomId: 'hr8b', day: 'tuesday', slotId: 's2', groupId: null },
    ],
    overrides: [],
    periodOf: new Map([['s1', 1], ['s2', 2], ['s3', 3], ['s4', 4]]),
    classOf: new Map([['hr7b', '7B'], ['hr7c', '7C'], ['hr8a', '8A'], ['hr8b', '8B'], ['hr9a', '9A']]),
  })

  it('gives each lesson its date and period number', () => {
    expect(periodsForDates(base(), T, [MON, TUE])).toEqual([
      { date: MON, period: 1, classes: ['7B'] },
      { date: MON, period: 3, classes: ['7C'] },
      { date: TUE, period: 2, classes: ['8A', '8B'] },
    ])
  })

  it('only covers the dates asked for', () => {
    expect(periodsForDates(base(), T, [TUE]).map(p => p.date)).toEqual([TUE])
  })

  it('drops a cancelled period and one handed to another teacher, on that date only', () => {
    const tt = base()
    tt.overrides = [
      override({ id: 'o1', homeroom_id: 'hr7b', day: 'monday', slot_id: 's1', kind: 'cancel' }),
      override({ id: 'o2', homeroom_id: 'hr7c', day: 'monday', slot_id: 's3', teacher_id: OTHER, teacher_ids: [OTHER] }),
    ]
    expect(periodsForDates(tt, T, [MON])).toEqual([])
    // The next Monday is untouched.
    expect(periodsForDates(tt, T, ['2026-10-26'])).toHaveLength(2)
  })

  it('brings in a cover lesson given to this teacher', () => {
    const tt = base()
    tt.overrides = [override({ id: 'o3', homeroom_id: 'hr9a', day: 'monday', slot_id: 's4', teacher_id: T, teacher_ids: [T] })]
    expect(periodsForDates(tt, T, [MON])).toContainEqual({ date: MON, period: 4, classes: ['9A'] })
  })

  it('ignores a cover lesson a later override has taken back', () => {
    const tt = base()
    tt.overrides = [
      override({ id: 'late', homeroom_id: 'hr9a', day: 'monday', slot_id: 's4', teacher_id: OTHER, teacher_ids: [OTHER], created_at: '2026-10-05T00:00:00Z' }),
      override({ id: 'early', homeroom_id: 'hr9a', day: 'monday', slot_id: 's4', teacher_id: T, teacher_ids: [T] }),
    ]
    expect(periodsForDates(tt, T, [MON]).some(p => p.period === 4)).toBe(false)
  })

  it('keeps a lesson whose replacement still includes this teacher', () => {
    const tt = base()
    tt.overrides = [override({ id: 'o4', homeroom_id: 'hr7b', day: 'monday', slot_id: 's1', teacher_id: OTHER, teacher_ids: [OTHER, T] })]
    expect(periodsForDates(tt, T, [MON])[0]).toEqual({ date: MON, period: 1, classes: ['7B'] })
  })
})

describe('class labels', () => {
  it('reads grade and section the short way', () => {
    expect(classLabel({ grade: 7, section: 'B' })).toBe('7B')
    expect(classLabel({ grade: -2, section: 'A' })).toBe('LKG A')
    expect(classLabel({ grade: -3, section: 'A' })).toBe('Pre-KG A')
    expect(classLabel({ grade: null, section: null, name: 'Choir' })).toBe('Choir')
  })

  it('sorts by grade, then section, with no repeats', () => {
    expect(sortClassLabels(['10A', '7C', 'LKG B', '7B', 'Pre-KG A', '7B', 'UKG A'])).toEqual(
      ['Pre-KG A', 'LKG B', 'UKG A', '7B', '7C', '10A'],
    )
  })

  it('puts the classes after the name', () => {
    expect(taskDisplayTitle({ title: 'Fractions recap', classes: ['7B', '7C'] })).toBe('Fractions recap · 7B, 7C')
    expect(taskDisplayTitle({ title: '', classes: ['7B'] })).toBe('7B')
    expect(taskDisplayTitle({ title: 'Staff meeting', classes: [] })).toBe('Staff meeting')
  })
})
