// ============================================================================
// Concessions.
// ----------------------------------------------------------------------------
// Ordering is the whole problem. A 25% sibling discount and a flat ₹2,000 staff
// remission produce different numbers depending on which goes first, and a
// school that cannot say which order it uses will eventually bill two families
// differently for the same entitlements.
//
// The rule here: percentages first, on the gross; then flat amounts, on what is
// left; then 'full', which clears the remainder. Percentages first is the
// convention Indian schools already use on paper — a "50% concession" means half
// the fee, not half of the fee minus something else — and doing flat amounts
// after means the parent never sees a discount silently shrunk by one applied
// before it.
//
// Nothing may drive a head below zero, and nothing may touch a head whose
// catalogue entry says it is not concession-eligible (fines, typically).
// ============================================================================

import { round2 } from '@/lib/payroll/engine/money'
import type { AppliedConcession, Concession, FeeStructureItem } from './types'

/** Concessions live on `onDate`, ordered so the arithmetic is deterministic. */
export function activeConcessions(concessions: Concession[], onDate: string): Concession[] {
  const live = concessions.filter(
    c => c.effectiveFrom <= onDate && (c.effectiveTo === null || c.effectiveTo >= onDate),
  )
  const rank: Record<Concession['kind'], number> = { percent: 0, amount: 1, full: 2 }
  return live.sort((a, b) => {
    if (rank[a.kind] !== rank[b.kind]) return rank[a.kind] - rank[b.kind]
    // Within a kind, the larger relief first, then id — so two equal
    // concessions always apply in the same order on every run.
    if (b.value !== a.value) return b.value - a.value
    return a.id.localeCompare(b.id)
  })
}

export interface ConcessionResult {
  /** Total taken off this head. Never more than the gross. */
  amount: number
  applied: AppliedConcession[]
}

/**
 * Apply every concession that reaches `item` to a gross of `gross`.
 * A concession with a null feeHeadId applies to every eligible head; one with a
 * head id applies only to that head.
 */
export function applyConcessions(
  item: Pick<FeeStructureItem, 'feeHeadId' | 'concessionEligible'>,
  gross: number,
  concessions: Concession[],
  onDate: string,
): ConcessionResult {
  if (!item.concessionEligible || gross <= 0) return { amount: 0, applied: [] }

  const relevant = activeConcessions(concessions, onDate)
    .filter(c => c.feeHeadId === null || c.feeHeadId === item.feeHeadId)

  let remaining = gross
  const applied: AppliedConcession[] = []

  for (const c of relevant) {
    if (remaining <= 0) break

    let relief: number
    if (c.kind === 'percent') relief = round2((gross * c.value) / 100)
    else if (c.kind === 'amount') relief = round2(c.value)
    else relief = remaining // 'full'

    // Never below zero, and never more than is left after earlier concessions.
    relief = Math.min(relief, remaining)
    if (relief <= 0) continue

    remaining = round2(remaining - relief)
    applied.push({
      concessionId: c.id,
      category: c.category,
      kind: c.kind,
      value: c.value,
      amount: relief,
      reason: c.reason,
    })
  }

  return { amount: round2(gross - remaining), applied }
}

/** One line of plain English per concession, for the trace and the receipt. */
export function describeConcession(c: AppliedConcession): string {
  const label = CATEGORY_LABELS[c.category] ?? 'Concession'
  if (c.kind === 'percent') return `${label} — ${c.value}% off`
  if (c.kind === 'full') return `${label} — head waived in full`
  return `${label} — flat ₹${c.value.toLocaleString('en-IN')} off`
}

export const CATEGORY_LABELS: Record<AppliedConcession['category'], string> = {
  sibling: 'Sibling concession',
  staff_ward: 'Staff ward concession',
  rte: 'RTE',
  ews: 'EWS',
  merit: 'Merit scholarship',
  sports: 'Sports scholarship',
  single_girl_child: 'Single girl child',
  financial_aid: 'Financial aid',
  other: 'Concession',
}
