// ============================================================================
// A payroll cycle asks for every staff member's whole month at once, which for
// a school of any size is more rows than PostgREST will return in one reply.
// The cap does not surface as an error: the rows that fit come back looking
// perfectly valid, and the days that were cut off read as never marked — which
// the day-by-day derivation turns into Absent, inflating the pay cycle's Leave
// column and every LOP rupee under it. So the fetch pages, and this is the
// test that keeps it paging.
// ============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest'

const PAGE = 1000

/** Ranges the code under test asked for, in order. */
let requestedRanges: [number, number][] = []
/** Rows the fake table holds, keyed by nothing in particular — sliced by range. */
let tableRows: { staff_id: string; date: string; status: string }[] = []

// A minimal PostgREST query builder: every filter returns `this`, and awaiting
// it resolves the slice the last .range() asked for — capped, as the server
// would cap it.
vi.mock('./supabase', () => {
  const builder = {
    select: () => builder,
    in: () => builder,
    eq: () => builder,
    gte: () => builder,
    lte: () => builder,
    order: () => builder,
    range: (from: number, to: number) => {
      requestedRanges.push([from, to])
      const size = Math.min(to - from + 1, PAGE)
      return Promise.resolve({ data: tableRows.slice(from, from + size), error: null })
    },
  }
  return { supabase: { from: () => builder } }
})

const { fetchMonthlyAttendanceRecords } = await import('./attendance')

function rows(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    staff_id: `staff-${Math.floor(i / 25)}`,
    date: `2026-08-${String((i % 25) + 1).padStart(2, '0')}`,
    status: 'present',
  }))
}

describe('fetchMonthlyAttendanceRecords', () => {
  beforeEach(() => { requestedRanges = []; tableRows = [] })

  it('pages past the response cap instead of stopping at the first 1000 rows', async () => {
    tableRows = rows(1766) // 95 staff × a month, the shape that first hit this
    const out = await fetchMonthlyAttendanceRecords(['staff-0'], 2026, 8)

    expect(out).toHaveLength(1766)
    expect(requestedRanges).toEqual([[0, 999], [1000, 1999]])
  })

  it('stops after one round trip when the month fits in a single page', async () => {
    tableRows = rows(240)
    const out = await fetchMonthlyAttendanceRecords(['staff-0'], 2026, 8)

    expect(out).toHaveLength(240)
    expect(requestedRanges).toEqual([[0, 999]])
  })

  it('asks for one more page when the last one comes back exactly full', async () => {
    tableRows = rows(2000)
    const out = await fetchMonthlyAttendanceRecords(['staff-0'], 2026, 8)

    expect(out).toHaveLength(2000)
    expect(requestedRanges).toEqual([[0, 999], [1000, 1999], [2000, 2999]])
  })

  it('does not call out at all for an empty staff list', async () => {
    tableRows = rows(100)
    expect(await fetchMonthlyAttendanceRecords([], 2026, 8)).toEqual([])
    expect(requestedRanges).toEqual([])
  })
})
