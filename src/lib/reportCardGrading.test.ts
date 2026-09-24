import { describe, it, expect } from 'vitest'
import { componentTotals, gradeLetter } from './reportCardGrading'
import type {
  AssessmentComponent, AssessmentComponentMark, ClassroomAssessment, StudentReportCardEntry,
} from './classrooms'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

let seq = 0
const uid = () => `id-${++seq}`

function component(name: string, max: number): AssessmentComponent {
  return {
    id: uid(),
    assessment_id: 'assessment',
    name,
    max_marks: max,
    position: 0,
    created_at: '',
    updated_at: '',
  }
}

function componentMark(
  component: AssessmentComponent,
  marks: number | null,
  isAbsent = false,
): AssessmentComponentMark {
  return {
    id: uid(),
    component_id: component.id,
    student_id: 'student',
    marks,
    is_absent: isAbsent,
    created_at: '',
    updated_at: '',
  }
}

/** One report-card entry: an assessment, its components, and this student's
 *  mark for each of them. `null` leaves that component ungraded. */
function entry(
  title: string,
  parts: [AssessmentComponent, number | null, boolean?][],
): StudentReportCardEntry {
  const assessment: ClassroomAssessment = {
    id: uid(),
    classroom_id: 'classroom',
    title,
    description: null,
    date: null,
    tag: 'other',
    report_card_title: 'Term 1',
    max_marks: parts.reduce((s, [c]) => s + c.max_marks, 0),
    created_by: 'teacher',
    created_at: '',
    updated_at: '',
  }
  const componentMarks: Record<string, AssessmentComponentMark> = {}
  for (const [c, marks, isAbsent] of parts) {
    if (marks == null && !isAbsent) continue
    componentMarks[c.id] = componentMark(c, marks, isAbsent)
  }
  return {
    classroom_id: 'classroom',
    classroom_title: 'Physics',
    assessment,
    mark: null,
    components: parts.map(([c]) => c),
    componentMarks,
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('componentTotals', () => {
  it('returns nothing for a card with no components', () => {
    const plain: StudentReportCardEntry = { ...entry('Unit Test', []), components: [] }
    expect(componentTotals([plain])).toEqual([])
  })

  it('adds one component up across several assessments', () => {
    const lab1 = component('Lab', 20)
    const exam1 = component('Examination', 80)
    const lab2 = component('Lab', 20)
    const exam2 = component('Examination', 80)

    expect(componentTotals([
      entry('Unit Test 1', [[lab1, 15], [exam1, 60]]),
      entry('Unit Test 2', [[lab2, 18], [exam2, 70]]),
    ])).toEqual([
      { name: 'Examination', obtained: 130, max: 160 },
      { name: 'Lab', obtained: 33, max: 40 },
    ])
  })

  it('leaves an ungraded component out of both sides of the fraction', () => {
    const lab = component('Lab', 20)
    const exam = component('Examination', 80)

    // The exam has not been marked yet — the roll-up reports the lab alone
    // rather than 15 out of 100.
    expect(componentTotals([entry('Unit Test', [[lab, 15], [exam, null]])])).toEqual([
      { name: 'Lab', obtained: 15, max: 20 },
    ])
  })

  it('leaves an absent component out too', () => {
    const lab = component('Lab', 20)
    const exam = component('Examination', 80)

    expect(componentTotals([entry('Unit Test', [[lab, null, true], [exam, 64]])])).toEqual([
      { name: 'Examination', obtained: 64, max: 80 },
    ])
  })

  it('keeps a zero, which is a mark like any other', () => {
    const lab = component('Lab', 20)
    expect(componentTotals([entry('Unit Test', [[lab, 0]])])).toEqual([
      { name: 'Lab', obtained: 0, max: 20 },
    ])
  })

  it('merges components of the same name across different subjects', () => {
    const physicsLab = component('Lab', 20)
    const chemistryLab = component('Lab', 30)
    const physics = entry('Physics Test', [[physicsLab, 16]])
    const chemistry = { ...entry('Chemistry Test', [[chemistryLab, 21]]), classroom_title: 'Chemistry' }

    expect(componentTotals([physics, chemistry])).toEqual([
      { name: 'Lab', obtained: 37, max: 50 },
    ])
  })

  it('sorts by name so the strip does not reshuffle between cards', () => {
    const viva = component('Viva', 10)
    const assignment = component('Assignment', 10)
    expect(componentTotals([entry('Unit Test', [[viva, 8], [assignment, 9]])]).map(c => c.name))
      .toEqual(['Assignment', 'Viva'])
  })
})

describe('gradeLetter', () => {
  it('bands a component percentage the same way it bands a total', () => {
    expect(gradeLetter(95).letter).toBe('A1')
    expect(gradeLetter(75).letter).toBe('B1')
    expect(gradeLetter(33).letter).toBe('D')
    expect(gradeLetter(10).letter).toBe('E')
  })
})
