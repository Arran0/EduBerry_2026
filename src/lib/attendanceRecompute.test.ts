// ============================================================================
// Retroactive attendance recompute — the client half of the "don't recompute
// every time" rule.
//
// The database half is the dirty queue: nothing is re-derived unless a cutoff,
// holiday or non-working-day rule actually changed. The half that lives here is
// that a single page load must not fire the drain once per component that reads
// attendance. The attendance report, the salary summary and a cycle sheet can
// all mount together, and three concurrent drains would each claim a slice of
// the queue and recompute in parallel for one answer nobody asked three times.
//
// So the tests below pin the two things the wrapper is actually responsible
// for: one request per burst, and a stale-but-working page rather than a broken
// one when the RPC is missing (a deployment that has not run the migration).
// ============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest'

/** Every `rpc(name, args)` the code under test made, in order. */
let rpcCalls: string[] = []
/** What the fake RPC resolves to — swapped per test. */
let rpcResult: { data: unknown; error: unknown } = { data: null, error: null }
/** Set by a test that wants to hold the RPC open; resolving it lets calls finish. */
let gate: Promise<void> | null = null

vi.mock('./supabase', () => ({
  supabase: {
    rpc: async (name: string) => {
      rpcCalls.push(name)
      if (gate) await gate
      return rpcResult
    },
  },
}))

const { recomputePendingAttendance } = await import('./attendance')

describe('recomputePendingAttendance', () => {
  beforeEach(() => {
    rpcCalls = []
    rpcResult = { data: [{ dates_processed: 3, records_updated: 7 }], error: null }
    gate = null
  })

  it('reports the dates re-derived and the statuses that actually moved', async () => {
    expect(await recomputePendingAttendance()).toEqual({ datesProcessed: 3, recordsUpdated: 7 })
    expect(rpcCalls).toEqual(['attendance_recompute_pending'])
  })

  it('reads an empty queue as no work rather than as a failure', async () => {
    rpcResult = { data: [{ dates_processed: 0, records_updated: 0 }], error: null }
    expect(await recomputePendingAttendance()).toEqual({ datesProcessed: 0, recordsUpdated: 0 })
  })

  it('makes one request for every caller that asks while it is still in flight', async () => {
    // Hold the RPC open so all three callers overlap, the way three components
    // mounting on one page load do.
    let open = () => {}
    gate = new Promise<void>(resolve => { open = resolve })

    const calls = [
      recomputePendingAttendance(),
      recomputePendingAttendance(),
      recomputePendingAttendance(),
    ]
    open()

    const results = await Promise.all(calls)
    expect(rpcCalls).toEqual(['attendance_recompute_pending'])
    for (const r of results) expect(r).toEqual({ datesProcessed: 3, recordsUpdated: 7 })
  })

  it('runs again for a later burst, so a second rule change is not swallowed', async () => {
    await recomputePendingAttendance()
    await recomputePendingAttendance()
    expect(rpcCalls).toHaveLength(2)
  })

  it('leaves the page on the stored statuses when the RPC is not there yet', async () => {
    // A deployment that has not run attendance_retroactive_recompute.sql. The
    // statuses are stale, which is exactly how they behaved before any of this
    // existed — the caller carries on rather than failing to render.
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    rpcResult = { data: null, error: { message: 'function does not exist' } }

    expect(await recomputePendingAttendance()).toEqual({ datesProcessed: 0, recordsUpdated: 0 })
    expect(errors).toHaveBeenCalled()
    errors.mockRestore()
  })

  it('does not wedge every later caller when one call fails', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    rpcResult = { data: null, error: { message: 'boom' } }
    await recomputePendingAttendance()
    errors.mockRestore()

    rpcResult = { data: [{ dates_processed: 1, records_updated: 2 }], error: null }
    expect(await recomputePendingAttendance()).toEqual({ datesProcessed: 1, recordsUpdated: 2 })
  })
})
