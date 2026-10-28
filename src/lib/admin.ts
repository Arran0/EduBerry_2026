import { supabase, UserProfile, UserRole } from './supabase'
import { GRADE_OPTIONS } from './grades'
import { PROFILE_COLUMNS, profileDirectory } from './profileColumns'

// ============================================
// Admin Functions for User Management
// ============================================

export interface ProfileWithTeams extends UserProfile {
  teams: { id: string; name: string }[]
}

export interface NewUserInput {
  email: string
  full_name: string
  role: UserRole
  is_non_teaching?: boolean
  grade?: number
  section?: string
  team_ids?: string[]
  autoConfirm?: boolean
  password?: string
}

// Fetch all profiles with team memberships
const PROFILE_PAGE_SIZE = 1000

// The roles isStaffRole() accepts, as a DB-side filter.
const STAFF_ROLES: UserRole[] = ['teacher', 'coordinator', 'principal', 'admin']

/**
 * Staff profiles only, with just the columns a picker needs. The timetable
 * builder used to pull every profile (students included, paged 1000 at a time)
 * plus the whole team_members table only to filter it down to staff in the
 * browser; this asks Postgres for the ~50 rows it actually renders.
 */
export async function fetchStaffProfiles(): Promise<UserProfile[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, ...profile_emails(email), full_name, role, avatar_url, grade, section')
    .in('role', STAFF_ROLES)
    .order('full_name', { ascending: true })

  if (error) {
    console.error('fetchStaffProfiles error:', error)
    return []
  }
  return (data ?? []) as UserProfile[]
}

export interface FetchProfilesOptions {
  /**
   * Restrict to these roles DB-side. The profile managers each render one side
   * of the roster — asking Postgres for that side beats pulling every student
   * row across the wire so the browser can filter them back out.
   */
  roles?: UserRole[]
  /**
   * Whether to join each profile's team memberships. Defaults to true for
   * backward compatibility; callers that never render `teams` (the student and
   * staff managers, the certificate typeahead) skip a whole extra query by
   * passing false.
   */
  withTeams?: boolean
}

export async function fetchAllProfiles(
  options: FetchProfilesOptions = {},
): Promise<ProfileWithTeams[]> {
  const { roles, withTeams = true } = options

  // PostgREST caps a plain select at 1000 rows. Past that the list silently
  // truncates, which makes existing members look absent — e.g. the bulk
  // import preview would mark them "new" and try to re-create them.
  const fetchProfilePage = (page: number) => {
    let q = supabase.from('profiles').select(PROFILE_COLUMNS)
    if (roles?.length) q = q.in('role', roles)
    return q
      .order('role', { ascending: true })
      .order('full_name', { ascending: true })
      .range(page * PROFILE_PAGE_SIZE, page * PROFILE_PAGE_SIZE + PROFILE_PAGE_SIZE - 1)
  }

  const [{ data: firstPage, error }, { data: memberships }] = await Promise.all([
    fetchProfilePage(0),
    withTeams
      ? supabase.from('team_members').select('user_id, team:teams(id, name)')
      : Promise.resolve({ data: [] as { user_id: string; team: unknown }[] }),
  ])

  if (error) {
    console.error('Failed to fetch profiles:', error)
    return []
  }

  const profiles = [...(firstPage || [])]
  let lastPageSize = firstPage?.length ?? 0
  for (let page = 1; lastPageSize === PROFILE_PAGE_SIZE; page++) {
    const { data, error: pageError } = await fetchProfilePage(page)
    if (pageError || !data?.length) break
    profiles.push(...data)
    lastPageSize = data.length
  }

  // Map memberships to users
  const membershipMap = new Map<string, { id: string; name: string }[]>()
  for (const m of memberships || []) {
    if (!membershipMap.has(m.user_id)) {
      membershipMap.set(m.user_id, [])
    }
    const team = m.team as unknown as { id: string; name: string } | null
    if (team) {
      membershipMap.get(m.user_id)!.push(team)
    }
  }

  return (profiles || []).map(p => ({
    ...p,
    teams: membershipMap.get(p.id) || [],
  })) as ProfileWithTeams[]
}

