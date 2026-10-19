// ─────────────────────────────────────────────────────────────────────────────
// The Bills register, client side.
//
// Filtering happens in the database (fee_bill_register), not here: a school's
// session is thousands of bills, and every filter on the Bills tab — payment
// state, overdue or paid late, payment mode, fee head, term, month, a date
// range — needs a join the browser should not be doing. One call, one page of
// rows, the totals for everything that matched, amounts masked the usual way.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase, isMissingRelation } from '@/lib/supabase'
import {
  fetchAllocations, fetchInstruments, fetchInvoiceLines,
  type InstrumentRow, type InvoiceLineRow, type InvoiceRow, type PaymentRow,
} from './invoices'

export type PayState = 'unpaid' | 'partial' | 'paid' | 'carried' | 'cancelled'
export type Timing = 'on_time' | 'overdue' | 'late' | 'none'
export type Mode = 'cash' | 'cheque' | 'bank_transfer' | 'upi' | 'other'

export const PAY_STATES: { key: PayState; label: string; hint?: string }[] = [
  { key: 'unpaid',    label: 'Unpaid',          hint: 'Nothing received yet' },
  { key: 'partial',   label: 'Partly paid',     hint: 'Some received, some still owed' },
  { key: 'paid',      label: 'Fully paid' },
  { key: 'carried',   label: 'Carried forward', hint: 'Moved to the next session' },
  { key: 'cancelled', label: 'Cancelled' },
]

export const TIMINGS: { key: Exclude<Timing, 'none'>; label: string; hint: string }[] = [
  { key: 'overdue', label: 'Overdue',   hint: 'Past the due date with money still owed' },
  { key: 'late',    label: 'Paid late', hint: 'Fully paid, after the due date' },
  { key: 'on_time', label: 'On time',   hint: 'Not yet due, or paid by the due date' },
]

export const MODES: { key: Mode; label: string; hint?: string }[] = [
  { key: 'cash',          label: 'Cash' },
  { key: 'cheque',        label: 'Cheque',        hint: 'Cheques and demand drafts' },
  { key: 'bank_transfer', label: 'Bank transfer', hint: 'NEFT, RTGS, IMPS and net banking' },
  { key: 'upi',           label: 'UPI' },
  { key: 'other',         label: 'Other',         hint: 'Card, wallet, online gateway' },
]

/** The fee-head keys that are not a fee head. */
export const SPECIAL_HEADS: { key: string; label: string }[] = [
  { key: 'late_fee',      label: 'Late fee' },
  { key: 'fine',          label: 'Fines' },
  { key: 'carry_forward', label: 'Brought forward' },
  { key: 'other',         label: 'Other fees' },
]

export const PAY_STATE_LABEL: Record<PayState, string> =
  Object.fromEntries(PAY_STATES.map(s => [s.key, s.label])) as Record<PayState, string>

export const MODE_LABEL: Record<Mode, string> =
  Object.fromEntries(MODES.map(m => [m.key, m.label])) as Record<Mode, string>

/** A payment method, in the five buckets the Bills tab filters by. */
export function modeOf(method: string): Mode {
  if (method === 'cash') return 'cash'
  if (method === 'cheque' || method === 'dd') return 'cheque'
  if (method === 'bank_transfer' || method === 'netbanking') return 'bank_transfer'
  if (method === 'upi') return 'upi'
  return 'other'
}

export interface BillRow {
  id: string
  student_id: string
  full_name: string | null
  grade: number | null
  section: string | null
  admission_no: string | null
  number: string
  seq: number
  issue_date: string
  due_date: string
  status: InvoiceRow['status']
  pay_state: PayState
  timing: Timing
  last_paid_on: string | null
  activity_on: string | null
  modes: Mode[]
  heads: string[]
  term_name: string | null
  bill_month: string | null
  issue_title: string | null
  cancelled_reason: string | null
  carried_out: number | null
  net: number | null
  paid: number | null
  balance: number | null
}

export interface BillRegister {
  total: number
  net: number | null
  paid: number | null
  balance: number | null
  rows: BillRow[]
}

// ── Periods ─────────────────────────────────────────────────────────────

export type PeriodKey = 'today' | 'yesterday' | 'week' | 'month' | 'last_month' | 'session' | 'custom'

export const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: 'today',      label: 'Today' },
  { key: 'yesterday',  label: 'Yesterday' },
  { key: 'week',       label: 'This week' },
  { key: 'month',      label: 'This month' },
  { key: 'last_month', label: 'Last month' },
  { key: 'session',    label: 'Whole session' },
  { key: 'custom',     label: 'Pick dates' },
]

