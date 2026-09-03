import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { requireAdmin } from '@/lib/payroll/serverGuard'
import { loadRunContext, loadEmployeeData, buildEngineInput, periodFor } from '@/lib/payroll/hydrate'
import { calcLine } from '@/lib/payroll/engine/calcLine'
import { isImmutable, type RunStatus } from '@/lib/payroll/engine/workflow'
import type { EngineResult, SettlementInput } from '@/lib/payroll/engine/types'

// The authoritative calculation.
//
// This route and the browser preview call the SAME `calcLine`. That is the whole
// reason the engine is pure: a preview that can disagree with the payroll it
// previews is worse than no preview at all.
//
// What gets written, per employee:
//   • the money on payroll_run_lines
//   • every head on payroll_line_components — this is what a payslip prints
//   • `inputs` and `trace` JSONB — the workings, stored beside the money so an
//     explanation can never drift from the figure it explains
//   • any warnings, as payroll_exceptions, which gate approval
//
// Recalculating is idempotent: existing lines are updated in place and their
// components and unresolved exceptions replaced. A locked run is refused
// outright by both this route and the database triggers underneath it.

export const maxDuration = 300

export async function POST(request: NextRequest, { params }: { params: { runId: string } }) {
  const guard = await requireAdmin(request)
  if (!guard.ok) return guard.response
  const { db, userId } = guard
  const runId = params.runId

  const { data: run } = await db.from('payroll_runs')
    .select('id, period_month, period_year, period_from, period_to, status, run_type')
    .eq('id', runId).maybeSingle()
  if (!run) return NextResponse.json({ success: false, error: 'Run not found' }, { status: 404 })

  if (isImmutable(run.status as RunStatus)) {
    return NextResponse.json({
      success: false,
      error: 'This run is locked. Post a supplementary run instead of recalculating it.',
    }, { status: 409 })
  }

  const { data: lines } = await db.from('payroll_run_lines').select('id, employee_id').eq('run_id', runId)
  const employeeIds = (lines ?? []).map(l => l.employee_id as string)
  if (employeeIds.length === 0) {
    return NextResponse.json({ success: false, error: 'The run has no employees on it.' }, { status: 400 })
  }
  const lineIdByEmployee = new Map((lines ?? []).map(l => [l.employee_id as string, l.id as string]))

  const period = periodFor(run.period_year, run.period_month, run.period_from, run.period_to)

  const [ctx, perEmployee, profilesRes, detailsRes, settlementsRes] = await Promise.all([
    loadRunContext(db, period),
    loadEmployeeData(db, employeeIds, period),
    db.from('profiles').select('id, full_name, role').in('id', employeeIds),
    db.from('staff_details').select('*').in('staff_id', employeeIds),
    // An F&F run reads its exit facts from the settlement rows attached to it.
    run.run_type === 'ff'
      ? db.from('payroll_ff_settlements').select('*').in('employee_id', employeeIds).neq('status', 'cancelled')
      : Promise.resolve({ data: [] as unknown[] }),
  ])

  const profiles = new Map((profilesRes.data ?? []).map(p => [p.id as string, p as { id: string; full_name: string; role: string }]))
  const details = new Map((detailsRes.data ?? []).map(d => [d.staff_id as string, d as Record<string, unknown>]))
  const settlements = new Map(
    ((settlementsRes.data ?? []) as Record<string, unknown>[]).map(s => [s.employee_id as string, s]),
  )

  const today = new Date().toISOString().slice(0, 10)
  const results: { employeeId: string; lineId: string; result: EngineResult }[] = []
  const failures: { employeeId: string; message: string }[] = []

  for (const employeeId of employeeIds) {
    const profile = profiles.get(employeeId)
    const lineId = lineIdByEmployee.get(employeeId)
    if (!profile || !lineId) continue

    const s = settlements.get(employeeId)
    const settlement: SettlementInput | null = s
      ? {
          lastWorkingDay: s.last_working_day as string,
          noticeDaysRequired: Number(s.notice_days_required) || 0,
          noticeDaysServed: Number(s.notice_days_served) || 0,
          encashableLeaveDays: Number(s.encashable_leave_days) || 0,
          serviceYears: Number(s.service_years) || 0,
          serviceDaysInFinalYear: Number(s.service_days_in_final_year) || 0,
          bonusEligibleDays: Number(s.bonus_eligible_days) || 0,
          bonusYearWages: Number(s.bonus_year_wages) || 0,
        }
      : null

    try {
      const input = buildEngineInput({
        ctx, profile, details: details.get(employeeId) ?? null,
        data: perEmployee[employeeId], settlement, adjustments: [],
      })
      results.push({ employeeId, lineId, result: calcLine(input, today) })
    } catch (e) {
      // One employee's broken structure must not abandon the other 199. The
      // failure becomes a blocking exception so it cannot be approved past.
      failures.push({ employeeId, message: (e as Error).message })
    }
  }

  // ── Persist ───────────────────────────────────────────────────────────
  for (const { lineId, result } of results) {
    // Only the rule sets this line's own state was priced with, not the whole
    // run's. A Karnataka line recording Tamil Nadu's PT set would be provenance
    // that lies, which is worse than none.
    const lineRuleSetIds = {
      ...(ctx.pinnedIds['IN'] ? { IN: ctx.pinnedIds['IN'] } : {}),
      ...(ctx.pinnedIds[result.jurisdiction] ? { [result.jurisdiction]: ctx.pinnedIds[result.jurisdiction] } : {}),
    }

    await db.from('payroll_run_lines').update({
      structure_id: result.structureId,
      policy_group_id: result.policyGroupId,
      calendar_id: result.calendarId,
      location_id: result.locationId,
      entity_id: result.entityId,
      jurisdiction: result.jurisdiction,
      gross_earnings: result.grossEarnings,
      total_deductions: result.totalDeductions,
      employer_contributions: result.employerContributions,
      employer_cost: result.employerCost,
      net_pay: result.netPay,
      payable_days: result.payableDays,
      paid_days: result.paidDays,
      lop_days: result.lopDays,
      inputs: {
        policyGroupId: result.policyGroupId,
        calendarId: result.calendarId,
        structureId: result.structureId,
        attendanceDays: result.attendance.days,
        locationId: result.locationId,
        jurisdiction: result.jurisdiction,
        ruleSetIds: lineRuleSetIds,
      },
      trace: result.trace as unknown as Record<string, unknown>,
    }).eq('id', lineId)

    await db.from('payroll_line_components').delete().eq('line_id', lineId)
    if (result.components.length > 0) {
      await db.from('payroll_line_components').insert(result.components.map(c => ({
        line_id: lineId, run_id: runId,
        component_code: c.code, name: c.name, kind: c.kind,
        amount: c.amount, full_amount: c.fullAmount, sequence: c.def.sequence,
        computed_from: c.trace as unknown as Record<string, unknown>,
      })))
    }
  }

  // Replace only the unresolved exceptions. One an admin has already resolved
  // with a note stays resolved — otherwise every recalculation would silently
  // undo their work and re-block approval.
  await db.from('payroll_exceptions').delete().eq('run_id', runId).is('resolved_at', null)

  const exceptions = [
    ...results.flatMap(({ employeeId, result }) =>
      result.warnings.map(w => ({
        run_id: runId, employee_id: employeeId,
        severity: w.severity, code: w.code, message: w.message,
        details: (w.details ?? null) as Record<string, unknown> | null,
      }))),
    ...failures.map(f => ({
      run_id: runId, employee_id: f.employeeId,
      severity: 'block' as const, code: 'CALCULATION_FAILED',
      message: f.message, details: null,
    })),
  ]

  // Variance outliers are raised here too, so the approver meets them on the
  // exceptions board rather than having to go looking for them.
  const { data: prevRun } = await db.from('payroll_runs').select('id')
    .eq('run_type', run.run_type)
    .or(`period_year.lt.${run.period_year},and(period_year.eq.${run.period_year},period_month.lt.${run.period_month})`)
    .order('period_year', { ascending: false }).order('period_month', { ascending: false }).limit(1)

  if (prevRun?.[0]) {
    const { data: prevLines } = await db.from('payroll_run_lines')
      .select('employee_id, net_pay').eq('run_id', prevRun[0].id)
    const prevByEmployee = new Map((prevLines ?? []).map(l => [l.employee_id as string, Number(l.net_pay)]))
    for (const { employeeId, result } of results) {
      const before = prevByEmployee.get(employeeId)
      if (before === undefined) {
        exceptions.push({
          run_id: runId, employee_id: employeeId, severity: 'info', code: 'NEW_JOINER',
          message: 'Not on the previous run — first payroll for this employee.', details: null,
        })
        continue
      }
      if (before === 0) continue
      const pct = ((result.netPay - before) / before) * 100
      if (Math.abs(pct) >= 15) {
        exceptions.push({
          run_id: runId, employee_id: employeeId, severity: 'warn', code: 'VARIANCE_ABOVE_THRESHOLD',
          message: `Net pay moved ${pct > 0 ? 'up' : 'down'} ${Math.abs(Math.round(pct))}% against last period.`,
          details: { previous: before, current: result.netPay },
        })
      }
    }
    for (const [employeeId] of prevByEmployee) {
      if (!results.some(r => r.employeeId === employeeId)) {
        exceptions.push({
          run_id: runId, employee_id: employeeId, severity: 'info', code: 'EXIT',
          message: 'On the previous run but not on this one.', details: null,
        })
      }
    }
  }

  // A location without its EPFO or ESIC registration still calculates correctly
  // — the rates are central — but its monthly return cannot be filed. That is a
  // warning now and a blocker at file generation, not a reason to stop payroll.
  const locationById = new Map(ctx.locations.map(l => [l.id, l]))
  const flaggedLocations = new Set<string>()
  for (const { employeeId, result } of results) {
    const loc = result.locationId ? locationById.get(result.locationId) : null
    if (!loc || flaggedLocations.has(loc.id)) continue
    const missing: string[] = []
    if (!loc.epfEstablishmentId) missing.push('EPFO establishment id')
    if (!loc.esiEmployerCode) missing.push('ESIC employer code')
    if (missing.length === 0) continue
    flaggedLocations.add(loc.id)
    exceptions.push({
      run_id: runId, employee_id: employeeId, severity: 'warn',
      code: missing.length === 2 ? 'LOCATION_MISSING_REGISTRATION'
        : missing[0].startsWith('EPFO') ? 'LOCATION_MISSING_PF_CODE' : 'LOCATION_MISSING_ESI_CODE',
      message: `"${loc.name}" has no ${missing.join(' and no ')}, so its statutory return cannot be filed.`,
      details: { locationId: loc.id, locationName: loc.name, missing },
    })
  }

  // Bank details are checked here rather than in the engine: the engine computes
  // pay, and whether the money can physically reach someone is a different
  // question that only matters at disbursement.
  const { data: banks } = await db.from('staff_bank_accounts').select('staff_id').in('staff_id', employeeIds)
  const { data: driverBanks } = await db.from('driver_bank_accounts').select('driver_id').in('driver_id', employeeIds)
  const banked = new Set([
    ...(banks ?? []).map(b => b.staff_id as string),
    ...(driverBanks ?? []).map(b => b.driver_id as string),
  ])
  for (const { employeeId, result } of results) {
    if (result.netPay > 0 && !banked.has(employeeId)) {
      exceptions.push({
        run_id: runId, employee_id: employeeId, severity: 'block', code: 'MISSING_BANK',
        message: `${profiles.get(employeeId)?.full_name ?? 'This employee'} has no bank account on record and cannot be paid.`,
        details: null,
      })
    }
  }

  if (exceptions.length > 0) await db.from('payroll_exceptions').insert(exceptions)

  const blocking = exceptions.filter(e => e.severity === 'block').length
  const totalNet = results.reduce((s, r) => s + r.result.netPay, 0)
  const nextStatus = blocking > 0 ? 'exceptions' : 'calculated'

  await db.from('payroll_runs').update({
    status: nextStatus,
    calculated_at: new Date().toISOString(),
    rule_set_ids: ctx.pinnedIds,
    // Recalculating invalidates a prior variance review: the numbers it was
    // signed off against no longer exist.
    variance_acknowledged_by: null,
    variance_acknowledged_at: null,
  }).eq('id', runId)

  await db.from('payroll_run_events').insert({
    run_id: runId, from_status: run.status, to_status: nextStatus, actor_id: userId,
    note: `Calculated ${results.length} line(s); ${exceptions.length} exception(s), ${blocking} blocking.`,
    details: { ruleSetIds: ctx.pinnedIds, failures: failures.length },
  })

  return NextResponse.json({
    success: true,
    lineCount: results.length,
    exceptions: exceptions.length,
    blocking,
    failures: failures.length,
    totalNet,
    status: nextStatus,
  })
}
