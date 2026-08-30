// ============================================================================
// Full and final settlement.
// ----------------------------------------------------------------------------
// Assembles the exit components on top of an ordinary run: the final month is
// already prorated and LOP'd by the normal machinery, so this module only adds
// what is specific to leaving — encashment, notice recovery, gratuity and the
// statutory bonus proportion. Loans and advances are recovered by the ordinary
// recovery pass, except that on an F&F the whole outstanding is taken rather
// than one instalment.
//
// An F&F is a `run_type = 'ff'` run, so it inherits exceptions, approval, lock
// and trace exactly like a monthly run. A settlement nobody approved and nobody
// can explain is how disputes with departing staff start.
// ============================================================================

import type {
  SettlementInput, PayrollPolicy, ResolvedComponent, ExplainNode, RuleSet,
  GratuityRules, BonusRules, PolicySource,
} from './types'
import { round0, round2, sum } from './money'

export interface FfComponent {
  code: string
  label: string
  kind: 'earning' | 'deduction'
  amount: number
  trace: ExplainNode
}

/** The daily rate encashment and notice recovery are priced at. */
export function settlementDayRate(
  components: ResolvedComponent[], policy: PayrollPolicy, payableDays: number,
): { rate: number; basisLabel: string; basisAmount: number } {
  const basisAmount = policy.encashment.rateBasis === 'gross'
    ? sum(components.filter(c => c.kind === 'earning').map(c => c.fullAmount))
    : sum(components.filter(c => c.kind === 'earning' && c.code === 'BASIC').map(c => c.fullAmount))
  const days = Math.max(1, payableDays)
  return {
    rate: round2(basisAmount / days),
    basisLabel: policy.encashment.rateBasis === 'gross' ? 'gross pay' : 'basic pay',
    basisAmount,
  }
}

export function calcLeaveEncashment(
  s: SettlementInput, policy: PayrollPolicy, dayRate: { rate: number; basisLabel: string; basisAmount: number }, source: PolicySource,
): FfComponent | null {
  if (!policy.encashment.enabled || s.encashableLeaveDays <= 0) return null
  const days = Math.min(s.encashableLeaveDays, policy.encashment.maxDays)
  const amount = round0(days * dayRate.rate)
  return {
    code: 'LEAVE_ENCASH', label: 'Leave encashment', kind: 'earning', amount,
    trace: {
      label: 'Leave encashment', value: amount, unit: 'INR', policy: source,
      formula: `${days} day(s) × ₹${dayRate.rate} a day`,
      inputs: {
        'Encashable balance': s.encashableLeaveDays,
        'Capped at': policy.encashment.maxDays,
        'Day rate basis': dayRate.basisLabel,
        'Monthly basis amount': dayRate.basisAmount,
      },
      note: s.encashableLeaveDays > policy.encashment.maxDays
        ? `${s.encashableLeaveDays} days are unused but "${source.groupName}" caps encashment at ${policy.encashment.maxDays}.`
        : undefined,
    },
  }
}

export function calcNoticeRecovery(
  s: SettlementInput, dayRate: { rate: number; basisLabel: string }, source: PolicySource,
): FfComponent | null {
  const short = Math.max(0, s.noticeDaysRequired - s.noticeDaysServed)
  if (short <= 0) return null
  const amount = round0(short * dayRate.rate)
  return {
    code: 'NOTICE_RECOVERY', label: 'Notice period recovery', kind: 'deduction', amount,
    trace: {
      label: 'Notice period recovery', value: -amount, unit: 'INR', policy: source,
      formula: `${short} day(s) short × ₹${dayRate.rate} a day`,
      inputs: { 'Notice required': s.noticeDaysRequired, 'Notice served': s.noticeDaysServed, 'Days short': short },
      note: `"${source.groupName}" requires ${s.noticeDaysRequired} days' notice; ${s.noticeDaysServed} were served.`,
    },
  }
}

