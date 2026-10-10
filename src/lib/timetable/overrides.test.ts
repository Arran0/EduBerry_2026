import { describe, it, expect } from 'vitest'
import {
  activeOverride, applyOverrides, overridesForCell, describeSpan, weekdayOf, nextDateOn,
} from './overrides'
import type { EntryOverride } from './overrides'
import type { TimetableEntry, Weekday } from './types'

// ── Fixtures ─────────────────────────────────────────────────

const HR = 'hr-3a'
const SLOT = 'slot-3'
const TUE: Weekday = 'tuesday'

let seq = 0
function override(patch: Partial<EntryOverride> = {}): EntryOverride {
  seq++
  return {
    id: `o${seq}`,
    config_id: 'cfg',
    timetable_id: 'tt',
    homeroom_id: HR,
    day: TUE,
    slot_id: SLOT,
    group_id: null,
    effective_from: '2026-03-03',
    effective_to: '2026-03-03',
    kind: 'replace',
    subject_id: 'sub-exam',
    teacher_id: 'tch-9',
    teacher_ids: ['tch-9'],
    room_id: 'room-hall',
    note: null,
    created_by: null,
    created_at: `2026-01-0${(seq % 9) + 1}T00:00:00Z`,
    updated_at: '2026-01-01T00:00:00Z',
    ...patch,
  }
}

function entry(patch: Partial<TimetableEntry> = {}): TimetableEntry {
  return {
    id: 'e1',
    timetable_id: 'tt',
    homeroom_id: HR,
    day: TUE,
    slot_id: SLOT,
    subject_id: 'sub-maths',
    teacher_id: 'tch-1',
    teacher_ids: ['tch-1'],
    room_id: 'room-12',
    is_locked: false,
    teacher_name: 'Kandasamy',
    teacher_names: ['Kandasamy'],
    group_id: null,
    split_key: null,
    combined_key: null,
    block_key: null,
    created_at: '',
    updated_at: '',
    ...patch,
  }
}

// ── Date arithmetic ──────────────────────────────────────────

describe('dates', () => {
  it('reads a weekday off an ISO date in Monday-first terms', () => {
    expect(weekdayOf('2026-03-03')).toBe('tuesday')
    expect(weekdayOf('2026-03-08')).toBe('sunday')
  })

  it('finds the next occurrence of a weekday, today included', () => {
    // 2026-03-03 is itself a Tuesday, so it is its own next Tuesday.
    expect(nextDateOn('tuesday', '2026-03-03')).toBe('2026-03-03')
    expect(nextDateOn('friday', '2026-03-03')).toBe('2026-03-06')
    expect(nextDateOn('monday', '2026-03-03')).toBe('2026-03-09')
  })
})

// ── Which override is in force ───────────────────────────────

describe('the override in force on a date', () => {
  it('ignores one whose single date has passed', () => {
    const o = override({ effective_from: '2026-03-03', effective_to: '2026-03-03' })
    expect(activeOverride([o], HR, TUE, SLOT, null, '2026-03-03')).toBe(o)
    expect(activeOverride([o], HR, TUE, SLOT, null, '2026-03-10')).toBeNull()
    expect(activeOverride([o], HR, TUE, SLOT, null, '2026-02-24')).toBeNull()
  })

  it('keeps an open-ended one in force forever after its start', () => {
    const o = override({ effective_from: '2026-03-03', effective_to: null })
    expect(activeOverride([o], HR, TUE, SLOT, null, '2026-02-24')).toBeNull()
    expect(activeOverride([o], HR, TUE, SLOT, null, '2026-03-03')).toBe(o)
    expect(activeOverride([o], HR, TUE, SLOT, null, '2027-09-14')).toBe(o)
  })

  it('does not leak across classes, periods or split groups', () => {
    const o = override({ effective_to: null })
    expect(activeOverride([o], 'hr-3b', TUE, SLOT, null, '2026-03-03')).toBeNull()
    expect(activeOverride([o], HR, 'wednesday', SLOT, null, '2026-03-03')).toBeNull()
    expect(activeOverride([o], HR, TUE, 'slot-4', null, '2026-03-03')).toBeNull()
    expect(activeOverride([o], HR, TUE, SLOT, 'grp-1', '2026-03-03')).toBeNull()
  })

  it('lets a one-off date beat a standing change that started earlier', () => {
    const standing = override({ effective_from: '2026-03-01', effective_to: null, subject_id: 'sub-pe' })
    const oneOff = override({ effective_from: '2026-03-10', effective_to: '2026-03-10', subject_id: 'sub-exam' })
    const winner = activeOverride([standing, oneOff], HR, TUE, SLOT, null, '2026-03-10')
    expect(winner?.subject_id).toBe('sub-exam')
    // …and the standing one still governs every other date.
    expect(activeOverride([standing, oneOff], HR, TUE, SLOT, null, '2026-03-17')?.subject_id).toBe('sub-pe')
  })

  it('breaks a same-start tie on which was recorded last', () => {
    const first = override({ created_at: '2026-01-01T00:00:00Z', subject_id: 'sub-a' })
    const later = override({ created_at: '2026-01-05T00:00:00Z', subject_id: 'sub-b' })
    expect(activeOverride([first, later], HR, TUE, SLOT, null, '2026-03-03')?.subject_id).toBe('sub-b')
    // Order of the input array must not decide it.
    expect(activeOverride([later, first], HR, TUE, SLOT, null, '2026-03-03')?.subject_id).toBe('sub-b')
  })

  it('lists a cell’s overrides most-specific first', () => {
    const old = override({ effective_from: '2026-03-01', effective_to: null })
    const recent = override({ effective_from: '2026-04-01', effective_to: null })
    expect(overridesForCell([old, recent], HR, TUE, SLOT, null).map((o) => o.id))
      .toEqual([recent.id, old.id])
  })
})

