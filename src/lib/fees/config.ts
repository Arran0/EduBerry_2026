// ─────────────────────────────────────────────────────────────────────────────
// The price list, client side.
//
// Straight CRUD over the Round 1 configuration tables, plus the mappers that
// turn database rows into the engine's own types. Nothing here calculates —
// that all lives in src/lib/fees/engine, which has no Supabase import so it can
// be tested without one.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase, isMissingRelation } from '@/lib/supabase'
import { inChunks } from './chunk'
import { cached, invalidate } from './cache'
import { tryResolveStructure } from './engine/structure'
import { toPaise } from './engine/money'
import type {
  FeeGroup as EngineGroup, FeeStructure as EngineStructure,
} from './engine/types'

// ── Row shapes ──────────────────────────────────────────────────────────
export interface FeeCategoryRow {
  id: string; name: string; code: string; sort: number; active: boolean
}

export interface FeeHeadRow {
  id: string
  academic_year_id: string
  category_id: string | null
  name: string
  code: string
  description: string | null
  default_amount: number | string
  tax_rate: number | string
  tax_inclusive: boolean
  is_refundable: boolean
  is_transport: boolean
  sort: number
  active: boolean
}

export interface FeeGroupRow {
  id: string
  academic_year_id: string
  name: string
  code: string
  is_default: boolean
  is_rte: boolean
  description: string | null
}

export interface FeeStructureItemRow {
  id: string; structure_id: string; fee_head_id: string
  amount: number | string; tax_rate: number | string; sort: number
}

export interface FeeInstallmentRow {
  id: string
  structure_id: string
  seq: number
  name: string
  due_date: string
  amount: number | string | null
  percent: number | string | null
  autogen_enabled: boolean
  autogen_days_before: number
  sort: number
}

export interface FeeInstallmentItemRow {
  id: string; installment_id: string; fee_head_id: string; amount: number | string
}

export interface FeeStructureRow {
  id: string
  academic_year_id: string
  fee_group_id: string
  grade: number | null
  name: string
  status: 'draft' | 'published' | 'archived'
  total_cached: number | string
  notes: string | null
}

export interface FeeGroupAssignmentRow {
  id: string
  academic_year_id: string
  student_id: string
  fee_group_id: string
  is_rte: boolean
  prorate_from: string | null
  note: string | null
}

/** Everything the engine needs for one academic year, fetched together. */
export interface FeeConfigBundle {
  categories: FeeCategoryRow[]
  heads: FeeHeadRow[]
  groups: FeeGroupRow[]
  structures: FeeStructureRow[]
  items: FeeStructureItemRow[]
  installments: FeeInstallmentRow[]
  installmentItems: FeeInstallmentItemRow[]
}

const EMPTY_BUNDLE: FeeConfigBundle = {
  categories: [], heads: [], groups: [], structures: [],
  items: [], installments: [], installmentItems: [],
}

/**
 * One year's whole price list, in seven queries rather than a query per
 * structure. `PERFORMANCE.md` is explicit that looping a query per row is the
 * repo's most expensive recurring mistake, so the joins happen in memory.
 */
export async function fetchFeeConfig(academicYearId: string): Promise<FeeConfigBundle> {
  if (!academicYearId) return EMPTY_BUNDLE
  return cached(`${CONFIG_KEY}${academicYearId}`, () => loadFeeConfig(academicYearId))
}

/** Invalidated by every write below, and expiring anyway — see `cache.ts`. */
const CONFIG_KEY = 'fee-config:'

/** Drop the cached price list, so the next read goes to the database. */
export function invalidateFeeConfig(): void {
  invalidate(CONFIG_KEY)
}

