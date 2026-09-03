import { supabase } from './supabase'
import {
  PayrollCalibration, DEFAULT_PAYROLL_CALIBRATION, mergeCalibration, fetchPayrollCalibration,
  computeStaffAttendanceStats, computePayrollRow, computeBonusAmounts, daysInMonth,
  PAYROLL_ITEM_LABELS, isAutoPayrollLabel,
} from './payroll'
import {
  fetchMonthlyAttendanceRecords, fetchHolidays, fetchNonWorkingDays, fetchAttendanceTimingDeltas,
  Holiday, NonWorkingDay, StaffAttendanceRecord, AttendanceTimingDelta,
} from './attendance'
import {
  SalaryRecord, SalaryStatus, StaffSalaryBase,
  fetchBaseSalaries, fetchEligibleStaff, fetchHiddenSalaryMemberIds, fetchMonthlyBonusPoints,
} from './salary'
import { DriverSalaryBase, fetchDriverBaseSalaries, fetchEligibleDrivers } from './driverSalary'
import {
  SupportStaffSalaryBase, fetchSupportStaffSalaryBases, fetchSupportStaff,
  fetchSupportAttendanceRange, supportRecordToStaffShape,
} from './supportStaff'

// ============================================
// Month-scoped payroll figures for the Salary Manager dashboard
// ============================================
//
// These have to be the *same* numbers the pay-cycle page shows, or the
// dashboard is worse than no dashboard. That is not a matter of summing the
// stored line items: while a cycle is open there are no stored items at all —
// PF, ESI, loss of pay and the task bonus are computed live from attendance
// and only snapshotted onto the records when the cycle is locked. Reading the
// items alone reports a month with zero deductions and a net equal to the
// gross, which is what this module previously did.
//
// So the rule is exactly the one src/app/more/salary/manage/[cycleId] applies
// per row, lifted here so both surfaces answer the same way:
//
//   • locked cycle → the stored items are the truth
//   • open cycle   → PF/ESI/LOP/bonus computed live; any auto-labelled items
//                    left behind by an interrupted close are ignored so they
//                    cannot double up; hand-added items always count
//
// A month with no cycle at all is projected from the active base salaries,
// and says so.

export interface MonthlyPayrollStats {
  year: number
  month: number
  /** A pay cycle exists for this month — every figure below is an actual. */
  actual: boolean
  /** No cycle yet; figures are estimated from base salaries and live bonus points. */
  projected: boolean
  /** Every cycle covering this month is locked, so the figures can no longer move. */
  locked: boolean
  /** People being paid this month. */
  headcount: number
  /** Total cost of the month: earned base plus every earning added on top. */
  gross: number
  /** The task-bonus slice of `gross`. */
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
    year, month, actual: false, projected: false, locked: false, headcount: 0,
    gross: 0, bonus: 0, deductions: 0, pf: 0, esi: 0, lop: 0, net: 0,
    paidCount: 0, totalCount: 0, pendingAmount: 0,
  }
}

/** The prefix the older "apply this recommendation" flow wrote bonus rows under. */
const LEGACY_BONUS_PREFIX = 'Task bonus'

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
// One record's figures
// ============================================

/** The record shape the aggregation needs, from either the staff or the driver table. */
export interface CycleRecordLike {
  id: string
  person_id: string
  base_amount: number | string
  status: string
  working_days_override: number | null
  leave_override: number | null
  late_override: number | null
  half_day_override: number | null
  pf_amount_override: number | null
  esi_amount_override: number | null
  items: { label: string; amount: number | string }[] | null
}

/** What the live payroll engine says a record costs, before any stored item is read. */
export interface LiveFigures {
  pf: number
  esi: number
  lop: number
  bonus: number
}

export interface RecordFigures {
  /** Base + every earning on top (bonus, manual additions). */
  gross: number
  bonus: number
  deductions: number
  pf: number
  esi: number
  lop: number
  net: number
  /** This person is actually being paid — a ₹0 placeholder record is not. */
  onPayroll: boolean
}

