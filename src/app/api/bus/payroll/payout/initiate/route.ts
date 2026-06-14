import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getPayoutProvider, PayoutRequest } from '@/lib/payoutProvider'
import { getPaymentSecrets } from '@/lib/serverSecrets'

// Initiates a provider bank transfer for ONE approved driver payroll period.
// Admin-only.
//
// The app never moves money itself — it calls the configured payout provider's
// bulk bank-transfer API (the same site-wide payout_config the Salary Manager
// uses). When payouts are disabled or set to 'manual', this is a no-op and the
// admin disburses via their bank portal, marking the period paid by hand.
//
// Required env: SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_SUPABASE_URL.

interface PayrollRow {
  id: string
  base_amount: number
  status: string
  driver_id: string
  driver: { full_name: string } | null
  items: { amount: number }[]
}

export async function POST(request: NextRequest) {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!serviceRoleKey || !supabaseUrl) {
    return NextResponse.json({ success: false, error: 'Server not configured' }, { status: 500 })
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // Authenticate + authorize the caller as admin.
  const authHeader = request.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }
  const { data: { user }, error: authErr } = await admin.auth.getUser(authHeader.slice(7))
  if (authErr || !user) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }
  const { data: callerProfile } = await admin.from('profiles').select('role').eq('id', user.id).single()
  if (callerProfile?.role !== 'admin') {
    return NextResponse.json({ success: false, error: 'Admin access required' }, { status: 403 })
  }

  const { payroll_id } = await request.json()
  if (!payroll_id) {
    return NextResponse.json({ success: false, error: 'payroll_id is required' }, { status: 400 })
  }

  // Load the payout config: public part from site_settings, secrets from the
  // admin-configured payment_secrets store (env fallback).
  const { data: cfgRow } = await admin.from('site_settings').select('value').eq('key', 'payout_config').maybeSingle()
  const secrets = await getPaymentSecrets(admin, 'payout')
  const config = {
    enabled: false as boolean,
    provider: 'manual' as 'manual' | 'razorpayx' | 'cashfree',
    key_id: '',
    ...(cfgRow?.value as Record<string, unknown> | null ?? {}),
    key_secret: secrets.key_secret,
    account_number: secrets.account_number,
  }

  // Only an approved period is eligible for disbursement.
  const { data: payroll, error: pErr } = await admin
    .from('driver_payroll')
    .select('id, base_amount, status, driver_id, period_start, period_end, driver:profiles!driver_id(full_name), items:driver_payroll_items(amount)')
    .eq('id', payroll_id)
    .single()
  if (pErr || !payroll) {
    return NextResponse.json({ success: false, error: 'Payroll period not found' }, { status: 404 })
  }
  const row = payroll as unknown as PayrollRow & { period_start: string; period_end: string }
  if (row.status !== 'approved') {
    return NextResponse.json({ success: false, error: 'Only approved periods can be disbursed' }, { status: 409 })
  }

  // Manual / disabled: nothing to push. The UI keeps the mark-as-paid flow.
  if (!config.enabled || config.provider === 'manual') {
    return NextResponse.json({ success: true, manual: true })
  }

  // Driver bank account for this transfer.
  const { data: bank } = await admin
    .from('driver_bank_accounts')
    .select('account_holder_name, account_number, ifsc, bank_name, payout_fund_account_id')
    .eq('driver_id', row.driver_id)
    .maybeSingle()
  if (!bank) {
    return NextResponse.json({
      success: false,
      error: `No bank details on file for ${row.driver?.full_name ?? 'this driver'}`,
    }, { status: 409 })
  }

  const net = Number(row.base_amount || 0) + row.items.reduce((s, i) => s + Number(i.amount || 0), 0)
  const period = `${row.period_start} – ${row.period_end}`
  const payoutRequest: PayoutRequest = {
    reference: row.id,
    amount: net,
    bank: {
      account_holder_name: bank.account_holder_name,
      account_number: bank.account_number,
      ifsc: bank.ifsc,
      bank_name: bank.bank_name,
      payout_fund_account_id: bank.payout_fund_account_id,
    },
    note: `Driver salary ${period} — ${row.driver?.full_name ?? ''}`.trim(),
  }

  // Hand the transfer to the provider and reconcile the period with the result.
  const provider = getPayoutProvider(config)
  const [result] = await provider.createBulkPayout([payoutRequest])

  await admin.from('driver_payroll').update({
    payout_status: result.status,
    payout_reference: result.payoutId ?? null,
  }).eq('id', row.id)

  if (!result.success) {
    return NextResponse.json({ success: false, error: result.error ?? 'Payout was rejected', provider: provider.name }, { status: 502 })
  }

  return NextResponse.json({ success: true, initiated: 1, provider: provider.name })
}
