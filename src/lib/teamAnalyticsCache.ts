import { fetchTeamAnalytics } from './tasks'
import { UserProfile, UserRole } from './supabase'

export interface MemberStats {
  user: UserProfile
  stats: {
    completed: number
    bonus: number
    overdue: number
    total: number
    completionRate: number
  }
}

export interface AnalyticsEntry {
  members: MemberStats[]
  teamCompletionRate: number
}

/**
 * Module-level cache for the Task Manager's Team tab.
 *
 * The Team tab is conditionally rendered, so TeamAnalytics fully unmounts when
 * the user switches tabs and remounts when they return — discarding any
 * component-instance (useRef) cache and forcing a full refetch every visit.
 * Hoisting the cache to module scope lets it survive remounts: re-entering the
 * Team tab (or revisiting an already-loaded month) paints instantly.
 *
 * This lives in lib/ rather than inside TeamAnalytics.tsx so the tasks page can
 * import prefetchTeamAnalytics for its tab-hover warm-up without eagerly
 * pulling in the component itself, which is otherwise loaded on demand.
 */
export const analyticsCache = new Map<string, AnalyticsEntry>()

export const analyticsCacheKey = (userId: string, month: string) => `${userId}:${month}`

export const toMonthParam = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`

/**
 * Warm the current month into the cache ahead of mount (e.g. on tab hover) so
 * the Team section can paint without a spinner when it's opened.
 */
export async function prefetchTeamAnalytics(userId: string, userRole: UserRole) {
  const month = toMonthParam(new Date())
  const key = analyticsCacheKey(userId, month)
  if (analyticsCache.has(key)) return
  const data = await fetchTeamAnalytics(userId, userRole, month)
  // Only cache meaningful results — an empty payload is indistinguishable from
  // a fetch failure, and caching it would suppress the spinner on real load.
  if (data.members.length > 0) analyticsCache.set(key, data)
}
