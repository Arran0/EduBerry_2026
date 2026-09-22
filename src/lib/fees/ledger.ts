// ─────────────────────────────────────────────────────────────────────────────
// What the bill ledger is filtered by.
//
// Pure functions and plain types — no Supabase import — so the facet rules can
// be reasoned about (and tested) without a database.
//
// The one idea worth stating: a bill's status is not one word. The `status`
// column holds a single value, but a family looking at the same bill would say
// it is *both* partly paid *and* overdue, and a clerk filtering for overdue
// bills means to find that one. So a bill is described by a set of facets
// derived from what is actually true of it — what has been paid, and whether
// the due date has passed — and it matches a filter when any of its facets is
// wanted. Selecting "Partly paid" and "Overdue" therefore widens the list
// rather than narrowing it to bills that are somehow only both.
// ─────────────────────────────────────────────────────────────────────────────

import type { InvoiceRow, PaymentMethod } from './invoices'

export type StatusFacet = 'pending' | 'overdue' | 'partly_paid' | 'paid' | 'cancelled'

export const STATUS_FACETS: { key: StatusFacet; label: string }[] = [
  { key: 'pending',     label: 'Pending' },
  { key: 'overdue',     label: 'Overdue' },
  { key: 'partly_paid', label: 'Partly paid' },
  { key: 'paid',        label: 'Paid' },
  { key: 'cancelled',   label: 'Cancelled' },
]

/**
 * Everything true of one bill right now.
 *
 * When the caller may not see amounts, `paid` and `balance` arrive as NULL
 * from the view. Summing or comparing those would invent a settled bill out of
 * a hidden one, so the stored status is used on its own instead, and only the
 * due date — which is never masked — still adds `overdue`.
 */
export function statusFacets(
  invoice: Pick<InvoiceRow, 'status' | 'due_date' | 'paid' | 'balance'>,
  today: string,
): Set<StatusFacet> {
  if (invoice.status === 'cancelled') return new Set<StatusFacet>(['cancelled'])

  const out = new Set<StatusFacet>()
  const paid = invoice.paid
  const balance = invoice.balance
  const masked = paid === null || balance === null

  if (masked) {
    out.add(invoice.status === 'draft' ? 'pending' : invoice.status as StatusFacet)
  } else if (balance <= 0) {
    out.add('paid')
  } else if (paid > 0) {
    out.add('partly_paid')
  } else {
    out.add('pending')
  }

  if (!out.has('paid') && invoice.due_date.slice(0, 10) < today) out.add('overdue')
  return out
}

export function matchesStatus(
  invoice: Pick<InvoiceRow, 'status' | 'due_date' | 'paid' | 'balance'>,
  wanted: Set<StatusFacet>,
  today: string,
): boolean {
  if (wanted.size === 0) return true
  for (const facet of statusFacets(invoice, today)) if (wanted.has(facet)) return true
  return false
}

// ── How it was paid ──────────────────────────────────────────────────────
//
// Five words the office uses, over the nine methods the database stores. Net
// banking and a transfer are both "Bank" to the person asking which bills came
// in by bank; a demand draft is a cheque with a different name on it.

export type PayMode = 'cash' | 'upi' | 'card' | 'bank' | 'cheque'

export const PAY_MODES: { key: PayMode; label: string; methods: PaymentMethod[] }[] = [
  { key: 'cash',   label: 'Cash',   methods: ['cash'] },
  { key: 'upi',    label: 'UPI QR', methods: ['upi', 'wallet', 'razorpay'] },
  { key: 'card',   label: 'Card',   methods: ['card'] },
  { key: 'bank',   label: 'Bank',   methods: ['netbanking', 'bank_transfer'] },
  { key: 'cheque', label: 'Cheque', methods: ['cheque', 'dd'] },
]

const MODE_OF_METHOD = new Map<PaymentMethod, PayMode>(
  PAY_MODES.flatMap(m => m.methods.map(method => [method, m.key] as const)))

export function payModeOf(method: PaymentMethod): PayMode | null {
  return MODE_OF_METHOD.get(method) ?? null
}

// ── When ─────────────────────────────────────────────────────────────────

export type RangeKey = 'today' | 'yesterday' | 'all' | 'custom'

export interface DateRange {
  key: RangeKey
  /** Inclusive, 'YYYY-MM-DD'. Null on either side means unbounded. */
  from: string | null
  to: string | null
}

export const ALL_DATES: DateRange = { key: 'all', from: null, to: null }

/**
 * Today as 'YYYY-MM-DD' in the reader's own zone.
 *
 * Deliberately not `toISOString()`, which is UTC: for most of the evening in
 * India that returns yesterday, so "Today" would show an empty list from
 * half past five onwards.
 */
export function todayISO(offsetDays = 0): string {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  const m = `${d.getMonth() + 1}`.padStart(2, '0')
  const day = `${d.getDate()}`.padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

export function rangeFor(key: Exclude<RangeKey, 'custom'>): DateRange {
  if (key === 'today') return { key, from: todayISO(), to: todayISO() }
  if (key === 'yesterday') return { key, from: todayISO(-1), to: todayISO(-1) }
  return ALL_DATES
}

/** Is a 'YYYY-MM-DD' date inside the range? ISO strings compare in date order. */
export function inRange(iso: string | null | undefined, range: DateRange): boolean {
  if (range.key === 'all') return true
  if (!iso) return false
  const d = iso.slice(0, 10)
  if (range.from && d < range.from) return false
  if (range.to && d > range.to) return false
  return true
}

// ── The whole filter ─────────────────────────────────────────────────────

export interface LedgerFilters {
  /** Empty means every status — see the note at the top of this file. */
  statuses: Set<StatusFacet>
  /** Empty means every method. A bill matches if any payment against it does. */
  modes: Set<PayMode>
  /** Over the bill's issue date. */
  range: DateRange
}

/** A fresh, unfiltered set. A factory, because the Sets are per-caller state. */
export function noFilters(): LedgerFilters {
  return { statuses: new Set(), modes: new Set(), range: ALL_DATES }
}

export function isFiltered(f: LedgerFilters): boolean {
  return f.statuses.size > 0 || f.modes.size > 0 || f.range.key !== 'all'
}
