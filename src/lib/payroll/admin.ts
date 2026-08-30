// ============================================================================
// Payroll v2 admin data layer — catalogue, structures, policies, rules.
// ----------------------------------------------------------------------------
// Browser-side reads and writes for everything an admin configures before a run
// exists. Nothing here calculates: the engine does that, and it is imported by
// the screens directly for previews.
// ============================================================================

import { supabase } from '@/lib/supabase'
import type {
  ComponentRow, StructureRow, AssignmentRow, OverrideRow, PolicyGroupRow,
  CalendarRow, RuleSetRow, StatutoryRow,
} from './rows'
import {
  toComponentDef, toEngineStructure, toEngineAssignment, toPolicyGroup,
  toWorkingCalendar, toRuleSet,
} from './rows'
import type { ComponentDef, PolicyGroup, WorkingCalendar, RuleSet, EngineStructure } from './engine/types'

type Result = { success: boolean; error?: string }

function fail(where: string, error: { message: string } | null): Result {
  if (error) { console.error(`${where} failed:`, error); return { success: false, error: error.message } }
  return { success: true }
}

// ── Salary heads ────────────────────────────────────────────────────────

const COMPONENT_COLUMNS =
  'id, code, name, kind, calc_type, percent_of, formula, slabs, sequence, rounding, ' +
  'is_taxable, counts_for_pf, counts_for_esi, counts_for_pt, lop_applicable, ' +
  'prorate_on_join_exit, show_on_payslip, is_system'

export async function fetchComponents(): Promise<ComponentDef[]> {
  const { data, error } = await supabase
    .from('payroll_components').select(COMPONENT_COLUMNS).order('sequence')
  if (error) { console.error('fetchComponents failed:', error); return [] }
  return ((data ?? []) as unknown as ComponentRow[]).map(toComponentDef)
}

export async function upsertComponent(c: Partial<ComponentRow> & { code: string; name: string }): Promise<Result> {
  const { error } = await supabase.from('payroll_components').upsert(c, { onConflict: 'code' })
  return fail('upsertComponent', error)
}

export async function deleteComponent(id: string): Promise<Result> {
  // System heads are emitted by the engine itself; deleting one would leave a
  // run unable to name its own PF line.
  const { error } = await supabase.from('payroll_components').delete().eq('id', id).eq('is_system', false)
  return fail('deleteComponent', error)
}

// ── Structures ──────────────────────────────────────────────────────────

const STRUCTURE_SELECT = `
  id, code, name, employee_category, version, supersedes_id, status,
  effective_from, effective_to, notes,
  components:payroll_structure_components(
    id, structure_id, component_id, calc_type, value, formula, sequence,
    component:payroll_components(code)
  )
`

export async function fetchStructures(): Promise<StructureRow[]> {
  const { data, error } = await supabase
    .from('payroll_structures').select(STRUCTURE_SELECT)
    .order('code').order('version', { ascending: false })
  if (error) { console.error('fetchStructures failed:', error); return [] }
  return (data ?? []) as unknown as StructureRow[]
}

export async function fetchEngineStructures(): Promise<EngineStructure[]> {
  const rows = await fetchStructures()
  return rows.map(r => toEngineStructure(r, new Map()))
}

export interface StructureInput {
  code: string
  name: string
  employeeCategory: string | null
  effectiveFrom: string
  notes: string | null
  components: { componentId: string; calcType: string | null; value: number | null; formula: string | null; sequence: number }[]
}

/**
 * Create a structure, or fork the next version of an existing one.
 *
 * An active structure is never edited in place. A run that already paid against
 * v1 has to be able to say what v1 contained, and the only way to guarantee that
 * is for v1 to still exist. `supersedes_id` links the chain so the UI can show a
 * version diff.
 */
