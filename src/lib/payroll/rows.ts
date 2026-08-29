// ============================================================================
// Database row shapes for payroll v2, and the mappers into engine types.
// ----------------------------------------------------------------------------
// The engine knows nothing about Supabase and the database knows nothing about
// the engine's camelCase types. This module is the only place the two meet, so
// a column rename touches one file rather than fifteen.
// ============================================================================

import type {
  ComponentDef, EngineStructure, EngineAssignment, EngineOverride, PolicyGroup,
  WorkingCalendar, RuleSet, RuleBody, EngineEmployee, EmployeeCategory, PayrollPolicy,
} from './engine/types'
import type { RunStatus } from './engine/workflow'

// ── Rows ────────────────────────────────────────────────────────────────

export interface ComponentRow {
  id: string; code: string; name: string; kind: ComponentDef['kind']
  calc_type: ComponentDef['calcType']; percent_of: string | null; formula: string | null
  slabs: ComponentDef['slabs']; sequence: number; rounding: ComponentDef['rounding']
  is_taxable: boolean; counts_for_pf: boolean; counts_for_esi: boolean; counts_for_pt: boolean
  lop_applicable: boolean; prorate_on_join_exit: boolean; show_on_payslip: boolean; is_system: boolean
}

export interface StructureRow {
  id: string; code: string; name: string; employee_category: string | null
  version: number; supersedes_id: string | null; status: 'draft' | 'active' | 'archived'
  effective_from: string; effective_to: string | null; notes: string | null
  components?: StructureComponentRow[]
}

export interface StructureComponentRow {
  id: string; structure_id: string; component_id: string
  calc_type: ComponentDef['calcType'] | null; value: number | null; formula: string | null; sequence: number | null
  component?: { code: string }
}

export interface AssignmentRow {
  id: string; employee_id: string; structure_id: string
  effective_from: string; effective_to: string | null; anchor_amount: number
  revision_id: string | null; reason: string | null; created_at: string
  structure?: { name: string; version: number; code: string }
}

export interface OverrideRow {
  id: string; employee_id: string; component_id: string
  calc_type: ComponentDef['calcType'] | null; value: number | null; formula: string | null
  effective_from: string; effective_to: string | null; reason: string | null
  component?: { code: string }
}

export interface PolicyGroupRow {
  id: string; name: string; is_default: boolean; priority: number
  effective_from: string; effective_to: string | null
  match: PolicyGroup['match']; policy: PayrollPolicy; notes: string | null
  members?: { employee_id: string }[]
}

export interface CalendarRow {
  id: string; name: string; is_default: boolean; priority: number
  effective_from: string; effective_to: string | null; match: WorkingCalendar['match']
  basis: WorkingCalendar['basis']; fixed_days: number
  week_pattern: WorkingCalendar['weekPattern']
  nth_weekday_rules: WorkingCalendar['nthWeekdayRules']
  members?: { employee_id: string }[]
}

export interface RuleSetRow {
  id: string; domain: RuleSet['domain']; jurisdiction: string; version: number
  effective_from: string; effective_to: string | null; rules: RuleBody
  source_note: string | null; status: 'draft' | 'published' | 'superseded'
  published_at: string | null
}

export interface RunRow {
  id: string; period_month: number; period_year: number
  period_from: string; period_to: string; pay_date: string | null
  run_type: 'regular' | 'supplementary' | 'arrears' | 'bonus' | 'ff'
  status: RunStatus; label: string | null; notes: string | null
  rule_set_ids: Record<string, string> | null
  variance_acknowledged_by: string | null; variance_acknowledged_at: string | null
  calculated_at: string | null; approved_by: string | null; approved_at: string | null
  locked_by: string | null; locked_at: string | null; locked_hash: string | null
  created_at: string
}

export interface RunLineRow {
  id: string; run_id: string; employee_id: string
  structure_id: string | null; policy_group_id: string | null; calendar_id: string | null
  gross_earnings: number; total_deductions: number; employer_contributions: number
  employer_cost: number; net_pay: number
  payable_days: number; paid_days: number; lop_days: number
  inputs: Record<string, unknown> | null
  trace: Record<string, unknown> | null
  payout_status: string | null; payout_reference: string | null
  employee?: { id: string; full_name: string; role: string; avatar_url?: string | null }
  components?: LineComponentRow[]
}

export interface LineComponentRow {
  id: string; line_id: string; run_id: string
  component_code: string; name: string; kind: ComponentDef['kind']
  amount: number; full_amount: number; sequence: number
  computed_from: Record<string, unknown> | null
}

export interface ExceptionRow {
  id: string; run_id: string; employee_id: string | null
  severity: 'block' | 'warn' | 'info'; code: string; message: string
  details: Record<string, unknown> | null
  resolved_at: string | null; resolved_by: string | null; resolution_note: string | null
  created_at: string
  employee?: { full_name: string } | null
}

export interface RunEventRow {
  id: string; run_id: string; from_status: string | null; to_status: string
  actor_id: string | null; note: string | null; created_at: string
  actor?: { full_name: string } | null
}

