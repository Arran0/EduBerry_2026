import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { requireFeePermission } from '@/lib/fees/serverGuard'

/** Move a cheque or DD through its lifecycle: deposited, cleared, or bounced. */
export async function POST(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const guard = await requireFeePermission(request, 'fees.instrument.manage')
  if (!guard.ok) return guard.response

  let body: { to?: string; note?: string; bounce_charge?: number }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ success: false, error: 'Bad request body' }, { status: 400 })
  }

  if (!body.to) {
    return NextResponse.json({ success: false, error: 'Say which state to move it to.' }, { status: 400 })
  }

  const { data, error } = await guard.db.rpc('fee_instrument_transition', {
    p_instrument: params.id,
    p_to: body.to,
    p_note: body.note ?? null,
    p_bounce_charge: body.bounce_charge ?? null,
  })
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 400 })

  return NextResponse.json({ success: true, ...data })
}
