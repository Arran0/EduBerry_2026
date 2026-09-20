// ─────────────────────────────────────────────────────────────────────────────
// Dates as strings.
//
// A due date is a calendar day, not an instant. Parsing '2026-04-10' with
// `new Date()` gives midnight UTC, which in IST is 05:30 on the 10th — fine —
// but formatting it back with any local-time method in a negative-offset
// timezone gives the 9th. A school in India running the app from a laptop set
// to another timezone would see bills fall due a day early.
//
// So the engine never converts a date to a Date object for arithmetic. It works
// on 'YYYY-MM-DD' strings via UTC-only helpers, which cannot drift.
// ─────────────────────────────────────────────────────────────────────────────

import type { IsoDate } from './types'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export function isIsoDate(value: unknown): value is IsoDate {
  return typeof value === 'string' && DATE_RE.test(value)
}

/** Days since the epoch. The engine's only numeric view of a date. */
export function toEpochDay(date: IsoDate): number {
  if (!isIsoDate(date)) throw new Error(`Not a YYYY-MM-DD date: ${date}`)
  const [y, m, d] = date.split('-').map(Number)
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000)
}

export function fromEpochDay(day: number): IsoDate {
  return new Date(day * 86_400_000).toISOString().slice(0, 10)
}

/** Inclusive of neither end: the count of days you move from a to b. */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  return toEpochDay(to) - toEpochDay(from)
}

/** Inclusive of both ends — "how many days does this period cover". */
export function daysInclusive(from: IsoDate, to: IsoDate): number {
  return daysBetween(from, to) + 1
}

export function addDays(date: IsoDate, days: number): IsoDate {
  return fromEpochDay(toEpochDay(date) + days)
}

export function maxDate(a: IsoDate, b: IsoDate): IsoDate {
  return toEpochDay(a) >= toEpochDay(b) ? a : b
}


export function isBefore(a: IsoDate, b: IsoDate): boolean {
  return toEpochDay(a) < toEpochDay(b)
}


/** Today in a named IANA zone, as a date string. Defaults to the school's zone. */
export function todayIn(timeZone = 'Asia/Kolkata', now: Date = new Date()): IsoDate {
  // en-CA formats as YYYY-MM-DD, which is exactly the shape we want and avoids
  // hand-rolling the padding.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now)
}
