'use client'

import { supabase } from '@/lib/supabase'
import { ageFee, type Ageing, type AgeingState } from './engine/ageing'

// ============================================================================
// Collections — the browser's read layer.
// ----------------------------------------------------------------------------
// Reads the views in fees_v2_collections.sql rather than pulling every fee and
// summing it here. A school of 1,200 students with three instalments a year is
// 3,600 rows a term; bucketing that in the browser works right up until the
// term it does not.
//
// The ageing arithmetic still runs through the engine's ageFee(), so the
// defaulter list and the reminder scheduler cannot disagree about whether a fee
// is 31 days overdue.
// ============================================================================

export interface OutstandingFee {
  fee_id: string
  source: 'school' | 'bus'
  student_id: string
  fee_head_id: string | null
  academic_year: string | null
  due_date: string | null
  status: string
  billed: number
  paid: number
  outstanding: number
  grace_days: number | null
  carried_from_year: string | null
  installment_no: number | null
}

export interface DefaulterRow {
  student_id: string
  student_name: string
  class_label: string | null
  outstanding: number
  open_fees: number
  earliest_due: string | null
  worst: Ageing
  buckets: {
    current: number
    '1-30': number
    '31-60': number
    '61-90': number
    '90+': number
  }
}

export interface CollectionsFilter {
  year?: string
  homeroomId?: string
  /** Only students whose worst fee is in one of these states. */
  states?: AgeingState[]
  minOutstanding?: number
}

/** Today as a local YYYY-MM-DD, so ageing matches what the user sees on a calendar. */
export function todayLocal(): string {
  const d = new Date()
  const off = d.getTimezoneOffset()
  return new Date(d.getTime() - off * 60_000).toISOString().slice(0, 10)
}

export async function fetchOutstandingFees(filter: CollectionsFilter = {}): Promise<OutstandingFee[]> {
  let q = supabase
    .from('fee_outstanding')
    .select('fee_id, source, student_id, fee_head_id, academic_year, due_date, status, billed, paid, outstanding, grace_days, carried_from_year, installment_no')
    .gt('outstanding', 0)
    .order('due_date', { ascending: true, nullsFirst: false })
    .limit(20000)
  if (filter.year) q = q.eq('academic_year', filter.year)

  const { data, error } = await q
  if (error) { console.error('fetchOutstandingFees failed:', error); return [] }
  return (data ?? []) as unknown as OutstandingFee[]
}

/**
 * The defaulter list, one row per student, worst-aged first.
 *
 * `worst` is the oldest unpaid fee's ageing, not the sum's — a student with one
 * fee ninety days late and one due next week is a ninety-day problem, and
 * averaging that away is how a school stops noticing.
 */
export async function fetchDefaulters(filter: CollectionsFilter = {}): Promise<DefaulterRow[]> {
  const today = todayLocal()
  const fees = await fetchOutstandingFees(filter)
  if (!fees.length) return []

  const studentIds = [...new Set(fees.map(f => f.student_id))]
  const [names, classes] = await Promise.all([
    fetchNames(studentIds),
    fetchClasses(studentIds, filter.year),
  ])

  const byStudent = new Map<string, DefaulterRow>()
  for (const fee of fees) {
    if (filter.homeroomId && classes.get(fee.student_id)?.homeroomId !== filter.homeroomId) continue

    const ageing = ageFee({
      dueDate: fee.due_date,
      billed: Number(fee.billed),
      paid: Number(fee.paid),
      graceDays: fee.grace_days,
      cancelled: fee.status === 'cancelled',
      today,
    })
    if (ageing.state === 'settled') continue

    let row = byStudent.get(fee.student_id)
    if (!row) {
      row = {
        student_id: fee.student_id,
        student_name: names.get(fee.student_id) ?? 'Student',
        class_label: classes.get(fee.student_id)?.label ?? null,
        outstanding: 0,
        open_fees: 0,
        earliest_due: null,
        worst: ageing,
        buckets: { current: 0, '1-30': 0, '31-60': 0, '61-90': 0, '90+': 0 },
      }
      byStudent.set(fee.student_id, row)
    }

    row.outstanding = round2(row.outstanding + ageing.outstanding)
    row.open_fees++
    row.buckets[ageing.bucket] = round2(row.buckets[ageing.bucket] + ageing.outstanding)
    if (!row.earliest_due || (fee.due_date && fee.due_date < row.earliest_due)) {
      row.earliest_due = fee.due_date
    }
    if ((ageing.daysPastGrace ?? -Infinity) > (row.worst.daysPastGrace ?? -Infinity)) {
      row.worst = ageing
    }
  }

  let rows = [...byStudent.values()]
  if (filter.states?.length) rows = rows.filter(r => filter.states!.includes(r.worst.state))
  if (filter.minOutstanding) rows = rows.filter(r => r.outstanding >= filter.minOutstanding!)

  // Oldest debt first, then largest — that is the order an office works in.
  return rows.sort((a, b) => {
    const ageDiff = (b.worst.daysPastGrace ?? -Infinity) - (a.worst.daysPastGrace ?? -Infinity)
    return ageDiff !== 0 ? ageDiff : b.outstanding - a.outstanding
  })
}

// ── Aggregates straight from the views ──────────────────────────────────────

export interface ClassOutstanding {
  homeroom_id: string
  homeroom_name: string
  grade: number | null
  section: string | null
  academic_year: string | null
  students_with_dues: number
  students_billed: number
  billed: number
  paid: number
  outstanding: number
}

export async function fetchOutstandingByClass(year?: string): Promise<ClassOutstanding[]> {
  let q = supabase.from('fee_outstanding_by_class').select('*').order('grade').order('section')
  if (year) q = q.eq('academic_year', year)
  const { data, error } = await q
  if (error) { console.error('fetchOutstandingByClass failed:', error); return [] }
  return (data ?? []) as unknown as ClassOutstanding[]
}

