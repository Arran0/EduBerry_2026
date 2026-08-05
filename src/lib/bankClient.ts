import 'server-only'
import crypto from 'crypto'
import https from 'https'
import { URL } from 'url'
import type { BankConnection, SignatureEncoding, FieldMap } from './bankConfig'

// ============================================================
// Generic bank API client (server-only)
// ------------------------------------------------------------
// One HTTP client that speaks every auth scheme Indian corporate banking
// programmes use, driven entirely by the admin-entered BankConnection. Both
// capabilities — fee collection and salary payout — go through this, so a
// school that banks in one place is configured once per capability and no bank
// needs its own adapter file.
//
// Mutual TLS is handled with Node's https module rather than fetch, because a
// per-request client certificate cannot be attached to global fetch. Calls
// without a certificate take the plain fetch path.
//
// Never import this from client components: it carries certificate material.
// ============================================================

export interface BankCredentials {
  api_key?: string
  client_id?: string
  client_secret?: string
  oauth_audience?: string
  signing_secret?: string
  webhook_secret?: string
  client_cert_pem?: string
  client_key_pem?: string
  client_cert_passphrase?: string
  corporate_id?: string
}

export interface BankResponse {
  ok: boolean
  status: number
  /** Parsed JSON when the body was JSON, else null. */
  json: Record<string, unknown> | null
  /** Raw text, always populated — banks return XML or plain text on errors. */
  text: string
  error?: string
}

// ── Low-level transport ──────────────────────────────────────

/** POST/GET JSON over mutual TLS using Node's https (fetch cannot do per-call certs). */
function requestWithCert(
  url: string,
  method: string,
  headers: Record<string, string>,
  body: string | null,
  creds: BankCredentials,
  timeoutMs: number,
): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const req = https.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || 443,
        path: `${u.pathname}${u.search}`,
        method,
        headers,
        cert: creds.client_cert_pem,
        key: creds.client_key_pem,
        passphrase: creds.client_cert_passphrase || undefined,
        timeout: timeoutMs,
      },
      res => {
        let data = ''
        res.setEncoding('utf8')
        res.on('data', chunk => { data += chunk })
        res.on('end', () => resolve({ status: res.statusCode ?? 0, text: data }))
      },
    )
    req.on('timeout', () => { req.destroy(new Error('Request to the bank timed out')) })
    req.on('error', reject)
    if (body) req.write(body)
    req.end()
  })
}

async function requestWithFetch(
  url: string,
  method: string,
  headers: Record<string, string>,
  body: string | null,
  timeoutMs: number,
): Promise<{ status: number; text: string }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { method, headers, body, signal: controller.signal })
    return { status: res.status, text: await res.text() }
  } finally {
    clearTimeout(timer)
  }
}

// ── OAuth2 client-credentials, with a small in-process token cache ──
// Warm serverless instances reuse the token; a cold start just fetches again.
// Cached 60s short of expiry so a token never expires mid-flight.

interface CachedToken { token: string; expiresAt: number }
const tokenCache = new Map<string, CachedToken>()

async function getOAuthToken(
  conn: BankConnection,
  creds: BankCredentials,
): Promise<{ ok: boolean; token?: string; error?: string }> {
  if (!conn.oauth_token_url) return { ok: false, error: 'OAuth2 selected but no token URL is configured' }
  if (!creds.client_id || !creds.client_secret) {
    return { ok: false, error: 'OAuth2 selected but the client ID / secret are missing' }
  }

  const cacheKey = `${conn.oauth_token_url}|${creds.client_id}`
  const hit = tokenCache.get(cacheKey)
  if (hit && hit.expiresAt > Date.now()) return { ok: true, token: hit.token }

  const form = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: creds.client_id,
    client_secret: creds.client_secret,
  })
  if (conn.oauth_scope) form.set('scope', conn.oauth_scope)
  if (creds.oauth_audience) form.set('audience', creds.oauth_audience)

  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'application/json',
    // Some token endpoints want Basic auth instead of body params; sending both
    // is accepted by every scheme we have seen and saves a config toggle.
    Authorization: 'Basic ' + Buffer.from(`${creds.client_id}:${creds.client_secret}`).toString('base64'),
  }

  try {
    const useCert = conn.use_client_cert && !!creds.client_cert_pem && !!creds.client_key_pem
    const res = useCert
      ? await requestWithCert(conn.oauth_token_url, 'POST', { ...headers, 'Content-Length': String(Buffer.byteLength(form.toString())) }, form.toString(), creds, conn.timeout_ms)
      : await requestWithFetch(conn.oauth_token_url, 'POST', headers, form.toString(), conn.timeout_ms)

    if (res.status < 200 || res.status >= 300) {
      return { ok: false, error: `Token endpoint returned ${res.status}` }
    }
    const body = JSON.parse(res.text) as Record<string, unknown>
    const token = (body.access_token ?? body.accessToken ?? body.token) as string | undefined
    if (!token) return { ok: false, error: 'Token endpoint did not return an access token' }

    const expiresIn = Number(body.expires_in ?? body.expiresIn ?? 3600)
    const ttl = Number.isFinite(expiresIn) && expiresIn > 120 ? expiresIn : 3600
    tokenCache.set(cacheKey, { token, expiresAt: Date.now() + (ttl - 60) * 1000 })
    return { ok: true, token }
  } catch (e) {
    console.error('bank OAuth2 token fetch failed:', e)
    return { ok: false, error: 'Could not reach the bank token endpoint' }
  }
}

