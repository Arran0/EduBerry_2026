// ============================================================================
// Payroll runs — data layer.
// ----------------------------------------------------------------------------
// Reads for the run screens, and thin wrappers over the API routes for anything
// that changes a run's state. State changes deliberately do NOT go straight to
// Supabase from the browser: the transition guards, the rule pinning and the
// lock hash all have to happen server-side, where they cannot be skipped by
// anyone with a console open.
// ============================================================================

import { supabase } from '@/lib/supabase'
import type { RunRow, RunLineRow, ExceptionRow, RunEventRow, LineComponentRow } from './rows'
import type { RunStatus } from './engine/workflow'
import type { VarianceResult, VarianceLineInput } from './engine/variance'
import { computeVariance } from './engine/variance'

const RUN_COLUMNS =
  'id, period_month, period_year, period_from, period_to, pay_date, run_type, status, label, notes, ' +
  'rule_set_ids, variance_acknowledged_by, variance_acknowledged_at, calculated_at, ' +
  'approved_by, approved_at, locked_by, locked_at, locked_hash, created_at'

const LINE_SELECT = `
  id, run_id, employee_id, structure_id, policy_group_id, calendar_id,
  gross_earnings, total_deductions, employer_contributions, employer_cost, net_pay,
  payable_days, paid_days, lop_days, inputs, trace, payout_status, payout_reference,
  employee:profiles!payroll_run_lines_employee_id_fkey(id, full_name, role, avatar_url),
  components:payroll_line_components(
    id, line_id, run_id, component_code, name, kind, amount, full_amount, sequence, computed_from
  )
`

export async function fetchRuns(): Promise<RunRow[]> {
  const { data, error } = await supabase
    .from('payroll_runs').select(RUN_COLUMNS)
    .order('period_year', { ascending: false }).order('period_month', { ascending: false })
  if (error) { console.error('fetchRuns failed:', error); return [] }
  return (data ?? []) as unknown as RunRow[]
}

export async function fetchRun(runId: string): Promise<RunRow | null> {
  const { data, error } = await supabase.from('payroll_runs').select(RUN_COLUMNS).eq('id', runId).maybeSingle()
  if (error) { console.error('fetchRun failed:', error); return null }
  return (data ?? null) as unknown as RunRow | null
}

export async function fetchRunLines(runId: string): Promise<RunLineRow[]> {
  const { data, error } = await supabase.from('payroll_run_lines').select(LINE_SELECT).eq('run_id', runId)
  if (error) { console.error('fetchRunLines failed:', error); return [] }
  const rows = (data ?? []) as unknown as RunLineRow[]
  // Sort by name here rather than in the query: the join makes an ordered
  // fetch awkward, and a run is at most a few hundred rows.
  return rows.sort((a, b) => (a.employee?.full_name ?? '').localeCompare(b.employee?.full_name ?? ''))
}

export async function fetchExceptions(runId: string): Promise<ExceptionRow[]> {
  const { data, error } = await supabase
    .from('payroll_exceptions')
    .select('id, run_id, employee_id, severity, code, message, details, resolved_at, resolved_by, resolution_note, created_at, employee:profiles(full_name)')
    .eq('run_id', runId)
    .order('severity').order('code')
  if (error) { console.error('fetchExceptions failed:', error); return [] }
  return (data ?? []) as unknown as ExceptionRow[]
}

export async function fetchRunEvents(runId: string): Promise<RunEventRow[]> {
  const { data, error } = await supabase
    .from('payroll_run_events')
    .select('id, run_id, from_status, to_status, actor_id, note, created_at, actor:profiles(full_name)')
    .eq('run_id', runId).order('created_at')
  if (error) { console.error('fetchRunEvents failed:', error); return [] }
  return (data ?? []) as unknown as RunEventRow[]
}

export async function resolveException(id: string, note: string, actorId: string): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase.from('payroll_exceptions')
    .update({ resolved_at: new Date().toISOString(), resolved_by: actorId, resolution_note: note })
    .eq('id', id)
  if (error) { console.error('resolveException failed:', error); return { success: false, error: error.message } }
  return { success: true }
}

export async function acknowledgeVariance(runId: string, actorId: string): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase.from('payroll_runs')
    .update({ variance_acknowledged_by: actorId, variance_acknowledged_at: new Date().toISOString() })
    .eq('id', runId)
  if (error) { console.error('acknowledgeVariance failed:', error); return { success: false, error: error.message } }
  return { success: true }
}

// ── API wrappers ────────────────────────────────────────────────────────