export interface StatutoryRow {
  employee_id: string
  pf_applicable: boolean; eps_applicable: boolean
  pf_wage_override: number | null; esi_override: boolean | null
  esi_covered_at_period_start: boolean | null
  uan: string | null; esi_ip_number: string | null; pan: string | null
}

// ── Mappers ─────────────────────────────────────────────────────────────

export function toComponentDef(r: ComponentRow): ComponentDef {
  return {
    id: r.id, code: r.code, name: r.name, kind: r.kind, calcType: r.calc_type,
    percentOf: r.percent_of, formula: r.formula, slabs: r.slabs, sequence: r.sequence,
    rounding: r.rounding, isTaxable: r.is_taxable, countsForPf: r.counts_for_pf,
    countsForEsi: r.counts_for_esi, countsForPt: r.counts_for_pt,
    lopApplicable: r.lop_applicable, prorateOnJoinExit: r.prorate_on_join_exit,
    showOnPayslip: r.show_on_payslip, isSystem: r.is_system,
  }
}

export function toEngineStructure(r: StructureRow, codeById: Map<string, string>): EngineStructure {
  return {
    id: r.id, name: r.name, version: r.version,
    effectiveFrom: r.effective_from, effectiveTo: r.effective_to,
    components: (r.components ?? []).map(c => ({
      componentCode: c.component?.code ?? codeById.get(c.component_id) ?? '',
      calcType: c.calc_type, value: c.value, formula: c.formula, sequence: c.sequence,
    })),
  }
}

export function toEngineAssignment(r: AssignmentRow): EngineAssignment {
  return {
    id: r.id, structureId: r.structure_id, effectiveFrom: r.effective_from,
    effectiveTo: r.effective_to, anchorAmount: Number(r.anchor_amount) || 0,
    revisionId: r.revision_id, reason: r.reason,
  }
}

export function toEngineOverride(r: OverrideRow, codeById: Map<string, string>): EngineOverride {
  return {
    componentCode: r.component?.code ?? codeById.get(r.component_id) ?? '',
    calcType: r.calc_type, value: r.value, formula: r.formula,
    effectiveFrom: r.effective_from, effectiveTo: r.effective_to, reason: r.reason,
  }
}

export function toPolicyGroup(r: PolicyGroupRow): PolicyGroup {
  return {
    id: r.id, name: r.name, isDefault: r.is_default, priority: r.priority,
    effectiveFrom: r.effective_from, effectiveTo: r.effective_to,
    memberIds: (r.members ?? []).map(m => m.employee_id),
    match: r.match, policy: r.policy,
  }
}

export function toWorkingCalendar(r: CalendarRow): WorkingCalendar {
  return {
    id: r.id, name: r.name, isDefault: r.is_default, priority: r.priority,
    effectiveFrom: r.effective_from, effectiveTo: r.effective_to,
    memberIds: (r.members ?? []).map(m => m.employee_id),
    match: r.match, basis: r.basis, fixedDays: r.fixed_days,
    weekPattern: r.week_pattern, nthWeekdayRules: r.nth_weekday_rules,
  }
}

export function toRuleSet(r: RuleSetRow): RuleSet {
  return {
    id: r.id, domain: r.domain, jurisdiction: r.jurisdiction, version: r.version,
    effectiveFrom: r.effective_from, effectiveTo: r.effective_to,
    sourceNote: r.source_note, rules: r.rules,
  }
}

/** Everything the engine needs to know about a person, assembled from three tables. */
export function toEngineEmployee(
  profile: { id: string; full_name: string; role: string },
  details: {
    employee_category?: string | null; date_of_joining?: string | null; date_of_exit?: string | null
    department?: string | null; designation?: string | null; pan_no?: string | null
    pt_jurisdiction?: string | null
  } | null,
  statutory: StatutoryRow | null,
  defaultJurisdiction: string,
): EngineEmployee {
  // profiles.role is the only categorisation the app had before payroll v2, so
  // it remains the fallback when staff_details has not been filled in.
  const category: EmployeeCategory =
    (details?.employee_category as EmployeeCategory | undefined) ??
    (profile.role === 'driver' ? 'transport' : 'teaching')

  return {
    id: profile.id,
    name: profile.full_name,
    category,
    dateOfJoining: details?.date_of_joining ?? null,
    dateOfExit: details?.date_of_exit ?? null,
    department: details?.department ?? null,
    designation: details?.designation ?? null,
    pan: statutory?.pan ?? details?.pan_no ?? null,
    uan: statutory?.uan ?? null,
    esiIpNumber: statutory?.esi_ip_number ?? null,
    pfApplicable: statutory?.pf_applicable ?? false,
    epsApplicable: statutory?.eps_applicable ?? true,
    esiOverride: statutory?.esi_override ?? null,
    esiCoveredAtPeriodStart: statutory?.esi_covered_at_period_start ?? null,
    pfWageOverride: statutory?.pf_wage_override ?? null,
    jurisdiction: details?.pt_jurisdiction ?? defaultJurisdiction,
  }
}