/**
 * One record's contribution to the month, under the open/locked rule above.
 *
 * `live` is what the payroll engine computed for this record; it is ignored
 * for a locked cycle, where the stored items already say what was withheld.
 */
export function recordFigures(
  record: CycleRecordLike,
  locked: boolean,
  live: LiveFigures | null,
): RecordFigures {
  const base = Number(record.base_amount) || 0
  const stored = (record.items ?? []).map(i => ({ label: i.label ?? '', amount: Number(i.amount) || 0 }))

  if (locked) {
    let gross = base, bonus = 0, deductions = 0, pf = 0, esi = 0, lop = 0
    for (const { label, amount } of stored) {
      if (amount >= 0) {
        gross += amount
        if (label === PAYROLL_ITEM_LABELS.bonus || label.startsWith(LEGACY_BONUS_PREFIX)) bonus += amount
        continue
      }
      const withheld = -amount
      deductions += withheld
      if (label === PAYROLL_ITEM_LABELS.pf) pf += withheld
      else if (label === PAYROLL_ITEM_LABELS.esi) esi += withheld
      else if (label.startsWith('LOP') || label.startsWith('Absence penalty')) lop += withheld
    }
    return { gross, bonus, deductions, pf, esi, lop, net: gross - deductions, onPayroll: base > 0 || gross > 0 }
  }

  // Open: the auto-generated rows are a preview, computed fresh every time the
  // page loads. Only what a person typed in by hand survives from the database.
  const manual = stored.filter(i => !isAutoPayrollLabel(i.label))
  const pf = live?.pf ?? 0
  const esi = live?.esi ?? 0
  const lop = live?.lop ?? 0
  const bonus = live?.bonus ?? 0

  let gross = base + bonus
  let deductions = pf + esi + lop
  for (const { amount } of manual) {
    if (amount >= 0) gross += amount
    else deductions += -amount
  }
  return { gross, bonus, deductions, pf, esi, lop, net: gross - deductions, onPayroll: base > 0 || gross > 0 }
}

/** One cycle's records, plus whether it is locked and what the engine said about each row. */
export interface CycleGroup {
  locked: boolean
  records: CycleRecordLike[]
  live: Record<string, LiveFigures>
}

/** Roll every cycle covering a month into the dashboard's figures. */
export function aggregateMonth(
  year: number, month: number, groups: CycleGroup[],
): MonthlyPayrollStats {
  const s = emptyStats(year, month)
  s.actual = true
  s.locked = groups.length > 0 && groups.every(g => g.locked)
  for (const group of groups) {
    for (const record of group.records) {
      const f = recordFigures(record, group.locked, group.live[record.id] ?? null)
      s.gross += f.gross
      s.bonus += f.bonus
      s.deductions += f.deductions
      s.pf += f.pf
      s.esi += f.esi
      s.lop += f.lop
      s.net += f.net
      // A generated record for someone with no base salary set is a
      // placeholder, not a person being paid — counting it would put "0/95"
      // on the disbursement card for a month that only ever pays 80 people.
      if (!f.onPayroll) continue
      s.headcount += 1
      s.totalCount += 1
      if (record.status === 'paid') s.paidCount += 1
      else s.pendingAmount += Math.max(0, f.net)
    }
  }
  return s
}

// ============================================
// Shared context — fetched once, reused for every month on screen
// ============================================

/** The salary config one person is paid under, staff and drivers keyed alike. */
export interface PayrollBaseConfig {
  base_amount: number
  pf_basic: number | null
  pf_applicable: boolean
  esi_override: boolean | null
  active: boolean
}

export interface PayrollContext {
  calibration: PayrollCalibration
  baseMap: Record<string, PayrollBaseConfig>
  /** The school's own date — a month in progress is only adjudicated up to it. */
  today: string
  /** Anyone hidden from the salary app in settings — never counted, whatever a stored record says. */
  hidden: Set<string>
}

function toBaseConfig(b: StaffSalaryBase | DriverSalaryBase | SupportStaffSalaryBase): PayrollBaseConfig {
  return {
    base_amount: Number(b.base_amount) || 0,
    pf_basic: b.pf_basic,
    pf_applicable: b.pf_applicable,
    esi_override: b.esi_override,
    active: b.active,
  }
}

