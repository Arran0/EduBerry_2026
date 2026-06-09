import { supabase, UserProfile } from './supabase'

// ============================================
// Types
// ============================================

export interface Homeroom {
  id: string
  name: string
  grade: number | null
  section: string | null
  academic_year: string | null
  expiry_date: string | null
  created_by: string | null
  created_at: string
  updated_at: string
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

// Searches by name (ilike) or by parsing "7A" / "7 A" / "grade 7" style queries.
export async function searchHomerooms(query: string): Promise<Homeroom[]> {
  const q = query.trim()
  if (!q) return fetchAllHomerooms()

  // Try to parse grade+section patterns like "7A", "7 A", "grade 7 a"
  const gradeSecMatch = q.match(/^(?:grade\s*)?(\d{1,2})\s*([a-fA-F]?)$/)

  let dbQuery = supabase.from('homerooms').select('*')

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
  return data ?? []
}

export async function fetchHomeroomWithMembers(homeroomId: string): Promise<HomeroomWithMembers | null> {
  const { data: homeroom, error: hrError } = await supabase
    .from('homerooms')
    .select('*')
    .eq('id', homeroomId)
    .single()

  if (hrError || !homeroom) {
    console.error('fetchHomeroomWithMembers error:', hrError)
    return null
  }

  const { data: members, error: memError } = await supabase
    .from('homeroom_members')
    .select(`
      *,
      student:profiles!homeroom_members_student_id_fkey(
        id, email, full_name, role, avatar_url, grade, section
      )
    `)
    .eq('homeroom_id', homeroomId)
    .order('created_at', { ascending: true })

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
): Promise<{ success: boolean; error?: string }> {
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id, role')
    .eq('email', email.trim().toLowerCase())
    .single()

  if (profileError || !profile) {
    return { success: false, error: 'No user found with that email' }
  }

  if (profile.role !== 'student') {
    return { success: false, error: 'Only students can be added to homerooms' }
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

// ============================================
// Display Helpers
// ============================================

export function homeroomDisplayName(homeroom: Homeroom): string {
  return homeroom.name
}

export function homeroomGradeSectionBadge(homeroom: Homeroom): string | null {
  if (homeroom.grade && homeroom.section) return `Grade ${homeroom.grade} • ${homeroom.section}`
  if (homeroom.grade) return `Grade ${homeroom.grade}`
  return null
}
