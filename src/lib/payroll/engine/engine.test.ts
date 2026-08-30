import { describe, it, expect } from 'vitest'
import {
  engineInput, employee, assignment, structure, policyGroup, calendar, presentMonth,
  STANDARD_COMPONENTS, ALL_RULES, PF_RULES, ESI_RULES, period,
} from '../__fixtures__'
import { calcLine, monthIndexInFinancialYear, financialYearOf } from './calcLine'
import { calcLopDays, priceOccurrences } from './attendance'
import { buildStructure, orderComponents, StructureError, assignmentOn } from './structure'
import { calcPf, calcEsi } from './statutory'
import { resolveScoped, hasAmbiguousCoverage, BUILTIN_POLICY } from './resolvePolicy'
import { canTransition, isImmutable } from './workflow'
import { computeVariance } from './variance'
import { calcRecoveries, buildLoanSchedule, suggestedEmi } from './recoveries'
import { computeArrears } from './arrears'
import { classifyDays, computePayableDays } from './calendar'
import { round2 } from './money'

const TODAY = '2026-07-15'

// ============================================
// Behaviour locked in from the legacy engine
// ============================================

describe('LOP tiers (parity with the legacy calcLopDays)', () => {
  const flat = { freeCount: 1, tiers: [{ count: null, lopDaysEach: 1 }] }

  it('charges nothing inside the free quota', () => {
    expect(calcLopDays(1, flat)).toBe(0)
  })

  it('charges the flat rate beyond it', () => {
    expect(calcLopDays(4, flat)).toBe(3)
  })

  it('keeps charging at the last tier rate once the tiers run out', () => {
    // The escalating-schedule guarantee: a tenth absence must never be free
    // just because the author only wrote two tiers.
    const escalating = { freeCount: 0, tiers: [{ count: 2, lopDaysEach: 0.5 }, { count: 2, lopDaysEach: 1 }] }
    expect(calcLopDays(4, escalating)).toBe(3)
    expect(calcLopDays(6, escalating)).toBe(5)
  })

  it('prices each occurrence individually so the day grid can explain it', () => {
    const priced = priceOccurrences(3, { freeCount: 1, tiers: [{ count: 1, lopDaysEach: 0.5 }, { count: null, lopDaysEach: 1 }] })
    expect(priced.map(p => p.lopDays)).toEqual([0, 0.5, 1])
    expect(priced[0].note).toContain('free quota')
  })
})

// ============================================
// Structure resolution
// ============================================