/**
 * The parts of the payroll setup that do not change from month to month.
 *
 * Fetched once by the dashboard and handed to every month it draws, so
 * stepping back a month costs the month's own data and nothing else.
 */
export async function fetchPayrollContext(today?: string | null): Promise<PayrollContext> {
  const [calibration, staffBases, driverBases, supportBases, hiddenIds] = await Promise.all([
    fetchPayrollCalibration(), fetchBaseSalaries(), fetchDriverBaseSalaries(), fetchSupportStaffSalaryBases(),
    fetchHiddenSalaryMemberIds(),
  ])
  const baseMap: Record<string, PayrollBaseConfig> = {}
  for (const b of staffBases) baseMap[b.staff_id] = toBaseConfig(b)
  for (const b of driverBases) baseMap[b.driver_id] = toBaseConfig(b)
  for (const b of supportBases) baseMap[b.support_staff_id] = toBaseConfig(b)
  return {
    calibration,
    baseMap,
    today: today ?? new Date().toISOString().split('T')[0],
    hidden: new Set(hiddenIds),
  }
}

export const EMPTY_PAYROLL_CONTEXT: PayrollContext = {
  calibration: DEFAULT_PAYROLL_CALIBRATION,
  baseMap: {},
  today: new Date().toISOString().split('T')[0],
  hidden: new Set(),
}

// ============================================
// Fetching one month
// ============================================

interface RawCycle {
  id: string
  status: string
  payroll_config: PayrollCalibration | null
}

interface RawRecord {
  id: string
  cycle_id: string
  base_amount: number | string
  status: string
  working_days_override: number | null
  leave_override: number | null
  late_override: number | null
  half_day_override: number | null
  pf_amount_override: number | null
  esi_amount_override: number | null
  items: { label: string; amount: number | string }[] | null
}

const RECORD_COLUMNS =
  'id, cycle_id, staff_id, support_staff_id, base_amount, status, working_days_override, leave_override, ' +
  'late_override, half_day_override, pf_amount_override, esi_amount_override'

// These four throw rather than logging and returning [], which is what the
// rest of this codebase does. A list page that shows nothing when a fetch
// fails is merely unhelpful; a payroll dashboard that answers "₹0" is wrong,
// and wrong in the one direction nobody double-checks. The callers catch and
// say the figures could not be read.
//
// The select strings are spelled out per table rather than built from the
// table name: supabase-js parses the column list at the type level, and it can
// only do that for a string literal.
async function fetchStaffCycles(year: number, month: number): Promise<RawCycle[]> {
  const { data, error } = await supabase
    .from('salary_cycles').select('id, status, payroll_config')
    .eq('period_year', year).eq('period_month', month)
  if (error) throw new Error(`Could not read salary_cycles: ${error.message}`)
  return (data ?? []) as unknown as RawCycle[]
}

async function fetchDriverCyclesFor(year: number, month: number): Promise<RawCycle[]> {
  const { data, error } = await supabase
    .from('driver_payroll_cycles').select('id, status, payroll_config')
    .eq('period_year', year).eq('period_month', month)
  if (error) throw new Error(`Could not read driver_payroll_cycles: ${error.message}`)
  return (data ?? []) as unknown as RawCycle[]
}

/** Just enough of the person behind a record to tell whether they've since left — see recordPersonLeft. */
interface LeftJoin {
  staff: { is_banned: boolean } | null
  support_staff: { is_active: boolean } | null
}

async function fetchStaffCycleRecords(
  cycleIds: string[],
): Promise<(RawRecord & { staff_id: string | null; support_staff_id: string | null } & LeftJoin)[]> {
  if (cycleIds.length === 0) return []
  const { data, error } = await supabase
    .from('salary_records')
    .select(
      `${RECORD_COLUMNS}, items:salary_record_items(label, amount), ` +
      'staff:profiles!staff_id(is_banned), support_staff:support_staff!support_staff_id(is_active)',
    )
    .in('cycle_id', cycleIds)
  if (error) throw new Error(`Could not read salary_records: ${error.message}`)
  return (data ?? []) as unknown as (RawRecord & { staff_id: string | null; support_staff_id: string | null } & LeftJoin)[]
}

