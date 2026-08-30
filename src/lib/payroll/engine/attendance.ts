// ============================================================================
// Attendance adjudication — the day-by-day basis for every LOP rupee.
// ----------------------------------------------------------------------------
// Produces one `DayVerdict` per day of the period. That list is not a byproduct:
// it is stored on the run line and rendered directly as the LOP drill-down, so
// "why was ₹1,840 deducted" is answered by pointing at the three days that did
// it and naming the rule and the policy group that priced them.
//
// Two things are deliberately kept apart, because conflating them double-counts:
//   • LOP        — pay lost to absence, unapproved leave and lateness.
//   • Not-on-roll— days before joining or after exit, which prorate the salary.
// A mid-month joiner who was also absent once loses both, and each is explained
// separately.
//
// Tiered LOP has an ordering problem: how much a given absence costs depends on
// how many came before it in the month. So this runs in two phases — classify
// every day and count occurrences, then walk the occurrences in date order
// applying the free quota and the tiers, writing the resulting cost back onto
// the day that incurred it.
// ============================================================================

import type {
  EngineAttendanceDay, DayVerdict, AttendanceResult, PayrollPolicy, LopRule,
  EngineEmployee, WorkingCalendar, EngineHoliday, PolicySource, ExplainNode,
} from './types'
import { classifyDays, computePayableDays, type CalendarDay } from './calendar'
import { round2 } from './money'

/**
 * Loss-of-pay days earned by `occurrences` lates/leaves, and how each individual
 * occurrence was priced.
 *
 * The free quota is consumed first. Every occurrence past it is charged against
 * the tiers in order — a tier with `count: n` covers the next n occurrences at
 * `lopDaysEach`, and a tier with `count: null` absorbs the rest. Once the tiers
 * run out the last tier's rate carries on, so an escalating schedule can never
 * cap out and make a tenth unauthorised absence free.
 *
 * Preserves the semantics of `calcLopDays` in the legacy src/lib/payroll.ts.
 */
export function priceOccurrences(count: number, rule: LopRule): { index: number; lopDays: number; note: string }[] {
  const out: { index: number; lopDays: number; note: string }[] = []
  const free = Math.max(0, rule.freeCount)
  let tierIdx = 0
  let usedInTier = 0

  for (let i = 0; i < count; i++) {
    if (i < free) {
      out.push({ index: i, lopDays: 0, note: `within the free quota of ${free} per period` })
      continue
    }
    if (rule.tiers.length === 0) {
      out.push({ index: i, lopDays: 0, note: 'no LOP tiers are configured, so nothing is charged' })
      continue
    }
    // Advance past any finite tier that is already full.
    while (
      tierIdx < rule.tiers.length - 1 &&
      rule.tiers[tierIdx].count !== null &&
      usedInTier >= (rule.tiers[tierIdx].count as number)
    ) {
      tierIdx++
      usedInTier = 0
    }
    const tier = rule.tiers[tierIdx]
    const isLast = tierIdx === rule.tiers.length - 1
    const overflowing = tier.count !== null && usedInTier >= tier.count && isLast
    out.push({
      index: i,
      lopDays: tier.lopDaysEach,
      note: overflowing
        ? `past the last tier, which keeps charging ${tier.lopDaysEach} day(s)`
        : `tier ${tierIdx + 1} — ${tier.lopDaysEach} day(s) each`,
    })
    usedInTier++
  }
  return out
}

/** Sum of what `priceOccurrences` charges. Kept for callers that only want the total. */
export function calcLopDays(count: number, rule: LopRule): number {
  return round2(priceOccurrences(count, rule).reduce((s, o) => s + o.lopDays, 0))
}

interface Classified {
  day: CalendarDay
  record: EngineAttendanceDay | undefined
  verdict: DayVerdict
  occurrence: 'late' | 'leave' | 'half_day' | null
}

