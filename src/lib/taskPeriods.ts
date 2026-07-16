'use client'

import { fetchTimetableForStaff } from './timetable'
import { TaskSlot, TASK_SLOTS } from './taskSlots'

/**
 * Real school periods for a teacher, pulled from their published timetable
 * (Timetable app) instead of the generic fallback slot list. A config's
 * period slots are the same every working day, so this just merges +
 * dedupes the slots across every active config the teacher has entries in,
 * sorted by start time. Falls back to the static TASK_SLOTS list when the
 * teacher has no timetable entries at all (non-teaching staff, coordinators
 * without a teaching load, or the Timetable app isn't set up yet).
 */
export async function fetchTeacherPeriodSlots(teacherId: string): Promise<TaskSlot[]> {
  try {
    const views = await fetchTimetableForStaff(teacherId)
    if (views.length === 0) return TASK_SLOTS

    const seen = new Map<string, TaskSlot>()
    for (const view of views) {
      for (const slot of view.slots) {
        if (slot.is_break) continue
        if (!slot.start_time || !slot.end_time) continue
        const start = slot.start_time.slice(0, 5)
        const end = slot.end_time.slice(0, 5)
        const key = `${start}-${end}`
        if (!seen.has(key)) {
          seen.set(key, {
            label: slot.label || `Period ${slot.position}`,
            shortLabel: slot.label || `P${slot.position}`,
            start,
            end,
          })
        }
      }
    }

    const merged = Array.from(seen.values()).sort((a, b) => a.start.localeCompare(b.start))
    return merged.length > 0 ? merged : TASK_SLOTS
  } catch (err) {
    // Timetable lookup is best-effort — a network blip or an unpublished
    // timetable must never leave a caller's loading state stuck forever.
    console.error('fetchTeacherPeriodSlots failed, falling back to default slots:', err)
    return TASK_SLOTS
  }
}
