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

// ── Tab-scoped Web Locks mutex ────────────────────────────────────────────────
// Supabase rotates the refresh token on every refreshSession() call.  The one
// edge case where concurrent refreshes can still happen with sessionStorage is
// tab duplication (Ctrl+Shift+K): the duplicate starts with an identical copy
// of the original tab's sessionStorage.  If both tabs refresh at the same
// moment, the second one arrives at the server with the already-rotated
// (invalid) refresh token and is signed out.
//
// The lock is scoped to a per-tab ID (_sb_tab_id in sessionStorage) so that:
//   • Duplicate tabs share the same ID initially → they are serialised.
//   • Completely different user sessions in different tabs have different IDs
//     → they never block each other.
function getTabLockId(): string {
  if (typeof window === 'undefined') return 'ssr'
  try {
    let id = sessionStorage.getItem('_sb_tab_id')
    if (!id) {
      id = typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2) + Date.now().toString(36)
      sessionStorage.setItem('_sb_tab_id', id)
    }
    return id
  } catch {
    return 'fallback'
  }
}

function acquireSupabaseLock<R>(
  name: string,
  acquireTimeout: number,
  fn: () => Promise<R>,
): Promise<R> {
  if (typeof navigator !== 'undefined' && navigator.locks) {
    const scopedName = `${name}--${getTabLockId()}`
    return new Promise<R>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Supabase lock "${scopedName}" timed out`)),
        acquireTimeout,
      )
      navigator.locks.request(scopedName, async () => {
        clearTimeout(timer)
        try { resolve(await fn()) } catch (e) { reject(e) }
      })
    })
  }
  // Fallback for environments without Web Locks (SSR, older browsers).
  return fn()
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
