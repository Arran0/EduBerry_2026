import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

// ── Persistent session storage ───────────────────────────────────────────────
// Sessions live in localStorage (shared by every tab of this browser profile)
// so the user stays signed in across tabs, reloads and browser restarts.  The
// session only ends when the user explicitly signs out or the refresh token
// finally expires (Supabase's refresh-token lifetime — days of inactivity).
const authStorage = typeof window !== 'undefined' ? window.localStorage : undefined

// The localStorage key GoTrue writes the session to.  Exported so AuthContext
// can watch it with a `storage` event listener and mirror sign-in / sign-out /
// account switches that happened in another tab (GoTrue itself only emits
// onAuthStateChange inside the tab that performed the action).
export const AUTH_STORAGE_KEY = `sb-${
  supabaseUrl.split('//')[1]?.split('.')[0] ?? 'local'
}-auth-token`

// ── Cross-tab auth lock ───────────────────────────────────────────────────────
// The session is shared between tabs, and so is the refresh-token chain: each
// refresh rotates the token and invalidates the previous one.  If two tabs
// refresh at the same time, the loser sends an already-rotated token, GoTrue
// answers "Invalid Refresh Token: Already Used" — a NON-retryable error — and
// auth-js responds by deleting the session.  That is an unprompted sign-out,
// so the lock protecting a refresh has to span every tab, not just this one.
//
// Supabase's own navigator.locks backend is cross-tab but gives up after
// `acquireTimeout` and re-acquires with { steal: true }, which yanks the lock
// out from under whichever tab is mid-refresh (the blank-screen + console error
// seen when a tab is duplicated).  So we use the Web Locks API directly and
// simply *wait* instead of stealing: every operation under this lock is bounded
// by fetchWithTimeout below, so the holder always settles and the queue always
// drains.  A generous backstop guards only against a pathological non-network
// hang, and Web-Locks-less environments fall back to a per-realm promise queue.
const LOCK_BACKSTOP_MS = 30_000

function withBackstop<R>(fn: () => Promise<R>): Promise<R> {
  return Promise.race([
    fn(),
    new Promise<never>((_, rej) =>
      setTimeout(() => rej(new Error('lock-backstop-timeout')), LOCK_BACKSTOP_MS),
    ),
  ])
}

// Fallback for browsers/environments without the Web Locks API (e.g. Safari in
// some private modes, SSR): serialise within this JS realm only.
let lockQueue: Promise<unknown> = Promise.resolve()
function queuedLock<R>(fn: () => Promise<R>): Promise<R> {
  const run = () => withBackstop(fn)
  // Chain regardless of whether the previous holder resolved or rejected.
  const next = lockQueue.then(run, run)
  lockQueue = next.catch(() => {})
  return next
}

async function acquireSupabaseLock<R>(
  name: string,
  _acquireTimeout: number,
  fn: () => Promise<R>,
): Promise<R> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined
  if (!locks) return queuedLock(fn)
  // No `steal`, no `ifAvailable`: wait our turn, then run bounded work.
  return (await locks.request(name, { mode: 'exclusive' }, () => withBackstop(fn))) as R
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
  const isTokenRefresh = isAuthRequest(url) && url.includes('/token')
  const retryable = method === 'GET' || isTokenRefresh
  // The token refresh gets an extra attempt: it is the one request whose final
  // failure can cost the user their session, and each attempt opens a fresh
  // socket, so a dead keep-alive or a single flaky response is survivable.
  const maxAttempts = isTokenRefresh ? 3 : retryable ? 2 : 1
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
    // Explicit rather than relying on defaults: these three are what keep the
    // user signed in.  persistSession writes the session to localStorage,
    // autoRefreshToken rotates the access token in the background (including
    // right after the tab becomes visible again), and storageKey pins the key
    // that AuthContext watches for cross-tab account changes.
    storage: authStorage,
    storageKey: AUTH_STORAGE_KEY,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    lock: acquireSupabaseLock,
  },
})

// Types for our database
export type UserRole = 'student' | 'teacher' | 'coordinator' | 'principal' | 'admin' | 'driver' | 'smartboard'

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
  attendance_hidden?: boolean
  // Cosmetic-only flag: a 'teacher' account displayed as "Non-Teaching" (e.g.
  // office staff, librarians). Grants no different permissions than a teacher —
  // see supabase-migrations/add_non_teaching_staff_flag.sql for why.
  is_non_teaching?: boolean
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

// Smart boards get a dedicated dashboard-only experience (no normal app nav),
// opened on the homeroom's physical board for most of the school day.
export const isSmartboardRole = (role: UserRole): boolean => {
  return role === 'smartboard'
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

export const getRoleDisplayName = (role: UserRole, isNonTeaching?: boolean): string => {
  if (role === 'teacher' && isNonTeaching) return 'Non-Teaching'
  const roleNames: Record<UserRole, string> = {
    student: 'Student',
    teacher: 'Teacher',
    coordinator: 'Coordinator',
    principal: 'Principal',
    admin: 'Administrator',
    driver: 'Driver',
    smartboard: 'Smart Board',
  }
  return roleNames[role] || role
}

export const getRoleBadgeColor = (role: UserRole, isNonTeaching?: boolean): string => {
  if (role === 'teacher' && isNonTeaching) return 'bg-cyan-100 text-cyan-700'
  const colors: Record<UserRole, string> = {
    student: 'bg-mps-blue-100 text-mps-blue-700',
    teacher: 'bg-mps-green-100 text-mps-green-700',
    coordinator: 'bg-amber-100 text-amber-700',
    principal: 'bg-purple-100 text-purple-700',
    admin: 'bg-rose-100 text-rose-700',
    driver: 'bg-orange-100 text-orange-700',
    smartboard: 'bg-indigo-100 text-indigo-700',
  }
  return colors[role] || 'bg-gray-100 text-gray-700'
}
