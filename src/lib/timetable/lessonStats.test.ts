import { describe, it, expect } from 'vitest'
import { buildLessonStats, unplacedRows } from './lessonStats'
import type { PlacedEntry, Requirement, Weekday } from './types'

const entry = (
  over: Partial<PlacedEntry> & Pick<PlacedEntry, 'homeroomId' | 'subjectId' | 'day' | 'slotId'>,
): PlacedEntry => ({
  teacherId: null, teacherIds: [], roomId: null, isLocked: false,
  groupId: null, splitKey: null, combinedKey: null, blockKey: null, ...over,
})

const requirement = (
  over: Partial<Requirement> & Pick<Requirement, 'id' | 'homeroom_id' | 'subject_id'>,
): Requirement => ({
  config_id: 'cfg', teacher_id: null, teacher_ids: [], periods_per_week: 1,
  room_type: 'classroom', max_per_day: 1, min_block: 1, max_block: 1, group_id: null,
  created_at: '', updated_at: '', ...over,
})

/**
 * "Mrs A teaches maths to 6A on `days`", one period each day.
 *
 * `slot` has to differ per subject: two lessons of one class in the same period
 * is a double-booking, and the period counts below are distinct-cell counts that
 * would (rightly) collapse it.
 */
const lessons = (
  homeroomId: string, subjectId: string, teacherId: string | null, days: Weekday[],
  { roomId = null, slot = 's1' }: { roomId?: string | null; slot?: string } = {},
) => days.map((day) => entry({
  homeroomId, subjectId, day, slotId: slot,
  teacherId, teacherIds: teacherId ? [teacherId] : [], roomId,
}))

