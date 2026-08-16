import { supabase, UserProfile, UserRole } from './supabase'

// --- Types ---

export interface Team {
  id: string
  name: string
  description: string | null
  start_date: string | null
  end_date: string | null
  coordinator_id: string | null
  created_at: string
  updated_at: string
}

export interface TeamMember {
  id: string
  team_id: string
  user_id: string
  created_at: string
  user?: UserProfile
}

export interface TeamWithDetails extends Team {
  members: TeamMember[]
  coordinator?: UserProfile
  member_count: number
}

// --- Team CRUD ---

export async function createTeam(input: {
  name: string
  description?: string
  start_date?: string
  end_date?: string
  coordinator_email?: string
}): Promise<Team | null> {
  const id = crypto.randomUUID()

  // Resolve coordinator by email
  let coordinatorId: string | null = null
  if (input.coordinator_email) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('id')
      .eq('email', input.coordinator_email.trim().toLowerCase())
      .single()

    if (profile) {
      coordinatorId = profile.id
    }
  }

  const { error } = await supabase
    .from('teams')
    .insert({
      id,
      name: input.name,
      description: input.description || null,
      start_date: input.start_date || null,
      end_date: input.end_date || null,
      coordinator_id: coordinatorId,
    })

  if (error) {
    console.error('Failed to create team:', error.message)
    return null
  }

  // Add coordinator as member if resolved
  if (coordinatorId) {
    await addTeamMember(id, coordinatorId)
  }

  // Add all principals and admins as default members
  const { data: defaultMembers } = await supabase
    .from('profiles')
    .select('id')
    .in('role', ['principal', 'admin'])

  for (const member of defaultMembers ?? []) {
    if (member.id !== coordinatorId) {
      await addTeamMember(id, member.id)
    }
  }

  return {
    id,
    name: input.name,
    description: input.description || null,
    start_date: input.start_date || null,
    end_date: input.end_date || null,
    coordinator_id: coordinatorId,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
}

export async function fetchAllTeams(): Promise<TeamWithDetails[]> {
  // Teams and members are independent — fetch in parallel
  const [{ data: teams, error }, { data: members }] = await Promise.all([
    supabase.from('teams').select('*').order('name', { ascending: true }),
    supabase.from('team_members').select('*'),
  ])

  if (error) {
    console.error('Failed to fetch teams:', error.message)
    return []
  }

  // Fetch profiles for members and coordinators
  const allUserIds = new Set<string>()
  for (const m of members ?? []) {
    allUserIds.add(m.user_id)
  }
  for (const t of teams ?? []) {
    if (t.coordinator_id) allUserIds.add(t.coordinator_id)
  }

  let profiles: UserProfile[] = []
  if (allUserIds.size > 0) {
    const { data: profilesData } = await supabase
      .from('profiles')
      .select('*')
      .in('id', [...allUserIds])
    profiles = (profilesData ?? []) as UserProfile[]
  }

  const profileMap = new Map(profiles.map(p => [p.id, p]))

  const membersByTeam = new Map<string, TeamMember[]>()
  for (const m of members ?? []) {
    if (!membersByTeam.has(m.team_id)) {
      membersByTeam.set(m.team_id, [])
    }
    membersByTeam.get(m.team_id)!.push({
      ...m,
      user: profileMap.get(m.user_id),
    })
  }

  return (teams ?? []).map((t: Team) => ({
    ...t,
    members: membersByTeam.get(t.id) || [],
    coordinator: t.coordinator_id ? profileMap.get(t.coordinator_id) : undefined,
    member_count: (membersByTeam.get(t.id) || []).length,
  }))
}

export async function updateTeam(
  teamId: string,
  updates: Partial<Pick<Team, 'name' | 'description' | 'start_date' | 'end_date' | 'coordinator_id'>>
): Promise<boolean> {
  const { error } = await supabase
    .from('teams')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', teamId)

  if (error) {
    console.error('Failed to update team:', error.message)
    return false
  }
  return true
}

export async function deleteTeam(teamId: string): Promise<boolean> {
  // Delete members first
  await supabase.from('team_members').delete().eq('team_id', teamId)

  const { error } = await supabase
    .from('teams')
    .delete()
    .eq('id', teamId)

  if (error) {
    console.error('Failed to delete team:', error.message)
    return false
  }
  return true
}

// --- Team Members ---

export async function addTeamMember(teamId: string, userId: string): Promise<boolean> {
  const { error } = await supabase
    .from('team_members')
    .insert({ team_id: teamId, user_id: userId })

  if (error) {
    if (error.code === '23505') return true // duplicate
    console.error('Failed to add team member:', error.message)
    return false
  }
  return true
}

export async function addTeamMemberByEmail(teamId: string, email: string): Promise<{ success: boolean; error?: string }> {
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id, role')
    .eq('email', email.trim().toLowerCase())
    .single()

  if (profileError || !profile) {
    return { success: false, error: 'User not found with that email' }
  }

  // Only teachers can be added to teams (coordinators, principals, admins are auto-added)
  if (!['teacher', 'coordinator'].includes(profile.role)) {
    return { success: false, error: 'Only teachers and coordinators can be added to teams' }
  }

  const success = await addTeamMember(teamId, profile.id)
  return { success, error: success ? undefined : 'Failed to add member' }
}