// Update profile — routed through the server API to bypass the RLS policy that
// restricts direct client-side updates to the user's own profile only.
export async function updateProfile(
  userId: string,
  updates: Partial<Pick<UserProfile, 'full_name' | 'role' | 'grade' | 'section' | 'is_non_teaching' | 'display_role'>>
): Promise<{ success: boolean; error?: string }> {
  try {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return { success: false, error: 'Not authenticated' }

    const makeRequest = (token: string) =>
      fetch('/api/admin/update-profile', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ userId, ...updates }),
      })

    let response = await makeRequest(session.access_token)

    // If the server rejected the token (stale/expired), refresh and retry once
    if (response.status === 401) {
      const { data: { session: refreshed } } = await supabase.auth.refreshSession()
      if (!refreshed) return { success: false, error: 'Session expired. Please sign in again.' }
      response = await makeRequest(refreshed.access_token)
    }

    return await response.json()
  } catch (err) {
    console.error('Error updating profile:', err)
    return { success: false, error: 'An unexpected error occurred' }
  }
}

// Ban or unban a user — updates profiles.is_banned and blocks/unblocks Supabase auth sign-in.
export async function toggleBan(userId: string, ban: boolean): Promise<{ success: boolean; error?: string }> {
  try {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return { success: false, error: 'Not authenticated' }

    const response = await fetch('/api/admin/toggle-ban', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ userId, ban }),
    })
    return await response.json()
  } catch (err) {
    console.error('Error toggling ban:', err)
    return { success: false, error: 'An unexpected error occurred' }
  }
}

// Update team memberships for a user
export async function updateTeamMemberships(
  userId: string,
  teamIds: string[]
): Promise<boolean> {
  // First, remove all existing memberships
  const { error: deleteError } = await supabase
    .from('team_members')
    .delete()
    .eq('user_id', userId)

  if (deleteError) {
    console.error('Failed to remove team memberships:', deleteError)
    return false
  }

  // Then add new memberships
  if (teamIds.length > 0) {
    const records = teamIds.map(teamId => ({
      team_id: teamId,
      user_id: userId,
    }))

    const { error: insertError } = await supabase
      .from('team_members')
      .insert(records)

    if (insertError) {
      console.error('Failed to add team memberships:', insertError)
      return false
    }
  }

  return true
}

// Fetch all teams
export async function fetchAllTeams(): Promise<{ id: string; name: string }[]> {
  const { data, error } = await supabase
    .from('teams')
    .select('id, name')
    .order('name', { ascending: true })

  if (error) {
    console.error('Failed to fetch teams:', error)
    return []
  }

  return data || []
}

// Create a new user — calls the server-side API route which uses the service role key
export async function createNewUser(input: NewUserInput): Promise<{ success: boolean; error?: string; userId?: string; inviteLink?: string; emailSent?: boolean; autoConfirm?: boolean }> {
  try {
    // Get current session token to authenticate the API call
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return { success: false, error: 'Not authenticated' }

    const response = await fetch('/api/admin/create-user', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        email: input.email,
        full_name: input.full_name,
        role: input.role,
        is_non_teaching: input.is_non_teaching,
        grade: input.grade,
        section: input.section,
        autoConfirm: input.autoConfirm,
        password: input.autoConfirm ? input.password : undefined,
      }),
    })

    const result = await response.json()

    if (!result.success) {
      return { success: false, error: result.error || 'Failed to create user' }
    }

    // Set team memberships if provided
    if (result.userId && input.team_ids && input.team_ids.length > 0) {
      await updateTeamMemberships(result.userId, input.team_ids)
    }

    return { success: true, userId: result.userId, inviteLink: result.inviteLink, emailSent: result.emailSent, autoConfirm: result.autoConfirm }
  } catch (err) {
    console.error('Error creating user:', err)
    return { success: false, error: 'An unexpected error occurred' }
  }
}

// Converts an existing staff account into a support staff entry (no login) —
// copies what support_staff has room for, then deletes the account entirely.
// One-way: see src/app/api/admin/convert-to-support/route.ts for why.
export async function convertToSupportStaff(userId: string): Promise<{ success: boolean; error?: string; supportStaffId?: string }> {
  try {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return { success: false, error: 'Not authenticated' }

    const response = await fetch('/api/admin/convert-to-support', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ userId }),
    })
    return await response.json()
  } catch (err) {
    console.error('Error converting to support staff:', err)
    return { success: false, error: 'An unexpected error occurred' }
  }
}

