import { describe, expect, it } from 'vitest'
import {
  computeDemand, collectExceptions, validateInstallmentPlan,
  applyConcessions, activeConcessions,
  resolveStructureFor, hasAmbiguousStructure,
  type Concession, type ComputeInput, type FeeStructure, type FeeStructureItem,
  type FeeStructureScope, type StudentFeeContext,
} from './index'

// ── Fixtures ────────────────────────────────────────────────────────────────
// A small but realistic school: tuition banded by class, transport banded by
// zone, an exam fee, and a development fee expressed as a percentage of
// tuition. Enough to exercise every calc type and the ordering between them.

const ON = '2026-06-15'

function item(over: Partial<FeeStructureItem> & Pick<FeeStructureItem, 'id' | 'feeHeadId' | 'headCode' | 'headName'>): FeeStructureItem {
  return {
    calcType: 'fixed', amount: 0, percentOf: null, percentValue: null, formula: null,
    slabs: null, slabOn: null, installmentPlan: null, sequence: 100,
    isOptional: false, concessionEligible: true,
    ...over,
  }
}

const TUITION = item({
  id: 'it-tuition', feeHeadId: 'h-tuition', headCode: 'TUITION', headName: 'Tuition Fee',
  calcType: 'slab', slabOn: 'grade', sequence: 10,
  slabs: [{ match: '8', amount: 24000 }, { match: '9', amount: 28000 }, { match: '10', amount: 32000 }],
})

const DEVELOPMENT = item({
  id: 'it-dev', feeHeadId: 'h-dev', headCode: 'DEVELOPMENT', headName: 'Development Fee',
  calcType: 'percent_of', percentOf: 'TUITION', percentValue: 10, sequence: 20,
})

const EXAM = item({
  id: 'it-exam', feeHeadId: 'h-exam', headCode: 'EXAM', headName: 'Examination Fee',
  calcType: 'fixed', amount: 1500, sequence: 30, concessionEligible: false,
})

const TRANSPORT = item({
  id: 'it-bus', feeHeadId: 'h-bus', headCode: 'TRANSPORT', headName: 'Transport Fee',
  calcType: 'slab', slabOn: 'transport_zone', sequence: 40, isOptional: true,
  slabs: [{ match: 'ZONE_A', amount: 9000 }, { match: 'ZONE_B', amount: 12000 }],
})

const STRUCTURE: FeeStructure = {
  id: 'st-1', name: 'Senior School 2026-27', academicYear: '2026-27', version: 1,
  effectiveFrom: '2026-04-01', effectiveTo: null, allowPartial: true, graceDays: 7,
  items: [TUITION, DEVELOPMENT, EXAM, TRANSPORT],
}

const DEFAULT_SCOPE: FeeStructureScope = {
  id: 'sc-default', name: 'All students', isDefault: true, priority: 0,
  effectiveFrom: '2026-04-01', effectiveTo: null, memberIds: [], match: null,
  structureId: 'st-1',
}

function student(over: Partial<StudentFeeContext> = {}): StudentFeeContext {
  return {
    id: 'stu-1', name: 'Ananya R', grade: 9, section: 'A', homeroomIds: ['hr-9a'],
    feeCategory: 'general', transportZone: null, isStaffWard: false,
    siblingRank: null, familyId: null, optedInHeadIds: [], concessions: [],
    ...over,
  }
}

function input(over: Partial<ComputeInput> = {}): ComputeInput {
  return {
    student: student(), scopes: [DEFAULT_SCOPE], structures: { 'st-1': STRUCTURE }, onDate: ON,
    ...over,
  }
}

function net(d: ReturnType<typeof computeDemand>, code: string): number {
  return d.lines.filter(l => l.headCode === code).reduce((s, l) => s + l.netAmount, 0)
}

// ── Calculation ─────────────────────────────────────────────────────────────

