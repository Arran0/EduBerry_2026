import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { requireAdmin } from '@/lib/payroll/serverGuard'
import { canTransition, type RunStatus } from '@/lib/payroll/engine/workflow'

// Move a run through the workflow.
//
// Every guard is evaluated here, server-side, against the run's real state —
// not against what the browser believes. Approval while a blocking exception is
// open, locking without an approver, reopening a locked run: all refused here,
// and refused again by the database triggers if anything ever reaches them by
// another path.

export async function POST(request: NextRequest, { params }: { params: { runId: string } }) {
  const guard = await requireAdmin(request)
  if (!guard.ok) return guard.response
  const { db, userId } = guard
  const runId = params.runId

  const { to, note } = await request.json() as { to: RunStatus; note?: string }
  if (!to) return NextResponse.json({ success: false, error: 'A target status is required' }, { status: 400 })

  const { data: run } = await db.from('payroll_runs')
    .select('id, status, approved_by, calculated_at, variance_acknowledged_at').eq('id', runId).maybeSingle()
  if (!run) return NextResponse.json({ success: false, error: 'Run not found' }, { status: 404 })

  const [{ count: lineCount }, { count: blocking }, { count: unresolved }, { count: paidCount }] = await Promise.all([
    db.from('payroll_run_lines').select('id', { count: 'exact', head: true }).eq('run_id', runId),
    db.from('payroll_exceptions').select('id', { count: 'exact', head: true })
      .eq('run_id', runId).eq('severity', 'block').is('resolved_at', null),
    db.from('payroll_exceptions').select('id', { count: 'exact', head: true })
      .eq('run_id', runId).is('resolved_at', null),
    db.from('payroll_run_lines').select('id', { count: 'exact', head: true })
      .eq('run_id', runId).eq('payout_status', 'processed'),
  ])

  const check = canTransition(run.status as RunStatus, to, {
    lineCount: lineCount ?? 0,
    calculatedAt: run.calculated_at,
    blockingExceptions: blocking ?? 0,
    unresolvedExceptions: unresolved ?? 0,
    approvedBy: run.approved_by,
    varianceAcknowledged: !!run.variance_acknowledged_at,
    paidLineCount: paidCount ?? 0,
  })
  if (!check.allowed) {
    return NextResponse.json({ success: false, error: check.reason }, { status: 409 })
  }

  // Locking goes through the database function, which computes and stores the
  // tamper-evident hash inside the same transaction that flips the status.
  if (to === 'locked') {
    const { error } = await db.rpc('payroll_lock_run', { p_run: runId })
    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 409 })
    return NextResponse.json({ success: true, status: 'locked' })
  }

  const patch: Record<string, unknown> = { status: to }
  if (to === 'approved') {
    patch.approved_by = userId
    patch.approved_at = new Date().toISOString()
  }
  // Sending an approved run back for more work clears the approval: an approval
  // that survives the numbers changing underneath it is not an approval.
  if (to === 'pending_approval' && run.status === 'approved') {
    patch.approved_by = null
    patch.approved_at = null
  }

  const { error } = await db.from('payroll_runs').update(patch).eq('id', runId)
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })

  await db.from('payroll_run_events').insert({
    run_id: runId, from_status: run.status, to_status: to, actor_id: userId, note: note ?? null,
  })

  return NextResponse.json({ success: true, status: to })
}
