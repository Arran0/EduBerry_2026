// Admin/principal accounts have the "Classrooms" section hidden on the home
// page by default (it duplicates the Academics page for roles that rarely
// need the shortcut). This lets them opt back in from the Academics page —
// stored per-account so multiple accounts on one browser don't clash.
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
