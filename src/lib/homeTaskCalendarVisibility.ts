// Admin accounts have the task-manager weekly-calendar card hidden on the
// home page by default (an admin's own task list is rarely the point of
// their home screen). This lets them opt back in from the Task Manager page
// — stored per-account so multiple accounts on one browser don't clash.
const STORAGE_PREFIX = 'home_task_calendar_visible_'

export function getShowTaskCalendarOnHome(userId: string): boolean {
  if (typeof window === 'undefined') return false
  try {
    return localStorage.getItem(STORAGE_PREFIX + userId) === '1'
  } catch {
    return false
  }
}

export function setShowTaskCalendarOnHome(userId: string, show: boolean): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(STORAGE_PREFIX + userId, show ? '1' : '0')
  } catch {
    // ignore — preference just won't persist
  }
}
