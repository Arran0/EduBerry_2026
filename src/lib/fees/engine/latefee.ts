// ─────────────────────────────────────────────────────────────────────────────
// Late fees.
//
// This is the arithmetic behind the rule builder's live sample, the sweep's
// confirmation screen and the nightly job. It mirrors `fee_compute_late_fee` in
// supabase-migrations/fee_r3_charges.sql line for line, and the tests pin both
// to the same answers — a preview that disagrees with the charge it previews is
// worse than having no preview, because the school acts on it.
//
// Two safeguards are structural rather than advisory:
//
//   `startsOn` never precedes `enabledFrom`, so switching a rule on today
//   cannot back-charge a term that was overdue in April.
//
//   A recurring rule without a cap is rejected by `validateRule`, and by a
//   CHECK constraint in the database. An uncapped percentage-per-day rule is
//   how a ₹200 late fee becomes ₹6,000 over a summer holiday, and the school
//   only finds out when the parents do.
// ─────────────────────────────────────────────────────────────────────────────

import { percentOf, type Paise } from './money'
import { addDays, daysBetween, isBefore, maxDate } from './dates'
import type { IsoDate } from './types'

export type ChargeType = 'flat' | 'percent'
export type Frequency = 'once' | 'daily' | 'weekly' | 'monthly'
export type Basis = 'whole' | 'unpaid'

export interface LateFeeRule {
  id: string
  name: string
  graceDays: number
  chargeType: ChargeType
  /** Rupees for `flat`; a percentage for `percent`. */
  rate: number
  frequency: Frequency
  basis: Basis
  capAmount: Paise | null
  capPercent: number | null
  enabled: boolean
  /** The day the rule was switched on. Nothing before it is ever charged. */
  enabledFrom: IsoDate | null
}

export interface LateFeeResult {
  amount: Paise
  days: number
  periods: number
  /** One period's charge, before repetition and capping. */
  unit: Paise
  cappedBy: 'amount' | 'percent' | null
  /** The day counting actually starts. */
  startsOn: IsoDate
  /** Plain English, for the Why panel and the invoice line's note. */
  why: string
}

const PERIOD_DAYS: Record<Exclude<Frequency, 'once'>, number> = {
  daily: 1, weekly: 7, monthly: 30,
}

/**
 * The day a rule starts counting for a bill: after the grace period, but never
 * before the rule was enabled.
 */
export function lateFeeStartDate(rule: LateFeeRule, dueDate: IsoDate): IsoDate {
  const afterGrace = addDays(dueDate, Math.max(0, rule.graceDays))
  return rule.enabledFrom ? maxDate(afterGrace, rule.enabledFrom) : afterGrace
}

export function computeLateFee(
  rule: LateFeeRule,
  base: Paise,
  dueDate: IsoDate,
  asOf: IsoDate,
): LateFeeResult {
  const startsOn = lateFeeStartDate(rule, dueDate)
  const days = Math.max(0, daysBetween(startsOn, asOf))

  if (days <= 0 || base <= 0) {
    return {
      amount: 0, days: 0, periods: 0, unit: 0, cappedBy: null, startsOn,
      why: isBefore(asOf, startsOn)
        ? `Not late yet — nothing is charged until ${startsOn}.`
        : 'Nothing outstanding, so nothing to charge.',
    }
  }

  const periods = rule.frequency === 'once'
    ? 1
    : Math.ceil(days / PERIOD_DAYS[rule.frequency])

  const unit = rule.chargeType === 'flat'
    ? Math.round(rule.rate * 100)
    : percentOf(base, rule.rate)

  let amount = unit * periods
  let cappedBy: LateFeeResult['cappedBy'] = null

  if (rule.capAmount !== null && amount > rule.capAmount) {
    amount = rule.capAmount
    cappedBy = 'amount'
  }
  if (rule.capPercent !== null) {
    const cap = percentOf(base, rule.capPercent)
    if (amount > cap) { amount = cap; cappedBy = 'percent' }
  }

  const per = rule.chargeType === 'flat'
    ? `₹${rule.rate}`
    : `${rule.rate}% of ₹${(base / 100).toLocaleString('en-IN')}`
  const repeated = rule.frequency === 'once' ? 'once' : `× ${periods} ${rule.frequency}`

  return {
    amount, days, periods, unit, cappedBy, startsOn,
    why: `${days} days late from ${startsOn}. ${per} ${repeated} = ` +
         `₹${(amount / 100).toLocaleString('en-IN')}${cappedBy ? ' (capped)' : ''}`,
  }
}

export interface RuleWarning {
  level: 'error' | 'warning'
  message: string
}

/**
 * What the rule builder shows beside the form as it is typed.
 *
 * `error` blocks saving; `warning` is the red box that says "this is legal but
 * you probably did not mean it". The school is about to point this at real
 * families, and the moment to catch an extra zero is before it is switched on.
 */
export function validateRule(rule: LateFeeRule, sampleBill: Paise): RuleWarning[] {
  const out: RuleWarning[] = []

  if (rule.rate <= 0) {
    out.push({ level: 'error', message: 'A rate of zero would never charge anything.' })
  }

  if (rule.frequency !== 'once' && rule.capAmount === null && rule.capPercent === null) {
    out.push({
      level: 'error',
      message: 'A repeating late fee needs a cap. Without one it keeps growing for as long ' +
               'as the bill is unpaid, including over a holiday when nobody is watching.',
    })
  }

  if (rule.chargeType === 'percent' && rule.rate > 5 && rule.frequency !== 'once') {
    out.push({
      level: 'warning',
      message: `${rule.rate}% ${rule.frequency} compounds fast. Check the sample below before ` +
               'switching this on.',
    })
  }

  if (rule.graceDays === 0) {
    out.push({
      level: 'warning',
      message: 'With no grace days, a bill is charged the day after it falls due — including ' +
               'a payment made on the due date that reaches the bank the next morning.',
    })
  }

  // The test that matters: what does this actually cost a family in a term?
  const ninetyDays = computeLateFee(
    { ...rule, enabledFrom: null }, sampleBill, '2026-01-01', '2026-04-01')

  if (ninetyDays.amount > sampleBill) {
    out.push({
      level: 'error',
      message: 'Over three months this would charge more than the bill itself. Add a cap, or ' +
               'reduce the rate.',
    })
  } else if (ninetyDays.amount > sampleBill / 4) {
    out.push({
      level: 'warning',
      message: `Over three months this reaches ₹${(ninetyDays.amount / 100).toLocaleString('en-IN')} ` +
               `on a ₹${(sampleBill / 100).toLocaleString('en-IN')} bill — more than a quarter of it.`,
    })
  }

  return out
}

/**
 * The rule that applies to a bill when several could.
 *
 * Most specific wins: an installment rule beats a structure rule beats a group
 * rule beats the school-wide one. Two rules charging the same bill is the
 * outcome nobody expects and nobody can explain to a parent.
 */
const SCOPE_RANK: Record<string, number> = {
  installment: 0, structure: 1, group: 2, all: 3,
}

export function pickRule<T extends { scope: string; enabled: boolean }>(rules: T[]): T | null {
  const live = rules.filter(r => r.enabled)
  if (live.length === 0) return null
  return [...live].sort((a, b) => (SCOPE_RANK[a.scope] ?? 9) - (SCOPE_RANK[b.scope] ?? 9))[0]
}
