import { describe, expect, it, vi } from 'vitest'

vi.mock('../supabase', () => ({ supabase: {} }))

import { academicMonths, resolveRiderFee, type StopFee } from './fees'

const grid: Record<string, StopFee> = {
  near: { stop_id: 'near', route_id: 'r', amount_round: 800, amount_one_way: 500 },
  far: { stop_id: 'far', route_id: 'r', amount_round: 1200, amount_one_way: null },
  free: { stop_id: 'free', route_id: 'r', amount_round: null, amount_one_way: null },
}

const rider = (o: Partial<Parameters<typeof resolveRiderFee>[0]> = {}) => ({
  pickup_stop_id: 'near', drop_stop_id: null, rides_inbound: true, rides_outbound: true, fee_amount: null, ...o,
})

describe('resolveRiderFee', () => {
  it('a custom amount beats the grid', () => {
    expect(resolveRiderFee(rider({ fee_amount: 650 }), grid)).toMatchObject({ amount: 650, source: 'custom' })
  })

  it('both ways pays the round-trip price of the dearer stop', () => {
    expect(resolveRiderFee(rider({ drop_stop_id: 'far' }), grid)).toMatchObject({ amount: 1200, source: 'grid', basis: 'round', stopId: 'far' })
    expect(resolveRiderFee(rider(), grid)).toMatchObject({ amount: 800, basis: 'round' })
  })

  it('one way pays the one-way price of that direction’s stop', () => {
    expect(resolveRiderFee(rider({ rides_outbound: false }), grid)).toMatchObject({ amount: 500, basis: 'one_way', stopId: 'near' })
    // Evening only: priced from the drop stop.
    expect(resolveRiderFee(rider({ rides_inbound: false, drop_stop_id: 'far' }), grid)).toMatchObject({ amount: 1200, basis: 'round', stopId: 'far' })
  })

  it('falls back to the round-trip price when no one-way price is set', () => {
    expect(resolveRiderFee(rider({ pickup_stop_id: 'far', rides_outbound: false }), grid)).toMatchObject({ amount: 1200, basis: 'round' })
  })

  it('reports a missing price rather than guessing', () => {
    expect(resolveRiderFee(rider({ pickup_stop_id: 'free' }), grid)).toMatchObject({ amount: null, source: 'missing' })
    expect(resolveRiderFee(rider({ pickup_stop_id: null }), grid)).toMatchObject({ amount: null, source: 'missing' })
  })

  it('treats a zero custom amount as a real amount', () => {
    expect(resolveRiderFee(rider({ fee_amount: 0 }), grid)).toMatchObject({ amount: 0, source: 'custom' })
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
