import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  toConcession, toStructure, toStructureScope, toStudentContext, toStudentScope,
  type FeeAssignmentRow, type FeeConcessionRow, type FeePolicyGroupRow,
  type FeeStructureRow, type StudentDimensionRow,
} from './rows'
import type { Concession, FeeStructure, FeeStructureScope, StudentFeeContext } from './engine/types'

// ============================================================================
// Loading the engine's inputs on the server.
// ----------------------------------------------------------------------------
// The same reads as src/lib/fees/admin.ts but against a passed-in client rather
// than the browser singleton, because a demand run covers the whole school and
// has to run with the service role. The mappers themselves are shared — only
// the queries differ.
//
// Every read is bounded: one query per dimension, not one per student. A run
// over 1,200 students must not be 6,000 round trips.
// ============================================================================

const STRUCTURE_COLUMNS =
  'id, name, code, academic_year, version, status, effective_from, effective_to, ' +
  'allow_partial, grace_days, late_fee_head_id, notes, published_at'

const ITEM_COLUMNS =
  'id, structure_id, fee_head_id, calc_type, amount, percent_of, percent_value, formula, ' +
  'slabs, slab_on, installment_plan, sequence, is_optional, ' +
  'fee_head:fee_heads!fee_head_id(code, name, concession_eligible)'

const CONCESSION_COLUMNS =
  'id, student_id, fee_head_id, kind, value, category, reason, academic_year, ' +
  'effective_from, effective_to, status, requested_by, approved_by, approved_at'

export interface EngineInputs {
  students: StudentFeeContext[]
  scopes: FeeStructureScope[]
  structures: Record<string, FeeStructure>
}

/**
 * Only PUBLISHED structures can bill. A draft is a work in progress and must
 * never reach a parent's invoice; that is the whole point of having a status.
 */
export async function loadStructures(
  db: SupabaseClient,
  academicYear?: string,
): Promise<Record<string, FeeStructure>> {
  let q = db
    .from('fee_structures')
    .select(`${STRUCTURE_COLUMNS}, items:fee_structure_items(${ITEM_COLUMNS})`)
    .eq('status', 'published')
  if (academicYear) q = q.eq('academic_year', academicYear)

  const { data, error } = await q
  if (error) { console.error('loadStructures failed:', error); return {} }

  const out: Record<string, FeeStructure> = {}
  for (const row of (data ?? []) as unknown as FeeStructureRow[]) out[row.id] = toStructure(row)
  return out
}

export async function loadScopes(db: SupabaseClient): Promise<FeeStructureScope[]> {
  const [groupsRes, assignmentsRes] = await Promise.all([
    db.from('fee_policy_groups')
      .select('id, name, description, is_default, priority, match, effective_from, effective_to, members:fee_policy_group_members(student_id)'),
    db.from('fee_structure_assignments')
      .select('id, structure_id, scope, group_id, student_id, effective_from, effective_to'),
  ])

  const groups = new Map(
    ((groupsRes.data ?? []) as unknown as FeePolicyGroupRow[]).map(g => [g.id, g]),
  )
  const out: FeeStructureScope[] = []
  for (const a of (assignmentsRes.data ?? []) as unknown as FeeAssignmentRow[]) {
    if (a.scope === 'student') { out.push(toStudentScope(a)); continue }
    const g = a.group_id ? groups.get(a.group_id) : undefined
    // A group that was deleted leaves its assignment behind; billing against a
    // cohort nobody can name is worse than not billing.
    if (g) out.push(toStructureScope(g, a))
  }
  return out
}

/** Students of the given homerooms, or every student when none are named. */
export async function resolveStudentIds(
  db: SupabaseClient,
  homeroomIds: string[] | null,
): Promise<string[]> {
  if (homeroomIds?.length) {
    const { data } = await db
      .from('homeroom_members').select('student_id').in('homeroom_id', homeroomIds)
    return [...new Set((data ?? []).map(r => r.student_id as string))]
  }
  const { data } = await db
    .from('profiles').select('id').eq('role', 'student').neq('is_banned', true)
  return (data ?? []).map(r => r.id as string)
}

