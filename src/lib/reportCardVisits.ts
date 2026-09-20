// Which students' report cards this account opened, and when — the staff side
// of the Academics report-card digest ("recently opened"), where a student sees
// their own latest cards instead.
//
// Only ids and timestamps are stored, never names: the list is hydrated from
// `profiles` on render, so a renamed or removed student can't linger in a
// browser's local storage. Keyed by viewer so two accounts sharing a browser
// keep separate lists (mirrors homeTaskCalendarVisibility's per-account key).
const STORAGE_PREFIX = 'report_card_visits_'

/** Ids kept per viewer. A digest shows a handful; the rest are the tail that
 *  survives a few visits to other students before dropping off. */
const MAX_RECENT = 12

type VisitMap = Record<string, number>

function readVisits(viewerId: string): VisitMap {
  if (typeof window === 'undefined') return {}
  try {
    return JSON.parse(localStorage.getItem(STORAGE_PREFIX + viewerId) ?? '{}') as VisitMap
  } catch {
    return {}
  }
}

/** Records that `viewerId` just opened `studentId`'s report cards. */
export function recordReportCardVisit(viewerId: string, studentId: string): void {
  if (typeof window === 'undefined') return
  if (!viewerId || !studentId || viewerId === studentId) return
  try {
    const visits = readVisits(viewerId)
    visits[studentId] = Date.now()

    // Keep the map from growing without bound across a school year.
    const trimmed: VisitMap = {}
    for (const [id, at] of Object.entries(visits).sort((a, b) => b[1] - a[1]).slice(0, MAX_RECENT)) {
      trimmed[id] = at
    }
    localStorage.setItem(STORAGE_PREFIX + viewerId, JSON.stringify(trimmed))
  } catch {
    // ignore — the recent list just won't update
  }
}

/** Student ids `viewerId` opened, most recent first. */
export function getRecentReportCardStudentIds(viewerId: string, limit = 6): string[] {
  if (!viewerId) return []
  return Object.entries(readVisits(viewerId))
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id]) => id)
}