describe('lesson statistics', () => {
  const entries: PlacedEntry[] = [
    ...lessons('hr1', 'mat', 't1', ['monday', 'tuesday', 'wednesday'], { roomId: 'room1', slot: 's1' }),
    ...lessons('hr1', 'eng', 't2', ['monday', 'thursday'], { slot: 's2' }),
    ...lessons('hr2', 'mat', 't1', ['friday'], { slot: 's3' }),
    ...lessons('hr2', 'eng', 't3', ['monday', 'tuesday'], { slot: 's4' }),
  ]
  const requirements = [
    requirement({ id: 'q1', homeroom_id: 'hr1', subject_id: 'mat', teacher_id: 't1', periods_per_week: 4 }),
    requirement({ id: 'q2', homeroom_id: 'hr1', subject_id: 'eng', teacher_id: 't2', periods_per_week: 2 }),
    requirement({ id: 'q3', homeroom_id: 'hr2', subject_id: 'mat', teacher_id: 't1', periods_per_week: 1 }),
    requirement({ id: 'q4', homeroom_id: 'hr2', subject_id: 'eng', teacher_id: 't3', periods_per_week: 2 }),
  ]

  it('reports a teacher as one row per class they teach', () => {
    const { rows, totals } = buildLessonStats({ dimension: 'teacher', id: 't1' }, entries, requirements)
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => [r.homeroomId, r.placed])).toEqual([['hr1', 3], ['hr2', 1]])
    expect(totals.placed).toBe(4)
    expect(totals.classes).toBe(2)
    expect(totals.subjects).toBe(1)
  })

  it('reports a class as one row per subject it is taught', () => {
    const { rows, totals } = buildLessonStats({ dimension: 'class', id: 'hr1' }, entries, requirements)
    expect(rows.map((r) => r.subjectId).sort()).toEqual(['eng', 'mat'])
    expect(totals.placed).toBe(5)
    expect(totals.teachers).toBe(2)
  })

  it('reports a subject as one row per teacher-and-class pairing', () => {
    const { rows } = buildLessonStats({ dimension: 'subject', id: 'eng' }, entries, requirements)
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => [r.homeroomId, r.teacherIds[0]]).sort()).toEqual([['hr1', 't2'], ['hr2', 't3']])
  })

  it('carries the plan alongside, so a shortfall is visible', () => {
    const { rows, totals } = buildLessonStats({ dimension: 'class', id: 'hr1' }, entries, requirements)
    const mat = rows.find((r) => r.subjectId === 'mat')!
    expect(mat.planned).toBe(4) // asked for 4
    expect(mat.placed).toBe(3) // got 3
    expect(totals.planned).toBe(6)
    expect(totals.placed).toBe(5)
  })

  it('leaves the plan null when no requirement stands behind the lesson', () => {
    const { rows, totals } = buildLessonStats({ dimension: 'class', id: 'hr1' }, entries, [])
    expect(rows.every((r) => r.planned === null)).toBe(true)
    expect(totals.planned).toBeNull()
  })

  it('reads a double as one lesson of length 2, not two of length 1', () => {
    const { rows, totals } = buildLessonStats({ dimension: 'class', id: 'hr1' }, [
      entry({ homeroomId: 'hr1', subjectId: 'sci', day: 'monday', slotId: 's1', blockKey: 'blk1' }),
      entry({ homeroomId: 'hr1', subjectId: 'sci', day: 'monday', slotId: 's2', blockKey: 'blk1' }),
      entry({ homeroomId: 'hr1', subjectId: 'sci', day: 'friday', slotId: 's1' }),
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0].placed).toBe(3) // three periods
    expect(rows[0].lengths).toEqual([1, 2]) // one single and one double
    expect(rows[0].days).toEqual(['monday', 'friday'])
    expect(totals.blocks).toBe(1)
  })

  it('treats a co-taught lesson as one assignment with both teachers', () => {
    const { rows, totals } = buildLessonStats({ dimension: 'class', id: 'hr1' }, [
      entry({ homeroomId: 'hr1', subjectId: 'art', day: 'monday', slotId: 's1', teacherId: 't1', teacherIds: ['t1', 't2'] }),
      entry({ homeroomId: 'hr1', subjectId: 'art', day: 'tuesday', slotId: 's1', teacherId: 't1', teacherIds: ['t1', 't2'] }),
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0].teacherIds).toEqual(['t1', 't2'])
    expect(rows[0].placed).toBe(2)
    expect(totals.teachers).toBe(2)
  })

  it('keeps parallel split groups as separate rows', () => {
    const { rows } = buildLessonStats({ dimension: 'class', id: 'hr1' }, [
      entry({ homeroomId: 'hr1', subjectId: 'lang', day: 'monday', slotId: 's1', groupId: 'g1', teacherId: 't1', teacherIds: ['t1'] }),
      entry({ homeroomId: 'hr1', subjectId: 'lang', day: 'monday', slotId: 's1', groupId: 'g2', teacherId: 't2', teacherIds: ['t2'] }),
    ])
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r.groupId).sort()).toEqual(['g1', 'g2'])
  })

  it('lists the distinct rooms a lesson uses', () => {
    const { rows } = buildLessonStats({ dimension: 'class', id: 'hr1' }, [
      entry({ homeroomId: 'hr1', subjectId: 'sci', day: 'monday', slotId: 's1', roomId: 'lab1' }),
      entry({ homeroomId: 'hr1', subjectId: 'sci', day: 'tuesday', slotId: 's1', roomId: 'lab1' }),
      entry({ homeroomId: 'hr1', subjectId: 'sci', day: 'friday', slotId: 's1', roomId: null }),
    ])
    expect(rows[0].roomIds).toEqual(['lab1', null])
  })

  it('ranks days so the busiest one is first', () => {
    const { totals } = buildLessonStats({ dimension: 'class', id: 'hr1' }, entries, requirements)
    expect(totals.byDay[0]).toEqual({ day: 'monday', count: 2 })
  })

  it('counts nothing for a scope with no lessons', () => {
    const { rows, totals } = buildLessonStats({ dimension: 'teacher', id: 'nobody' }, entries, requirements)
    expect(rows).toHaveLength(0)
    expect(totals.placed).toBe(0)
    expect(totals.planned).toBeNull()
    expect(totals.byDay).toHaveLength(0)
  })
})

