// ============================================================================
// Server-side hydration — assembling EngineInput for a whole run.
// ----------------------------------------------------------------------------
// The engine is pure and takes everything it needs as an argument. This module
// is what fills that argument in, once per run rather than once per employee:
// components, structures, policies, calendars, holidays and rule sets are
// fetched once and shared, and only attendance, assignments and money-owed are
// per person.
//
// Runs on a service-role client, so it is server-only. Importing this from a
// client component would ship the service role key to the browser; it is only
// ever imported by a route handler.
// ============================================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  EngineInput, EnginePeriod, PinnedRules, EngineAttendanceDay, EngineHoliday,
  ComponentDef, EngineStructure, PolicyGroup, WorkingCalendar, TaxDeclaration, YtdSnapshot,
} from './engine/types'
import {
  toComponentDef, toEngineStructure, toEngineAssignment, toEngineOverride,
  toPolicyGroup, toWorkingCalendar, toRuleSet, toEngineEmployee,
} from './rows'
import type {
  ComponentRow, StructureRow, AssignmentRow, OverrideRow, PolicyGroupRow,
  CalendarRow, RuleSetRow, StatutoryRow,
} from './rows'
import { financialYearOf } from './engine/calcLine'
import { toEngineLoan, toEngineAdvance, toEngineArrear } from './money'
import type { LoanBalanceRow, AdvanceBalanceRow, ArrearRow } from './money'

/** The school's default state for Professional Tax and LWF when a person has none. */
const DEFAULT_JURISDICTION = 'IN-TN'

export interface RunContext {
  period: EnginePeriod
  components: ComponentDef[]
  structures: EngineStructure[]
  policyGroups: PolicyGroup[]
  calendars: WorkingCalendar[]
  holidays: EngineHoliday[]
  ruleRows: RuleSetRow[]
  /** Rule-set ids actually pinned, by domain, for storing on the run. */
  pinnedIds: Record<string, string>
}

export function periodFor(year: number, month: number, from?: string, to?: string): EnginePeriod {
  const first = `${year}-${String(month).padStart(2, '0')}-01`
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const last = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
  return { year, month, from: from ?? first, to: to ?? last, financialYear: financialYearOf(year, month) }
}

/** Everything shared by every line in a run. Fetched once. */
export async function loadRunContext(
  db: SupabaseClient, period: EnginePeriod, jurisdiction = DEFAULT_JURISDICTION,
): Promise<RunContext> {
  const [comps, structs, policies, cals, hols, rules] = await Promise.all([
    db.from('payroll_components').select('*'),
    db.from('payroll_structures').select('*, components:payroll_structure_components(*, component:payroll_components(code))'),
    db.from('payroll_policy_groups').select('*, members:payroll_policy_group_members(employee_id)'),
    db.from('payroll_calendars').select('*, members:payroll_calendar_members(employee_id)'),
    // Holidays already carry their own group scoping; reused rather than duplicated.
    db.from('attendance_holidays').select('id, date, name, is_default, members:attendance_holiday_members(staff_id)')
      .gte('date', period.from).lte('date', period.to),
    db.from('payroll_rule_sets').select('*').eq('status', 'published'),
  ])

  const componentRows = (comps.data ?? []) as ComponentRow[]
  const codeById = new Map(componentRows.map(c => [c.id, c.code]))

  const ruleRows = (rules.data ?? []) as RuleSetRow[]
  const pinnedIds: Record<string, string> = {}
  for (const domain of ['pf', 'esi', 'pt', 'lwf', 'tds', 'gratuity', 'bonus']) {
    const hit = pickRuleSet(ruleRows, domain, jurisdiction, period.to)
    if (hit) pinnedIds[domain] = hit.id
  }

  return {
    period,
    components: componentRows.map(toComponentDef),
    structures: ((structs.data ?? []) as unknown as StructureRow[]).map(s => toEngineStructure(s, codeById)),
    policyGroups: ((policies.data ?? []) as unknown as PolicyGroupRow[]).map(toPolicyGroup),
    calendars: ((cals.data ?? []) as unknown as CalendarRow[]).map(toWorkingCalendar),
    holidays: ((hols.data ?? []) as unknown as { date: string; name: string; is_default: boolean; members: { staff_id: string }[] }[])
      .map(h => ({ date: h.date, name: h.name, isDefault: h.is_default, staffIds: (h.members ?? []).map(m => m.staff_id) })),
    ruleRows,
    pinnedIds,
  }
}

