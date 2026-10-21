import { describe, it, expect } from 'vitest'
import { teacherWorkloads, overloadedTeachers, withExtraPeriods } from './workload'
import type {
  CombinedClassInput, PeriodSlot, Requirement, SlotGroup, TimetableConfig,
  TimetableConstraint, Weekday,
} from './types'

const DAYS: Weekday[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday']

const config: TimetableConfig = {
  id: 'cfg', name: 'Main', academic_year: null, working_days: DAYS,
  is_active: true, created_by: null, created_at: '', updated_at: '',
}

const slots = (n: number, groupId: string | null = null, startHour = 9): PeriodSlot[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `${groupId ?? 'base'}-s${i + 1}`, config_id: 'cfg', group_id: groupId,
    position: i + 1, label: `P${i + 1}`,
    start_time: `${String(startHour + i).padStart(2, '0')}:00`,
    end_time: `${String(startHour + i).padStart(2, '0')}:45`,
    is_break: false, created_at: '', updated_at: '',
  }))

const req = (
  over: Partial<Requirement> & Pick<Requirement, 'id' | 'homeroom_id' | 'subject_id'>,
): Requirement => ({
  config_id: 'cfg', teacher_id: null, teacher_ids: [], periods_per_week: 1,
  room_type: 'classroom', max_per_day: 2, min_block: 1, max_block: 1, group_id: null,
  created_at: '', updated_at: '', ...over,
})

const timeOff = (teacherId: string, day: Weekday, slotId: string): TimetableConstraint => ({
  id: `${teacherId}-${day}-${slotId}`, config_id: 'cfg', scope: 'teacher', scope_id: teacherId,
  homeroom_id: null, type: 'time_off', value: null, day, slot_id: slotId,
  created_at: '', updated_at: '',
})

const load = (over: Partial<Parameters<typeof teacherWorkloads>[0]> = {}) =>
  teacherWorkloads({ config, slots: slots(6), requirements: [], constraints: [], ...over })

