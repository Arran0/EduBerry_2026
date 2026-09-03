// ============================================================================
// Statutory deductions — PF, ESI, Professional Tax, Labour Welfare Fund.
// ----------------------------------------------------------------------------
// Every rate, ceiling and slab in here arrives as a `RuleSet` pinned to the run.
// No number is written into this file. That is the whole point: when the EPFO
// changes a ceiling, a new rule-set version is published with a future effective
// date, and no already-locked run moves by a rupee.
//
// Each function returns its amount together with the rule version that produced
// it, so a payslip can say "0.75% under ESI rules v3, effective 2026-04-01"
// rather than just showing a number.
// ============================================================================

import type {
  EngineEmployee, ResolvedComponent, ExplainNode, RuleSet,
  PfRules, EsiRules, PtRules, LwfRules, EngineWarning,
} from './types'
import { round2, round0, ceilRupee, sum } from './money'

function ruleRef<T>(rs: RuleSet<T>) {
  return { domain: rs.domain, ruleSetId: rs.id, version: rs.version, effectiveFrom: rs.effectiveFrom }
}

/** Sum the earned (post-LOP) amounts of every head flagged as counting toward a wage base. */
export function wageBase(
  components: ResolvedComponent[], flag: 'countsForPf' | 'countsForEsi' | 'countsForPt',
): { total: number; heads: { code: string; name: string; amount: number }[] } {
  const heads = components
    .filter(c => c.kind === 'earning' && c.def[flag])
    .map(c => ({ code: c.code, name: c.name, amount: c.amount }))
  return { total: sum(heads.map(h => h.amount)), heads }
}

// ============================================
// Provident Fund
// ============================================

export interface PfResult {
  employee: number
  employerPf: number
  eps: number
  edli: number
  admin: number
  pfWages: number
  epsWages: number
  /** The EDLI wage base — needed by the ECR, which files it as its own column. */
  edliWages: number
  applicable: boolean
  trace: ExplainNode
}

export function calcPf(
  employee: EngineEmployee,
  components: ResolvedComponent[],
  rs: RuleSet<PfRules> | null,
): PfResult {
  const empty: PfResult = {
    employee: 0, employerPf: 0, eps: 0, edli: 0, admin: 0, pfWages: 0, epsWages: 0, edliWages: 0, applicable: false,
    trace: { label: 'Provident Fund', value: 0, unit: 'INR', note: 'No PF rule set is in force for this period.' },
  }
  if (!rs) return empty

  const r = rs.rules
  const base = wageBase(components, 'countsForPf')
  // An explicit PF wage is common where the school contributes on a figure agreed
  // with the member rather than on the derived heads. It wins when set.
  const derived = base.total
  const uncapped = employee.pfWageOverride ?? derived
  const pfWages = r.capPfWages ? Math.min(uncapped, r.pfWageCeiling) : uncapped

  if (!employee.pfApplicable) {
    return {
      ...empty,
      pfWages,
      trace: {
        label: 'Provident Fund', value: 0, unit: 'INR', rule: ruleRef(rs),
        note: 'This employee is not enrolled in PF, so nothing is deducted.',
        inputs: { 'PF wages if enrolled': pfWages },
      },
    }
  }

  const employeeShare = round0(pfWages * r.employeeRate)
  const epsWages = employee.epsApplicable ? Math.min(pfWages, r.epsWageCeiling) : 0
  const eps = employee.epsApplicable ? round0(epsWages * r.epsRate) : 0
  const employerTotal = round0(pfWages * r.employerRate)
  // The employer's 12% is not an extra payment on top of EPS — EPS is carved out
  // of it. Adding them would overstate employer cost by the pension share.
  const employerPf = round2(Math.max(0, employerTotal - eps))
  const edliWages = Math.min(pfWages, r.edliWageCeiling)
  const edli = round0(edliWages * r.edliRate)
  // Administrative charges carry a per-establishment monthly minimum, not a
  // per-member one, so only the rate is applied here; the floor is imposed on
  // the run total where it actually belongs.
  const admin = round2(pfWages * r.adminRate)

  return {
    employee: employeeShare, employerPf, eps, edli, admin, pfWages, epsWages, edliWages, applicable: true,
    trace: {
      label: 'Provident Fund', value: employeeShare, unit: 'INR', rule: ruleRef(rs),
      formula: `PF wages × ${(r.employeeRate * 100).toFixed(2)}%`,
      inputs: {
        'PF wages': pfWages,
        'Employee rate': `${(r.employeeRate * 100).toFixed(2)}%`,
        ...(employee.pfWageOverride !== null ? { 'PF wage override': employee.pfWageOverride } : { 'Derived from heads': derived }),
      },
      note: employee.pfWageOverride !== null
        ? 'Calculated on the agreed PF wage held against this employee, not on gross pay.'
        : `Calculated on ${base.heads.map(h => h.name).join(' + ') || 'no PF-eligible heads'}.`,
      children: [
        { label: 'Employer share to PF', value: employerPf, unit: 'INR', formula: `PF wages × ${(r.employerRate * 100).toFixed(2)}% less the pension share`, rule: ruleRef(rs) },
        {
          label: 'Employer share to pension (EPS)', value: eps, unit: 'INR', rule: ruleRef(rs),
          formula: `min(PF wages, ₹${r.epsWageCeiling}) × ${(r.epsRate * 100).toFixed(2)}%`,
          inputs: { 'EPS wages': epsWages },
          note: employee.epsApplicable ? undefined : 'This member is outside the pension scheme.',
        },
        { label: 'EDLI', value: edli, unit: 'INR', rule: ruleRef(rs), formula: `min(PF wages, ₹${r.edliWageCeiling}) × ${(r.edliRate * 100).toFixed(2)}%` },
        { label: 'PF administrative charges', value: admin, unit: 'INR', rule: ruleRef(rs), formula: `PF wages × ${(r.adminRate * 100).toFixed(2)}%`, note: `A ₹${r.adminMinimum} monthly minimum applies to the establishment as a whole, not per member.` },
      ],
    },
  }
}

