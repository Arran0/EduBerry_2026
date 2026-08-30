// ============================================================================
// Fee engine admin data layer — catalogue, structures, scopes, concessions.
// ----------------------------------------------------------------------------
// Browser-side reads and writes for everything an admin configures before a
// demand run exists. Nothing here calculates: the engine does that, and the
// screens import it directly for previews. Same division as
// src/lib/payroll/admin.ts.
//
// Money-moving writes are deliberately NOT here — they live behind
// /api/fees/* routes with an admin guard, because RLS can say who may write but
// not what a valid state transition is.
// ============================================================================

import { supabase } from '@/lib/supabase'
import type {
  FeeAssignmentRow, FeeConcessionRow, FeeHeadRow, FeePolicyGroupRow,
  FeeStructureRow, StudentDimensionRow,
} from './rows'
import {
  toConcession, toFeeHead, toStructure, toStructureScope, toStudentContext, toStudentScope,
} from './rows'
import type {
  Concession, FeeHeadDef, FeeStructure, FeeStructureScope, StudentFeeContext,
} from './engine/types'

type Result = { success: boolean; error?: string }

function fail(where: string, error: { message: string } | null): Result {
  if (error) { console.error(`${where} failed:`, error); return { success: false, error: error.message } }
  return { success: true }
}

// ── Catalogue ───────────────────────────────────────────────────────────────

const HEAD_COLUMNS =
  'id, code, name, description, default_amount, kind, frequency, sequence, ' +
  'refundable, concession_eligible, gl_code, active'

export async function fetchFeeHeadDefs(): Promise<FeeHeadDef[]> {
  const { data, error } = await supabase
    .from('fee_heads').select(HEAD_COLUMNS).order('sequence').order('name')
  if (error) { console.error('fetchFeeHeadDefs failed:', error); return [] }
  return ((data ?? []) as unknown as FeeHeadRow[]).map(toFeeHead)
}

export interface FeeHeadDefInput {
  name: string
  code: string
  kind: FeeHeadDef['kind']
  frequency: FeeHeadDef['frequency']
  default_amount: number
  sequence?: number
  refundable?: boolean
  concession_eligible?: boolean
  gl_code?: string | null
  description?: string | null
  active?: boolean
}

export async function saveFeeHeadDef(id: string | null, input: FeeHeadDefInput): Promise<Result> {
  if (id) return fail('saveFeeHeadDef', (await supabase.from('fee_heads').update(input).eq('id', id)).error)
  const { data: { user } } = await supabase.auth.getUser()
  return fail('saveFeeHeadDef', (await supabase.from('fee_heads').insert({ ...input, created_by: user?.id })).error)
}

// ── Structures ──────────────────────────────────────────────────────────────

const STRUCTURE_COLUMNS =
  'id, name, code, academic_year, version, status, effective_from, effective_to, ' +
  'allow_partial, grace_days, late_fee_head_id, notes, published_at'

const ITEM_COLUMNS =
  'id, structure_id, fee_head_id, calc_type, amount, percent_of, percent_value, formula, ' +
  'slabs, slab_on, installment_plan, sequence, is_optional, ' +
  'fee_head:fee_heads!fee_head_id(code, name, concession_eligible)'

export async function fetchStructures(year?: string): Promise<FeeStructure[]> {
  let q = supabase
    .from('fee_structures')
    .select(`${STRUCTURE_COLUMNS}, items:fee_structure_items(${ITEM_COLUMNS})`)
    .order('academic_year', { ascending: false })
    .order('version', { ascending: false })
  if (year) q = q.eq('academic_year', year)
  const { data, error } = await q
  if (error) { console.error('fetchStructures failed:', error); return [] }
  return ((data ?? []) as unknown as FeeStructureRow[]).map(toStructure)
}

/** Structure headers with their status, for the list screen. */
export async function fetchStructureRows(year?: string): Promise<FeeStructureRow[]> {
  let q = supabase.from('fee_structures').select(STRUCTURE_COLUMNS)
    .order('academic_year', { ascending: false }).order('version', { ascending: false })
  if (year) q = q.eq('academic_year', year)
  const { data, error } = await q
  if (error) { console.error('fetchStructureRows failed:', error); return [] }
  return (data ?? []) as unknown as FeeStructureRow[]
}

export interface StructureInput {
  name: string
  academic_year: string
  effective_from: string
  effective_to?: string | null
  allow_partial?: boolean
  grace_days?: number | null
  late_fee_head_id?: string | null
  notes?: string | null
}

export async function createStructure(input: StructureInput): Promise<{ success: boolean; id?: string; error?: string }> {
  const { data: { user } } = await supabase.auth.getUser()
  const { data, error } = await supabase
    .from('fee_structures').insert({ ...input, created_by: user?.id }).select('id').single()
  if (error) { console.error('createStructure failed:', error); return { success: false, error: error.message } }
  return { success: true, id: data.id }
}