describe('assignments the plan has but the grid does not', () => {
  it('surfaces a requirement with nothing placed against it', () => {
    const requirements = [
      requirement({ id: 'q1', homeroom_id: 'hr1', subject_id: 'mat', teacher_id: 't1', periods_per_week: 4 }),
      requirement({ id: 'q2', homeroom_id: 'hr1', subject_id: 'mus', teacher_id: 't1', periods_per_week: 2 }),
    ]
    const entries = lessons('hr1', 'mat', 't1', ['monday'])
    const missing = unplacedRows({ dimension: 'class', id: 'hr1' }, entries, requirements)
    expect(missing).toHaveLength(1)
    expect(missing[0].subjectId).toBe('mus')
    expect(missing[0].planned).toBe(2)
    expect(missing[0].placed).toBe(0)
  })

  it('says nothing when every requirement has lessons on the grid', () => {
    const requirements = [requirement({ id: 'q1', homeroom_id: 'hr1', subject_id: 'mat', periods_per_week: 1 })]
    const entries = lessons('hr1', 'mat', null, ['monday'])
    expect(unplacedRows({ dimension: 'class', id: 'hr1' }, entries, requirements)).toHaveLength(0)
  })

  it('carries a double requirement’s block length through', () => {
    const requirements = [
      requirement({ id: 'q1', homeroom_id: 'hr1', subject_id: 'sci', periods_per_week: 4, min_block: 2, max_block: 2 }),
    ]
    const missing = unplacedRows({ dimension: 'class', id: 'hr1' }, [], requirements)
    expect(missing[0].lengths).toEqual([2])
  })
})

describe('combined lessons do not inflate a workload', () => {
  // One teacher takes three classes together for a double, twice a week. That is
  // FOUR periods of their time — but twelve entry rows, because a combined lesson
  // fills a cell in every member class. The live school has a teacher whose rows
  // read 114 and whose week is 44 periods; summing rows would overstate them 2.6x.
  const members = ['hrA', 'hrB', 'hrC']
  const combinedDouble = (day: Weekday, blockKey: string, combinedKey: string) =>
    members.flatMap((homeroomId) =>
      ['s1', 's2'].map((slotId) =>
        entry({
          homeroomId, subjectId: 'pe', day, slotId,
          teacherId: 't1', teacherIds: ['t1'],
          combinedKey: `${combinedKey}__${day}__${slotId}`, blockKey,
        }),
      ),
    )
  const entries = [...combinedDouble('monday', 'blk1', 'c1'), ...combinedDouble('thursday', 'blk2', 'c1')]

  it('counts the teacher’s week in periods of time, not in rows', () => {
    const { totals } = buildLessonStats({ dimension: 'teacher', id: 't1' }, entries)
    expect(entries).toHaveLength(12)
    expect(totals.placed).toBe(12) // lesson-periods: three classes are taught
    expect(totals.periods).toBe(4) // but the teacher stands up four times
    expect(totals.classes).toBe(3)
    expect(totals.combined).toBe(4)
  })

  it('counts a block once however many classes sit in it', () => {
    const { totals } = buildLessonStats({ dimension: 'teacher', id: 't1' }, entries)
    expect(totals.blocks).toBe(2) // two doubles, not six
  })

  it('still reads each class’s own share correctly', () => {
    const { rows, totals } = buildLessonStats({ dimension: 'class', id: 'hrA' }, entries)
    expect(rows).toHaveLength(1)
    expect(rows[0].placed).toBe(4) // hrA gets four periods of PE
    expect(rows[0].lengths).toEqual([2]) // both as doubles
    expect(totals.periods).toBe(4)
  })

  it('does not read a combined single as a multi-period block', () => {
    // A one-period assembly for three classes: three rows in one cell, no block.
    const assembly = members.map((homeroomId) =>
      entry({
        homeroomId, subjectId: 'asm', day: 'friday', slotId: 's1',
        teacherId: 't1', teacherIds: ['t1'], combinedKey: 'a1__friday__s1',
      }),
    )
    const { totals } = buildLessonStats({ dimension: 'teacher', id: 't1' }, assembly)
    expect(totals.placed).toBe(3)
    expect(totals.periods).toBe(1)
    expect(totals.blocks).toBe(0)
  })

  it('collapses parallel split groups into the one period they share', () => {
    const split = ['g1', 'g2'].map((groupId) =>
      entry({
        homeroomId: 'hrA', subjectId: 'lang', day: 'monday', slotId: 's1',
        groupId, teacherId: `t-${groupId}`, teacherIds: [`t-${groupId}`],
      }),
    )
    const { totals } = buildLessonStats({ dimension: 'class', id: 'hrA' }, split)
    expect(totals.placed).toBe(2) // two group lessons
    expect(totals.periods).toBe(1) // in one period of the class's week
  })
})
