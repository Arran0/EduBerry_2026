// ============================================================================
// Variance — "why did payroll go up ₹1.8L this month?"
// ----------------------------------------------------------------------------
// Diffs two runs and attributes every rupee of movement to a cause. This is only
// possible because each line stores its own trace: the structure it used, the
// policy that priced its LOP, whether arrears or a bonus were paid. Attributing
// a difference without that means guessing, which is why the competition exports
// to Excel and lets the accountant work it out.
//
// The output is a waterfall — each band is a reason, and each band names the
// employees behind it so the reader can click through.
// ============================================================================

import { round2, sum } from './money'

export type VarianceReason =
  | 'new_joiner' | 'exit' | 'increment' | 'structure_change' | 'lop_change'
  | 'arrears' | 'bonus' | 'statutory_change' | 'recovery_change' | 'adjustment' | 'other'

export const VARIANCE_LABEL: Record<VarianceReason, string> = {
  new_joiner: 'New joiners',
  exit: 'Exits',
  increment: 'Salary revisions',
  structure_change: 'Structure changes',
  lop_change: 'Loss of pay',
  arrears: 'Arrears',
  bonus: 'Bonus',
  statutory_change: 'Statutory deductions',
  recovery_change: 'Loan and advance recoveries',
  adjustment: 'One-off adjustments',
  other: 'Other movement',
}

export interface VarianceLineInput {
  employeeId: string
  employeeName: string
  netPay: number
  grossEarnings: number
  lopDays: number
  structureId: string | null
  componentTotals: Record<string, number>
}

export interface VarianceBand {
  reason: VarianceReason
  label: string
  amount: number
  employees: { employeeId: string; employeeName: string; amount: number; note: string }[]
}

export interface VarianceResult {
  previousTotal: number
  currentTotal: number
  delta: number
  deltaPercent: number
  bands: VarianceBand[]
  headcountPrevious: number
  headcountCurrent: number
  /** Individuals whose net moved more than the threshold, whatever the reason. */
  outliers: { employeeId: string; employeeName: string; previous: number; current: number; delta: number; deltaPercent: number }[]
}

const AUTO_CODES: Record<string, VarianceReason> = {
  ARREARS: 'arrears', STAT_BONUS: 'bonus', LOP: 'lop_change',
  PF: 'statutory_change', ESI: 'statutory_change', PT: 'statutory_change',
  LWF: 'statutory_change', TDS: 'statutory_change',
  LOAN_EMI: 'recovery_change', ADV_RECOVERY: 'recovery_change',
}

export function computeVariance(
  previous: VarianceLineInput[],
  current: VarianceLineInput[],
  outlierThresholdPercent = 15,
): VarianceResult {
  const prevById = new Map(previous.map(l => [l.employeeId, l]))
  const currById = new Map(current.map(l => [l.employeeId, l]))
  const bands = new Map<VarianceReason, VarianceBand>()

  const add = (reason: VarianceReason, employeeId: string, employeeName: string, amount: number, note: string) => {
    if (round2(amount) === 0) return
    const band = bands.get(reason) ?? { reason, label: VARIANCE_LABEL[reason], amount: 0, employees: [] }
    band.amount = round2(band.amount + amount)
    band.employees.push({ employeeId, employeeName, amount: round2(amount), note })
    bands.set(reason, band)
  }

  for (const c of current) {
    const p = prevById.get(c.employeeId)
    if (!p) {
      add('new_joiner', c.employeeId, c.employeeName, c.netPay, 'Not on the previous run.')
      continue
    }
    const delta = round2(c.netPay - p.netPay)
    if (delta === 0) continue

    // Attribute what the component totals can explain, then leave the remainder
    // to the structure/LOP tests and finally to "other". Never invent a reason.
    let explained = 0
    const codes = new Set([...Object.keys(p.componentTotals), ...Object.keys(c.componentTotals)])
    for (const code of codes) {
      const reason = AUTO_CODES[code]
      if (!reason) continue
      const was = p.componentTotals[code] ?? 0
      const now = c.componentTotals[code] ?? 0
      // Deductions moving up reduce net, so their sign is flipped for the waterfall.
      const isDeduction = ['PF', 'ESI', 'PT', 'LWF', 'TDS', 'LOAN_EMI', 'ADV_RECOVERY', 'LOP'].includes(code)
      const move = round2((now - was) * (isDeduction ? -1 : 1))
      if (move === 0) continue
      add(reason, c.employeeId, c.employeeName, move, `${code}: ₹${was} → ₹${now}.`)
      explained = round2(explained + move)
    }

    const remainder = round2(delta - explained)
    if (remainder !== 0) {
      if (p.structureId !== c.structureId) {
        add('increment', c.employeeId, c.employeeName, remainder, `Structure changed from ${p.structureId ?? 'none'} to ${c.structureId ?? 'none'}.`)
      } else if (p.lopDays !== c.lopDays) {
        add('lop_change', c.employeeId, c.employeeName, remainder, `LOP moved from ${p.lopDays} to ${c.lopDays} day(s).`)
      } else if (round2(c.grossEarnings - p.grossEarnings) !== 0) {
        add('increment', c.employeeId, c.employeeName, remainder, `Gross moved from ₹${p.grossEarnings} to ₹${c.grossEarnings}.`)
      } else {
        add('other', c.employeeId, c.employeeName, remainder, 'Movement not attributable to a single cause.')
      }
    }
  }

  for (const p of previous) {
    if (!currById.has(p.employeeId)) {
      add('exit', p.employeeId, p.employeeName, -p.netPay, 'Not on this run.')
    }
  }

  const previousTotal = sum(previous.map(l => l.netPay))
  const currentTotal = sum(current.map(l => l.netPay))
  const delta = round2(currentTotal - previousTotal)

  const outliers = current
    .map(c => {
      const p = prevById.get(c.employeeId)
      if (!p || p.netPay === 0) return null
      const d = round2(c.netPay - p.netPay)
      const pct = round2((d / p.netPay) * 100)
      return Math.abs(pct) >= outlierThresholdPercent
        ? { employeeId: c.employeeId, employeeName: c.employeeName, previous: p.netPay, current: c.netPay, delta: d, deltaPercent: pct }
        : null
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))

  return {
    previousTotal, currentTotal, delta,
    deltaPercent: previousTotal === 0 ? 0 : round2((delta / previousTotal) * 100),
    bands: [...bands.values()].sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount)),
    headcountPrevious: previous.length,
    headcountCurrent: current.length,
    outliers,
  }
}