function classifyOne(
  day: CalendarDay,
  record: EngineAttendanceDay | undefined,
  policy: PayrollPolicy,
  today: string,
): Classified {
  const base = {
    date: day.date,
    calendarStatus: day.status,
    attendanceStatus: record?.status ?? null,
    leaveType: record?.leaveType ?? null,
    leaveApplicationId: record?.leaveApplicationId ?? null,
    correctionId: record?.correctionId ?? null,
    countsAsLateOccurrence: false,
    countsAsLeaveOccurrence: false,
  }

  // Days off the roll prorate the salary; they are never LOP. Saying so
  // explicitly keeps a joiner's payslip from reading as if they were absent.
  if (day.status === 'before_join') {
    return { day, record, occurrence: null, verdict: { ...base, paidFraction: 0, lopFraction: 0, reason: 'Before joining — not on the roll.' } }
  }
  if (day.status === 'after_exit') {
    return { day, record, occurrence: null, verdict: { ...base, paidFraction: 0, lopFraction: 0, reason: 'After the last working day — not on the roll.' } }
  }
  if (day.status === 'holiday') {
    return { day, record, occurrence: null, verdict: { ...base, paidFraction: 1, lopFraction: 0, reason: `Holiday${day.holidayName ? ` — ${day.holidayName}` : ''}. Paid.` } }
  }
  if (day.status === 'week_off') {
    return { day, record, occurrence: null, verdict: { ...base, paidFraction: 1, lopFraction: 0, reason: 'Weekly off. Paid.' } }
  }

  const dayWeight = day.status === 'half_working' ? 0.5 : 1
  const status = record?.status ?? null

  if (status === 'present') {
    return { day, record, occurrence: null, verdict: { ...base, paidFraction: dayWeight, lopFraction: 0, reason: 'Present.' } }
  }

  if (status === 'late') {
    const graced = (record?.lateByMinutes ?? 0) <= policy.lateGraceMinutes
    return {
      day, record, occurrence: graced ? null : 'late',
      verdict: {
        ...base, paidFraction: dayWeight, lopFraction: 0,
        countsAsLateOccurrence: !graced,
        reason: graced
          ? `Late by ${record?.lateByMinutes ?? 0} min, inside the ${policy.lateGraceMinutes} min grace. Not counted.`
          : `Late by ${record?.lateByMinutes ?? 0} min — counted as a late occurrence.`,
      },
    }
  }

  if (status === 'half_day') {
    return {
      day, record, occurrence: 'half_day',
      verdict: {
        ...base, paidFraction: dayWeight * (1 - policy.halfDayFraction), lopFraction: 0,
        countsAsLeaveOccurrence: false,
        reason: `Half day — ${policy.halfDayFraction * 100}% of the day treated as leave.`,
      },
    }
  }

  if (status === 'absent' || status === 'on_leave') {
    // The attendance sync writes approved casual/medical leave as `absent` with a
    // leave_application_id rather than `on_leave`, so both shapes have to be read
    // the same way or approved leave silently becomes unauthorised absence.
    const kind = record?.leaveType ?? (record?.leaveApplicationId ? 'casual' : 'unapproved')
    const treatment = policy.leaveTreatment[kind] ?? policy.leaveTreatment.unapproved ?? 'lop'
    const approved = !!record?.leaveApplicationId

    if (treatment === 'paid') {
      return {
        day, record, occurrence: null,
        verdict: { ...base, paidFraction: dayWeight, lopFraction: 0, reason: `${labelFor(kind)}${approved ? ' (approved)' : ''} — paid leave, no deduction.` },
      }
    }
    if (treatment === 'half') {
      return {
        day, record, occurrence: 'half_day',
        verdict: { ...base, paidFraction: dayWeight * 0.5, lopFraction: 0, reason: `${labelFor(kind)} — treated as a half day.` },
      }
    }
    return {
      day, record, occurrence: 'leave',
      verdict: {
        ...base, paidFraction: 0, lopFraction: 0, countsAsLeaveOccurrence: true,
        reason: approved
          ? `${labelFor(kind)} (approved) — unpaid under this policy, counted as a leave occurrence.`
          : `${labelFor(kind)} — counted as a leave occurrence.`,
      },
    }
  }

  // No record at all. A future day is simply not adjudicated yet; a past working
  // day with nothing on it is an unmarked absence, and the run says so rather
  // than quietly paying for it or quietly docking it without explanation.
  if (day.date > today) {
    return { day, record, occurrence: null, verdict: { ...base, paidFraction: dayWeight, lopFraction: 0, reason: 'Not yet reached.' } }
  }
  return {
    day, record, occurrence: 'leave',
    verdict: {
      ...base, paidFraction: 0, lopFraction: 0, countsAsLeaveOccurrence: true,
      reason: 'No attendance marked — treated as unauthorised absence. Correct the attendance if this is wrong.',
    },
  }
}

function labelFor(kind: string): string {
  const map: Record<string, string> = {
    casual: 'Casual leave', medical: 'Medical leave', on_duty: 'On duty',
    half_day: 'Half day', unapproved: 'Absent',
  }
  return map[kind] ?? kind
}

export interface AttendanceArgs {
  from: string
  to: string
  employee: EngineEmployee
  calendar: WorkingCalendar
  holidays: EngineHoliday[]
  records: EngineAttendanceDay[]
  policy: PayrollPolicy
  policySource: PolicySource
  calendarSource: PolicySource
  /** Days after this are treated as not yet reached rather than as absences. */
  today: string
}

