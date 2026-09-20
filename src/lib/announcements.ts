import { supabase, UserProfile } from './supabase'

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
  /** Total likes, counted server-side with the feed row */
  like_count: number
  /** Whether the requesting user is one of them */
  liked_by_me: boolean
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
// Feed
// ---------------------------------------------------------------------------

/**
 * Who may see what is decided entirely by the RLS SELECT policy on
 * `announcements` (see supabase-migrations/add_announcement_feed_rpcs.sql and
 * fix_announcement_individual_audience_visibility.sql):
 *
 *   - coordinator / principal / admin → all announcements
 *   - teacher  → 'staff'/'both' notices for their teams, or all_teams
 *   - student  → 'student'/'both' notices for their grade/section, or all_students
 *   - smartboard → the same reach as the homeroom it displays
 *   - anyone   → notices addressed to them individually
 *
 * The feed RPCs are SECURITY INVOKER, so that policy is the single source of
 * truth. The client no longer mirrors those rules: it used to pull every
 * matching `announcement_audiences` row into the browser and post the ids back
 * as an ever-growing `id=in.(...)` filter, which the database then re-filtered
 * through RLS anyway. Audiences, creator and like state ride along with each
 * page instead of costing a round trip apiece.
 */

/** Shape returned by the feed RPCs — audiences/creator arrive as JSON. */
interface AnnouncementFeedRow extends Omit<AnnouncementWithDetails, 'audiences' | 'creator'> {
  audiences: AnnouncementAudience[] | null
  creator: UserProfile | null
}

function toAnnouncements(rows: AnnouncementFeedRow[] | null): AnnouncementWithDetails[] {
  return (rows ?? []).map(row => ({
    ...row,
    audiences: row.audiences ?? [],
    creator: row.creator ?? undefined,
    like_count: row.like_count ?? 0,
    liked_by_me: row.liked_by_me ?? false,
  }))
}

/**
 * One page of the announcements feed, pinned first then newest first.
 * A single request: visibility, audiences, creator and likes all resolve in the
 * database.
 */
export async function fetchAnnouncementsForUser(
  limit = 10,
  offset = 0,
): Promise<AnnouncementWithDetails[]> {
  const { data, error } = await supabase.rpc('get_announcement_feed', {
    p_limit: limit,
    p_offset: offset,
  })

  if (error) throw new Error(`Failed to fetch announcements: ${error.message}`)
  return toAnnouncements(data as AnnouncementFeedRow[] | null)
}

/** A headline in the home notifications box — all that box needs of a notice. */
export interface UnreadAnnouncement {
  id: string
  title: string
  created_at: string
}

/**
 * The announcements this user hasn't read, newest first — the rows the home
 * notifications box lists alongside their OD / Leave notifications.
 *
 * Same shape of answer as the feed RPC: RLS decides what is visible, the
 * reader's own markers in `announcement_reads` decide what has been read, and
 * their own posts are excluded (you don't need telling about the notice you
 * just wrote). `sinceIso` is this device's old "everything before this was
 * seen" badge mark, kept as a floor so accounts that were already caught up
 * before read markers existed don't open to the school's back catalogue.
 *
 * Three columns rather than the feed's payload: the box shows headlines.
 */
export async function fetchUnreadAnnouncements(
  sinceIso: string | null,
  limit = 5,
): Promise<UnreadAnnouncement[]> {
  const { data, error } = await supabase.rpc('get_unread_announcements', {
    p_since: sinceIso,
    p_limit: limit,
  })

  if (error) {
    console.warn('Could not load unread announcements:', error.message)
    return []
  }
  return (data as UnreadAnnouncement[] | null) ?? []
}

/**
 * How many announcements aimed at this user have appeared since `sinceIso`.
 * Drives the navbar badge. The user's own announcements never count — you
 * don't need telling about the notice you just wrote.
 */
export async function countUnreadAnnouncements(sinceIso: string): Promise<number> {
  const { data, error } = await supabase.rpc('count_unread_announcements', {
    p_since: sinceIso,
  })

  if (error) {
    console.warn('Could not count unread announcements:', error.message)
    return 0
  }
  return (data as number | null) ?? 0
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
  const { data, error } = await supabase.rpc('get_homeroom_announcement_feed', {
    p_grade: grade,
    p_section: section,
    p_limit: limit,
  })

  if (error) {
    console.error('fetchHomeroomAnnouncements error:', error)
    return []
  }
  return toAnnouncements(data as AnnouncementFeedRow[] | null)
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
    throw new Error(`Failed to ${pinned ? 'pin' : 'unpin'} announcement: ${error.message}`)
  }
}

// ---------------------------------------------------------------------------
// Likes
// ---------------------------------------------------------------------------

/** Toggle a like for an announcement. */
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
    .upload(path, file, { upsert: true, cacheControl: '31536000' })
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
