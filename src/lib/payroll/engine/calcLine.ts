// ============================================================================
// The orchestrator — one employee, one period, one explainable result.
// ----------------------------------------------------------------------------
// This is the function the browser calls for a live preview and the function the
// Calculate route calls to write the authoritative run line. Same code, same
// inputs, same output: a preview that disagrees with the payroll it previews is
// worse than no preview, so there is only one implementation.
//
// Order of operations, and why:
//   1. policy + calendar   — everything downstream depends on which rules apply
//   2. attendance          — LOP days, from the day grid
//   3. structure           — full-month heads
//   4. LOP and proration   — applied to the heads, so PF/ESI sit on *earned*
//                            wages, which is what the statutes actually say
//   5. statutory           — PF, ESI, PT, LWF on those earned wage bases
//   6. TDS                 — needs taxable earnings, so it follows the rest
//   7. arrears, adjustments, settlement
//   8. recoveries          — last, because they are capped by what is left
// ============================================================================

import type {
  EngineInput, EngineResult, ResolvedComponent, ExplainNode, EngineWarning, ComponentDef,
} from './types'
import { resolvePolicyFor, resolveCalendarFor } from './resolvePolicy'
import { resolveJurisdiction } from './resolveLocation'
import { calcAttendance } from './attendance'
import { assignmentOn, buildStructure, StructureError } from './structure'
import { calcPf, calcEsi, calcPt, calcLwf, statutoryWarnings } from './statutory'
import { calcTds } from './tds'
import { calcRecoveries } from './recoveries'
import { arrearsTrace } from './arrears'
import { calcLeaveEncashment, calcNoticeRecovery, calcGratuity, calcStatutoryBonus, settlementDayRate } from './ff'
import { round2, round0, sum, applyRounding } from './money'

/** A synthetic head for something the engine emits rather than a structure. */
function systemDef(over: Partial<ComponentDef> & Pick<ComponentDef, 'code' | 'name' | 'kind'>): ComponentDef {
  return {
    id: `sys:${over.code}`, calcType: 'fixed', percentOf: null, formula: null, slabs: null,
    sequence: 900, rounding: 'nearest_rupee', isTaxable: false, countsForPf: false,
    countsForEsi: false, countsForPt: false, lopApplicable: false, prorateOnJoinExit: false,
    showOnPayslip: true, isSystem: true, ...over,
  }
}

function resolved(def: ComponentDef, amount: number, trace: ExplainNode, fullAmount = amount): ResolvedComponent {
  return { code: def.code, name: def.name, kind: def.kind, amount, fullAmount, def, trace }
}

/** April is month 1 of the Indian financial year. */
export function monthIndexInFinancialYear(month: number): number {
  return month >= 4 ? month - 3 : month + 9
}

