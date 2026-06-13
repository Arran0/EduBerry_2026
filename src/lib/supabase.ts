import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

// ── Persistent session storage ───────────────────────────────────────────────
// Sessions are stored in localStorage so users are automatically logged back in
// when they return to the app without having signed out — matching the behaviour
// of the EdZee tenant apps.  The session expires after Supabase's refresh-token
// lifetime (default 7 days of inactivity) or when the user explicitly signs out.
const tabStorage = typeof window !== 'undefined' ? window.localStorage : undefined

// ── Per-tab in-memory lock ────────────────────────────────────────────────────
// Replaces Supabase's default navigator.locks (Web Locks API) backend.  The
// Web Locks namespace is shared across every tab of the same origin, so when
// a tab is duplicated (Ctrl+Shift+K) both tabs race for `lock:sb-...-auth-
// token` and GoTrue's acquire-timeout logic eventually fires { steal: true },
// killing the other tab's lock and producing a blank screen + console error.
//
// A simple Promise-queue local to this JS realm (i.e. this tab) is sufficient:
// concurrent auth operations *within* a tab are serialised, and operations in
// other tabs each run their own independent queue.
//
// The auth operations that run under this lock are network-bound (token
// refresh) plus synchronous sessionStorage reads.  fetchWithTimeout (below)
// already bounds every network call AND retries a dead-socket auth refresh on a
// fresh connection, so the queue can never hang on a stale socket.
//
// IMPORTANT — why there is no short lock timeout any more:
//   The previous version raced fn() against a 5-second "lock-timeout".  After a
//   backgrounded tab returns, the token refresh runs on a dead keep-alive
//   socket; the 5 s lock timeout fired *before* fetchWithTimeout (15 s) could
//   abort + retry the refresh, so:
//     • the refresh was orphaned and never healed the session, and
//     • the rejection surfaced as the uncaught "Error: lock-timeout" seen in
//       the console, leaving every subsequent data fetch (which calls
//       getSession to attach its JWT) stranded → infinite page-level loading.
//   Bounding the work at the fetch layer instead means fn() always settles on
//   its own, so the lock just serialises and never strands the session.  A
//   generous backstop guards only against a truly pathological non-network hang.
const LOCK_BACKSTOP_MS = 30_000
let lockQueue: Promise<unknown> = Promise.resolve()
function acquireSupabaseLock<R>(
  _name: string,
  _acquireTimeout: number,
  fn: () => Promise<R>,
): Promise<R> {
  const run = () =>
    Promise.race([
      fn(),
      new Promise<never>((_, rej) =>
        setTimeout(() => rej(new Error('lock-backstop-timeout')), LOCK_BACKSTOP_MS),
      ),
    ])
  // Chain regardless of whether the previous holder resolved or rejected.
  const next = lockQueue.then(run, run)
  lockQueue = next.catch(() => {})
  return next
}

// ── Bounded fetch ─────────────────────────────────────────────────────────────
// The Supabase JS client uses the global `fetch` with NO timeout by default, so
// a single hung request can block forever.  This is exactly what happens when a
// user switches away from the tab and returns: while the tab was backgrounded
// the OS/browser tears down idle keep-alive TCP sockets (and the server closes
// idle connections too).  On return, the first data fetch is sent on a stale,
// reused socket; the request never gets a response and never errors, so it hangs
// until the OS-level TCP timeout (often minutes).
//
// Every page gates its loading spinner on a `loading` flag that is only cleared
// in a `finally { setLoading(false) }` after `await supabase...`.  A `finally`
// runs when the promise resolves OR rejects — but never when it simply hangs.
// Result: the page spins forever until the user hits refresh (which builds a
// brand-new document with brand-new connections).
//
// Fixing it: wrap fetch with an AbortController timeout so a stuck request fails
// fast (letting the page's catch/finally run instead of hanging) and then retry
// once on a fresh connection — the retry opens a brand-new socket, so a
// dead-keep-alive failure recovers transparently without the user noticing.
//
// Timeouts are deliberately short: a dead socket returns NOTHING, so there is no
// reason to wait long before giving up and retrying on a fresh connection.  Auth
// is the tightest because it gates every data fetch (each query calls getSession
// to attach its JWT); the sooner a hung refresh aborts and retries, the sooner
// the whole page unblocks.
const AUTH_TIMEOUT_MS = 6_000   // /auth/v1/* — small payloads, must heal fast
const DATA_TIMEOUT_MS = 12_000  // REST/Storage — larger payloads, cold functions

