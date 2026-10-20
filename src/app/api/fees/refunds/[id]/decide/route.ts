import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { requireFeePermission } from '@/lib/fees/serverGuard'

/**
 * Approve or decline a refund.
 *
 * `p_actor` is what makes the RPC's "nobody approves their own request" rule
 * work at all: the route holds a service-role client with no JWT, so without
 * the actor passed explicitly the database would see NULL and let anyone sign
 * off their own.
 */
export async function POST(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const guard = await requireFeePermission(request, 'fees.refund.approve')
  if (!guard.ok) return guard.response

  let body: { approve?: boolean; note?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ success: false, error: 'Bad request body' }, { status: 400 })
  }

  if (typeof body.approve !== 'boolean') {
    return NextResponse.json(
      { success: false, error: 'Say whether this is approved or declined.' }, { status: 400 })
  }
  if (!body.approve && (body.note ?? '').trim().length < 3) {
    return NextResponse.json(
      { success: false, error: 'Declining needs a reason the requester can read.' }, { status: 400 })
  }

  const { data, error } = await guard.db.rpc('fee_decide_refund', {
    p_refund: params.id,
    p_approve: body.approve,
    p_note: body.note?.trim() ?? null,
    p_actor: guard.userId,
  })
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 400 })

  return NextResponse.json({ success: true, ...data })
}
