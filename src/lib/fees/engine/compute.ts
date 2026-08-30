// ============================================================================
// The fee computation.
// ----------------------------------------------------------------------------
// A student plus a date in, a set of demand lines out, each carrying the rules
// that produced it. This replaces "an admin resolves class, category, siblings
// and transport in their head and types the answer".
//
// Order of operations, fixed and documented because it is the part schools
// argue about:
//   1. resolve the governing structure for this student on this date
//   2. for each item: gross from fixed / percent_of / formula / slab
//   3. concessions off the gross (see concessions.ts for the ordering rule)
//   4. split the net across the instalment plan
//
// Concessions are applied to the head total and then split, not applied per
// instalment. Splitting a rounded discount three ways is where the odd rupee
// comes from that a parent adding up their own receipt will find.
// ============================================================================

import { evaluateFormula, FormulaError } from '@/lib/payroll/engine/expr'
import { round2 } from '@/lib/payroll/engine/money'
import { applyConcessions, describeConcession } from './concessions'
import { resolveStructureFor } from './resolveScope'
import type {
  ComputedDemand, ComputedFeeLine, FeeException, FeeStructure, FeeStructureItem,
  FeeStructureScope, FeeTrace, StudentFeeContext, TraceStep,
} from './types'

export interface ComputeInput {
  student: StudentFeeContext
  scopes: FeeStructureScope[]
  /** Every structure that could be resolved to, by id. */
  structures: Record<string, FeeStructure>
  /** ISO date the demand is computed as of. Governs every effective-date test. */
  onDate: string
  /** Bill only this instalment. Undefined bills the whole plan. */
  installmentNo?: number
}

/** The value a slab keys on, as a string, for this student. */
function slabKey(item: FeeStructureItem, student: StudentFeeContext): string | null {
  switch (item.slabOn) {
    case 'transport_zone': return student.transportZone
    case 'fee_category':   return student.feeCategory
    case 'grade':          return student.grade === null ? null : String(student.grade)
    case 'sibling_rank':   return student.siblingRank === null ? null : String(student.siblingRank)
    default:               return null
  }
}

/**
 * The scope a formula sees: every head already computed in this structure, by
 * code, plus a few pseudo-codes. An unknown identifier is an error rather than
 * a silent zero — a typo in "TUITION" must not quietly zero a term's fees.
 */
function formulaScope(
  computed: Map<string, number>,
  student: StudentFeeContext,
): Record<string, number> {
  const scope: Record<string, number> = {}
  for (const [code, amount] of computed) scope[code] = amount
  scope.SUBTOTAL = round2([...computed.values()].reduce((s, n) => s + n, 0))
  scope.GRADE = student.grade ?? 0
  scope.SIBLING_RANK = student.siblingRank ?? 1
  return scope
}

export interface ItemGross {
  amount: number
  detail: string
}

/** The gross for one item, before any concession. */
export function grossForItem(
  item: FeeStructureItem,
  student: StudentFeeContext,
  computed: Map<string, number>,
): ItemGross | { error: string } {
  switch (item.calcType) {
    case 'fixed':
      return { amount: round2(item.amount ?? 0), detail: `Fixed amount for ${item.headName}` }

    case 'percent_of': {
      const base = item.percentOf ? computed.get(item.percentOf) : undefined
      if (base === undefined) {
        return {
          error: `"${item.headName}" is a percentage of ${item.percentOf ?? '(nothing)'}, which is not charged before it in this structure.`,
        }
      }
      const pct = item.percentValue ?? 0
      return { amount: round2((base * pct) / 100), detail: `${pct}% of ${item.percentOf} (₹${base.toLocaleString('en-IN')})` }
    }

    case 'formula': {
      if (!item.formula) return { error: `"${item.headName}" is set to formula but has none.` }
      try {
        return {
          amount: round2(evaluateFormula(item.formula, formulaScope(computed, student))),
          detail: `Formula: ${item.formula}`,
        }
      } catch (e) {
        const msg = e instanceof FormulaError ? e.message : String(e)
        return { error: `"${item.headName}" formula could not be evaluated. ${msg}` }
      }
    }

    case 'slab': {
      const key = slabKey(item, student)
      if (key === null) {
        return { error: `"${item.headName}" is banded by ${item.slabOn ?? 'nothing'}, which this student has no value for.` }
      }
      const row = (item.slabs ?? []).find(s => s.match === key)
      if (!row) {
        return { error: `"${item.headName}" has no band for ${item.slabOn} = "${key}".` }
      }
      return { amount: round2(row.amount), detail: `Band ${item.slabOn} = ${key}` }
    }
  }
}

