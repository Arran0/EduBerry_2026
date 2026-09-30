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
