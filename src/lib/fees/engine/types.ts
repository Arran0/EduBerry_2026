// ============================================================================
// Fee engine types.
// ----------------------------------------------------------------------------
// The engine's whole job is to turn a student plus a date into a set of demand
// lines, each of which can explain itself. Nothing here touches Supabase and
// nothing reads the clock — the same constraint that makes the payroll engine
// testable without a database.
// ============================================================================

import type { ScopeSource } from '@/lib/scopeResolution'

export type { ScopeSource }

// ── Catalogue ───────────────────────────────────────────────────────────────

export type FeeHeadKind = 'tuition' | 'transport' | 'exam' | 'optional' | 'fine' | 'deposit' | 'other'
export type FeeFrequency = 'one_time' | 'monthly' | 'term' | 'annual'

export interface FeeHeadDef {
  id: string
  /** Symbolic name a formula can reference, e.g. TUITION. */
  code: string
  name: string
  kind: FeeHeadKind
  frequency: FeeFrequency
  sequence: number
  refundable: boolean
  /** Whether a concession may reduce this head at all. Fines usually may not. */
  concessionEligible: boolean
  glCode: string | null
  active: boolean
}

// ── Structures ──────────────────────────────────────────────────────────────

export type FeeCalcType = 'fixed' | 'percent_of' | 'formula' | 'slab'
export type SlabDimension = 'transport_zone' | 'fee_category' | 'grade' | 'sibling_rank'

export interface FeeSlab {
  /** The dimension value this row is for, e.g. 'ZONE_A' or '8'. */
  match: string
  amount: number
}

export interface InstallmentPlanEntry {
  no: number
  label: string
  /** ISO date the instalment falls due. */
  due: string
  /** Percentage of the item total. Across a plan these must sum to 100. */
  share: number
}

export interface FeeStructureItem {
  id: string
  feeHeadId: string
  /** Denormalised from the head so the engine never has to look one up. */
  headCode: string
  headName: string
  calcType: FeeCalcType
  amount: number | null
  percentOf: string | null
  percentValue: number | null
  formula: string | null
  slabs: FeeSlab[] | null
  slabOn: SlabDimension | null
  installmentPlan: InstallmentPlanEntry[] | null
  sequence: number
  isOptional: boolean
  concessionEligible: boolean
}

/** What fee_policy_groups.match can select on. */
export interface FeeMatch {
  grades?: number[]
  sections?: string[]
  categories?: string[]
  homeroomIds?: string[]
  transportZones?: string[]
}

export interface FeeStructure {
  id: string
  name: string
  academicYear: string
  version: number
  effectiveFrom: string
  effectiveTo: string | null
  allowPartial: boolean
  graceDays: number | null
  items: FeeStructureItem[]
}

/**
 * A structure bound to a cohort over a date range. Shaped as `Scopeable` so
 * `resolveScope` in src/lib/scopeResolution.ts governs it, exactly as it
 * governs payroll policy groups.
 */
export interface FeeStructureScope {
  id: string
  name: string
  isDefault: boolean
  priority: number
  effectiveFrom: string
  effectiveTo: string | null
  memberIds: string[]
  match: FeeMatch | null
  structureId: string
}

// ── Concessions ─────────────────────────────────────────────────────────────

export type ConcessionKind = 'percent' | 'amount' | 'full'
export type ConcessionCategory =
  | 'sibling' | 'staff_ward' | 'rte' | 'ews' | 'merit'
  | 'sports' | 'single_girl_child' | 'financial_aid' | 'other'

export interface Concession {
  id: string
  /** null applies to every concession-eligible head. */
  feeHeadId: string | null
  kind: ConcessionKind
  value: number
  category: ConcessionCategory
  reason: string | null
  effectiveFrom: string
  effectiveTo: string | null
}

// ── The subject ─────────────────────────────────────────────────────────────

export interface StudentFeeContext {
  id: string
  name: string
  grade: number | null
  section: string | null
  homeroomIds: string[]
  /** general | rte | ews | staff_ward | … */
  feeCategory: string | null
  transportZone: string | null
  isStaffWard: boolean
  /** 1 = eldest enrolled child. Drives sibling slabs. */
  siblingRank: number | null
  familyId: string | null
  /** Optional heads the student has opted into, by head id. */
  optedInHeadIds: string[]
  concessions: Concession[]
}

// ── Output ──────────────────────────────────────────────────────────────────

/** One step of the arithmetic, in the words a parent would need to hear it in. */
export interface TraceStep {
  label: string
  detail: string
  amount: number
}

export interface AppliedConcession {
  concessionId: string
  category: ConcessionCategory
  kind: ConcessionKind
  value: number
  amount: number
  reason: string | null
}

export interface FeeTrace {
  structureId: string
  structureName: string
  structureVersion: number
  /** Why this structure, and not another. */
  scope: ScopeSource
  steps: TraceStep[]
  concessions: AppliedConcession[]
}

export interface ComputedFeeLine {
  studentId: string
  feeHeadId: string
  headCode: string
  headName: string
  structureId: string
  structureItemId: string
  installmentNo: number | null
  installmentLabel: string | null
  dueDate: string | null
  grossAmount: number
  concessionAmount: number
  netAmount: number
  trace: FeeTrace
}

export interface ComputedDemand {
  studentId: string
  lines: ComputedFeeLine[]
  grossTotal: number
  concessionTotal: number
  netTotal: number
  /** Why no lines were produced, when that is the answer. */
  skippedReason: string | null
  scope: ScopeSource
}

/** Something the admin has to look at before publishing a demand run. */
export interface FeeException {
  studentId: string
  severity: 'block' | 'warn' | 'info'
  code: string
  message: string
}
