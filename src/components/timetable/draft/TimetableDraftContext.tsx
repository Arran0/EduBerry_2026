'use client'

import React, {
  createContext, useCallback, useContext, useEffect, useMemo, useState,
} from 'react'
import {
  fetchPeriodSlots, fetchRequirements, fetchUnavailability, fetchRooms, fetchSubjects,
  fetchTimetables, fetchEntries, fetchConstraints, fetchCombinedClasses,
  fetchGroupsForHomerooms, fetchSlotGroups, fetchSlotGroupHomerooms, slotGroupMap,
  scheduleWeeks, weekForHomeroom, teacherIdsOf, addConstraint, deleteConstraint,
} from '@/lib/timetable'
import type {
  TimetableConfig, PeriodSlot, Requirement, TeacherUnavailability, Room, Subject,
  Timetable, PlacedEntry, TimetableEntry, TimetableConstraint, HomeroomLite,
  CombinedClass, CombinedClassInput, HomeroomGroup, SlotGroup, ScheduleWeek, Weekday,
  ConstraintScope, ConstraintType,
} from '@/lib/timetable'
import { buildSchedules, detectConflicts } from '@/lib/timetable/generator'
import { fetchAllHomerooms } from '@/lib/homerooms'
import type { Homeroom } from '@/lib/homerooms'
import { fetchStaffProfiles } from '@/lib/admin'
import type { UserProfile } from '@/lib/supabase'

// ============================================================
// One draft, shared by every surface that shows it.
//
// The draft timetable only exists in memory until it is saved, so the master
// grid can't be the sole owner of it: the Homeroom / Teacher / Subject
// time-off calendars render the same week and let you drag and pin the same
// lessons. Two copies of an unsaved draft would diverge on the first edit, so
// the entries and their mutators live here and each surface renders a view of
// them.
// ============================================================

const toPlaced = (e: TimetableEntry): PlacedEntry => ({
  homeroomId: e.homeroom_id,
  day: e.day,
  slotId: e.slot_id,
  subjectId: e.subject_id ?? '',
  teacherId: e.teacher_id,
  teacherIds: teacherIdsOf(e),
  roomId: e.room_id,
  isLocked: e.is_locked,
  groupId: e.group_id ?? null,
  splitKey: e.split_key ?? null,
  combinedKey: e.combined_key ?? null,
  blockKey: e.block_key ?? null,
})

/** Identity of one entry inside the in-memory array (rows have no DB id yet). */
export const entryId = (e: PlacedEntry) =>
  `${e.homeroomId}__${e.day}__${e.slotId}__${e.groupId ?? ''}__${e.combinedKey ?? ''}`

export interface TimetableDraft {
  config: TimetableConfig
  loading: boolean
  reload: () => Promise<void>

  // Reference data
  slots: PeriodSlot[] // every slot of the config, breaks included
  slotGroups: SlotGroup[]
  slotGroupIds: Record<string, string | null> // homeroomId -> slot group
  weeks: ScheduleWeek[]
  homerooms: Homeroom[]
  scheduledHomerooms: Homeroom[]
  homeroomsLite: HomeroomLite[]
  teachers: UserProfile[]
  subjects: Subject[]
  rooms: Room[]
  groups: HomeroomGroup[]
  requirements: Requirement[]
  combinedClasses: CombinedClass[]
  combinedInput: CombinedClassInput[]
  unavailability: TeacherUnavailability[]
  constraints: TimetableConstraint[]
  setConstraints: React.Dispatch<React.SetStateAction<TimetableConstraint[]>>
  isConstraintOn: (
    scope: ConstraintScope, scopeId: string, type: ConstraintType, day: Weekday, slotId: string,
  ) => boolean
  toggleConstraintCell: (
    scope: ConstraintScope, scopeId: string, type: ConstraintType, day: Weekday, slotId: string,
  ) => Promise<void>

  // The draft itself
  timetable: Timetable | null
  setTimetable: React.Dispatch<React.SetStateAction<Timetable | null>>
  entries: PlacedEntry[]
  setEntries: React.Dispatch<React.SetStateAction<PlacedEntry[]>>

  // Editing
  setCellEntry: (
    homeroomId: string, day: Weekday, slotId: string, groupId: string | null,
    subjectId: string, teacherIds: string[], roomId: string | null,
  ) => void
  clearCellEntry: (homeroomId: string, day: Weekday, slotId: string, groupId: string | null) => void
  togglePin: (entry: PlacedEntry) => void
  moveEntry: (entry: PlacedEntry, day: Weekday, slotId: string) => boolean

  // Derived
  weekFor: (homeroomId: string) => ScheduleWeek
  slotClash: Map<string, string[]>
  groupName: (groupId: string) => string | undefined
  liveConflicts: ReturnType<typeof detectConflicts>
  allConflicts: ReturnType<typeof detectConflicts>
  cellConflicts: (homeroomId: string, day: Weekday, slotId: string) => string[]
}