/** The rule set in force for a domain on a date, preferring the state-specific one over the central one. */
export function pickRuleSet(rows: RuleSetRow[], domain: string, jurisdiction: string, onDate: string): RuleSetRow | null {
  return rows
    .filter(r =>
      r.domain === domain && r.effective_from <= onDate &&
      (r.effective_to === null || r.effective_to >= onDate) &&
      (r.jurisdiction === jurisdiction || r.jurisdiction === 'IN'))
    .sort((a, b) =>
      (b.jurisdiction === jurisdiction ? 1 : 0) - (a.jurisdiction === jurisdiction ? 1 : 0) ||
      b.effective_from.localeCompare(a.effective_from))[0] ?? null
}

export function pinnedRulesFor(rows: RuleSetRow[], jurisdiction: string, onDate: string): PinnedRules {
  const get = <T>(domain: string) => {
    const r = pickRuleSet(rows, domain, jurisdiction, onDate)
    return r ? (toRuleSet(r) as unknown as T) : null
  }
  return {
    pf: get('pf'), esi: get('esi'), pt: get('pt'), lwf: get('lwf'),
    tds: get('tds'), gratuity: get('gratuity'), bonus: get('bonus'),
  } as PinnedRules
}

export interface PerEmployeeData {
  assignments: AssignmentRow[]
  overrides: OverrideRow[]
  attendance: EngineAttendanceDay[]
  statutory: StatutoryRow | null
  loans: LoanBalanceRow[]
  advances: AdvanceBalanceRow[]
  arrears: ArrearRow[]
  declaration: TaxDeclaration | null
  ytd: YtdSnapshot | null
}

/**
 * Per-employee data for every line in one round trip each, keyed by employee.
 * Fetching this per employee would turn a 200-person run into 1,600 queries.
 */
