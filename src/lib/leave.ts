import { supabase, UserProfile, UserRole, isStaffRole } from './supabase'
import { syncLeaveToStudentAttendance, syncLeaveToStaffAttendance } from './attendance'
import { notifyLeaveEvent } from './push'
import { emitLeaveNotificationsChanged } from './leaveNotificationEvents'
import { compressImageIfNeeded } from './imageCompression'

// ============================================
// Types
// ============================================

export type LeaveType = 'casual' | 'medical' | 'on_duty' | 'half_day' | 'late'
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

/** One user's "last looked at this application" marker — lets either side
 *  tell whether the other has seen its current state. */
export interface LeaveApplicationView {
  application_id: string
  user_id: string
  viewed_at: string
}

export interface LeaveApplicationWithDetails extends LeaveApplication {
  applicant?: UserProfile
  approvals: LeaveApproval[]
  views: LeaveApplicationView[]
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
  on_duty: 'On Duty (OD)',
  casual: 'Casual Leave',
  medical: 'Medical Leave',
  half_day: 'Half Day Permit',
  late: 'Late Permit',
}

/** Two-to-six character type codes for the list rows, where a full label would
 *  crowd out the dates on a phone. */
export const LEAVE_TYPE_SHORT: Record<LeaveType, string> = {
  on_duty: 'OD',
  casual: 'CL',
  medical: 'ML',
  half_day: '½ Day',
  late: 'Late',
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

export async function uploadLeaveFile(
  file: File,
  folder: string
): Promise<{ url: string; name: string } | null> {
  const compressed = await compressImageIfNeeded(file)
  const ext = compressed.name.split('.').pop() || 'bin'
  const path = `leave/${folder}/${crypto.randomUUID()}.${ext}`
  const { error } = await supabase.storage
    .from(LEAVE_BUCKET)
    .upload(path, compressed, { upsert: false, cacheControl: '31536000' })
  if (error) {
    console.error('Leave file upload failed:', error)
    return null
  }
  const { data } = supabase.storage.from(LEAVE_BUCKET).getPublicUrl(path)
  return { url: data.publicUrl, name: compressed.name }
}

// ============================================
// Helper Functions
// ============================================

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
// Fetch approvers who have access to the applicant's task space calendar
// - teacher    → coordinators in the same team(s)
// - coordinator → all principals
// - principal  → all admins
// ============================================

// ============================================
// Search Recipients (teacher / coordinator / principal / admin)
// ============================================

// Search recipients for staff leave based on role hierarchy
// teacher → coordinator/principal/admin, coordinator → principal/admin, principal → admin
export async function searchStaffRecipients(query: string, applicantRole: UserRole): Promise<RecipientProfile[]> {
  if (!query || query.trim().length < 2) return []
  const roleMap: Partial<Record<UserRole, string[]>> = {
    teacher:     ['coordinator', 'principal', 'admin'],
    coordinator: ['principal', 'admin'],
    principal:   ['admin'],
  }
  const roles = roleMap[applicantRole] ?? []
  if (!roles.length) return []
  const { data } = await supabase
    .from('profiles')
    .select('id, full_name, email, role, avatar_url')
    .in('role', roles)
    .or(`email.ilike.%${query.trim()}%,full_name.ilike.%${query.trim()}%`)
    .order('role')
    .order('full_name')
    .limit(8)
  return (data || []) as RecipientProfile[]
}

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

  // Tell the reviewer's devices. Fire-and-forget: the application is filed
  // either way, and the notification box already carries it regardless.
  notifyLeaveEvent(application.id, 'submitted')

  return application as LeaveApplication
}

// ============================================
// Create Leave Application (staff)
// ============================================

// ============================================
// Fetch Leave Applications
// ============================================

// Only the fields the leave UI actually reads (LeaveApplicationCard,
// ApproverDecisionPanel, LeaveApplicationDetailModal, LeaveAppPreviewModal):
// full_name/avatar_url/role for both, plus grade/section for the applicant
// (shown for student applicants).
const APPLICANT_MINI = 'id, full_name, avatar_url, role, grade, section'
const APPROVER_MINI = 'id, full_name, avatar_url, role'

