import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { requireFeePermission } from '@/lib/fees/serverGuard'

const METHODS = new Set(['cash', 'bank_transfer', 'cheque', 'upi', 'adjustment'])

/** Pay out an approved refund. The only step that moves money. */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const guard = await requireFeePermission(request, 'fees.refund.approve')
  if (!guard.ok) return guard.response

  let body: { method?: string; reference?: string; paid_on?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ success: false, error: 'Bad request body' }, { status: 400 })
  }

  if (!body.method || !METHODS.has(body.method)) {
    return NextResponse.json(
      { success: false, error: 'Say how the money went out.' }, { status: 400 })
  }

  const { data, error } = await guard.db.rpc('fee_pay_refund', {
    p_refund: params.id,
    p_method: body.method,
    p_reference: body.reference?.trim() || null,
    p_paid_on: body.paid_on ?? null,
    p_actor: guard.userId,
  })
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 400 })

  return NextResponse.json({ success: true, ...data })
}
