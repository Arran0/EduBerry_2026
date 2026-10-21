// The periods a task can sit in, shared by the Task Manager's "New task" form,
// the Weekly Calendar's grid and the Planner import.
//
// Periods are numbered, not timed: the Timetable app keeps no clock times, so a
// task records its period number (tasks.period, plus tasks.period_end for a run
// of several). Only a task given a custom time carries one (tasks.timing and
// tasks.end_time).

export interface TaskPeriod {
  /** 1-based period number. */
  n: number
  label: string
  shortLabel: string
}

/** The grid's rows until the timetable has loaded, or when it has no periods. */
export const DEFAULT_PERIOD_COUNT = 8

export function taskPeriods(count: number): TaskPeriod[] {
  return Array.from({ length: Math.max(1, count) }, (_, i) => ({
    n: i + 1,
    label: `Period ${i + 1}`,
    shortLabel: `P${i + 1}`,
  }))
}

export const TASK_PERIODS = taskPeriods(DEFAULT_PERIOD_COUNT)

/** "P3", or "P3–P5" for a run. */
export function periodRangeLabel(start: number, end?: number | null): string {
  return end && end > start ? `P${start}–P${end}` : `P${start}`
}

/** "Period 3", or "Periods 3–5" for a run. */
export function periodRangeLongLabel(start: number, end?: number | null): string {
  return end && end > start ? `Periods ${start}–${end}` : `Period ${start}`
}

export function formatSlotTime(t: string): string {
  const [h, m] = t.split(':').map(Number)
  const ampm = h >= 12 ? 'PM' : 'AM'
  const hour = h > 12 ? h - 12 : h === 0 ? 12 : h
  return m === 0 ? `${hour} ${ampm}` : `${hour}:${String(m).padStart(2, '0')} ${ampm}`
}
