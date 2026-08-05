import { supabase } from './supabase'

// ============================================================
// Bank connection configuration (site_settings)
// ------------------------------------------------------------
// EduBerry talks to a school's OWN bank (Indian Bank, HDFC, ICICI, Axis,
// Kotak, SBI …) rather than to a payment aggregator. Every Indian corporate
// banking programme exposes the same two capabilities under different names:
//
//   • COLLECTION — the bank allots a virtual account / virtual VPA per fee (or
//     matches on a unique reference in the UPI note) and calls a webhook when
//     money lands. Sold as "Smart Collect", "Virtual Account", "eCollect",
//     "Corporate VAN", "Easy Collect" …
//   • PAYOUT — a bulk NEFT / RTGS / IMPS transfer API (or an H2H file drop)
//     that debits the school's current account and credits staff accounts.
//     Sold as "Bulk Payment", "Corporate Payment API", "H2H", "Payment
//     Initiation" …
//
// The wire formats differ per bank but the SHAPE is always the same: a base
// URL, an auth scheme, a couple of identifiers, an endpoint path, a JSON body
// whose field names vary, and an HMAC-signed webhook. So instead of writing a
// bespoke adapter per bank, everything that varies is CONFIGURATION an admin
// enters in Settings, and the request/response field names are remappable — a
// new bank is onboarded without a code change or redeploy.
//
// SPLIT OF STORAGE — this matters:
//   • site_settings   is WORLD-READABLE (it carries branding). Only
//                     non-sensitive operational config goes here.
//   • payment_secrets is ADMIN-ONLY (no public SELECT policy). Every
//                     credential, certificate and account number goes here —
//                     see src/lib/paymentSecrets.ts.
// ============================================================

// ── Auth schemes ─────────────────────────────────────────────
// Covers what Indian corporate banking APIs actually use in practice.

export type BankAuthMode =
  | 'api_key'      // static key in a header (bank names the header)
  | 'basic'        // HTTP Basic — client_id:client_secret
  | 'oauth2'       // OAuth2 client-credentials; token fetched and cached
  | 'hmac'         // per-request HMAC signature over the body
  | 'none'         // mTLS-only: the client certificate IS the credential

export const BANK_AUTH_MODES: { value: BankAuthMode; label: string; hint: string }[] = [
  { value: 'api_key', label: 'API key header',      hint: 'A static key sent in a header the bank names (e.g. x-api-key).' },
  { value: 'basic',   label: 'HTTP Basic',          hint: 'Client ID and secret sent as a Basic auth header.' },
  { value: 'oauth2',  label: 'OAuth2 (client credentials)', hint: 'App exchanges client ID + secret for a short-lived token.' },
  { value: 'hmac',    label: 'HMAC request signing', hint: 'Each request body is signed with a shared secret.' },
  { value: 'none',    label: 'Client certificate only', hint: 'Mutual TLS — the certificate is the only credential.' },
]

/** Encoding a bank uses for HMAC digests, on both outgoing and incoming calls. */
export type SignatureEncoding = 'hex' | 'base64'

/** Rails available for a credit. INTRA is a same-bank internal transfer — free
 *  or near-free at most banks, so it is worth preferring when staff bank with
 *  the school's own bank. */
export type TransferMode = 'NEFT' | 'RTGS' | 'IMPS' | 'INTRA'

export const TRANSFER_MODES: { value: TransferMode; label: string; hint: string }[] = [
  { value: 'NEFT',  label: 'NEFT',  hint: 'Batch-settled. The usual choice for monthly payroll.' },
  { value: 'RTGS',  label: 'RTGS',  hint: 'Real-time gross settlement. For high-value transfers; banks apply a minimum amount.' },
  { value: 'IMPS',  label: 'IMPS',  hint: 'Instant, 24x7. Usually costs more per transfer.' },
  { value: 'INTRA', label: 'Same-bank transfer', hint: 'Internal credit when the payee banks with you. Cheapest and fastest.' },
]

