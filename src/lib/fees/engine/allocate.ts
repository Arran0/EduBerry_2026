// ─────────────────────────────────────────────────────────────────────────────
// Spreading a payment across bills.
//
// A parent hands over ₹15,000 against three outstanding bills. Which one does
// it clear? The answer is a school policy, not a technical detail, and getting
// it wrong means a family who paid in good faith still shows as overdue on the
// oldest bill and gets a reminder for it.
//
// The database does the same thing inside fee_collect(). This module exists so
// the counter can *show* the clerk the split before they press Collect, and so
// the rule is testable without a database. The two implementations are
// deliberately the same three lines of logic; the test below pins the shape.
// ─────────────────────────────────────────────────────────────────────────────

import { waterfall, type Paise } from './money'
import { toEpochDay } from './dates'
import type { IsoDate } from './types'

export type AllocationOrder = 'oldest_due_first' | 'newest_due_first' | 'manual'

export interface PayableInvoice {
  id: string
  number: string
  dueDate: IsoDate
  seq: number
  balance: Paise
}

export interface Allocation {
  invoiceId: string
  number: string
  amount: Paise
  /** What the bill will still owe after this. */
  remaining: Paise
}

export interface AllocationResult {
  allocations: Allocation[]
  /** Applied to bills. */
  allocated: Paise
  /** Left over — becomes a credit against the next bill. */
  credited: Paise
  /** Bills fully cleared by this payment. */
  cleared: number
}

/**
 * Order the bills a payment should be applied to.
 *
 * `manual` means the clerk chose, so the caller's order is kept as given.
 * Otherwise the sort is by due date, with `seq` breaking ties so two bills due
 * the same day are always taken in the order they were issued rather than in
 * whatever order the database returned them.
 */
export function orderInvoices(
  invoices: PayableInvoice[],
  order: AllocationOrder,
): PayableInvoice[] {
  if (order === 'manual') return [...invoices]
  const dir = order === 'newest_due_first' ? -1 : 1
  return [...invoices].sort((a, b) =>
    dir * (toEpochDay(a.dueDate) - toEpochDay(b.dueDate)) || a.seq - b.seq)
}

/**
 * Apply an amount to bills in order, filling each before moving on.
 *
 * Only positive balances are payable; a bill already settled takes nothing, so
 * a stale list cannot cause a double allocation.
 */
export function allocate(
  amount: Paise,
  invoices: PayableInvoice[],
  order: AllocationOrder = 'oldest_due_first',
): AllocationResult {
  const ordered = orderInvoices(invoices, order).filter(i => i.balance > 0)
  const { taken, remainder } = waterfall(amount, ordered.map(i => i.balance))

  const allocations: Allocation[] = []
  ordered.forEach((inv, i) => {
    if (taken[i] <= 0) return
    allocations.push({
      invoiceId: inv.id,
      number: inv.number,
      amount: taken[i],
      remaining: inv.balance - taken[i],
    })
  })

  return {
    allocations,
    allocated: amount - remainder,
    credited: remainder,
    cleared: allocations.filter(a => a.remaining === 0).length,
  }
}

/**
 * A sentence the clerk can read back to the person at the counter before
 * taking their money.
 *
 * Written out rather than left to the screen because "₹15,000 → 3 invoices" is
 * not something a parent can check, and the counter is exactly where a
 * misunderstanding turns into a dispute.
 */
export function describeAllocation(result: AllocationResult, formatter: (p: Paise) => string): string {
  if (result.allocations.length === 0) {
    return result.credited > 0
      ? `Nothing is outstanding, so all ${formatter(result.credited)} will be held as a credit against the next bill.`
      : 'There is nothing outstanding to put this against.'
  }

  const parts = result.allocations.map(a =>
    `${formatter(a.amount)} to ${a.number}${a.remaining > 0 ? ` (${formatter(a.remaining)} still due)` : ' — cleared'}`)

  const head = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
  return result.credited > 0
    ? `${head}. The remaining ${formatter(result.credited)} will be held as a credit.`
    : `${head}.`
}

/**
 * Whether a proposed payment is allowed, given the school's rules.
 *
 * The database re-checks all of this; doing it here too is what lets the Collect
 * button be disabled with a reason rather than the clerk pressing it and being
 * refused by an error they cannot act on.
 */
export interface PaymentRules {
  partialAllowed: boolean
  minPartialAmount: Paise
  allowOverpayment: boolean
  allowBackdatedDays: number
}

export function validatePayment(
  amount: Paise,
  outstanding: Paise,
  rules: PaymentRules,
  opts: { paidOn?: IsoDate; today?: IsoDate; canBackdate?: boolean } = {},
): { ok: true } | { ok: false; reason: string } {
  if (amount <= 0) return { ok: false, reason: 'Enter an amount greater than zero.' }

  if (amount < outstanding) {
    if (!rules.partialAllowed) {
      return { ok: false, reason: 'Part payment is switched off, so this has to be the full outstanding amount.' }
    }
    if (rules.minPartialAmount > 0 && amount < rules.minPartialAmount) {
      return { ok: false, reason: `The smallest part payment the school accepts is ${rules.minPartialAmount / 100}.` }
    }
  }

  if (amount > outstanding && !rules.allowOverpayment) {
    return { ok: false, reason: 'This is more than is outstanding, and overpayment is switched off.' }
  }

  if (opts.paidOn && opts.today) {
    const days = toEpochDay(opts.today) - toEpochDay(opts.paidOn)
    if (days < 0) return { ok: false, reason: 'A payment cannot be dated in the future.' }
    if (days > 0) {
      if (!opts.canBackdate) {
        return { ok: false, reason: 'You do not have permission to backdate a payment.' }
      }
      if (days > rules.allowBackdatedDays) {
        return { ok: false, reason: `A payment cannot be dated more than ${rules.allowBackdatedDays} days back.` }
      }
    }
  }

  return { ok: true }
}
