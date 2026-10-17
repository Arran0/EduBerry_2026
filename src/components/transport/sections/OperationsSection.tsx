'use client'

/**
 * Operations — what is happening right now, on one screen.
 *
 *   toolbar (replay · incidents · reports | live)  →  the fleet map
 *   →  today's trips, worst first, under one live rider bar  |  needs attention
 *   →  bus fees by month
 *
 * The rider bar is the page's headline: picked up, dropped off, and neither,
 * for the whole fleet — or, while the pointer rests on a trip, for that trip.
 * It refreshes every thirty seconds; the run rows themselves also arrive over
 * realtime, so a bus going silent shows up without waiting for the tick.
 *
 * Bus-vs-class clashes and GPS trouble no longer have cards of their own. They
 * are only interesting when they are happening, so they appear in Needs
 * attention when there is an actual case and are absent otherwise.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import {
  AlertTriangle, BarChart3, Bus, Check, CheckCheck, ChevronLeft, ChevronRight, History,
  Loader2, Phone, Radio, RefreshCw, ShieldAlert, Users, WifiOff, Wallet, X, Clock, Gauge,
} from 'lucide-react'
import Modal from '../BusModal'
import { supabase } from '@/lib/supabase'
import { fmtINR, fmtINRExact } from '@/lib/formatMoney'
import {
  acknowledgeAlert, fetchOpenAlerts, fetchRunRiderCounts, fetchTodayRuns, fixAgeSeconds,
  formatClock, materialiseRuns, OPEN_ALERTS_PAGE, relativeMinutes, resolveAlert, todayISO,
  type RunRiderCounts,
} from '@/lib/transport/runs'
import { fetchTodaySnapshot, seatEfficiency, type TodaySnapshot } from '@/lib/transport/snapshot'
import { fetchAttendanceMismatch, type MismatchRow } from '@/lib/transport/reports'
import { academicMonths, fetchMonthlyBusFees, type MonthFeePosition } from '@/lib/transport/fees'
import { currentAcademicYear, listBusAcademicYears } from '@/lib/bus'
import { vehicleLabel } from '@/lib/transport/vehicles'
import { fetchSchoolLocation, type SchoolLocation } from '@/lib/transport/settings'
import type { TransportAlert, TransportRun } from '@/lib/transport/types'
import { ALERT_TYPE_LABELS, DIRECTION_LABELS, RUN_STATUS_LABELS } from '@/lib/transport/types'
import {
  BUS, CardHead, Content, EASE, EmptyNote, GBTN, GlassButtonGroup, GlassPanel, LiveDot,
} from '../glass'

const ReportsSection = dynamic(() => import('./ReportsSection'))

const TransportMap = dynamic(() => import('../TransportMap'), {
  ssr: false,
  loading: () => (
    <div className="h-[320px] md:h-[420px] lg:h-[min(54vh,36rem)] rounded-[18px] bg-white/60 flex items-center justify-center">
      <Loader2 className="animate-spin text-slate-400" size={20} />
    </div>
  ),
})

/** How often the rider counts are re-read. The run rows also stream in live. */
const REFRESH_MS = 30_000

const ON_ROAD = new Set(['boarding', 'in_progress'])
const FINISHED = new Set(['completed', 'cancelled', 'missed', 'abandoned'])

interface Tally { expected: number; picked: number; dropped: number; excused: number }

function tallyOf(c: RunRiderCounts | undefined): Tally {
  return { expected: c?.expected ?? 0, picked: c?.boarded ?? 0, dropped: c?.dropped ?? 0, excused: c?.excused ?? 0 }
}

/** Expected riders not yet picked up (approved leave excluded). */
const neither = (t: Tally) => Math.max(0, t.expected - t.picked - t.excused)

