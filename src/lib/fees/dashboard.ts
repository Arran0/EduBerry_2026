'use client'

import { supabase } from '@/lib/supabase'
import { fetchAgeingTotals, fetchOutstandingByClass, fetchOutstandingByHead } from './collections'

// ============================================================================
// The leadership dashboard's numbers.
// ----------------------------------------------------------------------------
// Everything here reads the LEDGER for money and the demand views for what was
// billed. Not school_fees.status — a status is a derived summary and summing
// summaries is how two screens in the same product end up disagreeing about
// today's collection.
//
// Every figure is drillable down to a ledger row, which is the whole reason the
// ledger was built first: a principal who asks "where did that ₹4.2 lakh come
// from" gets a list of individual payments with references, not a number.
// ============================================================================

export interface DashboardTotals {
  /** What has been billed this year, net of concessions and cancellations. */
  demand: number
  collected: number
  outstanding: number
  overdue: number
  todayCollection: number
  monthCollection: number
  /** collected / demand, as a percentage. The number a board asks for. */
  collectionRate: number
  studentsWithDues: number
  studentsBilled: number
  refundsThisMonth: number
  failedThisMonth: number
}

export interface MethodSplit {
  method: string
  label: string
  amount: number
  count: number
}

export interface DailyPoint {
  date: string
  amount: number
}

const METHOD_LABELS: Record<string, string> = {
  razorpay: 'Online', upi: 'UPI', upi_qr: 'UPI', cash: 'Cash', cheque: 'Cheque',
  card: 'Card', bank: 'Bank transfer', bank_transfer: 'Bank transfer',
  credit_note: 'Credit applied', netbanking: 'Netbanking', wallet: 'Wallet',
}

function startOfToday(): string {
  const d = new Date(); d.setHours(0, 0, 0, 0)
  return d.toISOString()
}

function startOfMonth(): string {
  const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0)
  return d.toISOString()
}

interface TxnRow {
  amount: number
  direction: string
  kind: string
  method: string | null
  occurred_at: string
}

/** Ledger rows for a window. One query, reused by several of the panels below. */
async function fetchLedgerSince(since: string): Promise<TxnRow[]> {
  const { data, error } = await supabase
    .from('fee_transactions')
    .select('amount, direction, kind, method, occurred_at')
    .gte('occurred_at', since)
    .order('occurred_at', { ascending: true })
    .limit(50000)
  if (error) { console.error('fetchLedgerSince failed:', error); return [] }
  return (data ?? []) as unknown as TxnRow[]
}

export async function fetchDashboardTotals(year?: string): Promise<DashboardTotals> {
  const monthStart = startOfMonth()
  const todayStart = startOfToday()

  const [studentRows, ageing, monthLedger, failed] = await Promise.all([
    fetchStudentTotals(year),
    fetchAgeingTotals(year),
    fetchLedgerSince(monthStart),
    countFailedAttempts(monthStart),
  ])

  const demand = round2(studentRows.reduce((s, r) => s + (Number(r.billed) || 0), 0))
  const collected = round2(studentRows.reduce((s, r) => s + (Number(r.paid) || 0), 0))
  const outstanding = round2(studentRows.reduce((s, r) => s + (Number(r.outstanding) || 0), 0))

  let todayCollection = 0, monthCollection = 0, refundsThisMonth = 0
  for (const t of monthLedger) {
    const amount = Number(t.amount) || 0
    if (t.direction === 'credit' && t.kind === 'payment') {
      monthCollection += amount
      if (t.occurred_at >= todayStart) todayCollection += amount
    } else if (t.direction === 'debit' && (t.kind === 'refund' || t.kind === 'reversal')) {
      refundsThisMonth += amount
    }
  }

  // Overdue is everything past its grace period — the three ageing buckets
  // beyond "not yet due", which is exactly what the office chases.
  const overdue = round2(ageing['1-30'] + ageing['31-60'] + ageing['61-90'] + ageing['90+'])

  return {
    demand,
    collected,
    outstanding,
    overdue,
    todayCollection: round2(todayCollection),
    monthCollection: round2(monthCollection),
    collectionRate: demand > 0 ? Math.round((collected / demand) * 1000) / 10 : 0,
    studentsWithDues: studentRows.filter(r => (Number(r.outstanding) || 0) > 0).length,
    studentsBilled: studentRows.length,
    refundsThisMonth: round2(refundsThisMonth),
    failedThisMonth: failed,
  }
}

async function fetchStudentTotals(year?: string): Promise<{ billed: number; paid: number; outstanding: number }[]> {
  let q = supabase.from('fee_outstanding_by_student').select('billed, paid, outstanding').limit(20000)
  if (year) q = q.eq('academic_year', year)
  const { data, error } = await q
  if (error) { console.error('fetchStudentTotals failed:', error); return [] }
  return (data ?? []) as unknown as { billed: number; paid: number; outstanding: number }[]
}

