// ============================================================================
// Arrears — what a backdated revision owes for months that are already locked.
// ----------------------------------------------------------------------------
// This is the mechanism that lets invariant 4 hold. A revision effective before
// the last locked run does *not* reach back and rewrite that run; it replays the
// affected periods against the old structure and the new one, diffs them head by
// head, and carries the difference forward as an arrear on the next open run.
//
// The locked payslip a teacher already downloaded therefore stays true, and the
// money still reaches them — with a breakdown showing exactly which month and
// which head each rupee came from.
// ============================================================================

import type { EngineArrear, ExplainNode } from './types'
import { round2, sum } from './money'

export interface PeriodComparison {
  period: string
  /** Head code → amount under the structure that was actually paid. */
  paid: Record<string, number>
  /** Head code → amount the revised structure would have produced. */
  revised: Record<string, number>
}

export interface ArrearComputation {
  amount: number
  breakdown: { period: string; componentCode: string; was: number; now: number; delta: number }[]
}

/**
 * Diff what was paid against what the revision says should have been paid.
 * Only positive deltas become arrears — a revision that reduces pay is not
 * clawed back out of a locked month, which would be both unlawful in most cases
 * and indefensible in all of them.
 */
export function computeArrears(periods: PeriodComparison[], allowNegative = false): ArrearComputation {
  const breakdown: ArrearComputation['breakdown'] = []
  for (const p of periods) {
    const codes = new Set([...Object.keys(p.paid), ...Object.keys(p.revised)])
    for (const code of codes) {
      const was = round2(p.paid[code] ?? 0)
      const now = round2(p.revised[code] ?? 0)
      const delta = round2(now - was)
      if (delta === 0) continue
      if (delta < 0 && !allowNegative) continue
      breakdown.push({ period: p.period, componentCode: code, was, now, delta })
    }
  }
  return { amount: sum(breakdown.map(b => b.delta)), breakdown }
}

/** Fold every pending arrear into one payable line with a per-month explanation. */
export function arrearsTrace(arrears: EngineArrear[]): { total: number; trace: ExplainNode } {
  const total = sum(arrears.map(a => a.amount))
  const byPeriod = new Map<string, { period: string; delta: number; heads: string[] }>()
  for (const a of arrears) {
    for (const b of a.breakdown) {
      const cur = byPeriod.get(b.period) ?? { period: b.period, delta: 0, heads: [] }
      cur.delta = round2(cur.delta + b.delta)
      if (!cur.heads.includes(b.componentCode)) cur.heads.push(b.componentCode)
      byPeriod.set(b.period, cur)
    }
  }
  return {
    total,
    trace: {
      label: 'Arrears', value: total, unit: 'INR',
      formula: 'the difference between what was paid and what the revision says was owed',
      note: arrears.length === 0
        ? undefined
        : `Covers ${arrears.map(a => a.label).join(', ')}. The original payslips for these months are unchanged — this pays the difference.`,
      children: [...byPeriod.values()]
        .sort((a, b) => a.period.localeCompare(b.period))
        .map(p => ({
          label: p.period, value: p.delta, unit: 'INR' as const,
          note: `Difference on ${p.heads.join(', ')}.`,
        })),
    },
  }
}
