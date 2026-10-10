import { supabase } from './supabase'
import type { UserProfile } from './supabase'
import type { Subject, Room, TimetableConfig, PeriodSlot, Requirement, TeacherUnavailability, Timetable, TimetableEntry, TimetableStatus, TimetableViewData, Weekday, PlacedEntry, HomeroomGroup, TimetableConstraint, ConstraintScope, ConstraintType, CombinedClass, SlotGroup, SlotGroupHomeroom, ScheduleWeek, RoomType } from './timetable/types'

// Re-export types so feature code can import everything from '@/lib/timetable'.
export * from './timetable/types'
import { teacherIdsOf, WEEKDAYS } from './timetable/types'

// PostgREST puts `.in()` lists in the query string, so a long one (a CSV import
// of a whole year group) overruns the URL length limit and the request fails
// outright. Split anything unbounded into batches that comfortably fit.
const IN_BATCH_SIZE = 150
function chunk<T>(items: T[], size = IN_BATCH_SIZE): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

// ============================================================
// Subjects
// ============================================================

export async function fetchSubjects(): Promise<Subject[]> {
  const { data, error } = await supabase
    .from('timetable_subjects')
    .select('*')
    .order('name', { ascending: true })

  if (error) {
    console.error('fetchSubjects error:', error)
    return []
  }
  return data ?? []
}

export async function createSubject(
  input: Pick<Subject, 'name'> & Partial<Pick<Subject, 'code' | 'color'>>,
): Promise<Subject | null> {
  const { data, error } = await supabase
    .from('timetable_subjects')
    .insert(input)
    .select()
    .single()

  if (error) {
    console.error('createSubject error:', error)
    return null
  }
  return data
}

export async function deleteSubject(id: string): Promise<boolean> {
  const { error } = await supabase.from('timetable_subjects').delete().eq('id', id)
  if (error) {
    console.error('deleteSubject error:', error)
    return false
  }
  return true
}

// ============================================================
// Rooms
// ============================================================

export async function fetchRooms(): Promise<Room[]> {
  const { data, error } = await supabase
    .from('timetable_rooms')
    .select('*')
    .order('name', { ascending: true })

  if (error) {
    console.error('fetchRooms error:', error)
    return []
  }
  return data ?? []
}

export async function createRoom(
  input: Pick<Room, 'name'> & Partial<Pick<Room, 'room_type' | 'capacity'>>,
): Promise<Room | null> {
  const { data, error } = await supabase
    .from('timetable_rooms')
    .insert(input)
    .select()
    .single()

  if (error) {
    console.error('createRoom error:', error)
    return null
  }
  return data
}

export async function deleteRoom(id: string): Promise<boolean> {
  const { error } = await supabase.from('timetable_rooms').delete().eq('id', id)
  if (error) {
    console.error('deleteRoom error:', error)
    return false
  }
  return true
}

// ============================================================
// Configs
// ============================================================

export async function fetchConfigs(): Promise<TimetableConfig[]> {
  const { data, error } = await supabase
    .from('timetable_configs')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) {
    console.error('fetchConfigs error:', error)
    return []
  }
  return data ?? []
}

export async function createConfig(
  input: Pick<TimetableConfig, 'name'> &
    Partial<Pick<TimetableConfig, 'academic_year' | 'working_days' | 'is_active'>>,
): Promise<TimetableConfig | null> {
  const { data, error } = await supabase
    .from('timetable_configs')
    .insert(input)
    .select()
    .single()

  if (error) {
    console.error('createConfig error:', error)
    return null
  }
  return data
}

export async function updateConfig(
  id: string,
  patch: Partial<Pick<TimetableConfig, 'name' | 'academic_year' | 'working_days' | 'is_active'>>,
): Promise<boolean> {
  const { error } = await supabase.from('timetable_configs').update(patch).eq('id', id)
  if (error) {
    console.error('updateConfig error:', error)
    return false
  }
  return true
}

export async function deleteConfig(id: string): Promise<boolean> {
  const { error } = await supabase.from('timetable_configs').delete().eq('id', id)
  if (error) {
    console.error('deleteConfig error:', error)
    return false
  }
  return true
}

// Activates a config. Multiple configs can be active simultaneously —
// this no longer deactivates others. Use deactivateConfig() to turn one off.
export async function setActiveConfig(id: string): Promise<boolean> {
  const { error } = await supabase
    .from('timetable_configs')
    .update({ is_active: true })
    .eq('id', id)
  if (error) {
    console.error('setActiveConfig error:', error)
    return false
  }
  return true
}

export async function deactivateConfig(id: string): Promise<boolean> {
  const { error } = await supabase
    .from('timetable_configs')
    .update({ is_active: false })
    .eq('id', id)
  if (error) {
    console.error('deactivateConfig error:', error)
    return false
  }
  return true
}

// ============================================================
// Period slots
// ============================================================

export async function fetchPeriodSlots(configId: string): Promise<PeriodSlot[]> {
  const { data, error } = await supabase
    .from('timetable_period_slots')
    .select('*')
    .eq('config_id', configId)
    .order('position', { ascending: true })

  if (error) {
    console.error('fetchPeriodSlots error:', error)
    return []
  }
  return data ?? []
}

export async function createPeriodSlot(
  input: Pick<PeriodSlot, 'config_id' | 'position'> &
    Partial<Pick<PeriodSlot, 'label' | 'is_break' | 'start_time' | 'end_time' | 'group_id'>>,
): Promise<PeriodSlot | null> {
  const { data, error } = await supabase
    .from('timetable_period_slots')
    .insert(input)
    .select()
    .single()

  if (error) {
    console.error('createPeriodSlot error:', error)
    return null
  }
  return data
}

/**
 * Strips the clock times off a config's period slots.
 *
 * Two bell schedules with different timings cannot share a teacher cleanly:
 * period 3 of Primary overlaps periods 2 AND 3 of Secondary, so the clash map
 * marks both as taken and a teacher who works across the two bands becomes
 * almost impossible to place. With no times, a period collides only with the
 * period at the same POSITION in the other band — a clean 1:1 — and allocating
 * staff across groups becomes tractable. See `slotsCollide` in generator.ts.
 *
 * Pass a `groupId` to clear one band, or omit it for the whole config.
 */