export async function saveStructureVersion(
  input: StructureInput, supersedesId: string | null, createdBy: string,
): Promise<{ success: boolean; error?: string; id?: string }> {
  const { data: existing } = await supabase
    .from('payroll_structures').select('version').eq('code', input.code)
    .order('version', { ascending: false }).limit(1)
  const version = (existing?.[0]?.version ?? 0) + 1

  const { data: created, error } = await supabase
    .from('payroll_structures')
    .insert({
      code: input.code, name: input.name, employee_category: input.employeeCategory,
      version, supersedes_id: supersedesId, status: 'draft',
      effective_from: input.effectiveFrom, notes: input.notes, created_by: createdBy,
    })
    .select('id').single()
  if (error || !created) { console.error('saveStructureVersion failed:', error); return { success: false, error: error?.message } }

  if (input.components.length > 0) {
    const { error: cErr } = await supabase.from('payroll_structure_components').insert(
      input.components.map(c => ({
        structure_id: created.id, component_id: c.componentId,
        calc_type: c.calcType, value: c.value, formula: c.formula, sequence: c.sequence,
      })),
    )
    if (cErr) { console.error('saveStructureVersion components failed:', cErr); return { success: false, error: cErr.message } }
  }
  return { success: true, id: created.id }
}

/** Publish a draft and close the version it supersedes the day before it starts. */
export async function activateStructure(id: string): Promise<Result> {
  const { data: s } = await supabase
    .from('payroll_structures').select('supersedes_id, effective_from').eq('id', id).single()
  if (!s) return { success: false, error: 'Structure not found' }

  const { error } = await supabase.from('payroll_structures').update({ status: 'active' }).eq('id', id)
  if (error) return fail('activateStructure', error)

  if (s.supersedes_id) {
    const closeOn = new Date(`${s.effective_from}T12:00:00Z`)
    closeOn.setUTCDate(closeOn.getUTCDate() - 1)
    await supabase.from('payroll_structures')
      .update({ status: 'archived', effective_to: closeOn.toISOString().slice(0, 10) })
      .eq('id', s.supersedes_id)
  }
  return { success: true }
}

// ── Assignments ─────────────────────────────────────────────────────────

const ASSIGNMENT_SELECT =
  'id, employee_id, structure_id, effective_from, effective_to, anchor_amount, ' +
  'revision_id, reason, created_at, structure:payroll_structures(name, version, code)'

export async function fetchAssignments(employeeId: string): Promise<AssignmentRow[]> {
  const { data, error } = await supabase
    .from('payroll_employee_structures').select(ASSIGNMENT_SELECT)
    .eq('employee_id', employeeId).order('effective_from', { ascending: false })
  if (error) { console.error('fetchAssignments failed:', error); return [] }
  return (data ?? []) as unknown as AssignmentRow[]
}

export async function fetchAllAssignments(): Promise<AssignmentRow[]> {
  const { data, error } = await supabase
    .from('payroll_employee_structures').select(ASSIGNMENT_SELECT)
    .order('effective_from', { ascending: false })
  if (error) { console.error('fetchAllAssignments failed:', error); return [] }
  return (data ?? []) as unknown as AssignmentRow[]
}

/**
 * Assign a structure from a date. Append-only: the open assignment is closed the
 * day before rather than edited, so the employee's salary history stays complete
 * and the database's non-overlap constraint is satisfied.
 */
export async function assignStructure(input: {
  employeeId: string; structureId: string; effectiveFrom: string
  anchorAmount: number; reason: string | null; revisionId?: string | null; createdBy: string
}): Promise<Result> {
  const closeOn = new Date(`${input.effectiveFrom}T12:00:00Z`)
  closeOn.setUTCDate(closeOn.getUTCDate() - 1)
  const closeDate = closeOn.toISOString().slice(0, 10)

  const { error: closeErr } = await supabase
    .from('payroll_employee_structures')
    .update({ effective_to: closeDate })
    .eq('employee_id', input.employeeId)
    .is('effective_to', null)
    .lt('effective_from', input.effectiveFrom)
  if (closeErr) return fail('assignStructure (closing previous)', closeErr)

  const { error } = await supabase.from('payroll_employee_structures').insert({
    employee_id: input.employeeId, structure_id: input.structureId,
    effective_from: input.effectiveFrom, anchor_amount: input.anchorAmount,
    reason: input.reason, revision_id: input.revisionId ?? null, created_by: input.createdBy,
  })
  return fail('assignStructure', error)
}