describe('buildStructure', () => {
  const args = {
    assignment: assignment(), structure: structure(), overrides: [],
    components: STANDARD_COMPONENTS, onDate: '2026-06-30', payableDays: 30,
  }

  it('resolves percentages against the head they name and balances the remainder', () => {
    const built = buildStructure(args)
    const by = Object.fromEntries(built.components.map(c => [c.def.code, c.amount]))
    expect(by.BASIC).toBe(20000)
    expect(by.HRA).toBe(8000)   // 40% of Basic
    expect(by.DA).toBe(2000)    // 10% of Basic
    expect(by.SPL).toBe(10000)  // 40,000 anchor less the 30,000 allocated
    expect(built.gross).toBe(40000)
  })

  it('evaluates dependencies before dependents regardless of authored sequence', () => {
    // HRA is authored first but depends on Basic; it must still see 20000.
    const reordered = structure({
      components: [
        { componentCode: 'HRA', calcType: 'percent_of', value: 40, formula: null, sequence: 1 },
        { componentCode: 'BASIC', calcType: 'fixed', value: 20000, formula: null, sequence: 2 },
      ],
    })
    const built = buildStructure({ ...args, structure: reordered })
    expect(built.components.find(c => c.def.code === 'HRA')!.amount).toBe(8000)
  })

  it('refuses a dependency loop rather than resolving one side to zero', () => {
    const looped = structure({
      components: [
        { componentCode: 'BASIC', calcType: 'formula', value: null, formula: 'HRA * 2', sequence: 10 },
        { componentCode: 'HRA', calcType: 'formula', value: null, formula: 'BASIC / 2', sequence: 20 },
      ],
    })
    expect(() => buildStructure({ ...args, structure: looped })).toThrow(StructureError)
  })

  it('refuses a dependency on a balance head, which is only known last', () => {
    const bad = structure({
      components: [
        { componentCode: 'BASIC', calcType: 'formula', value: null, formula: 'SPL * 2', sequence: 10 },
        { componentCode: 'SPL', calcType: 'balance', value: null, formula: null, sequence: 20 },
      ],
    })
    expect(() => buildStructure({ ...args, structure: bad })).toThrow(/balance head/)
  })

  it('never lets a balance head go negative when a structure over-allocates', () => {
    const over = buildStructure({ ...args, assignment: assignment({ anchorAmount: 25000 }) })
    expect(over.components.find(c => c.def.code === 'SPL')!.amount).toBe(0)
  })

  it('applies an effective-dated per-employee override', () => {
    const built = buildStructure({
      ...args,
      overrides: [{ componentCode: 'BASIC', calcType: 'fixed', value: 25000, formula: null, effectiveFrom: '2026-01-01', effectiveTo: null, reason: 'Retention' }],
    })
    expect(built.components.find(c => c.def.code === 'BASIC')!.amount).toBe(25000)
    expect(built.components.find(c => c.def.code === 'HRA')!.amount).toBe(10000)
  })

  it('ignores an override that is not yet effective', () => {
    const built = buildStructure({
      ...args,
      overrides: [{ componentCode: 'BASIC', calcType: 'fixed', value: 25000, formula: null, effectiveFrom: '2027-01-01', effectiveTo: null, reason: null }],
    })
    expect(built.components.find(c => c.def.code === 'BASIC')!.amount).toBe(20000)
  })
})

describe('assignmentOn', () => {
  it('picks the assignment in force and ignores closed ones', () => {
    const list = [
      assignment({ id: 'old', effectiveFrom: '2020-01-01', effectiveTo: '2026-03-31', anchorAmount: 30000 }),
      assignment({ id: 'new', effectiveFrom: '2026-04-01', effectiveTo: null, anchorAmount: 40000 }),
    ]
    expect(assignmentOn(list, '2026-06-30')!.id).toBe('new')
    expect(assignmentOn(list, '2026-02-15')!.id).toBe('old')
    expect(assignmentOn(list, '2019-01-01')).toBeNull()
  })
})

// ============================================
// Policy resolution
// ============================================

describe('policy resolution', () => {
  const strict = policyGroup({
    id: 'pg-strict', name: 'Primary section', isDefault: false, priority: 10,
    memberIds: ['emp-1'], policy: { ...BUILTIN_POLICY, lop: { ...BUILTIN_POLICY.lop, leave: { freeCount: 0, tiers: [{ count: null, lopDaysEach: 2 }] } } },
  })
  const matched = policyGroup({
    id: 'pg-transport', name: 'Transport staff', isDefault: false, priority: 5,
    memberIds: [], match: { categories: ['transport'] },
  })
  const def = policyGroup()

  it('prefers an explicit member list over the default', () => {
    const r = resolveScoped([def, strict], employee(), '2026-06-30', 'default policy')
    expect(r.item!.id).toBe('pg-strict')
    expect(r.source.rank).toBe('explicit')
    expect(r.source.why).toContain('listed as a member')
  })

  it('falls back to a rule match, then to the default', () => {
    const driver = employee({ id: 'emp-9', category: 'transport' })
    expect(resolveScoped([def, matched], driver, '2026-06-30', 'x').item!.id).toBe('pg-transport')
    expect(resolveScoped([def, matched], employee(), '2026-06-30', 'x').item!.id).toBe('pg-default')
  })

  it('ignores a group whose effective window has closed', () => {
    const expired = policyGroup({ id: 'pg-old', isDefault: false, priority: 99, memberIds: ['emp-1'], effectiveTo: '2026-01-31' })
    expect(resolveScoped([def, expired], employee(), '2026-06-30', 'x').item!.id).toBe('pg-default')
  })

  it('flags two groups tying at the top as ambiguous', () => {
    const a = policyGroup({ id: 'a', isDefault: false, priority: 10, memberIds: ['emp-1'] })
    const b = policyGroup({ id: 'b', isDefault: false, priority: 10, memberIds: ['emp-1'] })
    expect(hasAmbiguousCoverage([a, b], employee(), '2026-06-30')).toBe(true)
    expect(hasAmbiguousCoverage([a], employee(), '2026-06-30')).toBe(false)
  })
})

