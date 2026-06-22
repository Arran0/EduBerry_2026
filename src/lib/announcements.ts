import { supabase, UserProfile, UserRole } from './supabase'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** 'student' | 'staff' | 'both' — derived from audience rows, stored for RLS */
export type AnnouncementType = 'student' | 'staff' | 'both'

export interface AnnouncementAttachment {
  type: 'image' | 'youtube' | 'document' | 'link'
  url: string
  name: string
}

export interface Announcement {
  id: string
  title: string
  content: string
  type: AnnouncementType
  attachments: AnnouncementAttachment[] | null
  created_by: string
  created_at: string
  updated_at: string
}

export interface AnnouncementAudience {
  id: string
  announcement_id: string
  /** Set for student targeting */
  grade: number | null
  /** null = all sections of that grade */
  section: string | null
  /** true = targets all students school-wide */
  all_students: boolean
  /** Set for staff targeting (specific team) */
  team_id: string | null
  /** true = targets all staff school-wide */
  all_teams: boolean
  /** Set for individual member targeting */
  user_id: string | null
  team?: { id: string; name: string } | null
}

export interface AnnouncementWithDetails extends Announcement {
  audiences: AnnouncementAudience[]
  creator?: UserProfile
}

/**
 * Input for creating a new announcement.
 * Each entry in `audiences` can describe either a student or staff audience row.
 * Multiple rows can be included to target multiple grades/sections/teams.
 */
