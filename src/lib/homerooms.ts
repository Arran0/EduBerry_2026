import { supabase, UserProfile } from './supabase'

// ============================================
// Types
// ============================================

export interface SmartboardBanner {
  title?: string | null
  image_url?: string | null
  color_from?: string | null
  color_to?: string | null
}

export interface Homeroom {
  id: string
  name: string
  grade: number | null
  section: string | null
  academic_year: string | null
  expiry_date: string | null
  created_by: string | null
  /** Profile id of the homeroom's class teacher (the teacher who owns it), if set. */
  class_teacher_id: string | null
  /** Profile id of this homeroom's smart board login account, if provisioned. */
  smartboard_id: string | null
  /** Customisable banner config for the smart board dashboard. */
  smartboard_banner: SmartboardBanner | null
  created_at: string
  updated_at: string
  /** Only populated by queries that explicitly join it in (e.g. searchHomerooms). */
  class_teacher?: HomeroomClassTeacher | null
}

/** Slim profile summary for a homeroom's class teacher, as returned by joined queries. */
export interface HomeroomClassTeacher {
  id: string
  full_name: string
  email: string
  avatar_url: string | null
}

/** PostgREST returns a to-one embed as an object, but returns it as a single-
 *  element array in some ambiguous-relationship cases — normalize either shape. */
export function normalizeClassTeacher(raw: unknown): HomeroomClassTeacher | null {
  const t = Array.isArray(raw) ? raw[0] : raw
  return (t as HomeroomClassTeacher | undefined) ?? null
}

export interface HomeroomMember {
  id: string
  homeroom_id: string
  student_id: string
  created_at: string
  student?: UserProfile
}

export interface HomeroomWithMembers extends Homeroom {
  members: HomeroomMember[]
}

// ============================================
// Fetch
// ============================================

export async function fetchAllHomerooms(): Promise<Homeroom[]> {
  const { data, error } = await supabase
    .from('homerooms')
    .select('*')
    .order('grade', { ascending: true, nullsFirst: false })
    .order('section', { ascending: true, nullsFirst: false })
    .order('name', { ascending: true })

  if (error) {
    console.error('fetchAllHomerooms error:', error)
    return []
  }
  return data ?? []
}

/** Homerooms the given teacher is the class teacher of (owns via
 *  homerooms.class_teacher_id). A teacher is never a homeroom member — the
 *  class teacher lives on the homeroom row — so they are never counted among
 *  the students. */
export async function fetchHomeroomsForClassTeacher(teacherId: string): Promise<Homeroom[]> {
  const { data, error } = await supabase
    .from('homerooms')
    .select('*')
    .eq('class_teacher_id', teacherId)
    .order('grade', { ascending: true, nullsFirst: false })
    .order('section', { ascending: true, nullsFirst: false })
    .order('name', { ascending: true })

  if (error) {
    console.error('fetchHomeroomsForClassTeacher error:', error)
    return []
  }
  return data ?? []
}

// Searches by name (ilike) or by parsing "7A" / "7 A" / "grade 7" style queries.
export async function searchHomerooms(query: string): Promise<Homeroom[]> {
  const q = query.trim()
  if (!q) return fetchAllHomerooms()

  // Try to parse grade+section patterns like "7A", "7 A", "grade 7 a"
  const gradeSecMatch = q.match(/^(?:grade\s*)?(\d{1,2})\s*([a-fA-F]?)$/)

  let dbQuery = supabase
    .from('homerooms')
    .select('*, class_teacher:profiles!homerooms_class_teacher_id_fkey(id, full_name, email, avatar_url)')

  if (gradeSecMatch) {
    const grade = parseInt(gradeSecMatch[1], 10)
    const section = gradeSecMatch[2].toUpperCase() || null

    if (section) {
      dbQuery = dbQuery.eq('grade', grade).ilike('section', section)
    } else {
      dbQuery = dbQuery.eq('grade', grade)
    }
  } else {
    dbQuery = dbQuery.ilike('name', `%${q}%`)
  }

  const { data, error } = await dbQuery
    .order('grade', { ascending: true, nullsFirst: false })
    .order('section', { ascending: true, nullsFirst: false })
    .order('name', { ascending: true })
    .limit(20)

  if (error) {
    console.error('searchHomerooms error:', error)
    return []
  }
  return (data ?? []).map(h => ({ ...h, class_teacher: normalizeClassTeacher(h.class_teacher) }))
}