export async function loadEmployeeData(
  db: SupabaseClient, employeeIds: string[], period: EnginePeriod,
): Promise<Record<string, PerEmployeeData>> {
  const [assigns, overrides, attendance, corrections, statutory, loans, advances, arrears, declarations, ytdLines] =
    await Promise.all([
      db.from('payroll_employee_structures').select('*').in('employee_id', employeeIds),
      db.from('payroll_employee_overrides').select('*, component:payroll_components(code)').in('employee_id', employeeIds),
      db.from('staff_attendance_records').select('staff_id, date, status, check_in_time, leave_application_id')
        .in('staff_id', employeeIds).gte('date', period.from).lte('date', period.to),
      db.from('payroll_attendance_corrections').select('*')
        .in('employee_id', employeeIds).gte('date', period.from).lte('date', period.to)
        .not('approved_at', 'is', null),
      db.from('payroll_employee_statutory').select('*').in('employee_id', employeeIds),
      db.from('payroll_loan_balances').select('*').in('employee_id', employeeIds),
      db.from('payroll_advance_balances').select('*').in('employee_id', employeeIds),
      db.from('payroll_arrears').select('*').in('employee_id', employeeIds).eq('status', 'pending'),
      db.from('payroll_tax_declarations').select('*').in('employee_id', employeeIds).eq('financial_year', period.financialYear),
      // Everything already paid this financial year, for the TDS projection.
      db.from('payroll_run_lines')
        .select('employee_id, gross_earnings, run:payroll_runs!inner(period_year, period_month, status), components:payroll_line_components(component_code, amount, kind)')
        .in('employee_id', employeeIds),
    ])

  const out: Record<string, PerEmployeeData> = {}
  for (const id of employeeIds) {
    out[id] = {
      assignments: [], overrides: [], attendance: [], statutory: null,
      loans: [], advances: [], arrears: [], declaration: null, ytd: null,
    }
  }

  for (const a of (assigns.data ?? []) as AssignmentRow[]) out[a.employee_id]?.assignments.push(a)
  for (const o of (overrides.data ?? []) as unknown as OverrideRow[]) out[o.employee_id]?.overrides.push(o)
  for (const s of (statutory.data ?? []) as StatutoryRow[]) if (out[s.employee_id]) out[s.employee_id].statutory = s
  for (const l of (loans.data ?? []) as unknown as LoanBalanceRow[]) out[l.employee_id]?.loans.push(l)
  for (const a of (advances.data ?? []) as unknown as AdvanceBalanceRow[]) out[a.employee_id]?.advances.push(a)
  for (const a of (arrears.data ?? []) as unknown as ArrearRow[]) out[a.employee_id]?.arrears.push(a)

  for (const d of (declarations.data ?? []) as unknown as {
    employee_id: string; regime: 'old' | 'new'; sections: Record<string, number>
    previous_employer: TaxDeclaration['previousEmployer']; status: TaxDeclaration['status']
  }[]) {
    if (!out[d.employee_id]) continue
    out[d.employee_id].declaration = {
      financialYear: period.financialYear, regime: d.regime,
      sections: d.sections ?? {}, previousEmployer: d.previous_employer ?? null, status: d.status,
    }
  }

  // Approved corrections supersede the raw attendance record for that day.
  const correctionByKey = new Map<string, { to_status: string; id: string }>()
  for (const c of (corrections.data ?? []) as { employee_id: string; date: string; to_status: string; id: string }[]) {
    correctionByKey.set(`${c.employee_id}|${c.date}`, { to_status: c.to_status, id: c.id })
  }

  for (const r of (attendance.data ?? []) as {
    staff_id: string; date: string; status: string; check_in_time: string | null; leave_application_id: string | null
  }[]) {
    if (!out[r.staff_id]) continue
    const correction = correctionByKey.get(`${r.staff_id}|${r.date}`)
    out[r.staff_id].attendance.push({
      date: r.date,
      status: (correction?.to_status ?? r.status) as EngineAttendanceDay['status'],
      leaveType: null,
      leaveApplicationId: r.leave_application_id,
      lateByMinutes: null,
      correctionId: correction?.id ?? null,
    })
  }

  // Year-to-date, from locked runs earlier in the same financial year. The TDS
  // projection needs it; a draft run's numbers are not yet anything.
  const fyStart = Number(period.financialYear.slice(0, 4))
  for (const l of (ytdLines.data ?? []) as unknown as {
    employee_id: string; gross_earnings: number
    run: { period_year: number; period_month: number; status: string }
    components: { component_code: string; amount: number; kind: string }[]
  }[]) {
    const r = l.run
    if (!r || !['locked', 'paid', 'reconciled'].includes(r.status)) continue
    const inFy = (r.period_year === fyStart && r.period_month >= 4) || (r.period_year === fyStart + 1 && r.period_month <= 3)
    const beforeThisPeriod = r.period_year < period.year || (r.period_year === period.year && r.period_month < period.month)
    if (!inFy || !beforeThisPeriod) continue

    const cur = out[l.employee_id].ytd ?? { taxableEarnings: 0, tdsDeducted: 0, pfEmployee: 0, ptDeducted: 0, monthsPaid: 0 }
    cur.taxableEarnings += Number(l.gross_earnings)
    for (const c of l.components ?? []) {
      if (c.component_code === 'TDS') cur.tdsDeducted += Number(c.amount)
      if (c.component_code === 'PF') cur.pfEmployee += Number(c.amount)
      if (c.component_code === 'PT') cur.ptDeducted += Number(c.amount)
    }
    cur.monthsPaid += 1
    out[l.employee_id].ytd = cur
  }

  return out
}

export interface BuildInputArgs {
  ctx: RunContext
  profile: { id: string; full_name: string; role: string }
  details: Record<string, unknown> | null
  data: PerEmployeeData
  settlement: EngineInput['settlement']
  adjustments: EngineInput['adjustments']
}

export function buildEngineInput(args: BuildInputArgs): EngineInput {
  const { ctx, profile, details, data, settlement, adjustments } = args
  const employee = toEngineEmployee(
    profile,
    details as Parameters<typeof toEngineEmployee>[1],
    data.statutory,
    DEFAULT_JURISDICTION,
  )
  const codeById = new Map<string, string>()

  return {
    period: ctx.period,
    employee,
    assignments: data.assignments.map(toEngineAssignment),
    structures: ctx.structures,
    overrides: data.overrides.map(o => toEngineOverride(o, codeById)),
    components: ctx.components,
    policyGroups: ctx.policyGroups,
    calendars: ctx.calendars,
    holidays: ctx.holidays,
    attendance: data.attendance,
    rules: pinnedRulesFor(ctx.ruleRows, employee.jurisdiction, ctx.period.to),
    arrears: data.arrears.map(toEngineArrear),
    advances: data.advances.filter(a => a.status === 'active').map(toEngineAdvance),
    loans: data.loans.filter(l => l.status === 'active').map(toEngineLoan),
    declaration: data.declaration,
    ytd: data.ytd,
    adjustments,
    settlement,
  }
}