async function loadFeeConfig(academicYearId: string): Promise<FeeConfigBundle> {
  const [cats, heads, groups, structures] = await Promise.all([
    supabase.from('fee_categories').select('id, name, code, sort, active').order('sort'),
    supabase.from('fee_heads')
      .select('id, academic_year_id, category_id, name, code, description, default_amount, tax_rate, tax_inclusive, is_refundable, is_transport, sort, active')
      .eq('academic_year_id', academicYearId).order('sort'),
    supabase.from('fee_groups')
      .select('id, academic_year_id, name, code, is_default, is_rte, description')
      .eq('academic_year_id', academicYearId).order('is_default', { ascending: false }),
    supabase.from('fee_structures')
      .select('id, academic_year_id, fee_group_id, grade, name, status, total_cached, notes')
      .eq('academic_year_id', academicYearId).order('grade', { nullsFirst: true }),
  ])

  for (const r of [cats, heads, groups, structures]) {
    if (r.error) {
      if (isMissingRelation(r.error)) return EMPTY_BUNDLE
      throw r.error
    }
  }

  const structureIds = (structures.data ?? []).map(s => s.id as string)
  if (structureIds.length === 0) {
    return {
      ...EMPTY_BUNDLE,
      categories: (cats.data ?? []) as FeeCategoryRow[],
      heads: (heads.data ?? []) as FeeHeadRow[],
      groups: (groups.data ?? []) as FeeGroupRow[],
      structures: [],
    }
  }

  const [items, installments] = await Promise.all([
    supabase.from('fee_structure_items')
      .select('id, structure_id, fee_head_id, amount, tax_rate, sort')
      .in('structure_id', structureIds).order('sort'),
    supabase.from('fee_installments')
      .select('id, structure_id, seq, name, due_date, amount, percent, autogen_enabled, autogen_days_before, sort')
      .in('structure_id', structureIds).order('seq'),
  ])
  if (items.error) throw items.error
  if (installments.error) throw installments.error

  const installmentIds = (installments.data ?? []).map(i => i.id as string)
  let installmentItems: FeeInstallmentItemRow[] = []
  if (installmentIds.length > 0) {
    const { data, error } = await supabase
      .from('fee_installment_items')
      .select('id, installment_id, fee_head_id, amount')
      .in('installment_id', installmentIds)
    if (error) throw error
    installmentItems = (data ?? []) as FeeInstallmentItemRow[]
  }

  return {
    categories: (cats.data ?? []) as FeeCategoryRow[],
    heads: (heads.data ?? []) as FeeHeadRow[],
    groups: (groups.data ?? []) as FeeGroupRow[],
    structures: (structures.data ?? []) as FeeStructureRow[],
    items: (items.data ?? []) as FeeStructureItemRow[],
    installments: (installments.data ?? []) as FeeInstallmentRow[],
    installmentItems,
  }
}

// ── Row → engine mappers ────────────────────────────────────────────────
// The engine works in paise and camelCase; the database in NUMERIC and
// snake_case. Converting in one place keeps `toPaise` out of the engine's
// callers and stops a rupee figure ever reaching it by accident.

function toEngineGroup(row: FeeGroupRow): EngineGroup {
  return {
    id: row.id, code: row.code, name: row.name,
    isDefault: row.is_default, isRte: row.is_rte,
  }
}

function toEngineStructures(bundle: FeeConfigBundle): EngineStructure[] {
  const itemsBy = groupBy(bundle.items, i => i.structure_id)
  const instBy = groupBy(bundle.installments, i => i.structure_id)
  const instItemsBy = groupBy(bundle.installmentItems, i => i.installment_id)

  return bundle.structures.map(s => ({
    id: s.id,
    academicYearId: s.academic_year_id,
    feeGroupId: s.fee_group_id,
    grade: s.grade,
    name: s.name,
    status: s.status,
    items: (itemsBy.get(s.id) ?? []).map(i => ({
      feeHeadId: i.fee_head_id,
      amount: toPaise(i.amount),
      taxRate: Number(i.tax_rate) || 0,
      sort: i.sort,
    })),
    installments: (instBy.get(s.id) ?? []).map(i => ({
      id: i.id,
      seq: i.seq,
      name: i.name,
      dueDate: i.due_date,
      amount: i.amount === null ? null : toPaise(i.amount),
      percent: i.percent === null ? null : Number(i.percent),
      items: (instItemsBy.get(i.id) ?? []).map(ii => ({
        feeHeadId: ii.fee_head_id,
        amount: toPaise(ii.amount),
      })),
      autogenEnabled: i.autogen_enabled,
      autogenDaysBefore: i.autogen_days_before,
      sort: i.sort,
    })),
  }))
}

function groupBy<T, K>(rows: T[], key: (row: T) => K): Map<K, T[]> {
  const out = new Map<K, T[]>()
  for (const row of rows) {
    const k = key(row)
    const list = out.get(k)
    if (list) list.push(row)
    else out.set(k, [row])
  }
  return out
}