export function financialYearOf(year: number, month: number): string {
  const start = month >= 4 ? year : year - 1
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`
}

export function calcLine(input: EngineInput, today: string): EngineResult {
  const { period, employee, rules } = input
  const warnings: EngineWarning[] = []
  const onDate = period.to

  // ── 1. Which rules govern this person ────────────────────────────────
  const { policy, source: policySource } = resolvePolicyFor(input.policyGroups, employee, onDate)
  const { calendar, source: calendarSource } = resolveCalendarFor(input.calendars, employee, onDate)

  // Where they work decides which state's Professional Tax and LWF apply. The
  // hydrator resolved this too, with this same function, to pick the rule sets
  // pinned in `input.rules` — so the two cannot disagree about the state.
  const place = resolveJurisdiction(input.locations, employee, onDate, input.defaultJurisdiction)
  if (place.unlocated) {
    warnings.push({
      code: 'NO_LOCATION',
      // Blocking: guessing a state means guessing somebody's tax, and the wrong
      // guess is a return filed in the wrong state.
      severity: 'block',
      message: `${employee.name} is not assigned to a work location, so no state's Professional Tax rules can be applied with confidence.`,
      details: { assumed: place.jurisdiction },
    })
  }

  // ── 2. Attendance ────────────────────────────────────────────────────
  const attendance = calcAttendance({
    from: period.from, to: period.to, employee, calendar, holidays: input.holidays,
    records: input.attendance, policy, policySource, calendarSource, today,
  })
  if (attendance.lopDays > attendance.payableDays) {
    warnings.push({
      code: 'LOP_EXCEEDS_PERIOD', severity: 'block',
      message: `${employee.name} has ${attendance.lopDays} LOP days against ${attendance.payableDays} payable days.`,
    })
  }
  if (attendance.days.some(d => d.reason.startsWith('No attendance marked'))) {
    warnings.push({
      code: 'ATTENDANCE_INCOMPLETE', severity: 'warn',
      message: `${employee.name} has days with no attendance marked, which are being treated as unauthorised absence.`,
      details: { dates: attendance.days.filter(d => d.reason.startsWith('No attendance marked')).map(d => d.date) },
    })
  }

  // ── 3. Structure ─────────────────────────────────────────────────────
  const assignment = assignmentOn(input.assignments, onDate)
  const structure = assignment ? input.structures.find(s => s.id === assignment.structureId) ?? null : null
  const components: ResolvedComponent[] = []

  if (!assignment || !structure) {
    warnings.push({
      code: 'NO_STRUCTURE', severity: 'block',
      message: `${employee.name} has no salary structure in force on ${onDate}.`,
    })
  } else {
    let built
    try {
      built = buildStructure({
        assignment, structure, overrides: input.overrides, components: input.components,
        onDate, payableDays: attendance.payableDays,
      })
    } catch (e) {
      if (e instanceof StructureError) {
        warnings.push({ code: 'STRUCTURE_INVALID', severity: 'block', message: `${employee.name}: ${e.message}` })
        built = null
      } else throw e
    }

    if (built) {
      // ── 4. LOP and proration, applied to the heads themselves ─────────
      const perDayFactor = attendance.payableDays > 0 ? attendance.lopDays / attendance.payableDays : 0
      const prorationFactor = attendance.payableDays > 0
        ? Math.min(1, attendance.onRollDays / attendance.payableDays)
        : 1

      for (const b of built.components) {
        let amount = b.amount
        const children: ExplainNode[] = [b.trace]

        if (b.def.prorateOnJoinExit && prorationFactor < 1) {
          const before = amount
          amount = round2(amount * prorationFactor)
          children.push({
            label: 'Prorated for part of the period on the roll', value: amount - before, unit: 'INR',
            formula: `× ${attendance.onRollDays} day(s) on the roll ÷ ${attendance.payableDays} payable day(s)`,
            note: employee.dateOfJoining && employee.dateOfJoining > period.from
              ? `Joined on ${employee.dateOfJoining}.`
              : employee.dateOfExit && employee.dateOfExit < period.to
                ? `Last working day ${employee.dateOfExit}.`
                : undefined,
          })
        }
        if (b.def.lopApplicable && attendance.lopDays > 0) {
          const lost = round2(amount * perDayFactor)
          amount = round2(amount - lost)
          children.push({
            label: 'Reduced for loss of pay', value: -lost, unit: 'INR',
            formula: `× ${attendance.lopDays} LOP day(s) ÷ ${attendance.payableDays} payable day(s)`,
            policy: policySource,
            note: 'Loss of pay reduces the head itself, so PF and ESI are calculated on wages actually earned.',
          })
        }

        amount = applyRounding(amount, b.def.rounding)
        components.push(resolved(b.def, amount, {
          label: b.def.name, value: amount, unit: 'INR',
          note: children.length > 1 ? 'Full-month amount, then adjusted for time on the roll and loss of pay.' : undefined,
          children,
        }, b.amount))
      }

      // An informational head so a payslip can show LOP as its own line even
      // though the money has already been taken out of the heads above.
      if (attendance.lopDays > 0) {
        const fullEarnings = sum(built.components.filter(c => c.def.kind === 'earning').map(c => c.amount))
        const earned = sum(components.filter(c => c.kind === 'earning').map(c => c.amount))
        components.push(resolved(
          systemDef({ code: 'LOP', name: 'Loss of pay', kind: 'informational', sequence: 899 }),
          round2(fullEarnings - earned),
          { ...attendance.trace, label: 'Loss of pay', value: round2(fullEarnings - earned), unit: 'INR' },
        ))
      }
    }
  }

  // ── 5. Statutory deductions ──────────────────────────────────────────
  const pf = calcPf(employee, components, rules.pf)
  const esi = calcEsi(employee, components, rules.esi, period.month)
  const pt = calcPt(components, rules.pt, period.month, place.jurisdiction)
  const lwf = calcLwf(components, rules.lwf, period.month, place.jurisdiction)
  // Not every state levies Professional Tax — Delhi, Haryana and UP do not — so
  // "no PT rule set" is not wrong in itself. It is wrong when it happens for a
  // state other than the school's own: the school has evidently configured PT
  // where it is headquartered, so a second state with nothing published is an
  // unconfigured state rather than a state without the levy.
  if (!rules.pt && place.jurisdiction !== input.defaultJurisdiction) {
    warnings.push({
      code: 'NO_PT_RULE_FOR_STATE', severity: 'block',
      message: `No Professional Tax rule set is published for ${place.jurisdiction}, which is where ${employee.name} works.`,
      details: { jurisdiction: place.jurisdiction, location: place.location?.name ?? null },
    })
  }
  warnings.push(...statutoryWarnings(employee, pf, esi))

  if (pf.applicable && pf.employee > 0) {
    components.push(resolved(systemDef({ code: 'PF', name: 'Provident Fund', kind: 'deduction', sequence: 910 }), pf.employee, pf.trace))
    components.push(resolved(systemDef({ code: 'PF_ER', name: 'Employer PF', kind: 'employer_contribution', sequence: 960, showOnPayslip: true }), pf.employerPf, { label: 'Employer PF', value: pf.employerPf, unit: 'INR' }))
    if (pf.eps > 0) components.push(resolved(systemDef({ code: 'EPS_ER', name: 'Employer pension (EPS)', kind: 'employer_contribution', sequence: 961 }), pf.eps, { label: 'Employer pension (EPS)', value: pf.eps, unit: 'INR' }))
    if (pf.edli > 0) components.push(resolved(systemDef({ code: 'EDLI_ER', name: 'EDLI', kind: 'employer_contribution', sequence: 962 }), pf.edli, { label: 'EDLI', value: pf.edli, unit: 'INR' }))
    if (pf.admin > 0) components.push(resolved(systemDef({ code: 'PF_ADMIN_ER', name: 'PF administrative charges', kind: 'employer_contribution', sequence: 963 }), pf.admin, { label: 'PF administrative charges', value: pf.admin, unit: 'INR' }))
  }
  if (esi.applicable && esi.employee > 0) {
    components.push(resolved(systemDef({ code: 'ESI', name: 'ESI', kind: 'deduction', sequence: 911 }), esi.employee, esi.trace))
    components.push(resolved(systemDef({ code: 'ESI_ER', name: 'Employer ESI', kind: 'employer_contribution', sequence: 964 }), esi.employer, { label: 'Employer ESI', value: esi.employer, unit: 'INR' }))
  }
  if (pt.amount > 0) components.push(resolved(systemDef({ code: 'PT', name: 'Professional Tax', kind: 'deduction', sequence: 912 }), pt.amount, pt.trace))
  if (lwf.employee > 0) {
    components.push(resolved(systemDef({ code: 'LWF', name: 'Labour Welfare Fund', kind: 'deduction', sequence: 913 }), lwf.employee, lwf.trace))
    if (lwf.employer > 0) components.push(resolved(systemDef({ code: 'LWF_ER', name: 'Employer LWF', kind: 'employer_contribution', sequence: 965 }), lwf.employer, { label: 'Employer LWF', value: lwf.employer, unit: 'INR' }))
  }

  // ── 6. Settlement additions ──────────────────────────────────────────
  const s = input.settlement
  if (s) {
    const dayRate = settlementDayRate(components, policy, attendance.payableDays)
    const monthlyWages = sum(components.filter(c => c.kind === 'earning').map(c => c.fullAmount))
    const ffParts = [
      calcLeaveEncashment(s, policy, dayRate, policySource),
      calcNoticeRecovery(s, dayRate, policySource),
      calcGratuity(s, components, rules.gratuity),
      calcStatutoryBonus(s, monthlyWages, rules.bonus),
    ].filter(Boolean)
    for (const p of ffParts) {
      if (!p) continue
      components.push(resolved(
        systemDef({ code: p.code, name: p.label, kind: p.kind, sequence: p.kind === 'earning' ? 800 : 920, isTaxable: p.code === 'LEAVE_ENCASH' }),
        p.amount, p.trace,
      ))
    }
  }

  // ── 7. Arrears and one-off adjustments ───────────────────────────────
  if (input.arrears.length > 0) {
    const a = arrearsTrace(input.arrears)
    if (a.total !== 0) {
      components.push(resolved(systemDef({ code: 'ARREARS', name: 'Arrears', kind: 'earning', sequence: 810, isTaxable: true }), a.total, a.trace))
    }
  }
  for (const adj of input.adjustments) {
    components.push(resolved(
      systemDef({ code: adj.code, name: adj.label, kind: adj.kind, sequence: adj.kind === 'earning' ? 820 : 930, isTaxable: adj.kind === 'earning' }),
      Math.abs(adj.amount),
      { label: adj.label, value: adj.kind === 'deduction' ? -Math.abs(adj.amount) : Math.abs(adj.amount), unit: 'INR', note: adj.note ?? 'Entered by the payroll office for this period only.' },
    ))
  }

  // ── 8. TDS ───────────────────────────────────────────────────────────
  const tds = calcTds({
    components, rs: rules.tds, declaration: input.declaration, ytd: input.ytd,
    monthIndexInFy: monthIndexInFinancialYear(period.month), monthsInFy: 12,
    professionalTaxThisMonth: pt.amount, isFinalSettlement: !!s,
  })
  if (tds.monthlyDeduction > 0) {
    components.push(resolved(systemDef({ code: 'TDS', name: 'Income tax (TDS)', kind: 'deduction', sequence: 914 }), tds.monthlyDeduction, tds.trace))
  }

  // ── 9. Recoveries, capped by what is left ────────────────────────────
  const grossEarnings = sum(components.filter(c => c.kind === 'earning').map(c => c.amount))
  const deductionsBeforeRecovery = sum(components.filter(c => c.kind === 'deduction').map(c => c.amount))
  const availableNet = round2(grossEarnings - deductionsBeforeRecovery)

  // On an exit, whatever is owed is settled in full rather than by instalment.
  const loans = s ? input.loans.map(l => ({ ...l, emiAmount: l.outstanding })) : input.loans
  const advances = s ? input.advances.map(a => ({ ...a, recoveryMode: 'single' as const })) : input.advances
  const rec = calcRecoveries({ advances, loans, availableNet, period: `${period.year}-${String(period.month).padStart(2, '0')}` })

  for (const r of rec.recoveries) {
    if (r.recovered <= 0) continue
    components.push(resolved(
      systemDef({ code: r.componentCode, name: r.label, kind: 'deduction', sequence: 940 }),
      r.recovered, r.trace,
    ))
  }

  // ── 10. Totals ───────────────────────────────────────────────────────
  const totalEarnings = sum(components.filter(c => c.kind === 'earning').map(c => c.amount))
  const totalDeductions = sum(components.filter(c => c.kind === 'deduction').map(c => c.amount))
  const employerContributions = sum(components.filter(c => c.kind === 'employer_contribution').map(c => c.amount))
  const netPay = applyRounding(totalEarnings - totalDeductions, policy.netRounding)

  if (netPay < 0) {
    warnings.push({ code: 'NEGATIVE_NET', severity: 'block', message: `${employee.name} nets ₹${netPay} — deductions exceed earnings.` })
  } else if (netPay === 0 && totalEarnings > 0) {
    warnings.push({ code: 'ZERO_NET', severity: 'warn', message: `${employee.name} nets zero this period.` })
  }
  if (!employee.pan) warnings.push({ code: 'MISSING_PAN', severity: 'warn', message: `${employee.name} has no PAN on record.` })

  components.sort((a, b) => a.def.sequence - b.def.sequence)

  const trace: ExplainNode = {
    label: `Net pay for ${employee.name}`,
    value: netPay,
    unit: 'INR',
    formula: 'total earnings − total deductions',
    inputs: {
      'Total earnings': totalEarnings,
      'Total deductions': totalDeductions,
      'Payable days': attendance.payableDays,
      'Paid days': attendance.paidDays,
      'LOP days': attendance.lopDays,
      'Structure': structure ? `${structure.name} v${structure.version}` : '—',
      'Policy group': policySource.groupName,
      'Working calendar': calendarSource.groupName,
      'Work location': place.location?.name ?? '—',
      'Taxed in': place.jurisdiction,
    },
    note: `${policySource.why} ${calendarSource.why} ${place.why}`,
    children: [
      { label: 'Earnings', value: totalEarnings, unit: 'INR', children: components.filter(c => c.kind === 'earning').map(c => c.trace) },
      { label: 'Deductions', value: totalDeductions, unit: 'INR', children: components.filter(c => c.kind === 'deduction').map(c => c.trace) },
      { label: 'Employer contributions (not deducted from pay)', value: employerContributions, unit: 'INR', children: components.filter(c => c.kind === 'employer_contribution').map(c => c.trace) },
      attendance.trace,
    ],
  }

  return {
    employeeId: employee.id,
    components,
    grossEarnings: totalEarnings,
    totalDeductions,
    employerContributions,
    employerCost: round2(totalEarnings + employerContributions),
    netPay,
    payableDays: attendance.payableDays,
    paidDays: attendance.paidDays,
    lopDays: attendance.lopDays,
    structureId: structure?.id ?? null,
    policyGroupId: policySource.groupId || null,
    calendarId: calendarSource.groupId || null,
    locationId: place.location?.id ?? null,
    entityId: place.location?.entityId ?? null,
    jurisdiction: place.jurisdiction,
    attendance,
    statutoryBases: {
      pfWages: pf.pfWages,
      epsWages: pf.epsWages,
      edliWages: pf.edliWages,
      esiWages: esi.esiWages,
      pfApplicable: pf.applicable,
      esiApplicable: esi.applicable,
      // The EPFO counts a non-contributory period in whole days, and the ESIC
      // counts paid days the same way; both are rounded here rather than at the
      // file writer, so every return reads the same number.
      ncpDays: Math.round(attendance.lopDays),
      paidDaysWhole: Math.ceil(attendance.paidDays),
    },
    recoveries: rec.recoveries,
    trace,
    warnings,
  }
}