/** Split a head's net across its instalment plan, with the remainder on the first. */
function splitAcrossInstallments(
  net: number,
  item: FeeStructureItem,
  only: number | undefined,
): { no: number | null; label: string | null; due: string | null; amount: number }[] {
  const plan = item.installmentPlan
  if (!plan || plan.length === 0) {
    return [{ no: null, label: null, due: null, amount: net }]
  }

  const ordered = [...plan].sort((a, b) => a.no - b.no)
  const shares = ordered.map(p => round2((net * p.share) / 100))
  // Rounding each share independently loses or gains paise. Put the difference
  // on the first instalment so the instalments always sum to the head exactly.
  const drift = round2(net - shares.reduce((s, n) => s + n, 0))
  if (shares.length) shares[0] = round2(shares[0] + drift)

  return ordered
    .map((p, i) => ({ no: p.no, label: p.label, due: p.due, amount: shares[i] }))
    .filter(r => only === undefined || r.no === only)
}

/** Compute one student's demand. */
export function computeDemand(input: ComputeInput): ComputedDemand {
  const { student, scopes, structures, onDate, installmentNo } = input

  const { scope, source } = resolveStructureFor(scopes, student, onDate)
  if (!scope) {
    return emptyDemand(student.id, source, 'No fee structure is assigned to this student.')
  }

  const structure = structures[scope.structureId]
  if (!structure) {
    return emptyDemand(student.id, source, 'The assigned fee structure could not be loaded.')
  }
  if (structure.effectiveFrom > onDate || (structure.effectiveTo !== null && structure.effectiveTo < onDate)) {
    return emptyDemand(student.id, source, `"${structure.name}" is not in effect on ${onDate}.`)
  }

  const lines: ComputedFeeLine[] = []
  // Head code → gross, so percent_of and formulas can reference heads already
  // charged. Sequence order is therefore load-bearing, not cosmetic.
  const computed = new Map<string, number>()
  const items = [...structure.items].sort((a, b) => a.sequence - b.sequence)

  for (const item of items) {
    if (item.isOptional && !student.optedInHeadIds.includes(item.feeHeadId)) continue

    const gross = grossForItem(item, student, computed)
    if ('error' in gross) {
      // A head that cannot be computed is not silently skipped — it becomes a
      // zero line carrying the reason, so the demand run surfaces it as an
      // exception instead of quietly under-billing.
      lines.push(errorLine(student, structure, item, source, gross.error))
      continue
    }

    computed.set(item.headCode, gross.amount)

    const conc = applyConcessions(item, gross.amount, student.concessions, onDate)
    const net = round2(gross.amount - conc.amount)

    const steps: TraceStep[] = [
      { label: 'Gross', detail: gross.detail, amount: gross.amount },
      ...conc.applied.map(c => ({
        label: 'Concession',
        detail: describeConcession(c),
        amount: -c.amount,
      })),
      { label: 'Net', detail: `Payable for ${item.headName}`, amount: net },
    ]

    const trace: FeeTrace = {
      structureId: structure.id,
      structureName: structure.name,
      structureVersion: structure.version,
      scope: source,
      steps,
      concessions: conc.applied,
    }

    for (const part of splitAcrossInstallments(net, item, installmentNo)) {
      // A head's concession belongs to the head, so an instalment shows the
      // slice of it that instalment carries.
      const ratio = net === 0 ? 0 : part.amount / net
      lines.push({
        studentId: student.id,
        feeHeadId: item.feeHeadId,
        headCode: item.headCode,
        headName: item.headName,
        structureId: structure.id,
        structureItemId: item.id,
        installmentNo: part.no,
        installmentLabel: part.label,
        dueDate: part.due,
        grossAmount: round2(gross.amount * ratio),
        concessionAmount: round2(conc.amount * ratio),
        netAmount: part.amount,
        trace,
      })
    }
  }

  const grossTotal = round2(lines.reduce((s, l) => s + l.grossAmount, 0))
  const concessionTotal = round2(lines.reduce((s, l) => s + l.concessionAmount, 0))
  const netTotal = round2(lines.reduce((s, l) => s + l.netAmount, 0))

  return {
    studentId: student.id,
    lines,
    grossTotal,
    concessionTotal,
    netTotal,
    skippedReason: lines.length ? null : 'This structure produced no chargeable heads for this student.',
    scope: source,
  }
}