export async function fetchOverrides(employeeId: string): Promise<OverrideRow[]> {
  const { data, error } = await supabase
    .from('payroll_employee_overrides')
    .select('id, employee_id, component_id, calc_type, value, formula, effective_from, effective_to, reason, component:payroll_components(code)')
    .eq('employee_id', employeeId).order('effective_from', { ascending: false })
  if (error) { console.error('fetchOverrides failed:', error); return [] }
  return (data ?? []) as unknown as OverrideRow[]
}

// ── Revisions ───────────────────────────────────────────────────────────

export interface RevisionInput {
  label: string
  kind: 'individual' | 'bulk_increment' | 'promotion'
  basis: 'percent' | 'amount' | 'new_structure'
  value: number | null
  targetStructureId: string | null
  effectiveFrom: string
  arrearsFrom: string | null
  scope: Record<string, unknown>
  reason: string | null
}

export async function createRevision(input: RevisionInput, createdBy: string): Promise<{ success: boolean; error?: string; id?: string }> {
  const { data, error } = await supabase.from('payroll_revisions').insert({
    label: input.label, kind: input.kind, basis: input.basis, value: input.value,
    target_structure_id: input.targetStructureId, effective_from: input.effectiveFrom,
    arrears_from: input.arrearsFrom, scope: input.scope, reason: input.reason,
    status: 'draft', created_by: createdBy,
  }).select('id').single()
  if (error || !data) { console.error('createRevision failed:', error); return { success: false, error: error?.message } }
  return { success: true, id: data.id }
}

export async function fetchRevisions() {
  const { data, error } = await supabase
    .from('payroll_revisions')
    .select('id, label, kind, basis, value, effective_from, arrears_from, status, reason, applied_at, created_at')
    .order('effective_from', { ascending: false })
  if (error) { console.error('fetchRevisions failed:', error); return [] }
  return data ?? []
}

/** What a revision would do to each person, before anybody commits to it. */
export interface IncrementPreviewRow {
  employeeId: string
  employeeName: string
  currentAnchor: number
  newAnchor: number
  delta: number
  structureName: string
}

export function previewIncrement(
  assignments: AssignmentRow[],
  names: Record<string, string>,
  basis: 'percent' | 'amount',
  value: number,
): IncrementPreviewRow[] {
  const latest = new Map<string, AssignmentRow>()
  for (const a of assignments) {
    if (a.effective_to !== null) continue
    if (!latest.has(a.employee_id)) latest.set(a.employee_id, a)
  }
  return [...latest.values()].map(a => {
    const current = Number(a.anchor_amount) || 0
    const newAnchor = basis === 'percent'
      ? Math.round(current * (1 + value / 100))
      : Math.round(current + value)
    return {
      employeeId: a.employee_id,
      employeeName: names[a.employee_id] ?? a.employee_id,
      currentAnchor: current,
      newAnchor,
      delta: newAnchor - current,
      structureName: a.structure ? `${a.structure.name} v${a.structure.version}` : '—',
    }
  }).sort((x, y) => y.delta - x.delta)
}

/** Apply a revision: one new assignment per employee, previous ones closed. */
export async function applyRevision(
  revisionId: string, rows: IncrementPreviewRow[], effectiveFrom: string,
  structureByEmployee: Record<string, string>, createdBy: string,
): Promise<Result> {
  for (const r of rows) {
    const structureId = structureByEmployee[r.employeeId]
    if (!structureId) continue
    const res = await assignStructure({
      employeeId: r.employeeId, structureId, effectiveFrom,
      anchorAmount: r.newAnchor, reason: 'Salary revision', revisionId, createdBy,
    })
    if (!res.success) return res
  }
  const { error } = await supabase
    .from('payroll_revisions')
    .update({ status: 'applied', applied_at: new Date().toISOString(), approved_by: createdBy })
    .eq('id', revisionId)
  return fail('applyRevision', error)
}