// ============================================
// Calendars
// ============================================

describe('working calendars', () => {
  const emp = employee()

  it('marks Sundays off under a six-day week', () => {
    const days = classifyDays('2026-06-01', '2026-06-30', calendar(), [], emp)
    expect(days.filter(d => d.status === 'week_off').length).toBe(4) // June 2026 has 4 Sundays
  })

  it('honours an nth-weekday rule for alternate Saturdays', () => {
    const cal = calendar({ nthWeekdayRules: [{ weekday: 6, nth: [2, 4], mode: 'off' }] })
    const days = classifyDays('2026-06-01', '2026-06-30', cal, [], emp)
    const offSaturdays = days.filter(d => d.status === 'week_off' && new Date(`${d.date}T12:00:00Z`).getUTCDay() === 6)
    expect(offSaturdays.length).toBe(2)
  })

  it('applies a staff-scoped holiday only to its own members', () => {
    const hol = [{ date: '2026-06-10', name: 'Department day', staffIds: ['emp-2'], isDefault: false }]
    expect(classifyDays('2026-06-01', '2026-06-30', calendar(), hol, emp).find(d => d.date === '2026-06-10')!.status).toBe('working')
    expect(classifyDays('2026-06-01', '2026-06-30', calendar(), hol, employee({ id: 'emp-2' })).find(d => d.date === '2026-06-10')!.status).toBe('holiday')
  })

  it('computes the payable-day divisor for each basis', () => {
    const days = classifyDays('2026-06-01', '2026-06-30', calendar(), [{ date: '2026-06-10', name: 'H', staffIds: [], isDefault: true }], emp)
    expect(computePayableDays(days, calendar({ basis: 'calendar_days' })).payableDays).toBe(30)
    expect(computePayableDays(days, calendar({ basis: 'fixed_days', fixedDays: 30 })).payableDays).toBe(30)
    expect(computePayableDays(days, calendar({ basis: 'calendar_minus_holidays' })).payableDays).toBe(29)
    expect(computePayableDays(days, calendar({ basis: 'actual_working_days' })).payableDays).toBe(25)
  })
})

// ============================================
// Statutory
// ============================================

describe('PF', () => {
  const comps = [
    { code: 'BASIC', name: 'Basic', kind: 'earning' as const, amount: 20000, fullAmount: 20000, def: STANDARD_COMPONENTS[0], trace: { label: '', value: 0, unit: 'INR' as const } },
    { code: 'DA', name: 'DA', kind: 'earning' as const, amount: 2000, fullAmount: 2000, def: STANDARD_COMPONENTS[2], trace: { label: '', value: 0, unit: 'INR' as const } },
  ]

  it('deducts 12% of the PF wage base', () => {
    const r = calcPf(employee(), comps, PF_RULES)
    expect(r.pfWages).toBe(22000)
    expect(r.employee).toBe(2640)
  })

  it('carves the pension share out of the employer share rather than adding to it', () => {
    const r = calcPf(employee(), comps, PF_RULES)
    expect(r.eps).toBe(1250)                     // 8.33% of the 15,000 ceiling
    expect(round2(r.employerPf + r.eps)).toBe(2640)
  })

  it('respects an agreed PF wage over the derived one', () => {
    expect(calcPf(employee({ pfWageOverride: 15000 }), comps, PF_RULES).employee).toBe(1800)
  })

  it('deducts nothing for someone not enrolled, and says so', () => {
    const r = calcPf(employee({ pfApplicable: false }), comps, PF_RULES)
    expect(r.employee).toBe(0)
    expect(r.trace.note).toContain('not enrolled')
  })
})

