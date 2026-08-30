import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { requireCapability } from '@/lib/fees/serverGuard'
import { auditFeeAction } from '@/lib/fees/audit'
import {
  buildTallyEnvelope, buildZohoCsv, TallyExportError,
  type TallyVoucher, type ZohoRow,
} from '@/lib/fees/accounting/tally'

// Export a period's collections and refunds for Tally or Zoho Books.
//
// The source is the LEDGER, not the fee table or the receipt table. That is the
// point: what a school's accounts should reflect is money that moved, and the
// ledger is the only record of that which cannot have been edited. A refund
// therefore appears as a Payment voucher of its own rather than reducing the
// receipt it reverses, which is both what actually happened and what makes the
// export reconcile against a bank statement line by line.
//
// A live API integration with either product is deliberately out of scope: both
// need per-school credentials (Tally's HTTP listener on the school's own
// network, Zoho's OAuth), so this produces a file the accountant imports. When
// those credentials exist the same builders serve a push integration unchanged.

export const runtime = 'nodejs'
export const maxDuration = 300

interface LedgerRow {
  id: string
  kind: string
  direction: string
  amount: number
  method: string | null
  gateway: string | null
  gateway_payment_id: string | null
  utr: string | null
  occurred_at: string
  fee_id: string | null
  student_id: string | null
  note: string | null
}

/** Where the money sits when it is not a fee head — configurable per school. */
const DEFAULT_BANK_LEDGER = 'Bank Account'
const DEFAULT_CASH_LEDGER = 'Cash'
const DEFAULT_INCOME_LEDGER = 'Fee Income'

