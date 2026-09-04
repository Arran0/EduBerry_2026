// Fixture builders for the payroll engine tests. Everything defaults to a
// plausible small school and is overridable field by field, so a test says only
// what it is actually about.

import type {
  EngineInput, EngineEmployee, ComponentDef, EngineStructure, EngineAssignment,
  PolicyGroup, WorkingCalendar, PinnedRules, RuleSet, PfRules, EsiRules, PtRules,
  LwfRules, TdsRules, GratuityRules, BonusRules, EnginePeriod, EngineAttendanceDay, WorkLocation,
} from '../engine/types'
import { BUILTIN_POLICY } from '../engine/resolvePolicy'

export function component(over: Partial<ComponentDef> & Pick<ComponentDef, 'code' | 'name'>): ComponentDef {
  return {
    id: over.code, kind: 'earning', calcType: 'fixed', percentOf: null, formula: null, slabs: null,
    sequence: 10, rounding: 'nearest_rupee', isTaxable: true, countsForPf: false, countsForEsi: true,
    countsForPt: true, lopApplicable: true, prorateOnJoinExit: true, showOnPayslip: true, isSystem: false,
    ...over,
  }
}

/** Basic + HRA (40% of Basic) + DA (10% of Basic) + a balance Special Allowance. */
export const STANDARD_COMPONENTS: ComponentDef[] = [
  component({ code: 'BASIC', name: 'Basic', sequence: 10, countsForPf: true }),
  component({ code: 'HRA', name: 'House Rent Allowance', sequence: 20, calcType: 'percent_of', percentOf: 'BASIC' }),
  component({ code: 'DA', name: 'Dearness Allowance', sequence: 30, calcType: 'percent_of', percentOf: 'BASIC', countsForPf: true }),
  component({ code: 'SPL', name: 'Special Allowance', sequence: 40, calcType: 'balance' }),
]

export function structure(over: Partial<EngineStructure> = {}): EngineStructure {
  return {
    id: 'struct-1', name: 'PGT Grade A', version: 1,
    effectiveFrom: '2020-01-01', effectiveTo: null,
    components: [
      { componentCode: 'BASIC', calcType: 'fixed', value: 20000, formula: null, sequence: 10 },
      { componentCode: 'HRA', calcType: 'percent_of', value: 40, formula: null, sequence: 20 },
      { componentCode: 'DA', calcType: 'percent_of', value: 10, formula: null, sequence: 30 },
      { componentCode: 'SPL', calcType: 'balance', value: null, formula: null, sequence: 40 },
    ],
    ...over,
  }
}

export function assignment(over: Partial<EngineAssignment> = {}): EngineAssignment {
  return {
    id: 'assign-1', structureId: 'struct-1', effectiveFrom: '2020-01-01', effectiveTo: null,
    anchorAmount: 40000, revisionId: null, reason: null, ...over,
  }
}

export function employee(over: Partial<EngineEmployee> = {}): EngineEmployee {
  return {
    id: 'emp-1', name: 'A Rahman', category: 'teaching',
    dateOfJoining: '2019-06-01', dateOfExit: null,
    department: 'Science', designation: 'PGT',
    pan: 'ABCDE1234F', uan: '101234567890', esiIpNumber: '3101234567',
    pfApplicable: true, epsApplicable: true, esiOverride: null, esiCoveredAtPeriodStart: null,
    pfWageOverride: null, jurisdictionOverride: null, ...over,
  }
}

/**
 * One default location in Tamil Nadu, so a fixture without a location set up
 * behaves exactly as the single-state school did before locations existed.
 */
export function workLocation(over: Partial<WorkLocation> = {}): WorkLocation {
  return {
    id: 'loc-main', entityId: 'ent-1', entityName: 'Default entity', name: 'Main campus',
    stateCode: 'IN-TN', isDefault: true, priority: 0,
    effectiveFrom: '2000-01-01', effectiveTo: null, match: null, members: [],
    epfEstablishmentId: 'TNMAS0012345000', esiEmployerCode: '51000123450001000',
    ptRegistrationNo: null, lwfRegistrationNo: null, ...over,
  }
}

export function policyGroup(over: Partial<PolicyGroup> = {}): PolicyGroup {
  return {
    id: 'pg-default', name: 'Everyone', isDefault: true, priority: 0,
    effectiveFrom: '2000-01-01', effectiveTo: null, memberIds: [], match: null,
    policy: BUILTIN_POLICY, ...over,
  }
}

export function calendar(over: Partial<WorkingCalendar> = {}): WorkingCalendar {
  return {
    id: 'cal-default', name: 'School calendar', isDefault: true, priority: 0,
    effectiveFrom: '2000-01-01', effectiveTo: null, memberIds: [], match: null,
    basis: 'calendar_days', fixedDays: 30,
    weekPattern: ['off', 'full', 'full', 'full', 'full', 'full', 'full'],
    nthWeekdayRules: [], ...over,
  }
}

function rs<T>(domain: string, rules: T, over: Partial<RuleSet<T>> = {}): RuleSet<T> {
  return {
    id: `rs-${domain}`, domain: domain as RuleSet<T>['domain'], jurisdiction: 'IN',
    version: 1, effectiveFrom: '2026-04-01', effectiveTo: null, sourceNote: null,
    rules, ...over,
  }
}