const Ctx = createContext<TimetableDraft | null>(null)

export function useTimetableDraft(): TimetableDraft {
  const v = useContext(Ctx)
  if (!v) throw new Error('useTimetableDraft must be used inside <TimetableDraftProvider>')
  return v
}

/** The draft when one is loaded, null outside the provider — for optional surfaces. */
export function useTimetableDraftOptional(): TimetableDraft | null {
  return useContext(Ctx)
}

export function TimetableDraftProvider({
  config, children,
}: {
  config: TimetableConfig
  children: React.ReactNode
}) {
  const [loading, setLoading] = useState(true)
  const [slots, setSlots] = useState<PeriodSlot[]>([])
  const [slotGroups, setSlotGroups] = useState<SlotGroup[]>([])
  const [slotGroupIds, setSlotGroupIds] = useState<Record<string, string | null>>({})
  const [requirements, setRequirements] = useState<Requirement[]>([])
  const [unavailability, setUnavailability] = useState<TeacherUnavailability[]>([])
  const [constraints, setConstraints] = useState<TimetableConstraint[]>([])
  const [combinedClasses, setCombinedClasses] = useState<CombinedClass[]>([])
  const [rooms, setRooms] = useState<Room[]>([])
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [homerooms, setHomerooms] = useState<Homeroom[]>([])
  const [teachers, setTeachers] = useState<UserProfile[]>([])
  const [groups, setGroups] = useState<HomeroomGroup[]>([])
  const [timetable, setTimetable] = useState<Timetable | null>(null)
  const [entries, setEntries] = useState<PlacedEntry[]>([])

  const reload = useCallback(async () => {
    setLoading(true)
    const [sl, sg, sgh, reqs, unavail, cons, cmb, rms, subs, hrs, profiles, timetables] =
      await Promise.all([
        fetchPeriodSlots(config.id),
        fetchSlotGroups(config.id),
        fetchSlotGroupHomerooms(config.id),
        fetchRequirements(config.id),
        fetchUnavailability(config.id),
        fetchConstraints(config.id),
        fetchCombinedClasses(config.id),
        fetchRooms(),
        fetchSubjects(),
        fetchAllHomerooms(),
        fetchStaffProfiles(),
        fetchTimetables(config.id),
      ])
    setSlots(sl)
    setSlotGroups(sg)
    setSlotGroupIds(slotGroupMap(sgh))
    setRequirements(reqs)
    setUnavailability(unavail)
    setConstraints(cons)
    setCombinedClasses(cmb)
    setRooms(rms)
    setSubjects(subs)
    setHomerooms(hrs)
    setTeachers(profiles)

    // Adopt the most recent timetable version (draft preferred) and its entries.
    const existing = timetables[0] ?? null
    setTimetable(existing)

    // Second wave: split-group names for the lesson badges, and the adopted
    // version's entries. Neither depends on the other, so they go together.
    const [grps, savedEntries] = await Promise.all([
      fetchGroupsForHomerooms(hrs.map((h) => h.id)),
      existing ? fetchEntries(existing.id) : Promise.resolve([]),
    ])
    setGroups(grps)
    setEntries(savedEntries.map(toPlaced))
    setLoading(false)
  }, [config.id])

  useEffect(() => { reload() }, [reload])

  // ── Derived reference data ───────────────────────────────

  const weeks = useMemo(
    () => scheduleWeeks(config, slots, slotGroups),
    [config, slots, slotGroups],
  )

  const weekFor = useCallback(
    (homeroomId: string) => weekForHomeroom(weeks, slotGroupIds, homeroomId),
    [weeks, slotGroupIds],
  )

  // Homerooms that have requirements OR belong to a combined class are scheduled.
  const scheduledHomerooms = useMemo(() => {
    const ids = new Set(requirements.map((r) => r.homeroom_id))
    for (const c of combinedClasses) for (const m of c.members ?? []) ids.add(m.homeroom_id)
    return homerooms.filter((h) => ids.has(h.id))
  }, [requirements, combinedClasses, homerooms])

  const homeroomsLite: HomeroomLite[] = useMemo(
    () => homerooms.map((h) => ({ id: h.id, class_teacher_id: h.class_teacher_id })),
    [homerooms],
  )

  const combinedInput: CombinedClassInput[] = useMemo(
    () =>
      combinedClasses
        .filter((c) => c.subject_id)
        .map((c) => ({
          id: c.id,
          subjectId: c.subject_id as string,
          teacherId: c.teacher_id,
          teacherIds: teacherIdsOf(c),
          roomId: c.room_id,
          periodsPerWeek: c.periods_per_week,
          members: (c.members ?? []).map((m) => ({ homeroomId: m.homeroom_id, groupId: m.group_id })),
        })),
    [combinedClasses],
  )

  // Which periods of different bell schedules share a wall-clock hour. Without
  // it a teacher booked in two overlapping bands reads as free.
  const slotClash = useMemo(
    () => buildSchedules(config, slots, slotGroups, slotGroupIds).clash,
    [config, slots, slotGroups, slotGroupIds],
  )

  // ── Editing ──────────────────────────────────────────────
  // A target is one lesson layer of one cell: a homeroom's cell holds the
  // whole-class lesson (groupId null) plus any parallel split-group lessons,
  // and each is edited independently. Combined lessons are never targeted here.
  const isTarget = (
    e: PlacedEntry, homeroomId: string, day: Weekday, slotId: string, groupId: string | null,
  ) =>
    !e.combinedKey && e.homeroomId === homeroomId && e.day === day && e.slotId === slotId &&
    (e.groupId ?? null) === groupId

  const setCellEntry = useCallback((
    homeroomId: string, day: Weekday, slotId: string, groupId: string | null,
    subjectId: string, teacherIds: string[], roomId: string | null,
  ) => {
    setEntries((prev) => {
      const existing = prev.find((e) => isTarget(e, homeroomId, day, slotId, groupId))
      const rest = prev.filter((e) => !isTarget(e, homeroomId, day, slotId, groupId))
      return [
        ...rest,
        {
          homeroomId, day, slotId, subjectId,
          teacherId: teacherIds[0] ?? null,
          teacherIds,
          roomId,
          isLocked: existing?.isLocked ?? false,
          groupId,
          splitKey: groupId ? `${homeroomId}__${day}__${slotId}` : null,
          combinedKey: null,
          // Editing one period by hand takes it out of whatever block it was
          // in — the rest of the block keeps its key and stays together.
          blockKey: null,
        },
      ]
    })
  }, [])

  const clearCellEntry = useCallback(
    (homeroomId: string, day: Weekday, slotId: string, groupId: string | null) =>
      setEntries((prev) => prev.filter((e) => !isTarget(e, homeroomId, day, slotId, groupId))),
    [],
  )

  // Pinning fixes a lesson to its period: the generator treats pinned cells as
  // given and builds the rest of the week around them. A combined lesson pins
  // every member class together, and a double/triple pins as one block.
  const togglePin = useCallback((target: PlacedEntry) =>
    setEntries((prev) => {
      if (target.combinedKey) {
        const next = !target.isLocked
        return prev.map((e) => (e.combinedKey === target.combinedKey ? { ...e, isLocked: next } : e))
      }
      if (target.blockKey) {
        const next = !target.isLocked
        return prev.map((e) => (e.blockKey === target.blockKey ? { ...e, isLocked: next } : e))
      }
      return prev.map((e) =>
        isTarget(e, target.homeroomId, target.day, target.slotId, target.groupId ?? null)
          ? { ...e, isLocked: !e.isLocked }
          : e,
      )
    }), [])

  /**
   * Drops a lesson on another period. Returns false when the move is refused,
   * so the caller can leave the grid untouched instead of showing a half-move.
   *
   * A combined lesson moves every member class together; a double/triple moves
   * as a run, keeping the grabbed period under the cursor and its siblings at
   * the same offsets. A single lesson swaps with whatever holds the target.
   */
  const moveEntry = useCallback((dragged: PlacedEntry, day: Weekday, slotId: string): boolean => {
    if (dragged.day === day && dragged.slotId === slotId) return false

    // ── Combined: relocate every member entry together.
    if (dragged.combinedKey) {
      const combinedId = dragged.combinedKey.split('__')[0]
      const newKey = `${combinedId}__${day}__${slotId}`
      setEntries((prev) =>
        prev.map((e) =>
          e.combinedKey === dragged.combinedKey ? { ...e, day, slotId, combinedKey: newKey } : e,
        ),
      )
      return true
    }

    const week = weekFor(dragged.homeroomId)
    const order = week.slots.map((s) => s.id)
    const target = order.indexOf(slotId)
    if (target < 0) return false // the class doesn't run in that period

    // ── Block: shift the whole run by the grabbed period's delta.
    if (dragged.blockKey) {
      const members = entries
        .filter((e) => e.blockKey === dragged.blockKey)
        .sort((a, b) => order.indexOf(a.slotId) - order.indexOf(b.slotId))
      const delta = target - order.indexOf(dragged.slotId)
      const moves = new Map<string, string>() // entryId -> new slotId
      for (const m of members) {
        const to = order.indexOf(m.slotId) + delta
        if (to < 0 || to >= order.length) return false // runs off the end of the day
        moves.set(entryId(m), order[to])
      }
      // The run has to stay contiguous: a break inside the destination would
      // split it, which is exactly what a block forbids.
      const idxs = [...moves.values()].map((id) => order.indexOf(id)).sort((a, b) => a - b)
      if (idxs[idxs.length - 1] - idxs[0] !== idxs.length - 1) return false

      const landing = new Set([...moves.values()].map((id) => `${day}__${id}`))
      const token = dragged.groupId ?? '__whole__'
      const blocked = entries.some(
        (e) =>
          e.blockKey !== dragged.blockKey &&
          e.homeroomId === dragged.homeroomId &&
          (e.groupId ?? '__whole__') === token &&
          landing.has(`${e.day}__${e.slotId}`),
      )
      if (blocked) return false // no sensible swap for a multi-period run

      setEntries((prev) =>
        prev.map((e) => {
          const to = moves.get(entryId(e))
          return to && e.blockKey === dragged.blockKey ? { ...e, day, slotId: to } : e
        }),
      )
      return true
    }

    // ── Single period: swap with the occupant of the same layer, if any.
    const token = dragged.groupId ?? '__whole__'
    const draggedKey = entryId(dragged)
    const occupant = entries.find(
      (e) =>
        e.homeroomId === dragged.homeroomId && e.day === day && e.slotId === slotId &&
        (e.groupId ?? '__whole__') === token && !e.combinedKey,
    )
    // Swapping a single period into the middle of a block would break the
    // block, so the block's cells are not valid drop targets for one period.
    if (occupant?.blockKey) return false

    setEntries((prev) =>
      prev.map((e) => {
        if (entryId(e) === draggedKey) return { ...e, day, slotId }
        if (occupant && entryId(e) === entryId(occupant)) {
          return { ...e, day: dragged.day, slotId: dragged.slotId }
        }
        return e
      }),
    )
    return true
  }, [entries, weekFor])

  // ── Cell constraints (time off, class-teacher pins) ──────
  // Every calendar in the workspace toggles these, so the write and the local
  // patch live here rather than being re-implemented per panel.

  const isConstraintOn = useCallback(
    (scope: ConstraintScope, scopeId: string, type: ConstraintType, day: Weekday, slotId: string) =>
      constraints.some(
        (c) => c.type === type && c.scope === scope && c.scope_id === scopeId &&
          c.day === day && c.slot_id === slotId,
      ),
    [constraints],
  )

  const toggleConstraintCell = useCallback(async (
    scope: ConstraintScope, scopeId: string, type: ConstraintType, day: Weekday, slotId: string,
  ) => {
    const existing = constraints.find(
      (c) => c.type === type && c.scope === scope && c.scope_id === scopeId &&
        c.day === day && c.slot_id === slotId,
    )
    if (existing) {
      const ok = await deleteConstraint(existing.id)
      if (ok) setConstraints((prev) => prev.filter((c) => c.id !== existing.id))
      return
    }
    const created = await addConstraint({
      config_id: config.id, scope, scope_id: scopeId, type, day, slot_id: slotId,
    })
    if (created) setConstraints((prev) => [...prev, created])
  }, [constraints, config.id])

  // ── Conflicts ────────────────────────────────────────────

  const allConflicts = useMemo(
    () => detectConflicts(entries, unavailability, constraints, homeroomsLite, slotClash),
    [entries, unavailability, constraints, homeroomsLite, slotClash],
  )

  const liveConflicts = useMemo(
    () =>
      allConflicts.filter(
        (c) => c.kind !== 'unplaced_lesson' && c.kind !== 'block_unplaceable' && c.kind !== 'pin_unfilled',
      ),
    [allConflicts],
  )

  const cellConflicts = useCallback(
    (homeroomId: string, day: Weekday, slotId: string): string[] => {
      const here = entries.filter(
        (e) => e.homeroomId === homeroomId && e.day === day && e.slotId === slotId,
      )
      const teacherHere = new Set(here.flatMap((e) => teacherIdsOf(e)))
      const msgs = liveConflicts
        .filter((c) => c.day === day && c.slotId === slotId)
        .filter((c) => c.homeroomId === homeroomId || (c.teacherId ? teacherHere.has(c.teacherId) : false))
        .map((c) => c.message)
      return [...new Set(msgs)]
    },
    [entries, liveConflicts],
  )

  const groupName = useCallback(
    (groupId: string) => groups.find((g) => g.id === groupId)?.name,
    [groups],
  )

  const value: TimetableDraft = {
    config, loading, reload,
    slots, slotGroups, slotGroupIds, weeks,
    homerooms, scheduledHomerooms, homeroomsLite, teachers, subjects, rooms, groups,
    requirements, combinedClasses, combinedInput, unavailability,
    constraints, setConstraints, isConstraintOn, toggleConstraintCell,
    timetable, setTimetable, entries, setEntries,
    setCellEntry, clearCellEntry, togglePin, moveEntry,
    weekFor, slotClash, groupName, liveConflicts, allConflicts, cellConflicts,
  }

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
