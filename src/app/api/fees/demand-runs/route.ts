import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { requireCapability } from '@/lib/fees/serverGuard'
import { auditFeeAction } from '@/lib/fees/audit'

// Create and list demand runs — the event that turns fee structures into bills.
//
// A run is a deliberate, reviewable act rather than a bulk insert: draft →
// calculated → published. Publishing is what creates school_fees rows, and by
// then an admin has seen the totals, the exceptions and every student's
// computed amount. That review step is the difference between a fee engine and
// a mail-merge.

export const runtime = 'nodejs'

interface Body {
  label?: string
  academic_year?: string
  as_of_date?: string
  installment_no?: number | null
  /** Restrict to a set of homerooms. Empty means the whole school. */
  homeroom_ids?: string[]
}

export async function POST(request: NextRequest) {
  const guard = await requireCapability(request, 'run_demand')
  if (!guard.ok) return guard.response
  const { db, userId } = guard.actor

  let body: Body
  try { body = await request.json() } catch { return bad('Invalid request body') }

  if (!body.label?.trim()) return bad('A label is required, so this run is recognisable a year from now.')
  if (!body.academic_year?.trim()) return bad('academic_year is required')

  const { data, error } = await db.from('fee_demand_runs').insert({
    label: body.label.trim(),
    academic_year: body.academic_year.trim(),
    as_of_date: body.as_of_date ?? new Date().toISOString().slice(0, 10),
    installment_no: body.installment_no ?? null,
    status: 'draft',
    structure_ids: body.homeroom_ids?.length ? { homeroom_ids: body.homeroom_ids } : null,
    created_by: userId,
  }).select('id, label, academic_year, status, as_of_date, installment_no').single()

  if (error) {
    console.error('demand-runs: insert failed', error)
    return NextResponse.json({ success: false, error: error.message }, { status: 400 })
  }

  await auditFeeAction(db, {
    actorId: userId, action: 'demand_run.create', entityType: 'fee_demand_run', entityId: data.id,
    summary: `Created demand run "${data.label}" for ${data.academic_year}`,
    after: { label: data.label, academic_year: data.academic_year },
    request,
  })

  return NextResponse.json({ success: true, run: data })
}

export async function GET(request: NextRequest) {
  const guard = await requireCapability(request, 'view_reports')
  if (!guard.ok) return guard.response
  const { db } = guard.actor

  const year = new URL(request.url).searchParams.get('year')
  let q = db.from('fee_demand_runs')
    .select('id, label, academic_year, installment_no, as_of_date, status, student_count, gross_total, concession_total, net_total, calculated_at, published_at')
    .order('created_at', { ascending: false })
    .limit(100)
  if (year) q = q.eq('academic_year', year)

  const { data, error } = await q
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  return NextResponse.json({ success: true, runs: data ?? [] })
}

function bad(error: string) {
  return NextResponse.json({ success: false, error }, { status: 400 })
}