export function calcAttendance(args: AttendanceArgs): AttendanceResult & { onRollDays: number } {
  const { from, to, employee, calendar, holidays, records, policy, policySource, calendarSource, today } = args

  const calDays = classifyDays(from, to, calendar, holidays, employee)
  const byDate = new Map(records.map(r => [r.date, r]))
  const classified = calDays.map(d => classifyOne(d, byDate.get(d.date), policy, today))

  // Phase two: price the occurrences in date order and write the cost back onto
  // the day that caused it, so the grid can show "leave #2 — 1 day" per row.
  const lateDays = classified.filter(c => c.occurrence === 'late')
  const leaveDays = classified.filter(c => c.occurrence === 'leave')
  const halfDays = classified.filter(c => c.occurrence === 'half_day')

  const latePriced = priceOccurrences(lateDays.length, policy.lop.late)
  const leavePriced = priceOccurrences(leaveDays.length, policy.lop.leave)

  lateDays.forEach((c, i) => {
    const p = latePriced[i]
    c.verdict.lopFraction = p.lopDays
    c.verdict.reason += ` Late #${i + 1} — ${p.lopDays === 0 ? 'no LOP' : `${p.lopDays} day(s) LOP`} (${p.note}).`
  })
  leaveDays.forEach((c, i) => {
    const p = leavePriced[i]
    c.verdict.lopFraction = p.lopDays
    c.verdict.reason += ` Leave #${i + 1} — ${p.lopDays === 0 ? 'no LOP' : `${p.lopDays} day(s) LOP`} (${p.note}).`
  })
  // Half days are charged directly at the configured fraction rather than through
  // the tier schedule — a half day is a known quantity, not an escalating offence.
  halfDays.forEach(c => { c.verdict.lopFraction = policy.halfDayFraction })

  const lopFromLate = round2(latePriced.reduce((s, p) => s + p.lopDays, 0))
  const lopFromLeave = round2(leavePriced.reduce((s, p) => s + p.lopDays, 0))
  const lopFromHalf = round2(halfDays.length * policy.halfDayFraction)

  let lopDays = round2(lopFromLate + lopFromLeave + lopFromHalf)
  if (policy.roundLopTo > 0) {
    lopDays = round2(Math.round(lopDays / policy.roundLopTo) * policy.roundLopTo)
  }

  const { payableDays, onRollDays, explanation } = computePayableDays(calDays, calendar)
  const paidDays = round2(Math.max(0, Math.min(payableDays, onRollDays) - lopDays))

  const trace: ExplainNode = {
    label: 'Attendance and loss of pay',
    value: lopDays,
    unit: 'days',
    policy: policySource,
    inputs: {
      'Payable days': payableDays,
      'Days on the roll': onRollDays,
      'Late occurrences': lateDays.length,
      'Leave occurrences': leaveDays.length,
      'Half days': halfDays.length,
    },
    note: `${explanation} Calendar "${calendar.name}": ${calendarSource.why}`,
    children: [
      {
        label: 'LOP from lateness', value: lopFromLate, unit: 'days', policy: policySource,
        formula: `${lateDays.length} late occurrence(s), ${policy.lop.late.freeCount} free per period`,
        children: lateDays.map((c, i) => ({
          label: c.verdict.date, value: latePriced[i].lopDays, unit: 'days', note: c.verdict.reason,
        })),
      },
      {
        label: 'LOP from leave and absence', value: lopFromLeave, unit: 'days', policy: policySource,
        formula: `${leaveDays.length} leave occurrence(s), ${policy.lop.leave.freeCount} free per period`,
        children: leaveDays.map((c, i) => ({
          label: c.verdict.date, value: leavePriced[i].lopDays, unit: 'days', note: c.verdict.reason,
        })),
      },
      ...(halfDays.length > 0 ? [{
        label: 'LOP from half days', value: lopFromHalf, unit: 'days' as const, policy: policySource,
        formula: `${halfDays.length} half day(s) × ${policy.halfDayFraction}`,
        children: halfDays.map(c => ({ label: c.verdict.date, value: policy.halfDayFraction, unit: 'days' as const, note: c.verdict.reason })),
      }] : []),
      ...(policy.roundLopTo > 0 ? [{
        label: 'Rounded', value: lopDays, unit: 'days' as const,
        note: `Total LOP rounded to the nearest ${policy.roundLopTo} of a day, as "${policySource.groupName}" requires.`,
      }] : []),
    ],
  }

  return {
    days: classified.map(c => c.verdict),
    payableDays, paidDays, lopDays, lopFromLate, lopFromLeave,
    lateOccurrences: lateDays.length, leaveOccurrences: leaveDays.length,
    onRollDays, trace,
  }
}