export async function clearPeriodSlotTimes(
  configId: string,
  groupId?: string | null,
): Promise<boolean> {
  let q = supabase
    .from('timetable_period_slots')
    .update({ start_time: null, end_time: null })
    .eq('config_id', configId)
  if (groupId !== undefined) {
    q = groupId === null ? q.is('group_id', null) : q.eq('group_id', groupId)
  }
  const { error } = await q
  if (error) {
    console.error('clearPeriodSlotTimes error:', error)
    return false
  }
  return true
}

export async function deletePeriodSlot(id: string): Promise<boolean> {
  const { error } = await supabase.from('timetable_period_slots').delete().eq('id', id)
  if (error) {
    console.error('deletePeriodSlot error:', error)
    return false
  }
  return true
}

// ============================================================
// Requirements (solver input)
// ============================================================

// `homeroomId` narrows the fetch to one class — the Homeroom hub only ever
// renders that class's requirements, so it shouldn't pull the whole config's.
export async function fetchRequirements(
  configId: string,
  homeroomId?: string,
): Promise<Requirement[]> {
  let query = supabase
    .from('timetable_requirements')
    .select('*, subject:timetable_subjects(*), teacher:profiles(id, full_name, avatar_url, role), group:timetable_homeroom_groups(*)')
    .eq('config_id', configId)
  if (homeroomId) query = query.eq('homeroom_id', homeroomId)

  const { data, error } = await query.order('created_at', { ascending: true })

  if (error) {
    console.error('fetchRequirements error:', error)
    return []
  }
  return (data ?? []) as Requirement[]
}

export async function createRequirement(
  input: Pick<Requirement, 'config_id' | 'homeroom_id' | 'subject_id'> &
    Partial<Pick<Requirement, 'teacher_id' | 'teacher_ids' | 'periods_per_week' | 'room_type' | 'max_per_day' | 'min_block' | 'max_block' | 'group_id'>>,
): Promise<Requirement | null> {
  const { data, error } = await supabase
    .from('timetable_requirements')
    .insert(input)
    .select()
    .single()

  if (error) {
    console.error('createRequirement error:', error)
    lastRequirementError =
      // 23505 = the (config, homeroom, subject, group) unique index.
      error.code === '23505'
        ? 'This class already has that subject for the same group — delete the existing requirement first.'
        : `${error.message}${error.hint ? ` (${error.hint})` : ''}`
    return null
  }
  lastRequirementError = null
  return data
}

// Why the last createRequirement failed, so the form can show the real reason
// (a duplicate, a stale PostgREST schema cache, an RLS refusal) instead of
// always blaming a duplicate subject.
let lastRequirementError: string | null = null
export const requirementError = () => lastRequirementError

export type RequirementPatch = Partial<
  Pick<
    Requirement,
    'subject_id' | 'teacher_id' | 'teacher_ids' | 'periods_per_week' | 'room_type'
    | 'max_per_day' | 'min_block' | 'max_block' | 'group_id'
  >
>

export async function updateRequirement(id: string, patch: RequirementPatch): Promise<Requirement | null> {
  const { data, error } = await supabase
    .from('timetable_requirements')
    .update(patch)
    .eq('id', id)
    .select()
    .single()
  if (error) {
    console.error('updateRequirement error:', error)
    lastRequirementError =
      error.code === '23505'
        ? 'This class already has that subject for the same group.'
        : `${error.message}${error.hint ? ` (${error.hint})` : ''}`
    return null
  }
  lastRequirementError = null
  return data
}

export async function deleteRequirement(id: string): Promise<boolean> {
  const { error } = await supabase.from('timetable_requirements').delete().eq('id', id)
  if (error) {
    console.error('deleteRequirement error:', error)
    return false
  }
  return true
}

/**
 * Copies requirements onto another homeroom.
 *
 * Group targeting never survives the trip: a split group belongs to the class
 * it was defined on, so a copied requirement always lands as whole-class and
 * the admin re-points it if the destination is split too. Subjects the target
 * already has are skipped rather than failing the whole paste — the unique
 * index would reject them one by one anyway.
 *
 * Returns what happened so the UI can say "4 copied, 2 already there".
 */
export async function copyRequirementsTo(
  sources: Requirement[],
  targetHomeroomId: string,
): Promise<{ copied: number; skipped: number; failed: number }> {
  if (sources.length === 0) return { copied: 0, skipped: 0, failed: 0 }
  const configId = sources[0].config_id
  const existing = await fetchRequirements(configId, targetHomeroomId)
  const taken = new Set(existing.filter((r) => !r.group_id).map((r) => r.subject_id))

  const rows = []
  let skipped = 0
  for (const r of sources) {
    if (taken.has(r.subject_id)) {
      skipped++
      continue
    }
    taken.add(r.subject_id)
    rows.push({
      config_id: r.config_id,
      homeroom_id: targetHomeroomId,
      subject_id: r.subject_id,
      teacher_id: r.teacher_id,
      teacher_ids: teacherIdsOf(r),
      periods_per_week: r.periods_per_week,
      room_type: r.room_type,
      max_per_day: r.max_per_day,
      min_block: r.min_block,
      max_block: r.max_block,
      group_id: null,
    })
  }
  if (rows.length === 0) return { copied: 0, skipped, failed: 0 }

  const { data, error } = await supabase.from('timetable_requirements').insert(rows).select('id')
  if (error) {
    console.error('copyRequirementsTo error:', error)
    lastRequirementError = `${error.message}${error.hint ? ` (${error.hint})` : ''}`
    return { copied: 0, skipped, failed: rows.length }
  }
  lastRequirementError = null
  return { copied: data?.length ?? rows.length, skipped, failed: 0 }
}

// ============================================================
// Teacher unavailability
// ============================================================

