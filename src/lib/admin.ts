import { supabase, UserProfile, UserRole } from './supabase'

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
  grade?: number
  section?: string
  team_ids?: string[]
  autoConfirm?: boolean
  password?: string
}

// Fetch all profiles with team memberships
export async function fetchAllProfiles(): Promise<ProfileWithTeams[]> {
  const [{ data: profiles, error }, { data: memberships }] = await Promise.all([
    supabase.from('profiles').select('*').order('role', { ascending: true }).order('full_name', { ascending: true }),
    supabase.from('team_members').select('user_id, team:teams(id, name)'),
  ])

  if (error) {
    console.error('Failed to fetch profiles:', error)
    return []
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
  updates: Partial<Pick<UserProfile, 'full_name' | 'role' | 'grade' | 'section'>>
): Promise<{ success: boolean; error?: string }> {
  try {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return { success: false, error: 'Not authenticated' }

    const response = await fetch('/api/admin/update-profile', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ userId, ...updates }),
    })
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
export async function createNewUser(input: NewUserInput): Promise<{ success: boolean; error?: string; userId?: string; inviteLink?: string; autoConfirm?: boolean }> {
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

    return { success: true, userId: result.userId, inviteLink: result.inviteLink, autoConfirm: result.autoConfirm }
  } catch (err) {
    console.error('Error creating user:', err)
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

// Note: Creating auth users requires Supabase Admin API
// For now, this function creates only the profile (user must sign up via auth first)
// In production, you'd use Supabase Admin API to create auth.users
export async function createProfileForExistingAuth(
  userId: string,
  input: Omit<NewUserInput, 'email'>
): Promise<boolean> {
  const { error } = await supabase
    .from('profiles')
    .update({
      full_name: input.full_name,
      role: input.role,
      grade: input.grade || null,
      section: input.section || null,
    })
    .eq('id', userId)

  if (error) {
    console.error('Failed to create/update profile:', error)
    return false
  }

  // Set team memberships
  if (input.team_ids && input.team_ids.length > 0) {
    await updateTeamMemberships(userId, input.team_ids)
  }

  return true
}

// Send a password reset email to a user — calls the server-side API route
export async function resetUserPassword(email: string): Promise<{ success: boolean; error?: string; resetLink?: string }> {
  try {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return { success: false, error: 'Not authenticated' }

    const response = await fetch('/api/admin/reset-password', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ email }),
    })
    return await response.json()
  } catch (err) {
    console.error('Error resetting password:', err)
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
