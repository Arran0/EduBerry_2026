// ─────────────────────────────────────────────────────────────────────────────
// Mid-year joiners.
//
// A student admitted in September should not be billed April's tuition. The
// school marks the entry prorated and gives a date; from there the engine
// charges each installment only for the part of its period the student is
// actually present for.
//
// The period an installment covers is the term it pays for, which runs from its
// own due date to the day before the next one — except the first, which reaches
// back to the start of the session (a bill due 10 April pays for April), and
// the last, which runs to the end of it.
// ─────────────────────────────────────────────────────────────────────────────

import { percentOf, type Paise } from './money'
import { daysInclusive, isBefore, maxDate, toEpochDay } from './dates'
import type { AcademicYear, Installment, IsoDate, ProrationDetail } from './types'

export interface Period {
  from: IsoDate
  to: IsoDate
}

/**
 * The period each installment covers, in `seq` order.
 *
 * Installments are sorted by due date rather than trusting `seq`, because a
 * school that reorders terms after the fact leaves seq and due date disagreeing
 * and the periods must follow the calendar, not the numbering.
 */
export function installmentPeriods(
  installments: Installment[],
  year: AcademicYear,
): Map<string, Period> {
  const ordered = [...installments].sort(
    (a, b) => toEpochDay(a.dueDate) - toEpochDay(b.dueDate) || a.seq - b.seq)

  const periods = new Map<string, Period>()
  ordered.forEach((inst, i) => {
    const isFirst = i === 0
    const isLast  = i === ordered.length - 1
    const from = isFirst ? year.startsOn : inst.dueDate
    const to   = isLast
      ? year.endsOn
      : addDayBefore(ordered[i + 1].dueDate)
    // A due date before the session opens, or a term that ends before it
    // begins, would give a negative period. Clamp to the session.
    periods.set(inst.id, {
      from: maxDate(from, year.startsOn),
      to:   isBefore(to, from) ? from : to,
    })
  })
  return periods
}

function addDayBefore(date: IsoDate): IsoDate {
  return new Date((toEpochDay(date) - 1) * 86_400_000).toISOString().slice(0, 10)
}

/**
 * What fraction of an installment a student joining on `from` should pay.
 *
 * 1 when they were there for the whole term, 0 when the term ended before they
 * arrived, and a day-count fraction in between.
 */
export function prorationFraction(period: Period, joinedOn: IsoDate): number {
  const periodDays = daysInclusive(period.from, period.to)
  if (periodDays <= 0) return 0
  // Joined before or on the first day of the term: pay for all of it.
  if (!isBefore(period.from, joinedOn)) return 1
  // Term already over when they joined: nothing to pay.
  if (isBefore(period.to, joinedOn)) return 0

  const chargedDays = daysInclusive(joinedOn, period.to)
  return chargedDays / periodDays
}

/** The prorated amount, plus the explanation that goes in the Why panel. */
export function prorate(
  fullAmount: Paise,
  period: Period,
  joinedOn: IsoDate,
  installmentName: string,
): { amount: Paise; detail: ProrationDetail | null } {
  const fraction = prorationFraction(period, joinedOn)
  if (fraction >= 1) return { amount: fullAmount, detail: null }

  const periodDays  = daysInclusive(period.from, period.to)
  const chargedDays = fraction <= 0 ? 0 : daysInclusive(maxDate(period.from, joinedOn), period.to)
  const amount = percentOf(fullAmount, fraction * 100)

  return {
    amount,
    detail: {
      fromDate: joinedOn,
      chargedDays,
      periodDays,
      fraction,
      fullAmount,
      why: chargedDays === 0
        ? `${installmentName} covers ${period.from} to ${period.to}, which ended before the student joined on ${joinedOn}. Not charged.`
        : `${installmentName} covers ${period.from} to ${period.to} (${periodDays} days). The student joined on ${joinedOn}, so ${chargedDays} of those days are charged.`,
    },
  }
}
