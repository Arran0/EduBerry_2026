// ─────────────────────────────────────────────────────────────────────────────
// A structure plus a student becomes a billing schedule.
//
// This is the function the invoice generation preview and the nightly job both
// call. The preview screen counts what it returns; the job bills what it
// returns. There is exactly one implementation so the two cannot disagree.
//
// Claiming order, most explicit first:
//
//   1. An installment listing specific heads bills exactly those heads.
//   2. An installment with a fixed `amount` bills that amount.
//   3. An installment with a `percent` bills that share of the structure total
//      — of the total the school typed the percentage against, not of some
//      renormalised remainder, because 40% has to mean 40%.
//   4. Anything left over is split equally between installments that named
//      none of the three.
//   5. If the parts still do not add up to the structure total, the last
//      installment absorbs the difference and the schedule says so in `notes`.
//
// Step 5 is what guarantees the invariant that matters: the bills for a year
// always sum to the price of that year. A structure whose percentages come to
// 90% does not quietly lose a tenth of the fee.
// ─────────────────────────────────────────────────────────────────────────────

import { percentOf, splitProportional, sum, type Paise } from './money'
import { installmentPeriods, prorate } from './proration'
import { resolveStructure } from './structure'
import { toEpochDay } from './dates'
import type {
  AcademicYear, BillingSchedule, FeeGroup, FeeHead, FeeStructure,
  Installment, ScheduleEntry, ScheduleLine, StudentContext,
} from './types'

export interface BuildScheduleInput {
  student: StudentContext
  year: AcademicYear
  groups: FeeGroup[]
  structures: FeeStructure[]
  /** Every head referenced by the structure, for line labels and tax. */
  heads: FeeHead[]
}

/** Tax on a line. Inclusive tax is already inside `amount`; exclusive sits on top. */
function taxOn(amount: Paise, rate: number, inclusive: boolean): Paise {
  if (!rate) return 0
  return inclusive
    ? amount - Math.round(amount / (1 + rate / 100))
    : percentOf(amount, rate)
}

export function buildSchedule(input: BuildScheduleInput): BillingSchedule {
  const { student, year, groups, structures, heads } = input
  const notes: string[] = []

  const { structure, group, source } = resolveStructure(student, groups, structures)

  // An RTE student is billed nothing at all; the state is claimed from instead.
  if (student.isRte || group.isRte) {
    return {
      studentId: student.studentId,
      academicYearId: year.id,
      structureId: structure.id,
      group, source,
      entries: [],
      total: 0,
      notes: ['RTE student — no fee is billed; the amount is claimed from the state instead.'],
    }
  }

  const headById = new Map(heads.map(h => [h.id, h]))
  const structureTotal = sum(structure.items.map(i => i.amount))

  if (structure.items.length === 0) {
    notes.push('This structure has no fee heads, so nothing can be billed from it.')
  }

  const ordered = [...structure.installments].sort(
    (a, b) => toEpochDay(a.dueDate) - toEpochDay(b.dueDate) || a.seq - b.seq)

  if (ordered.length === 0) {
    notes.push('This structure has no installments, so there is nothing to bill yet.')
    return {
      studentId: student.studentId, academicYearId: year.id, structureId: structure.id,
      group, source, entries: [], total: 0, notes,
    }
  }

  // ── Claims ────────────────────────────────────────────────────────────
  const claims = new Map<string, Paise | null>()
  for (const inst of ordered) {
    if (inst.items.length > 0) {
      claims.set(inst.id, sum(inst.items.map(i => i.amount)))
      if (inst.amount !== null || inst.percent !== null) {
        notes.push(
          `${inst.name} lists specific fee heads and also sets ${inst.amount !== null ? 'an amount' : 'a percentage'}. The listed heads win.`)
      }
    } else if (inst.amount !== null) {
      claims.set(inst.id, inst.amount)
    } else if (inst.percent !== null) {
      claims.set(inst.id, percentOf(structureTotal, inst.percent))
    } else {
      claims.set(inst.id, null)
    }
  }

  // ── Whatever is left goes to the installments that claimed nothing ────
  const unclaimed = ordered.filter(i => claims.get(i.id) === null)
  const claimedTotal = sum(ordered.map(i => claims.get(i.id) ?? 0))
  if (unclaimed.length > 0) {
    const remaining = structureTotal - claimedTotal
    if (remaining < 0) {
      notes.push(
        'The installments already claim more than the structure total, so the ones with no amount or percentage bill nothing.')
      unclaimed.forEach(i => claims.set(i.id, 0))
    } else {
      const shares = splitProportional(remaining, unclaimed.map(() => 1))
      unclaimed.forEach((i, idx) => claims.set(i.id, shares[idx]))
    }
  }

  // ── Reconcile to the structure total ──────────────────────────────────
  const beforeFix = sum(ordered.map(i => claims.get(i.id) ?? 0))
  if (beforeFix !== structureTotal && structureTotal > 0) {
    const last = ordered[ordered.length - 1]
    const delta = structureTotal - beforeFix
    claims.set(last.id, (claims.get(last.id) ?? 0) + delta)
    notes.push(
      `The installments came to ${beforeFix / 100} against a structure total of ${structureTotal / 100}. ` +
      `The difference was added to ${last.name} so the year's bills add up to the year's fee.`)
  }

  // ── Lines, then proration ─────────────────────────────────────────────
  const periods = installmentPeriods(ordered, year)
  const entries: ScheduleEntry[] = []

  for (const inst of ordered) {
    const claim = claims.get(inst.id) ?? 0
    let lines = inst.items.length > 0
      ? linesFromItems(inst, headById)
      : linesFromStructure(claim, structure, headById)

    let total = sum(lines.map(l => l.amount))
    let proration: ScheduleEntry['proration']

    if (student.prorateFrom) {
      const period = periods.get(inst.id)!
      const result = prorate(total, period, student.prorateFrom, inst.name)
      if (result.detail) {
        proration = result.detail
        // Push the same reduction down into the lines, so an invoice shows a
        // prorated tuition rather than a full one with a mystery total.
        const scaled = splitProportional(result.amount, lines.map(l => Math.max(l.amount, 0)))
        lines = lines.map((l, i) => ({
          ...l,
          amount: scaled[i],
          taxAmount: taxOn(scaled[i], l.taxRate, headById.get(l.feeHeadId)?.taxInclusive ?? true),
        }))
        total = result.amount
      }
    }

    entries.push({
      installmentId: inst.id,
      seq: inst.seq,
      name: inst.name,
      dueDate: inst.dueDate,
      lines,
      total,
      proration,
    })
  }

  return {
    studentId: student.studentId,
    academicYearId: year.id,
    structureId: structure.id,
    group,
    source,
    entries,
    total: sum(entries.map(e => e.total)),
    notes,
  }
}