export async function fetchHomeroomWithMembers(homeroomId: string): Promise<HomeroomWithMembers | null> {
  const [{ data: homeroom, error: hrError }, { data: members, error: memError }] = await Promise.all([
    supabase.from('homerooms').select('*').eq('id', homeroomId).single(),
    supabase
      .from('homeroom_members')
      .select(`*, student:profiles!homeroom_members_student_id_fkey(id, email, full_name, role, avatar_url, grade, section)`)
      .eq('homeroom_id', homeroomId)
      .order('created_at', { ascending: true }),
  ])

  if (hrError || !homeroom) {
    console.error('fetchHomeroomWithMembers error:', hrError)
    return null
  }

  if (memError) {
    console.error('fetchHomeroomWithMembers members error:', memError)
    return { ...homeroom, members: [] }
  }

  const normalizedMembers: HomeroomMember[] = (members ?? []).map(m => ({
    ...m,
    student: Array.isArray(m.student) ? m.student[0] as UserProfile : m.student as UserProfile | undefined,
  }))
  return { ...homeroom, members: normalizedMembers }
}

export async function fetchHomeromsForStudent(studentId: string): Promise<Homeroom[]> {
  const { data, error } = await supabase
    .from('homeroom_members')
    .select('homeroom:homerooms(*)')
    .eq('student_id', studentId)

  if (error) {
    console.error('fetchHomeromsForStudent error:', error)
    return []
  }

  return (data ?? [])
    .map(row => Array.isArray(row.homeroom) ? row.homeroom[0] : row.homeroom)
    .filter((h): h is Homeroom => h != null)
}

// ============================================
// Create / Update / Delete
// ============================================

export async function createHomeroom(
  name: string,
  grade?: number | null,
  section?: string | null,
  createdBy?: string,
  academicYear?: string | null,
  expiryDate?: string | null
): Promise<Homeroom | null> {
  const { data, error } = await supabase
    .from('homerooms')
    .insert({
      name,
      grade: grade ?? null,
      section: section ?? null,
      created_by: createdBy ?? null,
      academic_year: academicYear ?? null,
      expiry_date: expiryDate ?? null,
    })
    .select()
    .single()

  if (error) {
    console.error('createHomeroom error:', error)
    return null
  }
  return data
}

export async function updateHomeroom(
  id: string,
  name: string,
  grade?: number | null,
  section?: string | null,
  academicYear?: string | null,
  expiryDate?: string | null
): Promise<Homeroom | null> {
  const { data, error } = await supabase
    .from('homerooms')
    .update({
      name,
      grade: grade ?? null,
      section: section ?? null,
      ...(academicYear !== undefined ? { academic_year: academicYear } : {}),
      ...(expiryDate !== undefined ? { expiry_date: expiryDate } : {}),
    })
    .eq('id', id)
    .select()
    .single()

  if (error) {
    console.error('updateHomeroom error:', error)
    return null
  }
  return data
}

/** Sets (or clears, with null) the class teacher for a homeroom. */
export async function updateHomeroomClassTeacher(
  homeroomId: string,
  teacherId: string | null,
): Promise<boolean> {
  const { error } = await supabase
    .from('homerooms')
    .update({ class_teacher_id: teacherId })
    .eq('id', homeroomId)

  if (error) {
    console.error('updateHomeroomClassTeacher error:', error)
    return false
  }
  return true
}

export async function deleteHomeroom(id: string): Promise<boolean> {
  const { error } = await supabase.from('homerooms').delete().eq('id', id)
  if (error) {
    console.error('deleteHomeroom error:', error)
    return false
  }
  return true
}

// ============================================
// Member Management
// ============================================

export async function addHomeroomMember(homeroomId: string, studentId: string): Promise<boolean> {
  const { error } = await supabase
    .from('homeroom_members')
    .insert({ homeroom_id: homeroomId, student_id: studentId })

  if (error) {
    console.error('addHomeroomMember error:', error)
    return false
  }
  return true
}

