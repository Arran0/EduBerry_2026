import { SupabaseClient } from '@supabase/supabase-js'

// ── Academic year helpers ────────────────────────────────────

/**
 * Returns the academic year label for a given date based on the calendar year.
 * e.g. any date in 2026 → "2026-27", any date in 2027 → "2027-28"
 */
export function getAcademicYear(date: Date = new Date()): string {
  const year = date.getFullYear()
  const shortNext = String(year + 1).slice(-2)
  return `${year}-${shortNext}`
}

/**
 * Returns the default expiry date for an academic year (May 31 of the end year).
 * e.g. "2026-27" → "2027-05-31"
 */
export function getDefaultExpiryDate(academicYear: string): string {
  const match = academicYear.match(/^(\d{4})-(\d{2,4})$/)
  if (!match) return ''
  const startYear = parseInt(match[1])
  return `${startYear + 1}-05-31`
}

/**
 * Looks up admin_settings for a custom expiry date for the given academic year.
 * Falls back to getDefaultExpiryDate if no custom date is configured.
 */
async function resolveExpiryDate(adminClient: SupabaseClient, academicYear: string): Promise<string> {
  const { data } = await adminClient
    .from('admin_settings')
    .select('value')
    .eq('key', 'homeroom_expiry_dates')
    .single()

  if (data?.value && typeof data.value === 'object') {
    const custom = (data.value as Record<string, string>)[academicYear]
    if (custom) return custom
  }

  return getDefaultExpiryDate(academicYear)
}

/**
 * Finds an existing grade+section+academic_year homeroom, or creates one.
 * Uses a unique index (grade, section, academic_year) to prevent duplicates.
 * Returns the homeroom id, or null on failure.
 */
async function findOrCreateGradeSectionHomeroom(
  adminClient: SupabaseClient,
  grade: number,
  section: string,
  academicYear: string,
  expiryDate: string
): Promise<string | null> {
  // Look for existing homeroom
  const { data: existing } = await adminClient
    .from('homerooms')
    .select('id')
    .eq('grade', grade)
    .eq('section', section)
    .eq('academic_year', academicYear)
    .maybeSingle()

  if (existing) return existing.id

  // Create new homeroom
  const name = `Grade ${grade} Section ${section} (${academicYear})`
  const { data: created, error } = await adminClient
    .from('homerooms')
    .insert({ name, grade, section, academic_year: academicYear, expiry_date: expiryDate })
    .select('id')
    .single()

  if (!error && created) return created.id

  // Race condition: another request created it between our check and insert
  const { data: retry } = await adminClient
    .from('homerooms')
    .select('id')
    .eq('grade', grade)
    .eq('section', section)
    .eq('academic_year', academicYear)
    .maybeSingle()

  return retry?.id ?? null
}

/**
 * Syncs a student's homeroom membership whenever their grade or section changes.
 *
 * Rules:
 * - Only runs when the student role is 'student' and both grade+section are set.
 * - Academic year is determined from today's calendar year (Jan–Dec 2026 → "2026-27").
 * - If the student previously had a different grade/section, removes them from the
 *   old academic-year homeroom before adding to the new one.
 * - If grade/section is cleared (null/empty), removes from the old homeroom only.
 * - The homeroom is auto-created if no matching one exists for this academic year.
 * - Expiry date is read from admin_settings key "homeroom_expiry_dates"; defaults
 *   to May 31 of the academic year's end year (e.g. 2027-05-31 for "2026-27").
 */
export async function syncStudentHomeroom(
  adminClient: SupabaseClient,
  studentId: string,
  newGrade: number | null | undefined,
  newSection: string | null | undefined,
  previousGrade?: number | null,
  previousSection?: string | null
): Promise<void> {
  const hasNew = newGrade != null && newSection != null && newSection !== ''
  const hasPrev = previousGrade != null && previousSection != null && previousSection !== ''

  const gradeChanged = newGrade !== previousGrade
  const sectionChanged = newSection !== previousSection
  const changed = gradeChanged || sectionChanged

  const academicYear = getAcademicYear()
  const expiryDate = await resolveExpiryDate(adminClient, academicYear)

  // Remove from old homeroom when grade/section changed or was cleared
  if (hasPrev && changed) {
    const { data: oldRoom } = await adminClient
      .from('homerooms')
      .select('id')
      .eq('grade', previousGrade!)
      .eq('section', previousSection!)
      .eq('academic_year', academicYear)
      .maybeSingle()

    if (oldRoom) {
      await adminClient
        .from('homeroom_members')
        .delete()
        .eq('homeroom_id', oldRoom.id)
        .eq('student_id', studentId)
    }
  }

  // Add to new homeroom
  if (hasNew) {
    const homeroomId = await findOrCreateGradeSectionHomeroom(
      adminClient,
      newGrade!,
      newSection!,
      academicYear,
      expiryDate
    )

    if (homeroomId) {
      // upsert handles the case where the student is already a member
      await adminClient
        .from('homeroom_members')
        .upsert(
          { homeroom_id: homeroomId, student_id: studentId },
          { onConflict: 'homeroom_id,student_id', ignoreDuplicates: true }
        )
    }
  }
}