// ── Writes ──────────────────────────────────────────────────────────────

export async function saveHead(
  patch: Partial<FeeHeadRow> & { academic_year_id: string; name: string; code: string },
): Promise<void> {
  const { error } = await supabase.from('fee_heads')
    .upsert(patch, { onConflict: 'academic_year_id,code' })
  if (error) throw error
  invalidateFeeConfig()
}

export async function deleteHead(id: string): Promise<void> {
  // fee_structure_items references heads with ON DELETE RESTRICT, so a head in
  // use refuses to go. Surface that as advice rather than a Postgres code.
  const { error } = await supabase.from('fee_heads').delete().eq('id', id)
  if (error) {
    if (error.code === '23503') {
      throw new Error('This fee head is used by a fee structure. Remove it there first, or mark it inactive instead.')
    }
    throw error
  }
  invalidateFeeConfig()
}

export async function saveGroup(
  patch: Partial<FeeGroupRow> & { academic_year_id: string; name: string; code: string },
): Promise<void> {
  const { error } = await supabase.from('fee_groups')
    .upsert(patch, { onConflict: 'academic_year_id,code' })
  if (error) throw error
  invalidateFeeConfig()
}

export async function createStructure(input: {
  academic_year_id: string
  fee_group_id: string
  grade: number | null
  name: string
}): Promise<FeeStructureRow> {
  const { data, error } = await supabase.from('fee_structures')
    .insert({ ...input, status: 'draft' }).select().single()
  if (error) {
    if (error.code === '23505') {
      throw new Error('A structure already exists for that group and grade.')
    }
    throw error
  }
  invalidateFeeConfig()
  return data as FeeStructureRow
}

export async function setStructureStatus(
  id: string, status: FeeStructureRow['status'],
): Promise<void> {
  const { error } = await supabase.from('fee_structures').update({ status }).eq('id', id)
  if (error) throw error
  invalidateFeeConfig()
}

export async function deleteStructure(id: string): Promise<void> {
  const { error } = await supabase.from('fee_structures').delete().eq('id', id)
  if (error) throw error
  invalidateFeeConfig()
}

export async function setStructureItem(
  structureId: string, feeHeadId: string, amountRupees: number, sort: number,
): Promise<void> {
  const { error } = await supabase.from('fee_structure_items')
    .upsert({ structure_id: structureId, fee_head_id: feeHeadId, amount: amountRupees, sort },
            { onConflict: 'structure_id,fee_head_id' })
  if (error) throw error
  invalidateFeeConfig()
}

export async function removeStructureItem(structureId: string, feeHeadId: string): Promise<void> {
  const { error } = await supabase.from('fee_structure_items')
    .delete().eq('structure_id', structureId).eq('fee_head_id', feeHeadId)
  if (error) throw error
  invalidateFeeConfig()
}

export async function saveInstallment(
  patch: Partial<FeeInstallmentRow> & { structure_id: string; seq: number; name: string; due_date: string },
): Promise<void> {
  const { error } = await supabase.from('fee_installments')
    .upsert(patch, { onConflict: 'structure_id,seq' })
  if (error) throw error
  invalidateFeeConfig()
}

export async function deleteInstallment(id: string): Promise<void> {
  const { error } = await supabase.from('fee_installments').delete().eq('id', id)
  if (error) throw error
  invalidateFeeConfig()
}

/** Persist a drag reorder in one round trip rather than one update per row. */

export async function setAutogen(
  installmentId: string, enabled: boolean, daysBefore: number,
): Promise<void> {
  const { error } = await supabase.from('fee_installments')
    .update({ autogen_enabled: enabled, autogen_days_before: daysBefore })
    .eq('id', installmentId)
  if (error) throw error
  invalidateFeeConfig()
}

export interface CloneResult {
  heads: number; groups: number; structures: number
  structure_items: number; installments: number; installment_items: number
  year_delta: number
}

export async function cloneFeeYear(fromYearId: string, toYearId: string): Promise<CloneResult> {
  const { data, error } = await supabase.rpc('fee_clone_year', {
    p_from: fromYearId, p_to: toYearId,
  })
  if (error) throw error
  invalidateFeeConfig()
  return data as CloneResult
}

