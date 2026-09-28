import { supabase, UserRole } from './supabase'

/**
 * Report cards stay hidden from students until their class's cards are
 * published, and publication happens one class at a time: a grade + section +
 * report card title, which is exactly the scope the Class Marks view already
 * works at.
 *
 * There is deliberately no per-student publication. An individual card is never
 * released or withdrawn on its own — it only reports the status of the class it
 * belongs to, so a class can never be half-published.
 *
 * The database is the real gate (RLS on report_card_publications); the helpers
 * here mirror the same rule so the UI can show the right controls rather than
 * offering a button that will be refused.
 */

/** Sections are typed by hand in several places, so identity is always on the
 *  trimmed, upper-cased value — the unique index in the database is too. */
export function normalizeSection(section: string): string {
  return section.trim().toUpperCase()
}

/** Key for one publishable class: grade + section + report card title. */
export function publicationKey(grade: number, section: string, title: string): string {
  return `${grade}|${normalizeSection(section)}|${title}`
}

export interface ReportCardPublication {
  id: string
  grade: number
  section: string
  report_card_title: string
  published_by: string | null
  published_at: string
}

/** Roles that may publish any class's report cards, anywhere in the school. */
const SENIOR_ROLES: UserRole[] = ['principal', 'admin']

/**
 * Whether this viewer may publish or unpublish the given class.
 *
 * Admins and principals may do so anywhere. A teacher may do so only for a
 * grade + section they are the *class teacher* of — teaching a subject to the
 * class is not enough, the decision belongs to whoever owns the homeroom.
 *
 * `classTeacherOf` is the viewer's own homerooms (see
 * fetchHomeroomsForClassTeacher), passed in so this stays a pure check.
 */
export function canPublishReportCards(
  viewerRole: UserRole,
  classTeacherOf: { grade: number | null; section: string | null }[],
  grade: number,
  section: string,
): boolean {
  if (SENIOR_ROLES.includes(viewerRole)) return true
  const wanted = normalizeSection(section)
  return classTeacherOf.some(h =>
    h.grade === grade && h.section != null && normalizeSection(h.section) === wanted)
}

/** The publication row for one class, or null when its cards are still held back. */
export async function fetchPublication(
  grade: number,
  section: string,
  reportCardTitle: string,
): Promise<ReportCardPublication | null> {
  const { data, error } = await supabase
    .from('report_card_publications')
    .select('*')
    .eq('grade', grade)
    .ilike('section', normalizeSection(section))
    .eq('report_card_title', reportCardTitle)
    .maybeSingle()

  if (error) {
    console.error('fetchPublication error:', error)
    return null
  }
  return (data as ReportCardPublication) ?? null
}

/** Releases a class's report cards to its students. Idempotent. */
export async function publishReportCards(
  grade: number,
  section: string,
  reportCardTitle: string,
  publishedBy: string,
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase
    .from('report_card_publications')
    .insert({
      grade,
      section: normalizeSection(section),
      report_card_title: reportCardTitle,
      published_by: publishedBy,
    })

  // Already published — the class is in the state the caller asked for.
  if (error && error.code === '23505') return { ok: true }
  if (error) {
    console.error('publishReportCards error:', error)
    return { ok: false, error: permissionMessage(error.code) }
  }
  return { ok: true }
}

/** Withdraws a class's report cards from its students. Idempotent. */
export async function unpublishReportCards(
  grade: number,
  section: string,
  reportCardTitle: string,
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase
    .from('report_card_publications')
    .delete()
    .eq('grade', grade)
    .ilike('section', normalizeSection(section))
    .eq('report_card_title', reportCardTitle)

  if (error) {
    console.error('unpublishReportCards error:', error)
    return { ok: false, error: permissionMessage(error.code) }
  }
  return { ok: true }
}

/** RLS refuses a write by returning a row-level-security error rather than a
 *  message a user can act on, so name the actual rule instead. */
function permissionMessage(code?: string): string {
  return code === '42501'
    ? 'Only this class’s class teacher, a principal or an admin can change this.'
    : 'Could not save that — please try again.'
}

/**
 * Which of the given classes have had their report cards published, as a set of
 * publicationKey() strings. Used to gate a student's own view: their cards are
 * grouped by title across the classrooms they sit in, and each of those
 * classrooms carries the grade + section the publication was made against.
 */
export async function fetchPublishedKeys(
  classes: { grade: number | null; section: string | null }[],
): Promise<Set<string>> {
  const grades = [...new Set(classes.map(c => c.grade).filter((g): g is number => g != null))]
  if (grades.length === 0) return new Set()

  const { data, error } = await supabase
    .from('report_card_publications')
    .select('grade, section, report_card_title')
    .in('grade', grades)

  if (error) {
    // Fail closed: an unreadable publication table must not release cards that
    // were never published.
    console.error('fetchPublishedKeys error:', error)
    return new Set()
  }

  return new Set((data ?? []).map(r => {
    const row = r as { grade: number; section: string; report_card_title: string }
    return publicationKey(row.grade, row.section, row.report_card_title)
  }))
}
