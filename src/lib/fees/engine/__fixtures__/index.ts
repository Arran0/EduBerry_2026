// Fixtures for the fee engine tests. A small but realistic school year: two
// fee heads, one three-term structure, and the cohorts a school actually runs.

import type {
  AcademicYear, FeeGroup, FeeHead, FeeStructure, Installment, StudentContext,
} from '../types'

export const YEAR_2026: AcademicYear = {
  id: 'year-2026', code: '2026-27', startsOn: '2026-04-01', endsOn: '2027-03-31',
}

export const GROUP_REGULAR: FeeGroup = {
  id: 'grp-regular', code: 'REGULAR', name: 'Regular', isDefault: true, isRte: false,
}
export const GROUP_RTE: FeeGroup = {
  id: 'grp-rte', code: 'RTE', name: 'RTE', isDefault: false, isRte: true,
}
export const GROUP_STAFF: FeeGroup = {
  id: 'grp-staff', code: 'STAFF', name: 'Staff Ward', isDefault: false, isRte: false,
}

export const HEAD_TUITION: FeeHead = {
  id: 'head-tuition', code: 'TUITION', name: 'Tuition', categoryId: 'cat-academic',
  taxRate: 0, taxInclusive: true, isTransport: false, sort: 10,
}
export const HEAD_LAB: FeeHead = {
  id: 'head-lab', code: 'LAB', name: 'Lab Fee', categoryId: 'cat-academic',
  taxRate: 0, taxInclusive: true, isTransport: false, sort: 20,
}
export const HEAD_BUS: FeeHead = {
  id: 'head-bus', code: 'BUS', name: 'Transport', categoryId: 'cat-transport',
  taxRate: 5, taxInclusive: false, isTransport: true, sort: 30,
}

export const HEADS = [HEAD_TUITION, HEAD_LAB, HEAD_BUS]

/** Three terms, 40/30/30, on ₹27,000 (tuition ₹24,000 + lab ₹3,000). */
export function threeTermInstallments(): Installment[] {
  return [
    inst('inst-1', 1, 'Term 1', '2026-04-10', { percent: 40, autogen: true }),
    inst('inst-2', 2, 'Term 2', '2026-08-10', { percent: 30 }),
    inst('inst-3', 3, 'Term 3', '2026-12-10', { percent: 30 }),
  ]
}

export function inst(
  id: string, seq: number, name: string, dueDate: string,
  opts: {
    amount?: number
    percent?: number
    items?: { feeHeadId: string; amount: number }[]
    autogen?: boolean
    autogenDaysBefore?: number
  } = {},
): Installment {
  return {
    id, seq, name, dueDate,
    amount: opts.amount ?? null,
    percent: opts.percent ?? null,
    items: opts.items ?? [],
    autogenEnabled: opts.autogen ?? false,
    autogenDaysBefore: opts.autogenDaysBefore ?? 7,
    sort: seq * 10,
  }
}

export function structure(overrides: Partial<FeeStructure> = {}): FeeStructure {
  return {
    id: 'struct-g5-regular',
    academicYearId: YEAR_2026.id,
    feeGroupId: GROUP_REGULAR.id,
    grade: 5,
    name: 'Grade 5 — Regular',
    status: 'published',
    items: [
      { feeHeadId: HEAD_TUITION.id, amount: 2_400_000, taxRate: 0, sort: 10 },
      { feeHeadId: HEAD_LAB.id,     amount:   300_000, taxRate: 0, sort: 20 },
    ],
    installments: threeTermInstallments(),
    ...overrides,
  }
}

export function student(overrides: Partial<StudentContext> = {}): StudentContext {
  return {
    studentId: 'stu-1',
    grade: 5,
    feeGroupId: GROUP_REGULAR.id,
    prorateFrom: null,
    isRte: false,
    ...overrides,
  }
}