export async function loadStudentContexts(
  db: SupabaseClient,
  studentIds: string[],
  academicYear?: string,
): Promise<StudentFeeContext[]> {
  if (!studentIds.length) return []

  const [profilesRes, detailsRes, homeroomRes, familyRes, concessionRes, transportRes] = await Promise.all([
    db.from('profiles').select('id, full_name').in('id', studentIds),
    db.from('student_details')
      .select('student_id, fee_category, transport_zone, is_staff_ward, family_id')
      .in('student_id', studentIds),
    db.from('homeroom_members')
      .select('student_id, homeroom:homerooms!homeroom_id(id, grade, section, academic_year)')
      .in('student_id', studentIds),
    db.from('fee_family_members')
      .select('profile_id, sibling_rank').in('profile_id', studentIds).eq('role', 'student'),
    db.from('fee_concessions').select(CONCESSION_COLUMNS).in('student_id', studentIds).eq('status', 'approved'),
    // Transport opt-in is the bus module's passenger list — a student on a
    // route is opted into the transport head, and nobody has to tick a second box.
    db.from('trip_passengers').select('passenger_id').in('passenger_id', studentIds),
  ])

  const names = new Map((profilesRes.data ?? []).map(p => [p.id as string, p.full_name as string]))
  const dims = new Map(
    ((detailsRes.data ?? []) as unknown as StudentDimensionRow[]).map(d => [d.student_id, d]),
  )
  const ranks = new Map(
    ((familyRes.data ?? []) as { profile_id: string; sibling_rank: number | null }[])
      .map(f => [f.profile_id, f.sibling_rank]),
  )
  const busPassengers = new Set((transportRes.data ?? []).map(r => r.passenger_id as string))

  const concessions = new Map<string, Concession[]>()
  for (const r of (concessionRes.data ?? []) as unknown as FeeConcessionRow[]) {
    const list = concessions.get(r.student_id) ?? []
    list.push(toConcession(r))
    concessions.set(r.student_id, list)
  }

  type HrRow = {
    student_id: string
    homeroom: { id: string; grade: number | null; section: string | null; academic_year: string | null } | null
  }
  const homerooms = new Map<string, { ids: string[]; grade: number | null; section: string | null }>()
  for (const raw of (homeroomRes.data ?? []) as unknown as HrRow[]) {
    const hr = Array.isArray(raw.homeroom) ? raw.homeroom[0] : raw.homeroom
    if (!hr) continue
    // Where a year is given, only that year's homeroom decides class and
    // section. A student who has moved up must not be billed last year's fee.
    if (academicYear && hr.academic_year && hr.academic_year !== academicYear) continue
    const entry = homerooms.get(raw.student_id) ?? { ids: [], grade: null, section: null }
    entry.ids.push(hr.id)
    if (entry.grade === null) { entry.grade = hr.grade; entry.section = hr.section }
    homerooms.set(raw.student_id, entry)
  }

  // Transport heads a bus passenger is billed for. Resolved once rather than
  // per student.
  const { data: transportHeads } = await db.from('fee_heads').select('id').eq('kind', 'transport')
  const transportHeadIds = (transportHeads ?? []).map(h => h.id as string)

  return studentIds.map(id => {
    const hr = homerooms.get(id)
    const ctx = toStudentContext({
      id,
      name: names.get(id) ?? 'Student',
      grade: hr?.grade ?? null,
      section: hr?.section ?? null,
      homeroomIds: hr?.ids ?? [],
      dimensions: dims.get(id) ?? null,
      siblingRank: ranks.get(id) ?? null,
      optedInHeadIds: busPassengers.has(id) ? transportHeadIds : [],
      concessions: [],
    })
    // Already filtered to approved by the query above.
    return { ...ctx, concessions: concessions.get(id) ?? [] }
  })
}

export async function loadEngineInputs(
  db: SupabaseClient,
  opts: { academicYear?: string; homeroomIds?: string[] | null } = {},
): Promise<EngineInputs> {
  const studentIds = await resolveStudentIds(db, opts.homeroomIds ?? null)
  const [students, scopes, structures] = await Promise.all([
    loadStudentContexts(db, studentIds, opts.academicYear),
    loadScopes(db),
    loadStructures(db, opts.academicYear),
  ])
  return { students, scopes, structures }
}