// ── Student → group ─────────────────────────────────────────────────────
async function fetchGroupAssignments(
  academicYearId: string,
): Promise<FeeGroupAssignmentRow[]> {
  const { data, error } = await supabase.from('fee_group_assignments')
    .select('id, academic_year_id, student_id, fee_group_id, is_rte, prorate_from, note')
    .eq('academic_year_id', academicYearId)
  if (error) {
    if (isMissingRelation(error)) return []
    throw error
  }
  return (data ?? []) as FeeGroupAssignmentRow[]
}


/** Put a whole class in a group in one statement. */

// ── The roster: who is in which group ───────────────────────────────────
export interface RosterStudent {
  student_id: string
  full_name: string
  grade: number | null
  section: string | null
  admission_no: string | null
  /** From fee_group_assignments. Null means nobody has said, so the default applies. */
  assigned_group_id: string | null
  assigned_is_rte: boolean
  prorate_from: string | null
  note: string | null
  /**
   * The group the student's fee profile was actually built with, if they have
   * one. This can differ from the assignment: `fee_create_profiles` reads the
   * assignment once, at creation, and bakes the result into the profile.
   * Showing both is what stops "I changed her group and nothing happened".
   */
  profile_id: string | null
  profile_group_id: string | null
}

/**
 * Every student in the school with their group assignment and their profile's
 * group, in three queries rather than one per student.
 */
export async function fetchRoster(academicYearId: string): Promise<RosterStudent[]> {
  const [{ data: students, error: sErr }, assignments, { data: profiles }] = await Promise.all([
    supabase.from('profiles')
      .select('id, full_name, grade, section')
      .eq('role', 'student')
      .eq('is_banned', false)
      .order('grade').order('section').order('full_name'),
    fetchGroupAssignments(academicYearId),
    supabase.from('fee_profiles')
      .select('id, student_id, fee_group_id')
      .eq('academic_year_id', academicYearId),
  ])
  if (sErr) {
    if (isMissingRelation(sErr)) return []
    throw sErr
  }

  const byStudent = new Map(assignments.map(a => [a.student_id, a]))
  const profByStudent = new Map(
    (profiles ?? []).map(p => [
      (p as { student_id: string }).student_id,
      p as { id: string; student_id: string; fee_group_id: string | null },
    ]))

  const admission = await fetchAdmissionNumbers((students ?? []).map(s => (s as { id: string }).id))

  return (students ?? []).map(row => {
    const s = row as { id: string; full_name: string; grade: number | null; section: string | null }
    const a = byStudent.get(s.id)
    const p = profByStudent.get(s.id)
    return {
      student_id: s.id,
      full_name: s.full_name,
      grade: s.grade,
      section: s.section,
      admission_no: admission.get(s.id) ?? null,
      assigned_group_id: a?.fee_group_id ?? null,
      assigned_is_rte: a?.is_rte ?? false,
      prorate_from: a?.prorate_from ?? null,
      note: a?.note ?? null,
      profile_id: p?.id ?? null,
      profile_group_id: p?.fee_group_id ?? null,
    }
  })
}

/** Admission numbers live on student_details, batched like every other id list. */
async function fetchAdmissionNumbers(ids: string[]): Promise<Map<string, string | null>> {
  type Row = { student_id: string; admission_no: string | null }
  const rows = await inChunks(ids, async batch => {
    const { data, error } = await supabase.from('student_details')
      .select('student_id, admission_no').in('student_id', batch)
    if (error) {
      if (isMissingRelation(error)) return [] as Row[]
      throw error
    }
    return (data ?? []) as Row[]
  })
  return new Map(rows.map(r => [r.student_id, r.admission_no]))
}

export interface ReassignResult {
  assigned: number
  /** Profiles re-priced because they already existed when the group changed. */
  repriced: number
  /** Students whose new group has no published structure that fits them. */
  unpriced: { studentId: string; name: string; reason: string }[]
}