export interface HeadOutstanding {
  fee_head_id: string | null
  head_name: string | null
  kind: string | null
  academic_year: string | null
  fee_count: number
  billed: number
  paid: number
  outstanding: number
}

export async function fetchOutstandingByHead(year?: string): Promise<HeadOutstanding[]> {
  let q = supabase.from('fee_outstanding_by_head').select('*').order('outstanding', { ascending: false })
  if (year) q = q.eq('academic_year', year)
  const { data, error } = await q
  if (error) { console.error('fetchOutstandingByHead failed:', error); return [] }
  return (data ?? []) as unknown as HeadOutstanding[]
}

export interface StudentOutstanding {
  student_id: string
  academic_year: string | null
  open_fees: number
  billed: number
  paid: number
  outstanding: number
  earliest_due: string | null
  bucket_current: number
  bucket_1_30: number
  bucket_31_60: number
  bucket_61_90: number
  bucket_90_plus: number
}

export async function fetchStudentOutstanding(studentId: string, year?: string): Promise<StudentOutstanding | null> {
  let q = supabase.from('fee_outstanding_by_student').select('*').eq('student_id', studentId)
  if (year) q = q.eq('academic_year', year)
  const { data, error } = await q.maybeSingle()
  if (error) { console.error('fetchStudentOutstanding failed:', error); return null }
  return (data as unknown as StudentOutstanding) ?? null
}

/** School-wide ageing totals for the dashboard. */
export async function fetchAgeingTotals(year?: string): Promise<{
  current: number; '1-30': number; '31-60': number; '61-90': number; '90+': number; total: number
}> {
  let q = supabase
    .from('fee_outstanding_by_student')
    .select('bucket_current, bucket_1_30, bucket_31_60, bucket_61_90, bucket_90_plus, outstanding')
    .limit(20000)
  if (year) q = q.eq('academic_year', year)

  const { data, error } = await q
  const zero = { current: 0, '1-30': 0, '31-60': 0, '61-90': 0, '90+': 0, total: 0 }
  if (error) { console.error('fetchAgeingTotals failed:', error); return zero }

  return (data ?? []).reduce((acc, r) => ({
    current: round2(acc.current + (Number(r.bucket_current) || 0)),
    '1-30': round2(acc['1-30'] + (Number(r.bucket_1_30) || 0)),
    '31-60': round2(acc['31-60'] + (Number(r.bucket_31_60) || 0)),
    '61-90': round2(acc['61-90'] + (Number(r.bucket_61_90) || 0)),
    '90+': round2(acc['90+'] + (Number(r.bucket_90_plus) || 0)),
    total: round2(acc.total + (Number(r.outstanding) || 0)),
  }), zero)
}

// ── Reminders ───────────────────────────────────────────────────────────────

async function authed(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession()
  return session?.access_token ?? null
}

export async function scheduleReminders(opts: { dryRun?: boolean } = {}): Promise<{
  success: boolean; queued?: number; considered?: number; wouldQueue?: number; error?: string
}> {
  const token = await authed()
  if (!token) return { success: false, error: 'Please sign in again.' }
  try {
    const res = await fetch('/api/fees/reminders/schedule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ dry_run: opts.dryRun ?? false }),
    })
    const json = await res.json()
    if (!json.success) return { success: false, error: json.error }
    return { success: true, queued: json.queued, considered: json.considered, wouldQueue: json.would_queue }
  } catch (e) {
    console.error('scheduleReminders failed:', e)
    return { success: false, error: 'Network error.' }
  }
}

export async function sendQueuedReminders(): Promise<{
  success: boolean; sent?: number; skipped?: number; failed?: number; more?: boolean; error?: string
}> {
  const token = await authed()
  if (!token) return { success: false, error: 'Please sign in again.' }
  try {
    const res = await fetch('/api/fees/reminders/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })
    const json = await res.json()
    if (!json.success) return { success: false, error: json.error }
    return { success: true, sent: json.sent, skipped: json.skipped, failed: json.failed, more: json.more }
  } catch (e) {
    console.error('sendQueuedReminders failed:', e)
    return { success: false, error: 'Network error.' }
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

async function fetchNames(ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  for (let i = 0; i < ids.length; i += 500) {
    const { data } = await supabase.from('profiles').select('id, full_name').in('id', ids.slice(i, i + 500))
    for (const p of data ?? []) out.set(p.id as string, p.full_name as string)
  }
  return out
}

async function fetchClasses(
  ids: string[],
  year?: string,
): Promise<Map<string, { label: string; homeroomId: string }>> {
  const out = new Map<string, { label: string; homeroomId: string }>()
  for (let i = 0; i < ids.length; i += 500) {
    const { data } = await supabase
      .from('homeroom_members')
      .select('student_id, homeroom:homerooms!homeroom_id(id, grade, section, academic_year)')
      .in('student_id', ids.slice(i, i + 500))

    type Row = { student_id: string; homeroom: { id: string; grade: number | null; section: string | null; academic_year: string | null } | null }
    for (const raw of (data ?? []) as unknown as Row[]) {
      const hr = Array.isArray(raw.homeroom) ? raw.homeroom[0] : raw.homeroom
      if (!hr) continue
      if (year && hr.academic_year && hr.academic_year !== year) continue
      if (out.has(raw.student_id)) continue
      out.set(raw.student_id, {
        label: hr.grade ? `${hr.grade}${hr.section ? `-${hr.section}` : ''}` : '—',
        homeroomId: hr.id,
      })
    }
  }
  return out
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}
