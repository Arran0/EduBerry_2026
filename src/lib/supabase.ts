import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

// Cross-tab token-refresh lock using the Web Locks API.
// Supabase rotates the refresh token on every refreshSession() call; without a
// cross-process lock, two tabs refreshing at the same moment will race — the
// second tab's call arrives at the server with the already-rotated (and
// therefore invalid) old refresh token, causing a spurious SIGNED_OUT event.
// The Web Locks API provides a true cross-tab mutex that serialises the refresh
// so only one tab can rotate the token at a time.
function acquireSupabaseLock(
  name: string,
  acquireTimeout: number,
  fn: () => Promise<unknown>,
): Promise<unknown> {
  if (typeof navigator !== 'undefined' && navigator.locks) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Supabase lock "${name}" timed out`)),
        acquireTimeout,
      )
      navigator.locks.request(name, async () => {
        clearTimeout(timer)
        try { resolve(await fn()) } catch (e) { reject(e) }
      })
    })
  }
  // Fallback for environments without Web Locks (e.g. SSR, older browsers).
  return fn()
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    // Use localStorage (the Supabase default) so all tabs share the same session.
    // With sessionStorage, opening a second tab copies the refresh token; when
    // one tab rotates it the other tab's copy is invalidated, causing spurious
    // "session expired" sign-outs on the other tab.
    storage: typeof window !== 'undefined' ? window.localStorage : undefined,
    // Serialize token refreshes across tabs so that only one tab at a time
    // contacts the auth server.  See acquireSupabaseLock above.
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
