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
  input: Pick<PeriodSlot, 'config_id' | 'position' | 'start_time' | 'end_time'> &
    Partial<Pick<PeriodSlot, 'label' | 'is_break'>>,
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
    .select('*, subject:timetable_subjects(*), teacher:profiles(*)')
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
    Partial<Pick<Requirement, 'teacher_id' | 'periods_per_week' | 'room_type' | 'max_per_day'>>,
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
    Pick<Requirement, 'teacher_id' | 'periods_per_week' | 'room_type' | 'max_per_day' | 'subject_id'>
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
  '*, subject:timetable_subjects(*), teacher:profiles(*), room:timetable_rooms(*)'

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
    subject_id: e.subjectId,
    teacher_id: e.teacherId,
    teacher_name: e.teacherId ? nameById.get(e.teacherId) ?? null : null,
    room_id: e.roomId,
    is_locked: e.isLocked,
  }))
  const { error } = await supabase.from('timetable_entries').insert(rows)
  if (error) {
    console.error('replaceEntries (insert) error:', error)
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

  return buildViewData(
    (entries ?? []) as TimetableEntry[],
    activeConfigs,
    publishedTimetables,
  )
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