export async function addHomeroomMemberByEmail(
  homeroomId: string,
  email: string
): Promise<{ success: boolean; error?: string; linkedSmartboard?: boolean }> {
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id, role')
    .eq('email', email.trim().toLowerCase())
    .single()

  if (profileError || !profile) {
    return { success: false, error: 'No user found with that email' }
  }

  // Smart boards aren't homeroom members (they'd show up in the mark sheet) —
  // link them as the homeroom's board account instead.
  if (profile.role === 'smartboard') {
    const result = await linkSmartboardToHomeroom(homeroomId, email)
    return { success: result.success, error: result.error, linkedSmartboard: result.success }
  }

  if (profile.role !== 'student') {
    return { success: false, error: 'Only students or smart boards can be added to homerooms' }
  }

  const success = await addHomeroomMember(homeroomId, profile.id)
  return { success, error: success ? undefined : 'Failed to add student (may already be a member)' }
}

export async function removeHomeroomMember(homeroomId: string, studentId: string): Promise<boolean> {
  const { error } = await supabase
    .from('homeroom_members')
    .delete()
    .eq('homeroom_id', homeroomId)
    .eq('student_id', studentId)

  if (error) {
    console.error('removeHomeroomMember error:', error)
    return false
  }
  return true
}

/**
 * Every classroom that holds at least one student of these homerooms — the set
 * a class teacher may map homework onto from the homeroom calendar. Returns
 * plain classroom rows (id + title are what the pickers need), sorted by title.
 *
 * This runs through the `get_homeroom_classrooms` RPC because the join is
 * invisible to a class teacher from the client: `classroom_members` and
 * `classrooms` are only selectable for classrooms you belong to, created, or
 * coordinate, and a class teacher is none of those for the classes their
 * students attend with other teachers. The RPC is SECURITY DEFINER and checks
 * the caller owns the homeroom (see
 * supabase-migrations/add_homeroom_classrooms_rpc.sql).
 *
 * Until that migration is applied the RPC is missing, so we fall back to the
 * direct queries — correct for admins and principals, and for the classrooms a
 * teacher created themselves, which is all RLS would have allowed anyway.
 */
export async function fetchClassroomsHoldingHomeroomStudents(
  homeroomIds: string[],
): Promise<{ id: string; title: string }[]> {
  if (homeroomIds.length === 0) return []

  const viaRpc = await Promise.all(
    homeroomIds.map(id => supabase.rpc('get_homeroom_classrooms', { p_homeroom_id: id })),
  )

  // PGRST202 = the function isn't deployed yet; anything else is a real error
  // worth surfacing rather than silently degrading.
  const missingRpc = viaRpc.some(r => r.error?.code === 'PGRST202')
  if (!missingRpc) {
    const byId = new Map<string, { id: string; title: string }>()
    for (const res of viaRpc) {
      if (res.error) {
        console.error('fetchClassroomsHoldingHomeroomStudents rpc error:', res.error)
        continue
      }
      for (const row of (res.data ?? []) as { id: string; title: string }[]) byId.set(row.id, row)
    }
    return [...byId.values()].sort((a, b) => a.title.localeCompare(b.title))
  }

  console.warn(
    'get_homeroom_classrooms RPC not found — falling back to direct queries. ' +
    'Apply supabase-migrations/add_homeroom_classrooms_rpc.sql so class teachers ' +
    'can see the classrooms their homeroom students attend.',
  )

  const { data: members, error: memErr } = await supabase
    .from('homeroom_members')
    .select('student_id')
    .in('homeroom_id', homeroomIds)

  if (memErr) {
    console.error('fetchClassroomsHoldingHomeroomStudents members error:', memErr)
    return []
  }

  const studentIds = [...new Set((members ?? []).map((m: { student_id: string }) => m.student_id))]
  if (studentIds.length === 0) return []

  const { data: enrolments, error: enrErr } = await supabase
    .from('classroom_members')
    .select('classroom_id')
    .in('user_id', studentIds)
    .eq('role', 'student')

  if (enrErr) {
    console.error('fetchClassroomsHoldingHomeroomStudents enrolments error:', enrErr)
    return []
  }

  const classroomIds = [...new Set((enrolments ?? []).map((e: { classroom_id: string }) => e.classroom_id))]
  if (classroomIds.length === 0) return []

  const { data: classrooms, error: clsErr } = await supabase
    .from('classrooms')
    .select('id, title')
    .in('id', classroomIds)
    .order('title', { ascending: true })

  if (clsErr) {
    console.error('fetchClassroomsHoldingHomeroomStudents classrooms error:', clsErr)
    return []
  }
  return (classrooms ?? []) as { id: string; title: string }[]
}