/** A local calendar date as 'YYYY-MM-DD'. The office's day, not UTC's. */
export function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** The dates a period covers, or null for the whole session. */
export function periodRange(
  key: PeriodKey, custom?: { from: string; to: string }, now = new Date(),
): { from: string; to: string } | null {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const day = (offset: number) => isoDay(new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset))
  switch (key) {
    case 'today':     return { from: day(0), to: day(0) }
    case 'yesterday': return { from: day(-1), to: day(-1) }
    case 'week': {
      // Weeks start on Monday, as a school's do.
      const back = (today.getDay() + 6) % 7
      return { from: day(-back), to: day(0) }
    }
    case 'month':
      return { from: isoDay(new Date(today.getFullYear(), today.getMonth(), 1)), to: day(0) }
    case 'last_month':
      return {
        from: isoDay(new Date(today.getFullYear(), today.getMonth() - 1, 1)),
        to: isoDay(new Date(today.getFullYear(), today.getMonth(), 0)),
      }
    case 'custom': {
      if (!custom?.from && !custom?.to) return null
      const from = custom.from || custom.to
      const to = custom.to || custom.from
      return from <= to ? { from, to } : { from: to, to: from }
    }
    default:          return null
  }
}

// ── Filters ─────────────────────────────────────────────────────────────

export interface BillFilters {
  period: PeriodKey
  custom: { from: string; to: string }
  pay: PayState[]
  timing: Exclude<Timing, 'none'>[]
  modes: Mode[]
  heads: string[]
  terms: string[]
  months: string[]
  search: string
}

/** What the Bills tab opens on: today's bills that have money against them. */
export const DEFAULT_BILL_FILTERS: BillFilters = {
  period: 'today',
  custom: { from: '', to: '' },
  pay: ['paid', 'partial'],
  timing: [],
  modes: [],
  heads: [],
  terms: [],
  months: [],
  search: '',
}

export function sameFilters(a: BillFilters, b: BillFilters): boolean {
  const eq = (x: string[], y: string[]) => x.length === y.length && x.every(v => y.includes(v))
  return a.period === b.period
    && (a.period !== 'custom' || (a.custom.from === b.custom.from && a.custom.to === b.custom.to))
    && eq(a.pay, b.pay) && eq(a.timing, b.timing) && eq(a.modes, b.modes)
    && eq(a.heads, b.heads) && eq(a.terms, b.terms) && eq(a.months, b.months)
    && a.search.trim() === b.search.trim()
}

export async function fetchBillRegister(
  yearId: string, f: BillFilters, offset = 0, limit = 200,
): Promise<BillRegister> {
  const range = periodRange(f.period, f.custom)
  const { data, error } = await supabase.rpc('fee_bill_register', {
    p_year: yearId,
    p_from: range?.from ?? null,
    p_to: range?.to ?? null,
    p_pay: f.pay.length ? f.pay : null,
    p_timing: f.timing.length ? f.timing : null,
    p_modes: f.modes.length ? f.modes : null,
    p_heads: f.heads.length ? f.heads : null,
    p_terms: f.terms.length ? f.terms : null,
    p_months: f.months.length ? f.months : null,
    p_search: f.search.trim() || null,
    p_limit: limit,
    p_offset: offset,
  })
  if (error) {
    if (isMissingRelation(error)) return { total: 0, net: null, paid: null, balance: null, rows: [] }
    throw error
  }
  const r = (data ?? {}) as Partial<BillRegister>
  return {
    total: Number(r.total ?? 0),
    net: r.net ?? null,
    paid: r.paid ?? null,
    balance: r.balance ?? null,
    rows: (r.rows ?? []) as BillRow[],
  }
}

/** Terms and fee heads for the filter menus. */
export async function fetchBillFacets(yearId: string): Promise<{
  terms: { id: string; name: string }[]
  heads: { id: string; name: string }[]
}> {
  const [{ data: t }, { data: h }] = await Promise.all([
    supabase.from('fee_terms').select('id, name, seq').eq('academic_year_id', yearId).order('seq'),
    supabase.from('fee_heads').select('id, name, sort, active').eq('academic_year_id', yearId).order('sort'),
  ])
  return {
    terms: (t ?? []).map(r => ({ id: r.id as string, name: r.name as string })),
    heads: (h ?? []).map(r => ({ id: r.id as string, name: r.name as string })),
  }
}

// ── One bill ────────────────────────────────────────────────────────────

export interface BillPayment extends PaymentRow {
  /** What this payment put against this bill. */
  allocated: number
  /** Every bill the payment was split across, for the printed receipt. */
  against: { number: string; amount: number }[]
  instrument: InstrumentRow | null
}

export interface BillDetail {
  invoice: InvoiceRow
  lines: InvoiceLineRow[]
  payments: BillPayment[]
  student: {
    id: string; full_name: string; grade: number | null; section: string | null
    admission_no: string | null
  }
}

const INVOICE_COLS =
  'id, profile_id, student_id, academic_year_id, installment_id, number, seq, issue_date, ' +
  'due_date, status, autogen, verify_token, cancelled_reason, cancelled_at, gross, ' +
  'discount_total, tax_total, late_fee_total, fine_total, net, paid, balance'

