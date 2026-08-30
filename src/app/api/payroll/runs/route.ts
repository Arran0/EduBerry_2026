import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { requireAdmin } from '@/lib/payroll/serverGuard'
import { periodFor } from '@/lib/payroll/hydrate'

// Create a payroll run and seed it with a draft line per eligible employee.
//
// Eligibility is "on the roll during the period": everybody with a payroll
// structure in force, minus anyone who left before it started. Someone with no
// structure is still included, and raises a blocking NO_STRUCTURE exception at
// Calculate — leaving them off the run silently is how people miss a payslip.

export async function POST(request: NextRequest) {
  const guard = await requireAdmin(request)
  if (!guard.ok) return guard.response
  const { db, userId } = guard

  const body = await request.json()
  const periodMonth = Number(body.periodMonth)
  const periodYear = Number(body.periodYear)
  const runType = (body.runType ?? 'regular') as string
  if (!periodMonth || !periodYear || periodMonth < 1 || periodMonth > 12) {
    return NextResponse.json({ success: false, error: 'A valid period month and year are required' }, { status: 400 })
  }

  const period = periodFor(periodYear, periodMonth, body.periodFrom, body.periodTo)

  const { data: run, error: runErr } = await db.from('payroll_runs').insert({
    period_month: periodMonth, period_year: periodYear,
    period_from: period.from, period_to: period.to,
    run_type: runType, status: 'draft',
    label: body.label ?? null, pay_date: body.payDate ?? null,
    created_by: userId,
  }).select('id').single()

  if (runErr || !run) {
    // The unique index on (year, month) for regular runs is the likeliest cause,
    // and "one already exists" is far more useful than the raw constraint name.
    const duplicate = runErr?.code === '23505'
    return NextResponse.json({
      success: false,
      error: duplicate ? 'A regular run already exists for that month.' : runErr?.message ?? 'Could not create the run',
    }, { status: duplicate ? 409 : 500 })
  }

  let employeeIds: string[] = Array.isArray(body.employeeIds) ? body.employeeIds : []
  if (employeeIds.length === 0) {
    const { data: assigned } = await db
      .from('payroll_employee_structures')
      .select('employee_id')
      .lte('effective_from', period.to)
      .or(`effective_to.is.null,effective_to.gte.${period.from}`)
    employeeIds = [...new Set((assigned ?? []).map(a => a.employee_id as string))]

    // Anyone in a payroll-bearing role who has no structure yet still belongs on
    // the run, so the missing structure surfaces as an exception rather than as
    // a person nobody notices is unpaid.
    const { data: staff } = await db
      .from('profiles').select('id')
      .in('role', ['teacher', 'coordinator', 'principal', 'driver'])
      .eq('is_banned', false)
    for (const s of staff ?? []) if (!employeeIds.includes(s.id)) employeeIds.push(s.id)

    // Exclude anyone who had already left before the period opened.
    const { data: exited } = await db
      .from('staff_details').select('staff_id, date_of_exit')
      .in('staff_id', employeeIds).not('date_of_exit', 'is', null).lt('date_of_exit', period.from)
    const exitedIds = new Set((exited ?? []).map(e => e.staff_id as string))
    employeeIds = employeeIds.filter(id => !exitedIds.has(id))
  }

  if (employeeIds.length > 0) {
    const { error: lineErr } = await db.from('payroll_run_lines').insert(
      employeeIds.map(employee_id => ({ run_id: run.id, employee_id })),
    )
    if (lineErr) {
      return NextResponse.json({ success: false, error: lineErr.message }, { status: 500 })
    }
  }

  await db.from('payroll_run_events').insert({
    run_id: run.id, from_status: null, to_status: 'draft', actor_id: userId,
    note: `Run created with ${employeeIds.length} employee(s).`,
  })

  return NextResponse.json({ success: true, runId: run.id, lineCount: employeeIds.length })
}