export default function OperationsSection({ onOpenPanel, onOpenFees, onSetSchool }: {
  onOpenPanel: (key: 'replay' | 'incidents') => void
  onOpenFees: () => void
  /** Takes the admin to where the school's location is set (Configuration). */
  onSetSchool: () => void
}) {
  const [runs, setRuns] = useState<TransportRun[]>([])
  const [riders, setRiders] = useState<Record<string, RunRiderCounts>>({})
  const [alerts, setAlerts] = useState<TransportAlert[]>([])
  const [alertTotal, setAlertTotal] = useState(0)
  const [loadingMoreAlerts, setLoadingMoreAlerts] = useState(false)
  const [snapshot, setSnapshot] = useState<TodaySnapshot | null>(null)
  const [clashes, setClashes] = useState<MismatchRow[]>([])
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [hoverRunId, setHoverRunId] = useState<string | null>(null)
  const [reportsOpen, setReportsOpen] = useState(false)
  // The map opens on the school: the location set in Configuration, else the
  // attendance geofence. undefined while loading, null when there is none.
  const [school, setSchool] = useState<SchoolLocation | null | undefined>(undefined)
  useEffect(() => { fetchSchoolLocation().then(setSchool) }, [])

  const runIds = useRef<Set<string>>(new Set())
  useEffect(() => { runIds.current = new Set(runs.map(r => r.id)) }, [runs])
  const loadedAlerts = useRef(0)
  useEffect(() => { loadedAlerts.current = alerts.length }, [alerts])

  /**
   * Today's runs are made by the nightly job. The morning after someone sets
   * up schedules for the first time there are none yet, so this screen makes
   * them — once per mount, only when today genuinely has none.
   */
  const triedMaterialise = useRef(false)

  /** The thirty-second tick: runs, rider counts, today's clashes and the snapshot. */
  const refresh = useCallback(async () => {
    const today = todayISO()
    const [r, s, m] = await Promise.all([
      fetchTodayRuns(), fetchTodaySnapshot(), fetchAttendanceMismatch(today, today),
    ])
    const counts = await fetchRunRiderCounts(r.map(x => x.id))
    setRuns(r); setSnapshot(s); setClashes(m); setRiders(counts)
    setUpdatedAt(new Date())
    return r
  }, [])

  const load = useCallback(async () => {
    const [r, a] = await Promise.all([refresh(), fetchOpenAlerts()])
    setAlerts(a.alerts); setAlertTotal(a.total)
    setLoading(false)

    if (r.length === 0 && !triedMaterialise.current) {
      triedMaterialise.current = true
      const res = await materialiseRuns(todayISO())
      if (res.success && (res.created ?? 0) > 0) await refresh()
    }
  }, [refresh])

  useEffect(() => { load() }, [load])

  // The tick. Paused while the tab is hidden — nobody is watching, and a
  // background tab polling all day is a cost with no reader.
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') refresh()
    }, REFRESH_MS)
    const onVisible = () => { if (document.visibilityState === 'visible') refresh() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVisible) }
  }, [refresh])

  // Run rows and alerts over realtime, coalesced so a burst is one query.
  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setTimeout> | null = null
    let alertTimer: ReturnType<typeof setTimeout> | null = null

    const refetchRuns = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => { if (alive) fetchTodayRuns().then(r => { if (alive) setRuns(r) }) }, 400)
    }
    const refetchAlerts = () => {
      if (alertTimer) clearTimeout(alertTimer)
      alertTimer = setTimeout(() => {
        if (!alive) return
        const span = Math.max(OPEN_ALERTS_PAGE, loadedAlerts.current)
        fetchOpenAlerts(span, 0).then(a => {
          if (!alive) return
          setAlerts(a.alerts); setAlertTotal(a.total)
        })
      }, 400)
    }

    const channel = supabase
      .channel('transport_ops')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'transport_trip_runs' },
        payload => {
          if (!alive) return
          const next = payload.new as TransportRun
          if (!runIds.current.has(next.id)) { refetchRuns(); return }
          setRuns(prev => prev.map(r => (r.id === next.id ? { ...r, ...next } : r)))
        })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'transport_trip_runs' }, refetchRuns)
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'transport_trip_runs' }, refetchRuns)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transport_alerts' }, refetchAlerts)
      .subscribe()

    return () => {
      alive = false
      if (timer) clearTimeout(timer)
      if (alertTimer) clearTimeout(alertTimer)
      supabase.removeChannel(channel)
    }
  }, [])

  const manualRefresh = async () => {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }

  const ackAlert = useCallback(async (id: string) => {
    const before = alerts
    setAlerts(prev => prev.map(a => (a.id === id ? { ...a, status: 'acknowledged' as const } : a)))
    if (!(await acknowledgeAlert(id)).success) setAlerts(before)
  }, [alerts])

  const dismissAlert = useCallback(async (id: string) => {
    const before = alerts
    setAlerts(prev => prev.filter(a => a.id !== id))
    setAlertTotal(n => Math.max(0, n - 1))
    if (!(await resolveAlert(id)).success) { setAlerts(before); setAlertTotal(n => n + 1) }
  }, [alerts])

  const loadMoreAlerts = useCallback(async () => {
    setLoadingMoreAlerts(true)
    const next = await fetchOpenAlerts(OPEN_ALERTS_PAGE, alerts.length)
    setAlerts(prev => {
      const seen = new Set(prev.map(a => a.id))
      return [...prev, ...next.alerts.filter(a => !seen.has(a.id))]
    })
    setAlertTotal(next.total)
    setLoadingMoreAlerts(false)
  }, [alerts.length])

  const onRoad = useMemo(() => runs.filter(r => ON_ROAD.has(r.status)), [runs])

  /**
   * Worst first. Silent and late, then silent, then late, then riders still
   * waiting on a bus that is moving; trips not yet started next, finished ones
   * last. Within a tier the biggest delay, then the most children unaccounted.
   */
  const sortedRuns = useMemo(() => {
    const rank = (r: TransportRun) => {
      if (FINISHED.has(r.status)) return 9
      if (r.status === 'scheduled') return 6
      const silent = r.telemetry_state !== 'live'
      const late = (r.delay_seconds ?? 0) > 300
      if (silent && late) return 0
      if (silent) return 1
      if (late) return 2
      if (neither(tallyOf(riders[r.id])) > 0) return 3
      return 4
    }
    return [...runs].sort((a, b) =>
      rank(a) - rank(b)
      || (b.delay_seconds ?? 0) - (a.delay_seconds ?? 0)
      || neither(tallyOf(riders[b.id])) - neither(tallyOf(riders[a.id]))
      || a.scheduled_start_at.localeCompare(b.scheduled_start_at))
  }, [runs, riders])

  const fleet = useMemo<Tally>(() => {
    const t: Tally = { expected: 0, picked: 0, dropped: 0, excused: 0 }
    for (const r of runs) {
      const c = tallyOf(riders[r.id])
      t.expected += c.expected; t.picked += c.picked; t.dropped += c.dropped; t.excused += c.excused
    }
    return t
  }, [runs, riders])

  const focusId = hoverRunId ?? selectedRunId
  const focusRun = focusId ? runs.find(r => r.id === focusId) ?? null : null
  const shownTally = focusRun ? tallyOf(riders[focusRun.id]) : fleet

  const mapBuses = useMemo(
    () => onRoad
      .filter(r => r.last_lat != null && r.last_lng != null)
      .map(r => ({
        id: r.id,
        lat: r.last_lat as number,
        lng: r.last_lng as number,
        label: `${r.route?.name ?? 'Route'} · ${DIRECTION_LABELS[r.direction]}`,
        detail: `${vehicleLabel(r.vehicle)} · ${r.driver?.full_name ?? 'No driver'}`,
        color: r.route?.color ?? BUS.gold,
        live: r.telemetry_state === 'live',
        late: (r.delay_seconds ?? 0) > 300,
      })),
    [onRoad],
  )

  // ── Needs attention: the live alerts plus the cases this screen can see. ──
  const attention = useMemo(() => {
    const items: AttentionItem[] = []
    for (const c of clashes) {
      const key = `clash:${c.student_id}:${c.service_date}`
      items.push({
        key,
        tone: 'warning',
        kind: 'Bus vs class',
        title: `${c.student_name} boarded but is marked absent`,
        detail: `${c.route_name ?? 'Bus'} this morning · no leave on file. Worth a call home.`,
        phone: c.guardian_phone,
      })
    }
    // A bus that has gone quiet on the road, unless the database has already
    // raised an alert for it (no point saying it twice).
    const alerted = new Set(alerts
      .filter(a => a.run_id && (a.type === 'no_gps' || a.type === 'device_offline'))
      .map(a => a.run_id as string))
    for (const r of onRoad) {
      if (r.telemetry_state === 'live' || alerted.has(r.id)) continue
      const age = fixAgeSeconds(r)
      items.push({
        key: `gps:${r.id}`,
        tone: 'critical',
        kind: 'GPS',
        title: `${r.route?.name ?? 'A bus'} has stopped reporting`,
        detail: age != null
          ? `Last position ${Math.round(age / 60)} min ago from ${vehicleLabel(r.vehicle)}.`
          : `No position yet from ${vehicleLabel(r.vehicle)} since the trip started.`,
        runId: r.id,
      })
    }
    const cov = snapshot?.gps_avg_coverage_pct
    if (cov != null && cov < 70) {
      items.push({
        key: 'gps:coverage',
        tone: 'warning',
        kind: 'GPS',
        title: `GPS coverage is only ${cov}%`,
        detail: `Averaged over the last ${snapshot?.gps_days ?? 0} day${snapshot?.gps_days === 1 ? '' : 's'}. Check the devices on the worst buses in Reports.`,
        onOpen: () => setReportsOpen(true),
        openLabel: 'Reports',
      })
    }
    return items.filter(i => !hidden.has(i.key))
  }, [clashes, alerts, onRoad, snapshot, hidden])

  const criticalAlerts = alerts.filter(a => a.severity === 'critical')
  const otherAlerts = alerts.filter(a => a.severity !== 'critical')
  const attentionCount = attention.length + alertTotal

  const seats = snapshot ? seatEfficiency(snapshot) : null

  return (
    <div className="space-y-5">
      {/* ── Toolbar: replay & incidents above the map ───────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <GlassButtonGroup
          items={[
            { key: 'replay', label: 'Replay', icon: History, onClick: () => onOpenPanel('replay') },
            { key: 'incidents', label: 'Incidents', icon: ShieldAlert, onClick: () => onOpenPanel('incidents') },
            { key: 'reports', label: 'Reports', icon: BarChart3, onClick: () => setReportsOpen(true) },
          ]}
        />
        <div className="lg-pill flex items-center gap-2.5 h-10 pl-3.5 pr-1.5">
          <LiveDot tone={onRoad.length > 0 ? 'live' : 'idle'} label={onRoad.length > 0 ? 'Live' : 'Idle'} />
          <span className="w-px h-3.5 bg-slate-300" />
          <span className="text-xs font-semibold text-slate-700 tabular-nums">
            {loading ? 'Loading…' : `${onRoad.length} on the road`}
          </span>
          {snapshot && snapshot.runs_stale > 0 && (
            <span className="hidden sm:inline-flex items-center gap-1 text-xs font-semibold text-rose-600">
              <WifiOff size={12} /> {snapshot.runs_stale} silent
            </span>
          )}
          {updatedAt && (
            <span className="hidden md:inline text-[11px] text-slate-500 tabular-nums">
              · {updatedAt.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', second: '2-digit' })}
            </span>
          )}
          <button onClick={manualRefresh} disabled={refreshing} className={GBTN.icon} aria-label="Refresh now" title="Refresh now">
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* ── The fleet map ─────────────────────────────────────────── */}
      <GlassPanel>
        <div className="relative rounded-[18px] overflow-hidden shadow-[0_1px_2px_rgba(15,23,42,.06),0_16px_32px_-22px_rgba(15,23,42,.45)]">
          <TransportMap
            school={school ?? null}
            buses={mapBuses}
            selectedBusId={selectedRunId}
            onBusClick={id => setSelectedRunId(id === selectedRunId ? null : id)}
            showFences={false}
            heightClass="h-[320px] md:h-[420px] lg:h-[min(54vh,36rem)]"
          />
          {school === null && (
            <div className="absolute left-3 right-3 top-3 z-[1000] flex justify-center sm:justify-end pointer-events-none">
              <div className="lg-tooltip pointer-events-auto flex items-center gap-2.5 !py-2">
                <span className="text-[12px] font-medium text-slate-700">Set the school’s location so the map opens on it.</span>
                <button onClick={onSetSchool} className={`${GBTN.primary} !h-8 !px-3`}>Set location</button>
              </div>
            </div>
          )}
          {!loading && mapBuses.length === 0 && (
            <div className="pointer-events-none absolute inset-x-0 bottom-4 z-[1000] flex justify-center px-4">
              <span className="lg-tooltip text-[12px] font-medium text-slate-700 text-center">
                {onRoad.length === 0
                  ? 'No bus is on the road right now — buses appear here as their trips start.'
                  : `${onRoad.length} on the road, none reporting a position yet.`}
              </span>
            </div>
          )}
        </div>
      </GlassPanel>

      {/* ── Today's trips · Needs attention ───────────────────────── */}
      <GlassPanel
        eyebrow="Today"
        title="Trips"
        icon={Bus}
        delay={0.05}
        actions={
          <div className="lg-pill flex items-center gap-3 h-8 px-3 text-[11.5px] font-semibold text-slate-600 tabular-nums">
            <span className="inline-flex items-center gap-1.5" title="Trips within five minutes of their timetable">
              <Clock size={12} className="text-slate-400" />
              {snapshot ? `${snapshot.runs_total - snapshot.runs_late}/${snapshot.runs_total} on time` : '—'}
            </span>
            <span className="w-px h-3.5 bg-slate-300" />
            <span className="inline-flex items-center gap-1.5" title="Riders aboard against seats on the road">
              <Gauge size={12} className="text-slate-400" />
              {seats != null ? `${seats}% seats used` : 'Seats —'}
            </span>
          </div>
        }
      >
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-12">
          <Content className="xl:col-span-8 flex flex-col overflow-hidden">
            <div className="p-4 xl:p-5 border-b border-slate-200/70">
              <RiderBar tally={shownTally} focus={focusRun} loading={loading} />
            </div>

            <div className="flex items-center justify-between px-4 xl:px-5 pt-3 pb-1.5">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Worst first</span>
              <span className="text-[11px] text-slate-400">
                {runs.length} trip{runs.length === 1 ? '' : 's'}
                <span className="hidden sm:inline"> · point at one to focus the bar</span>
              </span>
            </div>

            <div className="px-2 pb-2" onMouseLeave={() => setHoverRunId(null)}>
              {loading ? (
                <div className="space-y-1.5 p-2">
                  {[0, 1, 2].map(i => <div key={i} className="h-14 rounded-xl bg-slate-100/80 animate-pulse" />)}
                </div>
              ) : runs.length === 0 ? (
                <EmptyNote
                  icon={Bus}
                  title="No trips today"
                  detail="Trips are created from the route schedules overnight, and again automatically when this screen finds none. If this stays empty, no route has a schedule for today — add one in Configuration."
                />
              ) : (
                <ul className="space-y-1 max-h-[30rem] overflow-y-auto pr-0.5">
                  {sortedRuns.map(r => (
                    <TripRow
                      key={r.id}
                      run={r}
                      tally={tallyOf(riders[r.id])}
                      selected={r.id === selectedRunId}
                      focused={r.id === focusId}
                      onHover={() => setHoverRunId(r.id)}
                      onClick={() => setSelectedRunId(r.id === selectedRunId ? null : r.id)}
                    />
                  ))}
                </ul>
              )}
            </div>
          </Content>

          {/* Needs attention */}
          <Content className="xl:col-span-4 flex flex-col overflow-hidden">
            <div className="px-4 pt-4 pb-2.5">
              <CardHead
                icon={AlertTriangle}
                label="Needs attention"
                right={attentionCount > 0 ? (
                  <span className="rounded-full bg-rose-500 px-2 py-0.5 text-[10.5px] font-bold text-white tabular-nums">
                    {attentionCount.toLocaleString('en-IN')}
                  </span>
                ) : null}
              />
            </div>
            {attention.length === 0 && alerts.length === 0 ? (
              <EmptyNote
                icon={Check}
                title="Nothing needs attention"
                detail="Silent buses, delays, deviations, children who didn't board and bus-vs-class clashes all surface here when they happen."
              />
            ) : (
              <div className="flex-1 max-h-[36rem] space-y-2 overflow-y-auto px-3 pb-3">
                <AnimatePresence initial={false}>
                  {criticalAlerts.map(a => (
                    <AlertCard key={a.id} alert={a}
                      onOpenRun={() => a.run_id && setSelectedRunId(a.run_id)}
                      onAck={() => ackAlert(a.id)} onResolve={() => dismissAlert(a.id)} />
                  ))}
                  {attention.map(item => (
                    <AttentionCard
                      key={item.key}
                      item={item}
                      onShowBus={item.runId ? () => setSelectedRunId(item.runId!) : undefined}
                      onHide={() => setHidden(prev => new Set(prev).add(item.key))}
                    />
                  ))}
                  {otherAlerts.map(a => (
                    <AlertCard key={a.id} alert={a}
                      onOpenRun={() => a.run_id && setSelectedRunId(a.run_id)}
                      onAck={() => ackAlert(a.id)} onResolve={() => dismissAlert(a.id)} />
                  ))}
                </AnimatePresence>

                {alerts.length < alertTotal && (
                  <button type="button" onClick={loadMoreAlerts} disabled={loadingMoreAlerts} className={`${GBTN.secondary} w-full`}>
                    {loadingMoreAlerts ? 'Loading…' : `Load ${Math.min(OPEN_ALERTS_PAGE, alertTotal - alerts.length)} more`}
                  </button>
                )}
                {alertTotal > 0 && (
                  <p className="pb-1 pt-0.5 text-center text-[11px] text-slate-400">
                    {alerts.length.toLocaleString('en-IN')} of {alertTotal.toLocaleString('en-IN')} alerts
                  </p>
                )}
              </div>
            )}
          </Content>
        </div>
      </GlassPanel>

      {/* ── Bus fees, month by month ──────────────────────────────── */}
      <FeeMonths onOpenFees={onOpenFees} />

      <Modal
        open={reportsOpen}
        onClose={() => setReportsOpen(false)}
        title="Reports"
        subtitle="On-time performance, seats used, delay by stop, GPS health"
        icon={BarChart3}
        size="xl"
        fullHeight
      >
        <ReportsSection />
      </Modal>
    </div>
  )
}