async function fetchDriverCycleRecordsFor(
  cycleIds: string[],
): Promise<(RawRecord & { driver_id: string } & LeftJoin)[]> {
  if (cycleIds.length === 0) return []
  const { data, error } = await supabase
    .from('driver_payroll_records')
    .select(
      'id, cycle_id, driver_id, base_amount, status, working_days_override, leave_override, ' +
      'late_override, half_day_override, pf_amount_override, esi_amount_override, ' +
      'items:driver_payroll_record_items(label, amount), staff:profiles!driver_id(is_banned)',
    )
    .in('cycle_id', cycleIds)
  if (error) throw new Error(`Could not read driver_payroll_records: ${error.message}`)
  return (data ?? []) as unknown as (RawRecord & { driver_id: string; support_staff: null } & LeftJoin)[]
}

/** Everything a month's attendance-derived figures are computed from. */
interface MonthAttendance {
  records: StaffAttendanceRecord[]
  holidays: Holiday[]
  nonWorkingDays: NonWorkingDay[]
  deltas: Map<string, AttendanceTimingDelta>
  bonusPoints: Record<string, number>
}

/**
 * Support staff have no profiles row, so they read attendance from a
 * different table (support_staff_attendance) and never earn task-manager
 * bonus points (no account to earn them with). `staffIds` are real profile
 * ids (staff/drivers); `supportStaffIds` are support_staff ids — mirrors the
 * same split the cycle detail page makes in its own `load()`.
 */
async function fetchMonthAttendance(
  staffIds: string[], supportStaffIds: string[], year: number, month: number,
): Promise<MonthAttendance> {
  if (staffIds.length === 0 && supportStaffIds.length === 0) {
    return { records: [], holidays: [], nonWorkingDays: [], deltas: new Map(), bonusPoints: {} }
  }
  const [staffRecords, holidays, nonWorkingDays, bonusPoints, supportRecords] = await Promise.all([
    fetchMonthlyAttendanceRecords(staffIds, year, month),
    fetchHolidays(year, month),
    fetchNonWorkingDays(year, month),
    fetchMonthlyBonusPoints(staffIds, year, month),
    supportStaffIds.length > 0
      ? fetchSupportAttendanceRange(
          `${year}-${String(month).padStart(2, '0')}-01`,
          `${year}-${String(month).padStart(2, '0')}-${String(daysInMonth(year, month)).padStart(2, '0')}`,
        )
      : Promise.resolve([]),
  ])
  const supportIdSet = new Set(supportStaffIds)
  const records = [
    ...staffRecords,
    ...supportRecords.filter(r => supportIdSet.has(r.support_staff_id)).map(supportRecordToStaffShape),
  ]
  // Grace minutes are resolved per date off the fetched rows, so this one
  // cannot start until they land.
  //
  // It is tempting to skip this whenever no grace is configured — but a zero
  // grace still excuses a day that is exactly zero minutes late, and this
  // school's August has 131 of them. Skipping would quietly move the money.
  // Support staff never punch, so they carry no timing deltas either.
  const deltas = await fetchAttendanceTimingDeltas(staffRecords)
  return { records, holidays, nonWorkingDays, deltas, bonusPoints }
}

