// What the student screens compute from the same rows — one place, so the
// hero, the lists and the pay sheet cannot disagree about what is owed.

import type { InvoiceLineRow, InvoiceRow, PaymentRow } from '@/lib/fees/invoices'

export type Allocation = { payment_id: string; invoice_id: string; amount: number }

export const PAYABLE = new Set(['pending', 'partly_paid', 'overdue'])

export function isOpen(inv: InvoiceRow): boolean {
  return PAYABLE.has(inv.status) && (inv.balance ?? 0) > 0
}

/** Whole days from `a` to `b`, both 'YYYY-MM-DD'. */
export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number)
  const [by, bm, bd] = b.split('-').map(Number)
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000)
}

/** Where a bill stands, as a student would put it. */
export function dueWords(inv: InvoiceRow, today: string): { text: string; tone: 'late' | 'soon' | 'later' | 'done' } {
  if (!isOpen(inv)) return { text: inv.status === 'cancelled' ? 'Cancelled' : 'Paid', tone: 'done' }
  const d = daysBetween(today, inv.due_date)
  if (d < 0) return { text: d === -1 ? 'Overdue by 1 day' : `Overdue by ${-d} days`, tone: 'late' }
  if (d === 0) return { text: 'Due today', tone: 'soon' }
  if (d === 1) return { text: 'Due tomorrow', tone: 'soon' }
  if (d <= 14) return { text: `Due in ${d} days`, tone: 'soon' }
  return { text: 'Upcoming', tone: 'later' }
}

/** "Tuition fee, Bus fee + 2 more" — what a bill is for, in one line. */
export function billFor(lines: InvoiceLineRow[]): string {
  const fees = lines.filter(l => l.kind === 'fee' || l.kind === 'carry_forward')
  const names = [...new Set(fees.map(l => l.label))]
  if (!names.length) return 'School fees'
  return names.length <= 2 ? names.join(', ') : `${names.slice(0, 2).join(', ')} + ${names.length - 2} more`
}

export function sessionTotals(invoices: InvoiceRow[]) {
  const live = invoices.filter(i => i.status !== 'cancelled' && i.status !== 'draft')
  const sum = (f: (i: InvoiceRow) => number | null) => live.reduce((a, i) => a + (f(i) ?? 0), 0)
  const net = sum(i => i.net)
  const paid = sum(i => i.paid)
  return {
    gross: sum(i => i.gross),
    savings: sum(i => i.discount_total),
    extras: sum(i => (i.late_fee_total ?? 0) + (i.fine_total ?? 0)),
    net,
    paid,
    due: sum(i => (isOpen(i) ? i.balance : 0)),
    share: net > 0 ? Math.min(1, paid / net) : 0,
  }
}

/** The bills a payment was put against, as a receipt prints them. */
export function receiptAgainst(payment: PaymentRow, allocations: Allocation[], invoices: InvoiceRow[]) {
  return allocations.filter(a => a.payment_id === payment.id).map(a => ({
    number: invoices.find(i => i.id === a.invoice_id)?.number ?? '—',
    amount: a.amount,
  }))
}

export const METHOD_WORD: Record<string, string> = {
  cash: 'Cash', upi: 'UPI', card: 'Card', netbanking: 'Net banking', bank_transfer: 'Bank transfer',
  cheque: 'Cheque', dd: 'Demand draft', wallet: 'Wallet', razorpay: 'Paid online', adjustment: 'Adjustment',
}
