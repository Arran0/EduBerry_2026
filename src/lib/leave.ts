import { supabase, UserProfile, UserRole } from './supabase'

// ============================================
// Types
// ============================================

export type LeaveType = 'casual' | 'medical'
export type LeaveStatus = 'pending' | 'approved' | 'rejected'

export interface LeaveApplication {
  id: string
  applicant_id: string
  leave_type: LeaveType
  start_date: string
  end_date: string
  reason: string
  status: LeaveStatus
  attachment_url: string | null
  attachment_name: string | null
  created_at: string
  updated_at: string
}

export interface LeaveApproval {
  id: string
  leave_application_id: string
  approver_id: string | null
  approver_role: 'teacher' | 'coordinator' | 'principal' | 'admin'
  team_id: string | null
  status: LeaveStatus
  comments: string | null
  attachment_url: string | null
  attachment_name: string | null
  decided_at: string | null
  created_at: string
  approver?: UserProfile
  team?: { id: string; name: string }
}

export interface LeaveApplicationWithDetails extends LeaveApplication {
  applicant?: UserProfile
  approvals: LeaveApproval[]
}

export interface NewLeaveInput {
  leave_type: LeaveType
  start_date: string
  end_date: string
  reason: string
}

export interface RecipientProfile {
  id: string
  full_name: string
  email: string
  role: string
  avatar_url?: string
}

export interface LeaveStats {
  applied: number
  approved: number
  pending: number
  rejected: number
}

export const LEAVE_TYPE_LABELS: Record<LeaveType, string> = {
  casual: 'Casual Leave (CL)',
  medical: 'Medical Leave',
}

export const LEAVE_STATUS_LABELS: Record<LeaveStatus, string> = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
}

export const LEAVE_STATUS_COLORS: Record<LeaveStatus, string> = {
  pending: 'bg-amber-50 text-amber-700 border-amber-200',
  approved: 'bg-green-50 text-green-700 border-green-200',
  rejected: 'bg-red-50 text-red-700 border-red-200',
}

const LEAVE_BUCKET = 'classroom-files'

// ============================================
// File Upload Helpers
// ============================================

export function isImageFile(name: string): boolean {
  return /\.(jpe?g|png|gif|webp|svg)$/i.test(name)
}

export function getLeaveFileUrl(path: string): string {
  const { data } = supabase.storage.from(LEAVE_BUCKET).getPublicUrl(path)
  return data.publicUrl
}

export async function uploadLeaveFile(
  file: File,
  folder: string
): Promise<{ url: string; name: string } | null> {
  const ext = file.name.split('.').pop() || 'bin'
  const path = `leave/${folder}/${crypto.randomUUID()}.${ext}`
  const { error } = await supabase.storage
    .from(LEAVE_BUCKET)
    .upload(path, file, { upsert: false })
  if (error) {
    console.error('Leave file upload failed:', error)
    return null
  }
  const { data } = supabase.storage.from(LEAVE_BUCKET).getPublicUrl(path)
  return { url: data.publicUrl, name: file.name }
}

// ============================================
// Helper Functions
// ============================================

function calculateLeaveDays(startDate: string, endDate: string): number {
  const start = new Date(startDate)
  const end = new Date(endDate)
  return Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1
}

export async function fetchCoordinators(): Promise<{ id: string; full_name: string; email: string }[]> {
  const { data } = await supabase
    .from('profiles').select('id, full_name, email').eq('role', 'coordinator').order('full_name')
  return (data ?? []) as { id: string; full_name: string; email: string }[]
}

export async function fetchPrincipals(): Promise<{ id: string; full_name: string; email: string }[]> {
  const { data } = await supabase
    .from('profiles').select('id, full_name, email').eq('role', 'principal').order('full_name')
  return (data ?? []) as { id: string; full_name: string; email: string }[]
}

export async function fetchAdmins(): Promise<{ id: string; full_name: string; email: string }[]> {
  const { data } = await supabase
    .from('profiles').select('id, full_name, email').eq('role', 'admin').order('full_name')
  return (data ?? []) as { id: string; full_name: string; email: string }[]
}

// ============================================
// Search Recipients (teacher / coordinator / principal / admin)
// ============================================

export async function searchLeaveRecipients(query: string): Promise<RecipientProfile[]> {
  if (!query || query.trim().length < 2) return []
  const { data } = await supabase
    .from('profiles')
    .select('id, full_name, email, role, avatar_url')
    .in('role', ['teacher', 'coordinator', 'principal', 'admin'])
    .or(`email.ilike.%${query.trim()}%,full_name.ilike.%${query.trim()}%`)
    .order('role')
    .order('full_name')
    .limit(8)
  return (data || []) as RecipientProfile[]
}