const PAYMENT_COLS =
  'id, student_id, academic_year_id, receipt_no, seq, paid_on, method, reference, notes, ' +
  'instrument_id, status, collected_by, reversed_at, reversal_reason, receipt_hash, amount'

/** Everything the bill popup shows, in three round trips. */
export async function fetchBillDetail(invoiceId: string): Promise<BillDetail | null> {
  const [{ data: inv, error }, lines, { data: allocs }] = await Promise.all([
    supabase.from('fee_invoices_v').select(INVOICE_COLS).eq('id', invoiceId).maybeSingle(),
    fetchInvoiceLines([invoiceId]),
    supabase.from('fee_payment_allocations').select('payment_id, amount').eq('invoice_id', invoiceId),
  ])
  if (error) throw error
  if (!inv) return null
  const invoice = inv as unknown as InvoiceRow

  const paymentIds = [...new Set((allocs ?? []).map(a => a.payment_id as string))]
  const [{ data: pays }, allAllocs, { data: who }, { data: det }, instruments] = await Promise.all([
    paymentIds.length
      ? supabase.from('fee_payments_v').select(PAYMENT_COLS).in('id', paymentIds)
      : Promise.resolve({ data: [] as unknown[] }),
    fetchAllocations(paymentIds),
    supabase.from('profiles').select('id, full_name, grade, section').eq('id', invoice.student_id).maybeSingle(),
    supabase.from('student_details').select('admission_no').eq('student_id', invoice.student_id).maybeSingle(),
    paymentIds.length ? fetchInstruments({ studentId: invoice.student_id }) : Promise.resolve([] as InstrumentRow[]),
  ])

  // The other bills a payment was split across, by number, for the receipt.
  const otherIds = [...new Set(allAllocs.map(a => a.invoice_id).filter(id => id !== invoiceId))]
  const numbers = new Map<string, string>([[invoiceId, invoice.number]])
  if (otherIds.length) {
    const { data: others } = await supabase.from('fee_invoices_v').select('id, number').in('id', otherIds)
    for (const o of others ?? []) numbers.set(o.id as string, o.number as string)
  }

  const mine = new Map<string, number>()
  for (const a of allocs ?? []) {
    mine.set(a.payment_id as string, (mine.get(a.payment_id as string) ?? 0) + Number(a.amount))
  }

  const payments = ((pays ?? []) as unknown as PaymentRow[])
    .map(p => ({
      ...p,
      allocated: mine.get(p.id) ?? 0,
      against: allAllocs.filter(a => a.payment_id === p.id)
        .map(a => ({ number: numbers.get(a.invoice_id) ?? '—', amount: Number(a.amount) })),
      instrument: instruments.find(i => i.id === p.instrument_id) ?? null,
    }))
    .sort((a, b) => b.paid_on.localeCompare(a.paid_on) || (b.seq ?? 0) - (a.seq ?? 0))

  return {
    invoice,
    lines,
    payments,
    student: {
      id: invoice.student_id,
      full_name: (who?.full_name as string) ?? 'Student',
      grade: (who?.grade as number | null) ?? null,
      section: (who?.section as string | null) ?? null,
      admission_no: (det?.admission_no as string | null) ?? null,
    },
  }
}

/** A bill's state, worked out on the client the same way the register does. */
export function billState(inv: Pick<InvoiceRow, 'status' | 'balance' | 'paid' | 'due_date'>,
                          lines: Pick<InvoiceLineRow, 'kind' | 'amount'>[],
                          lastPaidOn: string | null, today: string): { pay: PayState; timing: Timing } {
  const carried = lines.some(l => l.kind === 'carry_forward' && l.amount < 0)
  const balance = inv.balance ?? (inv.status === 'paid' ? 0 : 1)
  const paid = inv.paid ?? (inv.status === 'partly_paid' ? 1 : 0)
  const pay: PayState = inv.status === 'cancelled' ? 'cancelled'
    : carried && balance <= 0 ? 'carried'
    : balance <= 0 ? 'paid'
    : paid > 0 ? 'partial' : 'unpaid'
  const timing: Timing = pay === 'cancelled' || pay === 'carried' ? 'none'
    : balance > 0 && inv.due_date < today ? 'overdue'
    : balance <= 0 && lastPaidOn && lastPaidOn > inv.due_date ? 'late'
    : 'on_time'
  return { pay, timing }
}

/** How many students have a bill past its due date with money still owed. */
export async function countOverdueStudents(yearId: string, today: string): Promise<number> {
  const { data, error } = await supabase.from('fee_invoices_v')
    .select('student_id')
    .eq('academic_year_id', yearId)
    .in('status', ['pending', 'partly_paid', 'overdue'])
    .lt('due_date', today)
    .limit(20000)
  if (error) {
    if (isMissingRelation(error)) return 0
    throw error
  }
  return new Set((data ?? []).map(r => r.student_id as string)).size
}
