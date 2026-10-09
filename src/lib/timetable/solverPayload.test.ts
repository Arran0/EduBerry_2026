import { describe, it, expect } from 'vitest'
import {
  buildSolverPayload, buildSolverHint, materialisePlacements,
} from './solverPayload'
import { generateTimetable, detectConflicts } from './generator'
import type {
  CombinedClassInput, GeneratorInput, PeriodSlot, Requirement, Room, TimetableConfig, Weekday,
} from './types'

const DAYS: Weekday[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday']

const config = (over: Partial<TimetableConfig> = {}): TimetableConfig => ({
  id: 'cfg', name: 'Main', academic_year: null, working_days: DAYS,
  is_active: true, created_by: null, created_at: '', updated_at: '', ...over,
})

/** `count` teaching periods; `breakAfter` inserts a break slot after that index. */
const slots = (count: number, breakAfter?: number): PeriodSlot[] => {
  const out: PeriodSlot[] = []
  let position = 1
  for (let i = 0; i < count; i++) {
    out.push({
      id: `s${i}`, config_id: 'cfg', group_id: null, position: position++,
      label: `P${i + 1}`, start_time: null, end_time: null, is_break: false,
      created_at: '', updated_at: '',
    })
    if (breakAfter === i) {
      out.push({
        id: `brk${i}`, config_id: 'cfg', group_id: null, position: position++,
        label: 'Break', start_time: null, end_time: null, is_break: true,
        created_at: '', updated_at: '',
      })
    }
  }
  return out
}

const requirement = (
  over: Partial<Requirement> & Pick<Requirement, 'id' | 'homeroom_id' | 'subject_id'>,
): Requirement => ({
  config_id: 'cfg', teacher_id: null, teacher_ids: [], periods_per_week: 1,
  room_type: 'classroom', max_per_day: 1, min_block: 1, max_block: 1, group_id: null,
  created_at: '', updated_at: '', ...over,
})

const room = (id: string, room_type: Room['room_type'] = 'classroom'): Room => ({
  id, name: id, room_type, capacity: null, created_by: null, created_at: '', updated_at: '',
})

const input = (over: Partial<GeneratorInput> & Pick<GeneratorInput, 'requirements'>): GeneratorInput => ({
  config: config(), slots: slots(6), unavailability: [], rooms: [], ...over,
})

describe('the problem handed to the constraint solver', () => {
  it('describes the week by its teaching periods, breaks excluded', () => {
    const p = buildSolverPayload(input({
      slots: slots(4, 1), // a break after the second period
      requirements: [requirement({ id: 'r1', homeroom_id: 'hr1', subject_id: 'eng' })],
    }))
    expect(p.schedules).toHaveLength(1)
    expect(p.schedules[0].slotIds).toEqual(['s0', 's1', 's2', 's3'])
    // The break sits between s1 and s2, so those two are not consecutive.
    expect(p.schedules[0].adjacentNext).toEqual([true, false, true])
  })

  it('expands a requirement into one lesson per block, not per period', () => {
    const p = buildSolverPayload(input({
      requirements: [requirement({
        id: 'r1', homeroom_id: 'hr1', subject_id: 'eng',
        periods_per_week: 4, max_per_day: 2, min_block: 2, max_block: 2,
      })],
    }))
    expect(p.lessons).toHaveLength(2)
    expect(p.lessons.every((l) => l.size === 2)).toBe(true)
    expect(p.lessons.every((l) => l.sourceId === 'r1')).toBe(true)
  })

  it('gives a combined lesson every class it occupies', () => {
    const combined: CombinedClassInput[] = [{
      id: 'cmb', subjectId: 'assembly', teacherId: 't1', teacherIds: ['t1'], roomId: null,
      roomType: 'classroom', periodsPerWeek: 1, maxPerDay: 1, minBlock: 1, maxBlock: 1,
      members: [{ homeroomId: 'hr1', groupId: null }, { homeroomId: 'hr2', groupId: null }],
    }]
    const p = buildSolverPayload(input({
      requirements: [requirement({ id: 'r1', homeroom_id: 'hr1', subject_id: 'eng' })],
      combined,
    }))
    const lesson = p.lessons.find((l) => l.kind === 'combined')
    expect(lesson).toBeDefined()
    expect(lesson!.classes.map((c) => c.homeroomId).sort()).toEqual(['hr1', 'hr2'])
  })

  it('carries time off as the cell keys it covers', () => {
    const p = buildSolverPayload(input({
      requirements: [requirement({ id: 'r1', homeroom_id: 'hr1', subject_id: 'eng' })],
      constraints: [{
        id: 'c1', config_id: 'cfg', scope: 'subject', scope_id: 'eng', homeroom_id: null,
        type: 'time_off', value: null, day: 'monday', slot_id: 's0',
        created_at: '', updated_at: '',
      }],
    }))
    expect(p.timeOff.subject.eng).toEqual(['monday__s0'])
  })

  it('leaves ordinary classrooms out of the room capacities', () => {
    const p = buildSolverPayload(input({
      requirements: [requirement({ id: 'r1', homeroom_id: 'hr1', subject_id: 'eng' })],
      rooms: [room('c1'), room('c2'), room('lab1', 'science_lab')],
    }))
    // A class owns its room and is in one lesson at a time, so classrooms are
    // not a contended pool; a lab is.
    expect(p.roomCapacity.classroom).toBeUndefined()
    expect(p.roomCapacity.science_lab).toBe(1)
  })
})

describe('the warm start handed to the constraint solver', () => {
  const doubleAndSingles = () => input({
    slots: slots(6),
    requirements: [
      requirement({
        id: 'rd', homeroom_id: 'hr1', subject_id: 'games',
        periods_per_week: 2, max_per_day: 2, min_block: 2, max_block: 2,
        teacher_id: 't1', teacher_ids: ['t1'],
      }),
      requirement({
        id: 'rs', homeroom_id: 'hr1', subject_id: 'eng', periods_per_week: 3,
        teacher_id: 't2', teacher_ids: ['t2'],
      }),
    ],
    combined: [{
      id: 'cmb', subjectId: 'assembly', teacherId: 't3', teacherIds: ['t3'], roomId: null,
      roomType: 'classroom', periodsPerWeek: 2, maxPerDay: 2, minBlock: 2, maxBlock: 2,
      members: [{ homeroomId: 'hr1', groupId: null }, { homeroomId: 'hr2', groupId: null }],
    }],
    seed: 5,
  })

  it('matches every lesson of a generated week, doubles and combined included', () => {
    const gen = doubleAndSingles()
    const payload = buildSolverPayload(gen)
    const built = generateTimetable(gen, { budgetMs: 4000 })
    expect(built.unplacedCount).toBe(0)

    const hint = buildSolverHint(payload, built.entries)
    // A combined key embeds the day and slot, so every period of a combined
    // double carries a different one. Grouping by it split each double into two
    // single periods that matched no lesson, and the warm start lost them
    // silently — which cost the solver its whole reason for existing.
    expect(Object.keys(hint)).toHaveLength(payload.lessons.length)
  })

  it('points each lesson at the first period of its run', () => {
    const gen = doubleAndSingles()
    const payload = buildSolverPayload(gen)
    const built = generateTimetable(gen, { budgetMs: 4000 })
    const hint = buildSolverHint(payload, built.entries)

    for (const lesson of payload.lessons) {
      const at = hint[lesson.id]
      expect(at, lesson.id).toBeDefined()
      const wire = payload.schedules.find((s) => s.key === lesson.scheduleKey)!
      // The run has to fit in the week from where it starts.
      expect(at[1] + lesson.size).toBeLessThanOrEqual(wire.slotIds.length)
    }
  })
})

describe('reading the solver answer back', () => {
  it('round-trips a generated week through the payload without a conflict', () => {
    const gen = input({
      requirements: [1, 2, 3].map((n) =>
        requirement({
          id: `r${n}`, homeroom_id: `hr${n}`, subject_id: 'eng',
          periods_per_week: 4, teacher_id: `t${n}`, teacher_ids: [`t${n}`],
        }),
      ),
      rooms: [room('c1'), room('c2'), room('c3')],
      seed: 9,
    })
    const payload = buildSolverPayload(gen)
    const built = generateTimetable(gen, { budgetMs: 4000 })
    const hint = buildSolverHint(payload, built.entries)

    // The hint IS a solution, so materialising it must reproduce a valid week.
    const placements = Object.entries(hint).map(([lessonId, [day, start]]) => ({
      lessonId, day, start,
      size: payload.lessons.find((l) => l.id === lessonId)!.size,
    }))
    const entries = materialisePlacements(payload, placements, gen.rooms, ['hr1', 'hr2', 'hr3'])

    expect(entries).toHaveLength(built.entries.length)
    const conflicts = detectConflicts(entries, [], [], [])
    const hard = conflicts.filter((c) =>
      ['teacher_double_booked', 'homeroom_double_booked', 'room_double_booked'].includes(c.kind),
    )
    expect(hard).toEqual([])
  })

  it('tags every period of a block with one shared key', () => {
    const gen = input({
      requirements: [requirement({
        id: 'rd', homeroom_id: 'hr1', subject_id: 'games',
        periods_per_week: 2, max_per_day: 2, min_block: 2, max_block: 2,
      })],
    })
    const payload = buildSolverPayload(gen)
    const entries = materialisePlacements(
      payload, [{ lessonId: payload.lessons[0].id, day: 0, start: 0, size: 2 }], [], ['hr1'],
    )
    expect(entries).toHaveLength(2)
    expect(entries[0].blockKey).toBeTruthy()
    expect(entries[1].blockKey).toBe(entries[0].blockKey)
  })

  it('gives every member class of a combined period the same combined key', () => {
    const gen = input({
      requirements: [requirement({ id: 'r1', homeroom_id: 'hr1', subject_id: 'eng' })],
      combined: [{
        id: 'cmb', subjectId: 'assembly', teacherId: 't1', teacherIds: ['t1'], roomId: null,
        roomType: 'classroom', periodsPerWeek: 1, maxPerDay: 1, minBlock: 1, maxBlock: 1,
        members: [{ homeroomId: 'hr1', groupId: null }, { homeroomId: 'hr2', groupId: null }],
      }],
    })
    const payload = buildSolverPayload(gen)
    const lesson = payload.lessons.find((l) => l.kind === 'combined')!
    const entries = materialisePlacements(
      payload, [{ lessonId: lesson.id, day: 0, start: 0, size: 1 }], [], ['hr1', 'hr2'],
    )
    expect(entries).toHaveLength(2)
    expect(entries[0].combinedKey).toBe(entries[1].combinedKey)
    expect(entries[0].combinedKey).toContain('cmb')
  })
})