// Delete a user — calls server-side API route (needs SUPABASE_SERVICE_ROLE_KEY)
export async function deleteUser(userId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return { success: false, error: 'Not authenticated' }

    const makeRequest = (token: string) =>
      fetch('/api/admin/delete-user', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ userId }),
      })

    let response = await makeRequest(session.access_token)

    // If the server rejected the token (stale/expired), refresh and retry once
    if (response.status === 401) {
      const { data: { session: refreshed } } = await supabase.auth.refreshSession()
      if (!refreshed) return { success: false, error: 'Session expired. Please sign in again.' }
      response = await makeRequest(refreshed.access_token)
    }

    return await response.json()
  } catch (err) {
    console.error('Error deleting user:', err)
    return { success: false, error: 'An unexpected error occurred' }
  }
}

// Directly set a new password for a user — admin only, no email step required
export async function setUserPassword(userId: string, password: string): Promise<{ success: boolean; error?: string }> {
  try {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return { success: false, error: 'Not authenticated' }

    const response = await fetch('/api/admin/reset-password', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ userId, password }),
    })
    return await response.json()
  } catch (err) {
    console.error('Error setting password:', err)
    return { success: false, error: 'An unexpected error occurred' }
  }
}

/**
 * Email the user a one-time link to set or reset their own password. On a mail
 * failure `link` may carry the link itself, for the admin to pass on by hand.
 */
export async function sendPasswordEmail(userId: string): Promise<{ success: boolean; error?: string; email?: string; link?: string }> {
  try {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return { success: false, error: 'Not authenticated' }

    const response = await fetch('/api/admin/send-password-email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ userId }),
    })
    return await response.json()
  } catch (err) {
    console.error('Error sending password email:', err)
    return { success: false, error: 'An unexpected error occurred' }
  }
}

// Get role display info
export const ROLE_COLORS: Record<UserRole, string> = {
  student: 'bg-green-100 text-green-700 border-green-200',
  teacher: 'bg-blue-100 text-blue-700 border-blue-200',
  coordinator: 'bg-purple-100 text-purple-700 border-purple-200',
  principal: 'bg-amber-100 text-amber-700 border-amber-200',
  admin: 'bg-red-100 text-red-700 border-red-200',
  driver: 'bg-orange-100 text-orange-700 border-orange-200',
  smartboard: 'bg-indigo-100 text-indigo-700 border-indigo-200',
}

// ── Student roster, a page at a time ─────────────────────────────────────────
// The student manager holds 1000+ profiles. It used to fetch all of them —
// every column, two round trips — and then search, filter, sort and count them
// in the browser. All of that now happens in Postgres, and only the rows the
// reader has scrolled to cross the wire.

export type StudentSort = 'name_asc' | 'name_desc' | 'grade' | 'recent'

export interface StudentQuery {
  search: string
  /** 'all', or a stored grade value as a string (pre-primary grades are negative). */
  grade: string
  /** 'all', or a section letter. */
  section: string
  status: 'all' | 'active' | 'inactive'
  sort: StudentSort
}

/** Only what a roster row, the edit modal and the profile card actually read. */
const STUDENT_ROW_COLUMNS =
  'id, email, full_name, role, avatar_url, grade, section, is_banned, banned_at, display_role, created_at, updated_at'

/**
 * PostgREST's `or=` takes a comma-separated list inside parentheses, so a
 * search term containing those characters would be read as filter syntax
 * rather than as text. They are dropped instead of escaped: none of them
 * appears in a name, an email or a section.
 */
