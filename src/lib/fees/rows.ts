// ============================================================================
// Database row shapes for the fee engine, and the mappers into engine types.
// ----------------------------------------------------------------------------
// The engine knows nothing about Supabase and the database knows nothing about
// the engine's camelCase types. This module is the only place the two meet, so
// a column rename touches one file rather than fifteen. Same split, and same
// reason, as src/lib/payroll/rows.ts.
// ============================================================================

import type {
  Concession, FeeHeadDef, FeeMatch, FeeSlab, FeeStructure, FeeStructureItem,
  FeeStructureScope, InstallmentPlanEntry, StudentFeeContext,
} from './engine/types'

// ── Rows ────────────────────────────────────────────────────────────────────

export interface FeeHeadRow {
  id: string; code: string | null; name: string; description: string | null
  default_amount: number; kind: FeeHeadDef['kind']; frequency: FeeHeadDef['frequency']
  sequence: number; refundable: boolean; concession_eligible: boolean
  gl_code: string | null; active: boolean
}

export interface FeeStructureItemRow {
  id: string; structure_id: string; fee_head_id: string
  calc_type: FeeStructureItem['calcType']
  amount: number | null; percent_of: string | null; percent_value: number | null
  formula: string | null; slabs: FeeSlab[] | null; slab_on: FeeStructureItem['slabOn']
  installment_plan: InstallmentPlanEntry[] | null
  sequence: number; is_optional: boolean
  fee_head?: { code: string | null; name: string; concession_eligible: boolean } | null
}

export interface FeeStructureRow {
  id: string; name: string; code: string | null; academic_year: string; version: number
  status: 'draft' | 'published' | 'archived'
  effective_from: string; effective_to: string | null
  allow_partial: boolean; grace_days: number | null; late_fee_head_id: string | null
  notes: string | null; published_at: string | null
  items?: FeeStructureItemRow[]
}

export interface FeePolicyGroupRow {
  id: string; name: string; description: string | null
  is_default: boolean; priority: number; match: FeeMatch | null
  effective_from: string; effective_to: string | null
  members?: { student_id: string }[]
}

export interface FeeAssignmentRow {
  id: string; structure_id: string; scope: 'group' | 'student'
  group_id: string | null; student_id: string | null
  effective_from: string; effective_to: string | null
  structure?: { name: string; version: number } | null
}

export interface FeeConcessionRow {
  id: string; student_id: string; fee_head_id: string | null
  kind: Concession['kind']; value: number; category: Concession['category']
  reason: string | null; academic_year: string | null
  effective_from: string; effective_to: string | null
  status: 'pending' | 'approved' | 'rejected' | 'revoked'
  requested_by: string | null; approved_by: string | null; approved_at: string | null
}

export interface StudentDimensionRow {
  student_id: string
  fee_category: string | null
  transport_zone: string | null
  is_staff_ward: boolean
  family_id: string | null
}

// ── Mappers ─────────────────────────────────────────────────────────────────

export function toFeeHead(r: FeeHeadRow): FeeHeadDef {
  return {
    id: r.id,
    // A head with no code cannot be referenced by a formula, and an empty
    // string is a clearer failure than a silent undefined.
    code: r.code ?? '',
    name: r.name,
    kind: r.kind,
    frequency: r.frequency,
    sequence: r.sequence,
    refundable: r.refundable,
    concessionEligible: r.concession_eligible,
    glCode: r.gl_code,
    active: r.active,
  }
}

