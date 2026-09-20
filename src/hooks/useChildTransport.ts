'use client'

/**
 * The whole of a parent's transport state, in one hook.
 *
 * The account is shared — a parent signs in as their child — so "my child" is
 * simply the signed-in user, and every number here is about that one student.
 * The hook deliberately assembles a single object rather than exposing runs,
 * stops and boarding separately, because the screen's job is to answer one
 * question ("where is my child?") and splitting the state invites two parts of
 * the page to disagree about the answer.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import {
  fetchAlertsForRuns, fetchMyRunPassenger, fetchRunStops, fetchRunsForStudent, todayISO,
} from '@/lib/transport/runs'
import { fetchAssignmentForStudent } from '@/lib/transport/assignments'
import { fetchStops } from '@/lib/transport/stops'
import type {
  TransportAlert, TransportAssignment, TransportRun, TransportRunPassenger,
  TransportRunStop, TransportStop,
} from '@/lib/transport/types'

export interface ChildTransportState {
  loading: boolean
  /** Null when the child is not assigned to any route at all. */
  assignment: TransportAssignment | null
  /** Today's runs for their route, ordered by departure. */
  runs: TransportRun[]
  /** The run worth showing right now: live if there is one, else the next. */
  activeRun: TransportRun | null
  stops: TransportRunStop[]
  /** The child's own stop on the active run — the one the ETA is about. */
  myStop: TransportRunStop | null
  /** The child's boarding row on the active run. */
  me: TransportRunPassenger | null
  alerts: TransportAlert[]
  /** All stops on the route, for drawing the map. */
  routeStops: TransportStop[]
  reload: () => Promise<void>
}

function pickActive(runs: TransportRun[]): TransportRun | null {
  const live = runs.find(r => r.status === 'in_progress' || r.status === 'boarding')
  if (live) return live
  const upcoming = runs.find(r => r.status === 'scheduled')
  if (upcoming) return upcoming
  // Nothing pending: show the most recent finished run, so a parent checking
  // after school still sees that their child was dropped off.
  return runs.length > 0 ? runs[runs.length - 1] : null
}

export function useChildTransport(studentId: string | null): ChildTransportState {
  const [loading, setLoading] = useState(true)
  const [assignment, setAssignment] = useState<TransportAssignment | null>(null)
  const [runs, setRuns] = useState<TransportRun[]>([])
  const [stops, setStops] = useState<TransportRunStop[]>([])
  const [me, setMe] = useState<TransportRunPassenger | null>(null)
  const [alerts, setAlerts] = useState<TransportAlert[]>([])
  const [routeStops, setRouteStops] = useState<TransportStop[]>([])

  const activeRun = useMemo(() => pickActive(runs), [runs])

  const reload = useCallback(async () => {
    if (!studentId) { setLoading(false); return }

    const [a, todaysRuns] = await Promise.all([
      fetchAssignmentForStudent(studentId),
      fetchRunsForStudent(studentId, todayISO()),
    ])
    setAssignment(a)
    setRuns(todaysRuns)

    const active = pickActive(todaysRuns)
    if (!active) {
      setStops([]); setMe(null); setAlerts([])
      setRouteStops(a ? await fetchStops(a.route_id) : [])
      setLoading(false)
      return
    }

    const [runStops, mine, runAlerts, allStops] = await Promise.all([
      fetchRunStops(active.id),
      // Filtered in the query, not in the browser: the rest of the roster is
      // other people's children and must never be fetched here at all.
      fetchMyRunPassenger(active.id, studentId),
      fetchAlertsForRuns(todaysRuns.map(r => r.id)),
      fetchStops(active.route_id),
    ])
    setStops(runStops)
    setMe(mine)
    setAlerts(runAlerts)
    setRouteStops(allStops)
    setLoading(false)
  }, [studentId])

  useEffect(() => { setLoading(true); reload() }, [reload])

  // Live updates come off the run row, which the derivation trigger keeps
  // current — never off the telemetry firehose.
  useEffect(() => {
    if (!activeRun) return
    let alive = true
    const channel = supabase
      .channel(`child_transport_${activeRun.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'transport_trip_runs', filter: `id=eq.${activeRun.id}` },
        payload => {
          if (!alive) return
          setRuns(prev => prev.map(r =>
            r.id === activeRun.id ? { ...r, ...(payload.new as Partial<TransportRun>) } : r,
          ))
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'transport_run_stops', filter: `run_id=eq.${activeRun.id}` },
        () => { if (alive) fetchRunStops(activeRun.id).then(s => { if (alive) setStops(s) }) },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'transport_run_passengers', filter: `run_id=eq.${activeRun.id}` },
        () => {
          if (!alive || !studentId) return
          fetchMyRunPassenger(activeRun.id, studentId).then(row => {
            if (alive) setMe(row)
          })
        },
      )
      .subscribe()

    return () => { alive = false; supabase.removeChannel(channel) }
  }, [activeRun, studentId])

  const myStop = useMemo(() => {
    if (!me) return null
    const wanted = activeRun?.direction === 'inbound' ? me.board_stop_id : me.alight_stop_id
    return stops.find(s => s.stop_id === wanted) ?? null
  }, [me, stops, activeRun?.direction])

  return {
    loading, assignment, runs, activeRun, stops, myStop, me, alerts, routeStops, reload,
  }
}