// ── Policy groups ───────────────────────────────────────────────────────

const POLICY_SELECT =
  'id, name, is_default, priority, effective_from, effective_to, match, policy, notes, ' +
  'members:payroll_policy_group_members(employee_id)'

export async function fetchPolicyGroups(): Promise<PolicyGroup[]> {
  const { data, error } = await supabase
    .from('payroll_policy_groups').select(POLICY_SELECT)
    .order('is_default').order('priority', { ascending: false })
  if (error) { console.error('fetchPolicyGroups failed:', error); return [] }
  return ((data ?? []) as unknown as PolicyGroupRow[]).map(toPolicyGroup)
}

export async function savePolicyGroup(g: Partial<PolicyGroupRow> & { name: string; policy: unknown }): Promise<{ success: boolean; error?: string; id?: string }> {
  const { members, ...row } = g as PolicyGroupRow
  const { data, error } = await supabase.from('payroll_policy_groups').upsert(row).select('id').single()
  if (error || !data) { console.error('savePolicyGroup failed:', error); return { success: false, error: error?.message } }
  return { success: true, id: data.id }
}

/** Replace a group's membership wholesale — simpler to reason about than diffing. */
export async function setPolicyGroupMembers(groupId: string, employeeIds: string[]): Promise<Result> {
  const { error: delErr } = await supabase.from('payroll_policy_group_members').delete().eq('group_id', groupId)
  if (delErr) return fail('setPolicyGroupMembers (clear)', delErr)
  if (employeeIds.length === 0) return { success: true }
  const { error } = await supabase.from('payroll_policy_group_members')
    .insert(employeeIds.map(employee_id => ({ group_id: groupId, employee_id })))
  return fail('setPolicyGroupMembers', error)
}

export async function deletePolicyGroup(id: string): Promise<Result> {
  const { error } = await supabase.from('payroll_policy_groups').delete().eq('id', id).eq('is_default', false)
  return fail('deletePolicyGroup', error)
}

// ── Calendars ───────────────────────────────────────────────────────────

const CALENDAR_SELECT =
  'id, name, is_default, priority, effective_from, effective_to, match, basis, fixed_days, ' +
  'week_pattern, nth_weekday_rules, members:payroll_calendar_members(employee_id)'

export async function fetchCalendars(): Promise<WorkingCalendar[]> {
  const { data, error } = await supabase
    .from('payroll_calendars').select(CALENDAR_SELECT)
    .order('is_default').order('priority', { ascending: false })
  if (error) { console.error('fetchCalendars failed:', error); return [] }
  return ((data ?? []) as unknown as CalendarRow[]).map(toWorkingCalendar)
}

export async function saveCalendar(c: Partial<CalendarRow> & { name: string }): Promise<{ success: boolean; error?: string; id?: string }> {
  const { members, ...row } = c as CalendarRow
  const { data, error } = await supabase.from('payroll_calendars').upsert(row).select('id').single()
  if (error || !data) { console.error('saveCalendar failed:', error); return { success: false, error: error?.message } }
  return { success: true, id: data.id }
}

export async function setCalendarMembers(calendarId: string, employeeIds: string[]): Promise<Result> {
  const { error: delErr } = await supabase.from('payroll_calendar_members').delete().eq('calendar_id', calendarId)
  if (delErr) return fail('setCalendarMembers (clear)', delErr)
  if (employeeIds.length === 0) return { success: true }
  const { error } = await supabase.from('payroll_calendar_members')
    .insert(employeeIds.map(employee_id => ({ calendar_id: calendarId, employee_id })))
  return fail('setCalendarMembers', error)
}

// ── Statutory rule sets ─────────────────────────────────────────────────

const RULE_SELECT =
  'id, domain, jurisdiction, version, effective_from, effective_to, rules, source_note, status, published_at'