/* ── The rider bar ─────────────────────────────────────────────── */

/**
 * Picked up, dropped off and neither, as one bar.
 *
 * Nested rather than stacked, because the categories nest: everyone dropped off
 * was picked up first. The gold run is everyone picked up; the green run inside
 * it is the part of them already home or at school; the grey remainder has not
 * been collected yet.
 */
function RiderBar({ tally, focus, loading }: { tally: Tally; focus: TransportRun | null; loading: boolean }) {
  const reduceMotion = useReducedMotion()
  const denom = Math.max(1, tally.expected - tally.excused)
  const pickedPct = Math.min(100, (tally.picked / denom) * 100)
  const droppedPct = Math.min(100, (tally.dropped / denom) * 100)
  const waiting = neither(tally)
  const onBoard = Math.max(0, tally.picked - tally.dropped)
  const transition = reduceMotion ? { duration: 0 } : { duration: 0.7, ease: EASE }

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <div className="h-4 relative overflow-hidden">
            <AnimatePresence mode="wait" initial={false}>
              <motion.p
                key={focus?.id ?? 'fleet'}
                initial={{ y: 10, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: -10, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500 truncate"
              >
                {focus ? (
                  <>
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: focus.route?.color ?? BUS.gold }} />
                    {focus.route?.name ?? 'Trip'} · {DIRECTION_LABELS[focus.direction]}
                  </>
                ) : (
                  <><Users size={12} /> All trips today</>
                )}
              </motion.p>
            </AnimatePresence>
          </div>
          <p className="mt-1 font-display text-[1.75rem] xl:text-[2rem] font-black leading-none text-slate-900 tabular-nums">
            {loading ? '—' : tally.picked}
            <span className="ml-1.5 text-sm font-semibold text-slate-400">
              of {loading ? '—' : tally.expected - tally.excused} picked up
            </span>
          </p>
        </div>
        {tally.excused > 0 && (
          <span className="text-[11px] font-medium text-slate-500">{tally.excused} on approved leave</span>
        )}
      </div>

      <div className="relative mt-3 h-4 rounded-full bg-slate-200/70 shadow-[inset_0_1px_2px_rgba(15,23,42,0.12)] overflow-hidden">
        {/* neither: the striped track */}
        <div className="absolute inset-0 fee-stripes" style={{ ['--fee-c' as string]: '#94a3b8' }} />
        <motion.div
          className="absolute inset-y-0 left-0 fee-solid fee-glint"
          style={{ ['--fee-c' as string]: BUS.aboard }}
          initial={false}
          animate={{ width: `${pickedPct}%` }}
          transition={transition}
        />
        <motion.div
          className="absolute inset-y-0 left-0 fee-solid"
          style={{ ['--fee-c' as string]: BUS.dropped }}
          initial={false}
          animate={{ width: `${droppedPct}%` }}
          transition={transition}
        />
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2">
        <Legend color={BUS.aboard} label="Picked up" value={tally.picked} sub={`${onBoard} on board now`} />
        <Legend color={BUS.dropped} label="Dropped off" value={tally.dropped} sub="trip complete" />
        <Legend color="#94a3b8" striped label="Neither yet" value={waiting} sub="not collected" />
      </div>
    </div>
  )
}

