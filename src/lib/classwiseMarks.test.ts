import { describe, it, expect } from 'vitest'
import {
  markCell, num, overallOf, sortStudents, averageOf, buildExportTable,
  ClasswiseSort,
} from './classwiseMarks'
import type { ClasswiseCellData, ClasswiseSubject } from './classrooms'
import type { UserProfile } from './supabase'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function student(id: string, name: string): UserProfile {
  return {
    id, full_name: name, email: `${id}@school.test`, role: 'student',
    avatar_url: undefined, grade: 9, section: 'A', created_at: '', updated_at: '',
  }
}

function subject(
  classroomId: string, name: string, maxMarks: number,
  componentMax: Record<string, number> = {},
): ClasswiseSubject {
  return {
    classroomId,
    classroomTitle: `${name} 9A`,
    subject: name,
    maxMarks,
    componentNames: Object.keys(componentMax),
    componentMax,
  }
}

function cell(
  obtained: number, max: number,
  components: { name: string; obtained: number; max: number }[] = [],
): ClasswiseCellData {
  return { obtained, max, hasAnyMark: true, components }
}

const physics = subject('c-phy', 'Physics', 100, { Lab: 20, Examination: 80 })
const maths = subject('c-mat', 'Maths', 100)
const subjects = [physics, maths]

const ada = student('s-ada', 'Ada Lovelace')
const brij = student('s-brij', 'Brij Kumar')
const chen = student('s-chen', 'Chen Wei')
const students = [ada, brij, chen]

const cellData: Record<string, Record<string, ClasswiseCellData>> = {
  's-ada':  { 'c-phy': cell(90, 100, [{ name: 'Lab', obtained: 18, max: 20 }, { name: 'Examination', obtained: 72, max: 80 }]),
              'c-mat': cell(80, 100) },
  's-brij': { 'c-phy': cell(50, 100, [{ name: 'Lab', obtained: 10, max: 20 }, { name: 'Examination', obtained: 40, max: 80 }]),
              'c-mat': cell(60, 100) },
  // Chen sat the lab but not the exam, so their Physics denominator is smaller.
  's-chen': { 'c-phy': cell(15, 20, [{ name: 'Lab', obtained: 15, max: 20 }]) },
}

const byName: ClasswiseSort = { by: 'name', dir: 'asc' }

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('num', () => {
  it('prints a whole mark without decimals and keeps a real one', () => {
    expect(num(45)).toBe('45')
    expect(num(18.5)).toBe('18.5')
    expect(num(37.499999)).toBe('37.5')
  })
})

describe('markCell', () => {
  it('collapses obtained, max and percent into one figure', () => {
    // The maximum lives in the column heading, so the cell does not repeat it.
    expect(markCell(150, 200, 200)).toBe('150 (75.0%)')
  })

  it('spells out the denominator when the student sat less than the column', () => {
    expect(markCell(15, 20, 100)).toBe('15/20 (75.0%)')
  })

  it('has nothing to show when nothing was attempted', () => {
    expect(markCell(0, 0, 100)).toBe('—')
  })
})

describe('overallOf', () => {
  it('adds every subject the student has marks in', () => {
    expect(overallOf('s-ada', subjects, cellData)).toEqual({ obtained: 170, max: 200 })
  })

  it('counts only the subjects that were sat', () => {
    expect(overallOf('s-chen', subjects, cellData)).toEqual({ obtained: 15, max: 20 })
  })

  it('is zero for a student with nothing marked', () => {
    expect(overallOf('nobody', subjects, cellData)).toEqual({ obtained: 0, max: 0 })
  })
})

