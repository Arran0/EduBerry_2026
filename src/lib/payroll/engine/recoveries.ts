// ============================================================================
// Recoveries — salary advances and employee loans.
// ----------------------------------------------------------------------------
// Two rules shape everything here:
//
//   1. Net pay can never go negative. A month with heavy LOP plus a full EMI can
//      easily owe more than it pays. The recovery is trimmed to what is actually
//      available, and the shortfall is carried forward and *said out loud* on the
//      payslip, rather than silently skipped or silently overdrawn.
//
//   2. Outstanding is never a stored column. It is principal less the sum of
//      recorded repayments, so the balance and its history cannot disagree. This
//      module computes what is due; persisting the repayment is the caller's job.
// ============================================================================

import type { EngineAdvance, EngineLoan, RecoveryResult, ExplainNode } from './types'
import { round2, round0 } from './money'

/** Interest due on one instalment, under the loan's interest model. */
export function interestForPeriod(loan: EngineLoan): number {
  if (loan.interestType === 'none' || loan.interestRate <= 0) return 0
  const monthlyRate = loan.interestRate / 100 / 12
  // Flat interest is charged on the original principal for the whole tenure;
  // reducing balance charges only on what is still owed, which is why the same
  // headline rate costs materially less.
  const base = loan.interestType === 'flat' ? loan.principal : loan.outstanding
  return round2(base * monthlyRate)
}

export interface RecoveryArgs {
  advances: EngineAdvance[]
  loans: EngineLoan[]
  /** Net pay before recoveries — the ceiling on what can be taken this period. */
  availableNet: number
  /** 'YYYY-MM' — recoveries do not start before a schedule's start period. */
  period: string
}

export function calcRecoveries(args: RecoveryArgs): { recoveries: RecoveryResult[]; totalRecovered: number; trace: ExplainNode } {
  const { advances, loans, availableNet, period } = args
  let budget = Math.max(0, availableNet)
  const out: RecoveryResult[] = []

  // Advances are recovered before loans: they are short-term and interest-free,
  // so clearing them first costs the employee least.
  for (const a of advances) {
    if (a.status !== 'active' || a.outstanding <= 0 || period < a.startPeriod) continue
    const due = a.recoveryMode === 'single' ? a.outstanding : Math.min(a.emiAmount, a.outstanding)
    const recovered = round2(Math.min(due, budget))
    budget = round2(budget - recovered)
    out.push({
      componentCode: 'ADV_RECOVERY', label: `Advance recovery — ${a.label}`,
      sourceId: a.id, sourceKind: 'advance',
      due: round2(due), recovered, principalPart: recovered, interestPart: 0,
      carriedForward: round2(due - recovered),
      trace: {
        label: `Advance recovery — ${a.label}`, value: recovered, unit: 'INR',
        formula: a.recoveryMode === 'single' ? 'recovered in full from this month' : 'monthly instalment',
        inputs: { 'Outstanding before': a.outstanding, 'Instalment due': round2(due), 'Outstanding after': round2(a.outstanding - recovered) },
        note: recovered < due
          ? `Only ₹${recovered} could be recovered without taking net pay below zero. ₹${round2(due - recovered)} carries forward.`
          : undefined,
      },
    })
  }

  for (const l of loans) {
    if (l.status !== 'active' || l.outstanding <= 0 || period < l.startPeriod) continue
    const interest = interestForPeriod(l)
    // The final instalment settles whatever is left rather than leaving a few
    // rupees outstanding forever through rounding.
    const due = round2(Math.min(l.emiAmount, l.outstanding + interest))
    const recovered = round2(Math.min(due, budget))
    budget = round2(budget - recovered)
    const interestPart = round2(Math.min(interest, recovered))
    const principalPart = round2(recovered - interestPart)

    out.push({
      componentCode: 'LOAN_EMI', label: `Loan EMI — ${l.label}`,
      sourceId: l.id, sourceKind: 'loan',
      due, recovered, principalPart, interestPart,
      carriedForward: round2(due - recovered),
      trace: {
        label: `Loan EMI — ${l.label}`, value: recovered, unit: 'INR',
        formula: l.interestType === 'none'
          ? 'monthly instalment'
          : `instalment of ₹${l.emiAmount}, of which interest is ${l.interestType === 'flat' ? 'flat' : 'on the reducing balance'} at ${l.interestRate}% a year`,
        inputs: {
          'Outstanding before': l.outstanding,
          'Interest this month': interest,
          'Towards principal': principalPart,
          'Outstanding after': round2(l.outstanding - principalPart),
        },
        note: recovered < due
          ? `Only ₹${recovered} could be recovered without taking net pay below zero. ₹${round2(due - recovered)} carries forward to next month.`
          : undefined,
      },
    })
  }

  const totalRecovered = round2(out.reduce((s, r) => s + r.recovered, 0))
  return {
    recoveries: out,
    totalRecovered,
    trace: {
      label: 'Recoveries', value: totalRecovered, unit: 'INR',
      note: out.some(r => r.carriedForward > 0)
        ? 'One or more instalments were trimmed so that net pay did not fall below zero.'
        : undefined,
      children: out.map(r => r.trace),
    },
  }
}

/** Amortisation schedule for a new loan — what the employee is shown before they sign. */
export function buildLoanSchedule(loan: Pick<EngineLoan, 'principal' | 'interestRate' | 'interestType' | 'tenureMonths' | 'emiAmount' | 'startPeriod'>): {
  period: string; emiDue: number; principalPart: number; interestPart: number; balance: number
}[] {
  const out: { period: string; emiDue: number; principalPart: number; interestPart: number; balance: number }[] = []
  let balance = loan.principal
  const monthlyRate = loan.interestRate / 100 / 12
  const [startYear, startMonth] = loan.startPeriod.split('-').map(Number)

  for (let i = 0; i < loan.tenureMonths && balance > 0; i++) {
    const m = startMonth + i
    const year = startYear + Math.floor((m - 1) / 12)
    const month = ((m - 1) % 12) + 1
    const interest = loan.interestType === 'none' ? 0
      : loan.interestType === 'flat' ? round2(loan.principal * monthlyRate)
      : round2(balance * monthlyRate)
    // The last scheduled instalment settles whatever is left. A whole-rupee EMI
    // rarely amortises a loan exactly, so without this a 12-month loan quietly
    // runs a thirteenth month for a few rupees of rounding.
    const isFinal = i === loan.tenureMonths - 1
    const emi = round2(isFinal ? balance + interest : Math.min(loan.emiAmount, balance + interest))
    const principalPart = round2(emi - interest)
    balance = round2(Math.max(0, balance - principalPart))
    out.push({
      period: `${year}-${String(month).padStart(2, '0')}`,
      emiDue: emi, principalPart, interestPart: interest, balance,
    })
  }
  return out
}

/** The instalment that clears `principal` over `months` at a reducing-balance rate. */
export function suggestedEmi(principal: number, annualRate: number, months: number, interestType: EngineLoan['interestType']): number {
  if (months <= 0) return 0
  if (interestType === 'none' || annualRate <= 0) return round0(principal / months)
  const r = annualRate / 100 / 12
  if (interestType === 'flat') return round0((principal + principal * r * months) / months)
  return round0((principal * r * Math.pow(1 + r, months)) / (Math.pow(1 + r, months) - 1))
}
