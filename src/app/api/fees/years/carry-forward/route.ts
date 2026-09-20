import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { requireFeePermission } from '@/lib/fees/serverGuard'

/**
 * Carry unpaid balances from one session into the next.
 *
 * Defaults to a preview. Committing writes a debt against every family that
 * still owed something, so the caller has to ask for it in as many words —
 * `commit` must arrive as literal `true`, not merely truthy.
 */
export async function POST(request: NextRequest) {
  const guard = await requireFeePermission(request, 'fees.config.clone_year')
  if (!guard.ok) return guard.response

  let body: { from?: string; to?: string; commit?: boolean }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ success: false, error: 'Bad request body' }, { status: 400 })
  }

  if (!body.from || !body.to) {
    return NextResponse.json(
      { success: false, error: 'Name the session to carry from and the one to carry into.' },
      { status: 400 })
  }
  if (body.from === body.to) {
    return NextResponse.json(
      { success: false, error: 'A session cannot carry forward into itself.' }, { status: 400 })
  }

  const { data, error } = await guard.db.rpc('fee_carry_forward', {
    p_from: body.from,
    p_to: body.to,
    p_commit: body.commit === true,
    p_actor: guard.userId,
  })
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 400 })

  return NextResponse.json({ success: true, ...data })
}
