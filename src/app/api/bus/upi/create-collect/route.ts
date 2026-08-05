import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { allocateCollectTarget, createVirtualVpa, type CollectTarget } from '@/lib/smartCollect'
import { resolveCollectSetup } from '@/lib/collectSetup'

// Starts a Smart Collect UPI payment for a fee and returns the VPA + reference
// the passenger should pay to. A pending bus_payments row is created so the
// /api/bus/upi/webhook can match the bank's payment notification back to it.
//
//   • reference       → returns the school VPA + the fee's unique reference
//   • virtual_vpa     → the bank allots a per-fee UPI ID
//   • virtual_account → the bank allots a per-fee account number + IFSC
//
// Bank credentials come from the admin-configured payment_secrets store.
// Required env: SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_SUPABASE_URL.

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
    .from('bus_fees')
    .select('id, passenger_id, amount, status, upi_reference')
    .eq('id', fee_id)
    .single()
  if (feeErr || !fee) return NextResponse.json({ success: false, error: 'Fee not found' }, { status: 404 })
  if (fee.passenger_id !== user.id) return NextResponse.json({ success: false, error: 'This fee is not yours' }, { status: 403 })
  if (fee.status === 'paid' || fee.status === 'cancelled') {
    return NextResponse.json({ success: false, error: `Fee is already ${fee.status}` }, { status: 409 })
  }

  // Resolve the live collection setup (direct bank connection, else the legacy
  // Smart Collect config) plus the school's own UPI ID for reference mode.
  const [setup, { data: upiRow }] = await Promise.all([
    resolveCollectSetup(admin),
    admin.from('site_settings').select('value').eq('key', 'upi_config').maybeSingle(),
  ])
  const upi = (upiRow?.value ?? {}) as { vpa?: string; payee_name?: string }
  if (!setup.enabled) {
    return NextResponse.json({ success: false, error: 'Bank collection is not enabled' }, { status: 503 })
  }

  const reference = fee.upi_reference
  const mode = setup.mode
  let payVpa = upi.vpa ?? ''
  let payAccount: string | null = null
  let payIfsc: string | null = null

  // reference mode needs no bank call — the school VPA plus the fee's unique
  // reference is enough for the bank to match the credit on the callback.
  if (mode !== 'reference') {
    const alloc = setup.legacy
      ? await createVirtualVpa(
          { reference, amount: Number(fee.amount), customerName: undefined },
          { baseUrl: setup.legacyBaseUrl, apiKey: setup.legacyApiKey },
        ).then(r => r.ok && r.vpa
            ? { ok: true as const, target: { vpa: r.vpa } as CollectTarget, error: undefined }
            : { ok: false as const, target: undefined, error: r.error })
      : await allocateCollectTarget(
          { reference, amount: Number(fee.amount), customerName: undefined },
          setup.config,
          setup.creds,
        )

    if (!alloc.ok || !alloc.target) {
      return NextResponse.json(
        { success: false, error: alloc.error ?? 'The bank could not allot a collection handle' },
        { status: 502 },
      )
    }
    if (alloc.target.vpa) payVpa = alloc.target.vpa
    payAccount = alloc.target.account_number ?? null
    payIfsc = alloc.target.ifsc ?? null
  }

  if (!payVpa && !payAccount) {
    return NextResponse.json({ success: false, error: 'No school UPI ID or virtual account is configured' }, { status: 503 })
  }

  // Reuse an existing pending row for this fee+reference, else create one.
  const { data: existing } = await admin
    .from('bus_payments')
    .select('id')
    .eq('provider_ref', reference)
    .eq('status', 'pending')
    .maybeSingle()
  if (!existing) {
    await admin.from('bus_payments').insert({
      fee_id: fee.id,
      payer_id: user.id,
      method: 'upi_qr',
      provider: 'smart_collect',
      provider_ref: reference,
      // The allotted handle — VPA or virtual account number — is what the
      // callback matches on. reference mode has no handle and matches on
      // provider_ref instead.
      collect_vpa: mode === 'reference' ? null : (payAccount ?? payVpa),
      amount: fee.amount,
      status: 'pending',
    })
  }

  return NextResponse.json({
    success: true,
    vpa: payVpa,
    account_number: payAccount,
    ifsc: payIfsc,
    reference,
    payee_name: upi.payee_name || 'School Transport',
    amount: Number(fee.amount),
  })
}