/**
 * A new version of an existing structure, copying its items. This is the only
 * way to change a published structure — editing one in place would silently
 * alter what already-issued invoices claim they were computed from, and the
 * database refuses it anyway.
 */
export async function reviseStructure(
  structureId: string,
  effectiveFrom: string,
): Promise<{ success: boolean; id?: string; error?: string }> {
  const { data: src, error: sErr } = await supabase
    .from('fee_structures')
    .select(`${STRUCTURE_COLUMNS}, items:fee_structure_items(${ITEM_COLUMNS})`)
    .eq('id', structureId).single()
  if (sErr || !src) return { success: false, error: sErr?.message ?? 'Structure not found' }

  const row = src as unknown as FeeStructureRow
  const { data: { user } } = await supabase.auth.getUser()

  const { data: created, error: cErr } = await supabase.from('fee_structures').insert({
    name: row.name, code: row.code, academic_year: row.academic_year,
    version: row.version + 1, status: 'draft',
    effective_from: effectiveFrom, effective_to: row.effective_to,
    allow_partial: row.allow_partial, grace_days: row.grace_days,
    late_fee_head_id: row.late_fee_head_id, notes: row.notes,
    created_by: user?.id,
  }).select('id').single()
  if (cErr) { console.error('reviseStructure failed:', cErr); return { success: false, error: cErr.message } }

  const items = (row.items ?? []).map(i => ({
    structure_id: created.id, fee_head_id: i.fee_head_id, calc_type: i.calc_type,
    amount: i.amount, percent_of: i.percent_of, percent_value: i.percent_value,
    formula: i.formula, slabs: i.slabs, slab_on: i.slab_on,
    installment_plan: i.installment_plan, sequence: i.sequence, is_optional: i.is_optional,
  }))
  if (items.length) {
    const { error: iErr } = await supabase.from('fee_structure_items').insert(items)
    if (iErr) { console.error('reviseStructure(items) failed:', iErr); return { success: false, error: iErr.message } }
  }

  // Close the old version the day before the new one starts, so the two never
  // both claim the same day.
  const dayBefore = new Date(effectiveFrom)
  dayBefore.setDate(dayBefore.getDate() - 1)
  await supabase.from('fee_structures')
    .update({ effective_to: dayBefore.toISOString().slice(0, 10) })
    .eq('id', structureId)

  return { success: true, id: created.id }
}

export async function publishStructure(structureId: string): Promise<Result> {
  const { data: { user } } = await supabase.auth.getUser()
  return fail('publishStructure', (await supabase.from('fee_structures').update({
    status: 'published', published_by: user?.id, published_at: new Date().toISOString(),
  }).eq('id', structureId)).error)
}

export async function archiveStructure(structureId: string): Promise<Result> {
  return fail('archiveStructure', (await supabase.from('fee_structures').update({ status: 'archived' }).eq('id', structureId)).error)
}

// ── Structure items ─────────────────────────────────────────────────────────

export interface StructureItemInput {
  structure_id: string
  fee_head_id: string
  calc_type: 'fixed' | 'percent_of' | 'formula' | 'slab'
  amount?: number | null
  percent_of?: string | null
  percent_value?: number | null
  formula?: string | null
  slabs?: { match: string; amount: number }[] | null
  slab_on?: string | null
  installment_plan?: { no: number; label: string; due: string; share: number }[] | null
  sequence?: number
  is_optional?: boolean
}

export async function saveStructureItem(id: string | null, input: StructureItemInput): Promise<Result> {
  if (id) return fail('saveStructureItem', (await supabase.from('fee_structure_items').update(input).eq('id', id)).error)
  return fail('saveStructureItem', (await supabase.from('fee_structure_items').insert(input)).error)
}

export async function deleteStructureItem(id: string): Promise<Result> {
  return fail('deleteStructureItem', (await supabase.from('fee_structure_items').delete().eq('id', id)).error)
}

// ── Policy groups and assignments → engine scopes ───────────────────────────

const GROUP_COLUMNS =
  'id, name, description, is_default, priority, match, effective_from, effective_to, ' +
  'members:fee_policy_group_members(student_id)'

export async function fetchPolicyGroups(): Promise<FeePolicyGroupRow[]> {
  const { data, error } = await supabase
    .from('fee_policy_groups').select(GROUP_COLUMNS).order('priority', { ascending: false })
  if (error) { console.error('fetchPolicyGroups failed:', error); return [] }
  return (data ?? []) as unknown as FeePolicyGroupRow[]
}

