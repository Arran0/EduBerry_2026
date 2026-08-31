import { supabase } from './supabase'
import {
  StaffAttendanceRecord, Holiday, AttendanceTimingDelta, deriveDayStatus, computeMonthlyStats,
} from './attendance'

// Shared PF/ESI/LOP/bonus calibration engine — used by both the staff Salary
// Manager and the driver Payroll pay-cycle pages so the math lives in exactly
// one place. Mirrors the calculations in the school's existing payroll Excel
// sheet (per-day rate, ESI wage-ceiling rule, PF on a separate "PF Basic"
// wage) plus a configurable tiered LOP model and a bonus-point-to-rupee engine.

// ============================================
// Types
// ============================================

/** A run of consecutive "excess" occurrences (beyond the free quota), each charged this many LOP days. */
export interface LopTier {
  /** How many occurrences this tier covers. null = absorbs everything remaining (must be the last tier). */
  count: number | null
  lop_days_each: number
}

export interface LopRule {
  /** Occurrences allowed per month before any LOP applies. */
  free_count: number
  tiers: LopTier[]
}

export interface PayrollCalibration {
  pf: { rate: number }                                   // e.g. 0.12 = 12% of PF Basic
  esi: { rate: number; wage_ceiling: number }             // e.g. 0.0075 = 0.75%, ceiling ₹21,000
  lop: {
    late: LopRule
    leave: LopRule
    /** Same shape as late/leave — each half-day beyond the free quota costs its tier's days. */
    halfDay: LopRule
    /** A late arrival within this many minutes of the effective late cutoff isn't counted as a Late occurrence. */
    lateGraceMinutes: number
    /** A checkout within this many minutes of the effective checkout cutoff is excused — treated as a normal (full) day, not a Half Day. */
    halfDayGraceMinutes: number
  }
  bonus: { mode: 'per_point' | 'pool'; per_point_value: number; pool_amount: number }
}

export const DEFAULT_PAYROLL_CALIBRATION: PayrollCalibration = {
  pf: { rate: 0.12 },
  esi: { rate: 0.0075, wage_ceiling: 21000 },
  lop: {
    late: { free_count: 3, tiers: [{ count: null, lop_days_each: 0.5 }] },
    leave: { free_count: 1, tiers: [{ count: null, lop_days_each: 1 }] },
    halfDay: { free_count: 0, tiers: [{ count: null, lop_days_each: 0.5 }] },
    // 0 minutes = today's exact behavior (no excuses), so existing cycles are
    // unaffected until an admin opts in.
    lateGraceMinutes: 0,
    halfDayGraceMinutes: 0,
  },
  bonus: { mode: 'per_point', per_point_value: 50, pool_amount: 5000 },
}

/** Stable labels for the items auto-inserted when a cycle is closed, so a reopen can find & remove exactly these. */
export const PAYROLL_ITEM_LABELS = {
  pf: 'PF',
  esi: 'ESI',
  lopLate: 'LOP — Late',
  lopLeave: 'LOP — Leave',
  lopHalfDay: 'LOP — Half Day',
  bonus: 'Task Bonus',
} as const

/**
 * Prefixes written by the previous "apply this recommendation" flow, which
 * stored labels like `Task bonus (June 2026) · 4 pts`. Those rows are the same
 * money as today's automatic Task Bonus / LOP items, so they have to be
 * recognised as machine-generated too — otherwise they'd be mistaken for a
 * manual adjustment and counted a second time on top of the current figures.
 */
const LEGACY_AUTO_PREFIXES = ['Task bonus', 'Absence penalty']

/** True for any item this app generated itself (current scheme or the older recommendation one). */
export function isAutoPayrollLabel(label: string): boolean {
  const values: string[] = Object.values(PAYROLL_ITEM_LABELS)
  if (values.includes(label)) return true
  return LEGACY_AUTO_PREFIXES.some(p => label.startsWith(p))
}

// ============================================
// Calibration storage — global default (site_settings) + per-cycle override
// ============================================

export async function fetchPayrollCalibration(): Promise<PayrollCalibration> {
  const { data, error } = await supabase
    .from('site_settings')
    .select('value')
    .eq('key', 'payroll_calibration')
    .maybeSingle()
  if (error) { console.error('fetchPayrollCalibration failed:', error); return DEFAULT_PAYROLL_CALIBRATION }
  return mergeCalibration(DEFAULT_PAYROLL_CALIBRATION, (data?.value ?? null) as Partial<PayrollCalibration> | null)
}

export async function savePayrollCalibration(cfg: PayrollCalibration): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase
    .from('site_settings')
    .upsert({ key: 'payroll_calibration', value: cfg as unknown as Record<string, unknown> }, { onConflict: 'key' })
  if (error) { console.error('savePayrollCalibration failed:', error); return { success: false, error: error.message } }
  return { success: true }
}

