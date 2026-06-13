import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createVirtualVpa } from '@/lib/smartCollect'

// Starts a Smart Collect UPI payment for a school fee and returns the VPA +
// reference the student should pay to. A pending school_fee_payments row is
// created so /api/fees/upi/webhook can match the bank's payment notification.
//
//   • reference mode   → returns the merchant VPA + the fee's unique reference
//   • virtual_vpa mode → allocates a per-fee VPA via the provider
//
// Required env: SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_SUPABASE_URL
//               (+ SMART_COLLECT_BASE_URL / SMART_COLLECT_API_KEY for vpa mode).

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!serviceRoleKey || !supabaseUrl) {
    return NextResponse.json({ success: false, error: 'Server not configured' }, { status: 500 })
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const authHeader = request.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }
  const { data: { user }, error: authErr } = await admin.auth.getUser(authHeader.slice(7))
  if (authErr || !user) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  const { fee_id } = await request.json()
  if (!fee_id) return NextResponse.json({ success: false, error: 'fee_id is required' }, { status: 400 })

  const { data: fee, error: feeErr } = await admin
    .from('school_fees')
    .select('id, student_id, amount, status, upi_reference')
    .eq('id', fee_id)
    .single()
  if (feeErr || !fee) return NextResponse.json({ success: false, error: 'Fee not found' }, { status: 404 })
  if (fee.student_id !== user.id) return NextResponse.json({ success: false, error: 'This fee is not yours' }, { status: 403 })
  if (fee.status === 'paid' || fee.status === 'cancelled') {
    return NextResponse.json({ success: false, error: `Fee is already ${fee.status}` }, { status: 409 })
  }

  // Read config: enablement + mode, and the merchant VPA / payee.
  const [{ data: scRow }, { data: upiRow }] = await Promise.all([
    admin.from('site_settings').select('value').eq('key', 'smart_collect_config').maybeSingle(),
    admin.from('site_settings').select('value').eq('key', 'upi_config').maybeSingle(),
  ])
  const sc = (scRow?.value ?? {}) as { enabled?: boolean; mode?: 'reference' | 'virtual_vpa' }
  const upi = (upiRow?.value ?? {}) as { vpa?: string; payee_name?: string }
  if (!sc.enabled) {
    return NextResponse.json({ success: false, error: 'Smart Collect is not enabled' }, { status: 503 })
  }

  const reference = fee.upi_reference
  const mode = sc.mode ?? 'reference'
  let payVpa = upi.vpa ?? ''

  if (mode === 'virtual_vpa') {
    const alloc = await createVirtualVpa({ reference, amount: Number(fee.amount), customerName: undefined })
    if (!alloc.ok || !alloc.vpa) {
      return NextResponse.json({ success: false, error: alloc.error ?? 'Could not allocate VPA' }, { status: 502 })
    }
    payVpa = alloc.vpa
  }

  if (!payVpa) {
    return NextResponse.json({ success: false, error: 'No merchant UPI ID configured' }, { status: 503 })
  }

  // Reuse an existing pending row for this fee+reference, else create one.
  const { data: existing } = await admin
    .from('school_fee_payments')
    .select('id')
    .eq('provider_ref', reference)
    .eq('status', 'pending')
    .maybeSingle()
  if (!existing) {
    await admin.from('school_fee_payments').insert({
      fee_id: fee.id,
      payer_id: user.id,
      method: 'upi_qr',
      provider: 'smart_collect',
      provider_ref: reference,
      collect_vpa: mode === 'virtual_vpa' ? payVpa : null,
      amount: fee.amount,
      status: 'pending',
    })
  }

  return NextResponse.json({
    success: true,
    vpa: payVpa,
    reference,
    payee_name: upi.payee_name || 'School Fees',
    amount: Number(fee.amount),
  })
}
