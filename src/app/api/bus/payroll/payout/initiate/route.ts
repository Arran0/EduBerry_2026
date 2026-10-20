import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getPayoutProvider, PayoutRequest, PayoutCredentials } from '@/lib/payoutProvider'
import { normalizePayoutConfig, type PayoutConfig } from '@/lib/bankConfig'
import { getPaymentSecrets } from '@/lib/serverSecrets'
import { isSent, reconcile } from '@/lib/payoutClaim'

// Initiates provider payouts for an APPROVED driver payroll cycle. Admin-only.
// Mirrors /api/salary/payout/initiate on the driver_payroll_records table and
// driver_bank_accounts, using the SAME site-wide payout provider.
//
// The app never moves money itself — it calls the configured payout provider's
// bulk bank-transfer API. When payouts are disabled or set to 'manual', this is
// a no-op and the admin disburses via their bank portal, marking records paid
// by hand.
//
// Required env: SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_SUPABASE_URL.

interface RecordRow {
  id: string
  base_amount: number
  status: string
  driver_id: string
  payout_status: string | null
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

  const { cycle_id } = await request.json()
  if (!cycle_id) {
    return NextResponse.json({ success: false, error: 'cycle_id is required' }, { status: 400 })
  }

  const { data: cycle } = await admin
    .from('driver_payroll_cycles').select('id, period_month, period_year').eq('id', cycle_id).single()
  if (!cycle) {
    return NextResponse.json({ success: false, error: 'Cycle not found' }, { status: 404 })
  }

  // Load the payout config: public part from site_settings, credentials from
  // the admin-configured payment_secrets store (env fallback). Credentials are
  // kept out of the config object so they are never echoed back in a response.
  const { data: cfgRow } = await admin.from('site_settings').select('value').eq('key', 'payout_config').maybeSingle()
  const secrets = await getPaymentSecrets(admin, 'payout')
  const config = normalizePayoutConfig(cfgRow?.value as Partial<PayoutConfig> | null)
  const creds: PayoutCredentials = {
    api_key: secrets.api_key,
    client_id: secrets.client_id,
    client_secret: secrets.client_secret,
    oauth_audience: secrets.oauth_audience,
    signing_secret: secrets.signing_secret,
    client_cert_pem: secrets.client_cert_pem,
    client_key_pem: secrets.client_key_pem,
    client_cert_passphrase: secrets.client_cert_passphrase,
    corporate_id: secrets.corporate_id,
    account_number: secrets.account_number,
    account_ifsc: secrets.account_ifsc,
  }

  // Manual / disabled: nothing to push. The UI keeps the mark-as-paid flow.
  if (!config.enabled || config.provider === 'manual') {
    return NextResponse.json({ success: true, manual: true })
  }

  // Only approved records are eligible for disbursement.
  const { data: records, error: recErr } = await admin
    .from('driver_payroll_records')
    .select('id, base_amount, status, driver_id, payout_status, driver:profiles!driver_id(full_name), items:driver_payroll_record_items(amount)')
    .eq('cycle_id', cycle_id)
    .eq('status', 'approved')
  if (recErr) {
    console.error('driver payout/initiate: load records failed', recErr)
    return NextResponse.json({ success: false, error: 'Could not load records' }, { status: 500 })
  }

  // A record already handed to the bank is not sent again — see payoutClaim.
  const approved = (records ?? []) as unknown as RecordRow[]
  const rows = approved.filter(r => !isSent(r.payout_status))
  if (rows.length === 0) {
    return NextResponse.json({
      success: false,
      error: approved.length
        ? `All ${approved.length} approved record(s) have already been sent to the bank. Mark them paid once the bank confirms.`
        : 'No approved records to disburse in this cycle',
    }, { status: 409 })
  }