/** A header the bank requires that is not a secret (version pins, channel ids). */
export interface BankHeader {
  key: string
  value: string
}

/**
 * How to reach a bank's API. Shared by the collection and payout configs so a
 * school that banks in one place fills this in once per capability.
 *
 * Everything here is NON-SECRET and lives in world-readable site_settings.
 * Credentials for these modes live in payment_secrets.
 */
export interface BankConnection {
  /** Display label — 'Indian Bank', 'HDFC Bank'. Shown in admin screens only. */
  bank_name: string
  /** API root, no trailing slash: 'https://api.example-bank.co.in/corporate/v1'. */
  api_base_url: string
  auth_mode: BankAuthMode
  /** Header carrying the API key when auth_mode = 'api_key'. */
  api_key_header: string
  /** Token endpoint when auth_mode = 'oauth2'. Absolute URL. */
  oauth_token_url: string
  /** Optional scope requested at the token endpoint. */
  oauth_scope: string
  /** Header carrying the per-request signature when auth_mode = 'hmac'. */
  signature_header: string
  signature_encoding: SignatureEncoding
  /** Some banks prefix the digest, e.g. 'sha256='. Compared/stripped verbatim. */
  signature_prefix: string
  /** Non-secret headers the bank requires on every call. */
  extra_headers: BankHeader[]
  /** Send the client certificate from payment_secrets (mutual TLS). */
  use_client_cert: boolean
  /** Per-request timeout in ms. Bank gateways are slower than PSPs. */
  timeout_ms: number
}

export const BANK_CONNECTION_DEFAULTS: BankConnection = {
  bank_name: '',
  api_base_url: '',
  auth_mode: 'api_key',
  api_key_header: 'x-api-key',
  oauth_token_url: '',
  oauth_scope: '',
  signature_header: 'x-signature',
  signature_encoding: 'hex',
  signature_prefix: '',
  extra_headers: [],
  use_client_cert: false,
  timeout_ms: 30000,
}

/** Fill in any field a stored row is missing, so older rows keep working. */
export function normalizeConnection(v: Partial<BankConnection> | null | undefined): BankConnection {
  const raw = v ?? {}
  return {
    ...BANK_CONNECTION_DEFAULTS,
    ...raw,
    // Guard the fields whose type the UI depends on.
    extra_headers: Array.isArray(raw.extra_headers) ? raw.extra_headers.filter(h => h && typeof h.key === 'string') : [],
    timeout_ms: Number(raw.timeout_ms) > 0 ? Number(raw.timeout_ms) : BANK_CONNECTION_DEFAULTS.timeout_ms,
    api_base_url: (raw.api_base_url ?? '').replace(/\/+$/, ''),
  }
}

// ── Field mapping ────────────────────────────────────────────
// The one thing that genuinely differs bank to bank is the JSON key names. A
// mapping keeps that in config: `{ "amount": "txnAmount" }` renames the field
// we send. Reading responses and webhooks is done by trying a list of likely
// names, so unmapped banks usually work untouched — the mapping is the escape
// hatch when they don't.

export type FieldMap = Record<string, string>

/** Parse the admin's advanced JSON box; invalid JSON degrades to no mapping. */
export function parseFieldMap(raw: string): { map: FieldMap; error?: string } {
  const text = (raw ?? '').trim()
  if (!text) return { map: {} }
  try {
    const parsed = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { map: {}, error: 'Field mapping must be a JSON object.' }
    }
    const map: FieldMap = {}
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === 'string' && v.trim()) map[k] = v.trim()
    }
    return { map }
  } catch {
    return { map: {}, error: 'Field mapping is not valid JSON.' }
  }
}

// ============================================================
// Collection config — how fees are received
// ============================================================

/**
 * • reference       — one school VPA; each fee carries a unique reference in
 *                     the UPI note and the bank posts a webhook on receipt.
 *                     Needs no API call, so it works with a plain current
 *                     account plus webhook access.
 * • virtual_vpa     — the bank allots a unique UPI VPA per fee.
 * • virtual_account — the bank allots a unique account number + IFSC per fee,
 *                     so parents can also pay by NEFT/IMPS from any bank.
 */
