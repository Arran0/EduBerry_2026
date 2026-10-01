import { describe, it, expect } from 'vitest'
import { scheduleWeeks, weekForHomeroom, slotGroupMap } from '@/lib/timetable'
import type {
  PeriodSlot, SlotGroup, SlotGroupHomeroom, TimetableConfig, Weekday,
} from '@/lib/timetable'

const DAYS: Weekday[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday']

const config: TimetableConfig = {
  id: 'cfg', name: 'Main', academic_year: null, working_days: DAYS,
  is_active: true, created_by: null, created_at: '', updated_at: '',
}

const slot = (id: string, position: number, groupId: string | null, isBreak = false): PeriodSlot => ({
  id, config_id: 'cfg', group_id: groupId, position, label: `P${position}`,
  start_time: null, end_time: null, is_break: isBreak, created_at: '', updated_at: '',
})

const group = (id: string, name: string, days: Weekday[], position: number): SlotGroup => ({
  id, config_id: 'cfg', name, working_days: days, position,
  color: null, created_by: null, created_at: '', updated_at: '',
})

describe('scheduleWeeks', () => {
  it('is a single base week when no groups exist', () => {
    const weeks = scheduleWeeks(config, [slot('a', 1, null), slot('b', 2, null)], [])
    expect(weeks).toHaveLength(1)
    expect(weeks[0].groupId).toBeNull()
    expect(weeks[0].days).toEqual(DAYS)
    expect(weeks[0].slots.map((s) => s.id)).toEqual(['a', 'b'])
  })

  it('leaves break slots out of a week', () => {
    const weeks = scheduleWeeks(config, [slot('a', 1, null), slot('lunch', 2, null, true), slot('b', 3, null)], [])
    expect(weeks[0].slots.map((s) => s.id)).toEqual(['a', 'b'])
  })

  it('gives each group its own slots and days', () => {
    const sec = group('g2', 'Secondary', [...DAYS, 'saturday'], 2)
    const weeks = scheduleWeeks(
      config,
      [slot('b1', 1, null), slot('p1', 1, 'g1'), slot('p2', 2, 'g1'), slot('s1', 1, 'g2')],
      [group('g1', 'Primary', DAYS, 1), sec],
    )
    expect(weeks.map((w) => w.name)).toEqual(['Base schedule', 'Primary', 'Secondary'])
    expect(weeks[1].slots.map((s) => s.id)).toEqual(['p1', 'p2'])
    expect(weeks[2].days).toContain('saturday')
    expect(weeks[0].days).not.toContain('saturday')
  })

  it('keeps a group that has no periods yet, but drops an empty base', () => {
    // The solver schedules an assigned class against the empty week and places
    // nothing; hiding the week would show the base schedule instead and make
    // that look like a bug rather than a group still missing its periods.
    const weeks = scheduleWeeks(config, [slot('p1', 1, 'g1')], [group('g1', 'Primary', DAYS, 1), group('g2', 'New', DAYS, 2)])
    expect(weeks.map((w) => w.name)).toEqual(['Primary', 'New'])
    expect(weeks.find((w) => w.name === 'New')!.slots).toHaveLength(0)
  })

  it('falls back to the config week for a group with no days of its own', () => {
    const weeks = scheduleWeeks(config, [slot('p1', 1, 'g1')], [group('g1', 'Primary', [], 1)])
    expect(weeks.find((w) => w.groupId === 'g1')!.days).toEqual(DAYS)
  })
})

describe('weekForHomeroom', () => {
  const groups = [group('g1', 'Primary', DAYS, 1)]
  const slots = [slot('b1', 1, null), slot('p1', 1, 'g1')]
  const weeks = scheduleWeeks(config, slots, groups)

  const rows: SlotGroupHomeroom[] = [
    { id: 'x', config_id: 'cfg', group_id: 'g1', homeroom_id: 'hrP', created_at: '' },
  ]
  const map = slotGroupMap(rows)

  it('routes an assigned class to its group', () => {
    expect(weekForHomeroom(weeks, map, 'hrP').groupId).toBe('g1')
  })

  it('leaves an unassigned class on the base schedule', () => {
    expect(weekForHomeroom(weeks, map, 'hrOther').groupId).toBeNull()
  })

  it('falls back to base when the assigned group is gone', () => {
    expect(weekForHomeroom(weeks, { hrX: 'deleted-group' }, 'hrX').groupId).toBeNull()
  })
})

// ── Who a class is scheduled against ─────────────────────────

import { generateTimetable } from './generator'
import type { Requirement } from './types'

const teachingSlot = (id: string, position: number, groupId: string | null): PeriodSlot => ({
  id, config_id: 'cfg', group_id: groupId, position, label: `P${position}`,
  start_time: null, end_time: null, is_break: false, created_at: '', updated_at: '',
})

const req = (homeroom: string, teacher: string): Requirement => ({
  id: `${homeroom}-eng`, config_id: 'cfg', homeroom_id: homeroom, subject_id: 'eng',
  teacher_id: teacher, teacher_ids: [teacher], periods_per_week: 5,
  room_type: 'classroom', max_per_day: 2, min_block: 1, max_block: 1, group_id: null,
  created_at: '', updated_at: '',
})

describe('a class that was never assigned to a period group', () => {
  const primary = group('g1', 'Primary', DAYS, 1)
  // The school's periods all live in the group; the base schedule has none.
  const groupSlots = [1, 2, 3, 4, 5, 6].map((n) => teachingSlot(`g1-s${n}`, n, 'g1'))

  it('is still scheduled, on the first schedule that has periods', () => {
    // Regression: it used to fall onto the empty base week and lose every
    // period, while the grid went on showing it a normal-looking week.
    const result = generateTimetable({
      config,
      slots: groupSlots,
      slotGroups: [primary],
      homeroomGroupIds: { hrAssigned: 'g1' }, // hrForgotten is missing
      requirements: [req('hrAssigned', 't1'), req('hrForgotten', 't2')],
      constraints: [], unavailability: [], rooms: [], seed: 1,
      homerooms: [
        { id: 'hrAssigned', class_teacher_id: null },
        { id: 'hrForgotten', class_teacher_id: null },
      ],
    })
    expect(result.unplacedCount).toBe(0)
    expect(result.entries.filter((e) => e.homeroomId === 'hrForgotten')).toHaveLength(5)
  })

  it('is shown the same week the solver schedules it against', () => {
    const weeks = scheduleWeeks(config, groupSlots, [primary])
    const shown = weekForHomeroom(weeks, { hrAssigned: 'g1' }, 'hrForgotten')
    expect(shown.slots.length).toBeGreaterThan(0)
    expect(shown.groupId).toBe('g1')
  })

  it('still uses the base schedule when the base has periods of its own', () => {
    const slots = [teachingSlot('base-s1', 1, null), ...groupSlots]
    const weeks = scheduleWeeks(config, slots, [primary])
    expect(weekForHomeroom(weeks, { hrAssigned: 'g1' }, 'hrForgotten').groupId).toBeNull()

    const result = generateTimetable({
      config,
      slots,
      slotGroups: [primary],
      homeroomGroupIds: { hrAssigned: 'g1' },
      requirements: [req('hrForgotten', 't2')],
      constraints: [], unavailability: [], rooms: [], seed: 1,
      homerooms: [{ id: 'hrForgotten', class_teacher_id: null }],
    })
    // One base period a day, five days: all five land on the base slot.
    for (const e of result.entries) expect(e.slotId).toBe('base-s1')
  })
})