function emptyDemand(studentId: string, scope: ComputedDemand['scope'], reason: string): ComputedDemand {
  return {
    studentId, lines: [], grossTotal: 0, concessionTotal: 0, netTotal: 0,
    skippedReason: reason, scope,
  }
}

function errorLine(
  student: StudentFeeContext,
  structure: FeeStructure,
  item: FeeStructureItem,
  scope: ComputedDemand['scope'],
  error: string,
): ComputedFeeLine {
  return {
    studentId: student.id,
    feeHeadId: item.feeHeadId,
    headCode: item.headCode,
    headName: item.headName,
    structureId: structure.id,
    structureItemId: item.id,
    installmentNo: null,
    installmentLabel: null,
    dueDate: null,
    grossAmount: 0,
    concessionAmount: 0,
    netAmount: 0,
    trace: {
      structureId: structure.id,
      structureName: structure.name,
      structureVersion: structure.version,
      scope,
      steps: [{ label: 'Not computed', detail: error, amount: 0 }],
      concessions: [],
    },
  }
}

/**
 * What an admin must look at before publishing a run. A zero-value line with a
 * "Not computed" step is a block: publishing it would under-bill silently, and
 * silence is the one outcome a fee system must never produce.
 */
export function collectExceptions(demands: ComputedDemand[]): FeeException[] {
  const out: FeeException[] = []
  for (const d of demands) {
    for (const line of d.lines) {
      const failed = line.trace.steps.find(s => s.label === 'Not computed')
      if (failed) {
        out.push({
          studentId: d.studentId,
          severity: 'block',
          code: 'head_not_computed',
          message: failed.detail,
        })
      }
    }
    if (d.skippedReason) {
      out.push({
        studentId: d.studentId,
        severity: d.lines.length ? 'info' : 'warn',
        code: 'no_demand',
        message: d.skippedReason,
      })
    }
    if (d.netTotal === 0 && d.grossTotal > 0) {
      out.push({
        studentId: d.studentId,
        severity: 'warn',
        code: 'fully_waived',
        message: `Concessions clear this student's entire ₹${d.grossTotal.toLocaleString('en-IN')} demand. Confirm that is intended.`,
      })
    }
  }
  return out
}

/** Validate an instalment plan before it is saved, rather than at billing time. */
export function validateInstallmentPlan(plan: { no: number; share: number }[]): string | null {
  if (plan.length === 0) return null
  const total = plan.reduce((s, p) => s + p.share, 0)
  if (Math.abs(total - 100) > 0.01) return `Instalment shares add up to ${total}%, not 100%.`
  const nos = plan.map(p => p.no)
  if (new Set(nos).size !== nos.length) return 'Two instalments share the same number.'
  if (plan.some(p => p.share <= 0)) return 'Every instalment must carry a positive share.'
  return null
}
