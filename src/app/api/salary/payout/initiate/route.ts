import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getPayoutProvider, PayoutRequest, PayoutCredentials } from '@/lib/payoutProvider'
import { normalizePayoutConfig, type PayoutConfig } from '@/lib/bankConfig'
import { getPaymentSecrets } from '@/lib/serverSecrets'

// Initiates bank disbursement for the approved records in a cycle. Admin-only.
// Since cycles cover staff and bus drivers alike, this one route disburses both.
//
// The school's own bank moves the money: either its bulk transfer API is called
// (bank_api) or its bulk-upload file is generated for the admin to submit
// (bank_file). When disbursement is disabled or set to 'manual', this is a no-op
// and the admin pays from the bank portal, marking records paid by hand.
//
// Required env: SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_SUPABASE_URL.

interface RecordRow {
  id: string
  base_amount: number
  status: string
  staff_id: string
  pay_by_cash: boolean
  staff: { full_name: string; is_banned: boolean } | null
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
    .from('salary_cycles').select('id, period_month, period_year').eq('id', cycle_id).single()
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

  // Only approved records are eligible for disbursement. Rows marked paid by
  // cash are dropped before the bank batch is built — that person isn't
  // getting a bank transfer this cycle regardless of what's on file for them.
  // So is anyone who has resigned (banned) or been hidden from the salary app
  // since this cycle was approved — a row approved before either happened
  // must not still trigger a real bank transfer once it has.
  const [{ data: records, error: recErr }, { data: hiddenRow }] = await Promise.all([
    admin
      .from('salary_records')
      .select('id, base_amount, status, staff_id, pay_by_cash, staff:profiles!staff_id(full_name, is_banned), items:salary_record_items(amount)')
      .eq('cycle_id', cycle_id)
      .eq('status', 'approved'),
    admin.from('site_settings').select('value').eq('key', 'salary_hidden_members').maybeSingle(),
  ])
  if (recErr) {
    console.error('payout/initiate: load records failed', recErr)
    return NextResponse.json({ success: false, error: 'Could not load records' }, { status: 500 })
  }
  const hiddenIds = (hiddenRow?.value as { ids?: unknown } | null)?.ids
  const hidden = new Set(Array.isArray(hiddenIds) ? hiddenIds.filter((id): id is string => typeof id === 'string') : [])

  const rows = ((records ?? []) as unknown as RecordRow[])
    .filter(r => !r.pay_by_cash && !r.staff?.is_banned && !hidden.has(r.staff_id))
  if (rows.length === 0) {
    return NextResponse.json({ success: false, error: 'No approved records to disburse in this cycle' }, { status: 409 })
  }

  // Bank accounts for the staff in this batch.
  const staffIds = rows.map(r => r.staff_id)
  const { data: banks } = await admin
    .from('staff_bank_accounts')
    .select('staff_id, account_holder_name, account_number, ifsc, bank_name, payout_fund_account_id')
    .in('staff_id', staffIds)
  const bankByStaff = new Map((banks ?? []).map(b => [b.staff_id, b]))

  const period = `${cycle.period_month}/${cycle.period_year}`
  const requests: PayoutRequest[] = []
  const missingBank: string[] = []
  for (const r of rows) {
    const bank = bankByStaff.get(r.staff_id)
    if (!bank) { missingBank.push(r.staff?.full_name ?? r.staff_id); continue }
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
      note: `Salary ${period} — ${r.staff?.full_name ?? ''}`.trim(),
    })
  }

  if (requests.length === 0) {
    return NextResponse.json({
      success: false,
      error: `No staff in this cycle have bank details on file${missingBank.length ? `: ${missingBank.join(', ')}` : ''}`,
    }, { status: 409 })
  }

  // Hand the batch to the provider and reconcile each record with the result.
  const provider = getPayoutProvider(config, creds)
  const batch = await provider.createBulkPayout(requests)

  let initiated = 0
  const failures: string[] = []
  for (const res of batch.results) {
    await admin.from('salary_records').update({
      payout_status: res.status,
      payout_reference: res.payoutId ?? null,
    }).eq('id', res.reference)
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
      total: requests.length,
    }, { status: 502 })
  }

  // The cycle's own status is not touched here. A cycle is 'open' or
  // 'closed' and closing it is an explicit admin action; disbursement
  // state lives per-record in payout_status, which the salary tallies read.

  return NextResponse.json({
    success: true,
    initiated,
    total: requests.length,
    skipped_no_bank: missingBank,
    provider: provider.name,
    errors: failures,
    // bank_file mode: money has not moved until the admin uploads this at the bank.
    requires_upload: batch.requiresUpload ?? false,
    file: batch.file ?? null,
  })
}