function isAuthRequest(url: string): boolean {
  return url.includes('/auth/v1/')
}

async function fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  const method = (init?.method ?? 'GET').toUpperCase()

  // What is safe to auto-retry?
  //   • Any GET — idempotent reads.
  //   • The token-refresh POST (/auth/v1/token) — a dead-socket attempt never
  //     reached the server, and even if it did, Supabase's refresh-token reuse
  //     window returns the same session for an immediate retry.  Retrying this
  //     is what actually HEALS the session on tab return; without it the first
  //     refresh dies on the stale socket and every data fetch stays stranded.
  // Other writes (announcements, uploads, …) are NOT retried to avoid
  // double-applying a mutation whose response was merely lost.
  const retryable = method === 'GET' || (isAuthRequest(url) && url.includes('/token'))
  const maxAttempts = retryable ? 2 : 1
  const timeoutMs = isAuthRequest(url) ? AUTH_TIMEOUT_MS : DATA_TIMEOUT_MS
  const callerSignal = init?.signal ?? undefined
  let lastErr: unknown

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(
      () => controller.abort(new DOMException('Request timed out', 'TimeoutError')),
      timeoutMs,
    )
    // Honour a caller-provided AbortSignal (e.g. Supabase's own .abortSignal()).
    const onCallerAbort = () => controller.abort((callerSignal as AbortSignal).reason)
    if (callerSignal) {
      if (callerSignal.aborted) controller.abort(callerSignal.reason)
      else callerSignal.addEventListener('abort', onCallerAbort, { once: true })
    }

    try {
      return await fetch(input, { ...init, signal: controller.signal })
    } catch (err) {
      lastErr = err
      // If the caller deliberately aborted, propagate immediately — don't retry.
      if (callerSignal?.aborted) throw err
      // Otherwise this was our timeout or a network error (likely a dead
      // keep-alive socket); loop to retry on a fresh connection if attempts remain.
    } finally {
      clearTimeout(timer)
      callerSignal?.removeEventListener('abort', onCallerAbort)
    }
  }

  throw lastErr
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  global: {
    fetch: fetchWithTimeout,
  },
  auth: {
    storage: tabStorage,
    lock: acquireSupabaseLock,
  },
})

// Types for our database
export type UserRole = 'student' | 'teacher' | 'coordinator' | 'principal' | 'admin' | 'driver'

export interface UserProfile {
  id: string
  email: string
  full_name: string
  role: UserRole
  avatar_url?: string
  grade?: number
  section?: string
  is_banned?: boolean
  geofence_exempt?: boolean
  created_at: string
  updated_at: string
}

export const isStaffRole = (role: UserRole): boolean => {
  return ['teacher', 'coordinator', 'principal', 'admin'].includes(role)
}

export const isAdminRole = (role: UserRole): boolean => {
  return role === 'admin'
}

// Bus drivers get a dedicated dashboard-only experience (no normal app nav).
export const isDriverRole = (role: UserRole): boolean => {
  return role === 'driver'
}

// Check if user has coordinator tag
export const isCoordinatorRole = (role: UserRole): boolean => {
  return role === 'coordinator'
}

// Check if user has principal tag
export const isPrincipalRole = (role: UserRole): boolean => {
  return role === 'principal'
}

// Check if user can see Team Analytics (all staff roles)
export const canViewTeamAnalytics = (role: UserRole): boolean => {
  return ['admin', 'coordinator', 'principal', 'teacher'].includes(role)
}

export const getRoleDisplayName = (role: UserRole): string => {
  const roleNames: Record<UserRole, string> = {
    student: 'Student',
    teacher: 'Teacher',
    coordinator: 'Coordinator',
    principal: 'Principal',
    admin: 'Administrator',
    driver: 'Driver',
  }
  return roleNames[role] || role
}

export const getRoleBadgeColor = (role: UserRole): string => {
  const colors: Record<UserRole, string> = {
    student: 'bg-mps-blue-100 text-mps-blue-700',
    teacher: 'bg-mps-green-100 text-mps-green-700',
    coordinator: 'bg-amber-100 text-amber-700',
    principal: 'bg-purple-100 text-purple-700',
    admin: 'bg-rose-100 text-rose-700',
    driver: 'bg-orange-100 text-orange-700',
  }
  return colors[role] || 'bg-gray-100 text-gray-700'
}
