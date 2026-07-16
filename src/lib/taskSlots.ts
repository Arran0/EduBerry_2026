// Shared school period/slot times used by the Task Manager's "New Task" form,
// the Weekly Calendar's quick-add picker, and the Planner import/draft feature.
// Keeping one definition avoids the three call sites drifting out of sync.

export interface TaskSlot {
  label: string
  shortLabel: string
  start: string
  end: string
}

export const TASK_SLOTS: TaskSlot[] = [
  { label: 'Slot 1',  shortLabel: 'S1',  start: '09:10', end: '09:50' },
  { label: 'Slot 2',  shortLabel: 'S2',  start: '09:50', end: '10:30' },
  { label: 'Slot 3',  shortLabel: 'S3',  start: '10:30', end: '11:20' },
  { label: 'Slot 4',  shortLabel: 'S4',  start: '11:20', end: '12:00' },
  { label: 'Slot 5',  shortLabel: 'S5',  start: '12:00', end: '12:40' },
  { label: 'Slot 6',  shortLabel: 'S6',  start: '13:10', end: '13:50' },
  { label: 'Slot 7',  shortLabel: 'S7',  start: '13:50', end: '14:30' },
  { label: 'Slot 8',  shortLabel: 'S8',  start: '14:30', end: '15:20' },
  { label: 'Slot 9',  shortLabel: 'S9',  start: '15:20', end: '16:00' },
  { label: 'Slot 10', shortLabel: 'S10', start: '16:00', end: '17:30' },
]

// Slots 5→6 have a lunch gap — treat them as non-adjacent for range purposes
export const ADJACENT_SLOTS: Record<number, number[]> = {
  0: [1], 1: [0, 2], 2: [1, 3], 3: [2, 4], 4: [3],   // morning block
  5: [6], 6: [5, 7], 7: [6, 8], 8: [7, 9], 9: [8],   // afternoon block
}

export function formatSlotTime(t: string): string {
  const [h, m] = t.split(':').map(Number)
  const ampm = h >= 12 ? 'PM' : 'AM'
  const hour = h > 12 ? h - 12 : h === 0 ? 12 : h
  return m === 0 ? `${hour} ${ampm}` : `${hour}:${String(m).padStart(2, '0')} ${ampm}`
}
