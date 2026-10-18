import { describe, expect, it, vi } from 'vitest'

vi.mock('../supabase', () => ({ supabase: {} }))

import { academicMonths, calendarMonths, chartYearFor, resolveRiderFee, riderStopId, type StopFee } from './fees'

const grid: Record<string, StopFee> = {
  near: { stop_id: 'near', route_id: 'r', amount: 800 },
  far: { stop_id: 'far', route_id: 'r', amount: 1200 },
  free: { stop_id: 'free', route_id: 'r', amount: null },
}

const rider = (o: Partial<Parameters<typeof resolveRiderFee>[0]> = {}) => ({
  pickup_stop_id: 'near', drop_stop_id: null, fee_amount: null, ...o,
})

describe('resolveRiderFee', () => {
  it('bills nobody until the route has a pricing mode', () => {
    expect(resolveRiderFee(rider({ fee_amount: 650 }), grid, null)).toMatchObject({ amount: null, source: 'unset' })
  })

  it('by stop: the rider pays their stop’s price', () => {
    expect(resolveRiderFee(rider(), grid, 'stop')).toMatchObject({ amount: 800, source: 'stop', stopId: 'near' })
    expect(resolveRiderFee(rider({ pickup_stop_id: 'far' }), grid, 'stop')).toMatchObject({ amount: 1200 })
  })

  it('by stop: a student amount is ignored', () => {
    expect(resolveRiderFee(rider({ fee_amount: 1 }), grid, 'stop')).toMatchObject({ amount: 800, source: 'stop' })
  })

  it('by stop: an unpriced stop or no stop is missing, never guessed', () => {
    expect(resolveRiderFee(rider({ pickup_stop_id: 'free' }), grid, 'stop')).toMatchObject({ amount: null, source: 'missing' })
    expect(resolveRiderFee(rider({ pickup_stop_id: null }), grid, 'stop')).toMatchObject({ amount: null, source: 'missing' })
  })

  it('by stop: a from-school rider with only a drop stop is priced from it', () => {
    expect(resolveRiderFee(rider({ pickup_stop_id: null, drop_stop_id: 'far' }), grid, 'stop')).toMatchObject({ amount: 1200, stopId: 'far' })
  })

  it('by student: the rider’s own amount, including zero', () => {
    expect(resolveRiderFee(rider({ fee_amount: 650 }), grid, 'student')).toMatchObject({ amount: 650, source: 'student' })
    expect(resolveRiderFee(rider({ fee_amount: 0 }), grid, 'student')).toMatchObject({ amount: 0, source: 'student' })
    expect(resolveRiderFee(rider(), grid, 'student')).toMatchObject({ amount: null, source: 'missing' })
  })
})

describe('riderStopId', () => {
  it('prefers the pickup stop, then the drop stop', () => {
    expect(riderStopId({ pickup_stop_id: 'a', drop_stop_id: 'b' })).toBe('a')
    expect(riderStopId({ pickup_stop_id: null, drop_stop_id: 'b' })).toBe('b')
    expect(riderStopId({ pickup_stop_id: null, drop_stop_id: null })).toBeNull()
  })
})

describe('academicMonths', () => {
  it('runs April to March', () => {
    const m = academicMonths('2026-27')
    expect(m).toHaveLength(12)
    expect(m[0]).toBe('2026-04')
    expect(m[8]).toBe('2026-12')
    expect(m[9]).toBe('2027-01')
    expect(m[11]).toBe('2027-03')
  })
})

describe('calendarMonths', () => {
  it('runs January to December', () => {
    const m = calendarMonths(2026)
    expect(m).toHaveLength(12)
    expect(m[0]).toBe('2026-01')
    expect(m[11]).toBe('2026-12')
  })
})

describe('chartYearFor', () => {
  const s2627 = { starts_on: '2026-04-01', ends_on: '2027-03-31' }
  it('shows this year while the session reaches into it', () => {
    expect(chartYearFor(s2627, new Date(2026, 9, 18))).toBe(2026)
    expect(chartYearFor(s2627, new Date(2027, 1, 2))).toBe(2027)
  })
  it('shows the starting year of a session that does not reach this year', () => {
    expect(chartYearFor({ starts_on: '2024-04-01', ends_on: '2025-03-31' }, new Date(2026, 9, 18))).toBe(2024)
    expect(chartYearFor({ starts_on: '2027-04-01', ends_on: '2028-03-31' }, new Date(2026, 9, 18))).toBe(2027)
  })
})