export async function fetchUnavailability(configId: string): Promise<TeacherUnavailability[]> {
  const { data, error } = await supabase
    .from('teacher_unavailability')
    .select('*')
    .eq('config_id', configId)

  if (error) {
    console.error('fetchUnavailability error:', error)
    return []
  }
  return data ?? []
}

// ============================================================
// Constraints (Round 3) — the unified framework
// ============================================================

export async function fetchConstraints(configId: string): Promise<TimetableConstraint[]> {
  const { data, error } = await supabase
    .from('timetable_constraints')
    .select('*')
    .eq('config_id', configId)

  if (error) {
    console.error('fetchConstraints error:', error)
    return []
  }
  return (data ?? []) as TimetableConstraint[]
}

export type ConstraintInput = {
  config_id: string
  scope: ConstraintScope
  scope_id?: string | null
  homeroom_id?: string | null
  type: ConstraintType
  value?: number | null
  day?: Weekday | null
  slot_id?: string | null
}

export async function addConstraint(input: ConstraintInput): Promise<TimetableConstraint | null> {
  const { data, error } = await supabase
    .from('timetable_constraints')
    .insert({
      config_id: input.config_id,
      scope: input.scope,
      scope_id: input.scope_id ?? null,
      homeroom_id: input.homeroom_id ?? null,
      type: input.type,
      value: input.value ?? null,
      day: input.day ?? null,
      slot_id: input.slot_id ?? null,
    })
    .select()
    .single()

  if (error) {
    console.error('addConstraint error:', error)
    return null
  }
  return data as TimetableConstraint
}

export async function deleteConstraint(id: string): Promise<boolean> {
  const { error } = await supabase.from('timetable_constraints').delete().eq('id', id)
  if (error) {
    console.error('deleteConstraint error:', error)
    return false
  }
  return true
}

// Upsert a value-bearing constraint (min/max per day/week, max in a row). The
// identity is (config, scope, scope_id, homeroom_id, type). A value of 0 or
// null removes the constraint. Returns the resulting row, or null if removed.
export async function setValueConstraint(
  input: ConstraintInput & { existing: TimetableConstraint[] },
): Promise<TimetableConstraint | null> {
  const match = input.existing.find(
    (c) =>
      c.config_id === input.config_id &&
      c.scope === input.scope &&
      (c.scope_id ?? null) === (input.scope_id ?? null) &&
      (c.homeroom_id ?? null) === (input.homeroom_id ?? null) &&
      c.type === input.type,
  )

  const value = input.value ?? 0
  if (!value || value <= 0) {
    if (match) await deleteConstraint(match.id)
    return null
  }

  if (match) {
    const { error } = await supabase
      .from('timetable_constraints')
      .update({ value })
      .eq('id', match.id)
    if (error) {
      console.error('setValueConstraint (update) error:', error)
      return null
    }
    return { ...match, value }
  }
  return addConstraint({ ...input, value })
}

// ============================================================
// Timetables (versions) + entries
// ============================================================

export async function fetchTimetables(configId: string): Promise<Timetable[]> {
  const { data, error } = await supabase
    .from('timetables')
    .select('*')
    .eq('config_id', configId)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('fetchTimetables error:', error)
    return []
  }
  return data ?? []
}

export async function createTimetable(
  input: Pick<Timetable, 'config_id' | 'name'> & Partial<Pick<Timetable, 'status'>>,
): Promise<Timetable | null> {
  const { data, error } = await supabase
    .from('timetables')
    .insert(input)
    .select()
    .single()

  if (error) {
    console.error('createTimetable error:', error)
    return null
  }
  return data
}

export async function updateTimetableMeta(id: string, patch: { name?: string }): Promise<boolean> {
  const { error } = await supabase.from('timetables').update(patch).eq('id', id)
  if (error) {
    console.error('updateTimetableMeta error:', error)
    return false
  }
  return true
}

const ENTRY_SELECT =
  '*, subject:timetable_subjects(*), teacher:profiles(id, full_name, avatar_url, role), room:timetable_rooms(*), group:timetable_homeroom_groups(*)'

/** PostgREST caps a plain select at 1000 rows, so entries are read in pages. */
const ENTRY_PAGE_SIZE = 1000

/**
 * Every entry of one timetable version.
 *
 * Paged deliberately. A whole-school week is far more than 1000 rows — 34
 * classes over a 6-day week of 11 periods is ~1450 — and PostgREST truncates a
 * plain select at 1000 without saying so. The admin workspace loads this into
 * the draft it then saves back, so a silent truncation here did not just show a
 * partial week: the next "Save draft" wrote the truncated week over the
 * complete one and several hundred periods were gone for good.
 */
export async function fetchEntries(timetableId: string): Promise<TimetableEntry[]> {
  const rows: TimetableEntry[] = []
  for (let page = 0; ; page++) {
    const { data, error } = await supabase
      .from('timetable_entries')
      .select(ENTRY_SELECT)
      .eq('timetable_id', timetableId)
      // A stable order is what makes paging meaningful — without one, two
      // pages can repeat a row and leave another out.
      .order('id', { ascending: true })
      .range(page * ENTRY_PAGE_SIZE, page * ENTRY_PAGE_SIZE + ENTRY_PAGE_SIZE - 1)

    if (error) {
      console.error('fetchEntries error:', error)
      // A half-read week must never reach the draft the admin then saves back.
      return []
    }
    const batch = (data ?? []) as TimetableEntry[]
    rows.push(...batch)
    if (batch.length < ENTRY_PAGE_SIZE) return rows
  }
}

/**
 * Replaces every entry of a timetable with the draft the admin is looking at.
 * Pinned cells are expected to already be present in `entries`.
 *
 * Returns the number of periods the database now holds, or null if nothing was
 * written. Handed to one Postgres function rather than done as a delete
 * followed by an insert: the two-round-trip version had no transaction around
 * it, so an insert that failed — a bad row, a dropped connection, a closed tab
 * — left the week deleted and nothing in its place, while reporting only that
 * the save had failed. A count that disagrees with what was sent is reported as
 * a failure too, so "Draft saved" is never shown over a save that didn't land.
 */