describe('computeDemand — calc types', () => {
  it('bands tuition by class', () => {
    expect(net(computeDemand(input()), 'TUITION')).toBe(28000)
    expect(net(computeDemand(input({ student: student({ grade: 10 }) })), 'TUITION')).toBe(32000)
  })

  it('computes a percentage of a head charged earlier in the structure', () => {
    // 10% of the class-9 tuition, not of a default or of the total.
    expect(net(computeDemand(input()), 'DEVELOPMENT')).toBe(2800)
  })

  it('skips an optional head the student has not opted into', () => {
    const d = computeDemand(input({ student: student({ transportZone: 'ZONE_B' }) }))
    expect(net(d, 'TRANSPORT')).toBe(0)
    expect(d.lines.some(l => l.headCode === 'TRANSPORT')).toBe(false)
  })

  it('bands transport by zone once opted in', () => {
    const d = computeDemand(input({
      student: student({ transportZone: 'ZONE_B', optedInHeadIds: ['h-bus'] }),
    }))
    expect(net(d, 'TRANSPORT')).toBe(12000)
  })

  it('totals gross, concession and net consistently', () => {
    const d = computeDemand(input())
    expect(d.grossTotal).toBe(28000 + 2800 + 1500)
    expect(d.netTotal).toBe(d.grossTotal - d.concessionTotal)
  })

  it('evaluates a formula against heads already computed', () => {
    const withFormula: FeeStructure = {
      ...STRUCTURE,
      items: [TUITION, item({
        id: 'it-cap', feeHeadId: 'h-cap', headCode: 'CAP', headName: 'Capitation',
        calcType: 'formula', formula: 'min(pct(TUITION, 20), 5000)', sequence: 50,
      })],
    }
    const d = computeDemand(input({ structures: { 'st-1': withFormula } }))
    // 20% of 28,000 is 5,600, capped at 5,000.
    expect(net(d, 'CAP')).toBe(5000)
  })
})

// ── Failure is loud, never silent ───────────────────────────────────────────

describe('computeDemand — failures surface as exceptions', () => {
  it('does not silently skip a head with no matching band', () => {
    const d = computeDemand(input({ student: student({ grade: 7 }) })) // no band for 7
    const line = d.lines.find(l => l.headCode === 'TUITION')
    expect(line).toBeDefined()
    expect(line!.netAmount).toBe(0)
    expect(collectExceptions([d]).some(e => e.severity === 'block' && e.code === 'head_not_computed')).toBe(true)
  })

  it('reports a percent_of that references a head charged after it', () => {
    const reordered: FeeStructure = {
      ...STRUCTURE,
      items: [{ ...DEVELOPMENT, sequence: 1 }, { ...TUITION, sequence: 2 }],
    }
    const d = computeDemand(input({ structures: { 'st-1': reordered } }))
    expect(collectExceptions([d]).some(e => e.code === 'head_not_computed')).toBe(true)
  })

  it('reports an unresolvable formula rather than billing zero quietly', () => {
    const bad: FeeStructure = {
      ...STRUCTURE,
      items: [item({
        id: 'it-x', feeHeadId: 'h-x', headCode: 'X', headName: 'Mystery Fee',
        calcType: 'formula', formula: 'TUTION * 2', // typo, deliberately
      })],
    }
    const d = computeDemand(input({ structures: { 'st-1': bad } }))
    expect(collectExceptions([d]).some(e => e.code === 'head_not_computed')).toBe(true)
  })

  it('warns when concessions clear the entire demand', () => {
    const full: Concession[] = [{
      id: 'c-rte', feeHeadId: null, kind: 'full', value: 0, category: 'rte',
      reason: 'RTE quota', effectiveFrom: '2026-04-01', effectiveTo: null,
    }]
    const d = computeDemand(input({ student: student({ concessions: full }) }))
    // The exam fee is not concession-eligible, so a "full" waiver cannot clear it.
    expect(net(d, 'EXAM')).toBe(1500)
    expect(d.netTotal).toBe(1500)
  })
})

// ── Concessions ─────────────────────────────────────────────────────────────

