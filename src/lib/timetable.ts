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

// Marks one config active and clears the flag on all others.
export async function setActiveConfig(id: string): Promise<boolean> {
  const clear = await supabase
    .from('timetable_configs')
    .update({ is_active: false })
    .neq('id', id)
  if (clear.error) {
    console.error('setActiveConfig (clear) error:', clear.error)
    return false
  }
  const { error } = await supabase
    .from('timetable_configs')
    .update({ is_active: true })
    .eq('id', id)
  if (error) {
    console.error('setActiveConfig (set) error:', error)
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

  const rows = entries.map((e) => ({
    timetable_id: timetableId,
    homeroom_id: e.homeroomId,
    day: e.day,
    slot_id: e.slotId,
    subject_id: e.subjectId,
    teacher_id: e.teacherId,
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

// Publishes a timetable and demotes any other published timetable for the
// same config back to draft, so exactly one is live per config.
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
  return true
}

// ============================================================
// Viewer fetchers (student / staff)
// ============================================================

// Resolves the homeroom(s) a student belongs to, then returns the entries
// of the currently published timetable for those homerooms.
export async function fetchTimetableForStudent(studentId: string): Promise<TimetableEntry[]> {
  const { data: memberships, error: mErr } = await supabase
    .from('homeroom_members')
    .select('homeroom_id')
    .eq('student_id', studentId)

  if (mErr) {
    console.error('fetchTimetableForStudent (memberships) error:', mErr)
    return []
  }
  const homeroomIds = (memberships ?? []).map((m) => m.homeroom_id)
  if (homeroomIds.length === 0) return []

  const { data, error } = await supabase
    .from('timetable_entries')
    .select(`${ENTRY_SELECT}, timetable:timetables!inner(status)`)
    .in('homeroom_id', homeroomIds)
    .eq('timetable.status', 'published')

  if (error) {
    console.error('fetchTimetableForStudent (entries) error:', error)
    return []
  }
  return (data ?? []) as TimetableEntry[]
}

// Resolves the config + ordered period slots backing a given timetable, so a
// viewer can render the grid (working days, period times, breaks).
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

// Returns the published teaching schedule for a staff member.
export async function fetchTimetableForStaff(teacherId: string): Promise<TimetableEntry[]> {
  const { data, error } = await supabase
    .from('timetable_entries')
    .select(`${ENTRY_SELECT}, timetable:timetables!inner(status)`)
    .eq('teacher_id', teacherId)
    .eq('timetable.status', 'published')

  if (error) {
    console.error('fetchTimetableForStaff error:', error)
    return []
  }
  return (data ?? []) as TimetableEntry[]
}