// ============================================
// Display Helpers
// ============================================

export function homeroomDisplayName(homeroom: Homeroom): string {
  return homeroom.name
}

// ============================================
// Smart Board Account
// ============================================

/** Fetches the smart board login profile linked to a homeroom, if any. */
export async function fetchHomeroomSmartboard(homeroomId: string): Promise<UserProfile | null> {
  const { data: hr } = await supabase
    .from('homerooms')
    .select('smartboard_id')
    .eq('id', homeroomId)
    .single()

  if (!hr?.smartboard_id) return null

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, email, full_name, role, avatar_url, grade, section, created_at, updated_at')
    .eq('id', hr.smartboard_id)
    .single()

  return (profile as UserProfile) ?? null
}

/** Returns the homeroom whose smart board account is the given profile id. */
export async function fetchHomeroomForSmartboard(smartboardId: string): Promise<Homeroom | null> {
  const { data, error } = await supabase
    .from('homerooms')
    .select('*')
    .eq('smartboard_id', smartboardId)
    .maybeSingle()

  if (error) {
    console.error('fetchHomeroomForSmartboard error:', error)
    return null
  }
  return data ?? null
}

/** Links an existing smart board account (e.g. created in the Profile Manager)
 *  to a homeroom. Validates the account's role and that it isn't already the
 *  board of another homeroom. */
export async function linkSmartboardToHomeroom(
  homeroomId: string,
  email: string,
): Promise<{ success: boolean; error?: string }> {
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, role')
    .eq('email', email.trim().toLowerCase())
    .maybeSingle()

  if (!profile) return { success: false, error: 'No account found with that email' }
  if (profile.role !== 'smartboard') return { success: false, error: 'That account is not a smart board account' }

  // Don't silently replace a board this homeroom already has.
  const { data: target } = await supabase
    .from('homerooms')
    .select('smartboard_id')
    .eq('id', homeroomId)
    .single()
  if (target?.smartboard_id && target.smartboard_id !== profile.id) {
    return { success: false, error: 'This homeroom already has a smart board account' }
  }

  const { data: existing } = await supabase
    .from('homerooms')
    .select('id')
    .eq('smartboard_id', profile.id)
    .maybeSingle()
  if (existing && existing.id !== homeroomId) {
    return { success: false, error: 'That smart board is already linked to another homeroom' }
  }

  const { error } = await supabase.from('homerooms').update({ smartboard_id: profile.id }).eq('id', homeroomId)
  if (error) {
    console.error('linkSmartboardToHomeroom error:', error)
    return { success: false, error: 'Failed to link smart board' }
  }
  return { success: true }
}

/** Clears a homeroom's smart board link without deleting the account. */
export async function unlinkSmartboardFromHomeroom(homeroomId: string): Promise<boolean> {
  const { error } = await supabase.from('homerooms').update({ smartboard_id: null }).eq('id', homeroomId)
  if (error) {
    console.error('unlinkSmartboardFromHomeroom error:', error)
    return false
  }
  return true
}

/** Persists the customisable smart board banner for a homeroom. */
export async function updateSmartboardBanner(
  homeroomId: string,
  banner: SmartboardBanner
): Promise<boolean> {
  const { error } = await supabase
    .from('homerooms')
    .update({ smartboard_banner: banner })
    .eq('id', homeroomId)

  if (error) {
    console.error('updateSmartboardBanner error:', error)
    return false
  }
  return true
}

export function homeroomGradeSectionBadge(homeroom: Homeroom): string | null {
  if (homeroom.grade && homeroom.section) return `Grade ${homeroom.grade} • ${homeroom.section}`
  if (homeroom.grade) return `Grade ${homeroom.grade}`
  return null
}