export async function fetchRuleSets(includeDrafts = true): Promise<RuleSetRow[]> {
  let q = supabase.from('payroll_rule_sets').select(RULE_SELECT)
  if (!includeDrafts) q = q.eq('status', 'published')
  const { data, error } = await q.order('domain').order('effective_from', { ascending: false })
  if (error) { console.error('fetchRuleSets failed:', error); return [] }
  return (data ?? []) as RuleSetRow[]
}

/** The set in force for a domain on a date, preferring the state-specific one. */
export function ruleSetInForce(rows: RuleSetRow[], domain: string, jurisdiction: string, onDate: string): RuleSet | null {
  const candidates = rows.filter(r =>
    r.domain === domain && r.status === 'published' &&
    r.effective_from <= onDate && (r.effective_to === null || r.effective_to >= onDate) &&
    (r.jurisdiction === jurisdiction || r.jurisdiction === 'IN'),
  ).sort((a, b) =>
    (b.jurisdiction === jurisdiction ? 1 : 0) - (a.jurisdiction === jurisdiction ? 1 : 0) ||
    b.effective_from.localeCompare(a.effective_from),
  )
  return candidates[0] ? toRuleSet(candidates[0]) : null
}

/**
 * Publishing a new version closes the one it replaces the day before it starts.
 * The range-overlap exclusion constraint would reject the insert otherwise,
 * which is the database refusing to let two rates claim the same day.
 */
export async function publishRuleSet(id: string): Promise<Result> {
  const { data: rs } = await supabase
    .from('payroll_rule_sets').select('domain, jurisdiction, effective_from').eq('id', id).single()
  if (!rs) return { success: false, error: 'Rule set not found' }

  const closeOn = new Date(`${rs.effective_from}T12:00:00Z`)
  closeOn.setUTCDate(closeOn.getUTCDate() - 1)

  const { error: closeErr } = await supabase
    .from('payroll_rule_sets')
    .update({ effective_to: closeOn.toISOString().slice(0, 10), status: 'superseded' })
    .eq('domain', rs.domain).eq('jurisdiction', rs.jurisdiction)
    .eq('status', 'published').is('effective_to', null)
  if (closeErr) return fail('publishRuleSet (closing previous)', closeErr)

  const { error } = await supabase.from('payroll_rule_sets')
    .update({ status: 'published', published_at: new Date().toISOString() }).eq('id', id)
  return fail('publishRuleSet', error)
}

export async function createRuleSetDraft(
  domain: string, jurisdiction: string, effectiveFrom: string, rules: unknown, sourceNote: string, createdBy: string,
): Promise<{ success: boolean; error?: string; id?: string }> {
  const { data: existing } = await supabase
    .from('payroll_rule_sets').select('version').eq('domain', domain).eq('jurisdiction', jurisdiction)
    .order('version', { ascending: false }).limit(1)
  const version = (existing?.[0]?.version ?? 0) + 1

  const { data, error } = await supabase.from('payroll_rule_sets').insert({
    domain, jurisdiction, version, effective_from: effectiveFrom,
    rules, source_note: sourceNote, status: 'draft', created_by: createdBy,
  }).select('id').single()
  if (error || !data) { console.error('createRuleSetDraft failed:', error); return { success: false, error: error?.message } }
  return { success: true, id: data.id }
}

// ── Employee statutory identity ─────────────────────────────────────────

export async function fetchStatutoryRows(): Promise<Record<string, StatutoryRow>> {
  const { data, error } = await supabase.from('payroll_employee_statutory').select('*')
  if (error) { console.error('fetchStatutoryRows failed:', error); return {} }
  const out: Record<string, StatutoryRow> = {}
  for (const r of (data ?? []) as StatutoryRow[]) out[r.employee_id] = r
  return out
}

export async function upsertStatutory(row: Partial<StatutoryRow> & { employee_id: string }): Promise<Result> {
  const { error } = await supabase.from('payroll_employee_statutory').upsert(row, { onConflict: 'employee_id' })
  return fail('upsertStatutory', error)
}
