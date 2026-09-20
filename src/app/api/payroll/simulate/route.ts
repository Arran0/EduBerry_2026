import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { requireAdmin } from '@/lib/payroll/serverGuard'
import { loadRunContext, loadEmployeeData, buildEngineInput, periodFor } from '@/lib/payroll/hydrate'
import { calcLine } from '@/lib/payroll/engine/calcLine'
import type { EngineInput, EngineResult } from '@/lib/payroll/engine/types'
import { round2 } from '@/lib/payroll/engine/money'

// "What happens if we give all teachers a 5% increment?"
//
// Runs the real engine twice — once as things stand, once with the scenario
// applied — and writes nothing. Because it is the same `calcLine` the payroll
// itself uses, a simulation and the run it predicts cannot disagree, which is
// the difference between a planning tool and a spreadsheet someone has to
// re-derive by hand every time the rules change.

export const maxDuration = 300

interface ScenarioChange {
  kind: 'percent' | 'amount'
  /** A component code, or ANCHOR to move the whole structure anchor. */
  component: string
  value: number
}

/** Apply the scenario to the engine input, without touching the database. */
function applyScenario(input: EngineInput, change: ScenarioChange): EngineInput {
  if (change.component === 'ANCHOR') {
    return {
      ...input,
      assignments: input.assignments.map(a => ({
        ...a,
        anchorAmount: change.kind === 'percent'
          ? round2(a.anchorAmount * (1 + change.value / 100))
          : round2(a.anchorAmount + change.value),
      })),
    }
  }
  // Moving a single head is expressed as a per-employee override, which is the
  // same mechanism a real change would use — so the simulation exercises the
  // production code path rather than a parallel one.
  return {
    ...input,
    overrides: [
      ...input.overrides,
      {
        componentCode: change.component,
        calcType: null,
        value: null,
        formula: change.kind === 'percent'
          ? `${change.component} * ${1 + change.value / 100}`
          : `${change.component} + ${change.value}`,
        effectiveFrom: '1900-01-01',
        effectiveTo: null,
        reason: 'Simulation',
      },
    ],
  }
}

function componentTotal(r: EngineResult, code: string): number {
  return r.components.filter(c => c.code === code).reduce((s, c) => s + c.amount, 0)
}

export async function POST(request: NextRequest) {
  const guard = await requireAdmin(request)
  if (!guard.ok) return guard.response
  const { db } = guard

  const body = await request.json()
  const periodMonth = Number(body.periodMonth)
  const periodYear = Number(body.periodYear)
  const change = body.change as ScenarioChange
  if (!periodMonth || !periodYear || !change?.component) {
    return NextResponse.json({ success: false, error: 'A period and a change are required' }, { status: 400 })
  }

  const period = periodFor(periodYear, periodMonth)
  const scope = (body.scope ?? {}) as { categories?: string[]; departments?: string[]; employeeIds?: string[] }

  // Who the scenario applies to.
  let employeeIds: string[] = scope.employeeIds ?? []
  if (employeeIds.length === 0) {
    const { data: assigned } = await db.from('payroll_employee_structures')
      .select('employee_id').lte('effective_from', period.to)
      .or(`effective_to.is.null,effective_to.gte.${period.from}`)
    employeeIds = [...new Set((assigned ?? []).map(a => a.employee_id as string))]

    if (scope.categories?.length || scope.departments?.length) {
      let q = db.from('staff_details').select('staff_id').in('staff_id', employeeIds)
      if (scope.categories?.length) q = q.in('employee_category', scope.categories)
      if (scope.departments?.length) q = q.in('department', scope.departments)
      const { data: filtered } = await q
      employeeIds = (filtered ?? []).map(f => f.staff_id as string)
    }
  }
  if (employeeIds.length === 0) {
    return NextResponse.json({ success: false, error: 'The scenario selects nobody.' }, { status: 400 })
  }

  const [ctx, perEmployee, profilesRes, detailsRes] = await Promise.all([
    loadRunContext(db, period),
    loadEmployeeData(db, employeeIds, period),
    db.from('profiles').select('id, full_name, role').in('id', employeeIds),
    db.from('staff_details').select('*').in('staff_id', employeeIds),
  ])

  const profiles = new Map((profilesRes.data ?? []).map(p => [p.id as string, p as { id: string; full_name: string; role: string }]))
  const details = new Map((detailsRes.data ?? []).map(d => [d.staff_id as string, d as Record<string, unknown>]))
  const today = new Date().toISOString().slice(0, 10)

  let baseTotalNet = 0, newTotalNet = 0, baseCost = 0, newCost = 0
  let basePf = 0, newPf = 0, baseEsi = 0, newEsi = 0, baseTds = 0, newTds = 0
  const perEmployeeOut: { employeeId: string; name: string; before: number; after: number; delta: number }[] = []

  for (const id of employeeIds) {
    const profile = profiles.get(id)
    if (!profile) continue
    const input = buildEngineInput({
      ctx, profile, details: details.get(id) ?? null,
      data: perEmployee[id], settlement: null, adjustments: [],
    })
    try {
      const before = calcLine(input, today)
      const after = calcLine(applyScenario(input, change), today)

      baseTotalNet += before.netPay; newTotalNet += after.netPay
      baseCost += before.employerCost; newCost += after.employerCost
      basePf += componentTotal(before, 'PF'); newPf += componentTotal(after, 'PF')
      baseEsi += componentTotal(before, 'ESI'); newEsi += componentTotal(after, 'ESI')
      baseTds += componentTotal(before, 'TDS'); newTds += componentTotal(after, 'TDS')

      perEmployeeOut.push({
        employeeId: id, name: profile.full_name,
        before: before.netPay, after: after.netPay,
        delta: round2(after.netPay - before.netPay),
      })
    } catch {
      // A person with a broken structure is left out of the projection rather
      // than aborting it; the run itself will raise the exception properly.
    }
  }

  const result = {
    employeeCount: perEmployeeOut.length,
    baseTotalNet: round2(baseTotalNet),
    newTotalNet: round2(newTotalNet),
    netDelta: round2(newTotalNet - baseTotalNet),
    employerCostDelta: round2(newCost - baseCost),
    pfDelta: round2(newPf - basePf),
    esiDelta: round2(newEsi - baseEsi),
    tdsDelta: round2(newTds - baseTds),
    annualisedDelta: round2((newCost - baseCost) * 12),
    perEmployee: perEmployeeOut.sort((a, b) => b.delta - a.delta),
  }

  if (body.save && body.name) {
    await db.from('payroll_scenarios').insert({
      name: body.name, description: body.description ?? null,
      period_month: periodMonth, period_year: periodYear,
      scope, change, result, created_by: guard.userId,
    })
  }

  return NextResponse.json({ success: true, result })
}