export function calcGratuity(
  s: SettlementInput, components: ResolvedComponent[], rs: RuleSet<GratuityRules> | null,
): FfComponent | null {
  if (!rs) return null
  const r = rs.rules
  const rule = { domain: 'gratuity' as const, ruleSetId: rs.id, version: rs.version, effectiveFrom: rs.effectiveFrom }

  // The "4 years and 240 days counts as the fifth" reading, which is what most
  // tribunals have held and what a school will be held to.
  const qualifies = s.serviceYears >= r.minimumYears ||
    (s.serviceYears >= r.minimumYears - 1 && s.serviceDaysInFinalYear >= r.qualifyingDaysInFinalYear)

  const wages = r.wageBasis === 'gross'
    ? sum(components.filter(c => c.kind === 'earning').map(c => c.fullAmount))
    : sum(components.filter(c => c.kind === 'earning' && (c.code === 'BASIC' || (r.wageBasis === 'basic_plus_da' && c.code === 'DA'))).map(c => c.fullAmount))

  if (!qualifies) {
    return {
      code: 'GRATUITY', label: 'Gratuity', kind: 'earning', amount: 0,
      trace: {
        label: 'Gratuity', value: 0, unit: 'INR', rule,
        inputs: { 'Completed years': s.serviceYears, 'Days in the final year': s.serviceDaysInFinalYear },
        note: `Gratuity needs ${r.minimumYears} years of continuous service (or ${r.minimumYears - 1} years and ${r.qualifyingDaysInFinalYear} days). This service does not reach it.`,
      },
    }
  }

  // Round the service to the nearest whole year: six months or more counts as a
  // full year, which is the settled reading of the Act.
  const years = Math.floor(s.serviceYears) + (s.serviceDaysInFinalYear >= 182 ? 1 : 0)
  const raw = (wages / r.monthDays) * r.daysPerYear * years
  const amount = round0(Math.min(raw, r.maximumAmount))

  return {
    code: 'GRATUITY', label: 'Gratuity', kind: 'earning', amount,
    trace: {
      label: 'Gratuity', value: amount, unit: 'INR', rule,
      formula: `${r.wageBasis === 'gross' ? 'gross' : r.wageBasis === 'basic_plus_da' ? 'basic + DA' : 'basic'} ÷ ${r.monthDays} × ${r.daysPerYear} × ${years} year(s)`,
      inputs: { 'Last drawn wages': round2(wages), 'Completed years counted': years, 'Statutory cap': r.maximumAmount },
      note: raw > r.maximumAmount ? `Calculated at ₹${round0(raw).toLocaleString('en-IN')} but capped at the statutory maximum.` : undefined,
    },
  }
}

export function calcStatutoryBonus(
  s: SettlementInput, monthlyWages: number, rs: RuleSet<BonusRules> | null,
): FfComponent | null {
  if (!rs) return null
  const r = rs.rules
  const rule = { domain: 'bonus' as const, ruleSetId: rs.id, version: rs.version, effectiveFrom: rs.effectiveFrom }

  if (monthlyWages > r.eligibilityWageCeiling) {
    return {
      code: 'STAT_BONUS', label: 'Statutory bonus', kind: 'earning', amount: 0,
      trace: {
        label: 'Statutory bonus', value: 0, unit: 'INR', rule,
        inputs: { 'Monthly wages': monthlyWages, 'Eligibility ceiling': r.eligibilityWageCeiling },
        note: `Wages are above the ₹${r.eligibilityWageCeiling} eligibility ceiling, so no statutory bonus is payable.`,
      },
    }
  }
  if (s.bonusEligibleDays < r.minimumWorkingDays) {
    return {
      code: 'STAT_BONUS', label: 'Statutory bonus', kind: 'earning', amount: 0,
      trace: {
        label: 'Statutory bonus', value: 0, unit: 'INR', rule,
        inputs: { 'Days worked in the bonus year': s.bonusEligibleDays, 'Minimum required': r.minimumWorkingDays },
        note: `The Act requires ${r.minimumWorkingDays} working days in the accounting year.`,
      },
    }
  }

  // Bonus is computed on the lower of actual wages and the calculation ceiling.
  const cappedWages = Math.min(s.bonusYearWages, r.calculationWageCeiling * 12)
  const amount = round0(cappedWages * r.minimumRate)
  return {
    code: 'STAT_BONUS', label: 'Statutory bonus', kind: 'earning', amount,
    trace: {
      label: 'Statutory bonus', value: amount, unit: 'INR', rule,
      formula: `${(r.minimumRate * 100).toFixed(2)}% of wages for the bonus year`,
      inputs: {
        'Wages in the bonus year': s.bonusYearWages,
        'Assessed on': cappedWages,
        'Calculation ceiling': `₹${r.calculationWageCeiling} a month`,
        'Days worked': s.bonusEligibleDays,
      },
      note: s.bonusYearWages > cappedWages
        ? `Actual wages exceed the ₹${r.calculationWageCeiling}/month calculation ceiling, so the bonus is computed on the ceiling.`
        : undefined,
    },
  }
}
