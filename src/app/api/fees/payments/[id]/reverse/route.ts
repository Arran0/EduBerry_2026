import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { requireFeePermission } from '@/lib/fees/serverGuard'

/**
 * Reverse a completed payment.
 *
 * Its own route and its own permission because it is a different act from
 * taking money: the reason goes on the record, the bills reopen, and the
 * receipt's QR starts answering CANCELLED to anyone who scans it. Nothing is
 * deleted, so the clerk who took the payment keeps the evidence that they did.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const guard = await requireFeePermission(request, 'fees.payment.reverse')
  if (!guard.ok) return guard.response

  let reason = ''
  try {
    reason = String(((await request.json()) as { reason?: string }).reason ?? '')
  } catch {
    return NextResponse.json({ success: false, error: 'Bad request body' }, { status: 400 })
  }

  if (reason.trim().length < 3) {
    return NextResponse.json(
      { success: false, error: 'Say why this payment is being reversed. The reason goes on the record.' },
      { status: 400 })
  }

  const { data, error } = await guard.db.rpc('fee_reverse_payment', {
    p_payment: params.id,
    p_reason: reason.trim(),
  })
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 400 })

  return NextResponse.json({ success: true, ...data })
}
