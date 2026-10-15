import { useEffect, useState } from 'react'
import { fetchClassroomsForUser } from '@/lib/classrooms'
import { UserRole } from '@/lib/supabase'

/* The last answer per account, kept for the life of the tab.
   Every page renders its own ProtectedLayout, so the Navbar (and this hook
   inside it) is torn down and remounted on each navigation. Starting from
   `null` every time meant the Academics entry dropped out of the bar for the
   length of a round trip on every click, and the items either side of it —
   Task Manager most visibly, being its neighbour — slid across to fill the gap
   and back. Seeding from the previous answer keeps the bar still; the probe
   still re-runs underneath and corrects it if enrolment has changed. */
const lastAnswer = new Map<string, boolean>()

/**
 * Whether the account belongs to at least one classroom. Returns null until
 * the check first resolves for this account, so callers can keep
 * enrollment-gated UI (Academics nav entry, homepage classroom section) hidden
 * rather than flashing it briefly.
 */
export function useHasClassrooms(userId: string | null | undefined, role: UserRole | null | undefined): boolean | null {
  const key = userId && role ? `${userId}:${role}` : null
  const [hasClassrooms, setHasClassrooms] = useState<boolean | null>(
    () => (key ? lastAnswer.get(key) ?? null : null),
  )

  useEffect(() => {
    if (!userId || !role || !key) { setHasClassrooms(null); return }
    let cancelled = false
    if (lastAnswer.has(key)) setHasClassrooms(lastAnswer.get(key)!)
    fetchClassroomsForUser(userId, role, false, 1).then(rows => {
      lastAnswer.set(key, rows.length > 0)
      if (!cancelled) setHasClassrooms(rows.length > 0)
    })
    return () => { cancelled = true }
  }, [userId, role, key])

  return hasClassrooms
}
