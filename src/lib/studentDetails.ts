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
  // Identification
  admission_no: string | null
  roll_no: string | null
  pen_no: string | null             // CBSE Permanent Education Number
  cbse_reg_no: string | null        // CBSE Registration Number
  udise_student_code: string | null // UDISE Student Code / SRN
  // Personal
  date_of_birth: string | null      // 'YYYY-MM-DD'
  gender: string | null             // Male / Female / Transgender
  place_of_birth: string | null
  blood_group: string | null
  differently_abled: string | null  // No / Yes (with type)
  single_girl_child: string | null  // Yes / No
  // Family
  father_name: string | null
  father_qualification: string | null
  father_occupation: string | null
  mother_name: string | null
  mother_qualification: string | null
  mother_occupation: string | null
  guardian_name: string | null
  annual_income: string | null      // e.g. "Below 1L", "1L–3L"
  // Socio-economic
  nationality: string | null
  mother_tongue: string | null
  religion: string | null
  category: string | null           // SC / ST / OBC / GEN
  caste: string | null
  minority: string | null           // Yes / No
  bpl_card_no: string | null        // Below Poverty Line card number
  ews_certificate_no: string | null // Economically Weaker Section certificate
  // Admission & Transfer
  date_of_admission: string | null  // 'YYYY-MM-DD'
  admission_class: string | null
  previous_school: string | null
  tc_no: string | null              // Transfer Certificate Number
  tc_date: string | null            // 'YYYY-MM-DD'
  // Contact
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
