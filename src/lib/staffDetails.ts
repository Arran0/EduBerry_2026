import { supabase } from './supabase'

// ============================================
// Staff Details — extended HR / personnel fields
// --------------------------------------------
// 1:1 with a non-student profile (keyed by staff_id). Kept in its own table so
// the heavily-used profiles table and its RLS stay untouched. Powers the Staff
// Directory maintenance screen and any staff-facing certificates/records.
// ============================================

export interface StaffDetails {
  id: string
  staff_id: string
  employee_id: string | null
  designation: string | null
  department: string | null
  qualification: string | null
  date_of_joining: string | null   // 'YYYY-MM-DD'
  date_of_birth: string | null     // 'YYYY-MM-DD'
  gender: string | null
  blood_group: string | null
  phone: string | null
  emergency_contact: string | null
  address: string | null
  aadhaar_no: string | null
  pan_no: string | null
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

/** Bulk fetch for many staff at once (e.g. the staff directory). */
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