/** Run the payroll engine over one cycle's records, exactly as the cycle page does. */
function computeLive(
  records: (CycleRecordLike & { cycle_id: string })[],
  calibration: PayrollCalibration,
  attendance: MonthAttendance,
  ctx: PayrollContext,
  year: number,
  month: number,
): Record<string, LiveFigures> {
  // Non-working days shrink the payable days for everyone; holidays do not.
  const calendarDays = daysInMonth(year, month) - attendance.nonWorkingDays.length
  const bonusAmounts = computeBonusAmounts(attendance.bonusPoints, calibration.bonus)
  const grace = {
    lateGraceMinutes: calibration.lop.lateGraceMinutes,
    halfDayGraceMinutes: calibration.lop.halfDayGraceMinutes,
    timingDeltas: attendance.deltas,
  }

  const out: Record<string, LiveFigures> = {}
  for (const r of records) {
    const base = ctx.baseMap[r.person_id]
    const derived = computeStaffAttendanceStats(
      r.person_id, attendance.records, attendance.holidays, attendance.nonWorkingDays,
      year, month, ctx.today, grace,
    )
    const row = computePayrollRow({
      baseAmount: Number(r.base_amount) || 0,
      pfBasic: base?.pf_basic ?? null,
      pfApplicable: base?.pf_applicable ?? false,
      esiOverride: base?.esi_override ?? null,
      workingDaysInMonth: r.working_days_override ?? calendarDays,
      lateCount: r.late_override ?? derived.lateCount,
      leaveCount: r.leave_override ?? derived.leaveCount,
      halfDayCount: r.half_day_override ?? derived.halfDayCount,
      calibration,
    })
    out[r.id] = {
      pf: r.pf_amount_override ?? row.pf,
      esi: r.esi_amount_override ?? row.esi,
      lop: Math.round(row.lopFromLate * row.salaryPerDay)
        + Math.round(row.lopFromLeave * row.salaryPerDay)
        + Math.round(row.lopFromHalfDay * row.salaryPerDay),
      bonus: bonusAmounts[r.person_id] ?? 0,
    }
  }
  return out
}

// ============================================
// Projection — for a month whose cycle has not been run yet
// ============================================

