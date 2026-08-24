'use client'

import { fetchConfigs, fetchPeriodSlots } from './timetable'
import { TaskSlot, TASK_SLOTS } from './taskSlots'

/**
 * Real school periods from the currently active Timetable config(s) —
 * count, labels and timings all come from there, regardless of whether any
 * particular teacher has published entries in it (a fresh/empty timetable
 * still defines the school's period structure). Merges + dedupes period
 * slots across every active config, breaks excluded, sorted by start time.
 * Falls back to the static TASK_SLOTS list only when no config is active
 * at all (Timetable app not set up yet).
 */
export async function fetchActiveTimetablePeriodSlots(): Promise<TaskSlot[]> {
  try {
    const configs = await fetchConfigs()
    const activeConfigs = configs.filter(c => c.is_active)
    if (activeConfigs.length === 0) return TASK_SLOTS

    const slotLists = await Promise.all(activeConfigs.map(c => fetchPeriodSlots(c.id)))

    const seen = new Map<string, TaskSlot>()
    for (const slots of slotLists) {
      let teachingPosition = 0
      for (const slot of slots) {
        if (slot.is_break) continue
        teachingPosition += 1
        if (!slot.start_time || !slot.end_time) continue
        const start = slot.start_time.slice(0, 5)
        const end = slot.end_time.slice(0, 5)
        const key = `${start}-${end}`
        if (!seen.has(key)) {
          seen.set(key, {
            label: slot.label || `Period ${teachingPosition}`,
            shortLabel: slot.label || `P${teachingPosition}`,
            start,
            end,
          })
        }
      }
    }

    const merged = Array.from(seen.values()).sort((a, b) => a.start.localeCompare(b.start))
    return merged.length > 0 ? merged : TASK_SLOTS
  } catch (err) {
    // Timetable lookup is best-effort — a network blip or unset-up Timetable
    // app must never leave a caller's loading state stuck forever.
    console.error('fetchActiveTimetablePeriodSlots failed, falling back to default slots:', err)
    return TASK_SLOTS
  }
}
