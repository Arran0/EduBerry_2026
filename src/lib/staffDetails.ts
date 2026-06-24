import { supabase } from './supabase'

// ============================================
// Staff Details — extended CBSE HR / personnel fields
// --------------------------------------------
// 1:1 with a non-student profile (keyed by staff_id). Kept in its own table so
// the heavily-used profiles table and its RLS stay untouched.
// ============================================

export interface StaffDetails {
  id: string
  staff_id: string
  // ── Employment ──────────────────────────────
  employee_id: string | null
  designation: string | null            // PGT / TGT / PRT / etc.
  department: string | null
  subjects_taught: string | null        // comma-separated subjects
  employment_type: string | null        // Permanent / Contractual / Adhoc / Deputation
  date_of_joining: string | null        // 'YYYY-MM-DD'
  date_of_retirement: string | null     // 'YYYY-MM-DD'
  date_of_confirmation: string | null   // 'YYYY-MM-DD' — end of probation
  cbse_reg_no: string | null            // CBSE registration / affiliation number
  // ── Qualifications ──────────────────────────
  qualification: string | null          // highest academic qualification
  ugc_net_qualified: string | null      // Yes / No / NA
  teaching_diploma: string | null       // B.Ed, D.El.Ed, B.P.Ed, etc.
  teaching_experience_years: string | null
  // ── Personal ────────────────────────────────
  date_of_birth: string | null          // 'YYYY-MM-DD'
  gender: string | null
  nationality: string | null
  religion: string | null
  category: string | null               // SC / ST / OBC / General / EWS
  marital_status: string | null
  physically_challenged: string | null  // Yes / No
  ex_serviceman: string | null          // Yes / No
  blood_group: string | null
  // ── Contact ─────────────────────────────────
  phone: string | null
  alternate_phone: string | null
  emergency_contact_name: string | null
  emergency_contact: string | null      // emergency phone number
  emergency_contact_relation: string | null
  address: string | null
  // ── Identity / Financial ────────────────────
  aadhaar_no: string | null
  pan_no: string | null
  epf_no: string | null
  nps_no: string | null
  bank_account_no: string | null
  bank_name: string | null
  ifsc_code: string | null
  created_at?: string
  updated_at?: string
}

/** Fields a user can edit (everything except the server-managed columns). */
export type StaffDetailsPatch = Partial<
  Omit<StaffDetails, 'id' | 'staff_id' | 'created_at' | 'updated_at'>
>

export async function fetchStaffDetails(staffId: string): Promise<StaffDetails | null> {
  const { data, error } = await supabase
    .from('staff_details')
    .select('*')
    .eq('staff_id', staffId)
    .maybeSingle()
  if (error) { console.error('fetchStaffDetails failed:', error); return null }
  return (data as StaffDetails) ?? null
}

/** Bulk fetch for many staff at once (e.g. the staff profile manager). */
export async function fetchStaffDetailsMap(
  staffIds: string[]
): Promise<Record<string, StaffDetails>> {
  if (staffIds.length === 0) return {}
  const { data, error } = await supabase
    .from('staff_details')
    .select('*')
    .in('staff_id', staffIds)
  if (error) { console.error('fetchStaffDetailsMap failed:', error); return {} }
  const map: Record<string, StaffDetails> = {}
  for (const row of (data as StaffDetails[]) ?? []) map[row.staff_id] = row
  return map
}

export async function upsertStaffDetails(
  staffId: string,
  patch: StaffDetailsPatch
): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase
    .from('staff_details')
    .upsert(
      { staff_id: staffId, ...patch, updated_at: new Date().toISOString() },
      { onConflict: 'staff_id' }
    )
  if (error) { console.error('upsertStaffDetails failed:', error); return { success: false, error: error.message } }
  return { success: true }
}
