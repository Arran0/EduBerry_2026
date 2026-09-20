import { describe, it, expect } from 'vitest'
import { buildSchedule, installmentsDueForAutogen } from './schedule'
import { resolveStructure, tryResolveStructure, NoStructureError } from './structure'
import { installmentPeriods, prorationFraction } from './proration'
import { sum } from './money'
import {
  YEAR_2026, GROUP_REGULAR, GROUP_RTE, GROUP_STAFF, HEADS,
  HEAD_LAB, structure, student, inst, threeTermInstallments,
} from './__fixtures__'

const GROUPS = [GROUP_REGULAR, GROUP_RTE, GROUP_STAFF]

function build(overrides: {
  structures?: ReturnType<typeof structure>[]
  student?: Parameters<typeof student>[0]
} = {}) {
  return buildSchedule({
    student: student(overrides.student ?? {}),
    year: YEAR_2026,
    groups: GROUPS,
    structures: overrides.structures ?? [structure()],
    heads: HEADS,
  })
}

describe('structure resolution', () => {
  it('prefers the assigned group and the exact grade', () => {
    const r = resolveStructure(student(), GROUPS, [structure()])
    expect(r.structure.id).toBe('struct-g5-regular')
    expect(r.source.rank).toBe(0)
    expect(r.source.why).toContain('Regular')
  })

  it('falls back to the group’s all-grades structure', () => {
    const all = structure({ id: 'struct-all', grade: null })
    const r = resolveStructure(student({ grade: 9 }), GROUPS, [all])
    expect(r.structure.id).toBe('struct-all')
    expect(r.source.rank).toBe(1)
  })

  it('falls back to the default group when the assigned one has no structure', () => {
    const r = resolveStructure(
      student({ feeGroupId: GROUP_STAFF.id }), GROUPS, [structure()])
    expect(r.group.code).toBe('REGULAR')
    expect(r.source.rank).toBe(2)
    expect(r.source.why).toContain('Staff Ward')
  })

  it('resolves an unassigned student through the default group', () => {
    const r = resolveStructure(student({ feeGroupId: null }), GROUPS, [structure()])
    expect(r.group.isDefault).toBe(true)
    expect(r.source.why).toContain('Not assigned to a fee group')
  })

  it('never bills from a draft structure', () => {
    const draft = structure({ status: 'draft' })
    expect(() => resolveStructure(student(), GROUPS, [draft])).toThrow(NoStructureError)
  })

  it('reports rather than throws, for the bulk preview', () => {
    const r = tryResolveStructure(student({ grade: 11 }), GROUPS, [structure()])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('No published fee structure')
  })

  it('handles pre-primary negative grades', () => {
    const lkg = structure({ id: 'struct-lkg', grade: -2 })
    const r = resolveStructure(student({ grade: -2 }), GROUPS, [lkg])
    expect(r.structure.id).toBe('struct-lkg')
  })
})

describe('billing schedule', () => {
  it('splits 40/30/30 of ₹27,000 exactly', () => {
    const s = build()
    expect(s.entries.map(e => e.total)).toEqual([1_080_000, 810_000, 810_000])
    expect(s.total).toBe(2_700_000)
    expect(s.notes).toEqual([])
  })

  it('itemises each installment across the heads', () => {
    const s = build()
    const term1 = s.entries[0]
    expect(term1.lines.map(l => l.label)).toEqual(['Tuition', 'Lab Fee'])
    // 40% of 24,000 and 40% of 3,000
    expect(term1.lines.map(l => l.amount)).toEqual([960_000, 120_000])
    expect(sum(term1.lines.map(l => l.amount))).toBe(term1.total)
  })

  it('always sums to the structure total, even when the percentages do not', () => {
    const short = structure({
      installments: [
        inst('i1', 1, 'Term 1', '2026-04-10', { percent: 40 }),
        inst('i2', 2, 'Term 2', '2026-08-10', { percent: 30 }),
        // only 70% accounted for
      ],
    })
    const s = build({ structures: [short] })
    expect(s.total).toBe(2_700_000)
    expect(s.notes.join(' ')).toContain('so the year')
  })

  it('gives whatever is left to the installments that named nothing', () => {
    const mixed = structure({
      installments: [
        inst('i1', 1, 'Admission', '2026-04-10', { amount: 700_000 }),
        inst('i2', 2, 'Term 2', '2026-08-10'),
        inst('i3', 3, 'Term 3', '2026-12-10'),
      ],
    })
    const s = build({ structures: [mixed] })
    expect(s.entries.map(e => e.total)).toEqual([700_000, 1_000_000, 1_000_000])
    expect(s.total).toBe(2_700_000)
  })

  it('lets an installment name its own heads, and says when that overrides a percentage', () => {
    const explicit = structure({
      installments: [
        inst('i1', 1, 'Term 1', '2026-04-10', {
          percent: 40, items: [{ feeHeadId: HEAD_LAB.id, amount: 300_000 }],
        }),
        inst('i2', 2, 'Term 2', '2026-08-10', { percent: 30 }),
        inst('i3', 3, 'Term 3', '2026-12-10', { percent: 30 }),
      ],
    })
    const s = build({ structures: [explicit] })
    expect(s.entries[0].total).toBe(300_000)
    expect(s.entries[0].lines).toHaveLength(1)
    expect(s.entries[0].lines[0].label).toBe('Lab Fee')
    expect(s.notes.join(' ')).toContain('listed heads win')
    expect(s.total).toBe(2_700_000)
  })

  it('bills an RTE student nothing and says why', () => {
    const s = build({ student: { isRte: true } })
    expect(s.entries).toEqual([])
    expect(s.total).toBe(0)
    expect(s.notes[0]).toContain('RTE')
  })

  it('bills nothing for a group flagged RTE, even without the student flag', () => {
    const rteStructure = structure({ id: 'struct-rte', feeGroupId: GROUP_RTE.id })
    const s = build({
      structures: [rteStructure],
      student: { feeGroupId: GROUP_RTE.id },
    })
    expect(s.total).toBe(0)
  })

  it('says so rather than throwing when a structure has no installments', () => {
    const none = structure({ installments: [] })
    const s = build({ structures: [none] })
    expect(s.entries).toEqual([])
    expect(s.notes.join(' ')).toContain('no installments')
  })

  it('carries the resolution reason through to the schedule', () => {
    const s = build()
    expect(s.source.why).toContain('Regular')
    expect(s.group.code).toBe('REGULAR')
  })
})