export async function fetchAssignments(): Promise<FeeAssignmentRow[]> {
  const { data, error } = await supabase
    .from('fee_structure_assignments')
    .select('id, structure_id, scope, group_id, student_id, effective_from, effective_to, structure:fee_structures!structure_id(name, version)')
    .order('effective_from', { ascending: false })
  if (error) { console.error('fetchAssignments failed:', error); return [] }
  return (data ?? []) as unknown as FeeAssignmentRow[]
}

/**
 * Every scope the engine should consider, built from the groups and the
 * assignments that bind them to structures. A group with no assignment governs
 * nobody, which is why this is a join rather than a list of groups.
 */
export function buildScopes(
  groups: FeePolicyGroupRow[],
  assignments: FeeAssignmentRow[],
): FeeStructureScope[] {
  const byId = new Map(groups.map(g => [g.id, g]))
  const out: FeeStructureScope[] = []
  for (const a of assignments) {
    if (a.scope === 'student') { out.push(toStudentScope(a)); continue }
    const g = a.group_id ? byId.get(a.group_id) : undefined
    if (g) out.push(toStructureScope(g, a))
  }
  return out
}

export async function fetchScopes(): Promise<FeeStructureScope[]> {
  const [groups, assignments] = await Promise.all([fetchPolicyGroups(), fetchAssignments()])
  return buildScopes(groups, assignments)
}

export interface PolicyGroupInput {
  name: string
  description?: string | null
  is_default?: boolean
  priority?: number
  match?: Record<string, unknown> | null
  effective_from?: string
  effective_to?: string | null
}

export async function savePolicyGroup(id: string | null, input: PolicyGroupInput): Promise<{ success: boolean; id?: string; error?: string }> {
  if (id) {
    const { error } = await supabase.from('fee_policy_groups').update(input).eq('id', id)
    if (error) { console.error('savePolicyGroup failed:', error); return { success: false, error: error.message } }
    return { success: true, id }
  }
  const { data: { user } } = await supabase.auth.getUser()
  const { data, error } = await supabase
    .from('fee_policy_groups').insert({ ...input, created_by: user?.id }).select('id').single()
  if (error) { console.error('savePolicyGroup failed:', error); return { success: false, error: error.message } }
  return { success: true, id: data.id }
}

export async function setGroupMembers(groupId: string, studentIds: string[]): Promise<Result> {
  const { error: dErr } = await supabase.from('fee_policy_group_members').delete().eq('group_id', groupId)
  if (dErr) return fail('setGroupMembers(clear)', dErr)
  if (!studentIds.length) return { success: true }
  return fail('setGroupMembers', (await supabase.from('fee_policy_group_members')
    .insert(studentIds.map(student_id => ({ group_id: groupId, student_id })))).error)
}

export interface AssignmentInput {
  structure_id: string
  scope: 'group' | 'student'
  group_id?: string | null
  student_id?: string | null
  effective_from: string
  effective_to?: string | null
}

export async function createAssignment(input: AssignmentInput): Promise<Result> {
  const { data: { user } } = await supabase.auth.getUser()
  const { error } = await supabase.from('fee_structure_assignments').insert({ ...input, created_by: user?.id })
  if (error) {
    // The exclusion constraint is the likeliest failure and its raw message is
    // unreadable; say what the admin actually needs to do about it.
    if (error.message.includes('fee_structure_assignments_no_overlap')) {
      return { success: false, error: 'That cohort already has a fee structure covering these dates. End the existing assignment first.' }
    }
    console.error('createAssignment failed:', error)
    return { success: false, error: error.message }
  }
  return { success: true }
}

/** End an assignment rather than deleting it, so past demand stays explicable. */
export async function endAssignment(id: string, effectiveTo: string): Promise<Result> {
  return fail('endAssignment', (await supabase.from('fee_structure_assignments')
    .update({ effective_to: effectiveTo }).eq('id', id)).error)
}

// ── Concessions ─────────────────────────────────────────────────────────────

const CONCESSION_COLUMNS =
  'id, student_id, fee_head_id, kind, value, category, reason, academic_year, ' +
  'effective_from, effective_to, status, requested_by, approved_by, approved_at'

export async function fetchConcessions(filter: {
  studentId?: string; status?: FeeConcessionRow['status']; year?: string
} = {}): Promise<FeeConcessionRow[]> {
  let q = supabase.from('fee_concessions').select(CONCESSION_COLUMNS).order('requested_at', { ascending: false })
  if (filter.studentId) q = q.eq('student_id', filter.studentId)
  if (filter.status) q = q.eq('status', filter.status)
  if (filter.year) q = q.eq('academic_year', filter.year)
  const { data, error } = await q
  if (error) { console.error('fetchConcessions failed:', error); return [] }
  return (data ?? []) as unknown as FeeConcessionRow[]
}