const LEAVE_SELECT = `
  *,
  applicant:profiles!leave_applications_applicant_id_fkey(${APPLICANT_MINI}),
  approvals:leave_approvals(*, approver:profiles(${APPROVER_MINI}), team:teams(id, name)),
  views:leave_application_views(*)
`

/** Same shape as LEAVE_SELECT, but the applicant join is `!inner` so it can be
 *  *filtered* on. That keeps "students only" / "staff only" scoping inside the
 *  database — without it a page of 10 rows would have to be fetched and then
 *  trimmed client-side, which makes page sizes meaningless. */
const LEAVE_SELECT_FILTERABLE = `
  *,
  applicant:profiles!leave_applications_applicant_id_fkey!inner(${APPLICANT_MINI}),
  approvals:leave_approvals(*, approver:profiles(${APPROVER_MINI}), team:teams(id, name)),
  views:leave_application_views(*)
`

/** Rows fetched per "Load 10 more" step. */
export const LEAVE_PAGE_SIZE = 10

/** Which applicants a list is about. Applied server-side via the inner join. */
export type ApplicantScope = 'student' | 'staff' | 'any'

export interface LeavePage {
  items: LeaveApplicationWithDetails[]
  /** Total rows matching the query, so callers can show real tab counts and
   *  "N remaining" without having fetched them. */
  total: number
  hasMore: boolean
}

export interface LeavePageOptions {
  offset?: number
  limit?: number
  /**
   * Narrows the page to these application ids — how the search box filters
   * every list without each one needing its own name-matching query. `null`
   * (or omitted) means "no search running"; an empty array means "a search ran
   * and matched nothing", which is why the two are not interchangeable.
   */
  restrictIds?: string[] | null
}

function emptyPage(): LeavePage {
  return { items: [], total: 0, hasMore: false }
}

function scopedLeaveQuery(scope: ApplicantScope) {
  const query = supabase
    .from('leave_applications')
    .select(LEAVE_SELECT_FILTERABLE, { count: 'exact' })
  if (scope === 'student') return query.eq('applicant.role', 'student')
  if (scope === 'staff') return query.neq('applicant.role', 'student')
  return query
}

async function runLeavePage(
  query: ReturnType<typeof scopedLeaveQuery>,
  offset: number,
  limit: number,
  label: string,
): Promise<LeavePage> {
  const { data, count, error } = await query
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (error) {
    const msg = String((error as any)?.message || '')
    if (!msg.toLowerCase().includes('abort') && !msg.toLowerCase().includes('signal')) {
      console.error(`Failed to fetch ${label}:`, error)
    }
    return emptyPage()
  }

  const items = (data || []) as unknown as LeaveApplicationWithDetails[]
  const total = count ?? offset + items.length
  return { items, total, hasMore: offset + items.length < total }
}

/** One page of the user's own applications, newest first. `statuses` narrows it
 *  to a single tab (pending vs. reviewed) so each tab pages independently. */
export async function fetchMyLeaveApplicationsPage(
  userId: string,
  { offset = 0, limit = LEAVE_PAGE_SIZE, statuses, restrictIds }:
    LeavePageOptions & { statuses?: LeaveStatus[] } = {},
): Promise<LeavePage> {
  if (restrictIds && restrictIds.length === 0) return emptyPage()
  let query = scopedLeaveQuery('any').eq('applicant_id', userId)
  if (statuses && statuses.length > 0) query = query.in('status', statuses)
  if (restrictIds) query = query.in('id', restrictIds)
  return runLeavePage(query, offset, limit, 'leave applications')
}

/** One page of every application on record for the given applicant scope. */
export async function fetchAllLeaveApplicationsPage(
  scope: ApplicantScope,
  { offset = 0, limit = LEAVE_PAGE_SIZE, restrictIds }: LeavePageOptions = {},
): Promise<LeavePage> {
  if (restrictIds && restrictIds.length === 0) return emptyPage()
  let query = scopedLeaveQuery(scope)
  if (restrictIds) query = query.in('id', restrictIds)
  return runLeavePage(query, offset, limit, 'all leave applications')
}

/**
 * Splits a staff member's approval queue into "still mine to decide" and
 * "already decided" application ids.
 *
 * This is the one id-only query the approval lists need up front; the pages
 * then fetch just the 10 applications they render, instead of pulling every
 * application in the queue before showing the first screenful.
 */
