import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

// ── Per-tab session storage ───────────────────────────────────────────────────
// Each browser tab stores its own Supabase session in sessionStorage so that
// different users can be logged in simultaneously across tabs without
// interfering with each other.
//
// Why not localStorage (the Supabase default)?
//   localStorage is shared across every tab of the same origin.  When User B
//   signs in from Tab 2, Supabase writes User B's tokens to localStorage and
//   fires onAuthStateChange in Tab 1 with a SIGNED_IN event for User B —
//   silently replacing User A's session in the already-open tab.  For a
//   multi-role school app (teacher + student sharing a browser) this is
//   catastrophic: every login in any tab hijacks every other open tab.
//
// sessionStorage is per-tab and survives page refreshes (F5) but is discarded
// when the tab is closed.  Opening a new tab (Ctrl+T) starts with no session;
// the user must sign in — which is the correct, safe behaviour for multi-user
// shared-browser scenarios.
const tabStorage = typeof window !== 'undefined' ? window.sessionStorage : undefined

// ── Per-tab in-memory lock ────────────────────────────────────────────────────
// Replaces Supabase's default navigator.locks (Web Locks API) backend.  The
// Web Locks namespace is shared across every tab of the same origin, so when
// a tab is duplicated (Ctrl+Shift+K) both tabs race for `lock:sb-...-auth-
// token` and GoTrue's acquire-timeout logic eventually fires { steal: true },
// killing the other tab's lock and producing a blank screen + console error.
//
// A simple Promise-queue local to this JS realm (i.e. this tab) is sufficient:
// concurrent auth operations *within* a tab are serialised, and operations in
// other tabs are completely independent — which is correct, because each tab
// keeps its own isolated session in sessionStorage.
//
// _acquireTimeout: Supabase passes the max ms to wait before giving up (-1 =
// wait forever).  We honour a 10-second cap so that a network-hung auth
// operation (e.g. a token refresh that never gets a TCP response) cannot hold
// the queue indefinitely and prevent all subsequent data fetches from running.
const LOCK_TIMEOUT_MS = 5_000
let lockQueue: Promise<unknown> = Promise.resolve()
function acquireSupabaseLock<R>(
  _name: string,
  _acquireTimeout: number,
  fn: () => Promise<R>,
): Promise<R> {
  const next = lockQueue.then(
    () => Promise.race([fn(), new Promise<never>((_, rej) => setTimeout(() => rej(new Error('lock-timeout')), LOCK_TIMEOUT_MS))]),
    () => Promise.race([fn(), new Promise<never>((_, rej) => setTimeout(() => rej(new Error('lock-timeout')), LOCK_TIMEOUT_MS))]),
  )
  lockQueue = next.catch(() => {})
  return next
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: tabStorage,
    lock: acquireSupabaseLock,
  },
})

// Types for our database
export type UserRole = 'student' | 'teacher' | 'coordinator' | 'principal' | 'admin'

export interface UserProfile {
  id: string
  email: string
  full_name: string
  role: UserRole
  avatar_url?: string
  grade?: number
  section?: string
  is_banned?: boolean
  created_at: string
  updated_at: string
}

export const isStaffRole = (role: UserRole): boolean => {
  return ['teacher', 'coordinator', 'principal', 'admin'].includes(role)
}

export const isAdminRole = (role: UserRole): boolean => {
  return role === 'admin'
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
  }
  return colors[role] || 'bg-gray-100 text-gray-700'
}
