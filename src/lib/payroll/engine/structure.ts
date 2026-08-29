// ============================================================================
// Salary structure resolution.
// ----------------------------------------------------------------------------
// Turns an employee's effective-dated assignment into an ordered list of
// resolved salary heads for one period.
//
// Ordering is not the author's `sequence` alone. A head defined as a percentage
// of another, or by a formula over several others, has to be evaluated after
// everything it depends on, so the real order is a topological sort of the
// dependency graph with `sequence` breaking ties. Getting this wrong is how
// payroll systems end up quietly computing HRA against a Basic that has not been
// resolved yet, so a cycle is a hard error rather than a zero.
//
// Two pseudo-codes exist alongside real component codes:
//   ANCHOR / CTC — the assignment's anchor amount, what percentages resolve against
//   GROSS        — the sum of earnings resolved *so far*, which is why a head
//                  that references it must sit later in the sequence
// ============================================================================

import type {
  ComponentDef, EngineAssignment, EngineStructure, EngineOverride, StructureComponent,
  ResolvedComponent, ExplainNode, CalcType,
} from './types'
import { evaluateFormula, formulaDependencies, FormulaError } from './expr'
import { applyRounding, round2 } from './money'

export class StructureError extends Error {
  constructor(message: string) { super(message); this.name = 'StructureError' }
}

/** The assignment in force on a date. Assignments never overlap (enforced by an exclusion constraint upstream). */
export function assignmentOn(assignments: EngineAssignment[], onDate: string): EngineAssignment | null {
  const live = assignments.filter(
    a => a.effectiveFrom <= onDate && (a.effectiveTo === null || a.effectiveTo >= onDate),
  )
  // Ties should be impossible, but if data predates the constraint the most
  // recently effective row is the safer reading — it is the later decision.
  return live.sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0] ?? null
}

function overrideOn(overrides: EngineOverride[], code: string, onDate: string): EngineOverride | null {
  return overrides.find(
    o => o.componentCode === code && o.effectiveFrom <= onDate && (o.effectiveTo === null || o.effectiveTo >= onDate),
  ) ?? null
}

const PSEUDO = new Set(['ANCHOR', 'CTC', 'GROSS', 'PAYABLE_DAYS'])

interface Planned {
  sc: StructureComponent
  def: ComponentDef
  calcType: CalcType
  value: number | null
  formula: string | null
  sequence: number
  deps: string[]
  override: EngineOverride | null
}

/**
 * Dependency-respecting evaluation order.
 *
 * Kahn's algorithm over the component graph, with ready nodes drained in
 * `sequence` order so a structure that has no dependencies at all evaluates
 * exactly in the order its author laid it out. `balance` heads are forced last
 * regardless — they exist to absorb whatever the anchor has left.
 */
export function orderComponents(planned: Planned[]): Planned[] {
  const byCode = new Map(planned.map(p => [p.def.code, p]))
  const balance = planned.filter(p => p.calcType === 'balance')
  const rest = planned.filter(p => p.calcType !== 'balance')

  const indegree = new Map<string, number>()
  const dependents = new Map<string, string[]>()
  for (const p of rest) {
    indegree.set(p.def.code, 0)
    dependents.set(p.def.code, [])
  }
  for (const p of rest) {
    for (const dep of p.deps) {
      if (PSEUDO.has(dep)) continue
      if (!byCode.has(dep)) {
        throw new StructureError(
          `Head "${p.def.code}" depends on "${dep}", which is not part of this structure.`,
        )
      }
      // A dependency on a balance head cannot be honoured — it is resolved last
      // by definition — so say that plainly instead of producing a stale zero.
      if (byCode.get(dep)!.calcType === 'balance') {
        throw new StructureError(
          `Head "${p.def.code}" depends on "${dep}", which is a balance head and is only known after every other head.`,
        )
      }
      indegree.set(p.def.code, (indegree.get(p.def.code) ?? 0) + 1)
      dependents.get(dep)!.push(p.def.code)
    }
  }

  const ready = rest.filter(p => (indegree.get(p.def.code) ?? 0) === 0).sort((a, b) => a.sequence - b.sequence)
  const out: Planned[] = []
  while (ready.length > 0) {
    const next = ready.shift()!
    out.push(next)
    for (const code of dependents.get(next.def.code) ?? []) {
      const d = (indegree.get(code) ?? 0) - 1
      indegree.set(code, d)
      if (d === 0) {
        ready.push(byCode.get(code)!)
        ready.sort((a, b) => a.sequence - b.sequence)
      }
    }
  }

  if (out.length !== rest.length) {
    const stuck = rest.filter(p => !out.includes(p)).map(p => p.def.code)
    throw new StructureError(
      `These heads depend on each other in a loop and cannot be resolved: ${stuck.join(' → ')}.`,
    )
  }
  return [...out, ...balance.sort((a, b) => a.sequence - b.sequence)]
}

