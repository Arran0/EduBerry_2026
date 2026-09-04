// ─────────────────────────────────────────────────────────────────────────────
// The academic year, in one place.
//
// Before this module the app derived the current session three different ways:
//
//   academicYearOf   (src/lib/fees.ts)             Apr-Mar
//   getAcademicYear  (src/lib/homeroomAutoManage.ts) Jan-Dec, documented as such
//   fetchAvailable…  (src/lib/classrooms.ts)        start_date.split('-')[0]
//
// Between January and March those three disagree, so a fee issued in February
// and the homeroom it was issued against could belong to different sessions.
// Fees, promotion, carry-forward balances and "collect for last year" all need
// one answer, and it now comes from the `academic_years` table rather than a
// rule reimplemented per file.
//
// The Apr-Mar rule survives here only as `deriveYearCode`, the fallback for a
// date no stored session covers. A stored row always wins.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase, isMissingRelation } from '@/lib/supabase'

export interface AcademicYearRow {
  id: string
  code: string
  starts_on: string
  ends_on: string
  is_active: boolean
  status: 'planning' | 'active' | 'closed'
  promoted_at: string | null
  notes: string | null
}

/** '2026-2027' and '2026' both mean '2026-27'. Mirrors normalize_academic_year_code(). */
export function normalizeYearCode(code: string | null | undefined): string | null {
  if (!code) return null
  const trimmed = code.trim()
  if (/^\d{4}-\d{2}$/.test(trimmed)) return trimmed
  if (/^\d{4}-\d{4}$/.test(trimmed)) return `${trimmed.slice(0, 5)}${trimmed.slice(-2)}`
  if (/^\d{4}$/.test(trimmed)) {
    const start = Number(trimmed)
    return `${start}-${String((start + 1) % 100).padStart(2, '0')}`
  }
  return trimmed
}

/**
 * The Apr-Mar rule. Only a fallback — used when no stored session covers a date,
 * and when the app has to name a year before it has talked to the database.
 */
export function deriveYearCode(date: string | Date = new Date()): string {
  const d = typeof date === 'string' ? new Date(date) : date
  const start = d.getMonth() + 1 >= 4 ? d.getFullYear() : d.getFullYear() - 1
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`
}

/** '2026-27' → 1 April 2026 and 31 March 2027, the dates a new row defaults to. */
export function defaultYearDates(code: string): { starts_on: string; ends_on: string } | null {
  const normalized = normalizeYearCode(code)
  if (!normalized || !/^\d{4}-\d{2}$/.test(normalized)) return null
  const start = Number(normalized.slice(0, 4))
  return { starts_on: `${start}-04-01`, ends_on: `${start + 1}-03-31` }
}

/** Every session, newest first. */
export async function listAcademicYears(): Promise<AcademicYearRow[]> {
  const { data, error } = await supabase
    .from('academic_years')
    .select('id, code, starts_on, ends_on, is_active, status, promoted_at, notes')
    .order('starts_on', { ascending: false })

  // A deployment that has not run fee_r1_academic_years.sql yet should degrade
  // to "no stored years" rather than throwing — the same shape every other
  // module in this repo uses for an unapplied migration.
  if (error) {
    if (isMissingRelation(error)) return []
    throw error
  }
  return (data ?? []) as AcademicYearRow[]
}

export async function fetchActiveAcademicYear(): Promise<AcademicYearRow | null> {
  const { data, error } = await supabase
    .from('academic_years')
    .select('id, code, starts_on, ends_on, is_active, status, promoted_at, notes')
    .eq('is_active', true)
    .maybeSingle()
  if (error) {
    if (isMissingRelation(error)) return null
    throw error
  }
  return (data as AcademicYearRow) ?? null
}

/** Which stored session contains a date, or null if none does. */
export function yearForDate(years: AcademicYearRow[], date: string): AcademicYearRow | null {
  return years.find(y => y.starts_on <= date && date <= y.ends_on) ?? null
}

export function yearByCode(years: AcademicYearRow[], code: string): AcademicYearRow | null {
  const normalized = normalizeYearCode(code)
  return years.find(y => y.code === normalized) ?? null
}

/**
 * How far through a session a date is, 0 to 1.
 *
 * This is what puts the marker on the Collection Center's efficiency bar in
 * Round 4: "62% collected" means nothing until you can see the year is half
 * gone. Kept here rather than in the report so the bar and the year list can
 * never disagree about when the session ends.
 */
export function sessionProgress(year: AcademicYearRow, on: string): number {
  const start = Date.parse(`${year.starts_on}T00:00:00Z`)
  const end   = Date.parse(`${year.ends_on}T00:00:00Z`)
  const at    = Date.parse(`${on}T00:00:00Z`)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0
  return Math.min(1, Math.max(0, (at - start) / (end - start)))
}

export async function createAcademicYear(input: {
  code: string
  starts_on?: string
  ends_on?: string
  notes?: string | null
}): Promise<AcademicYearRow> {
  const normalized = normalizeYearCode(input.code)
  if (!normalized || !/^\d{4}-\d{2}$/.test(normalized)) {
    throw new Error(`"${input.code}" is not an academic year like 2026-27.`)
  }
  const defaults = defaultYearDates(normalized)!
  const { data, error } = await supabase
    .from('academic_years')
    .insert({
      code: normalized,
      starts_on: input.starts_on || defaults.starts_on,
      ends_on: input.ends_on || defaults.ends_on,
      notes: input.notes ?? null,
    })
    .select()
    .single()
  if (error) throw error
  return data as AcademicYearRow
}

export async function updateAcademicYear(
  id: string,
  patch: Partial<Pick<AcademicYearRow, 'starts_on' | 'ends_on' | 'notes' | 'status'>>,
): Promise<void> {
  const { error } = await supabase.from('academic_years').update(patch).eq('id', id)
  if (error) throw error
}

/**
 * Switch the active session.
 *
 * An RPC rather than an UPDATE because clearing the old flag and setting the
 * new one has to happen in one statement — the partial unique index rejects a
 * moment where two rows are active, which is exactly the protection wanted.
 */
export async function setActiveAcademicYear(id: string): Promise<void> {
  const { error } = await supabase.rpc('set_active_academic_year', { p_id: id })
  if (error) throw error
}
