import { describe, it, expect } from 'vitest'
import {
  normalizeYearCode, deriveYearCode, defaultYearDates, sessionProgress,
  yearForDate, yearByCode, type AcademicYearRow,
} from './academicYear'
import { formatSeriesNumber } from './fees/settings'

const year = (code: string, starts_on: string, ends_on: string, is_active = false): AcademicYearRow => ({
  id: `y-${code}`, code, starts_on, ends_on, is_active,
  status: is_active ? 'active' : 'planning', promoted_at: null, notes: null,
})

const YEARS = [
  year('2027-28', '2027-04-01', '2028-03-31'),
  year('2026-27', '2026-04-01', '2027-03-31', true),
  year('2025-26', '2025-04-01', '2026-03-31'),
]

describe('year code normalisation', () => {
  it('accepts the two spellings already in the database', () => {
    expect(normalizeYearCode('2026-27')).toBe('2026-27')
    expect(normalizeYearCode('2026-2027')).toBe('2026-27')
  })

  it('expands a bare start year', () => {
    expect(normalizeYearCode('2026')).toBe('2026-27')
    expect(normalizeYearCode('2099')).toBe('2099-00')
  })

  it('passes anything else through untouched rather than inventing a year', () => {
    expect(normalizeYearCode('not-a-year')).toBe('not-a-year')
    expect(normalizeYearCode(null)).toBeNull()
    expect(normalizeYearCode('')).toBeNull()
  })
})

describe('the Apr–Mar fallback', () => {
  it('puts April onward in the year that starts then', () => {
    expect(deriveYearCode('2026-04-01')).toBe('2026-27')
    expect(deriveYearCode('2026-12-31')).toBe('2026-27')
  })

  it('puts January to March in the year that started the previous April', () => {
    // This is the case the old getAcademicYear() in homeroomAutoManage.ts got
    // wrong: it returned 2027-28 for any date in 2027.
    expect(deriveYearCode('2027-01-15')).toBe('2026-27')
    expect(deriveYearCode('2027-03-31')).toBe('2026-27')
    expect(deriveYearCode('2027-04-01')).toBe('2027-28')
  })
})

describe('default dates', () => {
  it('spans 1 April to 31 March', () => {
    expect(defaultYearDates('2026-27')).toEqual({ starts_on: '2026-04-01', ends_on: '2027-03-31' })
  })

  it('refuses a code it cannot parse rather than guessing', () => {
    expect(defaultYearDates('rubbish')).toBeNull()
  })
})

describe('lookups', () => {
  it('finds the session a date falls in', () => {
    expect(yearForDate(YEARS, '2026-09-04')?.code).toBe('2026-27')
    expect(yearForDate(YEARS, '2027-03-31')?.code).toBe('2026-27')
    expect(yearForDate(YEARS, '2027-04-01')?.code).toBe('2027-28')
  })

  it('returns null for a date no stored session covers', () => {
    expect(yearForDate(YEARS, '2019-06-01')).toBeNull()
  })

  it('finds by code through either spelling', () => {
    expect(yearByCode(YEARS, '2026-2027')?.id).toBe('y-2026-27')
  })
})

describe('session progress', () => {
  it('is 0 at the start and 1 at the end', () => {
    const y = YEARS[1]
    expect(sessionProgress(y, '2026-04-01')).toBe(0)
    expect(sessionProgress(y, '2027-03-31')).toBe(1)
  })

  it('is about half by the start of October', () => {
    // This is the marker on the Collection Center's efficiency bar: "62%
    // collected" only means something next to how far through the year it is.
    const p = sessionProgress(YEARS[1], '2026-10-01')
    expect(p).toBeGreaterThan(0.49)
    expect(p).toBeLessThan(0.52)
  })

  it('clamps outside the session rather than going negative', () => {
    expect(sessionProgress(YEARS[1], '2025-01-01')).toBe(0)
    expect(sessionProgress(YEARS[1], '2030-01-01')).toBe(1)
  })
})

describe('receipt numbering preview', () => {
  const numbering = {
    prefix: 'RCP', width: 4, include_year: true, reset: 'year' as const,
  }

  it('builds the number the school will see printed', () => {
    expect(formatSeriesNumber(numbering, 'MPS', '/', '2026-27', 1)).toBe('MPS/RCP/26-27/0001')
  })

  it('drops the parts a school switches off', () => {
    expect(formatSeriesNumber({ ...numbering, include_year: false }, 'MPS', '/', '2026-27', 42))
      .toBe('MPS/RCP/0042')
    expect(formatSeriesNumber({ ...numbering, prefix: '' }, '', '-', '2026-27', 7))
      .toBe('26-27-0007')
  })

  it('does not truncate a sequence that outgrows its width', () => {
    expect(formatSeriesNumber({ ...numbering, width: 2 }, 'MPS', '/', '2026-27', 12345))
      .toContain('12345')
  })
})