describe('teacher workload', () => {
  it('counts a teacher against the periods their week actually has', () => {
    // 5 days x 6 periods = 30.
    const [w] = load({
      requirements: [
        req({ id: 'r1', homeroom_id: 'hr1', subject_id: 'eng', teacher_id: 't1', teacher_ids: ['t1'], periods_per_week: 12 }),
        req({ id: 'r2', homeroom_id: 'hr2', subject_id: 'eng', teacher_id: 't1', teacher_ids: ['t1'], periods_per_week: 12 }),
      ],
    })
    expect(w.assigned).toBe(24)
    expect(w.capacity).toBe(30)
    expect(w.over).toBe(0)
  })

  it('reports the overload when they are asked for more than the week holds', () => {
    const [w] = load({
      requirements: [1, 2, 3].map((n) =>
        req({ id: `r${n}`, homeroom_id: `hr${n}`, subject_id: 'eng', teacher_id: 't1', teacher_ids: ['t1'], periods_per_week: 12 }),
      ),
    })
    expect(w.assigned).toBe(36)
    expect(w.capacity).toBe(30)
    expect(w.over).toBe(6)
    expect(overloadedTeachers([w])).toHaveLength(1)
  })

  it('takes the teacher’s own time off out of their capacity', () => {
    const off = DAYS.map((d) => timeOff('t1', d, 'base-s1'))
    const [w] = load({
      constraints: off,
      requirements: [
        req({ id: 'r1', homeroom_id: 'hr1', subject_id: 'eng', teacher_id: 't1', teacher_ids: ['t1'], periods_per_week: 26 }),
      ],
    })
    expect(w.timeOff).toBe(5)
    expect(w.capacity).toBe(25)
    expect(w.over).toBe(1)
  })

  it('counts every teacher of a co-taught lesson', () => {
    const list = load({
      requirements: [
        req({ id: 'r1', homeroom_id: 'hr1', subject_id: 'sci', teacher_id: 't1', teacher_ids: ['t1', 't2'], periods_per_week: 5 }),
      ],
    })
    expect(list.map((w) => w.teacherId).sort()).toEqual(['t1', 't2'])
    for (const w of list) expect(w.assigned).toBe(5)
  })

  it('counts a combined lesson once, not once per class', () => {
    // Assembly for three classes is still one period of this teacher's time.
    const combined: CombinedClassInput[] = [{
      id: 'c1', subjectId: 'assembly', teacherId: 't1', teacherIds: ['t1'],
      roomId: null, roomType: 'classroom', periodsPerWeek: 5,
      maxPerDay: 1, minBlock: 1, maxBlock: 1,
      members: [
        { homeroomId: 'hr1', groupId: null },
        { homeroomId: 'hr2', groupId: null },
        { homeroomId: 'hr3', groupId: null },
      ],
    }]
    const [w] = load({ combined })
    expect(w.assigned).toBe(5)
  })

  it('treats a max-per-week limit as the binding capacity', () => {
    const cap: TimetableConstraint = {
      id: 'cap', config_id: 'cfg', scope: 'teacher', scope_id: 't1', homeroom_id: null,
      type: 'max_per_week', value: 20, day: null, slot_id: null, created_at: '', updated_at: '',
    }
    const [w] = load({
      constraints: [cap],
      requirements: [
        req({ id: 'r1', homeroom_id: 'hr1', subject_id: 'eng', teacher_id: 't1', teacher_ids: ['t1'], periods_per_week: 24 }),
      ],
    })
    expect(w.capacity).toBe(20)
    expect(w.weeklyCap).toBe(20)
    expect(w.over).toBe(4)
  })

  it('counts overlapping periods of two bands once, not twice', () => {
    // Both bands run 09:00 and 10:00, so a teacher in both still has 2 periods
    // a day available, not 4.
    const primary: SlotGroup = {
      id: 'g1', config_id: 'cfg', name: 'Primary', working_days: DAYS,
      position: 1, color: null, created_by: null, created_at: '', updated_at: '',
    }
    const secondary: SlotGroup = { ...primary, id: 'g2', name: 'Secondary', position: 2 }
    const [w] = load({
      slots: [...slots(2, 'g1', 9), ...slots(2, 'g2', 9)],
      slotGroups: [primary, secondary],
      homeroomGroupIds: { hrP: 'g1', hrS: 'g2' },
      requirements: [
        req({ id: 'r1', homeroom_id: 'hrP', subject_id: 'eng', teacher_id: 't1', teacher_ids: ['t1'], periods_per_week: 5 }),
        req({ id: 'r2', homeroom_id: 'hrS', subject_id: 'mus', teacher_id: 't1', teacher_ids: ['t1'], periods_per_week: 6 }),
      ],
    })
    // 5 days x 2 distinct hours = 10, not 20.
    expect(w.capacity).toBe(10)
    expect(w.assigned).toBe(11)
    expect(w.over).toBe(1)
  })

  it('gives a teacher who works across bands one week of period numbers', () => {
    // Periods are numbered, not timed: period 1 of Primary and period 1 of
    // Secondary are one period, whatever clock times the slots still carry.
    // A teacher in both has the longer band's day — 3 periods, 5 days.
    const primary: SlotGroup = {
      id: 'g1', config_id: 'cfg', name: 'Primary', working_days: DAYS,
      position: 1, color: null, created_by: null, created_at: '', updated_at: '',
    }
    const secondary: SlotGroup = { ...primary, id: 'g2', name: 'Secondary', position: 2 }
    const [w] = load({
      slots: [...slots(2, 'g1', 9), ...slots(3, 'g2', 14)],
      slotGroups: [primary, secondary],
      homeroomGroupIds: { hrP: 'g1', hrS: 'g2' },
      requirements: [
        req({ id: 'r1', homeroom_id: 'hrP', subject_id: 'eng', teacher_id: 't1', teacher_ids: ['t1'], periods_per_week: 8 }),
        req({ id: 'r2', homeroom_id: 'hrS', subject_id: 'mus', teacher_id: 't1', teacher_ids: ['t1'], periods_per_week: 8 }),
      ],
    })
    expect(w.capacity).toBe(15)
    expect(w.over).toBe(1)
  })

  it('reports the most over-booked teacher first', () => {
    const list = load({
      requirements: [
        req({ id: 'r1', homeroom_id: 'hr1', subject_id: 'eng', teacher_id: 'mild', teacher_ids: ['mild'], periods_per_week: 32 }),
        req({ id: 'r2', homeroom_id: 'hr2', subject_id: 'eng', teacher_id: 'bad', teacher_ids: ['bad'], periods_per_week: 50 }),
        req({ id: 'r3', homeroom_id: 'hr3', subject_id: 'eng', teacher_id: 'fine', teacher_ids: ['fine'], periods_per_week: 10 }),
      ],
    })
    expect(list.map((w) => w.teacherId)).toEqual(['bad', 'mild', 'fine'])
  })
})

describe('projecting a requirement before it is saved', () => {
  const base = () =>
    teacherWorkloads({
      config, slots: slots(6), constraints: [],
      requirements: [
        req({ id: 'r1', homeroom_id: 'hr1', subject_id: 'eng', teacher_id: 't1', teacher_ids: ['t1'], periods_per_week: 28 }),
      ],
    })[0]

  it('shows the overload the new periods would cause', () => {
    // 28 of 30 used; five more does not fit.
    const after = withExtraPeriods(base(), 5)
    expect(after).toEqual({ assigned: 33, capacity: 30, over: 3 })
  })

  it('shows no overload when the new periods still fit', () => {
    expect(withExtraPeriods(base(), 2)).toEqual({ assigned: 30, capacity: 30, over: 0 })
  })

  it('handles editing a requirement downwards', () => {
    expect(withExtraPeriods(base(), -10)!.assigned).toBe(18)
  })

  it('has nothing to say about a teacher with no work yet', () => {
    expect(withExtraPeriods(undefined, 5)).toBeNull()
  })
})