export async function fetchApprovedConcessionsFor(studentIds: string[]): Promise<Map<string, Concession[]>> {
  const out = new Map<string, Concession[]>()
  if (!studentIds.length) return out
  const { data, error } = await supabase
    .from('fee_concessions').select(CONCESSION_COLUMNS)
    .in('student_id', studentIds).eq('status', 'approved')
  if (error) { console.error('fetchApprovedConcessionsFor failed:', error); return out }
  for (const r of (data ?? []) as unknown as FeeConcessionRow[]) {
    const list = out.get(r.student_id) ?? []
    list.push(toConcession(r))
    out.set(r.student_id, list)
  }
  return out
}

export interface ConcessionInput {
  student_id: string
  fee_head_id?: string | null
  kind: 'percent' | 'amount' | 'full'
  value: number
  category: Concession['category']
  reason?: string | null
  academic_year?: string | null
  effective_from?: string
  effective_to?: string | null
}

/** Request a concession. Approval is a separate, server-guarded action. */
export async function requestConcession(input: ConcessionInput): Promise<Result> {
  const { data: { user } } = await supabase.auth.getUser()
  return fail('requestConcession', (await supabase.from('fee_concessions')
    .insert({ ...input, status: 'pending', requested_by: user?.id })).error)
}

// ── Student context for the engine ──────────────────────────────────────────

/**
 * Build the engine's view of a cohort of students in a bounded number of
 * queries — one per dimension rather than one per student, because a demand run
 * covers the whole school.
 */
export async function buildStudentContexts(
  studentIds: string[],
  opts: { academicYear?: string } = {},
): Promise<StudentFeeContext[]> {
  if (!studentIds.length) return []

  const [profilesRes, detailsRes, homeroomRes, familyRes, concessions] = await Promise.all([
    supabase.from('profiles').select('id, full_name').in('id', studentIds),
    supabase.from('student_details')
      .select('student_id, fee_category, transport_zone, is_staff_ward, family_id')
      .in('student_id', studentIds),
    supabase.from('homeroom_members')
      .select('student_id, homeroom:homerooms!homeroom_id(id, grade, section, academic_year)')
      .in('student_id', studentIds),
    supabase.from('fee_family_members')
      .select('profile_id, sibling_rank').in('profile_id', studentIds).eq('role', 'student'),
    fetchApprovedConcessionsFor(studentIds),
  ])

  const names = new Map((profilesRes.data ?? []).map(p => [p.id as string, p.full_name as string]))
  const dims = new Map(((detailsRes.data ?? []) as unknown as StudentDimensionRow[]).map(d => [d.student_id, d]))
  const ranks = new Map(((familyRes.data ?? []) as { profile_id: string; sibling_rank: number | null }[])
    .map(f => [f.profile_id, f.sibling_rank]))

  type HrRow = { student_id: string; homeroom: { id: string; grade: number | null; section: string | null; academic_year: string | null } | null }
  const homerooms = new Map<string, { ids: string[]; grade: number | null; section: string | null }>()
  for (const raw of (homeroomRes.data ?? []) as unknown as HrRow[]) {
    const hr = Array.isArray(raw.homeroom) ? raw.homeroom[0] : raw.homeroom
    if (!hr) continue
    // Where a year is given, only that year's homeroom decides class and
    // section — a student who has moved up must not be billed last year's fee.
    if (opts.academicYear && hr.academic_year && hr.academic_year !== opts.academicYear) continue
    const entry = homerooms.get(raw.student_id) ?? { ids: [], grade: null, section: null }
    entry.ids.push(hr.id)
    if (entry.grade === null) { entry.grade = hr.grade; entry.section = hr.section }
    homerooms.set(raw.student_id, entry)
  }

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
      // Transport opt-in comes from the bus module's passenger list, resolved
      // by the demand-run route rather than here.
      optedInHeadIds: [],
      concessions: [],
    })
    // Already filtered to approved by fetchApprovedConcessionsFor.
    return { ...ctx, concessions: concessions.get(id) ?? [] }
  })
}

/** Every student's engine context plus the scopes, ready to compute. */
export async function loadEngineInputs(studentIds: string[], academicYear?: string): Promise<{
  students: StudentFeeContext[]
  scopes: FeeStructureScope[]
  structures: Record<string, FeeStructure>
}> {
  const [students, scopes, structureList] = await Promise.all([
    buildStudentContexts(studentIds, { academicYear }),
    fetchScopes(),
    fetchStructures(academicYear),
  ])
  const structures: Record<string, FeeStructure> = {}
  for (const s of structureList) structures[s.id] = s
  return { students, scopes, structures }
}