export interface BuildStructureArgs {
  assignment: EngineAssignment
  structure: EngineStructure
  overrides: EngineOverride[]
  components: ComponentDef[]
  onDate: string
  payableDays: number
}

export interface BuiltStructure {
  /** Full-month amounts, before LOP and proration. */
  components: { def: ComponentDef; amount: number; trace: ExplainNode }[]
  gross: number
}

/** Resolve every head in a structure to its full-month amount. */
export function buildStructure(args: BuildStructureArgs): BuiltStructure {
  const { assignment, structure, overrides, components, onDate, payableDays } = args
  const defByCode = new Map(components.map(c => [c.code, c]))

  const planned: Planned[] = structure.components.map(sc => {
    const def = defByCode.get(sc.componentCode)
    if (!def) throw new StructureError(`Structure "${structure.name}" references unknown salary head "${sc.componentCode}".`)
    const ov = overrideOn(overrides, sc.componentCode, onDate)
    const calcType = (ov?.calcType ?? sc.calcType ?? def.calcType) as CalcType
    const formula = ov?.formula ?? sc.formula ?? def.formula
    const value = ov?.value ?? sc.value

    let deps: string[] = []
    if (calcType === 'formula' && formula) {
      try { deps = formulaDependencies(formula) }
      catch (e) { throw new StructureError(`Head "${def.code}": ${(e as Error).message}`) }
    } else if (calcType === 'percent_of' && def.percentOf && !PSEUDO.has(def.percentOf)) {
      deps = [def.percentOf]
    }

    return { sc, def, calcType, value, formula, sequence: sc.sequence ?? def.sequence, deps, override: ov }
  })

  const ordered = orderComponents(planned)

  const scope: Record<string, number> = {
    ANCHOR: assignment.anchorAmount,
    CTC: assignment.anchorAmount,
    GROSS: 0,
    PAYABLE_DAYS: payableDays,
  }
  const out: BuiltStructure['components'] = []
  let runningEarnings = 0

  for (const p of ordered) {
    let amount = 0
    let formulaText = ''
    const inputs: Record<string, number | string | null> = {}

    switch (p.calcType) {
      case 'fixed': {
        amount = p.value ?? 0
        formulaText = 'a fixed amount set by the structure'
        break
      }
      case 'percent_of': {
        const target = p.def.percentOf ?? 'ANCHOR'
        const basis = scope[target]
        if (basis === undefined) throw new StructureError(`Head "${p.def.code}" is a percentage of "${target}", which has no value.`)
        amount = (basis * (p.value ?? 0)) / 100
        formulaText = `${p.value ?? 0}% of ${target}`
        inputs[target] = round2(basis)
        inputs['Rate (%)'] = p.value ?? 0
        break
      }
      case 'formula': {
        if (!p.formula) throw new StructureError(`Head "${p.def.code}" is formula-based but has no formula.`)
        try { amount = evaluateFormula(p.formula, scope) }
        catch (e) {
          if (e instanceof FormulaError) throw new StructureError(`Head "${p.def.code}": ${e.message}`)
          throw e
        }
        formulaText = p.formula
        for (const d of p.deps) inputs[d] = round2(scope[d] ?? 0)
        break
      }
      case 'slab': {
        const slabs = p.def.slabs ?? []
        const basis = assignment.anchorAmount
        const hit = slabs.find(s => s.upTo === null || basis <= s.upTo)
        amount = hit?.amount ?? 0
        formulaText = `slab band for an anchor of ₹${round2(basis)}`
        inputs['Anchor'] = round2(basis)
        break
      }
      case 'balance': {
        // The "Special Allowance = CTC − everything else" pattern. Never negative:
        // an over-specified structure is a configuration error, and paying a
        // negative allowance would hide it.
        amount = Math.max(0, assignment.anchorAmount - runningEarnings)
        formulaText = `₹${round2(assignment.anchorAmount)} anchor less the ₹${round2(runningEarnings)} already allocated`
        inputs['Anchor'] = round2(assignment.anchorAmount)
        inputs['Allocated so far'] = round2(runningEarnings)
        break
      }
    }

    amount = applyRounding(amount, p.def.rounding)
    scope[p.def.code] = amount
    if (p.def.kind === 'earning') {
      runningEarnings = round2(runningEarnings + amount)
      scope.GROSS = runningEarnings
    }

    out.push({
      def: p.def,
      amount,
      trace: {
        label: p.def.name,
        value: amount,
        unit: 'INR',
        formula: formulaText,
        inputs,
        note: p.override
          ? `Overridden for this employee${p.override.reason ? ` — ${p.override.reason}` : ''}, effective ${p.override.effectiveFrom}.`
          : `From structure "${structure.name}" v${structure.version}.`,
      },
    })
  }

  // Emit in the author's sequence, not the evaluation order — a payslip should
  // read Basic, HRA, DA regardless of what had to be computed first.
  out.sort((a, b) => a.def.sequence - b.def.sequence)
  return { components: out, gross: round2(runningEarnings) }
}