/**
 * Attempts that never became money. Counted from the attempt table rather than
 * the ledger — a failed payment deliberately writes no ledger row, so the
 * ledger cannot answer this and should not be asked to.
 */
async function countFailedAttempts(since: string): Promise<number> {
  const { count, error } = await supabase
    .from('school_fee_payments')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'failed')
    .gte('created_at', since)
  if (error) { console.error('countFailedAttempts failed:', error); return 0 }
  return count ?? 0
}

/** How parents actually paid, this month. */
export async function fetchMethodSplit(sinceIso?: string): Promise<MethodSplit[]> {
  const rows = await fetchLedgerSince(sinceIso ?? startOfMonth())
  const acc = new Map<string, { amount: number; count: number }>()
  for (const t of rows) {
    if (t.direction !== 'credit' || t.kind !== 'payment') continue
    const key = t.method ?? 'other'
    const entry = acc.get(key) ?? { amount: 0, count: 0 }
    entry.amount += Number(t.amount) || 0
    entry.count++
    acc.set(key, entry)
  }
  return [...acc.entries()]
    .map(([method, v]) => ({
      method,
      label: METHOD_LABELS[method] ?? method.replace(/_/g, ' '),
      amount: round2(v.amount),
      count: v.count,
    }))
    .sort((a, b) => b.amount - a.amount)
}

/** Daily collection for a trend line. */
export async function fetchDailyCollection(days = 30): Promise<DailyPoint[]> {
  const since = new Date()
  since.setDate(since.getDate() - days)
  since.setHours(0, 0, 0, 0)

  const rows = await fetchLedgerSince(since.toISOString())
  const byDay = new Map<string, number>()

  // Seed every day so a zero-collection day is a gap in the line rather than
  // being skipped, which would compress the axis and flatter the trend.
  for (let i = 0; i <= days; i++) {
    const d = new Date(since)
    d.setDate(d.getDate() + i)
    byDay.set(d.toISOString().slice(0, 10), 0)
  }

  for (const t of rows) {
    if (t.direction !== 'credit' || t.kind !== 'payment') continue
    const day = t.occurred_at.slice(0, 10)
    if (byDay.has(day)) byDay.set(day, round2((byDay.get(day) ?? 0) + Number(t.amount)))
  }

  return [...byDay.entries()].map(([date, amount]) => ({ date, amount }))
}

/** Individual ledger rows behind a figure — the bottom of every drilldown. */
export interface LedgerDetail {
  id: string
  amount: number
  direction: string
  kind: string
  method: string | null
  gateway_payment_id: string | null
  utr: string | null
  occurred_at: string
  student_id: string | null
  student_name?: string
  note: string | null
}

export async function fetchLedgerDetail(filter: {
  studentId?: string
  from?: string
  to?: string
  kind?: string
  method?: string
  limit?: number
}): Promise<LedgerDetail[]> {
  let q = supabase
    .from('fee_transactions')
    .select('id, amount, direction, kind, method, gateway_payment_id, utr, occurred_at, student_id, note')
    .order('occurred_at', { ascending: false })
    .limit(filter.limit ?? 200)

  if (filter.studentId) q = q.eq('student_id', filter.studentId)
  if (filter.from) q = q.gte('occurred_at', filter.from)
  if (filter.to) q = q.lte('occurred_at', filter.to)
  if (filter.kind) q = q.eq('kind', filter.kind)
  if (filter.method) q = q.eq('method', filter.method)

  const { data, error } = await q
  if (error) { console.error('fetchLedgerDetail failed:', error); return [] }
  const rows = (data ?? []) as unknown as LedgerDetail[]

  const ids = [...new Set(rows.map(r => r.student_id).filter((i): i is string => !!i))]
  if (!ids.length) return rows

  const { data: people } = await supabase.from('profiles').select('id, full_name').in('id', ids)
  const names = new Map((people ?? []).map(p => [p.id as string, p.full_name as string]))
  return rows.map(r => ({ ...r, student_name: r.student_id ? names.get(r.student_id) : undefined }))
}

// Re-exported so the dashboard has one import for its data, rather than
// reaching into collections.ts for half of it.
export { fetchOutstandingByClass, fetchOutstandingByHead }
export type { ClassOutstanding, HeadOutstanding } from './collections'

/** Download an accounting export. Streams the file straight to the browser. */
export async function downloadAccountingExport(
  format: 'tally' | 'zoho',
  from: string,
  to: string,
): Promise<{ success: boolean; error?: string }> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return { success: false, error: 'Please sign in again.' }

  try {
    const res = await fetch('/api/fees/accounting/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ format, from, to }),
    })

    if (!res.ok) {
      const json = await res.json().catch(() => ({}))
      return { success: false, error: json.error ?? 'The export could not be produced.' }
    }

    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `fees-${format}-${from}-to-${to}.${format === 'tally' ? 'xml' : 'csv'}`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
    return { success: true }
  } catch (e) {
    console.error('downloadAccountingExport failed:', e)
    return { success: false, error: 'Network error. Check your connection and try again.' }
  }
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}