export async function replaceEntries(
  timetableId: string,
  entries: PlacedEntry[],
): Promise<number | null> {
  const rows = entries.map((e) => {
    const ids = teacherIdsOf(e)
    return {
      homeroom_id: e.homeroomId,
      day: e.day,
      slot_id: e.slotId,
      subject_id: e.subjectId || null, // '' is not a valid UUID; coerce to null
      // The primary teacher, the display names and the legacy singular columns
      // are all derived from this list inside the function, against the
      // profiles table rather than against whatever the browser last loaded.
      teacher_ids: ids,
      room_id: e.roomId,
      is_locked: e.isLocked,
      group_id: e.groupId ?? null,
      split_key: e.splitKey ?? null,
      combined_key: e.combinedKey ?? null,
      // Every period of a double/triple carries the same key, so a reloaded
      // draft still knows which rows are one lesson.
      block_key: e.blockKey ?? null,
    }
  })

  const { data, error } = await supabase.rpc('replace_timetable_entries', {
    p_timetable_id: timetableId,
    p_rows: rows,
  })
  if (error) {
    console.error('replaceEntries error:', error.code, error.message, error.details, error.hint)
    return null
  }

  // The function counts the stored rows, so a mismatch means the save did not
  // do what the admin was about to be told it did.
  const written = typeof data === 'number' ? data : Number(data)
  if (!Number.isFinite(written) || written !== rows.length) {
    console.error(`replaceEntries: asked to store ${rows.length} rows, database holds ${data}`)
    return null
  }
  return written
}

// Publishes a timetable, demotes any other published timetable for the
// same config back to draft, and activates the parent config so the
// timetable is immediately visible to staff and students.
export async function publishTimetable(timetable: Timetable): Promise<boolean> {
  const demote = await supabase
    .from('timetables')
    .update({ status: 'draft' as TimetableStatus })
    .eq('config_id', timetable.config_id)
    .eq('status', 'published')
    .neq('id', timetable.id)
  if (demote.error) {
    console.error('publishTimetable (demote) error:', demote.error)
    return false
  }
  const { error } = await supabase
    .from('timetables')
    .update({ status: 'published' as TimetableStatus, published_at: new Date().toISOString() })
    .eq('id', timetable.id)
  if (error) {
    console.error('publishTimetable error:', error)
    return false
  }
  // Activate the config so staff/students can see the timetable immediately.
  // This is the authoritative "go live" step — admins can deactivate from
  // SetupTab later to hide the timetable without deleting it.
  const { error: activateErr } = await supabase
    .from('timetable_configs')
    .update({ is_active: true })
    .eq('id', timetable.config_id)
  if (activateErr) {
    console.error('publishTimetable (activate config) error:', activateErr)
    // Non-fatal: timetable is published; admin can manually activate from SetupTab.
  }
  return true
}

// ============================================================
// Viewer fetchers (student / staff)
// ============================================================

// Shared helper: assembles TimetableViewData[] from a set of entries,
// given the set of active configs and their published timetables.
// Entries are grouped by timetable_id; timetables with no matching
// entries are omitted (e.g. teacher not in that config's schedule).
async function buildViewData(
  entries: TimetableEntry[],
  activeConfigs: TimetableConfig[],
  publishedTimetables: Timetable[],
): Promise<TimetableViewData[]> {
  if (entries.length === 0) return []

  const involvedConfigIds = [...new Set(publishedTimetables.map((t) => t.config_id))]

  const [{ data: allSlots }, { data: allGroups }, { data: allOverrides }] = await Promise.all([
    supabase
      .from('timetable_period_slots')
      .select('*')
      .in('config_id', involvedConfigIds)
      .order('position', { ascending: true }),
    supabase
      .from('timetable_slot_groups')
      .select('*')
      .in('config_id', involvedConfigIds),
    // Per-date amendments. RLS already narrows a student to their own
    // homeroom and their own split groups, so no filter is needed here beyond
    // the configs in play.
    supabase
      .from('timetable_entry_overrides')
      .select('*, subject:timetable_subjects(*), room:timetable_rooms(*)')
      .in('config_id', involvedConfigIds)
      .order('effective_from', { ascending: false }),
  ])

  type ViewOverride = TimetableViewData['overrides'][number]
  const overridesByConfig = new Map<string, ViewOverride[]>()
  for (const o of (allOverrides ?? []) as ViewOverride[]) {
    const arr = overridesByConfig.get(o.config_id) ?? []
    arr.push(o)
    overridesByConfig.set(o.config_id, arr)
  }

  const slotsMap = new Map<string, PeriodSlot[]>()
  for (const s of (allSlots ?? []) as PeriodSlot[]) {
    const arr = slotsMap.get(s.config_id) ?? []
    arr.push(s)
    slotsMap.set(s.config_id, arr)
  }
  const groupById = new Map((allGroups ?? []).map((g: SlotGroup) => [g.id, g]))

  const entriesByTimetable = new Map<string, TimetableEntry[]>()
  for (const e of entries) {
    const arr = entriesByTimetable.get(e.timetable_id) ?? []
    arr.push(e)
    entriesByTimetable.set(e.timetable_id, arr)
  }

  const configMap = new Map(activeConfigs.map((c) => [c.id, c]))

  return publishedTimetables
    .map((tt): TimetableViewData | null => {
      const cfg = configMap.get(tt.config_id)
      const ttEntries = entriesByTimetable.get(tt.id)
      if (!cfg || !ttEntries?.length) return null

      // A config can run several bell schedules (Round 9). The viewer only
      // wants the one(s) their own lessons are in — otherwise a Secondary
      // student is shown Primary's period rows as a column of blank cells.
      // Which periods the entries sit in is what identifies the schedule, so
      // no homeroom-to-group lookup is needed here.
      const configSlots = slotsMap.get(cfg.id) ?? []
      const slotGroupOf = new Map(configSlots.map((s) => [s.id, s.group_id ?? null]))
      const usedGroups = new Set<string | null>()
      for (const e of ttEntries) {
        const g = slotGroupOf.get(e.slot_id)
        if (g !== undefined) usedGroups.add(g)
      }

      // Nothing recognised (entries from deleted slots) → show the lot, as before.
      const slots = usedGroups.size === 0
        ? configSlots
        : configSlots.filter((s) => usedGroups.has(s.group_id ?? null))

      // The week is the union of the schedules in play, in weekday order.
      const dayset = new Set<Weekday>()
      for (const g of usedGroups) {
        const days = g === null
          ? cfg.working_days
          : groupById.get(g)?.working_days ?? cfg.working_days
        for (const d of days) dayset.add(d)
      }
      const working_days = dayset.size > 0
        ? WEEKDAYS.filter((d) => dayset.has(d))
        : cfg.working_days

      return {
        config: { ...cfg, working_days },
        slots,
        timetable: tt,
        entries: ttEntries,
        overrides: overridesByConfig.get(cfg.id) ?? [],
      }
    })
    .filter((v): v is TimetableViewData => v !== null)
    .sort((a, b) => a.config.created_at.localeCompare(b.config.created_at))
}

