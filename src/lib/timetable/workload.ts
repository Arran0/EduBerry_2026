// ============================================================
// Teacher workload — the arithmetic behind "this will never fit".
//
// A teacher assigned more periods than their week has is the commonest way a
// timetable becomes unsolvable, and it is pure arithmetic: it can be known the
// moment the requirement is typed, long before anything is generated. This
// module computes it from requirements alone, so the answer is available at the
// point the mistake is made rather than after a failed solve.
//
// UI-free and pure.
// ============================================================

import { buildSchedules, scheduleFor } from './generator'
import { cellKey } from './constraints'
import { teacherIdsOf } from './types'
import type {
  CombinedClassInput, PeriodSlot, Requirement, SlotGroup, TimetableConfig,
  TimetableConstraint, Weekday,
} from './types'

export interface TeacherWorkloadItem {
  homeroomId: string
  subjectId: string
  periods: number
  /** True for a combined lesson, which is taught once for several classes. */
  combined: boolean
}

export interface TeacherWorkload {
  teacherId: string
  /** Periods a week this teacher is required to teach. */
  assigned: number
  /** Periods their week physically has, after their own time off. */
  capacity: number
  /** Periods removed from the week by this teacher's time-off constraints. */
  timeOff: number
  /** How many periods over capacity — 0 when they fit. */
  over: number
  /** A max-per-week limit set on this teacher, when it is the binding one. */
  weeklyCap: number | null
  /** Most periods they could teach in one day, after time off. */
  busiestDayCapacity: number
  items: TeacherWorkloadItem[]
}

/**
 * One id per wall-clock period, so two bell schedules that run at the same hour
 * count as one slot a teacher can be in rather than two.
 */
function canonical(clash: Map<string, string[]>, slotId: string): string {
  const ids = clash.get(slotId)
  if (!ids || ids.length <= 1) return slotId
  let min = slotId
  for (const id of ids) if (id < min) min = id
  return min
}

export interface WorkloadInput {
  config: TimetableConfig
  slots: PeriodSlot[]
  requirements: Requirement[]
  constraints: TimetableConstraint[]
  combined?: CombinedClassInput[]
  slotGroups?: SlotGroup[]
  homeroomGroupIds?: Record<string, string | null>
}

/**
 * Every teacher who has work assigned, with what they are asked for against
 * what their week holds.
 *
 * Capacity is the distinct wall-clock periods of the schedules they actually
 * teach in — a teacher working across two period groups gets the union, not
 * the sum, because overlapping periods are one slot they can only be in once.
 */
export function teacherWorkloads(input: WorkloadInput): TeacherWorkload[] {
  const sched = buildSchedules(
    input.config, input.slots, input.slotGroups ?? [], input.homeroomGroupIds ?? {},
  )

  // What each teacher is asked to cover, and which classes' weeks that spans.
  const items = new Map<string, TeacherWorkloadItem[]>()
  const homeroomsOf = new Map<string, Set<string>>()
  const note = (teacherId: string, item: TeacherWorkloadItem) => {
    const arr = items.get(teacherId)
    if (arr) arr.push(item)
    else items.set(teacherId, [item])
    if (!homeroomsOf.has(teacherId)) homeroomsOf.set(teacherId, new Set())
    homeroomsOf.get(teacherId)!.add(item.homeroomId)
  }

  for (const r of input.requirements) {
    for (const t of teacherIdsOf(r)) {
      note(t, {
        homeroomId: r.homeroom_id, subjectId: r.subject_id,
        periods: r.periods_per_week, combined: false,
      })
    }
  }
  for (const c of input.combined ?? []) {
    // A combined lesson is taught ONCE however many classes attend it, so it
    // counts once against the teacher — crediting it per class would invent
    // an overload that isn't there.
    const first = c.members[0]
    if (!first) continue
    for (const t of c.teacherIds) {
      note(t, {
        homeroomId: first.homeroomId, subjectId: c.subjectId,
        periods: c.periodsPerWeek, combined: true,
      })
    }
  }

  const out: TeacherWorkload[] = []
  for (const [teacherId, list] of items) {
    const assigned = list.reduce((n, i) => n + i.periods, 0)

    // The cells this teacher could occupy: every period of every schedule they
    // teach in, folded onto wall-clock time so overlapping bands count once.
    const cells = new Set<string>()
    const perDay = new Map<Weekday, Set<string>>()
    for (const hr of homeroomsOf.get(teacherId) ?? []) {
      const geo = scheduleFor(sched, hr)
      for (const day of geo.days) {
        if (!perDay.has(day)) perDay.set(day, new Set())
        for (const slot of geo.teachingSlots) {
          const id = canonical(sched.clash, slot.id)
          cells.add(cellKey(day, id))
          perDay.get(day)!.add(id)
        }
      }
    }

    // Their own time off comes straight out of that.
    let timeOff = 0
    for (const c of input.constraints) {
      if (c.type !== 'time_off' || c.scope !== 'teacher' || c.scope_id !== teacherId) continue
      if (!c.day || !c.slot_id) continue
      const key = cellKey(c.day, canonical(sched.clash, c.slot_id))
      if (cells.delete(key)) {
        timeOff++
        perDay.get(c.day)?.delete(canonical(sched.clash, c.slot_id))
      }
    }

    // A max-per-week rule on this teacher binds just as hard as the clock.
    const weeklyCapRule = input.constraints.find(
      (c) => c.type === 'max_per_week' && c.scope === 'teacher' &&
        (c.scope_id === teacherId || c.scope_id === null) && c.homeroom_id === null,
    )
    const weeklyCap = weeklyCapRule?.value ?? null

    const capacity = weeklyCap != null ? Math.min(cells.size, weeklyCap) : cells.size
    const busiestDayCapacity = Math.max(0, ...[...perDay.values()].map((s) => s.size))

    out.push({
      teacherId,
      assigned,
      capacity,
      timeOff,
      over: Math.max(0, assigned - capacity),
      weeklyCap: weeklyCap != null && weeklyCap < cells.size ? weeklyCap : null,
      busiestDayCapacity,
      items: list,
    })
  }

  // Worst first — the ones that need attention.
  return out.sort((a, b) => b.over - a.over || b.assigned - a.assigned)
}

/** Just the teachers who cannot fit what they have been given. */
export const overloadedTeachers = (list: TeacherWorkload[]) => list.filter((w) => w.over > 0)

/**
 * How full a teacher is, 0–1. Over 1 means they are over-booked; the UI uses
 * this for the meter so "nearly full" reads differently from "impossible".
 */
export const workloadRatio = (w: TeacherWorkload) =>
  w.capacity === 0 ? (w.assigned > 0 ? Infinity : 0) : w.assigned / w.capacity

/**
 * What a teacher's week looks like if `delta` more periods are handed to them
 * — the question the requirement form needs answered before it saves, not
 * after. `delta` is negative when editing a requirement down.
 *
 * A teacher with no workload record yet has nothing assigned, so `capacity`
 * is unknown here; the caller supplies the fallback it wants to show.
 */
export function withExtraPeriods(
  w: TeacherWorkload | undefined,
  delta: number,
): { assigned: number; capacity: number; over: number } | null {
  if (!w) return null
  const assigned = Math.max(0, w.assigned + delta)
  return { assigned, capacity: w.capacity, over: Math.max(0, assigned - w.capacity) }
}