function Legend({ color, label, value, sub, striped }: { color: string; label: string; value: number; sub: string; striped?: boolean }) {
  return (
    <div className="fee-mini !py-2">
      <span
        className={`w-3 h-3 rounded-[4px] flex-shrink-0 ${striped ? 'fee-stripes' : 'fee-solid'}`}
        style={{ ['--fee-c' as string]: color }}
      />
      <span className="min-w-0">
        <span className="block text-[15px] font-bold leading-tight text-slate-900 tabular-nums">{value}</span>
        <span className="block text-[10.5px] font-semibold leading-tight text-slate-600">{label}</span>
        <span className="hidden sm:block text-[10px] text-slate-400 truncate">{sub}</span>
      </span>
    </div>
  )
}

/* ── A trip row ────────────────────────────────────────────────── */

function TripRow({ run: r, tally, selected, focused, onHover, onClick }: {
  run: TransportRun
  tally: Tally
  selected: boolean
  focused: boolean
  onHover: () => void
  onClick: () => void
}) {
  const age = fixAgeSeconds(r)
  const moving = ON_ROAD.has(r.status)
  const live = r.telemetry_state === 'live'
  const late = (r.delay_seconds ?? 0) > 300
  const done = FINISHED.has(r.status)
  const denom = Math.max(1, tally.expected - tally.excused)

  let status: { text: string; cls: string; icon?: React.ReactNode }
  if (done) status = { text: RUN_STATUS_LABELS[r.status], cls: 'text-slate-500' }
  else if (r.status === 'scheduled') status = { text: `Due ${formatClock(r.scheduled_start_at) ?? ''}`, cls: 'text-slate-500' }
  else if (!live) status = { text: age != null ? `Silent ${Math.round(age / 60)} min` : 'No GPS', cls: 'text-rose-600', icon: <WifiOff size={11} /> }
  else status = { text: 'Live', cls: 'text-emerald-600', icon: <Radio size={11} /> }

  return (
    <li>
      <button
        onMouseEnter={onHover}
        onFocus={onHover}
        onClick={onClick}
        className={`group w-full flex items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition-colors ${
          selected ? 'bg-slate-100 ring-1 ring-slate-300' : focused ? 'bg-slate-100/70' : 'hover:bg-slate-50'
        } ${done ? 'opacity-70' : ''}`}
      >
        <span className="w-1.5 self-stretch rounded-full flex-shrink-0" style={{ background: r.route?.color ?? '#A1A1AA' }} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2 min-w-0">
            <span className="truncate text-sm font-semibold text-slate-900">{r.route?.name ?? 'Route'}</span>
            <span className="flex-shrink-0 text-[9.5px] font-bold uppercase tracking-wider text-slate-400">
              {DIRECTION_LABELS[r.direction]}
            </span>
          </span>
          <span className="block truncate text-[11px] text-slate-500">
            {vehicleLabel(r.vehicle)} · {r.driver?.full_name ?? 'No driver'}
            {moving && r.next_stop_eta_at && ` · next stop ${relativeMinutes(r.next_stop_eta_at)}`}
          </span>
          {/* A slim copy of the rider bar, so a trip can be read without hovering. */}
          {tally.expected > 0 && (
            <span className="mt-1.5 relative block h-1.5 rounded-full bg-slate-200/80 overflow-hidden">
              <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.min(100, (tally.picked / denom) * 100)}%`, background: BUS.aboard }} />
              <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.min(100, (tally.dropped / denom) * 100)}%`, background: BUS.dropped }} />
            </span>
          )}
        </span>

        <span className="hidden sm:block flex-shrink-0 w-16 text-right">
          <span className="block text-[12px] font-bold tabular-nums text-slate-800">
            {tally.picked}/{tally.expected - tally.excused}
          </span>
          <span className="block text-[10px] text-slate-400">{tally.dropped} dropped</span>
        </span>

        <span className="flex-shrink-0 w-24 text-right">
          <span className={`inline-flex items-center gap-1 text-[11px] font-semibold ${status.cls}`}>
            {status.icon}{status.text}
          </span>
          {late && !done && (
            <span className="block text-[11px] font-semibold text-amber-600">
              {Math.round((r.delay_seconds ?? 0) / 60)} min late
            </span>
          )}
        </span>
      </button>
    </li>
  )
}