// ============================================
// Create Leave Application (student)
// ============================================

export async function createStudentLeaveApplication(
  input: NewLeaveInput,
  applicantId: string,
  recipientId: string,
  recipientRole: string,
  attachmentFile?: File
): Promise<LeaveApplication | null> {
  let attachment_url: string | null = null
  let attachment_name: string | null = null

  if (attachmentFile) {
    const uploaded = await uploadLeaveFile(attachmentFile, 'applications')
    if (uploaded) {
      attachment_url = uploaded.url
      attachment_name = uploaded.name
    }
  }

  const { data: application, error } = await supabase
    .from('leave_applications')
    .insert({
      applicant_id: applicantId,
      leave_type: input.leave_type,
      start_date: input.start_date,
      end_date: input.end_date,
      reason: input.reason,
      status: 'pending',
      attachment_url,
      attachment_name,
    })
    .select()
    .single()

  if (error || !application) {
    console.error('Failed to create student leave application:', error)
    return null
  }

  const { error: approvalError } = await supabase
    .from('leave_approvals')
    .insert({
      leave_application_id: application.id,
      approver_id: recipientId,
      approver_role: recipientRole,
    })

  if (approvalError) {
    console.error('Failed to create approval record:', approvalError)
    await supabase.from('leave_applications').delete().eq('id', application.id)
    return null
  }

  return application as LeaveApplication
}

// ============================================
// Create Leave Application (staff)
// ============================================

export async function createLeaveApplication(
  input: NewLeaveInput,
  applicantId: string,
  applicantRole: UserRole,
  selectedApproverIds: string[] = [],
  attachmentFile?: File
): Promise<LeaveApplication | null> {
  let attachment_url: string | null = null
  let attachment_name: string | null = null

  if (attachmentFile) {
    const uploaded = await uploadLeaveFile(attachmentFile, 'applications')
    if (uploaded) { attachment_url = uploaded.url; attachment_name = uploaded.name }
  }

  const { data: application, error } = await supabase
    .from('leave_applications')
    .insert({
      applicant_id: applicantId,
      leave_type: input.leave_type,
      start_date: input.start_date,
      end_date: input.end_date,
      reason: input.reason,
      status: 'pending',
      attachment_url,
      attachment_name,
    })
    .select()
    .single()

  if (error || !application) {
    console.error('Failed to create leave application:', error)
    return null
  }

  const approvalRecords: {
    leave_application_id: string
    approver_id?: string
    approver_role: string
  }[] = []

  if (selectedApproverIds.length > 0) {
    let approverRole = 'coordinator'
    if (applicantRole === 'coordinator') approverRole = 'principal'
    else if (applicantRole === 'principal') approverRole = 'admin'
    for (const approverId of selectedApproverIds) {
      approvalRecords.push({ leave_application_id: application.id, approver_id: approverId, approver_role: approverRole })
    }
  } else {
    let approverRole = 'coordinator'
    if (applicantRole === 'coordinator') approverRole = 'principal'
    else if (applicantRole === 'principal') approverRole = 'admin'
    approvalRecords.push({ leave_application_id: application.id, approver_role: approverRole })
  }

  if (approvalRecords.length > 0) {
    const { error: approvalError } = await supabase.from('leave_approvals').insert(approvalRecords)
    if (approvalError) {
      console.error('Failed to create approval records:', approvalError)
      await supabase.from('leave_applications').delete().eq('id', application.id)
      return null
    }
  }

  return application as LeaveApplication
}

// ============================================
// Fetch Leave Applications
// ============================================

const LEAVE_SELECT = `
  *,
  applicant:profiles!leave_applications_applicant_id_fkey(*),
  approvals:leave_approvals(*, approver:profiles(*), team:teams(id, name))
`

export async function fetchMyLeaveApplications(userId: string): Promise<LeaveApplicationWithDetails[]> {
  const { data, error } = await supabase
    .from('leave_applications')
    .select(LEAVE_SELECT)
    .eq('applicant_id', userId)
    .order('created_at', { ascending: false })

  if (error) {
    const msg = String((error as any)?.message || '')
    if (!msg.toLowerCase().includes('abort') && !msg.toLowerCase().includes('signal')) {
      console.error('Failed to fetch leave applications:', error)
    }
    return []
  }
  return (data || []) as LeaveApplicationWithDetails[]
}