describe('concessions', () => {
  const eligible = { feeHeadId: 'h-tuition', concessionEligible: true }

  it('applies percentages before flat amounts, both off the gross', () => {
    const cs: Concession[] = [
      { id: 'c2', feeHeadId: null, kind: 'amount', value: 2000, category: 'staff_ward', reason: null, effectiveFrom: '2026-01-01', effectiveTo: null },
      { id: 'c1', feeHeadId: null, kind: 'percent', value: 25, category: 'sibling', reason: null, effectiveFrom: '2026-01-01', effectiveTo: null },
    ]
    const r = applyConcessions(eligible, 28000, cs, ON)
    // 25% of 28,000 = 7,000, then a flat 2,000 → 9,000 total off.
    expect(r.amount).toBe(9000)
    expect(r.applied.map(a => a.category)).toEqual(['sibling', 'staff_ward'])
  })

  it('never drives a head below zero', () => {
    const cs: Concession[] = [
      { id: 'c1', feeHeadId: null, kind: 'amount', value: 50000, category: 'financial_aid', reason: null, effectiveFrom: '2026-01-01', effectiveTo: null },
    ]
    expect(applyConcessions(eligible, 1500, cs, ON).amount).toBe(1500)
  })

  it('leaves an ineligible head alone', () => {
    const cs: Concession[] = [
      { id: 'c1', feeHeadId: null, kind: 'percent', value: 100, category: 'rte', reason: null, effectiveFrom: '2026-01-01', effectiveTo: null },
    ]
    expect(applyConcessions({ feeHeadId: 'h-fine', concessionEligible: false }, 500, cs, ON).amount).toBe(0)
  })

  it('honours effective dates', () => {
    const cs: Concession[] = [
      { id: 'c1', feeHeadId: null, kind: 'percent', value: 50, category: 'merit', reason: null, effectiveFrom: '2026-01-01', effectiveTo: '2026-03-31' },
    ]
    expect(activeConcessions(cs, ON)).toHaveLength(0)
    expect(applyConcessions(eligible, 10000, cs, ON).amount).toBe(0)
  })

  it('applies a head-scoped concession only to that head', () => {
    const cs: Concession[] = [
      { id: 'c1', feeHeadId: 'h-bus', kind: 'percent', value: 50, category: 'other', reason: null, effectiveFrom: '2026-01-01', effectiveTo: null },
    ]
    expect(applyConcessions(eligible, 28000, cs, ON).amount).toBe(0)
    expect(applyConcessions({ feeHeadId: 'h-bus', concessionEligible: true }, 9000, cs, ON).amount).toBe(4500)
  })

  it('orders deterministically when two concessions are of equal kind and value', () => {
    const cs: Concession[] = [
      { id: 'b', feeHeadId: null, kind: 'percent', value: 10, category: 'merit', reason: null, effectiveFrom: '2026-01-01', effectiveTo: null },
      { id: 'a', feeHeadId: null, kind: 'percent', value: 10, category: 'sports', reason: null, effectiveFrom: '2026-01-01', effectiveTo: null },
    ]
    expect(applyConcessions(eligible, 10000, cs, ON).applied.map(a => a.concessionId)).toEqual(['a', 'b'])
  })
})

// ── Instalments ─────────────────────────────────────────────────────────────

describe('instalments', () => {
  const termly: FeeStructure = {
    ...STRUCTURE,
    items: [{
      ...TUITION,
      installmentPlan: [
        { no: 1, label: 'Term I', due: '2026-04-10', share: 40 },
        { no: 2, label: 'Term II', due: '2026-08-10', share: 30 },
        { no: 3, label: 'Term III', due: '2026-12-10', share: 30 },
      ],
    }],
  }

  it('splits a head across its plan and sums back to the head exactly', () => {
    const d = computeDemand(input({ structures: { 'st-1': termly } }))
    expect(d.lines).toHaveLength(3)
    expect(d.lines.map(l => l.netAmount)).toEqual([11200, 8400, 8400])
    expect(d.netTotal).toBe(28000)
  })

  it('puts rounding drift on the first instalment so the parts still sum exactly', () => {
    const thirds: FeeStructure = {
      ...STRUCTURE,
      items: [{
        ...TUITION,
        slabs: [{ match: '9', amount: 10000 }],
        installmentPlan: [
          { no: 1, label: 'I', due: '2026-04-10', share: 33.33 },
          { no: 2, label: 'II', due: '2026-08-10', share: 33.33 },
          { no: 3, label: 'III', due: '2026-12-10', share: 33.34 },
        ],
      }],
    }
    const d = computeDemand(input({ structures: { 'st-1': thirds } }))
    expect(d.lines.reduce((s, l) => s + l.netAmount, 0)).toBe(10000)
  })

  it('bills only the requested instalment', () => {
    const d = computeDemand(input({ structures: { 'st-1': termly }, installmentNo: 2 }))
    expect(d.lines).toHaveLength(1)
    expect(d.lines[0].installmentLabel).toBe('Term II')
    expect(d.lines[0].netAmount).toBe(8400)
  })

  it('splits the concession across instalments in proportion', () => {
    const cs: Concession[] = [
      { id: 'c1', feeHeadId: null, kind: 'percent', value: 50, category: 'sibling', reason: null, effectiveFrom: '2026-01-01', effectiveTo: null },
    ]
    const d = computeDemand(input({ structures: { 'st-1': termly }, student: student({ concessions: cs }) }))
    expect(d.netTotal).toBe(14000)
    expect(d.concessionTotal).toBe(14000)
    expect(d.grossTotal).toBe(28000)
  })

  it('rejects a plan whose shares do not add up', () => {
    expect(validateInstallmentPlan([{ no: 1, share: 40 }, { no: 2, share: 40 }])).toMatch(/80%/)
    expect(validateInstallmentPlan([{ no: 1, share: 50 }, { no: 2, share: 50 }])).toBeNull()
    expect(validateInstallmentPlan([{ no: 1, share: 50 }, { no: 1, share: 50 }])).toMatch(/same number/)
  })
})