// ============================================
// ESI
// ============================================

export interface EsiResult {
  employee: number
  employer: number
  esiWages: number
  applicable: boolean
  trace: ExplainNode
}

/** Which of the two statutory contribution periods a month falls in. */
export function contributionPeriodFor(month: number, r: EsiRules): { label: string; startMonth: number; endMonth: number } | null {
  return r.contributionPeriods.find(p =>
    p.startMonth <= p.endMonth
      ? month >= p.startMonth && month <= p.endMonth
      : month >= p.startMonth || month <= p.endMonth,
  ) ?? null
}

export function calcEsi(
  employee: EngineEmployee,
  components: ResolvedComponent[],
  rs: RuleSet<EsiRules> | null,
  month: number,
): EsiResult {
  if (!rs) {
    return {
      employee: 0, employer: 0, esiWages: 0, applicable: false,
      trace: { label: 'ESI', value: 0, unit: 'INR', note: 'No ESI rule set is in force for this period.' },
    }
  }
  const r = rs.rules
  const base = wageBase(components, 'countsForEsi')
  const esiWages = base.total
  const period = contributionPeriodFor(month, r)

  // Coverage, in the order the statute decides it:
  //   1. an explicit override set by the payroll office
  //   2. continuity — already covered when this contribution period opened
  //   3. wages at or under the ceiling
  let applicable: boolean
  let why: string
  if (employee.esiOverride !== null) {
    applicable = employee.esiOverride
    why = `Set by hand for this employee (${applicable ? 'covered' : 'not covered'}), overriding the wage test.`
  } else if (employee.esiCoveredAtPeriodStart && esiWages > r.wageCeiling) {
    applicable = true
    why = `Wages of ₹${round2(esiWages)} are above the ₹${r.wageCeiling} ceiling, but this member was already covered when the ${period?.label ?? 'current'} contribution period opened, so cover continues to the end of it.`
  } else {
    applicable = esiWages > 0 && esiWages <= r.wageCeiling
    why = applicable
      ? `Wages of ₹${round2(esiWages)} are at or under the ₹${r.wageCeiling} ceiling.`
      : `Wages of ₹${round2(esiWages)} are above the ₹${r.wageCeiling} ceiling and cover did not carry over from the start of the period.`
  }

  // Both shares are rounded up to the next rupee by statute, not to the nearest.
  const employeeShare = applicable ? ceilRupee(esiWages * r.employeeRate) : 0
  const employerShare = applicable ? ceilRupee(esiWages * r.employerRate) : 0

  return {
    employee: employeeShare, employer: employerShare, esiWages, applicable,
    trace: {
      label: 'ESI', value: employeeShare, unit: 'INR', rule: ruleRef(rs),
      formula: applicable ? `ESI wages × ${(r.employeeRate * 100).toFixed(2)}%, rounded up to the rupee` : 'not applicable',
      inputs: { 'ESI wages': esiWages, 'Wage ceiling': r.wageCeiling, 'Contribution period': period?.label ?? '—' },
      note: why,
      children: applicable
        ? [{ label: 'Employer share', value: employerShare, unit: 'INR' as const, rule: ruleRef(rs), formula: `ESI wages × ${(r.employerRate * 100).toFixed(2)}%, rounded up` }]
        : undefined,
    },
  }
}

