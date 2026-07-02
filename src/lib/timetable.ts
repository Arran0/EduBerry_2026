import { supabase } from './supabase'
import type {
  Subject,
  Room,
  RoomType,
  TimetableConfig,
  PeriodSlot,
  Requirement,
  TeacherUnavailability,
  Timetable,
  TimetableEntry,
  TimetableStatus,
  TimetableViewData,
  Weekday,
  PlacedEntry,
  HomeroomGroup,
  TimetableConstraint,
  ConstraintScope,
  ConstraintType,
} from './timetable/types'

// Re-export types so feature code can import everything from '@/lib/timetable'.
export * from './timetable/types'

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

export async function updateSubject(
  id: string,
  patch: Partial<Pick<Subject, 'name' | 'code' | 'color'>>,
): Promise<boolean> {
  const { error } = await supabase.from('timetable_subjects').update(patch).eq('id', id)
  if (error) {
    console.error('updateSubject error:', error)
    return false
  }
  return true
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

export async function updateRoom(
  id: string,
  patch: Partial<Pick<Room, 'name' | 'room_type' | 'capacity'>>,
): Promise<boolean> {
  const { error } = await supabase.from('timetable_rooms').update(patch).eq('id', id)
  if (error) {
    console.error('updateRoom error:', error)
    return false
  }
  return true
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

export async function fetchActiveConfig(): Promise<TimetableConfig | null> {
  const { data, error } = await supabase
    .from('timetable_configs')
    .select('*')
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    console.error('fetchActiveConfig error:', error)
    return null
  }
  return data
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
    Partial<Pick<PeriodSlot, 'label' | 'is_break' | 'start_time' | 'end_time'>>,
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

export async function updatePeriodSlot(
  id: string,
  patch: Partial<Pick<PeriodSlot, 'position' | 'label' | 'start_time' | 'end_time' | 'is_break'>>,
): Promise<boolean> {
  const { error } = await supabase.from('timetable_period_slots').update(patch).eq('id', id)
  if (error) {
    console.error('updatePeriodSlot error:', error)
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

export async function fetchRequirements(configId: string): Promise<Requirement[]> {
  const { data, error } = await supabase
    .from('timetable_requirements')
    .select('*, subject:timetable_subjects(*), teacher:profiles(*), group:timetable_homeroom_groups(*)')
    .eq('config_id', configId)
    .order('created_at', { ascending: true })

  if (error) {
    console.error('fetchRequirements error:', error)
    return []
  }
  return (data ?? []) as Requirement[]
}

export async function createRequirement(
  input: Pick<Requirement, 'config_id' | 'homeroom_id' | 'subject_id'> &
    Partial<Pick<Requirement, 'teacher_id' | 'periods_per_week' | 'room_type' | 'max_per_day' | 'min_block' | 'max_block' | 'group_id'>>,
): Promise<Requirement | null> {
  const { data, error } = await supabase
    .from('timetable_requirements')
    .insert(input)
    .select()
    .single()

  if (error) {
    console.error('createRequirement error:', error)
    return null
  }
  return data
}

export async function updateRequirement(
  id: string,
  patch: Partial<
    Pick<Requirement, 'teacher_id' | 'periods_per_week' | 'room_type' | 'max_per_day' | 'subject_id' | 'min_block' | 'max_block' | 'group_id'>
  >,
): Promise<boolean> {
  const { error } = await supabase.from('timetable_requirements').update(patch).eq('id', id)
  if (error) {
    console.error('updateRequirement error:', error)
    return false
  }
  return true
}

export async function deleteRequirement(id: string): Promise<boolean> {
  const { error } = await supabase.from('timetable_requirements').delete().eq('id', id)
  if (error) {
    console.error('deleteRequirement error:', error)
    return false
  }
  return true
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

export async function addUnavailability(
  input: Pick<TeacherUnavailability, 'config_id' | 'teacher_id' | 'day' | 'slot_id'>,
): Promise<TeacherUnavailability | null> {
  const { data, error } = await supabase
    .from('teacher_unavailability')
    .insert(input)
    .select()
    .single()

  if (error) {
    console.error('addUnavailability error:', error)
    return null
  }
  return data
}

export async function removeUnavailability(id: string): Promise<boolean> {
  const { error } = await supabase.from('teacher_unavailability').delete().eq('id', id)
  if (error) {
    console.error('removeUnavailability error:', error)
    return false
  }
  return true
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

export async function deleteTimetable(id: string): Promise<boolean> {
  const { error } = await supabase.from('timetables').delete().eq('id', id)
  if (error) {
    console.error('deleteTimetable error:', error)
    return false
  }
  return true
}

export async function updateTimetableMeta(id: string, patch: { name?: string }): Promise<boolean> {
  const { error } = await supabase.from('timetables').update(patch).eq('id', id)
  if (error) {
    console.error('updateTimetableMeta error:', error)
    return false
  }
  return true
}

export async function fetchAllTimetablesWithConfig(): Promise<Array<Timetable & { config: TimetableConfig }>> {
  const { data, error } = await supabase
    .from('timetables')
    .select('*, config:timetable_configs(*)')
    .order('created_at', { ascending: false })
  if (error) {
    console.error('fetchAllTimetablesWithConfig error:', error)
    return []
  }
  return (data ?? []) as Array<Timetable & { config: TimetableConfig }>
}

const ENTRY_SELECT =
  '*, subject:timetable_subjects(*), teacher:profiles(*), room:timetable_rooms(*), group:timetable_homeroom_groups(*)'

export async function fetchEntries(timetableId: string): Promise<TimetableEntry[]> {
  const { data, error } = await supabase
    .from('timetable_entries')
    .select(ENTRY_SELECT)
    .eq('timetable_id', timetableId)

  if (error) {
    console.error('fetchEntries error:', error)
    return []
  }
  return (data ?? []) as TimetableEntry[]
}

// Replaces all entries for a timetable with a freshly generated set
// (used when persisting a draft from the generator). Locked cells are
// expected to already be present in `entries`.
export async function replaceEntries(
  timetableId: string,
  entries: PlacedEntry[],
): Promise<boolean> {
  const del = await supabase.from('timetable_entries').delete().eq('timetable_id', timetableId)
  if (del.error) {
    console.error('replaceEntries (delete) error:', del.error)
    return false
  }
  if (entries.length === 0) return true

  // Resolve teacher display names (the caller — an admin — can read profiles)
  // so students who cannot read staff profiles still see the teacher per period.
  const teacherIds = [...new Set(entries.map((e) => e.teacherId).filter(Boolean) as string[])]
  const nameById = new Map<string, string>()
  if (teacherIds.length > 0) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, full_name')
      .in('id', teacherIds)
    for (const p of profiles ?? []) nameById.set(p.id, p.full_name)
  }

  const rows = entries.map((e) => ({
    timetable_id: timetableId,
    homeroom_id: e.homeroomId,
    day: e.day,
    slot_id: e.slotId,
    subject_id: e.subjectId || null,  // '' is not a valid UUID; coerce to null
    teacher_id: e.teacherId,
    teacher_name: e.teacherId ? nameById.get(e.teacherId) ?? null : null,
    room_id: e.roomId,
    is_locked: e.isLocked,
    group_id: e.groupId ?? null,
    split_key: e.splitKey ?? null,
    combined_key: e.combinedKey ?? null,
  }))
  const { error } = await supabase.from('timetable_entries').insert(rows)
  if (error) {
    console.error('replaceEntries (insert) error:', error.code, error.message, error.details, error.hint)
    return false
  }
  return true
}

export async function updateEntry(
  id: string,
  patch: Partial<{
    subject_id: string | null
    teacher_id: string | null
    room_id: string | null
    is_locked: boolean
  }>,
): Promise<boolean> {
  const { error } = await supabase.from('timetable_entries').update(patch).eq('id', id)
  if (error) {
    console.error('updateEntry error:', error)
    return false
  }
  return true
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

// Resolves the config + ordered period slots backing a given timetable.
// Used internally and by admin components that need a single timetable's context.
export async function fetchTimetableContext(
  timetableId: string,
): Promise<{ config: TimetableConfig; slots: PeriodSlot[] } | null> {
  const { data: tt, error } = await supabase
    .from('timetables')
    .select('config_id')
    .eq('id', timetableId)
    .maybeSingle()
  if (error || !tt) {
    if (error) console.error('fetchTimetableContext error:', error)
    return null
  }
  const [{ data: cfg }, slots] = await Promise.all([
    supabase.from('timetable_configs').select('*').eq('id', tt.config_id).maybeSingle(),
    fetchPeriodSlots(tt.config_id),
  ])
  if (!cfg) return null
  return { config: cfg as TimetableConfig, slots }
}

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

  const { data: allSlots } = await supabase
    .from('timetable_period_slots')
    .select('*')
    .in('config_id', involvedConfigIds)
    .order('position', { ascending: true })

  const slotsMap = new Map<string, PeriodSlot[]>()
  for (const s of (allSlots ?? []) as PeriodSlot[]) {
    const arr = slotsMap.get(s.config_id) ?? []
    arr.push(s)
    slotsMap.set(s.config_id, arr)
  }

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
      return {
        config: cfg,
        slots: slotsMap.get(cfg.id) ?? [],
        timetable: tt,
        entries: ttEntries,
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

// Returns one TimetableViewData per active config the teacher has a
// published teaching schedule in.
export async function fetchTimetableForStaff(teacherId: string): Promise<TimetableViewData[]> {
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
    .eq('teacher_id', teacherId)
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
  '*, subject:timetable_subjects(*), members:timetable_group_members(*, student:profiles(*))'

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

// Adds a student to a group by email. The student must already be a member
// of the group's parent homeroom (you can't group someone into a class they
// don't belong to). Returns a typed result so the UI can report which emails
// resolved and which didn't.
export async function addGroupMemberByEmail(
  groupId: string,
  email: string,
): Promise<{ success: boolean; error?: string }> {
  const trimmed = email.trim().toLowerCase()
  if (!trimmed) return { success: false, error: 'Empty email' }

  // Resolve the group's parent homeroom.
  const { data: group, error: gErr } = await supabase
    .from('timetable_homeroom_groups')
    .select('homeroom_id')
    .eq('id', groupId)
    .single()
  if (gErr || !group) return { success: false, error: 'Group not found' }

  // Resolve the email to a profile.
  const { data: profile, error: pErr } = await supabase
    .from('profiles')
    .select('id, role')
    .eq('email', trimmed)
    .single()
  if (pErr || !profile) return { success: false, error: 'No user found with that email' }

  // They must belong to the parent homeroom.
  const { data: membership } = await supabase
    .from('homeroom_members')
    .select('id')
    .eq('homeroom_id', group.homeroom_id)
    .eq('student_id', profile.id)
    .maybeSingle()
  if (!membership) {
    return { success: false, error: 'That student is not in this homeroom' }
  }

  const { error: insErr } = await supabase
    .from('timetable_group_members')
    .insert({ group_id: groupId, student_id: profile.id })
  if (insErr) {
    // Unique-violation → already a member.
    if (insErr.code === '23505') return { success: false, error: 'Already in this group' }
    console.error('addGroupMemberByEmail error:', insErr)
    return { success: false, error: 'Could not add student' }
  }
  return { success: true }
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