// Returns one TimetableViewData per active config the student's homerooms
// belong to (published timetables only).  Multiple grids are expected when
// the student is enrolled in homerooms across more than one active config.
export async function fetchTimetableForStudent(studentId: string): Promise<TimetableViewData[]> {
  const { data: memberships, error: mErr } = await supabase
    .from('homeroom_members')
    .select('homeroom_id')
    .eq('student_id', studentId)

  if (mErr) {
    console.error('fetchTimetableForStudent (memberships) error:', mErr)
    return []
  }
  const homeroomIds = ((memberships ?? []) as { homeroom_id: string }[]).map((m) => m.homeroom_id)
  if (homeroomIds.length === 0) return []

  const { data: activeConfigsRaw, error: cErr } = await supabase
    .from('timetable_configs')
    .select('*')
    .eq('is_active', true)
  if (cErr || !activeConfigsRaw?.length) return []
  const activeConfigs = activeConfigsRaw as TimetableConfig[]

  const activeConfigIds = activeConfigs.map((c) => c.id)

  const { data: publishedTimetablesRaw, error: tErr } = await supabase
    .from('timetables')
    .select('*')
    .in('config_id', activeConfigIds)
    .eq('status', 'published')
  if (tErr || !publishedTimetablesRaw?.length) return []
  const publishedTimetables = publishedTimetablesRaw as Timetable[]

  const publishedIds = publishedTimetables.map((t) => t.id)

  const { data: entries, error: eErr } = await supabase
    .from('timetable_entries')
    .select(ENTRY_SELECT)
    .in('timetable_id', publishedIds)
    .in('homeroom_id', homeroomIds)
  if (eErr) {
    console.error('fetchTimetableForStudent (entries) error:', eErr)
    return []
  }

  // Split classes: a student sees whole-class lessons plus only the group
  // lessons of the groups they belong to.
  const { data: groupRows } = await supabase
    .from('timetable_group_members')
    .select('group_id')
    .eq('student_id', studentId)
  const myGroups = new Set((groupRows ?? []).map((g: { group_id: string }) => g.group_id))
  const visible = ((entries ?? []) as TimetableEntry[]).filter(
    (e) => !e.group_id || myGroups.has(e.group_id),
  )

  return buildViewData(visible, activeConfigs, publishedTimetables)
}

// PostgREST's `.or()` takes a raw filter string, so anything interpolated into
// one has to be proven safe first: a stray comma or paren in the value would
// rewrite the filter rather than be compared against.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Returns one TimetableViewData per active config the teacher has a
// published teaching schedule in.
export async function fetchTimetableForStaff(teacherId: string): Promise<TimetableViewData[]> {
  if (!UUID_RE.test(teacherId)) {
    console.error('fetchTimetableForStaff: not a teacher id:', teacherId)
    return []
  }

  const { data: activeConfigsRaw, error: cErr } = await supabase
    .from('timetable_configs')
    .select('*')
    .eq('is_active', true)
  if (cErr || !activeConfigsRaw?.length) return []
  const activeConfigs = activeConfigsRaw as TimetableConfig[]

  const activeConfigIds = activeConfigs.map((c) => c.id)

  const { data: publishedTimetablesRaw, error: tErr } = await supabase
    .from('timetables')
    .select('*')
    .in('config_id', activeConfigIds)
    .eq('status', 'published')
  if (tErr || !publishedTimetablesRaw?.length) return []
  const publishedTimetables = publishedTimetablesRaw as Timetable[]

  const publishedIds = publishedTimetables.map((t) => t.id)

  const { data: entries, error: eErr } = await supabase
    .from('timetable_entries')
    .select(ENTRY_SELECT)
    .in('timetable_id', publishedIds)
    // Co-teaching: the period may list them in teacher_ids rather than as the
    // primary teacher_id.
    .or(`teacher_id.eq.${teacherId},teacher_ids.cs.{${teacherId}}`)
  if (eErr) {
    console.error('fetchTimetableForStaff (entries) error:', eErr)
    return []
  }

  return buildViewData(
    (entries ?? []) as TimetableEntry[],
    activeConfigs as TimetableConfig[],
    publishedTimetables as Timetable[],
  )
}

// Returns one TimetableViewData per active config the homeroom has a
// published timetable in. Staff-scoped (no membership filter) — used by
// the admin name-click viewer to see a whole class's week.
export async function fetchTimetableForHomeroom(homeroomId: string): Promise<TimetableViewData[]> {
  const { data: activeConfigsRaw, error: cErr } = await supabase
    .from('timetable_configs')
    .select('*')
    .eq('is_active', true)
  if (cErr || !activeConfigsRaw?.length) return []
  const activeConfigs = activeConfigsRaw as TimetableConfig[]

  const activeConfigIds = activeConfigs.map((c) => c.id)

  const { data: publishedTimetablesRaw, error: tErr } = await supabase
    .from('timetables')
    .select('*')
    .in('config_id', activeConfigIds)
    .eq('status', 'published')
  if (tErr || !publishedTimetablesRaw?.length) return []
  const publishedTimetables = publishedTimetablesRaw as Timetable[]

  const publishedIds = publishedTimetables.map((t) => t.id)

  const { data: entries, error: eErr } = await supabase
    .from('timetable_entries')
    .select(ENTRY_SELECT)
    .in('timetable_id', publishedIds)
    .eq('homeroom_id', homeroomId)
  if (eErr) {
    console.error('fetchTimetableForHomeroom (entries) error:', eErr)
    return []
  }

  return buildViewData(
    (entries ?? []) as TimetableEntry[],
    activeConfigs,
    publishedTimetables,
  )
}