// ── Applying them to a week ──────────────────────────────────

describe('applying overrides to a weekly template', () => {
  it('leaves the template alone when nothing is in force', () => {
    const week = [entry()]
    const o = override({ effective_from: '2026-03-10', effective_to: '2026-03-10' })
    expect(applyOverrides(week, [o], '2026-03-03')).toBe(week)
  })

  it('swaps the lesson in, and drops the stale denormalised teacher names', () => {
    const [out] = applyOverrides([entry()], [override()], '2026-03-03')
    expect(out.subject_id).toBe('sub-exam')
    expect(out.teacher_ids).toEqual(['tch-9'])
    expect(out.room_id).toBe('room-hall')
    // These named the teacher being replaced — printing them beside the new
    // subject would credit the wrong person.
    expect(out.teacher_name).toBeNull()
    expect(out.teacher_names).toBeNull()
    // The entry carries the override that changed it, so the UI can mark it.
    expect(out.override?.kind).toBe('replace')
  })

  it('empties the period on a cancellation', () => {
    const out = applyOverrides([entry()], [override({ kind: 'cancel', subject_id: null })], '2026-03-03')
    expect(out).toHaveLength(0)
  })

  it('creates a lesson in a period the template leaves free', () => {
    const out = applyOverrides([], [override()], '2026-03-03')
    expect(out).toHaveLength(1)
    expect(out[0].subject_id).toBe('sub-exam')
    expect(out[0].homeroom_id).toBe(HR)
    expect(out[0].override).toBeTruthy()
  })

  it('does not touch the other periods of the week', () => {
    const week = [entry(), entry({ id: 'e2', slot_id: 'slot-4', subject_id: 'sub-sci' })]
    const out = applyOverrides(week, [override()], '2026-03-03')
    expect(out).toHaveLength(2)
    expect(out.find((e) => e.slot_id === 'slot-4')?.subject_id).toBe('sub-sci')
  })

  it('amends only the split group it names', () => {
    const week = [
      entry({ id: 'whole' }),
      entry({ id: 'grp', group_id: 'grp-1', subject_id: 'sub-fr' }),
    ]
    const out = applyOverrides(week, [override({ group_id: 'grp-1' })], '2026-03-03')
    expect(out.find((e) => e.id === 'whole')?.subject_id).toBe('sub-maths')
    expect(out.find((e) => e.id === 'grp')?.subject_id).toBe('sub-exam')
  })

  it('does not double up when one override replaces an existing lesson', () => {
    // Guards the "landed on an empty period" branch: the override is already
    // accounted for, so it must not also be appended as a new entry.
    const out = applyOverrides([entry()], [override()], '2026-03-03')
    expect(out).toHaveLength(1)
  })
})

describe('describing a span', () => {
  it('says the date, the range, or that it never ends', () => {
    expect(describeSpan(override({ effective_from: '2026-03-03', effective_to: '2026-03-03' })))
      .toMatch(/Mar/)
    expect(describeSpan(override({ effective_from: '2026-03-03', effective_to: null })))
      .toMatch(/onwards$/)
    expect(describeSpan(override({ effective_from: '2026-03-03', effective_to: '2026-03-17' })))
      .toContain('–')
  })
})