async function authHeaders(): Promise<HeadersInit> {
  const { data } = await supabase.auth.getSession()
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${data.session?.access_token ?? ''}`,
  }
}

async function post<T>(url: string, body: unknown): Promise<T & { success: boolean; error?: string }> {
  try {
    const res = await fetch(url, { method: 'POST', headers: await authHeaders(), body: JSON.stringify(body) })
    return await res.json()
  } catch (e) {
    return { success: false, error: (e as Error).message } as T & { success: boolean; error?: string }
  }
}

export function createRun(input: {
  periodMonth: number; periodYear: number; runType?: string; label?: string
  employeeIds?: string[]
}) {
  return post<{ runId?: string; lineCount?: number }>('/api/payroll/runs', input)
}

export function calculateRun(runId: string) {
  return post<{
    lineCount?: number; exceptions?: number; blocking?: number
    failures?: number; totalNet?: number; status?: RunStatus
  }>(`/api/payroll/runs/${runId}/calculate`, {})
}

export function transitionRun(runId: string, to: RunStatus, note?: string) {
  return post<{ status?: RunStatus }>(`/api/payroll/runs/${runId}/transition`, { to, note })
}

export function simulate(input: {
  periodMonth: number; periodYear: number
  scope: Record<string, unknown>
  change: { kind: 'percent' | 'amount'; component: string; value: number }
}) {
  return post<{ result?: SimulationResult }>('/api/payroll/simulate', input)
}

export interface SimulationResult {
  employeeCount: number
  baseTotalNet: number
  newTotalNet: number
  netDelta: number
  employerCostDelta: number
  pfDelta: number
  esiDelta: number
  tdsDelta: number
  annualisedDelta: number
  perEmployee: { employeeId: string; name: string; before: number; after: number; delta: number }[]
}

// ── Variance ────────────────────────────────────────────────────────────

function toVarianceInput(lines: RunLineRow[]): VarianceLineInput[] {
  return lines.map(l => {
    const componentTotals: Record<string, number> = {}
    for (const c of l.components ?? []) {
      componentTotals[c.component_code] = (componentTotals[c.component_code] ?? 0) + Number(c.amount)
    }
    return {
      employeeId: l.employee_id,
      employeeName: l.employee?.full_name ?? l.employee_id,
      netPay: Number(l.net_pay),
      grossEarnings: Number(l.gross_earnings),
      lopDays: Number(l.lop_days),
      structureId: l.structure_id,
      componentTotals,
    }
  })
}

/**
 * Compare this run with the previous regular run of the same type. Runs on the
 * client because it is a pure diff of data already fetched — pushing it to the
 * server would only add a round trip.
 */
export async function fetchVariance(run: RunRow, currentLines: RunLineRow[], thresholdPercent = 15): Promise<VarianceResult | null> {
  const { data: prev } = await supabase
    .from('payroll_runs').select('id')
    .eq('run_type', run.run_type)
    .or(`period_year.lt.${run.period_year},and(period_year.eq.${run.period_year},period_month.lt.${run.period_month})`)
    .order('period_year', { ascending: false }).order('period_month', { ascending: false })
    .limit(1)
  const previousId = prev?.[0]?.id
  if (!previousId) return null

  const previousLines = await fetchRunLines(previousId)
  return computeVariance(toVarianceInput(previousLines), toVarianceInput(currentLines), thresholdPercent)
}

// ── Payslip helpers ─────────────────────────────────────────────────────

export function splitComponents(components: LineComponentRow[]) {
  const sorted = [...components].sort((a, b) => a.sequence - b.sequence)
  return {
    earnings: sorted.filter(c => c.kind === 'earning'),
    deductions: sorted.filter(c => c.kind === 'deduction'),
    employer: sorted.filter(c => c.kind === 'employer_contribution'),
    informational: sorted.filter(c => c.kind === 'informational'),
  }
}

export function runPeriodLabel(run: Pick<RunRow, 'period_month' | 'period_year'>): string {
  return new Date(run.period_year, run.period_month - 1, 1)
    .toLocaleString('en-IN', { month: 'long', year: 'numeric' })
}

export interface RunTotals {
  lineCount: number
  gross: number
  deductions: number
  net: number
  employerCost: number
  paidCount: number
}

export function runTotals(lines: RunLineRow[]): RunTotals {
  return {
    lineCount: lines.length,
    gross: lines.reduce((s, l) => s + Number(l.gross_earnings), 0),
    deductions: lines.reduce((s, l) => s + Number(l.total_deductions), 0),
    net: lines.reduce((s, l) => s + Number(l.net_pay), 0),
    employerCost: lines.reduce((s, l) => s + Number(l.employer_cost), 0),
    paidCount: lines.filter(l => l.payout_status === 'processed').length,
  }
}
