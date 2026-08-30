// ============================================================================
// Tally import XML.
// ----------------------------------------------------------------------------
// Tally imports through an XML envelope posted to its HTTP listener or opened
// from Gateway → Import Data. This module builds that envelope. It is pure —
// string in, string out — so the format is testable without a Tally instance,
// which matters because the format is unforgiving and the failure mode is a
// silent partial import.
//
// ── The three things Tally is strict about ──────────────────────────────────
//
//   1. Ledger names must already exist in the company, spelled identically.
//      Tally matches on the NAME, not on any id. So a fee head's gl_code is
//      used as the ledger name where it is set, and the head's own name is the
//      fallback — and the export refuses to run rather than guessing when a
//      head has neither, because a voucher posted to a mistyped ledger silently
//      creates a new one and nobody notices for a quarter.
//
//   2. Dates are YYYYMMDD with no separators.
//
//   3. Amounts are signed by DIRECTION, and the signs are inverted from what
//      most people expect: in Tally's model a debit is negative and a credit is
//      positive on the LEDGERENTRIES list. A receipt debits the bank/cash
//      ledger and credits the fee income ledger.
//
// A refund is a Payment voucher, not a negative Receipt. Tally will accept a
// negative receipt and it will reconcile, but it makes every collection report
// in Tally itself wrong, and the school's accountant will be the one to find
// out.
// ============================================================================

export interface TallyVoucherLine {
  /** Tally ledger name — from fee_heads.gl_code, else the head's name. */
  ledger: string
  amount: number
}

export interface TallyVoucher {
  kind: 'receipt' | 'payment'
  /** ISO date. */
  date: string
  /** The school's own receipt number — Tally shows it as the voucher number. */
  voucherNo: string
  /** Free text on the voucher. */
  narration: string
  /** Bank or cash ledger the money moved through. */
  bankLedger: string
  amount: number
  lines: TallyVoucherLine[]
  /** Optional party ledger, where the school keeps one per student. */
  partyLedger?: string
}

export class TallyExportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TallyExportError'
  }
}

/** Tally wants YYYYMMDD. */
export function tallyDate(iso: string): string {
  return iso.slice(0, 10).replace(/-/g, '')
}

/**
 * XML escaping. Tally's parser is not lenient, and a student named
 * "D'Souza & Co" or a narration containing "<" will break the whole envelope
 * rather than one voucher.
 */
export function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function amount(n: number): string {
  return n.toFixed(2)
}

function ledgerEntry(ledger: string, value: number, isDeemedPositive: boolean): string {
  return [
    '          <ALLLEDGERENTRIES.LIST>',
    `            <LEDGERNAME>${esc(ledger)}</LEDGERNAME>`,
    `            <ISDEEMEDPOSITIVE>${isDeemedPositive ? 'Yes' : 'No'}</ISDEEMEDPOSITIVE>`,
    `            <AMOUNT>${amount(value)}</AMOUNT>`,
    '          </ALLLEDGERENTRIES.LIST>',
  ].join('\n')
}

export function buildVoucher(v: TallyVoucher): string {
  const type = v.kind === 'receipt' ? 'Receipt' : 'Payment'
  const date = tallyDate(v.date)

  // A receipt: money INTO the bank (debit, deemed positive) and OUT of the
  // income ledgers (credit). A payment is the mirror.
  const bankIsDebit = v.kind === 'receipt'
  const entries: string[] = [ledgerEntry(v.bankLedger, bankIsDebit ? -v.amount : v.amount, bankIsDebit)]

  for (const line of v.lines) {
    entries.push(ledgerEntry(line.ledger, bankIsDebit ? line.amount : -line.amount, !bankIsDebit))
  }

  return [
    `      <TALLYMESSAGE xmlns:UDF="TallyUDF">`,
    `        <VOUCHER VCHTYPE="${type}" ACTION="Create" OBJVIEW="Accounting Voucher View">`,
    `          <DATE>${date}</DATE>`,
    `          <EFFECTIVEDATE>${date}</EFFECTIVEDATE>`,
    `          <VOUCHERTYPENAME>${type}</VOUCHERTYPENAME>`,
    `          <VOUCHERNUMBER>${esc(v.voucherNo)}</VOUCHERNUMBER>`,
    v.partyLedger ? `          <PARTYLEDGERNAME>${esc(v.partyLedger)}</PARTYLEDGERNAME>` : null,
    `          <NARRATION>${esc(v.narration)}</NARRATION>`,
    `          <ISINVOICE>No</ISINVOICE>`,
    entries.join('\n'),
    `        </VOUCHER>`,
    `      </TALLYMESSAGE>`,
  ].filter(Boolean).join('\n')
}