/**
 * A cycle-level override replaces whole sections (pf / esi / lop / bonus) of
 * the base calibration, not individual fields — except `lop`, which merges
 * per-field. That's what lets an *older* stored calibration (from before
 * halfDay/lateGraceMinutes/halfDayGraceMinutes existed) fall back to the
 * default for just those new keys instead of leaving them `undefined`.
 */
export function mergeCalibration(
  base: PayrollCalibration,
  override: Partial<PayrollCalibration> | null | undefined,
): PayrollCalibration {
  if (!override) return base
  return {
    pf: override.pf ?? base.pf,
    esi: override.esi ?? base.esi,
    lop: {
      late: override.lop?.late ?? base.lop.late,
      leave: override.lop?.leave ?? base.lop.leave,
      halfDay: override.lop?.halfDay ?? base.lop.halfDay,
      lateGraceMinutes: override.lop?.lateGraceMinutes ?? base.lop.lateGraceMinutes,
      halfDayGraceMinutes: override.lop?.halfDayGraceMinutes ?? base.lop.halfDayGraceMinutes,
    },
    bonus: override.bonus ?? base.bonus,
  }
}

// ============================================
// LOP tiers
// ============================================

/**
 * Loss-of-pay days earned by `occurrences` lates/leaves in a month.
 *
 *   excess = max(0, occurrences − free quota)
 *
 * Every excess occurrence is then charged against the tiers in order. A tier
 * with `count: n` covers the next n occurrences at `lop_days_each` days each;
 * a tier with `count: null` covers everything remaining. For the flat policy
 * most schools use ("each excess leave costs one day's pay") that is a single
 * open-ended tier, and the whole thing reduces to
 * `(occurrences − allowed) × lop_days_each`. For an escalating policy the
 * tiers make each successive occurrence dearer than the last.
 *
 * Once the configured tiers are exhausted the **last tier's rate carries on**
 * for any remaining occurrences. Without that, a policy built only from finite
 * tiers would stop charging entirely past the final tier, so someone with ten
 * unauthorised leaves would lose exactly as much pay as someone with five —
 * escalating schedules are meant to get harsher, never to cap out.
 */
export function calcLopDays(occurrences: number, freeCount: number, tiers: LopTier[]): number {
  let remaining = Math.max(0, occurrences - Math.max(0, freeCount))
  if (remaining <= 0 || tiers.length === 0) return 0

  let days = 0
  for (const tier of tiers) {
    if (remaining <= 0) break
    const take = tier.count == null ? remaining : Math.min(remaining, tier.count)
    days += take * tier.lop_days_each
    remaining -= take
  }
  // Anything past the last configured tier keeps that tier's rate.
  if (remaining > 0) days += remaining * tiers[tiers.length - 1].lop_days_each
  return days
}

// ============================================
// Bonus points → rupees
// ============================================

/** Per-point: rate × points each. Pool: a fixed amount split proportionally among everyone with points > 0. */
export function computeBonusAmounts(
  pointsMap: Record<string, number>,
  bonus: PayrollCalibration['bonus'],
): Record<string, number> {
  const out: Record<string, number> = {}
  if (bonus.mode === 'per_point') {
    for (const [id, pts] of Object.entries(pointsMap)) {
      if (pts > 0) out[id] = Math.round(pts * bonus.per_point_value)
    }
    return out
  }
  const totalPoints = Object.values(pointsMap).reduce((s, p) => s + (p > 0 ? p : 0), 0)
  if (totalPoints <= 0) return out
  for (const [id, pts] of Object.entries(pointsMap)) {
    if (pts > 0) out[id] = Math.round((bonus.pool_amount * pts) / totalPoints)
  }
  return out
}

// ============================================
// Attendance → late/leave counts
// ============================================

export interface StaffPayrollAttendance {
  lateCount: number
  leaveCount: number
  halfDayCount: number
}

export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate()
}

/** Grace periods, applied against each day's actual lateness/earliness in minutes. */
export interface AttendanceGrace {
  lateGraceMinutes: number
  halfDayGraceMinutes: number
  /** From `fetchAttendanceTimingDeltas`, keyed `${staff_id}|${date}`. */
  timingDeltas: Map<string, AttendanceTimingDelta>
}