export const PF_RULES: RuleSet<PfRules> = rs('pf', {
  employeeRate: 0.12, employerRate: 0.12, epsRate: 0.0833, epsWageCeiling: 15000,
  edliRate: 0.005, edliWageCeiling: 15000, adminRate: 0.005, adminMinimum: 500,
  capPfWages: false, pfWageCeiling: 15000, exemptionWageAtJoining: 15000,
})

export const ESI_RULES: RuleSet<EsiRules> = rs('esi', {
  employeeRate: 0.0075, employerRate: 0.0325, wageCeiling: 21000,
  contributionPeriods: [
    { startMonth: 4, endMonth: 9, label: 'April–September' },
    { startMonth: 10, endMonth: 3, label: 'October–March' },
  ],
})

export const PT_RULES: RuleSet<PtRules> = rs('pt', {
  frequency: 'half_yearly', deductionMonths: [8, 2], annualMaximum: 2500,
  slabs: [
    { upTo: 21000, amount: 0 },
    { upTo: 30000, amount: 135 },
    { upTo: 45000, amount: 315 },
    { upTo: 60000, amount: 690 },
    { upTo: 75000, amount: 1025 },
    { upTo: null, amount: 1250 },
  ],
}, { jurisdiction: 'IN-TN' })

export const LWF_RULES: RuleSet<LwfRules> = rs('lwf', {
  frequency: 'annual', deductionMonths: [12], employeeAmount: 20, employerAmount: 40, wageCeiling: 0,
}, { jurisdiction: 'IN-TN' })

export const TDS_RULES: RuleSet<TdsRules> = rs('tds', {
  financialYear: '2026-27',
  defaultRegime: 'new',
  regimes: [
    {
      name: 'new',
      slabs: [
        { upTo: 400000, rate: 0 }, { upTo: 800000, rate: 0.05 }, { upTo: 1200000, rate: 0.10 },
        { upTo: 1600000, rate: 0.15 }, { upTo: 2000000, rate: 0.20 }, { upTo: 2400000, rate: 0.25 },
        { upTo: null, rate: 0.30 },
      ],
      standardDeduction: 75000, rebateLimit: 1200000, rebateMax: 60000, cessRate: 0.04,
      surcharge: [{ above: 5000000, rate: 0.10 }, { above: 10000000, rate: 0.15 }],
      allowedDeductions: ['80CCD(2)'],
    },
    {
      name: 'old',
      slabs: [
        { upTo: 250000, rate: 0 }, { upTo: 500000, rate: 0.05 },
        { upTo: 1000000, rate: 0.20 }, { upTo: null, rate: 0.30 },
      ],
      standardDeduction: 50000, rebateLimit: 500000, rebateMax: 12500, cessRate: 0.04,
      surcharge: [{ above: 5000000, rate: 0.10 }],
      allowedDeductions: ['80C', '80D', '80CCD(1B)', '80TTA', '24(b)', '16(iii)', '80G', '80E'],
    },
  ],
})

export const GRATUITY_RULES: RuleSet<GratuityRules> = rs('gratuity', {
  daysPerYear: 15, monthDays: 26, minimumYears: 5, qualifyingDaysInFinalYear: 240,
  maximumAmount: 2000000, wageBasis: 'basic_plus_da',
})

export const BONUS_RULES: RuleSet<BonusRules> = rs('bonus', {
  minimumRate: 0.0833, maximumRate: 0.20, eligibilityWageCeiling: 21000,
  calculationWageCeiling: 7000, minimumWorkingDays: 30,
})

export const ALL_RULES: PinnedRules = {
  pf: PF_RULES, esi: ESI_RULES, pt: PT_RULES, lwf: LWF_RULES,
  tds: TDS_RULES, gratuity: GRATUITY_RULES, bonus: BONUS_RULES,
}

export function period(over: Partial<EnginePeriod> = {}): EnginePeriod {
  return { year: 2026, month: 6, from: '2026-06-01', to: '2026-06-30', financialYear: '2026-27', ...over }
}

/** A full month of present days, so a test only has to state the exceptions. */
export function presentMonth(from: string, to: string, exceptions: Partial<EngineAttendanceDay>[] = []): EngineAttendanceDay[] {
  const out: EngineAttendanceDay[] = []
  const start = new Date(`${from}T12:00:00Z`)
  const end = new Date(`${to}T12:00:00Z`)
  for (let d = start; d <= end; d = new Date(d.getTime() + 86400000)) {
    out.push({ date: d.toISOString().slice(0, 10), status: 'present', leaveType: null, leaveApplicationId: null, lateByMinutes: null, correctionId: null })
  }
  for (const ex of exceptions) {
    const i = out.findIndex(d => d.date === ex.date)
    if (i >= 0) out[i] = { ...out[i], ...ex }
  }
  return out
}

export function engineInput(over: Partial<EngineInput> = {}): EngineInput {
  const p = over.period ?? period()
  return {
    period: p,
    employee: employee(),
    assignments: [assignment()],
    structures: [structure()],
    overrides: [],
    components: STANDARD_COMPONENTS,
    policyGroups: [policyGroup()],
    calendars: [calendar()],
    locations: [workLocation()],
    defaultJurisdiction: 'IN-TN',
    holidays: [],
    attendance: presentMonth(p.from, p.to),
    rules: ALL_RULES,
    arrears: [], advances: [], loans: [],
    declaration: null, ytd: null, adjustments: [], settlement: null,
    ...over,
  }
}
