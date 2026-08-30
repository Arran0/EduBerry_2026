import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { requireCapability } from '@/lib/fees/serverGuard'
import { auditFeeAction } from '@/lib/fees/audit'

// Roll last year's unpaid balances into this year as opening arrears.
//
// The old fees are NOT touched. Rolling a debt forward by editing the fee it
// came from erases when it actually arose, and "owed since last April" is
// exactly what a principal needs to see. So each student gets one new fee for
// the total they still owe, tagged `carried_from_year`, and the originals stay
// where they are with their own dates and their own history.
//
// Idempotent: a second run for the same pair of years does nothing, because
// carry_forward_arrears() skips any student who already has a carry-forward row
// for that pair. Running it twice by accident is free.

export const runtime = 'nodejs'
export const maxDuration = 300

interface Body {
  from_year?: string
  to_year?: string
  /** The head to bill the arrears under. Usually a dedicated "Arrears" head. */
  fee_head_id?: string
  due_date?: string
  dry_run?: boolean
}

export async function POST(request: NextRequest) {
  const guard = await requireCapability(request, 'run_demand')
  if (!guard.ok) return guard.response
  const { db, userId } = guard.actor

  let body: Body
  try { body = await request.json() } catch { return bad('Invalid request body') }

  const from = body.from_year?.trim()
  const to = body.to_year?.trim()
  if (!from || !to) return bad('from_year and to_year are both required')
  if (from === to) return bad('Arrears cannot be carried into the same year they arose in.')

  // What would move, so the admin sees it before committing.
  const { data: owing, error } = await db
    .from('fee_outstanding_by_student')
    .select('student_id, outstanding')
    .eq('academic_year', from)
    .gt('outstanding', 0)
    .limit(20000)

  if (error) {
    console.error('carry-forward: preview failed', error)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  const rows = owing ?? []
  const total = rows.reduce((s, r) => s + (Number(r.outstanding) || 0), 0)

  if (body.dry_run) {
    return NextResponse.json({
      success: true, dry_run: true,
      students: rows.length,
      total: Math.round(total * 100) / 100,
    })
  }

  if (!rows.length) {
    return NextResponse.json({ success: true, carried: 0, total: 0, note: `Nothing was outstanding in ${from}.` })
  }

  const { data: moved, error: rpcErr } = await db.rpc('carry_forward_arrears', {
    p_from_year: from,
    p_to_year: to,
    p_head: body.fee_head_id ?? null,
    p_due: body.due_date ?? new Date().toISOString().slice(0, 10),
    p_actor: userId,
  })

  if (rpcErr) {
    console.error('carry-forward: rpc failed', rpcErr)
    return NextResponse.json({ success: false, error: rpcErr.message }, { status: 500 })
  }

  const carried = Number(moved) || 0

  await auditFeeAction(db, {
    actorId: userId, action: 'arrears.carry_forward', entityType: 'fee_demand_run',
    summary: `Carried ${carried} arrears balances from ${from} into ${to} (₹${Math.round(total).toLocaleString('en-IN')})`,
    after: { from_year: from, to_year: to, students: carried, total },
    request,
  })

  return NextResponse.json({
    success: true,
    carried,
    // Fewer rows carried than owing means some had already been carried — the
    // idempotency guard doing its job, not a partial failure.
    already_carried: rows.length - carried,
    total: Math.round(total * 100) / 100,
  })
}

function bad(error: string) {
  return NextResponse.json({ success: false, error }, { status: 400 })
}