describe('ESI', () => {
  const at = (amount: number) => [{
    code: 'BASIC', name: 'Basic', kind: 'earning' as const, amount, fullAmount: amount,
    def: STANDARD_COMPONENTS[0], trace: { label: '', value: 0, unit: 'INR' as const },
  }]

  it('applies under the ceiling and rounds both shares up to the rupee', () => {
    const r = calcEsi(employee(), at(20000), ESI_RULES, 6)
    expect(r.applicable).toBe(true)
    expect(r.employee).toBe(150)   // ceil(20000 × 0.75%)
    expect(r.employer).toBe(650)   // ceil(20000 × 3.25%)
  })

  it('rounds up rather than to nearest', () => {
    expect(calcEsi(employee(), at(10001), ESI_RULES, 6).employee).toBe(76) // 75.0075 → 76
  })

  it('drops out above the ceiling', () => {
    expect(calcEsi(employee(), at(25000), ESI_RULES, 6).applicable).toBe(false)
  })

  it('keeps cover for the rest of the contribution period once enrolled', () => {
    // The rule the current app makes a human toggle by hand.
    const r = calcEsi(employee({ esiCoveredAtPeriodStart: true }), at(25000), ESI_RULES, 6)
    expect(r.applicable).toBe(true)
    expect(r.trace.note).toContain('already covered')
    expect(r.trace.inputs!['Contribution period']).toBe('April–September')
  })

  it('lets a hand-set override win over the wage test', () => {
    expect(calcEsi(employee({ esiOverride: false }), at(10000), ESI_RULES, 6).applicable).toBe(false)
  })
})

// ============================================
// Workflow
// ============================================

describe('run workflow', () => {
  const base = { lineCount: 10, calculatedAt: '2026-07-01', blockingExceptions: 0, unresolvedExceptions: 0, approvedBy: 'u1', varianceAcknowledged: true, paidLineCount: 10 }

  it('walks the happy path', () => {
    const path: [string, string][] = [
      ['draft', 'review'], ['review', 'calculated'], ['calculated', 'pending_approval'],
      ['pending_approval', 'approved'], ['approved', 'locked'], ['locked', 'paid'], ['paid', 'reconciled'],
    ]
    for (const [from, to] of path) {
      expect(canTransition(from as never, to as never, base).allowed, `${from} → ${to}`).toBe(true)
    }
  })

  it('blocks approval while a blocking exception is open', () => {
    const r = canTransition('pending_approval', 'approved', { ...base, blockingExceptions: 2 })
    expect(r.allowed).toBe(false)
    expect(r.reason).toContain('2 blocking exception')
  })

  it('blocks approval until the variance has been reviewed', () => {
    expect(canTransition('pending_approval', 'approved', { ...base, varianceAcknowledged: false }).allowed).toBe(false)
  })

  it('blocks locking without an approver on record', () => {
    expect(canTransition('approved', 'locked', { ...base, approvedBy: null }).allowed).toBe(false)
  })

  it('never reopens a locked run, and says why', () => {
    const r = canTransition('locked', 'review', base)
    expect(r.allowed).toBe(false)
    expect(r.reason).toContain('supplementary run')
    expect(isImmutable('locked')).toBe(true)
    expect(isImmutable('paid')).toBe(true)
  })

  it('will not reconcile until every line is confirmed paid', () => {
    expect(canTransition('paid', 'reconciled', { ...base, paidLineCount: 9 }).allowed).toBe(false)
  })
})

// ============================================
// Recoveries and arrears
// ============================================

