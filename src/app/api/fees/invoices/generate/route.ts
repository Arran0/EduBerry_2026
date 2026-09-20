import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { requireFeePermission } from '@/lib/fees/serverGuard'

/**
 * Generate the bills for one installment.
 *
 * `commit: false` runs exactly the same query and writes nothing. That is the
 * point: a preview that counts differently from the run it previews is the
 * fastest way to lose a school's trust, so there is one code path and a flag,
 * not two implementations.
 */
export async function POST(request: NextRequest) {
  const guard = await requireFeePermission(request, 'fees.invoice.generate')
  if (!guard.ok) return guard.response

  let body: { installment_id?: string; commit?: boolean; profile_ids?: string[] }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ success: false, error: 'Bad request body' }, { status: 400 })
  }

  if (!body.installment_id) {
    return NextResponse.json({ success: false, error: 'Which installment?' }, { status: 400 })
  }

  const { data, error } = await guard.db.rpc('fee_generate_invoices', {
    p_installment: body.installment_id,
    p_commit: body.commit === true,
    p_autogen: false,
    p_profile_ids: body.profile_ids ?? null,
  })
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 400 })

  return NextResponse.json({ success: true, ...data })
}