// ============================================
// Professional Tax
// ============================================

export interface PtResult { amount: number; applicable: boolean; trace: ExplainNode }

export function calcPt(
  components: ResolvedComponent[],
  rs: RuleSet<PtRules> | null,
  month: number,
  jurisdiction: string,
): PtResult {
  if (!rs) {
    return { amount: 0, applicable: false, trace: { label: 'Professional Tax', value: 0, unit: 'INR', note: 'No Professional Tax rule set is in force.' } }
  }
  const r = rs.rules
  const base = wageBase(components, 'countsForPt')

  if (!r.deductionMonths.includes(month)) {
    return {
      amount: 0, applicable: false,
      trace: {
        label: 'Professional Tax', value: 0, unit: 'INR', rule: ruleRef(rs),
        note: `${jurisdiction} levies Professional Tax ${r.frequency === 'half_yearly' ? 'half-yearly' : 'monthly'}; it is deducted in ${r.deductionMonths.join(', ')} and this is month ${month}.`,
      },
    }
  }

  // A half-yearly slab is read against aggregate wages for the half-year. Payroll
  // runs a month at a time, so the current month's wages are annualised over the
  // period — the standard practice, and stated openly here rather than hidden.
  const multiplier = r.frequency === 'half_yearly' ? 6 : 1
  const assessable = round2(base.total * multiplier)
  const slab = r.slabs.find(s => s.upTo === null || assessable <= s.upTo)
  const amount = round2(Math.min(slab?.amount ?? 0, r.annualMaximum))

  return {
    amount, applicable: amount > 0,
    trace: {
      label: 'Professional Tax', value: amount, unit: 'INR', rule: ruleRef(rs),
      formula: r.frequency === 'half_yearly' ? 'slab on six months of wages' : 'slab on monthly wages',
      inputs: { 'Wages this month': base.total, 'Assessed on': assessable, 'Jurisdiction': jurisdiction },
      note: `${jurisdiction} slab for ₹${assessable} over the ${r.frequency === 'half_yearly' ? 'half-year' : 'month'}.`,
    },
  }
}

// ============================================
// Labour Welfare Fund
// ============================================

export interface LwfResult { employee: number; employer: number; trace: ExplainNode }

export function calcLwf(
  components: ResolvedComponent[],
  rs: RuleSet<LwfRules> | null,
  month: number,
  jurisdiction: string,
): LwfResult {
  if (!rs) {
    return { employee: 0, employer: 0, trace: { label: 'Labour Welfare Fund', value: 0, unit: 'INR', note: 'No LWF rule set is in force.' } }
  }
  const r = rs.rules
  const gross = sum(components.filter(c => c.kind === 'earning').map(c => c.amount))

  if (!r.deductionMonths.includes(month)) {
    return {
      employee: 0, employer: 0,
      trace: { label: 'Labour Welfare Fund', value: 0, unit: 'INR', rule: ruleRef(rs), note: `${jurisdiction} collects LWF in ${r.deductionMonths.join(', ')}; this is month ${month}.` },
    }
  }
  if (r.wageCeiling > 0 && gross > r.wageCeiling) {
    return {
      employee: 0, employer: 0,
      trace: { label: 'Labour Welfare Fund', value: 0, unit: 'INR', rule: ruleRef(rs), note: `Wages of ₹${gross} are above the ₹${r.wageCeiling} LWF ceiling.` },
    }
  }
  return {
    employee: r.employeeAmount, employer: r.employerAmount,
    trace: {
      label: 'Labour Welfare Fund', value: r.employeeAmount, unit: 'INR', rule: ruleRef(rs),
      formula: 'a flat statutory contribution',
      inputs: { Jurisdiction: jurisdiction, 'Employer share': r.employerAmount },
      note: `${jurisdiction} LWF, collected in month ${month}.`,
    },
  }
}

/** Identity checks that should stop a run rather than produce an unfilable return. */
export function statutoryWarnings(employee: EngineEmployee, pf: PfResult, esi: EsiResult): EngineWarning[] {
  const out: EngineWarning[] = []
  if (pf.applicable && !employee.uan) {
    out.push({ code: 'MISSING_UAN', severity: 'block', message: `${employee.name} has PF deducted but no UAN — the ECR cannot be filed.` })
  }
  if (esi.applicable && !employee.esiIpNumber) {
    out.push({ code: 'MISSING_IP_NUMBER', severity: 'block', message: `${employee.name} has ESI deducted but no IP number — the ESIC return cannot be filed.` })
  }
  return out
}