export async function fetchApprovalQueueIds(
  userId: string,
): Promise<{ pendingIds: string[]; decidedIds: string[] }> {
  const { data, error } = await supabase
    .from('leave_approvals')
    .select('leave_application_id, status')
    .eq('approver_id', userId)

  if (error) {
    console.error('Failed to fetch approval queue:', error)
    return { pendingIds: [], decidedIds: [] }
  }

  const pending = new Set<string>()
  const all = new Set<string>()
  for (const row of data ?? []) {
    all.add(row.leave_application_id)
    if (row.status === 'pending') pending.add(row.leave_application_id)
  }
  return {
    pendingIds: [...pending],
    decidedIds: [...all].filter(id => !pending.has(id)),
  }
}

/** One page from an explicit id list (an approval queue), newest first. */
export async function fetchLeaveApplicationsByIdsPage(
  ids: string[],
  scope: ApplicantScope,
  { offset = 0, limit = LEAVE_PAGE_SIZE, restrictIds }: LeavePageOptions = {},
): Promise<LeavePage> {
  // A search intersects with the queue rather than replacing it — you can only
  // ever find applications that were already yours to see.
  const allowed = restrictIds ? new Set(restrictIds) : null
  const effective = allowed ? ids.filter(id => allowed.has(id)) : ids
  if (effective.length === 0) return emptyPage()
  return runLeavePage(scopedLeaveQuery(scope).in('id', effective), offset, limit, 'leave applications')
}

/** How many of those applications belong to the given applicant scope — used
 *  for badge counts, where the rows themselves are never rendered. */
export async function countLeaveApplicationsByIds(
  ids: string[],
  scope: ApplicantScope,
): Promise<number> {
  if (ids.length === 0) return 0
  const { count } = await scopedLeaveQuery(scope).in('id', ids)
  return count ?? 0
}

/** Shortest search that is worth sending to the server. */
export const LEAVE_SEARCH_MIN_CHARS = 2

/** Strips the characters PostgREST reads as filter syntax, so a stray comma or
 *  bracket in the search box can't corrupt the `or(...)` expression below. */
function sanitiseSearchTerm(raw: string): string {
  return raw.replace(/[,()*%\\]/g, ' ').trim()
}

/**
 * Application ids whose applicant *or* assigned approver matches a name or
 * email search — the "search by sender or receiver" box.
 *
 * Done as an id lookup rather than a filter on the list queries because the
 * two sides live in different tables (`leave_applications.applicant_id` and
 * `leave_approvals.approver_id`), which PostgREST cannot `or` across in one
 * request. Callers pass the result as `restrictIds`.
 *
 * Returns `[]` for "matched nothing" — callers must treat that differently
 * from `null` ("no search running"), or a fruitless search would show
 * everything.
 */
export async function searchLeaveApplicationIdsByPerson(query: string): Promise<string[]> {
  const term = sanitiseSearchTerm(query)
  if (term.length < LEAVE_SEARCH_MIN_CHARS) return []
  const like = `%${term}%`

  const { data: people, error: peopleError } = await supabase
    .from('profiles')
    .select('id')
    .or(`full_name.ilike.${like},email.ilike.${like}`)
    .limit(200)

  if (peopleError) {
    console.error('Failed to search leave participants:', peopleError)
    return []
  }

  const personIds = (people ?? []).map(p => p.id)
  if (personIds.length === 0) return []

  const [asApplicant, asApprover] = await Promise.all([
    supabase.from('leave_applications').select('id').in('applicant_id', personIds).limit(500),
    supabase.from('leave_approvals').select('leave_application_id').in('approver_id', personIds).limit(500),
  ])

  const matched = new Set<string>()
  for (const row of asApplicant.data ?? []) matched.add(row.id)
  for (const row of asApprover.data ?? []) matched.add(row.leave_application_id)
  return [...matched]
}

/** A single application with its applicant and approval trail — what the
 *  detail popup opens with, so a deep link never has to load its neighbours. */
export async function fetchLeaveApplicationById(
  id: string,
): Promise<LeaveApplicationWithDetails | null> {
  const { data, error } = await supabase
    .from('leave_applications')
    .select(LEAVE_SELECT)
    .eq('id', id)
    .maybeSingle()

  if (error) {
    console.error('Failed to fetch leave application:', error)
    return null
  }
  return (data as LeaveApplicationWithDetails | null) ?? null
}