// ── Scope resolution ────────────────────────────────────────────────────────

describe('structure resolution', () => {
  const staffWard: FeeStructureScope = {
    id: 'sc-staff', name: 'Staff wards', isDefault: false, priority: 10,
    effectiveFrom: '2026-04-01', effectiveTo: null, memberIds: [],
    match: { categories: ['staff_ward'] }, structureId: 'st-staff',
  }
  const named: FeeStructureScope = {
    id: 'sc-named', name: 'Board scholars', isDefault: false, priority: 5,
    effectiveFrom: '2026-04-01', effectiveTo: null, memberIds: ['stu-1'],
    match: null, structureId: 'st-named',
  }

  it('prefers an explicit member list over a rule match', () => {
    const r = resolveStructureFor([DEFAULT_SCOPE, staffWard, named], student({ feeCategory: 'staff_ward' }), ON)
    expect(r.scope!.id).toBe('sc-named')
    expect(r.source.rank).toBe('explicit')
  })

  it('prefers a rule match over the default', () => {
    const r = resolveStructureFor([DEFAULT_SCOPE, staffWard], student({ feeCategory: 'staff_ward' }), ON)
    expect(r.scope!.id).toBe('sc-staff')
    expect(r.source.why).toContain('category')
  })

  it('falls back to the default when nothing matches', () => {
    const r = resolveStructureFor([DEFAULT_SCOPE, staffWard], student(), ON)
    expect(r.scope!.id).toBe('sc-default')
    expect(r.source.rank).toBe('default')
  })

  it('requires every clause of a match to hold', () => {
    const both: FeeStructureScope = {
      ...staffWard, id: 'sc-both', match: { grades: [9], categories: ['staff_ward'] },
    }
    expect(resolveStructureFor([DEFAULT_SCOPE, both], student({ grade: 9, feeCategory: 'general' }), ON).scope!.id).toBe('sc-default')
    expect(resolveStructureFor([DEFAULT_SCOPE, both], student({ grade: 9, feeCategory: 'staff_ward' }), ON).scope!.id).toBe('sc-both')
  })

  it('ignores a scope that has expired', () => {
    const expired: FeeStructureScope = { ...staffWard, effectiveTo: '2026-05-31' }
    expect(resolveStructureFor([DEFAULT_SCOPE, expired], student({ feeCategory: 'staff_ward' }), ON).scope!.id).toBe('sc-default')
  })

  it('flags two scopes tying at the top rather than picking by array order', () => {
    const a: FeeStructureScope = { ...staffWard, id: 'a' }
    const b: FeeStructureScope = { ...staffWard, id: 'b' }
    const s = student({ feeCategory: 'staff_ward' })
    expect(hasAmbiguousStructure([a, b], s, ON)).toBe(true)
    expect(hasAmbiguousStructure([a], s, ON)).toBe(false)
  })

  it('reports no structure rather than guessing one', () => {
    const d = computeDemand(input({ scopes: [] }))
    expect(d.lines).toHaveLength(0)
    expect(d.skippedReason).toMatch(/No fee structure/)
    expect(d.scope.rank).toBe('builtin')
  })
})

// ── The trace ───────────────────────────────────────────────────────────────

describe('the trace explains the number', () => {
  it('names the structure, the scope and every concession', () => {
    const cs: Concession[] = [
      { id: 'c1', feeHeadId: null, kind: 'percent', value: 25, category: 'sibling', reason: 'Second child', effectiveFrom: '2026-01-01', effectiveTo: null },
    ]
    const d = computeDemand(input({ student: student({ siblingRank: 2, concessions: cs }) }))
    const tuition = d.lines.find(l => l.headCode === 'TUITION')!

    expect(tuition.trace.structureName).toBe('Senior School 2026-27')
    expect(tuition.trace.scope.why).toContain('default')
    expect(tuition.trace.steps.map(s => s.label)).toEqual(['Gross', 'Concession', 'Net'])
    expect(tuition.trace.steps[0].amount).toBe(28000)
    expect(tuition.trace.steps[1].amount).toBe(-7000)
    expect(tuition.trace.steps[1].detail).toContain('Sibling concession')
    expect(tuition.trace.steps[2].amount).toBe(21000)
    expect(tuition.trace.concessions[0].concessionId).toBe('c1')
  })
})
