// The home page's classroom-button grid is hidden by default — home leads with
// the day's work, and the same buttons are one tap away on Academics. The
// Academics classrooms heading carries a home toggle that opts back in.
// Stored per-account so multiple accounts on one browser don't clash, and
// mirrors homeTaskCalendarVisibility (same storage shape, same default-off
// reading of a missing key).
const STORAGE_PREFIX = 'home_classrooms_visible_'

export function getShowClassroomsOnHome(userId: string): boolean {
  if (typeof window === 'undefined') return false
  try {
    return localStorage.getItem(STORAGE_PREFIX + userId) === '1'
  } catch {
    return false
  }
}

export function setShowClassroomsOnHome(userId: string, show: boolean): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(STORAGE_PREFIX + userId, show ? '1' : '0')
  } catch {
    // ignore — preference just won't persist
  }
}