// ============================================
// "Seen" tracking — lets either side of an application tell whether the
// other has looked at its current state (a fresh submission, or a decision).
// ============================================

/** Records that the current user has seen this application as it stands
 *  right now. Safe to call every time a card renders — it's a cheap upsert
 *  and the RPC runs as the caller, so it can never mark a view on someone
 *  else's behalf. */
export async function markLeaveApplicationViewed(applicationId: string): Promise<void> {
  const { error } = await supabase.rpc('mark_leave_application_viewed', {
    p_application_id: applicationId,
  })
  if (error) console.error('Failed to mark leave application viewed:', error)
}

/** Batch form — one round trip for any number of applications, instead of
 *  calling markLeaveApplicationViewed once per id. */
export async function markLeaveApplicationsViewed(applicationIds: string[]): Promise<void> {
  if (applicationIds.length === 0) return
  const { error } = await supabase.rpc('mark_leave_applications_viewed', {
    p_application_ids: applicationIds,
  })
  if (error) console.error('Failed to mark leave applications viewed:', error)
}

/**
 * The approvals on this application addressed to `userId` — named to them
 * directly, or left open to whoever holds their role.
 */
export function approvalsAddressedTo(
  application: LeaveApplicationWithDetails,
  userId: string,
  role: string,
): LeaveApproval[] {
  return application.approvals.filter(a =>
    a.approver_id === userId || (!a.approver_id && !!role && a.approver_role === role)
  )
}

/**
 * Is this application unread for this viewer? The one rule every surface
 * reads — the list's unread rail, the notification feed and the tab counts —
 * so none of them can disagree about what "read" means.
 *
 * It is derived from what is stored in the database (the application's status,
 * its approvals, and the viewer's `leave_application_views` row), never from a
 * per-device marker, so the answer is the same on every device the user opens.
 *
 *  • Reviewer — unread exactly while a decision is still owed. Deciding is
 *    what marks it read, and nothing marks it read before that: an approved or
 *    rejected application never goes back to unread for the person who
 *    answered it, however often the row is touched afterwards.
 *  • Anyone else looking on (a principal or admin browsing every application)
 *    sees the same thing the reviewers do: pending is unread, decided is not.
 *  • Applicant — unread from the moment a decision lands until they look at
 *    the application again. Their own pending application is never unread;
 *    they wrote it.
 */
export function isLeaveUnreadFor(
  application: LeaveApplicationWithDetails,
  userId: string,
  role: string,
): boolean {
  if (application.applicant_id !== userId) {
    const mine = approvalsAddressedTo(application, userId, role)
    if (mine.length > 0) return mine.some(a => a.status === 'pending')
    return application.status === 'pending'
  }

  const latestDecision = application.approvals
    .filter(a => (a.status === 'approved' || a.status === 'rejected') && a.decided_at)
    .sort((a, b) => new Date(b.decided_at!).getTime() - new Date(a.decided_at!).getTime())[0]
  if (!latestDecision?.decided_at) return false

  const view = application.views?.find(v => v.user_id === userId)
  return !view || new Date(view.viewed_at).getTime() < new Date(latestDecision.decided_at).getTime()
}

/** How many applications in this scope are still awaiting a decision — the
 *  unread tally for a viewer who is looking at every application rather than
 *  their own queue. Counted in the database, not by scanning fetched rows. */
export async function countPendingLeaveApplications(scope: ApplicantScope): Promise<number> {
  const { count } = await scopedLeaveQuery(scope).eq('status', 'pending')
  return count ?? 0
}

export interface LeaveViewStatus {
  /** Whether the other party's latest view is at or after this application's
   *  last update — i.e. they've seen the current state, not a stale one. */
  seen: boolean
  /** Display name of the other party (the applicant, or the approver). */
  otherName: string
}

/** From `currentUserId`'s point of view, has the other party seen this
 *  application's current state? Null when there's no one to check yet (no
 *  approver assigned). The "other party" is the approver when the current
 *  user is the applicant, and the applicant otherwise. */
