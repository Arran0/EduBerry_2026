import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { requireCapability } from '@/lib/fees/serverGuard'
import { auditFeeAction } from '@/lib/fees/audit'

// Turn a calculated run's preview lines into real school_fees rows.
//
// This is the irreversible half. Two guards stand in front of it:
//   • the run must be 'calculated', so nobody publishes a draft
//   • no blocking exception may be outstanding — a line the engine could not
//     compute would otherwise be published as ₹0, silently under-billing
//
// Publishing is idempotent at the line level: a line that already produced a
// school_fee is skipped, so a retry after a partial failure completes the run
// rather than double-billing.

export const runtime = 'nodejs'
export const maxDuration = 300

export async function POST(
  request: NextRequest,
  { params }: { params: { runId: string } },
) {
  const guard = await requireCapability(request, 'run_demand')
  if (!guard.ok) return guard.response
  const { db, userId } = guard.actor

  const { data: run } = await db
    .from('fee_demand_runs')
    .select('id, label, academic_year, status, installment_no')
    .eq('id', params.runId)
    .maybeSingle()
  if (!run) return NextResponse.json({ success: false, error: 'Demand run not found' }, { status: 404 })

  if (run.status === 'published') {
    return NextResponse.json({ success: true, already: true, created: 0 })
  }
  if (run.status !== 'calculated') {
    return NextResponse.json(
      { success: false, error: 'Calculate this run and review its exceptions before publishing.' },
      { status: 409 },
    )
  }

  const { data: lines, error: linesErr } = await db
    .from('fee_demand_lines')
    .select('id, student_id, fee_head_id, structure_id, structure_item_id, installment_no, due_date, gross_amount, concession_amount, net_amount, rule_trace, school_fee_id')
    .eq('run_id', run.id)
  if (linesErr) {
    return NextResponse.json({ success: false, error: linesErr.message }, { status: 500 })
  }
  if (!lines?.length) {
    return NextResponse.json({ success: false, error: 'This run has no calculated lines.' }, { status: 400 })
  }

  // Re-check for uncomputable lines against the stored trace rather than
  // trusting a flag the client sent. A ₹0 line whose trace says "Not computed"
  // is the failure this guard exists for.
  const blocked = lines.filter(l => {
    const trace = l.rule_trace as { steps?: { label?: string; detail?: string }[] } | null
    return trace?.steps?.some(s => s.label === 'Not computed') ?? false
  })
  if (blocked.length) {
    return NextResponse.json({
      success: false,
      error: `${blocked.length} line${blocked.length === 1 ? '' : 's'} could not be computed. Fix the structure before publishing — publishing now would bill ₹0 for them.`,
      blocked_student_ids: [...new Set(blocked.map(l => l.student_id))].slice(0, 50),
    }, { status: 409 })
  }

  const pending = lines.filter(l => !l.school_fee_id && Number(l.net_amount) > 0)
  let created = 0

  for (let i = 0; i < pending.length; i += 200) {
    const chunk = pending.slice(i, i + 200)
    const rows = chunk.map(l => ({
      fee_head_id: l.fee_head_id,
      student_id: l.student_id,
      amount: l.net_amount,
      gross_amount: l.gross_amount,
      concession_amount: l.concession_amount,
      description: describe(l.rule_trace, l.installment_no),
      due_date: l.due_date,
      academic_year: run.academic_year,
      structure_id: l.structure_id,
      structure_item_id: l.structure_item_id,
      demand_run_id: run.id,
      installment_no: l.installment_no,
      rule_trace: l.rule_trace,
      created_by: userId,
    }))

    const { data: inserted, error } = await db.from('school_fees').insert(rows).select('id')
    if (error) {
      console.error('demand-runs/publish: fee insert failed', error)
      return NextResponse.json({
        success: false,
        error: `Published ${created} fees, then failed. Run publish again to finish — lines already published are skipped.`,
      }, { status: 500 })
    }

    // Link each preview line to the fee it produced, so a re-run knows what is
    // already done. Insert order matches select order, which is what makes the
    // pairing sound.
    const ids = (inserted ?? []).map(r => r.id as string)
    await Promise.all(chunk.map((l, idx) =>
      ids[idx] ? db.from('fee_demand_lines').update({ school_fee_id: ids[idx] }).eq('id', l.id) : null,
    ))
    created += ids.length
  }

  await db.from('fee_demand_runs').update({
    status: 'published',
    published_by: userId,
    published_at: new Date().toISOString(),
  }).eq('id', run.id)

  await auditFeeAction(db, {
    actorId: userId, action: 'demand_run.publish', entityType: 'fee_demand_run', entityId: run.id,
    summary: `Published "${run.label}" — ${created} fees issued`,
    after: { created, academic_year: run.academic_year },
    request,
  })

  return NextResponse.json({ success: true, created, skipped: lines.length - pending.length })
}

/** A description a parent will recognise on their invoice. */
function describe(trace: unknown, installmentNo: number | null): string {
  const t = trace as { steps?: { detail?: string }[] } | null
  const head = t?.steps?.[0]?.detail?.replace(/^(Fixed amount for|Band \w+ =)\s*/, '') ?? 'School fee'
  return installmentNo ? `${head} — instalment ${installmentNo}` : head
}