async function project(year: number, month: number, ctx: PayrollContext): Promise<MonthlyPayrollStats> {
  const [staff, allDrivers, allSupport] = await Promise.all([
    fetchEligibleStaff(), fetchEligibleDrivers(), fetchSupportStaff({ activeOnly: true }),
  ])
  const onPayroll = new Set<string>([
    ...staff.map(p => p.id),
    ...allDrivers.filter(d => !ctx.hidden.has(d.id) && !d.is_banned).map(d => d.id),
    ...allSupport.filter(s => !ctx.hidden.has(s.id)).map(s => s.id),
  ])
  const active = Object.entries(ctx.baseMap)
    .filter(([id, b]) => b.active && b.base_amount > 0 && onPayroll.has(id))

  const s = emptyStats(year, month)
  s.projected = true
  s.headcount = active.length
  if (active.length === 0) return s

  const points = await fetchMonthlyBonusPoints(active.map(([id]) => id), year, month)
  const bonusAmounts = computeBonusAmounts(points, ctx.calibration.bonus)

  for (const [id, b] of active) {
    const bonus = bonusAmounts[id] ?? 0
    s.gross += b.base_amount + bonus
    s.bonus += bonus
    if (b.pf_applicable) s.pf += Math.round((Number(b.pf_basic) || 0) * ctx.calibration.pf.rate)
    const esiApplies = b.esi_override ?? (b.base_amount > 0 && b.base_amount <= ctx.calibration.esi.wage_ceiling)
    if (esiApplies) s.esi += Math.ceil(b.base_amount * ctx.calibration.esi.rate)
  }
  // Loss of pay is only knowable once the month's attendance is adjudicated in
  // a cycle, so a projection leaves it out rather than guessing.
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
 * A month with a cycle reports the same figures its cycle page does. A month
 * still ahead of (or level with) today reports a projection from the active
 * base salaries. A past month with no cycle reports nothing — projecting
 * today's salaries backwards onto a payroll that was never run would invent a
 * number.
 */
export async function fetchMonthlyPayrollStats(
  year: number, month: number, ctx: PayrollContext,
): Promise<MonthlyPayrollStats> {
  const [staffCycles, driverCycles] = await Promise.all([
    fetchStaffCycles(year, month), fetchDriverCyclesFor(year, month),
  ])

  const [staffRows, driverRows] = await Promise.all([
    fetchStaffCycleRecords(staffCycles.map(c => c.id)),
    fetchDriverCycleRecordsFor(driverCycles.map(c => c.id)),
  ])

  // A cycle keeps its rows for whoever has since resigned (staff/driver) or
  // left (support staff), and for anyone since hidden from the salary app —
  // neither is on payroll any more. This has to match exactly what the cycle
  // detail page itself excludes from its sheet (see its `load`) and what
  // fetchCycleTallies excludes from the Pay Cycles list — mirroring
  // recordPersonLeft in src/lib/salary.ts, against this module's narrower
  // join shape — or this dashboard reports a different headcount for the
  // same month than every other screen that reads the same records.
  const left = (r: LeftJoin): boolean => {
    if (r.staff) return !!r.staff.is_banned
    if (r.support_staff) return !r.support_staff.is_active
    return false
  }
  const onRoster = <T extends LeftJoin & { person_id: string }>(r: T) =>
    !left(r) && !ctx.hidden.has(r.person_id)

  // A staff-cycle row is for a profile (staff_id) or a support staff member
  // (support_staff_id) — never both, never neither (see salary_records'
  // person-check constraint) — so this is exactly recordPersonId's logic,
  // just against the raw untyped row shape this module reads.
  const onRosterStaffRows = staffRows
    .map(r => ({ ...r, person_id: (r.staff_id ?? r.support_staff_id) as string }))
    .filter(onRoster)
  const onRosterDriverRows = driverRows.map(r => ({ ...r, person_id: r.driver_id })).filter(onRoster)

  const records: (CycleRecordLike & { cycle_id: string })[] = [...onRosterStaffRows, ...onRosterDriverRows]

  const cycles = [...staffCycles, ...driverCycles]

  // No cycle at all for this month — as opposed to a cycle whose every record
  // has since left or been hidden, which is a real (if empty) month and must
  // not be mistaken for one that was never run.
  if (cycles.length === 0) {
    const now = new Date()
    const isFuture = monthIndex(year, month) >= monthIndex(now.getFullYear(), now.getMonth() + 1)
    return isFuture ? project(year, month, ctx) : emptyStats(year, month)
  }
  // Attendance is only needed while at least one cycle is still open — a fully
  // locked month is read entirely off its stored items.
  const anyOpen = cycles.some(c => c.status !== 'closed')
  const supportStaffIds = [...new Set(onRosterStaffRows.filter(r => r.support_staff_id).map(r => r.support_staff_id as string))]
  const profileIds = [...new Set(records.map(r => r.person_id).filter(id => !supportStaffIds.includes(id)))]
  const attendance = anyOpen
    ? await fetchMonthAttendance(profileIds, supportStaffIds, year, month)
    : { records: [], holidays: [], nonWorkingDays: [], deltas: new Map(), bonusPoints: {} }

  const groups: CycleGroup[] = cycles.map(cycle => {
    const own = records.filter(r => r.cycle_id === cycle.id)
    const locked = cycle.status === 'closed'
    const calibration = mergeCalibration(ctx.calibration, cycle.payroll_config)
    return {
      locked,
      records: own,
      live: locked ? {} : computeLive(own, calibration, attendance, ctx, year, month),
    }
  })

  return aggregateMonth(year, month, groups)
}

// ============================================
// One person's payslips
// ============================================

export interface PayslipLine { label: string; amount: number }

export interface StaffPayslip {
  recordId: string
  /** 0 when the record has no cycle attached and its period is unknown. */
  year: number
  month: number
  status: SalaryStatus
  /** The cycle is locked, so these figures are final. */
  locked: boolean
  payoutReference: string | null
  notes: string | null
  earnings: PayslipLine[]
  deductions: PayslipLine[]
  gross: number
  totalDeductions: number
  net: number
  bonus: number
}

function lineSort(a: PayslipLine, b: PayslipLine): number {
  return b.amount - a.amount
}

/**
 * A staff member's payslips, computed the same way the admin's cycle page
 * computes their row.
 *
 * Without this the two disagree: an open cycle stores no PF/ESI/loss-of-pay
 * items, so reading the items alone shows someone their full base salary as
 * take-home right up until the month is locked — and then drops it.
 *
 * Attendance is only fetched for the months whose cycle is still open, and
 * those months are fetched together rather than one after another.
 */
export async function buildStaffPayslips(
  staffId: string,
  records: SalaryRecord[],
  base: StaffSalaryBase | null,
  today?: string | null,
): Promise<StaffPayslip[]> {
  const openPeriods = new Map<string, { year: number; month: number }>()
  for (const r of records) {
    if (!r.cycle || r.cycle.status === 'closed') continue
    openPeriods.set(`${r.cycle.period_year}-${r.cycle.period_month}`, {
      year: r.cycle.period_year, month: r.cycle.period_month,
    })
  }

  const [globalCalibration, ...attendances] = await Promise.all([
    fetchPayrollCalibration(),
    // Always a real profile (self-view is only ever reached by someone with a
    // login), so nothing is passed for the support-staff side of the split.
    ...[...openPeriods.values()].map(p => fetchMonthAttendance([staffId], [], p.year, p.month)),
  ])
  const attendanceByPeriod = new Map<string, MonthAttendance>()
  ;[...openPeriods.keys()].forEach((key, i) => attendanceByPeriod.set(key, attendances[i]))

  const ctx: PayrollContext = {
    calibration: globalCalibration,
    baseMap: base ? { [staffId]: toBaseConfig(base) } : {},
    today: today ?? new Date().toISOString().split('T')[0],
    hidden: new Set(),
  }

  return records.map(r => {
    const year = r.cycle?.period_year ?? 0
    const month = r.cycle?.period_month ?? 0
    const locked = r.cycle?.status === 'closed' || !r.cycle
    const baseAmount = Number(r.base_amount) || 0
    const stored = (r.items ?? []).map(i => ({ label: i.label, amount: Number(i.amount) || 0 }))

    const earnings: PayslipLine[] = [{ label: 'Basic salary', amount: baseAmount }]
    const deductions: PayslipLine[] = []
    let bonus = 0

    if (locked) {
      for (const line of stored) {
        if (line.amount >= 0) {
          earnings.push(line)
          if (line.label === PAYROLL_ITEM_LABELS.bonus || line.label.startsWith(LEGACY_BONUS_PREFIX)) {
            bonus += line.amount
          }
        } else {
          deductions.push({ label: line.label, amount: -line.amount })
        }
      }
    } else {
      const attendance = attendanceByPeriod.get(`${year}-${month}`)
      const calibration = mergeCalibration(globalCalibration, r.cycle?.payroll_config ?? null)
      const live = attendance
        ? computeLive(
            [{ ...r, person_id: staffId, cycle_id: r.cycle_id, items: stored }],
            calibration, attendance, ctx, year, month,
          )[r.id]
        : null

      if (live?.bonus) { earnings.push({ label: PAYROLL_ITEM_LABELS.bonus, amount: live.bonus }); bonus = live.bonus }
      if (live?.pf) deductions.push({ label: PAYROLL_ITEM_LABELS.pf, amount: live.pf })
      if (live?.esi) deductions.push({ label: PAYROLL_ITEM_LABELS.esi, amount: live.esi })
      if (live?.lop) deductions.push({ label: 'Loss of pay', amount: live.lop })

      // Only what someone typed in by hand survives from the database — the
      // auto-labelled rows are the preview above, recomputed every load.
      for (const line of stored) {
        if (isAutoPayrollLabel(line.label)) continue
        if (line.amount >= 0) earnings.push(line)
        else deductions.push({ label: line.label, amount: -line.amount })
      }
    }

    earnings.sort(lineSort)
    deductions.sort(lineSort)
    const gross = earnings.reduce((s, l) => s + l.amount, 0)
    const totalDeductions = deductions.reduce((s, l) => s + l.amount, 0)

    return {
      recordId: r.id, year, month, status: r.status, locked,
      payoutReference: r.payout_reference, notes: r.notes,
      earnings, deductions, gross, totalDeductions, net: gross - totalDeductions, bonus,
    }
  })
}

/**
 * Percentage change from `previous` to `current`, or null when a comparison
 * would be meaningless — no earlier figure to compare against.
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