/* ── Needs attention cards ─────────────────────────────────────── */

interface AttentionItem {
  key: string
  tone: 'critical' | 'warning'
  kind: string
  title: string
  detail: string
  phone?: string | null
  runId?: string
  onOpen?: () => void
  openLabel?: string
}

const TONE_RAIL: Record<'critical' | 'warning' | 'info', string> = {
  critical: '#DC2626',
  warning: '#D97706',
  info: '#A1A1AA',
}
const TONE_BG: Record<'critical' | 'warning' | 'info', string> = {
  critical: 'bg-rose-50/80',
  warning: 'bg-amber-50/70',
  info: 'bg-slate-50',
}

function AttentionShell({ tone, kind, title, detail, children }: {
  tone: 'critical' | 'warning' | 'info'
  kind: string
  title: string
  detail?: string | null
  children?: React.ReactNode
}) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: 24, transition: { duration: 0.18 } }}
      className={`relative overflow-hidden rounded-2xl border border-white p-3 pl-3.5 shadow-[0_1px_2px_rgba(15,23,42,.05)] ${TONE_BG[tone]}`}
    >
      <span className="absolute left-0 inset-y-0 w-[3px]" style={{ background: TONE_RAIL[tone] }} />
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{kind}</p>
      <p className="mt-0.5 text-[13px] font-semibold leading-snug text-slate-900">{title}</p>
      {detail && <p className="mt-0.5 text-[11.5px] leading-snug text-slate-600">{detail}</p>}
      {children && <div className="mt-2 flex flex-wrap items-center gap-1.5">{children}</div>}
    </motion.div>
  )
}