export async function POST(request: NextRequest) {
  const guard = await requireCapability(request, 'export_accounting')
  if (!guard.ok) return guard.response
  const { db, userId } = guard.actor

  const body = await request.json().catch(() => ({}))
  const format: 'tally' | 'zoho' = body.format === 'zoho' ? 'zoho' : 'tally'
  const from: string | undefined = body.from
  const to: string | undefined = body.to
  if (!from || !to) return bad('from and to dates are required')

  let q = db
    .from('fee_transactions')
    .select('id, kind, direction, amount, method, gateway, gateway_payment_id, utr, occurred_at, fee_id, student_id, note')
    .gte('occurred_at', from)
    .lte('occurred_at', to)
    .order('occurred_at', { ascending: true })
    .limit(50000)

  if (body.source) q = q.eq('source', body.source)

  const { data, error } = await q
  if (error) {
    console.error('accounting/export: read failed', error)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  const rows = (data ?? []) as unknown as LedgerRow[]
  if (!rows.length) {
    return NextResponse.json({ success: false, error: `No money moved between ${from} and ${to}.` }, { status: 404 })
  }

  const [ledgerNames, studentNames, receipts, settings] = await Promise.all([
    resolveHeadLedgers(db, rows),
    resolveStudentNames(db, rows),
    resolveReceiptNos(db, rows),
    resolveSettings(db),
  ])

  if (format === 'zoho') {
    const csv = buildZohoCsv(rows.map(r => toZohoRow(r, ledgerNames, studentNames, receipts, settings)))
    await logExport(db, userId, request, 'zoho', rows.length, from, to)
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="fees-zoho-${from}-to-${to}.csv"`,
      },
    })
  }

  try {
    const xml = buildTallyEnvelope({
      companyName: body.company_name || settings.companyName,
      vouchers: rows.map(r => toTallyVoucher(r, ledgerNames, studentNames, receipts, settings)),
    })
    await logExport(db, userId, request, 'tally', rows.length, from, to)
    return new NextResponse(xml, {
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Content-Disposition': `attachment; filename="fees-tally-${from}-to-${to}.xml"`,
      },
    })
  } catch (e) {
    // These messages are written to be read by the person running the export;
    // they explain what to fix rather than what threw.
    if (e instanceof TallyExportError) {
      return NextResponse.json({ success: false, error: e.message }, { status: 400 })
    }
    console.error('accounting/export: build failed', e)
    return NextResponse.json({ success: false, error: 'Could not build the export.' }, { status: 500 })
  }
}

interface Settings {
  companyName: string
  bankLedger: string
  cashLedger: string
  incomeLedger: string
}

function toTallyVoucher(
  r: LedgerRow,
  ledgers: Map<string, string>,
  names: Map<string, string>,
  receipts: Map<string, string>,
  s: Settings,
): TallyVoucher {
  const isRefund = r.direction === 'debit'
  const money = ledgers.get(r.fee_id ?? '') ?? s.incomeLedger
  return {
    // A refund is a Payment voucher, never a negative Receipt — see tally.ts.
    kind: isRefund ? 'payment' : 'receipt',
    date: r.occurred_at,
    voucherNo: receipts.get(r.id) ?? shortRef(r),
    narration: r.note ?? (isRefund ? 'Fee refund' : 'Fee collection'),
    bankLedger: r.method === 'cash' ? s.cashLedger : s.bankLedger,
    amount: Number(r.amount),
    lines: [{ ledger: money, amount: Number(r.amount) }],
    partyLedger: r.student_id ? names.get(r.student_id) : undefined,
  }
}

function toZohoRow(
  r: LedgerRow,
  ledgers: Map<string, string>,
  names: Map<string, string>,
  receipts: Map<string, string>,
  s: Settings,
): ZohoRow {
  const isRefund = r.direction === 'debit'
  return {
    date: r.occurred_at,
    receiptNo: receipts.get(r.id) ?? shortRef(r),
    customerName: (r.student_id && names.get(r.student_id)) || 'Unknown',
    account: ledgers.get(r.fee_id ?? '') ?? s.incomeLedger,
    description: r.note ?? (isRefund ? 'Fee refund' : 'Fee collection'),
    // Zoho has no direction column on a payment import, so a refund carries a
    // negative amount. Unlike Tally, that is the shape Zoho expects.
    amount: isRefund ? -Number(r.amount) : Number(r.amount),
    paymentMode: prettyMethod(r.method),
    reference: r.gateway_payment_id ?? r.utr ?? '',
  }
}

/** A ledger row with no receipt still needs a stable voucher number. */
function shortRef(r: LedgerRow): string {
  return `TXN-${r.id.slice(0, 8).toUpperCase()}`
}

function prettyMethod(method: string | null): string {
  switch (method) {
    case 'cash': return 'Cash'
    case 'cheque': return 'Check'
    case 'card': return 'Credit Card'
    case 'bank': case 'bank_transfer': return 'Bank Transfer'
    case 'upi_qr': case 'upi': return 'UPI'
    case 'razorpay': return 'Online'
    default: return method ? method.replace(/_/g, ' ') : 'Other'
  }
}

/**
 * The Tally/Zoho account each fee posts to, from the head's gl_code. Falling
 * back to the head NAME is deliberate — a school that has not filled in codes
 * usually named its Tally ledgers after its fee heads anyway, and the export
 * refuses outright rather than posting to a blank one.
 */
async function resolveHeadLedgers(
  db: Parameters<typeof auditFeeAction>[0],
  rows: LedgerRow[],
): Promise<Map<string, string>> {
  const feeIds = [...new Set(rows.map(r => r.fee_id).filter((id): id is string => !!id))]
  const out = new Map<string, string>()
  if (!feeIds.length) return out

  for (let i = 0; i < feeIds.length; i += 500) {
    const { data } = await db
      .from('school_fees')
      .select('id, fee_head:fee_heads!fee_head_id(name, gl_code)')
      .in('id', feeIds.slice(i, i + 500))

    type Row = { id: string; fee_head: { name?: string; gl_code?: string } | { name?: string; gl_code?: string }[] | null }
    for (const raw of (data ?? []) as unknown as Row[]) {
      const head = Array.isArray(raw.fee_head) ? raw.fee_head[0] : raw.fee_head
      const ledger = head?.gl_code?.trim() || head?.name?.trim()
      if (ledger) out.set(raw.id, ledger)
    }
  }
  return out
}

async function resolveStudentNames(
  db: Parameters<typeof auditFeeAction>[0],
  rows: LedgerRow[],
): Promise<Map<string, string>> {
  const ids = [...new Set(rows.map(r => r.student_id).filter((id): id is string => !!id))]
  const out = new Map<string, string>()
  for (let i = 0; i < ids.length; i += 500) {
    const { data } = await db.from('profiles').select('id, full_name').in('id', ids.slice(i, i + 500))
    for (const p of data ?? []) out.set(p.id as string, p.full_name as string)
  }
  return out
}

/** The school's own receipt number is the voucher number the accountant looks for. */
async function resolveReceiptNos(
  db: Parameters<typeof auditFeeAction>[0],
  rows: LedgerRow[],
): Promise<Map<string, string>> {
  const txnIds = rows.map(r => r.id)
  const out = new Map<string, string>()
  for (let i = 0; i < txnIds.length; i += 500) {
    const { data } = await db
      .from('fee_receipts')
      .select('transaction_id, receipt_no')
      .in('transaction_id', txnIds.slice(i, i + 500))
      .eq('status', 'issued')
    for (const r of data ?? []) out.set(r.transaction_id as string, r.receipt_no as string)
  }
  return out
}

async function resolveSettings(db: Parameters<typeof auditFeeAction>[0]): Promise<Settings> {
  const [brandingRes, accountingRes] = await Promise.all([
    db.from('site_settings').select('value').eq('key', 'branding').maybeSingle(),
    db.from('site_settings').select('value').eq('key', 'fee_accounting').maybeSingle(),
  ])
  const branding = (brandingRes.data?.value ?? {}) as { schoolName?: string }
  const acc = (accountingRes.data?.value ?? {}) as {
    company_name?: string; bank_ledger?: string; cash_ledger?: string; income_ledger?: string
  }
  return {
    companyName: acc.company_name || branding.schoolName || '',
    bankLedger: acc.bank_ledger || DEFAULT_BANK_LEDGER,
    cashLedger: acc.cash_ledger || DEFAULT_CASH_LEDGER,
    incomeLedger: acc.income_ledger || DEFAULT_INCOME_LEDGER,
  }
}

async function logExport(
  db: Parameters<typeof auditFeeAction>[0],
  userId: string,
  request: NextRequest,
  format: string,
  count: number,
  from: string,
  to: string,
) {
  // An export leaves the building with student names and amounts in it, so it
  // is itself a fee-affecting action worth recording.
  await auditFeeAction(db, {
    actorId: userId,
    action: 'accounting.export',
    entityType: 'fee_transaction',
    summary: `Exported ${count} ledger entries to ${format} for ${from} – ${to}`,
    after: { format, count, from, to },
    request,
  })
}

function bad(error: string) {
  return NextResponse.json({ success: false, error }, { status: 400 })
}