export function getLeaveViewStatus(
  application: LeaveApplicationWithDetails,
  currentUserId: string,
): LeaveViewStatus | null {
  const updatedAt = new Date(application.updated_at).getTime()
  const isApplicant = application.applicant_id === currentUserId

  if (isApplicant) {
    const approval = application.approvals.find(a => a.approver_id)
    if (!approval?.approver_id) return null
    const view = application.views.find(v => v.user_id === approval.approver_id)
    return {
      seen: !!view && new Date(view.viewed_at).getTime() >= updatedAt,
      otherName: approval.approver?.full_name ?? 'the reviewer',
    }
  }

  const view = application.views.find(v => v.user_id === application.applicant_id)
  return {
    seen: !!view && new Date(view.viewed_at).getTime() >= updatedAt,
    otherName: application.applicant?.full_name ?? 'the applicant',
  }
}

/** Leave applications submitted by a specific applicant (subject to RLS). */
export async function fetchLeaveApplicationsForApplicant(
  applicantId: string
): Promise<LeaveApplicationWithDetails[]> {
  const { data, error } = await supabase
    .from('leave_applications')
    .select(LEAVE_SELECT)
    .eq('applicant_id', applicantId)
    .order('start_date', { ascending: false })

  if (error) {
    console.error('Failed to fetch applicant leave applications:', error)
    return []
  }
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

  // Deciding is what makes an application read for its reviewer — up to this
  // point it stays unread for them however often they have looked at it. The
  // marker goes in after the status sync, so it lands at or after the
  // `updated_at` that sync just bumped.
  await markLeaveApplicationViewed(approval.leave_application_id)

  // Tell the applicant's devices that their application has been answered.
  notifyLeaveEvent(approval.leave_application_id, 'decided', approvalId)

  // And refresh the decider's own surfaces: their review queue is one shorter.
  // (Realtime only reaches the applicant — this is the other side of it.)
  emitLeaveNotificationsChanged()

  // Mirror approved leave dates into attendance records
  if (decision === 'approved') {
    const { data: app } = await supabase
      .from('leave_applications')
      .select('applicant_id, start_date, end_date, leave_type')
      .eq('id', approval.leave_application_id)
      .single()

    if (app) {
      const { data: applicant } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', app.applicant_id)
        .single()

      if (applicant) {
        if (isStaffRole(applicant.role)) {
          await syncLeaveToStaffAttendance(
            approval.leave_application_id,
            app.applicant_id,
            app.start_date,
            app.end_date,
            app.leave_type
          )
        } else {
          await syncLeaveToStudentAttendance(
            approval.leave_application_id,
            app.applicant_id,
            app.start_date,
            app.end_date,
            app.leave_type
          )
        }
      }
    }
  }

  return true
}

// ============================================
// Delete Leave Application (admin / principal)
// ============================================

export async function deleteLeaveApplication(id: string): Promise<boolean> {
  // Delete child approvals first to satisfy FK constraint
  const { error: approvalsError } = await supabase
    .from('leave_approvals')
    .delete()
    .eq('leave_application_id', id)
  if (approvalsError) {
    console.error('Failed to delete leave approvals:', approvalsError)
    return false
  }

  const { error } = await supabase
    .from('leave_applications')
    .delete()
    .eq('id', id)
  if (error) {
    console.error('Failed to delete leave application:', error)
    return false
  }
  return true
}

/** Fetch leave applications for a student that overlap with a given month. */
export async function fetchLeaveApplicationsForStudentByMonth(
  studentId: string,
  year: number,
  month: number
): Promise<LeaveApplicationWithDetails[]> {
  const startOfMonth = `${year}-${String(month).padStart(2, '0')}-01`
  const lastDay = new Date(year, month, 0).getDate()
  const endOfMonth = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`

  const { data, error } = await supabase
    .from('leave_applications')
    .select(LEAVE_SELECT)
    .eq('applicant_id', studentId)
    .lte('start_date', endOfMonth)
    .gte('end_date', startOfMonth)
    .order('start_date', { ascending: true })

  if (error) {
    const msg = String((error as any)?.message || '')
    if (!msg.toLowerCase().includes('abort') && !msg.toLowerCase().includes('signal')) {
      console.error('fetchLeaveApplicationsForStudentByMonth error:', error)
    }
    return []
  }
  return (data || []) as LeaveApplicationWithDetails[]
}