/** Drop a cached token so the next call re-authenticates (used after a 401). */
function invalidateToken(conn: BankConnection, creds: BankCredentials) {
  tokenCache.delete(`${conn.oauth_token_url}|${creds.client_id ?? ''}`)
}

// ── Signing ──────────────────────────────────────────────────

export function hmacDigest(secret: string, payload: string, encoding: SignatureEncoding): string {
  return crypto.createHmac('sha256', secret).update(payload).digest(encoding)
}

/** Constant-time compare that tolerates unequal lengths. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return crypto.timingSafeEqual(ab, bb)
}

// ── Auth header assembly ─────────────────────────────────────

async function buildAuthHeaders(
  conn: BankConnection,
  creds: BankCredentials,
  body: string,
): Promise<{ ok: boolean; headers?: Record<string, string>; error?: string }> {
  const headers: Record<string, string> = {}

  switch (conn.auth_mode) {
    case 'api_key': {
      if (!creds.api_key) return { ok: false, error: 'API key authentication is selected but no API key is saved' }
      headers[conn.api_key_header || 'x-api-key'] = creds.api_key
      break
    }
    case 'basic': {
      if (!creds.client_id || !creds.client_secret) {
        return { ok: false, error: 'Basic authentication is selected but the client ID / secret are missing' }
      }
      headers.Authorization = 'Basic ' + Buffer.from(`${creds.client_id}:${creds.client_secret}`).toString('base64')
      break
    }
    case 'oauth2': {
      const tok = await getOAuthToken(conn, creds)
      if (!tok.ok || !tok.token) return { ok: false, error: tok.error }
      headers.Authorization = `Bearer ${tok.token}`
      break
    }
    case 'hmac': {
      if (!creds.signing_secret) return { ok: false, error: 'HMAC signing is selected but no signing secret is saved' }
      const digest = hmacDigest(creds.signing_secret, body, conn.signature_encoding)
      headers[conn.signature_header || 'x-signature'] = `${conn.signature_prefix ?? ''}${digest}`
      // Banks that sign also tend to want the caller identified separately.
      if (creds.client_id) headers['x-client-id'] = creds.client_id
      break
    }
    case 'none':
      break
  }

  if (conn.use_client_cert && (!creds.client_cert_pem || !creds.client_key_pem)) {
    return { ok: false, error: 'Mutual TLS is switched on but the client certificate or key is missing' }
  }
  return { ok: true, headers }
}

// ── Public entry point ───────────────────────────────────────

export interface BankCallOptions {
  /** Path appended to the connection's base URL, or an absolute URL. */
  path: string
  method?: 'POST' | 'GET' | 'PUT'
  body?: Record<string, unknown>
  /** Retries on 5xx / network failure. Idempotent calls only. */
  retries?: number
}

/**
 * Call a bank endpoint with the configured auth, optional mutual TLS, and
 * bounded retries. Retries cover 5xx and transport failures — never 4xx, which
 * a retry cannot fix — and back off 1s, 2s, 4s. A 401 drops any cached OAuth
 * token first so an expired token self-heals on the retry.
 */
