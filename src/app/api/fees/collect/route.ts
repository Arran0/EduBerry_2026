import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { requireFeePermission } from '@/lib/fees/serverGuard'

/**
 * Take a payment.
 *
 * Everything a counter payment must do — number it, allocate it across the
 * outstanding bills, seal the receipt hash, post the ledger, bank any
 * overpayment as a credit and log it — happens inside the fee_collect RPC, in
 * one transaction. Doing it as a sequence of writes from here would leave a
 * receipt number with no payment behind it the moment one step failed, and a
 * gap in a statutory series is not something you can explain to an auditor.
 *
 * The route's job is the permission check and translating the database's
 * errors into something a clerk can act on.
 */
export async function POST(request: NextRequest) {
  const guard = await requireFeePermission(request, 'fees.collect')
  if (!guard.ok) return guard.response

  let body: {
    student_id?: string
    academic_year_id?: string
    amount?: number
    method?: string
    allocations?: { invoice_id: string; amount: number }[]
    paid_on?: string
    reference?: string
    notes?: string
    instrument?: Record<string, unknown> | null
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ success: false, error: 'Bad request body' }, { status: 400 })
  }

  const { student_id, academic_year_id, amount, method } = body
  if (!student_id || !academic_year_id || !amount || !method) {
    return NextResponse.json(
      { success: false, error: 'A student, a session, an amount and a method are all required.' },
      { status: 400 })
  }

  const { data, error } = await guard.db.rpc('fee_collect', {
    p_student: student_id,
    p_year: academic_year_id,
    p_amount: amount,
    p_method: method,
    p_allocations: body.allocations ?? null,
    p_paid_on: body.paid_on ?? null,
    p_reference: body.reference ?? null,
    p_notes: body.notes ?? null,
    p_instrument: body.instrument ?? null,
    p_status: null,
    // Who is taking the money. The route holds the authenticated caller;
    // the RPC has no JWT of its own because this is a service-role client, so
    // without this the receipt would record no collector at all.
    p_actor: guard.userId,
  })

  if (error) {
    // The RPC raises with sentences meant to be read by the person at the
    // counter ("A payment cannot be dated more than 30 days back"), so pass
    // them through rather than replacing them with a generic failure.
    return NextResponse.json({ success: false, error: error.message }, { status: 400 })
  }

  return NextResponse.json({ success: true, ...data })
}
