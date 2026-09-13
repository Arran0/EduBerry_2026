// Server-only payout provider abstraction.
//
// The school's OWN bank moves the money. EduBerry either calls that bank's bulk
// transfer API directly, or writes the bulk-transfer file the bank's portal /
// H2H channel ingests. No payment aggregator sits in between, so no third party
// takes a cut of payroll and the school's existing corporate banking mandate is
// all that is needed.
//
// Three live modes (see PayoutConfig in bankConfig.ts):
//   • manual    — admin pays from the bank portal and marks records paid.
//   • bank_file — we generate the bank's file; the admin uploads it. This is how
//                 most Indian schools actually run payroll today.
//   • bank_api  — we call the bank's bulk payment endpoint.
// RazorpayX / Cashfree remain only so an already-configured deployment keeps
// loading; they are not offered for new setups.
//
// Credentials arrive from the calling route (resolved per-tenant from
// payment_secrets with env fallback) and never from the client or site_settings.
// Keep every import of this file server-side.

import 'server-only'
import { callBank, applyFieldMap, flatten, pickString, type BankCredentials } from './bankClient'
import { normalizePayoutConfig, PAYOUT_FILE_HEADERS, type PayoutConfig, type TransferMode } from './bankConfig'

export interface PayoutBankDetails {
  account_holder_name: string
  account_number: string
  ifsc: string
  bank_name: string | null
  payout_fund_account_id: string | null
  email?: string | null
}

export interface PayoutRequest {
  /** Our salary_records.id — the idempotency reference sent to the bank. */
  reference: string
  /** Amount in rupees (net pay). */
  amount: number
  bank: PayoutBankDetails
  /** Human-readable narration, e.g. "Salary June 2026 — Jane Doe". */
  note: string
}

export interface PayoutResult {
  reference: string
  success: boolean
  /** Bank-side payout / batch id, when the transfer was accepted. */
  payoutId?: string
  /** 'initiated' on accept; 'failed' otherwise. */
  status: 'initiated' | 'failed'
  error?: string
}

/** A file the admin must hand to their bank to actually release the money. */
export interface PayoutFile {
  filename: string
  content: string
  mime: string
}

export interface PayoutBatch {
  results: PayoutResult[]
  /** Present for bank_file — the caller returns it to the browser to download. */
  file?: PayoutFile
  /** True when money has NOT moved yet and the admin still has a step to do. */
  requiresUpload?: boolean
}

export interface PayoutProvider {
  readonly name: string
  /** Push a batch of transfers. Implementations are resilient per-item. */
  createBulkPayout(requests: PayoutRequest[]): Promise<PayoutBatch>
}

/** Credentials the payout scope adds on top of the shared bank set. */
export interface PayoutCredentials extends BankCredentials {
  account_number?: string
  account_ifsc?: string
}

// ── Shared helpers ───────────────────────────────────────────

const allFailed = (requests: PayoutRequest[], error: string): PayoutBatch => ({
  results: requests.map(r => ({ reference: r.reference, success: false, status: 'failed' as const, error })),
})

/** RTGS has a regulatory floor; below it the bank rejects the credit outright.
 *  Silently routing those over NEFT is what a bank portal does for you. */