describe('recoveries', () => {
  const loan = {
    id: 'l1', label: 'Personal loan', principal: 50000, outstanding: 50000, emiAmount: 5000,
    interestType: 'reducing' as const, interestRate: 12, tenureMonths: 12, startPeriod: '2026-01', status: 'active' as const,
  }

  it('takes the instalment when there is room', () => {
    const r = calcRecoveries({ advances: [], loans: [loan], availableNet: 30000, period: '2026-06' })
    expect(r.totalRecovered).toBe(5000)
    expect(r.recoveries[0].interestPart).toBe(500)   // 50,000 × 12% ÷ 12
    expect(r.recoveries[0].principalPart).toBe(4500)
  })

  it('never drives net pay below zero, and carries the shortfall forward', () => {
    const r = calcRecoveries({ advances: [], loans: [loan], availableNet: 1200, period: '2026-06' })
    expect(r.totalRecovered).toBe(1200)
    expect(r.recoveries[0].carriedForward).toBe(3800)
    expect(r.recoveries[0].trace.note).toContain('carries forward')
  })

  it('does not start before the schedule does', () => {
    expect(calcRecoveries({ advances: [], loans: [loan], availableNet: 30000, period: '2025-12' }).totalRecovered).toBe(0)
  })

  it('clears advances before loans', () => {
    const adv = { id: 'a1', label: 'Festival advance', outstanding: 3000, recoveryMode: 'emi' as const, emiAmount: 3000, startPeriod: '2026-01', status: 'active' as const }
    const r = calcRecoveries({ advances: [adv], loans: [loan], availableNet: 3500, period: '2026-06' })
    expect(r.recoveries[0].sourceKind).toBe('advance')
    expect(r.recoveries[0].recovered).toBe(3000)
    expect(r.recoveries[1].recovered).toBe(500)
  })

  it('amortises a schedule down to a zero balance', () => {
    const emi = suggestedEmi(50000, 12, 12, 'reducing')
    const sched = buildLoanSchedule({ ...loan, emiAmount: emi })
    expect(sched.length).toBeLessThanOrEqual(12)
    expect(sched[sched.length - 1].balance).toBe(0)
  })
})

describe('arrears', () => {
  it('pays the difference for locked months without touching them', () => {
    const a = computeArrears([
      { period: '2026-04', paid: { BASIC: 20000, HRA: 8000 }, revised: { BASIC: 21600, HRA: 8640 } },
      { period: '2026-05', paid: { BASIC: 20000, HRA: 8000 }, revised: { BASIC: 21600, HRA: 8640 } },
    ])
    expect(a.amount).toBe(4480)
    expect(a.breakdown).toHaveLength(4)
  })

  it('does not claw money back out of a locked month', () => {
    const a = computeArrears([{ period: '2026-04', paid: { BASIC: 20000 }, revised: { BASIC: 18000 } }])
    expect(a.amount).toBe(0)
  })
})

// ============================================
// Variance
// ============================================

describe('variance', () => {
  const line = (id: string, name: string, net: number, over = {}) => ({
    employeeId: id, employeeName: name, netPay: net, grossEarnings: net, lopDays: 0,
    structureId: 'struct-1', componentTotals: {}, ...over,
  })

  it('attributes a new joiner and an exit separately', () => {
    const v = computeVariance([line('a', 'A', 30000), line('b', 'B', 30000)], [line('a', 'A', 30000), line('c', 'C', 25000)])
    expect(v.bands.find(b => b.reason === 'new_joiner')!.amount).toBe(25000)
    expect(v.bands.find(b => b.reason === 'exit')!.amount).toBe(-30000)
    expect(v.delta).toBe(-5000)
  })

  it('attributes a structure change to a revision', () => {
    const v = computeVariance([line('a', 'A', 30000)], [line('a', 'A', 33000, { structureId: 'struct-2' })])
    expect(v.bands.find(b => b.reason === 'increment')!.amount).toBe(3000)
  })

  it('flips the sign on deductions so the waterfall reads correctly', () => {
    const v = computeVariance(
      [line('a', 'A', 30000, { componentTotals: { TDS: 1000 } })],
      [line('a', 'A', 28000, { componentTotals: { TDS: 3000 } })],
    )
    expect(v.bands.find(b => b.reason === 'statutory_change')!.amount).toBe(-2000)
  })

  it('surfaces outliers past the threshold', () => {
    const v = computeVariance([line('a', 'A', 30000)], [line('a', 'A', 45000)], 15)
    expect(v.outliers[0].deltaPercent).toBe(50)
  })
})

// ============================================
// End to end
// ============================================

