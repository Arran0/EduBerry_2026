import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { requireCapability } from '@/lib/fees/serverGuard'
import { loadEngineInputs } from '@/lib/fees/serverEngine'
import { collectExceptions, computeDemand, hasAmbiguousStructure } from '@/lib/fees/engine'
import { auditFeeAction } from '@/lib/fees/audit'

// Run the engine over a demand run's cohort and store the result as
// fee_demand_lines — a preview nobody has yet been billed for.
//
// Nothing here writes to school_fees. Calculating is safe and repeatable;
// publishing is the irreversible half, and separating them is what lets an
// admin look at 1,200 computed amounts before a single parent sees one.
//
// The structure ids the run resolved to are pinned on the run, so a later
// structure revision provably cannot have moved these numbers.

export const runtime = 'nodejs'
export const maxDuration = 300

export async function POST(
  request: NextRequest,
  { params }: { params: { runId: string } },
) {
  const guard = await requireCapability(request, 'run_demand')
  if (!guard.ok) return guard.response
  const { db, userId } = guard.actor

  const { data: run } = await db
    .from('fee_demand_runs')
    .select('id, label, academic_year, as_of_date, installment_no, status, structure_ids')
    .eq('id', params.runId)
    .maybeSingle()
  if (!run) return NextResponse.json({ success: false, error: 'Demand run not found' }, { status: 404 })
  if (run.status === 'published') {
    return NextResponse.json(
      { success: false, error: 'This run is published. Create a new run rather than recalculating it.' },
      { status: 409 },
    )
  }

  const homeroomIds = (run.structure_ids as { homeroom_ids?: string[] } | null)?.homeroom_ids ?? null
  const { students, scopes, structures } = await loadEngineInputs(db, {
    academicYear: run.academic_year,
    homeroomIds,
  })

  if (!students.length) {
    return NextResponse.json({ success: false, error: 'No students match this run.' }, { status: 400 })
  }
  if (!Object.keys(structures).length) {
    return NextResponse.json(
      { success: false, error: `No published fee structure exists for ${run.academic_year}. Publish one first.` },
      { status: 400 },
    )
  }

  const onDate = run.as_of_date as string
  const demands = students.map(student =>
    computeDemand({
      student, scopes, structures, onDate,
      installmentNo: run.installment_no ?? undefined,
    }),
  )

  const exceptions = collectExceptions(demands)

  // An ambiguous scope means the bill depends on array order. That is not a
  // number a school can defend, so it blocks rather than warns.
  for (const student of students) {
    if (hasAmbiguousStructure(scopes, student, onDate)) {
      exceptions.push({
        studentId: student.id,
        severity: 'block',
        code: 'ambiguous_structure',
        message: `Two fee structures claim ${student.name} at the same priority. Break the tie before publishing.`,
      })
    }
  }

  // Replace the previous preview wholesale — a recalculation must not leave
  // half of an older run's lines behind.
  await db.from('fee_demand_lines').delete().eq('run_id', run.id)

  const lines = demands.flatMap(d => d.lines.map(l => ({
    run_id: run.id,
    student_id: l.studentId,
    fee_head_id: l.feeHeadId,
    structure_id: l.structureId,
    structure_item_id: l.structureItemId,
    installment_no: l.installmentNo,
    due_date: l.dueDate,
    gross_amount: l.grossAmount,
    concession_amount: l.concessionAmount,
    net_amount: l.netAmount,
    rule_trace: l.trace as unknown as Record<string, unknown>,
  })))

  // Chunked: a whole-school run is tens of thousands of rows and one insert of
  // that size will be rejected long before the database is the bottleneck.
  for (let i = 0; i < lines.length; i += 500) {
    const { error } = await db.from('fee_demand_lines').insert(lines.slice(i, i + 500))
    if (error) {
      console.error('demand-runs/calculate: line insert failed', error)
      return NextResponse.json({ success: false, error: 'Could not store the calculated lines.' }, { status: 500 })
    }
  }

  const grossTotal = round2(demands.reduce((s, d) => s + d.grossTotal, 0))
  const concessionTotal = round2(demands.reduce((s, d) => s + d.concessionTotal, 0))
  const netTotal = round2(demands.reduce((s, d) => s + d.netTotal, 0))
  const billed = demands.filter(d => d.lines.length > 0)

  const usedStructureIds = [...new Set(demands.flatMap(d => d.lines.map(l => l.structureId)))]

  await db.from('fee_demand_runs').update({
    status: 'calculated',
    calculated_at: new Date().toISOString(),
    student_count: billed.length,
    gross_total: grossTotal,
    concession_total: concessionTotal,
    net_total: netTotal,
    structure_ids: { homeroom_ids: homeroomIds, structures: usedStructureIds },
  }).eq('id', run.id)

  await auditFeeAction(db, {
    actorId: userId, action: 'demand_run.calculate', entityType: 'fee_demand_run', entityId: run.id,
    summary: `Calculated "${run.label}": ${billed.length} students, ₹${netTotal.toLocaleString('en-IN')} net`,
    after: { student_count: billed.length, net_total: netTotal, blocking: exceptions.filter(e => e.severity === 'block').length },
    request,
  })

  return NextResponse.json({
    success: true,
    student_count: billed.length,
    line_count: lines.length,
    gross_total: grossTotal,
    concession_total: concessionTotal,
    net_total: netTotal,
    exceptions,
    blocking: exceptions.filter(e => e.severity === 'block').length,
  })
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}
