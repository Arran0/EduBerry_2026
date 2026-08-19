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
  /** Pinned announcements are kept at the top of the feed */
  pinned?: boolean
  pinned_at?: string | null
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
 * Set to false the first time Postgres tells us the `pinned` column is missing
 * (i.e. supabase-migrations/add_announcement_pinning.sql hasn't been run yet),
 * so the feed keeps working — just without pin-first ordering.
 */
let pinnedColumnAvailable = true

function isMissingPinnedColumn(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false
  return error.code === '42703' || (error.message ?? '').includes('pinned')
}

/**
 * Run an announcements query with the shared select fragment, ordering pinned
 * announcements first and falling back gracefully when the column is absent.
 * `applyFilters` receives the query builder and returns it with filters applied.
 */
async function queryAnnouncements(
  applyFilters: (q: any) => any,
  limit: number,
  offset: number,
): Promise<{ data: AnnouncementWithDetails[] | null; error: { message: string } | null }> {
  const run = async (withPinned: boolean) => {
    let q = applyFilters(supabase.from('announcements').select(ANNOUNCEMENT_SELECT))
    if (withPinned) q = q.order('pinned', { ascending: false })
    return q
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)
  }

  const first = await run(pinnedColumnAvailable)
  if (first.error && pinnedColumnAvailable && isMissingPinnedColumn(first.error)) {
    pinnedColumnAvailable = false
    return run(false)
  }
  return first
}

/**
 * Which announcements a given user is allowed to see.
 *   - 'all'  → coordinator / principal / admin see everything
 *   - 'ids'  → everyone else sees the announcements their audience rows match,
 *              narrowed further by announcement type
 * Resolving this separately from fetching lets the feed and the unread-badge
 * count share exactly one definition of "targeted at me".
 */
export type AnnouncementScope =
  | { kind: 'all' }
  | { kind: 'ids'; ids: string[]; types: AnnouncementType[] }

export async function resolveAnnouncementScope(
  userId: string,
  userRole: UserRole,
  userGrade?: number,
  userSection?: string,
): Promise<AnnouncementScope> {

  // Smart board: same reach as a student in that homeroom
  if (userRole === 'smartboard') {
    return resolveAnnouncementScope(userId, 'student', userGrade, userSection)
  }

  if (['coordinator', 'principal', 'admin'].includes(userRole)) {
    return { kind: 'all' }
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

    return { kind: 'ids', ids: [...ids], types: ['staff', 'both'] }
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

    return { kind: 'ids', ids: [...matchedIds], types: ['student', 'both'] }
  }

  return { kind: 'ids', ids: [], types: [] }
}

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
  const scope = await resolveAnnouncementScope(userId, userRole, userGrade, userSection)

  if (scope.kind === 'ids' && scope.ids.length === 0) return []

  const { data, error } = await queryAnnouncements(
    q => scope.kind === 'all' ? q : q.in('id', scope.ids).in('type', scope.types),
    limit,
    offset,
  )

  if (error) throw new Error(`Failed to fetch announcements: ${error.message}`)
  return (data ?? []) as AnnouncementWithDetails[]
}

/**
 * How many announcements aimed at this user have appeared since `sinceIso`.
 * Drives the navbar badge. The user's own announcements never count — you
 * don't need telling about the notice you just wrote.
 */
export async function countUnreadAnnouncements(
  userId: string,
  userRole: UserRole,
  sinceIso: string,
  userGrade?: number,
  userSection?: string,
): Promise<number> {
  const scope = await resolveAnnouncementScope(userId, userRole, userGrade, userSection)
  if (scope.kind === 'ids' && scope.ids.length === 0) return 0

  let q = supabase
    .from('announcements')
    .select('id', { count: 'exact', head: true })
    .gt('created_at', sinceIso)
    .neq('created_by', userId)

  if (scope.kind === 'ids') q = q.in('id', scope.ids).in('type', scope.types)

  const { count, error } = await q
  if (error) {
    console.warn('Could not count unread announcements:', error.message)
    return 0
  }
  return count ?? 0
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

  const { data, error } = await queryAnnouncements(
    q => q.in('id', Array.from(matchedIds)).in('type', ['student', 'both']),
    limit,
    0,
  )

  if (error) {
    console.error('fetchHomeroomAnnouncements error:', error)
    return []
  }
  return (data ?? []) as AnnouncementWithDetails[]
}

// ---------------------------------------------------------------------------
// Pinning
// ---------------------------------------------------------------------------

/**
 * Pin / unpin an announcement. Only the announcer (creator) or a
 * principal/admin passes the RLS update policy — see
 * supabase-migrations/add_announcement_pinning.sql.
 */
export async function setAnnouncementPinned(
  announcementId: string,
  pinned: boolean,
): Promise<void> {
  const { error } = await supabase
    .from('announcements')
    .update({ pinned, pinned_at: pinned ? new Date().toISOString() : null })
    .eq('id', announcementId)

  if (error) {
    if (isMissingPinnedColumn(error)) {
      pinnedColumnAvailable = false
      throw new Error('Pinning is not enabled yet — run add_announcement_pinning.sql')
    }
    throw new Error(`Failed to ${pinned ? 'pin' : 'unpin'} announcement: ${error.message}`)
  }
}

/** True when the announcement schema supports pinning (column present). */
export function isPinningAvailable(): boolean {
  return pinnedColumnAvailable
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