describe('installment periods', () => {
  it('gives the first term the start of the session and the last the end', () => {
    const periods = installmentPeriods(threeTermInstallments(), YEAR_2026)
    expect(periods.get('inst-1')).toEqual({ from: '2026-04-01', to: '2026-08-09' })
    expect(periods.get('inst-2')).toEqual({ from: '2026-08-10', to: '2026-12-09' })
    expect(periods.get('inst-3')).toEqual({ from: '2026-12-10', to: '2027-03-31' })
  })

  it('follows the calendar when seq and due date disagree', () => {
    const jumbled = [
      inst('a', 3, 'Third', '2026-04-10'),
      inst('b', 1, 'First', '2026-08-10'),
    ]
    const periods = installmentPeriods(jumbled, YEAR_2026)
    expect(periods.get('a')!.from).toBe('2026-04-01')
    expect(periods.get('b')!.to).toBe('2027-03-31')
  })
})

describe('proration', () => {
  it('charges nothing for a term that ended before the student arrived', () => {
    expect(prorationFraction({ from: '2026-04-01', to: '2026-08-09' }, '2026-09-01')).toBe(0)
  })

  it('charges the whole term when they were there from the start', () => {
    expect(prorationFraction({ from: '2026-08-10', to: '2026-12-09' }, '2026-04-01')).toBe(1)
    expect(prorationFraction({ from: '2026-08-10', to: '2026-12-09' }, '2026-08-10')).toBe(1)
  })

  it('charges a day-count fraction in between', () => {
    // 2026-09-01 to 2026-12-09 is 100 days of a 122-day term.
    const f = prorationFraction({ from: '2026-08-10', to: '2026-12-09' }, '2026-09-01')
    expect(f).toBeCloseTo(100 / 122, 10)
  })

  it('bills a September joiner for part of the year, not all of it', () => {
    const s = build({ student: { prorateFrom: '2026-09-01' } })
    expect(s.entries[0].total).toBe(0)                 // Term 1 already over
    expect(s.entries[0].proration!.chargedDays).toBe(0)
    expect(s.entries[1].total).toBeGreaterThan(0)
    expect(s.entries[1].total).toBeLessThan(810_000)   // partial Term 2
    expect(s.entries[2].total).toBe(810_000)           // full Term 3
    expect(s.total).toBeLessThan(2_700_000)
  })

  it('pushes the reduction into the lines, so a bill is not a mystery total', () => {
    const s = build({ student: { prorateFrom: '2026-09-01' } })
    const term2 = s.entries[1]
    expect(sum(term2.lines.map(l => l.amount))).toBe(term2.total)
    expect(term2.lines.every(l => l.amount < 810_000)).toBe(true)
  })

  it('explains itself in words the office can read aloud', () => {
    const s = build({ student: { prorateFrom: '2026-09-01' } })
    expect(s.entries[1].proration!.why).toContain('joined on 2026-09-01')
    expect(s.entries[1].proration!.why).toContain('122 days')
  })

  it('leaves a student who joined before the session opened unprorated', () => {
    const s = build({ student: { prorateFrom: '2026-04-01' } })
    expect(s.total).toBe(2_700_000)
    expect(s.entries.every(e => e.proration === undefined)).toBe(true)
  })
})

describe('auto-generation eligibility', () => {
  const installments = threeTermInstallments() // Term 1 autogen, 7 days before 10 Apr

  it('is not due before the window opens', () => {
    expect(installmentsDueForAutogen(installments, '2026-04-02')).toEqual([])
  })

  it('is due on the first day of the window', () => {
    expect(installmentsDueForAutogen(installments, '2026-04-03').map(i => i.id))
      .toEqual(['inst-1'])
  })

  it('stays due after the due date, so a new joiner is still billed', () => {
    expect(installmentsDueForAutogen(installments, '2026-11-01').map(i => i.id))
      .toEqual(['inst-1'])
  })

  it('ignores installments with auto-generation switched off', () => {
    expect(installmentsDueForAutogen(installments, '2027-03-01').map(i => i.id))
      .toEqual(['inst-1'])
  })
})

describe('pre-primary grades', () => {
  it('names LKG and UKG rather than -2 and -1 when it cannot find a structure', () => {
    const r = tryResolveStructure(student({ grade: -2 }), GROUPS, [structure()])
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.reason).toContain('LKG')
      expect(r.reason).not.toContain('-2')
    }
  })

  it('names the grade in the resolution reason too', () => {
    const lkg = structure({ id: 'struct-lkg', grade: -2 })
    const r = resolveStructure(student({ grade: -2 }), GROUPS, [lkg])
    expect(r.source.why).toContain('LKG')
  })
})