/** An installment that named its heads bills exactly those, at those amounts. */
function linesFromItems(inst: Installment, headById: Map<string, FeeHead>): ScheduleLine[] {
  return inst.items.map((item, idx) => {
    const head = headById.get(item.feeHeadId)
    return {
      feeHeadId: item.feeHeadId,
      label: head?.name ?? 'Fee',
      amount: item.amount,
      taxRate: head?.taxRate ?? 0,
      taxAmount: taxOn(item.amount, head?.taxRate ?? 0, head?.taxInclusive ?? true),
      sort: head?.sort ?? idx,
    }
  })
}

/**
 * Spread an installment's claim across the structure's heads in proportion to
 * what each head costs — so a 40% first term is 40% of tuition and 40% of the
 * lab fee, itemised, rather than one undifferentiated "Term 1" line.
 */
function linesFromStructure(
  claim: Paise,
  structure: FeeStructure,
  headById: Map<string, FeeHead>,
): ScheduleLine[] {
  const items = [...structure.items].sort((a, b) => a.sort - b.sort)
  if (items.length === 0) return []

  const shares = splitProportional(claim, items.map(i => Math.max(i.amount, 0)))
  return items.map((item, idx) => {
    const head = headById.get(item.feeHeadId)
    const amount = shares[idx]
    return {
      feeHeadId: item.feeHeadId,
      label: head?.name ?? 'Fee',
      amount,
      taxRate: item.taxRate || head?.taxRate || 0,
      taxAmount: taxOn(amount, item.taxRate || head?.taxRate || 0, head?.taxInclusive ?? true),
      sort: item.sort,
    }
  })
}

/**
 * Which installments are due for automatic generation on a given day.
 *
 * `asOf` is a parameter rather than `new Date()` so the nightly job, the
 * preview screen and a test all get the same answer for the same day.
 */
export function installmentsDueForAutogen(
  installments: Installment[],
  asOf: string,
): Installment[] {
  const today = toEpochDay(asOf)
  return installments.filter(i =>
    i.autogenEnabled && toEpochDay(i.dueDate) - i.autogenDaysBefore <= today)
}