export async function callBank(
  conn: BankConnection,
  creds: BankCredentials,
  opts: BankCallOptions,
): Promise<BankResponse> {
  if (!conn.api_base_url && !opts.path.startsWith('http')) {
    return { ok: false, status: 0, json: null, text: '', error: 'No bank API base URL is configured' }
  }

  const url = opts.path.startsWith('http')
    ? opts.path
    : `${conn.api_base_url.replace(/\/+$/, '')}/${opts.path.replace(/^\/+/, '')}`
  const method = opts.method ?? 'POST'
  const bodyText = opts.body ? JSON.stringify(opts.body) : ''
  const maxAttempts = Math.max(1, (opts.retries ?? 2) + 1)

  let last: BankResponse = { ok: false, status: 0, json: null, text: '', error: 'Request was not attempted' }

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const auth = await buildAuthHeaders(conn, creds, bodyText)
    if (!auth.ok) return { ok: false, status: 0, json: null, text: '', error: auth.error }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...auth.headers,
    }
    for (const h of conn.extra_headers ?? []) {
      if (h?.key) headers[h.key] = h.value ?? ''
    }
    if (creds.corporate_id) headers['x-corporate-id'] = creds.corporate_id

    try {
      const useCert = conn.use_client_cert && !!creds.client_cert_pem && !!creds.client_key_pem
      if (useCert && bodyText) headers['Content-Length'] = String(Buffer.byteLength(bodyText))

      const res = useCert
        ? await requestWithCert(url, method, headers, bodyText || null, creds, conn.timeout_ms)
        : await requestWithFetch(url, method, headers, bodyText || null, conn.timeout_ms)

      let json: Record<string, unknown> | null = null
      try {
        const parsed = JSON.parse(res.text)
        if (parsed && typeof parsed === 'object') json = parsed as Record<string, unknown>
      } catch { /* non-JSON body — `text` still carries it for the error path */ }

      const ok = res.status >= 200 && res.status < 300
      last = {
        ok, status: res.status, json, text: res.text,
        error: ok ? undefined : (pickString(flatten(json ?? {}), ['message', 'error', 'errorMessage', 'errorDesc', 'description', 'statusDesc']) ?? `Bank returned HTTP ${res.status}`),
      }

      if (ok) return last
      if (res.status === 401 && conn.auth_mode === 'oauth2') invalidateToken(conn, creds)
      // A 4xx other than 401 is a request the bank will reject again.
      if (res.status < 500 && res.status !== 401) return last
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Network error calling the bank'
      last = { ok: false, status: 0, json: null, text: '', error: message }
    }

    if (attempt < maxAttempts - 1) {
      await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)))
    }
  }

  return last
}

// ── Payload / response helpers ───────────────────────────────

/** Apply the admin's field renames to an outgoing body. */
export function applyFieldMap(body: Record<string, unknown>, map: FieldMap): Record<string, unknown> {
  if (!map || Object.keys(map).length === 0) return body
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(body)) out[map[k] ?? k] = v
  return out
}

/** Flatten nested JSON to one level (last key wins) so lookups ignore shape. */
export function flatten(obj: unknown, out: Record<string, unknown> = {}): Record<string, unknown> {
  if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, out)
      else out[k] = v
    }
  }
  return out
}

/** First non-empty value among candidate key names, case-insensitively. */
export function pickString(flat: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = flat[k]
    if (v !== undefined && v !== null && v !== '') return String(v)
  }
  const lower = new Map(Object.entries(flat).map(([k, v]) => [k.toLowerCase(), v]))
  for (const k of keys) {
    const v = lower.get(k.toLowerCase())
    if (v !== undefined && v !== null && v !== '') return String(v)
  }
  return undefined
}

/**
 * Verify a bank callback's HMAC over the raw body. Accepts the digest with or
 * without the configured prefix, and in either encoding, because banks are
 * inconsistent about both and a rejected callback silently loses a payment.
 */
export function verifyBankSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string | undefined,
  conn: Pick<BankConnection, 'signature_encoding' | 'signature_prefix'>,
): { ok: boolean; error?: string } {
  if (!secret) return { ok: false, error: 'No webhook secret is configured' }
  if (!signatureHeader) return { ok: false, error: 'Callback carried no signature header' }

  const prefix = conn.signature_prefix ?? ''
  const received = prefix && signatureHeader.startsWith(prefix)
    ? signatureHeader.slice(prefix.length)
    : signatureHeader

  const candidates = [
    hmacDigest(secret, rawBody, conn.signature_encoding),
    hmacDigest(secret, rawBody, conn.signature_encoding === 'hex' ? 'base64' : 'hex'),
  ]
  for (const expected of candidates) {
    if (safeEqual(received.trim(), expected)) return { ok: true }
  }
  return { ok: false, error: 'Signature did not match' }
}
