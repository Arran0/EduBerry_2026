import { supabase } from './supabase'
import {
  PAYROLL_ITEM_LABELS, fetchPayrollCalibration, computeBonusAmounts,
} from './payroll'
import {
  fetchBaseSalaries, fetchEligibleStaff, fetchHiddenSalaryMemberIds, fetchMonthlyBonusPoints,
} from './salary'
import { fetchDriverBaseSalaries, fetchEligibleDrivers } from './driverSalary'

// ============================================
// Month-scoped payroll stats for the Salary Manager dashboard
// ============================================
//
// The admin hub's headline figures are read per calendar month rather than
// "everything ever", because that is how payroll is actually worked: in the
// first days of a month the office is processing *last* month's run, and the
// question is always "what did this month cost, and how does it compare with
// the one before it".
//
// Figures come from the month's own pay-cycle records where a cycle exists
// (actuals), and are otherwise projected from the active base salaries plus
// the bonus points earned so far — which is the only honest thing to show for
// a month whose payroll has not been run yet.

export interface MonthlyPayrollStats {
  year: number
  month: number
  /** A pay cycle exists for this month — every figure below is an actual. */
  actual: boolean
  /** No cycle yet; figures are estimated from base salaries and live bonus points. */
  projected: boolean
  /** People included in the month (records in the cycle, or actives on payroll). */
  headcount: number
  /** Total cost of the month: base salaries plus every earning added on top. */
  gross: number
  /** The task-manager bonus slice of `gross`. */
  bonus: number
  /** Everything withheld: PF + ESI + loss of pay + any manual deduction. */
  deductions: number
  pf: number
  esi: number
  lop: number
  /** What actually reaches people's accounts: gross − deductions. */
  net: number
  paidCount: number
  totalCount: number
  /** Net still to be disbursed (records not yet marked paid). */
  pendingAmount: number
}

function emptyStats(year: number, month: number): MonthlyPayrollStats {
  return {
    year, month, actual: false, projected: false, headcount: 0,
    gross: 0, bonus: 0, deductions: 0, pf: 0, esi: 0, lop: 0, net: 0,
    paidCount: 0, totalCount: 0, pendingAmount: 0,
  }
}

/** The prefix the older "apply this recommendation" flow wrote bonus rows under. */
const LEGACY_BONUS_PREFIX = 'Task bonus'
/** …and its deduction counterpart, which is loss-of-pay money under another name. */
const LEGACY_LOP_PREFIX = 'Absence penalty'

/**
 * The month payroll is most likely being worked on right now.
 *
 * Salaries are processed in the first days of the following month, so for the
 * first `PROCESSING_WINDOW_DAYS` of a month the previous month is what the
 * office is actually looking at — opening on the month in progress would show
 * a half-formed cycle nobody has asked about yet.
 */
export const PROCESSING_WINDOW_DAYS = 10

export function defaultPayrollMonth(today: Date = new Date()): { year: number; month: number } {
  const inProcessingWindow = today.getDate() <= PROCESSING_WINDOW_DAYS
  const d = new Date(today.getFullYear(), today.getMonth() - (inProcessingWindow ? 1 : 0), 1)
  return { year: d.getFullYear(), month: d.getMonth() + 1 }
}

/** Step a {year, month} pair by whole months, staying 1-based. */
export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const d = new Date(year, month - 1 + delta, 1)
  return { year: d.getFullYear(), month: d.getMonth() + 1 }
}

/** Sort key for comparing two periods (higher = later). */
export function monthIndex(year: number, month: number): number {
  return year * 12 + (month - 1)
}

// ============================================
// Actuals — from the month's own cycle records
// ============================================

/** The only shape the tally needs — staff and driver records both satisfy it. */
export interface PayrollRecordLike {
  base_amount: number | string
  status: string
  items: { label: string; amount: number | string }[] | null
}

async function fetchCycleIds(table: string, year: number, month: number): Promise<string[]> {
  const { data, error } = await supabase
    .from(table).select('id').eq('period_year', year).eq('period_month', month)
  if (error) { console.error(`fetchCycleIds(${table}) failed:`, error); return [] }
  return ((data ?? []) as { id: string }[]).map(c => c.id)
}

// The select strings are spelled out per table rather than built from the
// table name: supabase-js parses the column list at the type level, and it can
// only do that for a string literal.
async function fetchStaffRecords(cycleIds: string[]): Promise<PayrollRecordLike[]> {
  if (cycleIds.length === 0) return []
  const { data, error } = await supabase
    .from('salary_records')
    .select('base_amount, status, items:salary_record_items(label, amount)')
    .in('cycle_id', cycleIds)
  if (error) { console.error('fetchStaffRecords failed:', error); return [] }
  return (data ?? []) as unknown as PayrollRecordLike[]
}

async function fetchDriverRecords(cycleIds: string[]): Promise<PayrollRecordLike[]> {
  if (cycleIds.length === 0) return []
  const { data, error } = await supabase
    .from('driver_payroll_records')
    .select('base_amount, status, items:driver_payroll_record_items(label, amount)')
    .in('cycle_id', cycleIds)
  if (error) { console.error('fetchDriverRecords failed:', error); return [] }
  return (data ?? []) as unknown as PayrollRecordLike[]
}