// ============================================================
// Homeroom groups (Round 2)
// ============================================================

const GROUP_SELECT =
  '*, subject:timetable_subjects(*), members:timetable_group_members(*, student:profiles(id, full_name, avatar_url, role, email))'

export async function fetchGroupsForHomeroom(homeroomId: string): Promise<HomeroomGroup[]> {
  const { data, error } = await supabase
    .from('timetable_homeroom_groups')
    .select(GROUP_SELECT)
    .eq('homeroom_id', homeroomId)
    .order('created_at', { ascending: true })

  if (error) {
    console.error('fetchGroupsForHomeroom error:', error)
    return []
  }
  return (data ?? []) as HomeroomGroup[]
}

// Groups of several homerooms in one query — the grid editors need group names
// for every scheduled class, not just one.
export async function fetchGroupsForHomerooms(homeroomIds: string[]): Promise<HomeroomGroup[]> {
  if (homeroomIds.length === 0) return []
  const { data, error } = await supabase
    .from('timetable_homeroom_groups')
    .select('*, subject:timetable_subjects(*)')
    .in('homeroom_id', homeroomIds)
    .order('created_at', { ascending: true })

  if (error) {
    console.error('fetchGroupsForHomerooms error:', error)
    return []
  }
  return (data ?? []) as HomeroomGroup[]
}

export async function createGroup(
  input: Pick<HomeroomGroup, 'homeroom_id' | 'name'> &
    Partial<Pick<HomeroomGroup, 'kind' | 'subject_id' | 'color'>>,
): Promise<HomeroomGroup | null> {
  const { data, error } = await supabase
    .from('timetable_homeroom_groups')
    .insert(input)
    .select(GROUP_SELECT)
    .single()

  if (error) {
    console.error('createGroup error:', error)
    return null
  }
  return data as HomeroomGroup
}

export async function updateGroup(
  id: string,
  patch: Partial<Pick<HomeroomGroup, 'name' | 'kind' | 'subject_id' | 'color'>>,
): Promise<boolean> {
  const { error } = await supabase.from('timetable_homeroom_groups').update(patch).eq('id', id)
  if (error) {
    console.error('updateGroup error:', error)
    return false
  }
  return true
}

export async function deleteGroup(id: string): Promise<boolean> {
  const { error } = await supabase.from('timetable_homeroom_groups').delete().eq('id', id)
  if (error) {
    console.error('deleteGroup error:', error)
    return false
  }
  return true
}

/**
 * Adds students to a group from a column of emails. A student must already be
 * a member of the group's parent homeroom (you can't group someone into a class
 * they don't belong to); emails that don't match such a profile come back in
 * `failed` so the CSV import can report them. Resolves the whole column in a
 * fixed number of round trips rather than four per address.
 */
export async function bulkAddGroupMembersByEmails(
  groupId: string,
  emails: string[],
): Promise<{ added: number; failed: string[] }> {
  const wanted = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))]
  if (wanted.length === 0) return { added: 0, failed: [] }

  const { data: group, error: gErr } = await supabase
    .from('timetable_homeroom_groups')
    .select('homeroom_id')
    .eq('id', groupId)
    .single()
  if (gErr || !group) return { added: 0, failed: wanted }

  const [profilePages, { data: roster }] = await Promise.all([
    Promise.all(
      chunk(wanted).map((batch) => supabase.from('profiles').select('id, email').in('email', batch)),
    ),
    supabase.from('homeroom_members').select('student_id').eq('homeroom_id', group.homeroom_id),
  ])

  const inHomeroom = new Set((roster ?? []).map((r) => r.student_id))
  const idByEmail = new Map<string, string>()
  for (const page of profilePages) {
    for (const p of (page.data ?? []) as { id: string; email: string | null }[]) {
      if (p.email && inHomeroom.has(p.id)) idByEmail.set(p.email.toLowerCase(), p.id)
    }
  }

  const failed = wanted.filter((e) => !idByEmail.has(e))
  const { added } = await bulkAddGroupMembersByIds(groupId, [...idByEmail.values()])
  return { added, failed }
}

export async function removeGroupMember(groupId: string, studentId: string): Promise<boolean> {
  const { error } = await supabase
    .from('timetable_group_members')
    .delete()
    .eq('group_id', groupId)
    .eq('student_id', studentId)
  if (error) {
    console.error('removeGroupMember error:', error)
    return false
  }
  return true
}

/**
 * Bulk-adds students to a group by profile id (used by the CSV upload,
 * roster checkbox list, and classroom-filter bulk-add in the Homeroom hub).
 * Skips ids already in the group; upsert ignores unique-constraint duplicates.
 * Returns how many rows were newly inserted.
 */
export async function bulkAddGroupMembersByIds(
  groupId: string,
  studentIds: string[],
): Promise<{ added: number }> {
  const unique = Array.from(new Set(studentIds.filter(Boolean)))
  if (unique.length === 0) return { added: 0 }

  // Which are already members? Only insert the rest.
  const existingPages = await Promise.all(
    chunk(unique).map((batch) =>
      supabase
        .from('timetable_group_members')
        .select('student_id')
        .eq('group_id', groupId)
        .in('student_id', batch),
    ),
  )
  const have = new Set(
    existingPages.flatMap((p) => (p.data ?? []).map((r) => r.student_id as string)),
  )
  const toAdd = unique.filter((id) => !have.has(id))
  if (toAdd.length === 0) return { added: 0 }

  const { error } = await supabase
    .from('timetable_group_members')
    .insert(toAdd.map((student_id) => ({ group_id: groupId, student_id })))
  if (error) {
    console.error('bulkAddGroupMembersByIds error:', error)
    return { added: 0 }
  }
  return { added: toAdd.length }
}