export type CollectMode = 'reference' | 'virtual_vpa' | 'virtual_account'

export const COLLECT_MODES: { value: CollectMode; label: string; hint: string }[] = [
  { value: 'reference',       label: 'Reference matching',  hint: 'One school UPI ID; each fee carries a unique reference. No API call needed.' },
  { value: 'virtual_vpa',     label: 'Virtual UPI ID',      hint: 'The bank allots a unique UPI ID per fee. Matched on the VPA paid to.' },
  { value: 'virtual_account', label: 'Virtual account',     hint: 'The bank allots an account number + IFSC per fee, so NEFT/IMPS works too.' },
]

export interface BankCollectConfig {
  enabled: boolean
  mode: CollectMode
  connection: BankConnection
  /** Path appended to api_base_url to allot a virtual VPA / account. */
  allocate_path: string
  /** Renames on the allocation request body. */
  request_map: FieldMap
}

export const BANK_COLLECT_DEFAULTS: BankCollectConfig = {
  enabled: false,
  mode: 'reference',
  connection: BANK_CONNECTION_DEFAULTS,
  allocate_path: '/virtual-accounts',
  request_map: {},
}

export async function fetchBankCollectConfig(): Promise<BankCollectConfig> {
  const { data } = await supabase.from('site_settings').select('value').eq('key', 'bank_collect_config').maybeSingle()
  return normalizeCollectConfig(data?.value as Partial<BankCollectConfig> | null)
}

export function normalizeCollectConfig(v: Partial<BankCollectConfig> | null | undefined): BankCollectConfig {
  const raw = v ?? {}
  return {
    enabled: raw.enabled ?? false,
    mode: raw.mode ?? 'reference',
    connection: normalizeConnection(raw.connection),
    allocate_path: raw.allocate_path || BANK_COLLECT_DEFAULTS.allocate_path,
    request_map: (raw.request_map && typeof raw.request_map === 'object') ? raw.request_map : {},
  }
}

/**
 * Whether fee auto-reconciliation is live, and in which mode — checking the
 * direct bank config first and falling back to the legacy Smart Collect config.
 *
 * The payment modals use this rather than reading either config directly, so a
 * school that switches to a direct bank connection immediately gets the
 * self-confirming payment flow instead of the declare-and-wait one.
 */
export async function fetchCollectStatus(): Promise<{ enabled: boolean; mode: CollectMode }> {
  const { data } = await supabase
    .from('site_settings')
    .select('key, value')
    .in('key', ['bank_collect_config', 'smart_collect_config'])

  const rows = new Map((data ?? []).map(r => [r.key as string, r.value as Record<string, unknown> | null]))

  const bank = normalizeCollectConfig(rows.get('bank_collect_config') as Partial<BankCollectConfig> | null)
  if (bank.enabled) return { enabled: true, mode: bank.mode }

  const legacy = (rows.get('smart_collect_config') ?? {}) as { enabled?: boolean; mode?: CollectMode }
  return { enabled: legacy.enabled ?? false, mode: legacy.mode ?? 'reference' }
}

export async function saveBankCollectConfig(config: BankCollectConfig): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase
    .from('site_settings')
    .upsert({ key: 'bank_collect_config', value: config as unknown as Record<string, unknown> }, { onConflict: 'key' })
  if (error) { console.error('saveBankCollectConfig failed:', error); return { success: false, error: error.message } }
  return { success: true }
}

// ============================================================
// Presets
// ============================================================
// Starting points that fill in the shape of a bank's programme — the auth
// scheme and header names it is documented to use. The base URL, endpoint
// paths and credentials always come from the school's own sanctioned
// onboarding pack, because banks issue per-corporate URLs and there is no
// public sandbox to infer them from. A preset is a head start, never a
// substitute for the bank's integration document.

export interface BankPreset {
  id: string
  label: string
  connection: Partial<BankConnection>
  note: string
}