const CHIP_BTN =
  'inline-flex items-center gap-1 h-7 px-2.5 rounded-full text-[11px] font-semibold bg-white/90 border border-slate-200/80 text-slate-700 hover:bg-white hover:text-slate-900 transition active:scale-95'
const CHIP_DARK =
  'inline-flex items-center gap-1 h-7 px-2.5 rounded-full text-[11px] font-semibold text-white bg-gradient-to-b from-[#3D3B40] to-[#27272A] hover:from-[#46444A] transition active:scale-95'

function AttentionCard({ item, onShowBus, onHide }: { item: AttentionItem; onShowBus?: () => void; onHide: () => void }) {
  return (
    <AttentionShell tone={item.tone} kind={item.kind} title={item.title} detail={item.detail}>
      {item.phone && (
        <a href={`tel:${item.phone}`} className={CHIP_BTN}><Phone size={11} /> {item.phone}</a>
      )}
      {onShowBus && <button onClick={onShowBus} className={CHIP_BTN}><Bus size={11} /> Show bus</button>}
      {item.onOpen && <button onClick={item.onOpen} className={CHIP_BTN}>{item.openLabel ?? 'Open'}</button>}
      <button onClick={onHide} className={CHIP_BTN} title="Hide until the page is reloaded"><X size={11} /> Hide</button>
    </AttentionShell>
  )
}

