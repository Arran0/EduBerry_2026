import { describe, it, expect } from 'vitest'
import { marksheetSnapshot } from './AssessmentsTab'
import type { AssessmentComponent, ClassroomMember } from '@/lib/classrooms'
import type { UserProfile } from '@/lib/supabase'

/**
 * The fingerprint that decides whether closing a marksheet warns about unsaved
 * marks. A false "nothing changed" silently throws away a teacher's work, so
 * the cases that must move it are pinned down here.
 */

const member = (id: string, name: string) => ({
  user_id: id,
  user: { id, full_name: name } as UserProfile,
} as ClassroomMember & { user: UserProfile })

const component = (id: string, name: string, max: number): AssessmentComponent => ({
  id, assessment_id: 'a', name, max_marks: max, position: 0, created_at: '', updated_at: '',
})

const students = [member('s1', 'Ada'), member('s2', 'Brij')]
const lab = component('c1', 'Lab', 20)
const exam = component('c2', 'Examination', 80)

const snap = (
  marks: Record<string, { marks: string; isAbsent: boolean }>,
  componentMarks: Record<string, Record<string, string>> = {},
  comps: AssessmentComponent[] = [],
) => marksheetSnapshot(students, comps, marks, componentMarks)

describe('marksheetSnapshot', () => {
  const base = { s1: { marks: '45', isAbsent: false }, s2: { marks: '', isAbsent: false } }

  it('is stable across an unrelated re-render', () => {
    expect(snap(base)).toBe(snap({ ...base }))
  })

  it('does not depend on the order keys were written in', () => {
    const reordered = { s2: base.s2, s1: base.s1 }
    expect(snap(reordered)).toBe(snap(base))
  })

  it('moves when a mark is typed', () => {
    expect(snap({ ...base, s2: { marks: '30', isAbsent: false } })).not.toBe(snap(base))
  })

  it('moves when a mark is cleared', () => {
    expect(snap({ ...base, s1: { marks: '', isAbsent: false } })).not.toBe(snap(base))
  })

  it('moves when a student is marked absent', () => {
    expect(snap({ ...base, s2: { marks: '', isAbsent: true } })).not.toBe(snap(base))
  })

  it('does not move for whitespace alone', () => {
    expect(snap({ ...base, s1: { marks: ' 45 ', isAbsent: false } })).toBe(snap(base))
  })

  it('tracks component cells, not just totals', () => {
    const comps = [lab, exam]
    const before = snap(base, { s1: { c1: '18', c2: '' } }, comps)
    const after = snap(base, { s1: { c1: '18', c2: '60' } }, comps)
    expect(after).not.toBe(before)
  })

  it('distinguishes which component a mark landed in', () => {
    const comps = [lab, exam]
    expect(snap(base, { s1: { c1: '18', c2: '' } }, comps))
      .not.toBe(snap(base, { s1: { c1: '', c2: '18' } }, comps))
  })

  it('ignores marks for a component the sheet no longer has', () => {
    // A component removed from the set leaves its cells behind in state; they
    // are not part of the sheet any more, so they are not unsaved work.
    expect(snap(base, { s1: { c1: '18', c2: '60' } }, [lab]))
      .toBe(snap(base, { s1: { c1: '18' } }, [lab]))
  })

  it('ignores a student who is not in the classroom list', () => {
    expect(snap({ ...base, ghost: { marks: '99', isAbsent: false } })).toBe(snap(base))
  })

  it('treats a missing entry and a blank one the same', () => {
    const { s2: _dropped, ...withoutS2 } = base
    expect(snap(withoutS2)).toBe(snap(base))
  })
})