export const BANK_PRESETS: BankPreset[] = [
  {
    id: 'generic_api_key',
    label: 'Generic — API key',
    connection: { auth_mode: 'api_key', api_key_header: 'x-api-key', signature_header: 'x-signature', signature_encoding: 'hex' },
    note: 'Start here if your bank issued a single API key and a webhook secret.',
  },
  {
    id: 'generic_oauth2',
    label: 'Generic — OAuth2 + mutual TLS',
    connection: { auth_mode: 'oauth2', use_client_cert: true, signature_header: 'x-signature', signature_encoding: 'base64' },
    note: 'Common for large-bank corporate APIs: a token endpoint plus a client certificate.',
  },
  {
    id: 'generic_hmac',
    label: 'Generic — HMAC signed requests',
    connection: { auth_mode: 'hmac', signature_header: 'x-signature', signature_encoding: 'hex' },
    note: 'Every request body is signed with a shared secret; no token exchange.',
  },
  {
    id: 'file_handoff',
    label: 'File hand-off (H2H / portal upload)',
    connection: { auth_mode: 'none' },
    note: 'No API. EduBerry generates the transfer file and you upload it in your bank portal.',
  },
]

// ============================================================
// Payout config — how salaries leave the school's account
// ============================================================

/**
 * • manual    — no integration. Admin pays from their bank portal and marks
 *               records paid. Always available, and the safe default.
 * • bank_file — EduBerry generates the bank's bulk-transfer file; the admin
 *               uploads it in the corporate portal or drops it on the bank's
 *               H2H/SFTP path. This is how a large share of Indian schools
 *               actually run payroll, so it is a first-class mode, not manual.
 * • bank_api  — EduBerry calls the bank's bulk transfer API directly.
 * • razorpayx / cashfree — legacy aggregator options, kept so existing
 *               deployments keep loading. Not offered for new setups.
 */
export type PayoutProviderId = 'manual' | 'bank_file' | 'bank_api' | 'razorpayx' | 'cashfree'

export const PAYOUT_PROVIDERS: { value: PayoutProviderId; label: string; hint: string }[] = [
  { value: 'manual',    label: 'Manual',                 hint: 'Pay from your bank portal and mark records paid here.' },
  { value: 'bank_file', label: 'Bank file (H2H / upload)', hint: 'Generate your bank’s bulk-transfer file and upload it in the corporate portal.' },
  { value: 'bank_api',  label: 'Bank API (direct)',      hint: 'Send transfers straight to your bank’s bulk payment API.' },
]

/** Column layouts differ per bank, so the file writer is driven by config:
 *  the admin pastes the column order from their bank's file spec. */
export interface PayoutFileFormat {
  /** 'csv' or 'txt' — separator follows from this unless delimiter is set. */
  extension: string
  delimiter: string
  /** Emit a header row. Many bank specs explicitly forbid one. */
  include_header: boolean
  /**
   * Column order. Each entry is one of the tokens below, or any literal text
   * which is emitted verbatim (useful for constant columns a spec requires):
   *   beneficiary_name, account_number, ifsc, amount, transfer_mode,
   *   reference, narration, email, debit_account, corporate_id, value_date
   */
  columns: string[]
}

export const PAYOUT_FILE_DEFAULTS: PayoutFileFormat = {
  extension: 'csv',
  delimiter: ',',
  include_header: true,
  columns: ['beneficiary_name', 'account_number', 'ifsc', 'amount', 'transfer_mode', 'reference', 'narration'],
}

/** Tokens the file writer substitutes per row; anything else is a literal. */
export const PAYOUT_FILE_TOKENS = [
  'beneficiary_name', 'account_number', 'ifsc', 'amount', 'transfer_mode',
  'reference', 'narration', 'email', 'debit_account', 'corporate_id', 'value_date',
] as const