function AlertCard({ alert, onOpenRun, onAck, onResolve }: {
  alert: TransportAlert
  onOpenRun: () => void
  onAck: () => void
  onResolve: () => void
}) {
  return (
    <AttentionShell
      tone={alert.severity}
      kind={ALERT_TYPE_LABELS[alert.type] ?? alert.type}
      title={alert.title}
      detail={alert.detail}
    >
      {alert.run_id && <button onClick={onOpenRun} className={CHIP_BTN}><Bus size={11} /> Show bus</button>}
      {alert.status === 'open' && (
        <button onClick={onAck} className={CHIP_BTN}><Check size={11} /> Acknowledge</button>
      )}
      <button onClick={onResolve} className={CHIP_DARK}><CheckCheck size={11} /> Resolve</button>
    </AttentionShell>
  )
}

/* ── Fees by month ─────────────────────────────────────────────── */

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const COLLECTED = '#10b981'
const OUTSTANDING = '#f59e0b'

/**
 * Collected against outstanding for each month of the academic year — the
 * fee position as a shape rather than a total, so a month that never got
 * chased stands out.
 */
function FeeMonths({ onOpenFees }: { onOpenFees: () => void }) {
  const reduceMotion = useReducedMotion()
  const [year, setYear] = useState(currentAcademicYear())
  const [years, setYears] = useState<string[]>([currentAcademicYear()])
  const [rows, setRows] = useState<MonthFeePosition[] | null>(null)
  const [hover, setHover] = useState<number | null>(null)

  useEffect(() => { listBusAcademicYears().then(setYears) }, [])
  useEffect(() => {
    let alive = true
    setRows(null)
    fetchMonthlyBusFees(year).then(r => { if (alive) setRows(r) })
    return () => { alive = false }
  }, [year])

  const sorted = useMemo(() => [...years].sort(), [years])
  const idx = sorted.indexOf(year)
  const older = idx > 0 ? sorted[idx - 1] : null
  const newer = idx >= 0 && idx < sorted.length - 1 ? sorted[idx + 1] : null

  const months = academicMonths(year)
  const max = Math.max(1, ...(rows ?? []).map(r => r.billed))
  const total = (rows ?? []).reduce((t, r) => ({
    billed: t.billed + r.billed, collected: t.collected + r.collected, outstanding: t.outstanding + r.outstanding,
  }), { billed: 0, collected: 0, outstanding: 0 })
  const rate = total.billed > 0 ? Math.round((total.collected / total.billed) * 100) : 0
  const nowKey = new Date().toISOString().slice(0, 7)
  const hovered = hover != null && rows ? rows[hover] : null

  return (
    <GlassPanel
      eyebrow="Bus fees"
      title="Collected vs outstanding"
      icon={Wallet}
      delay={0.1}
      actions={
        <>
          <div className="lg-pill flex items-center h-8 px-1" role="group" aria-label="Academic year">
            <button onClick={() => older && setYear(older)} disabled={!older} className="w-6 h-6 rounded-full flex items-center justify-center text-slate-600 hover:bg-white disabled:opacity-30" aria-label="Previous year">
              <ChevronLeft size={14} />
            </button>
            <span className="px-1.5 text-[12.5px] font-bold text-slate-800 tabular-nums">{year}</span>
            <button onClick={() => newer && setYear(newer)} disabled={!newer} className="w-6 h-6 rounded-full flex items-center justify-center text-slate-600 hover:bg-white disabled:opacity-30" aria-label="Next year">
              <ChevronRight size={14} />
            </button>
          </div>
          <button onClick={onOpenFees} className={GBTN.primary}>
            <Wallet size={14} /> Collect in Fees
          </button>
        </>
      }
    >
      <Content className="p-4 xl:p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="flex items-baseline gap-2.5">
              <span className="font-display text-[1.75rem] xl:text-[2rem] font-black leading-none text-slate-900 tabular-nums" title={fmtINRExact(total.collected)}>
                {rows ? fmtINR(total.collected) : '—'}
              </span>
              {rows && total.billed > 0 && (
                <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-[12px] font-bold tabular-nums">{rate}%</span>
              )}
            </p>
            <p className="mt-1.5 text-xs text-slate-500 tabular-nums">
              collected of <span className="font-semibold text-slate-700">{fmtINR(total.billed)}</span> billed ·{' '}
              <span className="font-semibold text-amber-700">{fmtINR(total.outstanding)}</span> outstanding
            </p>
          </div>
          <div className="flex items-center gap-3 text-[11px] font-semibold text-slate-600">
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-[3px] fee-solid" style={{ ['--fee-c' as string]: COLLECTED }} />Collected</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-[3px] fee-stripes" style={{ ['--fee-c' as string]: OUTSTANDING }} />Outstanding</span>
          </div>
        </div>

        <div className="relative mt-4 h-[200px] flex" onMouseLeave={() => setHover(null)}>
          <div className="relative w-11 flex-shrink-0 text-[10px] text-slate-400 tabular-nums" aria-hidden>
            <div className="absolute inset-x-0 top-0 bottom-5">
              {total.billed > 0 && [1, 0.5, 0].map(f => (
                <span key={f} className="absolute right-2 -translate-y-1/2 leading-none" style={{ top: `${(1 - f) * 100}%` }}>
                  {fmtINR(max * f)}
                </span>
              ))}
            </div>
          </div>
          <div className="relative flex-1 min-w-0">
            <div className="absolute inset-x-0 top-0 bottom-5 pointer-events-none" aria-hidden>
              {[0, 0.5, 1].map(f => (
                <span key={f} className={`absolute inset-x-0 border-t ${f === 1 ? 'border-slate-300' : 'border-dashed border-slate-200'}`} style={{ top: `${f * 100}%` }} />
              ))}
            </div>
            <div className="absolute inset-0 grid grid-cols-12 gap-1">
              {months.map((p, i) => {
                const row = rows?.[i]
                const cH = row ? (row.collected / max) * 100 : 0
                const oH = row ? (row.outstanding / max) * 100 : 0
                const m = Number(p.slice(5, 7)) - 1
                const isNow = p === nowKey
                const future = p > nowKey
                return (
                  <div
                    key={p}
                    className={`relative flex flex-col items-center rounded-lg transition-colors ${hover === i ? 'bg-slate-100/80' : ''}`}
                    onMouseEnter={() => setHover(i)}
                  >
                    <div className="relative flex-1 w-full flex justify-center pb-5">
                      <div className="relative h-full w-full max-w-[28px]">
                        {!rows ? (
                          <div className="absolute inset-x-0 bottom-0 rounded-t-[5px] bg-slate-200/70 animate-pulse" style={{ height: `${20 + ((i * 37) % 50)}%` }} />
                        ) : (
                          <div className="absolute inset-x-0 bottom-0 top-0 flex flex-col justify-end gap-[2px]">
                            <motion.span
                              className="block w-full rounded-t-[5px] fee-stripes"
                              style={{ ['--fee-c' as string]: OUTSTANDING }}
                              initial={reduceMotion ? false : { height: 0 }}
                              animate={{ height: `${oH}%` }}
                              transition={{ duration: 0.6, delay: reduceMotion ? 0 : 0.03 * i, ease: EASE }}
                            />
                            <motion.span
                              className={`block w-full fee-solid ${oH > 0 ? '' : 'rounded-t-[5px]'}`}
                              style={{ ['--fee-c' as string]: COLLECTED }}
                              initial={reduceMotion ? false : { height: 0 }}
                              animate={{ height: `${cH}%` }}
                              transition={{ duration: 0.6, delay: reduceMotion ? 0 : 0.03 * i, ease: EASE }}
                            />
                          </div>
                        )}
                      </div>
                    </div>
                    <span className={`absolute bottom-0 h-4 text-[10px] leading-4 tabular-nums ${isNow ? 'font-bold text-slate-900' : future ? 'text-slate-300' : 'font-medium text-slate-500'}`}>
                      {MONTHS_SHORT[m]}
                    </span>
                  </div>
                )
              })}
            </div>

            {hovered && hover != null && (
              <div
                className="lg-tooltip absolute top-0 z-20 pointer-events-none min-w-[170px]"
                style={hover < 6
                  ? { left: `calc(${((hover + 1) / 12) * 100}% + 4px)` }
                  : { right: `calc(${((12 - hover) / 12) * 100}% + 4px)` }}
              >
                <p className="text-[11px] font-bold text-slate-900">
                  {new Date(Number(hovered.period.slice(0, 4)), Number(hovered.period.slice(5, 7)) - 1, 1)
                    .toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}
                </p>
                {hovered.billed > 0 ? (
                  <div className="mt-1 space-y-0.5 text-[10.5px] tabular-nums">
                    <p className="flex justify-between gap-3"><span className="text-slate-600">Billed</span><span className="font-semibold text-slate-800">{fmtINRExact(hovered.billed)}</span></p>
                    <p className="flex justify-between gap-3"><span className="text-emerald-700">Collected</span><span className="font-semibold text-emerald-700">{fmtINRExact(hovered.collected)}</span></p>
                    <p className="flex justify-between gap-3"><span className="text-amber-700">Outstanding</span><span className="font-semibold text-amber-700">{fmtINRExact(hovered.outstanding)}</span></p>
                    <p className="text-slate-400">{hovered.bills} bill{hovered.bills === 1 ? '' : 's'}</p>
                  </div>
                ) : (
                  <p className="mt-0.5 text-[10.5px] text-slate-500">Nothing billed</p>
                )}
              </div>
            )}
          </div>

          {rows && total.billed === 0 && (
            <p className="absolute inset-x-0 top-1/3 text-center text-xs font-medium text-slate-400">
              No bus fees billed in {year} yet — set fees and issue a month from Configuration.
            </p>
          )}
        </div>

        {rows && (
          <table className="sr-only">
            <caption>Bus fees by month, {year}</caption>
            <thead><tr><th>Month</th><th>Billed</th><th>Collected</th><th>Outstanding</th></tr></thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.period}><td>{r.period}</td><td>{r.billed}</td><td>{r.collected}</td><td>{r.outstanding}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </Content>
    </GlassPanel>
  )
}