/**
 * Returns the students who belong to BOTH the given classroom and the given
 * homeroom — the "subject based filtering" source for bulk-adding a subject
 * classroom's students into a homeroom group. Classrooms carry a subject tag,
 * so this filters a homeroom's roster down to (e.g.) its Biology students.
 */
export async function fetchClassroomStudentsInHomeroom(
  classroomId: string,
  homeroomId: string,
): Promise<UserProfile[]> {
  const [{ data: cm }, { data: hm }] = await Promise.all([
    supabase.from('classroom_members').select('user_id, role').eq('classroom_id', classroomId),
    supabase.from('homeroom_members').select('student_id').eq('homeroom_id', homeroomId),
  ])
  const inHomeroom = new Set((hm ?? []).map((r) => r.student_id))
  const studentIds = (cm ?? [])
    .filter((r) => r.role === 'student' && inHomeroom.has(r.user_id))
    .map((r) => r.user_id)
  if (studentIds.length === 0) return []

  const { data: profiles, error } = await supabase
    .from('profiles')
    .select('id, email, full_name, role, avatar_url, grade, section')
    .in('id', studentIds)
    .order('full_name', { ascending: true })
  if (error) {
    console.error('fetchClassroomStudentsInHomeroom error:', error)
    return []
  }
  return (profiles ?? []) as UserProfile[]
}

// ============================================================
// Combined classes (Round 6)
// ============================================================

// `teacher:` names its foreign key explicitly: the table also has created_by →
// profiles, and an unqualified embed is ambiguous (PostgREST PGRST201).
const COMBINED_SELECT =
  '*, subject:timetable_subjects(*), teacher:profiles!timetable_combined_classes_teacher_id_fkey(id, full_name, avatar_url, role), room:timetable_rooms(*), members:timetable_combined_members(*, group:timetable_homeroom_groups(*))'

export async function fetchCombinedClasses(configId: string): Promise<CombinedClass[]> {
  const { data, error } = await supabase
    .from('timetable_combined_classes')
    .select(COMBINED_SELECT)
    .eq('config_id', configId)
    .order('created_at', { ascending: true })

  if (error) {
    console.error('fetchCombinedClasses error:', error)
    return []
  }
  return (data ?? []) as CombinedClass[]
}

export async function createCombinedClass(input: {
  config_id: string
  name: string
  subject_id: string | null
  teacher_id: string | null
  teacher_ids?: string[]
  room_id: string | null
  periods_per_week: number
  // Round 10: a combined lesson takes the same scheduling controls as an
  // ordinary requirement. Omitted fields keep the pre-Round-10 behaviour —
  // a single classroom period, at most one a day.
  room_type?: RoomType
  max_per_day?: number
  min_block?: number
  max_block?: number
  members: { homeroomId: string; groupId: string | null }[]
}): Promise<CombinedClass | null> {
  const teacherIds = teacherIdsOf({ teacher_id: input.teacher_id, teacher_ids: input.teacher_ids ?? [] })
  const { data, error } = await supabase
    .from('timetable_combined_classes')
    .insert({
      config_id: input.config_id,
      name: input.name,
      subject_id: input.subject_id,
      teacher_id: teacherIds[0] ?? null,
      teacher_ids: teacherIds,
      room_id: input.room_id,
      periods_per_week: input.periods_per_week,
      room_type: input.room_type ?? 'classroom',
      max_per_day: input.max_per_day ?? 1,
      min_block: input.min_block ?? 1,
      max_block: input.max_block ?? 1,
    })
    .select()
    .single()

  if (error || !data) {
    console.error('createCombinedClass error:', error)
    return null
  }

  if (input.members.length > 0) {
    const { error: mErr } = await supabase
      .from('timetable_combined_members')
      .insert(input.members.map((m) => ({ combined_id: data.id, homeroom_id: m.homeroomId, group_id: m.groupId })))
    if (mErr) console.error('createCombinedClass (members) error:', mErr)
  }
  return data as CombinedClass
}

/**
 * Changes a combined lesson's scheduling. Its member classes are left alone —
 * they are edited by adding or removing members, not here.
 */
export async function updateCombinedClass(
  id: string,
  patch: Partial<
    Pick<
      CombinedClass,
      'name' | 'subject_id' | 'teacher_id' | 'teacher_ids' | 'room_id'
      | 'periods_per_week' | 'room_type' | 'max_per_day' | 'min_block' | 'max_block'
    >
  >,
): Promise<CombinedClass | null> {
  const { data, error } = await supabase
    .from('timetable_combined_classes')
    .update(patch)
    .eq('id', id)
    .select()
    .single()
  if (error) {
    console.error('updateCombinedClass error:', error)
    return null
  }
  return data as CombinedClass
}

export async function deleteCombinedClass(id: string): Promise<boolean> {
  const { error } = await supabase.from('timetable_combined_classes').delete().eq('id', id)
  if (error) {
    console.error('deleteCombinedClass error:', error)
    return false
  }
  return true
}

// ============================================================
// Slot groups (Round 9) — several bell schedules in one config
// ============================================================
// A config's "base" schedule is config.working_days plus the period slots with
// group_id null. A slot group overrides both for the homerooms assigned to it.
// A config with no groups therefore behaves exactly as it always did.

export async function fetchSlotGroups(configId: string): Promise<SlotGroup[]> {
  const { data, error } = await supabase
    .from('timetable_slot_groups')
    .select('*')
    .eq('config_id', configId)
    .order('position', { ascending: true })
  if (error) {
    console.error('fetchSlotGroups error:', error)
    return []
  }
  return (data ?? []) as SlotGroup[]
}