/** Applications where this staff member has a pending decision */
export async function fetchActiveApprovalsForStaff(userId: string): Promise<LeaveApplicationWithDetails[]> {
  const { data: approvalIds, error } = await supabase
    .from('leave_approvals')
    .select('leave_application_id')
    .eq('approver_id', userId)
    .eq('status', 'pending')

  if (error || !approvalIds || approvalIds.length === 0) return []

  const ids = [...new Set(approvalIds.map(a => a.leave_application_id))]
  const { data } = await supabase
    .from('leave_applications')
    .select(LEAVE_SELECT)
    .in('id', ids)
    .order('created_at', { ascending: false })

  return (data || []) as LeaveApplicationWithDetails[]
}

/** Applications where this staff member has already made a decision */
export async function fetchHistoryApprovalsForStaff(userId: string): Promise<LeaveApplicationWithDetails[]> {
  const { data: approvalIds, error } = await supabase
    .from('leave_approvals')
    .select('leave_application_id')
    .eq('approver_id', userId)
    .neq('status', 'pending')

  if (error || !approvalIds || approvalIds.length === 0) return []

  const ids = [...new Set(approvalIds.map(a => a.leave_application_id))]
  const { data } = await supabase
    .from('leave_applications')
    .select(LEAVE_SELECT)
    .in('id', ids)
    .order('created_at', { ascending: false })

  return (data || []) as LeaveApplicationWithDetails[]
}

export async function fetchAllLeaveApplications(): Promise<LeaveApplicationWithDetails[]> {
  const { data, error } = await supabase
    .from('leave_applications')
    .select(LEAVE_SELECT)
    .order('created_at', { ascending: false })

  if (error) { console.error('Failed to fetch all leave applications:', error); return [] }
  return (data || []) as LeaveApplicationWithDetails[]
}

// ============================================
// Leave Stats (for student header)
// ============================================

export async function fetchLeaveStats(userId: string): Promise<LeaveStats> {
  const { data } = await supabase
    .from('leave_applications')
    .select('status')
    .eq('applicant_id', userId)

  const applied = data?.length ?? 0
  const approved = data?.filter(a => a.status === 'approved').length ?? 0
  const pending = data?.filter(a => a.status === 'pending').length ?? 0
  const rejected = data?.filter(a => a.status === 'rejected').length ?? 0
  return { applied, approved, pending, rejected }
}

// ============================================
// Approve/Reject Leave
// ============================================

export async function processLeaveApproval(
  approvalId: string,
  approverId: string,
  decision: 'approved' | 'rejected',
  comments?: string,
  attachmentFile?: File
): Promise<boolean> {
  let attachment_url: string | null = null
  let attachment_name: string | null = null

  if (attachmentFile) {
    const uploaded = await uploadLeaveFile(attachmentFile, 'decisions')
    if (uploaded) { attachment_url = uploaded.url; attachment_name = uploaded.name }
  }

  const { data: approval, error: updateError } = await supabase
    .from('leave_approvals')
    .update({
      approver_id: approverId,
      status: decision,
      comments: comments || null,
      attachment_url,
      attachment_name,
      decided_at: new Date().toISOString(),
    })
    .eq('id', approvalId)
    .select('leave_application_id')
    .single()

  if (updateError || !approval) {
    console.error('Failed to update approval:', updateError)
    return false
  }

  // Sync application status via SECURITY DEFINER RPC so all approver roles
  // (including teachers) can trigger the update regardless of RLS policies.
  await supabase.rpc('sync_leave_application_status', {
    p_application_id: approval.leave_application_id,
  })

  return true
}

// Keep for backward compat
export async function fetchPendingApprovalsForUser(
  userId: string,
  userRole: UserRole
): Promise<LeaveApplicationWithDetails[]> {
  return fetchActiveApprovalsForStaff(userId)
}

// Keep balance function (unused but might be referenced elsewhere)
export const LEAVE_ALLOWANCES: Record<LeaveType, number> = { casual: 12, medical: 15 }

export async function fetchLeaveBalance(
  userId: string
): Promise<{ casual: { used: number; total: number }; medical: { used: number; total: number } }> {
  const now = new Date()
  const academicYearStart = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1
  const { data } = await supabase
    .from('leave_applications')
    .select('leave_type, start_date, end_date')
    .eq('applicant_id', userId)
    .eq('status', 'approved')
    .gte('start_date', `${academicYearStart}-04-01`)
    .lte('end_date', `${academicYearStart + 1}-03-31`)

  let casualUsed = 0, medicalUsed = 0
  for (const app of data ?? []) {
    const days = calculateLeaveDays(app.start_date, app.end_date)
    if (app.leave_type === 'casual') casualUsed += days
    else if (app.leave_type === 'medical') medicalUsed += days
  }
  return {
    casual: { used: casualUsed, total: LEAVE_ALLOWANCES.casual },
    medical: { used: medicalUsed, total: LEAVE_ALLOWANCES.medical },
  }
}