export interface TallyEnvelopeOptions {
  /** Must match the company name in Tally exactly, or the import goes nowhere. */
  companyName: string
  vouchers: TallyVoucher[]
}

export function buildTallyEnvelope(opts: TallyEnvelopeOptions): string {
  if (!opts.companyName.trim()) {
    throw new TallyExportError(
      'A Tally company name is required, and it must match the company in Tally exactly — an import addressed to the wrong name is accepted and silently does nothing.',
    )
  }
  if (!opts.vouchers.length) {
    throw new TallyExportError('There is nothing to export for this period.')
  }

  const missing = opts.vouchers.flatMap(v =>
    v.lines.filter(l => !l.ledger.trim()).map(() => v.voucherNo),
  )
  if (missing.length) {
    throw new TallyExportError(
      `${missing.length} voucher line${missing.length === 1 ? ' has' : 's have'} no Tally ledger name. Set a ledger account on every fee head before exporting — Tally creates a new ledger for an unrecognised name rather than rejecting it, so this would go unnoticed.`,
    )
  }

  return [
    '<ENVELOPE>',
    '  <HEADER>',
    '    <TALLYREQUEST>Import Data</TALLYREQUEST>',
    '  </HEADER>',
    '  <BODY>',
    '    <IMPORTDATA>',
    '      <REQUESTDESC>',
    '        <REPORTNAME>Vouchers</REPORTNAME>',
    '        <STATICVARIABLES>',
    `          <SVCURRENTCOMPANY>${esc(opts.companyName)}</SVCURRENTCOMPANY>`,
    '        </STATICVARIABLES>',
    '      </REQUESTDESC>',
    '      <REQUESTDATA>',
    opts.vouchers.map(buildVoucher).join('\n'),
    '      </REQUESTDATA>',
    '    </IMPORTDATA>',
    '  </BODY>',
    '</ENVELOPE>',
  ].join('\n')
}

// ── Zoho Books ──────────────────────────────────────────────────────────────
// Zoho imports CSV and is far more forgiving than Tally, but it matches its
// account column against the chart of accounts by name too. Same gl_code, same
// requirement.

export interface ZohoRow {
  date: string
  receiptNo: string
  customerName: string
  account: string
  description: string
  amount: number
  paymentMode: string
  reference: string
}

const ZOHO_HEADERS = [
  'Date', 'Payment Number', 'Customer Name', 'Account',
  'Description', 'Amount', 'Payment Mode', 'Reference Number',
] as const

/** RFC-4180 quoting: a student name with a comma must not shift every column. */
function csvCell(value: string | number): string {
  const s = String(value ?? '')
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function buildZohoCsv(rows: ZohoRow[]): string {
  const lines = [ZOHO_HEADERS.join(',')]
  for (const r of rows) {
    lines.push([
      r.date.slice(0, 10),
      r.receiptNo,
      r.customerName,
      r.account,
      r.description,
      r.amount.toFixed(2),
      r.paymentMode,
      r.reference,
    ].map(csvCell).join(','))
  }
  return lines.join('\r\n')
}