describe('calcLine', () => {
  it('produces a clean full-attendance month', () => {
    const r = calcLine(engineInput(), TODAY)
    expect(r.grossEarnings).toBe(40000)
    expect(r.lopDays).toBe(0)
    expect(r.paidDays).toBe(30)
    // PF on Basic + DA = 22,000 → 2,640. ESI does not apply at a 40,000 gross.
    expect(r.components.find(c => c.code === 'PF')!.amount).toBe(2640)
    expect(r.components.find(c => c.code === 'ESI')).toBeUndefined()
    expect(r.warnings.filter(w => w.severity === 'block')).toHaveLength(0)
  })

  it('reduces the heads themselves for LOP, so PF sits on earned wages', () => {
    const p = period()
    const withLeave = engineInput({
      attendance: presentMonth(p.from, p.to, [
        { date: '2026-06-02', status: 'absent' },
        { date: '2026-06-03', status: 'absent' },
        { date: '2026-06-04', status: 'absent' },
      ]),
    })
    const r = calcLine(withLeave, TODAY)
    // Default policy: 1 free leave, then 1 LOP day each → 2 LOP days of 30.
    expect(r.lopDays).toBe(2)
    expect(r.grossEarnings).toBeLessThan(40000)
    expect(r.components.find(c => c.code === 'PF')!.amount).toBeLessThan(2640)
    expect(r.components.find(c => c.code === 'LOP')!.amount).toBeGreaterThan(0)
  })

  it('does not deduct for approved leave the policy treats as paid', () => {
    const p = period()
    const r = calcLine(engineInput({
      attendance: presentMonth(p.from, p.to, [
        { date: '2026-06-02', status: 'absent', leaveType: 'casual', leaveApplicationId: 'la-1' },
        { date: '2026-06-03', status: 'absent', leaveType: 'casual', leaveApplicationId: 'la-2' },
      ]),
    }), TODAY)
    expect(r.lopDays).toBe(0)
    expect(r.grossEarnings).toBe(40000)
  })

  it('prices two cohorts differently from the same attendance', () => {
    const p = period()
    const attendance = presentMonth(p.from, p.to, [
      { date: '2026-06-02', status: 'absent' }, { date: '2026-06-03', status: 'absent' },
      { date: '2026-06-04', status: 'absent' },
    ])
    const lenient = calcLine(engineInput({ attendance }), TODAY)
    const strict = calcLine(engineInput({
      attendance,
      policyGroups: [
        policyGroup(),
        policyGroup({
          id: 'pg-strict', name: 'Primary section', isDefault: false, priority: 10, memberIds: ['emp-1'],
          policy: { ...BUILTIN_POLICY, lop: { ...BUILTIN_POLICY.lop, leave: { freeCount: 0, tiers: [{ count: null, lopDaysEach: 1 }] } } },
        }),
      ],
    }), TODAY)
    expect(lenient.lopDays).toBe(2)
    expect(strict.lopDays).toBe(3)
    expect(strict.policyGroupId).toBe('pg-strict')
    expect(strict.attendance.trace.policy!.why).toContain('listed as a member')
  })

  it('prorates a mid-month joiner without calling it absence', () => {
    const r = calcLine(engineInput({ employee: employee({ dateOfJoining: '2026-06-16' }) }), TODAY)
    expect(r.lopDays).toBe(0)
    expect(r.grossEarnings).toBe(20000) // 15 of 30 days on the roll
    const day = r.attendance.days.find(d => d.date === '2026-06-05')!
    expect(day.reason).toContain('not on the roll')
  })

  it('treats an unmarked past working day as unauthorised absence and warns', () => {
    const p = period()
    const attendance = presentMonth(p.from, p.to).filter(d => d.date !== '2026-06-09' && d.date !== '2026-06-10')
    const r = calcLine(engineInput({ attendance }), TODAY)
    expect(r.warnings.some(w => w.code === 'ATTENDANCE_INCOMPLETE')).toBe(true)
    expect(r.lopDays).toBeGreaterThan(0)
  })

  it('blocks a run when there is no structure in force', () => {
    const r = calcLine(engineInput({ assignments: [] }), TODAY)
    expect(r.warnings.find(w => w.code === 'NO_STRUCTURE')!.severity).toBe('block')
    expect(r.netPay).toBe(0)
  })

  it('blocks a PF deduction with no UAN, which would make the ECR unfilable', () => {
    const r = calcLine(engineInput({ employee: employee({ uan: null }) }), TODAY)
    expect(r.warnings.find(w => w.code === 'MISSING_UAN')!.severity).toBe('block')
  })

  it('pays arrears without disturbing the months they belong to', () => {
    const r = calcLine(engineInput({
      arrears: [{
        id: 'ar-1', amount: 4480, fromPeriod: '2026-04', toPeriod: '2026-05', label: 'April increment',
        breakdown: [{ period: '2026-04', componentCode: 'BASIC', was: 20000, now: 21600, delta: 1600 }],
      }],
    }), TODAY)
    const arrear = r.components.find(c => c.code === 'ARREARS')!
    expect(arrear.amount).toBe(4480)
    expect(arrear.trace.note).toContain('original payslips for these months are unchanged')
  })

  it('settles an exit in full — encashment, notice, gratuity and the whole loan', () => {
    const r = calcLine(engineInput({
      period: period({ from: '2026-06-01', to: '2026-06-15' }),
      employee: employee({ dateOfExit: '2026-06-15' }),
      policyGroups: [policyGroup({ policy: { ...BUILTIN_POLICY, encashment: { rateBasis: 'basic', maxDays: 30, enabled: true }, noticePeriodDays: 60 } })],
      loans: [{ id: 'l1', label: 'Loan', principal: 50000, outstanding: 12000, emiAmount: 5000, interestType: 'none', interestRate: 0, tenureMonths: 12, startPeriod: '2026-01', status: 'active' }],
      settlement: {
        lastWorkingDay: '2026-06-15', noticeDaysRequired: 60, noticeDaysServed: 30,
        encashableLeaveDays: 14, serviceYears: 7, serviceDaysInFinalYear: 200,
        bonusEligibleDays: 300, bonusYearWages: 480000,
      },
    }), TODAY)

    expect(r.components.find(c => c.code === 'LEAVE_ENCASH')!.amount).toBeGreaterThan(0)
    expect(r.components.find(c => c.code === 'NOTICE_RECOVERY')!.amount).toBeGreaterThan(0)
    expect(r.components.find(c => c.code === 'GRATUITY')!.amount).toBeGreaterThan(0)
    // The whole outstanding is taken on exit, not one instalment — capped by what is left.
    expect(r.recoveries[0].due).toBe(12000)
  })

  it('denies gratuity under five years but explains the test it failed', () => {
    const r = calcLine(engineInput({
      employee: employee({ dateOfExit: '2026-06-15' }),
      settlement: {
        lastWorkingDay: '2026-06-15', noticeDaysRequired: 0, noticeDaysServed: 0,
        encashableLeaveDays: 0, serviceYears: 3, serviceDaysInFinalYear: 100,
        bonusEligibleDays: 300, bonusYearWages: 480000,
      },
    }), TODAY)
    const g = r.components.find(c => c.code === 'GRATUITY')!
    expect(g.amount).toBe(0)
    expect(g.trace.note).toContain('5 years of continuous service')
  })

  it('carries a trace in which every total can be traced to its parts', () => {
    const r = calcLine(engineInput(), TODAY)
    const earnings = r.trace.children!.find(c => c.label === 'Earnings')!
    expect(round2(earnings.children!.reduce((s, c) => s + c.value, 0))).toBe(r.grossEarnings)
    expect(r.trace.value).toBe(r.netPay)
    expect(r.trace.note).toContain('school-wide default')
  })

  it('gives the same answer twice — a preview cannot disagree with the run', () => {
    const input = engineInput()
    expect(JSON.stringify(calcLine(input, TODAY))).toBe(JSON.stringify(calcLine(input, TODAY)))
  })
})

describe('financial year helpers', () => {
  it('starts the year in April', () => {
    expect(monthIndexInFinancialYear(4)).toBe(1)
    expect(monthIndexInFinancialYear(3)).toBe(12)
    expect(financialYearOf(2026, 6)).toBe('2026-27')
    expect(financialYearOf(2026, 2)).toBe('2025-26')
  })
})
