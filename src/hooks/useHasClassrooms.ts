import { useEffect, useState } from 'react'
import { fetchClassroomsForUser } from '@/lib/classrooms'
import { UserRole } from '@/lib/supabase'

/**
 * Whether the account belongs to at least one classroom. Returns null until
 * the check resolves, so callers can keep enrollment-gated UI (Academics nav
 * entry, homepage classroom section) hidden rather than flashing it briefly.
 */
export function useHasClassrooms(userId: string | null | undefined, role: UserRole | null | undefined): boolean | null {
  const [hasClassrooms, setHasClassrooms] = useState<boolean | null>(null)

  useEffect(() => {
    if (!userId || !role) { setHasClassrooms(null); return }
    let cancelled = false
    fetchClassroomsForUser(userId, role, false, 1).then(rows => {
      if (!cancelled) setHasClassrooms(rows.length > 0)
    })
    return () => { cancelled = true }
  }, [userId, role])

  return hasClassrooms
}