export interface PayoutConfig {
  enabled: boolean
  provider: PayoutProviderId
  /** Public client/consumer identifier. Secrets never live here. */
  key_id: string
  transfer_mode: TransferMode
  /** Fall back to NEFT when an amount is below the bank's RTGS floor. */
  rtgs_min_amount: number
  connection: BankConnection
  /** Path appended to api_base_url for a bulk transfer (bank_api). */
  transfer_path: string
  /** Optional path to poll a batch's status (bank_api). Blank disables polling. */
  status_path: string
  /** Max credits per request; banks cap batch size. */
  batch_size: number
  /** Renames on the transfer request body. */
  request_map: FieldMap
  file: PayoutFileFormat
}

export const PAYOUT_CONFIG_DEFAULTS: PayoutConfig = {
  enabled: false,
  provider: 'manual',
  key_id: '',
  transfer_mode: 'NEFT',
  rtgs_min_amount: 200000,
  connection: BANK_CONNECTION_DEFAULTS,
  transfer_path: '/payments/bulk',
  status_path: '',
  batch_size: 50,
  request_map: {},
  file: PAYOUT_FILE_DEFAULTS,
}

export function normalizePayoutConfig(v: Partial<PayoutConfig> | null | undefined): PayoutConfig {
  const raw = v ?? {}
  const file: Partial<PayoutFileFormat> = (raw.file && typeof raw.file === 'object') ? raw.file : {}
  return {
    enabled: raw.enabled ?? false,
    provider: raw.provider ?? 'manual',
    key_id: raw.key_id ?? '',
    transfer_mode: raw.transfer_mode ?? 'NEFT',
    rtgs_min_amount: Number(raw.rtgs_min_amount) >= 0 ? Number(raw.rtgs_min_amount) : PAYOUT_CONFIG_DEFAULTS.rtgs_min_amount,
    connection: normalizeConnection(raw.connection),
    transfer_path: raw.transfer_path || PAYOUT_CONFIG_DEFAULTS.transfer_path,
    status_path: raw.status_path ?? '',
    batch_size: Number(raw.batch_size) > 0 ? Number(raw.batch_size) : PAYOUT_CONFIG_DEFAULTS.batch_size,
    request_map: (raw.request_map && typeof raw.request_map === 'object') ? raw.request_map : {},
    file: {
      ...PAYOUT_FILE_DEFAULTS,
      ...file,
      columns: Array.isArray(file.columns) && file.columns.length > 0 ? file.columns : PAYOUT_FILE_DEFAULTS.columns,
    },
  }
}

export async function fetchPayoutConfig(): Promise<PayoutConfig> {
  const { data } = await supabase.from('site_settings').select('value').eq('key', 'payout_config').maybeSingle()
  return normalizePayoutConfig(data?.value as Partial<PayoutConfig> | null)
}

export async function savePayoutConfig(config: PayoutConfig): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase
    .from('site_settings')
    .upsert({ key: 'payout_config', value: config as unknown as Record<string, unknown> }, { onConflict: 'key' })
  if (error) { console.error('savePayoutConfig failed:', error); return { success: false, error: error.message } }
  return { success: true }
}

/** Fields every bank programme issues, surfaced so an admin knows what to ask
 *  their relationship manager for. Rendered as a checklist in Settings. */
export const ONBOARDING_CHECKLIST: { field: string; why: string }[] = [
  { field: 'API base URL (UAT and production)', why: 'Banks issue a per-corporate host; it is never guessable.' },
  { field: 'Corporate / customer ID', why: 'Identifies the school on every request.' },
  { field: 'API key, or OAuth client ID + secret', why: 'Authenticates the app to the bank.' },
  { field: 'Client TLS certificate + key + passphrase', why: 'Most corporate APIs require mutual TLS.' },
  { field: 'Debit account number', why: 'The current account payouts are funded from.' },
  { field: 'Webhook / callback secret', why: 'Lets the app verify that a callback really came from the bank.' },
  { field: 'IP allowlisting for your app', why: 'Banks reject calls from unregistered source IPs.' },
  { field: 'Endpoint paths + sample request/response', why: 'Field names differ per bank; the sample drives the mapping.' },
  { field: 'Per-batch and per-day transfer limits', why: 'Determines how payroll is chunked.' },
]