/**
 * Late/leave/half-day occurrence counts for one staff member across a
 * calendar month, derived day-by-day (holiday/non-working-day-aware, via the
 * same `deriveDayStatus` the attendance module itself uses).
 *
 * `leaveCount` is not counted here at all — it is read straight off
 * `computeMonthlyStats(...).absent`, the very number the staff member's
 * attendance calendar prints on its "Absent" chip. Sharing the function
 * rather than mirroring its rules is the point: the payroll Leave column and
 * the calendar popup opened from the same row can then never drift apart,
 * whatever changes to holiday, non-working-day or absence handling land in
 * the attendance module later. Every downstream figure — LOP days, LOP rupees,
 * earned wage, ESI, the items snapshotted when the cycle is locked, and the
 * NCP days on the statutory returns — is derived from this one count.
 *
 * `on_leave` is tracked as its own chip on the calendar and, same as here, is
 * not folded into Absent — approved Casual/Medical leave is written by the
 * attendance sync as `absent` with a `leave_application_id`, not `on_leave`,
 * so this does not exempt approved leave from LOP.
 *
 * `today` decides where the month stops being adjudicated: days after it are
 * still ahead and are never absences. Pass the school's own date (the server
 * clock in the school timezone, as the calendar uses) — the default reads the
 * device's UTC date, which sits a day behind for part of every day in India.
 *
 * With `grace` supplied, a Late day within `lateGraceMinutes` of the cutoff —
 * or a Half Day checkout within `halfDayGraceMinutes` of the checkout cutoff —
 * is excused: treated as a normal day and left out of both counts entirely.
 * Without it (the default), behavior is unchanged from before grace existed.
 */
export function computeStaffAttendanceStats(
  staffId: string,
  records: StaffAttendanceRecord[],
  holidays: Holiday[],
  nonWorkingDays: Holiday[],
  year: number,
  month: number,
  today: string = new Date().toISOString().split('T')[0],
  grace?: AttendanceGrace,
): StaffPayrollAttendance {
  const holidaySet = new Set(holidays.map(h => h.date))
  const nonWorkingSet = new Set(nonWorkingDays.map(h => h.date))
  const myRecords = records.filter(r => r.staff_id === staffId)
  const recordByDate = new Map(myRecords.map(r => [r.date, r]))
  const lastDay = daysInMonth(year, month)
  let lateCount = 0
  let halfDayCount = 0
  for (let d = 1; d <= lastDay; d++) {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    const status = deriveDayStatus(dateStr, recordByDate.get(dateStr), holidaySet, nonWorkingSet, today)
    if (status === 'late') {
      const delta = grace?.timingDeltas.get(`${staffId}|${dateStr}`)
      const excused = !!grace && (delta?.lateByMinutes ?? Infinity) <= grace.lateGraceMinutes
      if (!excused) lateCount++
    } else if (status === 'half_day') {
      const delta = grace?.timingDeltas.get(`${staffId}|${dateStr}`)
      const excused = !!grace && (delta?.earlyByMinutes ?? Infinity) <= grace.halfDayGraceMinutes
      if (!excused) halfDayCount++
    }
  }
  // The one number the Leave column shows and every calculation below it uses:
  // the calendar's own Absent count for this staff member and month.
  const { absent: leaveCount } = computeMonthlyStats(
    year, month, myRecords, holidays, today, nonWorkingDays,
  )
  return { lateCount, leaveCount, halfDayCount }
}

// ============================================
// Per-record payroll math
// ============================================

export interface PayrollRowInputs {
  baseAmount: number
  pfBasic: number | null
  pfApplicable: boolean
  esiOverride: boolean | null
  workingDaysInMonth: number
  lateCount: number
  leaveCount: number
  halfDayCount: number
  calibration: PayrollCalibration
}

export interface PayrollRowResult {
  salaryPerDay: number
  lopFromLate: number
  lopFromLeave: number
  lopFromHalfDay: number
  lopTotal: number
  daysWorked: number
  earnedWage: number
  pf: number
  esi: number
}

/** Mirrors the sheet's `(daysWorked)*(salary/day)` earned-wage formula, then PF (fixed) and ESI (ROUNDUP 0.75%). */
export function computePayrollRow(inputs: PayrollRowInputs): PayrollRowResult {
  const { baseAmount, pfBasic, pfApplicable, esiOverride, workingDaysInMonth, lateCount, leaveCount, halfDayCount, calibration } = inputs

  const salaryPerDay = workingDaysInMonth > 0 ? baseAmount / workingDaysInMonth : 0
  const lopFromLate = calcLopDays(lateCount, calibration.lop.late.free_count, calibration.lop.late.tiers)
  const lopFromLeave = calcLopDays(leaveCount, calibration.lop.leave.free_count, calibration.lop.leave.tiers)
  const lopFromHalfDay = calcLopDays(halfDayCount, calibration.lop.halfDay.free_count, calibration.lop.halfDay.tiers)
  const lopTotal = lopFromLate + lopFromLeave + lopFromHalfDay
  const daysWorked = Math.max(0, workingDaysInMonth - lopTotal)
  const earnedWage = Math.round(daysWorked * salaryPerDay)

  const esiApplicable = esiOverride ?? (baseAmount > 0 && baseAmount <= calibration.esi.wage_ceiling)
  const esi = esiApplicable ? Math.ceil(earnedWage * calibration.esi.rate) : 0
  const pf = pfApplicable ? Math.round((pfBasic ?? 0) * calibration.pf.rate) : 0

  return { salaryPerDay, lopFromLate, lopFromLeave, lopFromHalfDay, lopTotal, daysWorked, earnedWage, pf, esi }
}