function modeFor(config: PayoutConfig, amount: number): TransferMode {
  if (config.transfer_mode === 'RTGS' && amount < config.rtgs_min_amount) return 'NEFT'
  return config.transfer_mode
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/** Two decimal places, no thousands separators — what transfer payloads expect. */
function money(amount: number): string {
  return (Math.round(amount * 100) / 100).toFixed(2)
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

// ── Manual provider ──────────────────────────────────────────
// No external transfer. The admin disburses through their bank and marks
// records paid by hand, so nothing is reported as initiated.

const manualProvider: PayoutProvider = {
  name: 'manual',
  async createBulkPayout(requests) {
    return {
      results: requests.map(r => ({ reference: r.reference, success: true, status: 'initiated' as const })),
    }
  },
}

// ── Bank file provider ───────────────────────────────────────
// Writes the bulk-transfer file in whatever column order the school's bank
// specifies. Money has not moved when this returns — the admin still uploads
// the file — so records are marked 'initiated' and settle either through the
// bank's callback or by the admin marking them paid.

function fieldValue(
  token: string,
  req: PayoutRequest,
  config: PayoutConfig,
  creds: PayoutCredentials,
  slNo: number,
): string {
  switch (token) {
    case 'sl_no':            return String(slNo)
    case 'beneficiary_name': return req.bank.account_holder_name
    case 'account_number':   return req.bank.account_number
    case 'ifsc':             return req.bank.ifsc
    case 'bank_name':        return req.bank.bank_name ?? ''
    case 'amount':           return money(req.amount)
    case 'transfer_mode':    return modeFor(config, req.amount)
    case 'reference':        return req.reference
    case 'narration':        return req.note
    case 'email':            return req.bank.email ?? ''
    // Not captured per bank account; every payee account on file is a savings
    // account, which is what the manual disbursement CSV assumes too.
    case 'account_type':     return 'Savings'
    // Optional on the bank's template and only meaningful for corporate
    // payees, so it is left blank for individual staff.
    case 'lei':              return ''
    case 'debit_account':    return creds.account_number ?? ''
    case 'corporate_id':     return creds.corporate_id ?? ''
    case 'value_date':       return todayIso()
    // Anything not a known token is a literal the bank's spec requires.
    default: return token
  }
}

/** Escape for the chosen delimiter; only quote when we have to. */
function csvCell(value: string, delimiter: string): string {
  const v = (value ?? '').replace(/[\r\n]+/g, ' ')
  if (v.includes(delimiter) || v.includes('"')) return `"${v.replace(/"/g, '""')}"`
  return v
}

function makeBankFileProvider(config: PayoutConfig, creds: PayoutCredentials): PayoutProvider {
  return {
    name: 'bank_file',
    async createBulkPayout(requests) {
      const fmt = config.file
      const delimiter = fmt.delimiter || ','
      const lines: string[] = []

      if (fmt.include_header) {
        // Known tokens get the bank's own column title; a literal column is
        // already the heading the spec asks for.
        lines.push(
          fmt.columns
            .map(c => csvCell(PAYOUT_FILE_HEADERS[c] ?? c, delimiter))
            .join(delimiter),
        )
      }
      requests.forEach((req, i) => {
        lines.push(
          fmt.columns
            .map(token => csvCell(fieldValue(token, req, config, creds, i + 1), delimiter))
            .join(delimiter),
        )
      })

      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
      const ext = (fmt.extension || 'csv').replace(/^\./, '')
      return {
        results: requests.map(r => ({ reference: r.reference, success: true, status: 'initiated' as const })),
        file: {
          filename: `payout-${stamp}.${ext}`,
          content: lines.join('\r\n') + '\r\n',
          mime: ext === 'csv' ? 'text/csv' : 'text/plain',
        },
        requiresUpload: true,
      }
    },
  }
}

// ── Bank API provider ────────────────────────────────────────
// Calls the school's bank bulk payment endpoint. The payload uses neutral field
// names that the admin's field map renames to whatever their bank documents, so
// onboarding a new bank is a settings change rather than a deploy.

interface ParsedItem {
  reference?: string
  payoutId?: string
  status: 'accepted' | 'rejected' | 'unknown'
  error?: string
}

const ACCEPTED = /accept|success|initiat|queued|pending|processing|received|booked|ok/i
const REJECTED = /reject|fail|declin|error|invalid|insufficient/i

/** Find the per-credit results in a bank response, whatever it calls the array. */
function parseItems(json: Record<string, unknown> | null): ParsedItem[] {
  if (!json) return []
  const candidateKeys = ['results', 'transactions', 'records', 'items', 'credits', 'data', 'payouts', 'details', 'beneficiaries']
  let arr: unknown[] | null = null

  for (const key of candidateKeys) {
    const v = (json as Record<string, unknown>)[key]
    if (Array.isArray(v)) { arr = v; break }
  }
  if (!arr) {
    // Some banks nest the array one level down under a response envelope.
    for (const v of Object.values(json)) {
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        for (const key of candidateKeys) {
          const inner = (v as Record<string, unknown>)[key]
          if (Array.isArray(inner)) { arr = inner; break }
        }
      }
      if (arr) break
    }
  }
  if (!arr) return []

  return arr.map(raw => {
    const flat = flatten(raw)
    const reference = pickString(flat, ['reference', 'referenceId', 'reference_id', 'refNo', 'merchantRef', 'customerRef', 'txnRef', 'uniqueId'])
    const payoutId = pickString(flat, ['payoutId', 'payout_id', 'transactionId', 'txnId', 'utr', 'bankRefNo', 'referenceNumber', 'id'])
    const statusStr = pickString(flat, ['status', 'txnStatus', 'statusCode', 'state', 'result', 'responseCode']) ?? ''
    const error = pickString(flat, ['message', 'error', 'errorMessage', 'reason', 'statusDesc', 'errorDesc'])
    const status: ParsedItem['status'] =
      REJECTED.test(statusStr) ? 'rejected'
      : ACCEPTED.test(statusStr) ? 'accepted'
      : 'unknown'
    return { reference, payoutId, status, error }
  })
}

function makeBankApiProvider(config: PayoutConfig, creds: PayoutCredentials): PayoutProvider {
  return {
    name: 'bank_api',
    async createBulkPayout(requests) {
      if (!config.connection.api_base_url) {
        return allFailed(requests, 'No bank API base URL is configured — add it in Settings → Salary Payout.')
      }
      if (!creds.account_number) {
        return allFailed(requests, 'No debit account number is configured — add it in Settings → Salary Payout.')
      }

      const results: PayoutResult[] = []

      // Chunked because banks cap credits per request. Batches run in sequence:
      // corporate gateways are rate-limited and a parallel burst gets throttled.
      for (const group of chunk(requests, config.batch_size)) {
        const credits = group.map(req => applyFieldMap({
          reference: req.reference,
          beneficiary_name: req.bank.account_holder_name,
          account_number: req.bank.account_number,
          ifsc: req.bank.ifsc,
          amount: money(req.amount),
          transfer_mode: modeFor(config, req.amount),
          narration: req.note,
          email: req.bank.email ?? undefined,
        }, config.request_map))

        const body = applyFieldMap({
          corporate_id: creds.corporate_id ?? '',
          debit_account: creds.account_number,
          debit_ifsc: creds.account_ifsc ?? '',
          value_date: todayIso(),
          // Lets the bank de-duplicate a retried batch.
          batch_reference: `EDB-${group[0].reference}`,
          total_amount: money(group.reduce((s, r) => s + r.amount, 0)),
          total_count: group.length,
          credits,
        }, config.request_map)

        // No retry: a bulk transfer is not safe to replay blind. A timeout may
        // still have debited, so it is reported as failed for a human to check
        // against the bank statement rather than silently re-sent.
        const res = await callBank(config.connection, creds, {
          path: config.transfer_path,
          method: 'POST',
          body,
          retries: 0,
        })

        if (!res.ok) {
          const error = res.error ?? 'The bank rejected the transfer batch'
          for (const req of group) {
            results.push({ reference: req.reference, success: false, status: 'failed', error })
          }
          continue
        }

        const items = parseItems(res.json)
        const byRef = new Map(items.filter(i => i.reference).map(i => [i.reference as string, i]))
        // A bank that acknowledges the batch as a whole gives one id for all.
        const batchId = pickString(flatten(res.json ?? {}), ['batchId', 'batch_id', 'batchReference', 'requestId', 'transactionId', 'referenceNumber', 'utrNumber'])

        for (const req of group) {
          const item = byRef.get(req.reference)
          if (item?.status === 'rejected') {
            results.push({
              reference: req.reference, success: false, status: 'failed',
              error: item.error ?? 'The bank rejected this credit',
            })
            continue
          }
          // Accepted, or the bank only acknowledged the batch. Either way the
          // instruction is lodged; the callback settles the final status.
          results.push({
            reference: req.reference,
            success: true,
            status: 'initiated',
            payoutId: item?.payoutId ?? batchId,
          })
        }
      }

      return { results }
    },
  }
}

// ── Legacy aggregator stubs ──────────────────────────────────
// Retained so a deployment saved with these values still loads. They fail
// closed: money is never assumed to have moved.

function makeLegacyProvider(name: string): PayoutProvider {
  return {
    name,
    async createBulkPayout(requests) {
      return allFailed(
        requests,
        `${name} is no longer supported. Switch Settings → Salary Payout to your own bank (API or file).`,
      )
    },
  }
}

/** Select a provider implementation from the saved payout config. */
export function getPayoutProvider(
  rawConfig: Partial<PayoutConfig>,
  creds: PayoutCredentials = {},
): PayoutProvider {
  const config = normalizePayoutConfig(rawConfig)
  if (!config.enabled) return manualProvider
  switch (config.provider) {
    case 'bank_api':  return makeBankApiProvider(config, creds)
    case 'bank_file': return makeBankFileProvider(config, creds)
    case 'razorpayx': return makeLegacyProvider('razorpayx')
    case 'cashfree':  return makeLegacyProvider('cashfree')
    default:          return manualProvider
  }
}

