import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { requireFeePermission } from '@/lib/fees/serverGuard'

/**
 * Request a refund.
 *
 * Guarded by `fees.collect` rather than `fees.refund.approve`: the clerk who
 * took the money is usually the one who notices it was too much, and asking is
 * not deciding. The RPC will not let the same person approve it.
 */
export async function POST(request: NextRequest) {
  const guard = await requireFeePermission(request, 'fees.collect')
  if (!guard.ok) return guard.response

  let body: {
    student_id?: string; academic_year_id?: string; amount?: number
    reason?: string; source_payment_id?: string | null; source_credit_id?: string | null
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ success: false, error: 'Bad request body' }, { status: 400 })
  }

  if (!body.student_id || !body.academic_year_id) {
    return NextResponse.json(
      { success: false, error: 'A refund needs a student and a session.' }, { status: 400 })
  }
  if (!body.amount || body.amount <= 0) {
    return NextResponse.json(
      { success: false, error: 'A refund needs an amount.' }, { status: 400 })
  }
  if ((body.reason ?? '').trim().length < 3) {
    return NextResponse.json(
      { success: false, error: 'Say why. It is money leaving the school.' }, { status: 400 })
  }

  const { data, error } = await guard.db.rpc('fee_request_refund', {
    p_student: body.student_id,
    p_year: body.academic_year_id,
    p_amount: body.amount,
    p_reason: body.reason!.trim(),
    p_payment: body.source_payment_id ?? null,
    p_credit: body.source_credit_id ?? null,
    p_actor: guard.userId,
  })
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 400 })

  return NextResponse.json({ success: true, ...data })
}