export async function createSlotGroup(
  input: Pick<SlotGroup, 'config_id' | 'name'> &
    Partial<Pick<SlotGroup, 'working_days' | 'position' | 'color'>>,
): Promise<SlotGroup | null> {
  const { data, error } = await supabase.from('timetable_slot_groups').insert(input).select().single()
  if (error) {
    console.error('createSlotGroup error:', error)
    return null
  }
  return data as SlotGroup
}

export async function updateSlotGroup(
  id: string,
  patch: Partial<Pick<SlotGroup, 'name' | 'working_days' | 'position' | 'color'>>,
): Promise<boolean> {
  const { error } = await supabase.from('timetable_slot_groups').update(patch).eq('id', id)
  if (error) {
    console.error('updateSlotGroup error:', error)
    return false
  }
  return true
}

// Cascades to the group's period slots and its homeroom assignments, which
// drop those classes back onto the config's base schedule.
export async function deleteSlotGroup(id: string): Promise<boolean> {
  const { error } = await supabase.from('timetable_slot_groups').delete().eq('id', id)
  if (error) {
    console.error('deleteSlotGroup error:', error)
    return false
  }
  return true
}

export async function fetchSlotGroupHomerooms(configId: string): Promise<SlotGroupHomeroom[]> {
  const { data, error } = await supabase
    .from('timetable_slot_group_homerooms')
    .select('*')
    .eq('config_id', configId)
  if (error) {
    console.error('fetchSlotGroupHomerooms error:', error)
    return []
  }
  return (data ?? []) as SlotGroupHomeroom[]
}

/**
 * Points a homeroom at a slot group, or back at the base schedule when
 * `groupId` is null. One row per (config, homeroom) — the upsert relies on that
 * unique index so switching groups is a single round trip.
 */
export async function assignHomeroomToSlotGroup(
  configId: string,
  homeroomId: string,
  groupId: string | null,
): Promise<boolean> {
  if (!groupId) {
    const { error } = await supabase
      .from('timetable_slot_group_homerooms')
      .delete()
      .eq('config_id', configId)
      .eq('homeroom_id', homeroomId)
    if (error) {
      console.error('assignHomeroomToSlotGroup (clear) error:', error)
      return false
    }
    return true
  }
  const { error } = await supabase
    .from('timetable_slot_group_homerooms')
    .upsert(
      { config_id: configId, homeroom_id: homeroomId, group_id: groupId },
      { onConflict: 'config_id,homeroom_id' },
    )
  if (error) {
    console.error('assignHomeroomToSlotGroup error:', error)
    return false
  }
  return true
}

/**
 * Points many homerooms at a slot group (or back at the base schedule) in one
 * round trip. Assigning a whole grade is the normal case — a year group almost
 * always rings to the same bell — so doing it one class at a time would cost a
 * request per class.
 */
export async function assignHomeroomsToSlotGroup(
  configId: string,
  homeroomIds: string[],
  groupId: string | null,
): Promise<boolean> {
  if (homeroomIds.length === 0) return true

  if (!groupId) {
    // PostgREST puts `.in()` lists in the query string, so a whole-school
    // clear has to be chunked or the URL overruns.
    for (const batch of chunk(homeroomIds)) {
      const { error } = await supabase
        .from('timetable_slot_group_homerooms')
        .delete()
        .eq('config_id', configId)
        .in('homeroom_id', batch)
      if (error) {
        console.error('assignHomeroomsToSlotGroup (clear) error:', error)
        return false
      }
    }
    return true
  }

  for (const batch of chunk(homeroomIds)) {
    const { error } = await supabase
      .from('timetable_slot_group_homerooms')
      .upsert(
        batch.map((homeroom_id) => ({ config_id: configId, homeroom_id, group_id: groupId })),
        { onConflict: 'config_id,homeroom_id' },
      )
    if (error) {
      console.error('assignHomeroomsToSlotGroup error:', error)
      return false
    }
  }
  return true
}

/** homeroomId -> slot group id (absent = the base schedule). */
export function slotGroupMap(rows: SlotGroupHomeroom[]): Record<string, string | null> {
  const out: Record<string, string | null> = {}
  for (const r of rows) out[r.homeroom_id] = r.group_id
  return out
}

/**
 * The distinct weeks a config is scheduled against, base first.
 *
 * A group with no periods yet is KEPT: the solver schedules a class assigned to
 * it against that empty week and places nothing, so hiding the week here would
 * quietly show the admin the base schedule instead and make the empty result
 * look like a bug rather than a group that still needs its periods.
 */
export function scheduleWeeks(
  config: TimetableConfig,
  slots: PeriodSlot[],
  groups: SlotGroup[],
): ScheduleWeek[] {
  const teaching = (groupId: string | null) =>
    slots
      .filter((s) => !s.is_break && (s.group_id ?? null) === groupId)
      .sort((a, b) => a.position - b.position)

  const weeks: ScheduleWeek[] = [
    { groupId: null, name: 'Base schedule', days: config.working_days, slots: teaching(null) },
  ]
  for (const g of [...groups].sort((a, b) => a.position - b.position)) {
    weeks.push({
      groupId: g.id,
      name: g.name,
      days: g.working_days.length > 0 ? g.working_days : config.working_days,
      slots: teaching(g.id),
    })
  }
  // The base week is only worth listing when something can actually run in it.
  return weeks.filter((w) => w.groupId !== null || w.slots.length > 0)
}

/**
 * The week one homeroom follows.
 *
 * An unassigned class follows the base schedule — unless the base has no
 * periods of its own, which happens as soon as an admin moves the school's
 * periods into a group. It then follows the first schedule that does have
 * periods, matching what the solver does, so the grid never shows a class a
 * week the solver is not scheduling it against.
 */
export function weekForHomeroom(
  weeks: ScheduleWeek[],
  groupIds: Record<string, string | null>,
  homeroomId: string,
): ScheduleWeek {
  const gid = groupIds[homeroomId] ?? null
  const own = weeks.find((w) => w.groupId === gid)
  if (own) return own
  const base = weeks.find((w) => w.groupId === null)
  if (base && base.slots.length > 0) return base
  return weeks.find((w) => w.slots.length > 0) ?? base ?? weeks[0]
}