export async function removeTeamMember(teamId: string, userId: string): Promise<boolean> {
  const { error } = await supabase
    .from('team_members')
    .delete()
    .eq('team_id', teamId)
    .eq('user_id', userId)

  if (error) {
    console.error('Failed to remove team member:', error.message)
    return false
  }
  return true
}

/** Lightweight team list for dropdown menus — fetches only id/name, no member joins. */
export async function fetchTeamsForDropdown(): Promise<{ id: string; name: string }[]> {
  const { data, error } = await supabase
    .from('teams')
    .select('id, name')
    .order('name', { ascending: true })

  if (error) {
    console.error('fetchTeamsForDropdown error:', error)
    return []
  }
  return (data ?? []) as { id: string; name: string }[]
}

/** One team the viewer belongs to, with its trackable staff roster attached. */
export interface TeamRoster {
  id: string
  name: string
  /** Members of this team, excluding banned accounts. Includes the viewer. */
  members: UserProfile[]
}

/**
 * Every team the viewer belongs to — both the ones they coordinate
 * (teams.coordinator_id) and the ones they are a plain member of
 * (team_members) — each with its roster attached.
 *
 * Attendance surfaces use this instead of fetchTeamMembers() so that a
 * teacher or coordinator sitting on several teams sees all of them
 * aggregated rather than just the first/coordinated one.
 */
export async function fetchMyTeamRosters(userId: string): Promise<TeamRoster[]> {
  const [{ data: coordinated }, { data: memberships }] = await Promise.all([
    supabase.from('teams').select('id').eq('coordinator_id', userId),
    supabase.from('team_members').select('team_id').eq('user_id', userId),
  ])

  const teamIds = [...new Set([
    ...((coordinated ?? []) as { id: string }[]).map(t => t.id),
    ...((memberships ?? []) as { team_id: string }[]).map(m => m.team_id),
  ])]
  if (teamIds.length === 0) return []

  const [{ data: teams }, { data: members }] = await Promise.all([
    supabase.from('teams').select('id, name').in('id', teamIds).order('name', { ascending: true }),
    supabase.from('team_members').select('team_id, user_id').in('team_id', teamIds),
  ])

  const memberRows = (members ?? []) as { team_id: string; user_id: string }[]
  const userIds = [...new Set(memberRows.map(m => m.user_id))]
  if (userIds.length === 0) {
    return ((teams ?? []) as { id: string; name: string }[]).map(t => ({ ...t, members: [] }))
  }

  const { data: profiles, error: profErr } = await supabase
    .from('profiles')
    .select('id, email, full_name, role, avatar_url, geofence_exempt, attendance_hidden, is_banned')
    .in('id', userIds)
    .eq('is_banned', false)
    .order('full_name', { ascending: true })

  if (profErr) {
    console.error('fetchMyTeamRosters profiles error:', profErr)
    return []
  }

  const profileById = new Map(((profiles ?? []) as UserProfile[]).map(p => [p.id, p]))
  const byTeam = new Map<string, UserProfile[]>()
  for (const row of memberRows) {
    const profile = profileById.get(row.user_id)
    if (!profile) continue
    const list = byTeam.get(row.team_id)
    if (list) list.push(profile)
    else byTeam.set(row.team_id, [profile])
  }

  return ((teams ?? []) as { id: string; name: string }[]).map(t => ({
    id: t.id,
    name: t.name,
    members: (byTeam.get(t.id) ?? []).sort((a, b) =>
      (a.full_name || '').localeCompare(b.full_name || '')
    ),
  }))
}

/** Flatten team rosters into one de-duplicated staff list (multi-team aggregate). */
export function mergeTeamRosters(rosters: TeamRoster[]): UserProfile[] {
  const byId = new Map<string, UserProfile>()
  for (const r of rosters) {
    for (const m of r.members) byId.set(m.id, m)
  }
  return [...byId.values()].sort((a, b) => (a.full_name || '').localeCompare(b.full_name || ''))
}

/** Fetch staff profiles for one team — called lazily when a team is selected. */
export async function fetchTeamStaffById(teamId: string): Promise<import('./supabase').UserProfile[]> {
  const { data: members, error: memErr } = await supabase
    .from('team_members')
    .select('user_id')
    .eq('team_id', teamId)

  if (memErr || !members?.length) return []

  const userIds = (members as { user_id: string }[]).map(m => m.user_id)

  const { data: profiles, error: profErr } = await supabase
    .from('profiles')
    .select('id, email, full_name, role, avatar_url, geofence_exempt, attendance_hidden')
    .in('id', userIds)
    .eq('is_banned', false)
    .order('full_name', { ascending: true })

  if (profErr) {
    console.error('fetchTeamStaffById error:', profErr)
    return []
  }
  return (profiles ?? []) as import('./supabase').UserProfile[]
}