export interface NewAnnouncementInput {
  title: string
  content: string
  attachments?: AnnouncementAttachment[]
  audiences: {
    grade?: number
    section?: string       // undefined = all sections for that grade
    all_students?: boolean
    team_id?: string
    all_teams?: boolean
    user_id?: string       // individual member targeting
  }[]
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

/**
 * Create an announcement with its audience rows.
 * The `type` ('student' | 'staff' | 'both') is derived automatically from the
 * audience entries so callers don't need to specify it.
 */
export async function createAnnouncement(
  input: NewAnnouncementInput,
  createdBy: string
): Promise<Announcement | null> {
  const announcementId = crypto.randomUUID()

  // Derive type from audiences
  const hasStudentAudience    = input.audiences.some(a => a.grade != null || a.all_students)
  const hasStaffAudience      = input.audiences.some(a => a.team_id || a.all_teams)
  const hasIndividualAudience = input.audiences.some(a => a.user_id)
  // Individual member rows use 'both' so all roles can receive them via visibility logic
  const type: AnnouncementType =
    hasIndividualAudience || (hasStudentAudience && hasStaffAudience) ? 'both' :
    hasStaffAudience ? 'staff' : 'student'

  const { error: announcementError } = await supabase
    .from('announcements')
    .insert({
      id: announcementId,
      title: input.title,
      content: input.content,
      type,
      attachments: input.attachments && input.attachments.length > 0 ? input.attachments : null,
      created_by: createdBy,
    })

  if (announcementError) {
    console.error('Failed to create announcement:', announcementError)
    return null
  }

  if (input.audiences.length > 0) {
    const audienceRows = input.audiences.map(a => ({
      announcement_id: announcementId,
      grade:        a.grade        ?? null,
      section:      a.section      ?? null,
      all_students: a.all_students ?? false,
      team_id:      a.team_id      ?? null,
      all_teams:    a.all_teams    ?? false,
      user_id:      a.user_id      ?? null,
    }))

    const { error: audienceError } = await supabase
      .from('announcement_audiences')
      .insert(audienceRows)

    if (audienceError) {
      console.error('Failed to create announcement audiences:', audienceError)
      // Rollback orphaned announcement
      await supabase.from('announcements').delete().eq('id', announcementId)
      return null
    }
  }

  return {
    id: announcementId,
    title: input.title,
    content: input.content,
    type,
    attachments: input.attachments && input.attachments.length > 0 ? input.attachments : null,
    created_by: createdBy,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
}

/** Delete an announcement (cascade removes audience rows). */
export async function deleteAnnouncement(announcementId: string): Promise<void> {
  const { error } = await supabase
    .from('announcements')
    .delete()
    .eq('id', announcementId)

  if (error) {
    throw new Error(`Failed to delete announcement: ${error.message}`)
  }
}

// ---------------------------------------------------------------------------
// Fetch helpers (shared select fragment)
// ---------------------------------------------------------------------------

const ANNOUNCEMENT_SELECT = `
  *,
  audiences:announcement_audiences(*, team:teams(id, name)),
  creator:profiles!announcements_created_by_fkey(*)
` as const

/**
 * Fetch all announcements visible to the current user.
 *
 * Visibility rules (enforced both by RLS and client-side logic):
 *   - coordinator / principal / admin → see ALL announcements
 *   - teacher → sees 'staff' and 'both' announcements that target their team
 *               or have all_teams = true
 *   - student  → sees 'student' and 'both' announcements that target their
 *               grade/section (or have all_students = true)
 */
export async function fetchAnnouncementsForUser(
  userId: string,
  userRole: UserRole,
  userGrade?: number,
  userSection?: string,
  limit = 10,
  offset = 0,
): Promise<AnnouncementWithDetails[]> {

  // ── Smart board: delegate to student path (sees all-students announcements) ─
  if (userRole === 'smartboard') {
    return fetchAnnouncementsForUser(userId, 'student', userGrade, userSection, limit, offset)
  }

  // ── Coordinator / Principal / Admin: see everything ─────────────────────
  if (['coordinator', 'principal', 'admin'].includes(userRole)) {
    const { data, error } = await supabase
      .from('announcements')
      .select(ANNOUNCEMENT_SELECT)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (error) throw new Error(`Failed to fetch announcements: ${error.message}`)
    return (data ?? []) as AnnouncementWithDetails[]
  }

  // ── Teacher: staff (or 'both') announcements for their teams ─────────────
  if (userRole === 'teacher') {
    const { data: memberships } = await supabase
      .from('team_members')
      .select('team_id')
      .eq('user_id', userId)

    const teamIds = (memberships ?? []).map(m => m.team_id)

    const orFilter = teamIds.length > 0
      ? `all_teams.eq.true,team_id.in.(${teamIds.join(',')})`
      : `all_teams.eq.true`

    const [{ data: matchingAudiences, error: audienceError }, { data: individualAudiences }] =
      await Promise.all([
        supabase.from('announcement_audiences').select('announcement_id').or(orFilter),
        supabase.from('announcement_audiences').select('announcement_id').eq('user_id', userId),
      ])

    if (audienceError) throw new Error(`Failed to fetch audiences: ${audienceError.message}`)

    const ids = new Set((matchingAudiences ?? []).map(a => a.announcement_id))
    ;(individualAudiences ?? []).forEach(a => ids.add(a.announcement_id))

    if (ids.size === 0) return []

    const { data, error } = await supabase
      .from('announcements')
      .select(ANNOUNCEMENT_SELECT)
      .in('id', [...ids])
      .in('type', ['staff', 'both'])
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (error) throw new Error(`Failed to fetch announcements: ${error.message}`)
    return (data ?? []) as AnnouncementWithDetails[]
  }

  // ── Student: student (or 'both') announcements for their grade/section ───
  if (userRole === 'student') {
    const audienceQueries: Promise<{ data: { announcement_id: string }[] | null }>[] = [
      supabase.from('announcement_audiences').select('announcement_id').eq('all_students', true) as any,
      supabase.from('announcement_audiences').select('announcement_id').eq('user_id', userId) as any,
    ]
    if (userGrade != null) {
      const sectionFilter = userSection
        ? `section.is.null,section.eq.${userSection}`
        : `section.is.null`
      audienceQueries.push(
        supabase
          .from('announcement_audiences')
          .select('announcement_id')
          .eq('grade', userGrade)
          .or(sectionFilter) as any
      )
    }

    const results = await Promise.all(audienceQueries)
    const matchedIds = new Set<string>()
    for (const { data } of results) {
      ;(data ?? []).forEach((r: { announcement_id: string }) => matchedIds.add(r.announcement_id))
    }

    if (matchedIds.size === 0) return []

    const { data, error } = await supabase
      .from('announcements')
      .select(ANNOUNCEMENT_SELECT)
      .in('id', Array.from(matchedIds))
      .in('type', ['student', 'both'])
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (error) throw new Error(`Failed to fetch announcements: ${error.message}`)
    return (data ?? []) as AnnouncementWithDetails[]
  }

  return []
}

/**
 * Latest announcements for a homeroom's smart board — student/both notices that
 * either target everyone (all_students) or this homeroom's grade/section.
 * Newest first, capped at `limit` (default 3).
 */
export async function fetchHomeroomAnnouncements(
  grade: number | null,
  section: string | null,
  limit = 3,
): Promise<AnnouncementWithDetails[]> {
  const audienceQueries: Promise<{ data: { announcement_id: string }[] | null }>[] = [
    supabase.from('announcement_audiences').select('announcement_id').eq('all_students', true) as any,
  ]
  if (grade != null) {
    const sectionFilter = section
      ? `section.is.null,section.eq.${section}`
      : `section.is.null`
    audienceQueries.push(
      supabase
        .from('announcement_audiences')
        .select('announcement_id')
        .eq('grade', grade)
        .or(sectionFilter) as any,
    )
  }

  const results = await Promise.all(audienceQueries)
  const matchedIds = new Set<string>()
  for (const { data } of results) {
    ;(data ?? []).forEach((r: { announcement_id: string }) => matchedIds.add(r.announcement_id))
  }
  if (matchedIds.size === 0) return []

  const { data, error } = await supabase
    .from('announcements')
    .select(ANNOUNCEMENT_SELECT)
    .in('id', Array.from(matchedIds))
    .in('type', ['student', 'both'])
    .order('created_at', { ascending: false })
    .range(0, limit - 1)

  if (error) {
    console.error('fetchHomeroomAnnouncements error:', error)
    return []
  }
  return (data ?? []) as AnnouncementWithDetails[]
}

// ---------------------------------------------------------------------------
// Likes
// ---------------------------------------------------------------------------

/**
 * Toggle a like for an announcement.
 * Silently no-ops if the announcement_likes table doesn't exist yet
 * (run announcement-likes-migration.sql to enable persistence).
 */
export async function toggleAnnouncementLike(
  announcementId: string,
  userId: string,
  currentlyLiked: boolean
): Promise<void> {
  if (currentlyLiked) {
    const { error } = await supabase
      .from('announcement_likes')
      .delete()
      .eq('announcement_id', announcementId)
      .eq('user_id', userId)
    if (error) throw new Error(`Failed to unlike: ${error.message}`)
  } else {
    const { error } = await supabase
      .from('announcement_likes')
      .insert({ announcement_id: announcementId, user_id: userId })
    if (error) throw new Error(`Failed to like: ${error.message}`)
  }
}

/** Fetch like counts + which ones the current user has liked, in one query. */
export async function fetchLikesForAnnouncements(
  announcementIds: string[],
  userId: string
): Promise<{ counts: Record<string, number>; liked: Set<string> }> {
  if (announcementIds.length === 0) return { counts: {}, liked: new Set() }

  const { data, error } = await supabase
    .from('announcement_likes')
    .select('announcement_id, user_id')
    .in('announcement_id', announcementIds)

  if (error) {
    // Table may not exist yet — degrade gracefully
    console.warn('Could not fetch announcement likes:', error.message)
    return { counts: {}, liked: new Set() }
  }

  const counts: Record<string, number> = {}
  const liked = new Set<string>()

  for (const row of data ?? []) {
    counts[row.announcement_id] = (counts[row.announcement_id] ?? 0) + 1
    if (row.user_id === userId) liked.add(row.announcement_id)
  }

  return { counts, liked }
}

// ---------------------------------------------------------------------------
// Attachment upload helper
// ---------------------------------------------------------------------------

export async function uploadAnnouncementFile(
  file: File,
): Promise<{ url: string; name: string } | null> {
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
  const path = `announcements/${Date.now()}_${safeName}`
  const { data, error } = await supabase.storage
    .from('classroom-files')
    .upload(path, file, { upsert: true })
  if (error) {
    console.error('Upload failed:', error)
    return null
  }
  const { data: { publicUrl } } = supabase.storage
    .from('classroom-files')
    .getPublicUrl(data.path)
  return { url: publicUrl, name: file.name }
}

// ---------------------------------------------------------------------------
// Team helpers (used by the create form)
// ---------------------------------------------------------------------------

/** Fetch the teams a specific user belongs to. */
export async function fetchTeamsForUser(
  userId: string
): Promise<{ id: string; name: string }[]> {
  const { data: memberships, error } = await supabase
    .from('team_members')
    .select('team_id')
    .eq('user_id', userId)

  if (error) throw new Error(`Failed to fetch team memberships: ${error.message}`)
  if (!memberships || memberships.length === 0) return []

  const { data: teams, error: teamsError } = await supabase
    .from('teams')
    .select('id, name')
    .in('id', memberships.map(m => m.team_id))
    .order('name', { ascending: true })

  if (teamsError) throw new Error(`Failed to fetch teams: ${teamsError.message}`)
  return (teams ?? []) as { id: string; name: string }[]
}

/** Fetch all teams — for principal / admin audience pickers. */
export async function fetchAllTeams(): Promise<{ id: string; name: string }[]> {
  const { data, error } = await supabase
    .from('teams')
    .select('id, name')
    .order('name', { ascending: true })

  if (error) {
    console.error('Failed to fetch all teams:', error)
    return []
  }
  return (data ?? []) as { id: string; name: string }[]
}
