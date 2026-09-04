// ─────────────────────────────────────────────────────────────────────────────
// Engine types.
//
// Everything here is plain data. The engine never imports Supabase, never
// touches the DOM and never reads a clock it was not handed — `asOf` is always
// a parameter — so the same call from a preview screen, a nightly job and a
// test produces the same answer. That property is the whole reason the module
// is separate: a late-fee preview that disagrees with the charge it previews is
// worse than having no preview at all.
// ─────────────────────────────────────────────────────────────────────────────

import type { Paise } from './money'

/** 'YYYY-MM-DD'. Dates are strings end to end so no timezone can shift a due date. */
export type IsoDate = string

export interface AcademicYear {
  id: string
  code: string
  startsOn: IsoDate
  endsOn: IsoDate
}

export interface FeeHead {
  id: string
  code: string
  name: string
  categoryId: string | null
  taxRate: number
  taxInclusive: boolean
  isTransport: boolean
  sort: number
}

export interface StructureItem {
  feeHeadId: string
  amount: Paise
  taxRate: number
  sort: number
}

export interface Installment {
  id: string
  seq: number
  name: string
  dueDate: IsoDate
  /** Fixed slice of the structure total. Mutually exclusive with `percent`. */
  amount: Paise | null
  /** Share of the structure total, 0–100. Mutually exclusive with `amount`. */
  percent: number | null
  /** When present, this installment bills exactly these heads and nothing else. */
  items: { feeHeadId: string; amount: Paise }[]
  autogenEnabled: boolean
  autogenDaysBefore: number
  sort: number
}

export interface FeeStructure {
  id: string
  academicYearId: string
  feeGroupId: string
  /** null = every grade in the group. Negative grades are pre-primary. */
  grade: number | null
  name: string
  status: 'draft' | 'published' | 'archived'
  items: StructureItem[]
  installments: Installment[]
}

export interface FeeGroup {
  id: string
  code: string
  name: string
  isDefault: boolean
  isRte: boolean
}

export interface StudentContext {
  studentId: string
  grade: number | null
  /** From fee_group_assignments; absent means "fall back to the default group". */
  feeGroupId: string | null
  /** Mid-year joiner: charge only from this date. */
  prorateFrom: IsoDate | null
  isRte: boolean
}

/**
 * Why a resolution chose what it chose.
 *
 * Mandatory, not optional — copied from payroll's `resolvePolicy`, where making
 * the reason a required field is what stopped "the system decided" ever being
 * an acceptable answer to a parent.
 */
export interface Provenance {
  /** Lower is more specific. 0 = an exact match on this student. */
  rank: number
  why: string
}

export interface ResolvedStructure {
  structure: FeeStructure
  group: FeeGroup
  source: Provenance
}

/** One billable slice of a student's year. */
export interface ScheduleEntry {
  installmentId: string
  seq: number
  name: string
  dueDate: IsoDate
  lines: ScheduleLine[]
  /** Sum of the lines, after proration. */
  total: Paise
  /** Set when proration reduced this entry, for the Why panel. */
  proration?: ProrationDetail
}

export interface ScheduleLine {
  feeHeadId: string
  /** Denormalised so an invoice line is legible without the price list. */
  label: string
  amount: Paise
  taxRate: number
  taxAmount: Paise
  sort: number
}

export interface ProrationDetail {
  fromDate: IsoDate
  /** Days actually attended in the period this installment covers. */
  chargedDays: number
  /** Days in the period. */
  periodDays: number
  fraction: number
  fullAmount: Paise
  why: string
}

export interface BillingSchedule {
  studentId: string
  academicYearId: string
  structureId: string
  group: FeeGroup
  source: Provenance
  entries: ScheduleEntry[]
  /** Sum of every entry. Equals the structure total when not prorated. */
  total: Paise
  /** Non-fatal things a human should look at before billing. */
  notes: string[]
}
