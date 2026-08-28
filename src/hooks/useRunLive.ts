'use client'

/**
 * Live view of one trip run.
 *
 * Seed from the current row, then subscribe to changes — the same
 * seed-then-subscribe shape the leave and (former) bus-location hooks use, so
 * the screen is correct on first paint rather than empty until the first event.
 *
 * The subscription is on `transport_trip_runs`, not on the telemetry table.
 * Publishing every GPS fix would push the whole firehose through the WAL
 * fan-out to every parent; the run row already carries the summary the
 * derivation trigger maintains, which is all a screen needs.
 */

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { fetchRun, fetchRunPassengers, fetchRunStops } from '@/lib/transport/runs'
import type { TransportRun, TransportRunPassenger, TransportRunStop } from '@/lib/transport/types'

export interface RunLive {
  run: TransportRun | null
  stops: TransportRunStop[]
  passengers: TransportRunPassenger[]
  loading: boolean
  reload: () => Promise<void>
}

export function useRunLive(runId: string | null, opts: { withPassengers?: boolean } = {}): RunLive {
  const withPassengers = opts.withPassengers ?? false
  const [run, setRun] = useState<TransportRun | null>(null)
  const [stops, setStops] = useState<TransportRunStop[]>([])
  const [passengers, setPassengers] = useState<TransportRunPassenger[]>([])
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    if (!runId) { setRun(null); setStops([]); setPassengers([]); setLoading(false); return }
    const [r, s, p] = await Promise.all([
      fetchRun(runId),
      fetchRunStops(runId),
      withPassengers ? fetchRunPassengers(runId) : Promise.resolve([]),
    ])
    setRun(r); setStops(s); setPassengers(p); setLoading(false)
  }, [runId, withPassengers])

  useEffect(() => { setLoading(true); reload() }, [reload])

  useEffect(() => {
    if (!runId) return
    let active = true

    const channel = supabase
      .channel(`transport_run_${runId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'transport_trip_runs', filter: `id=eq.${runId}` },
        payload => {
          if (!active) return
          // Merge rather than replace: the realtime payload is the bare row and
          // would drop the embedded route/vehicle/crew the screen renders.
          setRun(prev => (prev ? { ...prev, ...(payload.new as Partial<TransportRun>) } : prev))
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'transport_run_stops', filter: `run_id=eq.${runId}` },
        () => { if (active) fetchRunStops(runId).then(s => { if (active) setStops(s) }) },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'transport_run_passengers', filter: `run_id=eq.${runId}` },
        () => {
          if (!active || !withPassengers) return
          fetchRunPassengers(runId).then(p => { if (active) setPassengers(p) })
        },
      )
      .subscribe()

    return () => { active = false; supabase.removeChannel(channel) }
  }, [runId, withPassengers])

  return { run, stops, passengers, loading, reload }
}