describe('sortStudents', () => {
  it('sorts by name in both directions', () => {
    expect(sortStudents(students, { by: 'name', dir: 'asc' }, subjects, cellData).map(s => s.full_name))
      .toEqual(['Ada Lovelace', 'Brij Kumar', 'Chen Wei'])
    expect(sortStudents(students, { by: 'name', dir: 'desc' }, subjects, cellData).map(s => s.full_name))
      .toEqual(['Chen Wei', 'Brij Kumar', 'Ada Lovelace'])
  })

  it('sorts by overall percentage, not by raw marks', () => {
    // Chen's 15/20 is 75% — ahead of Brij's 110/200, behind Ada's 170/200,
    // even though it is the smallest mark on the sheet.
    expect(sortStudents(students, { by: 'overall', dir: 'desc' }, subjects, cellData).map(s => s.full_name))
      .toEqual(['Ada Lovelace', 'Chen Wei', 'Brij Kumar'])
  })

  it('sorts on one subject column', () => {
    const bySubject: ClasswiseSort = { by: 'subject', classroomId: 'c-phy', dir: 'desc' }
    expect(sortStudents(students, bySubject, subjects, cellData).map(s => s.full_name))
      .toEqual(['Ada Lovelace', 'Chen Wei', 'Brij Kumar'])
  })

  it('puts a student with nothing in that subject at the bottom, either way', () => {
    const desc: ClasswiseSort = { by: 'subject', classroomId: 'c-mat', dir: 'desc' }
    expect(sortStudents(students, desc, subjects, cellData).map(s => s.full_name).at(-1)).toBe('Chen Wei')
    // Ascending puts them first instead — they are still grouped, not scattered.
    const asc: ClasswiseSort = { by: 'subject', classroomId: 'c-mat', dir: 'asc' }
    expect(sortStudents(students, asc, subjects, cellData).map(s => s.full_name)[0]).toBe('Chen Wei')
  })

  it('breaks ties on the name rather than leaving the order to chance', () => {
    const tied = { 'x': { 'c-mat': cell(50, 100) }, 'y': { 'c-mat': cell(50, 100) } }
    const pair = [student('y', 'Zoe'), student('x', 'Amir')]
    expect(sortStudents(pair, { by: 'overall', dir: 'desc' }, [maths], tied).map(s => s.full_name))
      .toEqual(['Amir', 'Zoe'])
  })

  it('does not mutate the array it was given', () => {
    const order = students.map(s => s.id)
    sortStudents(students, { by: 'overall', dir: 'desc' }, subjects, cellData)
    expect(students.map(s => s.id)).toEqual(order)
  })
})

describe('averageOf', () => {
  it('averages the mark per student who sat it', () => {
    const avg = averageOf([{ obtained: 90, max: 100 }, { obtained: 50, max: 100 }])
    expect(avg.mean).toBe(70)
    expect(avg.meanMax).toBe(100)
    expect(avg.pct).toBeCloseTo(70)
    expect(avg.counted).toBe(2)
  })

  it('ignores students with nothing marked rather than scoring them zero', () => {
    const avg = averageOf([{ obtained: 90, max: 100 }, { obtained: 0, max: 0 }])
    expect(avg.mean).toBe(90)
    expect(avg.counted).toBe(1)
  })

  it('reports no percentage when nobody sat it', () => {
    expect(averageOf([]).pct).toBeNull()
  })
})

describe('buildExportTable', () => {
  it('gives each subject one column, with the total in the heading', () => {
    const t = buildExportTable(students, subjects, cellData, { includeComponents: false, sort: byName })
    expect(t.headers).toEqual([
      'Student Name', 'Grade', 'Section',
      'Physics (out of 100)', 'Maths (out of 100)',
      'Overall (out of 200)', 'Overall %', 'Grade Band',
    ])
    expect(t.rows[0]).toEqual([
      'Ada Lovelace', '9', 'A', '90 (90.0%)', '80 (80.0%)', '170 (85.0%)', '85.0%', 'A2',
    ])
  })

  it('adds a column per component only when asked', () => {
    const plain = buildExportTable(students, subjects, cellData, { includeComponents: false, sort: byName })
    const split = buildExportTable(students, subjects, cellData, { includeComponents: true, sort: byName })
    expect(plain.headers).not.toContain('Physics · Lab (out of 20)')
    expect(split.headers.slice(3, 6)).toEqual([
      'Physics · Lab (out of 20)',
      'Physics · Examination (out of 80)',
      'Physics (out of 100)',
    ])
    expect(split.rows[0].slice(3, 6)).toEqual(['18 (90.0%)', '72 (90.0%)', '90 (90.0%)'])
  })

  it('leaves the unsplit subject a single column even with the split on', () => {
    const split = buildExportTable(students, subjects, cellData, { includeComponents: true, sort: byName })
    expect(split.headers.filter(h => h.startsWith('Maths'))).toEqual(['Maths (out of 100)'])
  })

  it('marks a missing subject and a missing component with a dash', () => {
    const split = buildExportTable(students, subjects, cellData, { includeComponents: true, sort: byName })
    const chenRow = split.rows.find(r => r[0] === 'Chen Wei')!
    // Lab sat, Examination not, Maths not.
    expect(chenRow.slice(3, 7)).toEqual(['15 (75.0%)', '—', '15/20 (75.0%)', '—'])
  })

  it('writes the rows in the order that was chosen', () => {
    const t = buildExportTable(students, subjects, cellData,
      { includeComponents: false, sort: { by: 'overall', dir: 'desc' } })
    expect(t.rows.map(r => r[0])).toEqual(['Ada Lovelace', 'Chen Wei', 'Brij Kumar'])
  })

  it('gives every row exactly as many cells as there are headings', () => {
    for (const includeComponents of [false, true]) {
      const t = buildExportTable(students, subjects, cellData, { includeComponents, sort: byName })
      for (const row of t.rows) expect(row).toHaveLength(t.headers.length)
    }
  })
})