export function toStructureItem(r: FeeStructureItemRow): FeeStructureItem {
  return {
    id: r.id,
    feeHeadId: r.fee_head_id,
    headCode: r.fee_head?.code ?? '',
    headName: r.fee_head?.name ?? 'Fee',
    calcType: r.calc_type,
    amount: r.amount === null ? null : Number(r.amount),
    percentOf: r.percent_of,
    percentValue: r.percent_value === null ? null : Number(r.percent_value),
    formula: r.formula,
    slabs: r.slabs ? r.slabs.map(s => ({ match: String(s.match), amount: Number(s.amount) })) : null,
    slabOn: r.slab_on,
    installmentPlan: r.installment_plan ?? null,
    sequence: r.sequence,
    isOptional: r.is_optional,
    // The catalogue decides eligibility, not the structure item — a school
    // must not be able to discount a fine by editing one structure.
    concessionEligible: r.fee_head?.concession_eligible ?? true,
  }
}

export function toStructure(r: FeeStructureRow): FeeStructure {
  return {
    id: r.id,
    name: r.name,
    academicYear: r.academic_year,
    version: r.version,
    effectiveFrom: r.effective_from,
    effectiveTo: r.effective_to,
    allowPartial: r.allow_partial,
    graceDays: r.grace_days,
    items: (r.items ?? []).map(toStructureItem),
  }
}

/**
 * A policy group plus the assignment that binds it to a structure becomes one
 * `FeeStructureScope`. The assignment's dates narrow the group's — a group live
 * all year but assigned only from July governs only from July.
 */
export function toStructureScope(
  group: FeePolicyGroupRow,
  assignment: FeeAssignmentRow,
): FeeStructureScope {
  return {
    id: `${group.id}:${assignment.id}`,
    name: group.name,
    isDefault: group.is_default,
    priority: group.priority,
    effectiveFrom: laterOf(group.effective_from, assignment.effective_from),
    effectiveTo: earlierOf(group.effective_to, assignment.effective_to),
    memberIds: (group.members ?? []).map(m => m.student_id),
    match: group.match,
    structureId: assignment.structure_id,
  }
}

/**
 * A structure assigned directly to one student. Given the highest priority and
 * an explicit member list so it outranks every group — an individual
 * arrangement is by definition the most specific thing the school has said.
 */
export function toStudentScope(assignment: FeeAssignmentRow): FeeStructureScope {
  return {
    id: `student:${assignment.id}`,
    name: 'Individual arrangement',
    isDefault: false,
    priority: 1000,
    effectiveFrom: assignment.effective_from,
    effectiveTo: assignment.effective_to,
    memberIds: assignment.student_id ? [assignment.student_id] : [],
    match: null,
    structureId: assignment.structure_id,
  }
}

export function toConcession(r: FeeConcessionRow): Concession {
  return {
    id: r.id,
    feeHeadId: r.fee_head_id,
    kind: r.kind,
    value: Number(r.value),
    category: r.category,
    reason: r.reason,
    effectiveFrom: r.effective_from,
    effectiveTo: r.effective_to,
  }
}

export interface StudentContextInput {
  id: string
  name: string
  grade: number | null
  section: string | null
  homeroomIds: string[]
  dimensions: StudentDimensionRow | null
  siblingRank: number | null
  optedInHeadIds: string[]
  concessions: FeeConcessionRow[]
}

export function toStudentContext(i: StudentContextInput): StudentFeeContext {
  return {
    id: i.id,
    name: i.name,
    grade: i.grade,
    section: i.section,
    homeroomIds: i.homeroomIds,
    feeCategory: i.dimensions?.fee_category ?? null,
    transportZone: i.dimensions?.transport_zone ?? null,
    isStaffWard: i.dimensions?.is_staff_ward ?? false,
    siblingRank: i.siblingRank,
    familyId: i.dimensions?.family_id ?? null,
    optedInHeadIds: i.optedInHeadIds,
    // Only approved concessions reduce a bill. A pending request is a request.
    concessions: i.concessions.filter(c => c.status === 'approved').map(toConcession),
  }
}

function laterOf(a: string, b: string): string { return a > b ? a : b }
function earlierOf(a: string | null, b: string | null): string | null {
  if (a === null) return b
  if (b === null) return a
  return a < b ? a : b
}
