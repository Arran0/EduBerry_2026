import { supabase } from './supabase'

// ============================================
// Student Details — extended CBSE fields
// --------------------------------------------
// 1:1 with a student profile (keyed by student_id). Kept in its own table so the
// heavily-used profiles table and its RLS stay untouched. Powers the Profile
// Manager "Edit Details" form and the certificate field grid.
// ============================================

export interface StudentDetails {
  id: string
  student_id: string
  admission_no: string | null
  roll_no: string | null
  date_of_birth: string | null      // 'YYYY-MM-DD'
  father_name: string | null
  mother_name: string | null
  guardian_name: string | null
  nationality: string | null
  mother_tongue: string | null
  religion: string | null
  category: string | null
  caste: string | null
  blood_group: string | null
  date_of_admission: string | null  // 'YYYY-MM-DD'
  admission_class: string | null
  address: string | null
  phone: string | null
  aadhaar_no: string | null
  created_at?: string
  updated_at?: string
}

/** Fields a user can edit (everything except the server-managed columns). */
export type StudentDetailsPatch = Partial<
  Omit<StudentDetails, 'id' | 'student_id' | 'created_at' | 'updated_at'>
>

export async function fetchStudentDetails(studentId: string): Promise<StudentDetails | null> {
  const { data, error } = await supabase
    .from('student_details')
    .select('*')
    .eq('student_id', studentId)
    .maybeSingle()
  if (error) { console.error('fetchStudentDetails failed:', error); return null }
  return (data as StudentDetails) ?? null
}

/** Bulk fetch for many students at once (e.g. a homeroom roster). */
export async function fetchStudentDetailsMap(
  studentIds: string[]
): Promise<Record<string, StudentDetails>> {
  if (studentIds.length === 0) return {}
  const { data, error } = await supabase
    .from('student_details')
    .select('*')
    .in('student_id', studentIds)
  if (error) { console.error('fetchStudentDetailsMap failed:', error); return {} }
  const map: Record<string, StudentDetails> = {}
  for (const row of (data as StudentDetails[]) ?? []) map[row.student_id] = row
  return map
}

export async function upsertStudentDetails(
  studentId: string,
  patch: StudentDetailsPatch
): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase
    .from('student_details')
    .upsert(
      { student_id: studentId, ...patch, updated_at: new Date().toISOString() },
      { onConflict: 'student_id' }
    )
  if (error) { console.error('upsertStudentDetails failed:', error); return { success: false, error: error.message } }
  return { success: true }
}