/**
 * Put students in a group — and re-price the ones who already have a profile.
 *
 * The assignment table alone is not enough. `fee_create_profiles` reads it
 * once, when the profile is made, and writes the resolved structure onto the
 * profile; every bill after that comes from the profile. So moving a student
 * who is already billed would change nothing anybody could see, which is the
 * worst kind of control — one that looks like it worked.
 *
 * Re-resolution uses `resolveStructure`, the same four-rank ladder
 * `fee_generate_invoices` walks in SQL, so a profile repriced here and one
 * created by the server land on the same structure with the same stated
 * reason. The `why` is carried onto the profile, because a parent asking why
 * their bill changed deserves the answer the engine already has.
 *
 * Bills that have already been issued are deliberately untouched. Re-pricing
 * decides what the *next* bill costs; rewriting a bill the family has been
 * sent is a different act, with its own permission and its own paper trail.
 */
export async function reassignGroup(input: {
  academicYearId: string
  studentIds: string[]
  feeGroupId: string
  isRte?: boolean
  prorateFrom?: string | null
  note?: string | null
  /** The price list, so the re-resolution does not refetch it per student. */
  bundle: FeeConfigBundle
  roster: RosterStudent[]
}): Promise<ReassignResult> {
  const { academicYearId, studentIds, feeGroupId, bundle, roster } = input
  if (studentIds.length === 0) return { assigned: 0, repriced: 0, unpriced: [] }

  const group = bundle.groups.find(g => g.id === feeGroupId)
  const isRte = input.isRte ?? group?.is_rte ?? false

  const { error } = await supabase.from('fee_group_assignments').upsert(
    studentIds.map(student_id => ({
      academic_year_id: academicYearId,
      student_id,
      fee_group_id: feeGroupId,
      is_rte: isRte,
      prorate_from: input.prorateFrom ?? null,
      note: input.note ?? null,
      updated_at: new Date().toISOString(),
    })),
    { onConflict: 'student_id,academic_year_id' })
  if (error) throw error

  // Re-price the ones already carrying a profile.
  const engineGroups = bundle.groups.map(toEngineGroup)
  const engineStructures = toEngineStructures(bundle)
  const byId = new Map(roster.map(r => [r.student_id, r]))
  const unpriced: ReassignResult['unpriced'] = []
  let repriced = 0

  // Resolve first, write second. Every student is priced in memory, then the
  // profiles that landed on the same structure are updated together: moving a
  // class of forty used to be forty round trips from a browser, and a class
  // almost always resolves to one structure, so this is one.
  const batches = new Map<string, { structureId: string; source: unknown; ids: string[] }>()

  for (const studentId of studentIds) {
    const person = byId.get(studentId)
    if (!person?.profile_id) continue

    const resolved = tryResolveStructure(
      {
        studentId,
        grade: person.grade,
        feeGroupId,
        prorateFrom: input.prorateFrom ?? null,
        isRte,
      },
      engineGroups,
      engineStructures)

    if (!resolved.ok) {
      unpriced.push({ studentId, name: person.full_name, reason: resolved.reason })
      continue
    }

    // The stated reason is part of the key: two students on the same structure
    // for different reasons must keep their own `why`, which is what a parent
    // asking about their bill is shown.
    const source = resolved.resolved.source
    const key = `${resolved.resolved.structure.id}|${JSON.stringify(source)}`
    const batch = batches.get(key)
      ?? { structureId: resolved.resolved.structure.id, source, ids: [] }
    batch.ids.push(person.profile_id)
    batches.set(key, batch)
    repriced += 1
  }

  const stamp = new Date().toISOString()
  for (const batch of batches.values()) {
    await inChunks(batch.ids, async ids => {
      const { error: uErr } = await supabase.from('fee_profiles').update({
        fee_group_id: feeGroupId,
        structure_id: batch.structureId,
        structure_source: batch.source,
        is_rte: isRte,
        prorate_from: input.prorateFrom ?? null,
        updated_at: stamp,
      }).in('id', ids)
      if (uErr) throw uErr
      return []
    })
  }

  return { assigned: studentIds.length, repriced, unpriced }
}

/** Take students out of every group, so the default applies again. */
export async function clearAssignments(
  academicYearId: string, studentIds: string[],
): Promise<number> {
  if (studentIds.length === 0) return 0
  const { error } = await supabase.from('fee_group_assignments')
    .delete().eq('academic_year_id', academicYearId).in('student_id', studentIds)
  if (error) throw error
  return studentIds.length
}