  // Bank accounts for the drivers in this batch.
  const driverIds = rows.map(r => r.driver_id)
  const { data: banks } = await admin
    .from('driver_bank_accounts')
    .select('driver_id, account_holder_name, account_number, ifsc, bank_name, payout_fund_account_id')
    .in('driver_id', driverIds)
  const bankByDriver = new Map((banks ?? []).map(b => [b.driver_id, b]))

  const period = `${cycle.period_month}/${cycle.period_year}`
  const requests: PayoutRequest[] = []
  const missingBank: string[] = []
  for (const r of rows) {
    const bank = bankByDriver.get(r.driver_id)
    if (!bank) { missingBank.push(r.driver?.full_name ?? r.driver_id); continue }
    const net = Number(r.base_amount || 0) + r.items.reduce((s, i) => s + Number(i.amount || 0), 0)
    requests.push({
      reference: r.id,
      amount: net,
      bank: {
        account_holder_name: bank.account_holder_name,
        account_number: bank.account_number,
        ifsc: bank.ifsc,
        bank_name: bank.bank_name,
        payout_fund_account_id: bank.payout_fund_account_id,
      },
      note: `Driver salary ${period} — ${r.driver?.full_name ?? ''}`.trim(),
    })
  }

  if (requests.length === 0) {
    return NextResponse.json({
      success: false,
      error: `No drivers in this cycle have bank details on file${missingBank.length ? `: ${missingBank.join(', ')}` : ''}`,
    }, { status: 409 })
  }

  // Claim the records first: the update only matches rows still unsent, so
  // two racing requests can never both send the same record.
  const { data: claimedRows, error: claimErr } = await admin
    .from('driver_payroll_records')
    .update({ payout_status: 'initiated' })
    .in('id', requests.map(r => r.reference))
    .eq('status', 'approved')
    .or('payout_status.is.null,payout_status.eq.failed')
    .select('id')
  if (claimErr) {
    console.error('driver payout/initiate: claim failed', claimErr)
    return NextResponse.json({ success: false, error: 'Could not reserve the records for payment' }, { status: 500 })
  }
  const claimed = new Set((claimedRows ?? []).map(r => r.id as string))
  const toSend = requests.filter(r => claimed.has(r.reference))
  if (toSend.length === 0) {
    return NextResponse.json({ success: false, error: 'These records are already being sent to the bank.' }, { status: 409 })
  }

  // Hand the batch to the provider and reconcile each record with the result.
  const provider = getPayoutProvider(config, creds)
  let batch: Awaited<ReturnType<typeof provider.createBulkPayout>>
  try {
    batch = await provider.createBulkPayout(toSend)
  } catch (e) {
    console.error('driver payout/initiate: provider threw', e)
    await admin.from('driver_payroll_records').update({ payout_status: 'failed' }).in('id', [...claimed])
    return NextResponse.json({ success: false, error: 'The bank connection failed. Nothing was sent.' }, { status: 502 })
  }

  let initiated = 0
  const failures: string[] = []
  await reconcile(admin, 'driver_payroll_records', batch.results)
  for (const res of batch.results) {
    if (res.success) initiated++
    else if (res.error && !failures.includes(res.error)) failures.push(res.error)
  }

  // Nothing was lodged with the bank — leave the cycle open so the admin can
  // fix the configuration and retry rather than chasing a stuck 'processing'.
  if (initiated === 0) {
    return NextResponse.json({
      success: false,
      error: failures[0] ?? 'The bank did not accept any transfer in this cycle',
      errors: failures,
      total: toSend.length,
    }, { status: 502 })
  }

  // The cycle's own status is not touched here. A cycle is 'open' or
  // 'closed' and closing it is an explicit admin action; disbursement
  // state lives per-record in payout_status, which the driver tallies read.

  return NextResponse.json({
    success: true,
    initiated,
    total: toSend.length,
    skipped_no_bank: missingBank,
    provider: provider.name,
    errors: failures,
    // bank_file mode: money has not moved until the admin uploads this at the bank.
    requires_upload: batch.requiresUpload ?? false,
    file: batch.file ?? null,
  })
}
