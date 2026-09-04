// ─────────────────────────────────────────────────────────────────────────────
// The price list, client side.
//
// Straight CRUD over the Round 1 configuration tables, plus the mappers that
// turn database rows into the engine's own types. Nothing here calculates —
// that all lives in src/lib/fees/engine, which has no Supabase import so it can
// be tested without one.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase, isMissingRelation } from '@/lib/supabase'
import { toPaise } from './engine/money'
import type {
  FeeGroup as EngineGroup, FeeHead as EngineHead, FeeStructure as EngineStructure,
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

export function toEngineHead(row: FeeHeadRow): EngineHead {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    categoryId: row.category_id,
    taxRate: Number(row.tax_rate) || 0,
    taxInclusive: row.tax_inclusive,
    isTransport: row.is_transport,
    sort: row.sort,
  }
}

export function toEngineGroup(row: FeeGroupRow): EngineGroup {
  return {
    id: row.id, code: row.code, name: row.name,
    isDefault: row.is_default, isRte: row.is_rte,
  }
}

export function toEngineStructures(bundle: FeeConfigBundle): EngineStructure[] {
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
export async function saveCategory(
  patch: Partial<FeeCategoryRow> & { name: string; code: string },
): Promise<void> {
  const { error } = await supabase.from('fee_categories')
    .upsert(patch, { onConflict: 'code' })
  if (error) throw error
}

export async function saveHead(
  patch: Partial<FeeHeadRow> & { academic_year_id: string; name: string; code: string },
): Promise<void> {
  const { error } = await supabase.from('fee_heads')
    .upsert(patch, { onConflict: 'academic_year_id,code' })
  if (error) throw error
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
}

export async function saveGroup(
  patch: Partial<FeeGroupRow> & { academic_year_id: string; name: string; code: string },
): Promise<void> {
  const { error } = await supabase.from('fee_groups')
    .upsert(patch, { onConflict: 'academic_year_id,code' })
  if (error) throw error
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
  return data as FeeStructureRow
}

export async function setStructureStatus(
  id: string, status: FeeStructureRow['status'],
): Promise<void> {
  const { error } = await supabase.from('fee_structures').update({ status }).eq('id', id)
  if (error) throw error
}

export async function deleteStructure(id: string): Promise<void> {
  const { error } = await supabase.from('fee_structures').delete().eq('id', id)
  if (error) throw error
}

export async function setStructureItem(
  structureId: string, feeHeadId: string, amountRupees: number, sort: number,
): Promise<void> {
  const { error } = await supabase.from('fee_structure_items')
    .upsert({ structure_id: structureId, fee_head_id: feeHeadId, amount: amountRupees, sort },
            { onConflict: 'structure_id,fee_head_id' })
  if (error) throw error
}

export async function removeStructureItem(structureId: string, feeHeadId: string): Promise<void> {
  const { error } = await supabase.from('fee_structure_items')
    .delete().eq('structure_id', structureId).eq('fee_head_id', feeHeadId)
  if (error) throw error
}

export async function saveInstallment(
  patch: Partial<FeeInstallmentRow> & { structure_id: string; seq: number; name: string; due_date: string },
): Promise<void> {
  const { error } = await supabase.from('fee_installments')
    .upsert(patch, { onConflict: 'structure_id,seq' })
  if (error) throw error
}

export async function deleteInstallment(id: string): Promise<void> {
  const { error } = await supabase.from('fee_installments').delete().eq('id', id)
  if (error) throw error
}

/** Persist a drag reorder in one round trip rather than one update per row. */
export async function reorderInstallments(ordered: { id: string; sort: number }[]): Promise<void> {
  if (ordered.length === 0) return
  const { error } = await supabase.from('fee_installments')
    .upsert(ordered.map(o => ({ id: o.id, sort: o.sort })), { onConflict: 'id' })
  if (error) throw error
}

export async function setAutogen(
  installmentId: string, enabled: boolean, daysBefore: number,
): Promise<void> {
  const { error } = await supabase.from('fee_installments')
    .update({ autogen_enabled: enabled, autogen_days_before: daysBefore })
    .eq('id', installmentId)
  if (error) throw error
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
  return data as CloneResult
}

// ── Student → group ─────────────────────────────────────────────────────
export async function fetchGroupAssignments(
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

export async function assignGroup(input: {
  academic_year_id: string
  student_id: string
  fee_group_id: string
  is_rte?: boolean
  prorate_from?: string | null
  note?: string | null
}): Promise<void> {
  const { error } = await supabase.from('fee_group_assignments')
    .upsert({
      ...input,
      is_rte: input.is_rte ?? false,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'student_id,academic_year_id' })
  if (error) throw error
}

/** Put a whole class in a group in one statement. */
export async function assignGroupBulk(
  academicYearId: string, studentIds: string[], feeGroupId: string, isRte = false,
): Promise<number> {
  if (studentIds.length === 0) return 0
  const { error, count } = await supabase.from('fee_group_assignments')
    .upsert(
      studentIds.map(student_id => ({
        academic_year_id: academicYearId,
        student_id,
        fee_group_id: feeGroupId,
        is_rte: isRte,
      })),
      { onConflict: 'student_id,academic_year_id', count: 'exact' })
  if (error) throw error
  return count ?? studentIds.length
}