/**
 * Roll a month's pay-cycle records up into the dashboard figures.
 *
 * Exported because it is the whole definition of what "payroll cost", "net
 * pay" and "deductions" mean on this page, and that is worth pinning down in a
 * test rather than leaving buried behind a network call.
 */
export function tallyPayrollRecords(
  rows: PayrollRecordLike[], year: number, month: number,
): MonthlyPayrollStats {
  const s = emptyStats(year, month)
  s.actual = true
  for (const r of rows) {
    const base = Number(r.base_amount) || 0
    let recordNet = base
    s.gross += base
    for (const item of r.items ?? []) {
      const amount = Number(item.amount) || 0
      recordNet += amount
      const label = item.label ?? ''
      if (amount >= 0) {
        s.gross += amount
        if (label === PAYROLL_ITEM_LABELS.bonus || label.startsWith(LEGACY_BONUS_PREFIX)) s.bonus += amount
        continue
      }
      const withheld = -amount
      s.deductions += withheld
      if (label === PAYROLL_ITEM_LABELS.pf) s.pf += withheld
      else if (label === PAYROLL_ITEM_LABELS.esi) s.esi += withheld
      else if (label.startsWith('LOP') || label.startsWith(LEGACY_LOP_PREFIX)) s.lop += withheld
    }
    s.net += recordNet
    s.totalCount += 1
    if (r.status === 'paid') s.paidCount += 1
    else s.pendingAmount += Math.max(0, recordNet)
  }
  s.headcount = s.totalCount
  return s
}

// ============================================
// Projection — for a month whose cycle has not been run yet
// ============================================

async function project(year: number, month: number): Promise<MonthlyPayrollStats> {
  const [bases, staff, driverBases, allDrivers, hiddenIds, calibration] = await Promise.all([
    fetchBaseSalaries(), fetchEligibleStaff(),
    fetchDriverBaseSalaries(), fetchEligibleDrivers(),
    fetchHiddenSalaryMemberIds(), fetchPayrollCalibration(),
  ])
  const hidden = new Set(hiddenIds)
  const staffIds = new Set(staff.map(p => p.id))
  const driverIds = new Set(allDrivers.filter(d => !hidden.has(d.id) && !d.is_banned).map(d => d.id))

  // Scoped to who is actually on payroll right now — a base-salary row left
  // behind by a role change would otherwise inflate the whole projection.
  const active = [
    ...bases.filter(b => b.active && staffIds.has(b.staff_id)).map(b => ({ id: b.staff_id, b })),
    ...driverBases.filter(b => b.active && driverIds.has(b.driver_id)).map(b => ({ id: b.driver_id, b })),
  ]

  const s = emptyStats(year, month)
  s.projected = true
  s.headcount = active.length
  if (active.length === 0) return s

  const points = await fetchMonthlyBonusPoints(active.map(a => a.id), year, month)
  const bonusAmounts = computeBonusAmounts(points, calibration.bonus)

  for (const { id, b } of active) {
    const base = Number(b.base_amount) || 0
    const bonus = bonusAmounts[id] ?? 0
    s.gross += base + bonus
    s.bonus += bonus
    if (b.pf_applicable) s.pf += Math.round((Number(b.pf_basic) || 0) * calibration.pf.rate)
    const esiApplies = b.esi_override ?? (base > 0 && base <= calibration.esi.wage_ceiling)
    if (esiApplies) s.esi += Math.ceil(base * calibration.esi.rate)
  }
  // Loss of pay is only knowable once the month's attendance is adjudicated in
  // the cycle, so a projection deliberately leaves it out rather than guessing.
  s.deductions = s.pf + s.esi
  s.net = s.gross - s.deductions
  s.pendingAmount = s.net
  return s
}

// ============================================
// Public entry point
// ============================================

/**
 * Payroll figures for one calendar month, across staff and bus drivers.
 *
 * A month with a cycle reports actuals. A month still ahead of (or level with)
 * today reports a projection from the active base salaries. A past month with
 * no cycle reports nothing — projecting today's salaries backwards onto a
 * payroll that was never run would invent a number.
 */
export async function fetchMonthlyPayrollStats(year: number, month: number): Promise<MonthlyPayrollStats> {
  const [staffCycleIds, driverCycleIds] = await Promise.all([
    fetchCycleIds('salary_cycles', year, month),
    fetchCycleIds('driver_payroll_cycles', year, month),
  ])

  const [staffRows, driverRows] = await Promise.all([
    fetchStaffRecords(staffCycleIds),
    fetchDriverRecords(driverCycleIds),
  ])

  const rows = [...staffRows, ...driverRows]
  if (rows.length > 0) return tallyPayrollRecords(rows, year, month)

  const now = new Date()
  const isFuture = monthIndex(year, month) >= monthIndex(now.getFullYear(), now.getMonth() + 1)
  return isFuture ? project(year, month) : emptyStats(year, month)
}

/**
 * Percentage change from `previous` to `current`, or null when a comparison
 * would be meaningless — no earlier figure to compare against, or the two
 * months are not measured the same way (an actual against a projection).
 */
export function percentChange(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null
  if (previous <= 0) return null
  return ((current - previous) / previous) * 100
}

/** True when the two months can be compared like for like. */
export function comparable(a: MonthlyPayrollStats, b: MonthlyPayrollStats): boolean {
  return (a.actual || a.projected) && b.actual && b.totalCount > 0
}