function sanitiseSearch(raw: string): string {
  return raw.trim().replace(/[,()"\\*]/g, '')
}

/** Grade values whose label matches the search text, e.g. "lkg" → [-2]. */
export function gradeValuesMatching(search: string): number[] {
  const q = search.trim().toLowerCase()
  if (!q) return []
  return GRADE_OPTIONS.filter(g => g.label.toLowerCase().includes(q)).map(g => g.value)
}

export async function fetchStudentPage(
  query: StudentQuery,
  offset: number,
  limit: number,
): Promise<{ rows: ProfileWithTeams[]; total: number }> {
  // The directory, not the table: the search below matches email addresses,
  // and only addresses the caller may see (profileDirectory).
  let q = profileDirectory({ count: 'exact' })
    .select(STUDENT_ROW_COLUMNS)
    .eq('role', 'student')

  const search = sanitiseSearch(query.search)
  if (search) {
    // Searching "Grade 5" has to reach an integer column, so the labels are
    // resolved to their stored values here and matched by value.
    const grades = gradeValuesMatching(search)
    const clauses = [
      `full_name.ilike.%${search}%`,
      `email.ilike.%${search}%`,
      `section.ilike.%${search}%`,
      ...(grades.length ? [`grade.in.(${grades.join(',')})`] : []),
    ]
    q = q.or(clauses.join(','))
  }

  if (query.grade !== 'all') q = q.eq('grade', Number(query.grade))
  if (query.section !== 'all') q = q.eq('section', query.section)
  if (query.status !== 'all') q = q.eq('is_banned', query.status === 'inactive')

  if (query.sort === 'name_desc') q = q.order('full_name', { ascending: false })
  else if (query.sort === 'recent') q = q.order('created_at', { ascending: false })
  else if (query.sort === 'grade') q = q.order('grade', { ascending: true }).order('full_name', { ascending: true })
  else q = q.order('full_name', { ascending: true })

  // A stable tiebreaker: without one, rows with equal sort keys can swap
  // between pages and the same student arrives twice while another never does.
  q = q.order('id', { ascending: true }).range(offset, offset + limit - 1)

  const { data, error, count } = await q
  if (error) {
    console.error('fetchStudentPage error:', error)
    return { rows: [], total: 0 }
  }
  return {
    rows: ((data ?? []) as UserProfile[]).map(p => ({ ...p, teams: [] })) as unknown as ProfileWithTeams[],
    total: count ?? 0,
  }
}

export interface StudentFacets {
  gradeCounts: Record<string, number>
  sectionCounts: Record<string, number>
  sections: string[]
}

/**
 * How many students sit behind each grade and section option, counted over the
 * search-matched roster but not the grade/section/status selection — so
 * switching one filter never moves the numbers being read right before the
 * click. See supabase-migrations/admin_manager_paging.sql.
 */
export async function fetchStudentFacets(search: string): Promise<StudentFacets> {
  const clean = search.trim()
  const { data, error } = await supabase.rpc('student_roster_facets', {
    p_search: clean,
    p_grades: gradeValuesMatching(clean),
  })
  if (error) {
    console.error('fetchStudentFacets error:', error)
    return { gradeCounts: {}, sectionCounts: {}, sections: [] }
  }
  const gradeCounts: Record<string, number> = {}
  const sectionCounts: Record<string, number> = {}
  for (const row of (data ?? []) as { facet: string; key: string; n: number }[]) {
    if (row.facet === 'grade') gradeCounts[row.key] = row.n
    else sectionCounts[row.key] = row.n
  }
  return { gradeCounts, sectionCounts, sections: Object.keys(sectionCounts).sort() }
}

/**
 * Every student email, for the bulk-import preview to mark rows that already
 * exist. Fetched when that modal opens rather than kept alongside the roster:
 * it is one column the list itself never renders.
 */
export async function fetchStudentEmails(): Promise<Set<string>> {
  const emails = new Set<string>()
  for (let page = 0; ; page++) {
    const { data, error } = await supabase
      .from('profiles')
      .select('...profile_emails(email)')
      .eq('role', 'student')
      .range(page * PROFILE_PAGE_SIZE, page * PROFILE_PAGE_SIZE + PROFILE_PAGE_SIZE - 1)
    if (error) { console.error('fetchStudentEmails error:', error); break }
    for (const r of data ?? []) emails.add(((r as { email: string | null }).email ?? '').toLowerCase())
    if (!data || data.length < PROFILE_PAGE_SIZE) break
  }
  return emails
}
