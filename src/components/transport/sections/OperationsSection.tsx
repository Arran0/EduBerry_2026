'use client'

/**
 * Operations — the whole of "what is happening" on one screen.
 *
 * Live and Insights used to be two tabs, which meant an admin watching a bus
 * had to leave the map to find out whether the fleet is generally punctual, and
 * leave the numbers to find out where the bus is. They answer one question
 * between them and are now one page:
 *
 *   map (full width)  →  today, in numbers  →  the buses  →  what to chase
 *
 * The map takes the full width because it is the only element whose value grows
 * with size; everything else is a tile or a row and reads fine in a column.
 *
 * Ordering rule throughout: the thing that needs attention is first. Buses sort
 * late-and-silent to the top, not by route name — a list sorted alphabetically
 * is a list that makes you read all of it.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import {
  AlertTriangle, BarChart3, Bus, Check, CheckCheck, Gauge, IndianRupee, Loader2,
  RefreshCw, Radio, Users, Wifi, WifiOff,
} from 'lucide-react'
import { ADMIN } from '@/components/bus/adminUI'
import Modal from '@/components/workspace/Modal'
import { supabase } from '@/lib/supabase'
import {
  acknowledgeAlert, fetchActiveRuns, fetchOpenAlerts, fetchRunRiderCounts, fixAgeSeconds,
  formatClock, materialiseRuns, relativeMinutes, resolveAlert, todayISO,
  type RunRiderCounts,
} from '@/lib/transport/runs'
import { fetchTodaySnapshot, seatEfficiency, unaccounted, type TodaySnapshot } from '@/lib/transport/snapshot'
import { fetchAttendanceMismatch, windowOf, type MismatchRow } from '@/lib/transport/reports'
import { vehicleLabel } from '@/lib/transport/vehicles'
import type { TransportAlert, TransportRun } from '@/lib/transport/types'
import { ALERT_TYPE_LABELS, DIRECTION_LABELS, RUN_STATUS_LABELS } from '@/lib/transport/types'
import MismatchList, { MismatchTile } from '../MismatchPanel'

// The five detailed reports (on-time by route, seats used, delay by stop, GPS
// health, bus-vs-class) still exist in full — they are a drill-down from the
// tiles above rather than a tab of their own, because nobody opens a report
// tab speculatively; they open it because a number on this screen looked wrong.
const ReportsSection = dynamic(() => import('./ReportsSection'))

const TransportMap = dynamic(() => import('../TransportMap'), {
  ssr: false,
  loading: () => (
    <div className="h-[340px] md:h-[420px] rounded-xl border border-[#E4E4E7] bg-[#FAFAFA] flex items-center justify-center">
      <Loader2 className="animate-spin text-[#A1A1AA]" size={20} />
    </div>
  ),
})

const SEVERITY_RANK: Record<TransportAlert['severity'], number> = { critical: 0, warning: 1, info: 2 }

const inr = (n: number) =>
  `₹${Math.round(n).toLocaleString('en-IN')}`

export default function OperationsSection() {
  const [runs, setRuns] = useState<TransportRun[]>([])
  const [alerts, setAlerts] = useState<TransportAlert[]>([])
  const [snapshot, setSnapshot] = useState<TodaySnapshot | null>(null)
  const [riders, setRiders] = useState<Record<string, RunRiderCounts>>({})
  const [mismatch, setMismatch] = useState<MismatchRow[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [mismatchOpen, setMismatchOpen] = useState(false)
  const [reportsOpen, setReportsOpen] = useState(false)

  const runIds = useRef<Set<string>>(new Set())
  useEffect(() => { runIds.current = new Set(runs.map(r => r.id)) }, [runs])

  /**
   * There used to be a "Generate today's trips" button here, and it was a fair
   * question why: the admin has already drawn the route and placed its stops.
   * Those describe where a bus goes; a trip run is the instance for one day and
   * one direction, carrying today's vehicle, driver, per-stop times and
   * roster. The nightly job makes them, and the button existed only for the
   * morning after someone sets up schedules for the first time.
   *
   * A button whose whole purpose is to cover a race the system knows about is
   * a button that should not exist, so this does it instead — once per mount,
   * only when today genuinely has no runs.
   */
  const triedMaterialise = useRef(false)

  const load = useCallback(async () => {
    const [r, a, s, m] = await Promise.all([
      fetchActiveRuns(),
      fetchOpenAlerts(),
      fetchTodaySnapshot(),
      fetchAttendanceMismatch(windowOf(30).from, windowOf(30).to),
    ])
    setRuns(r); setAlerts(a); setSnapshot(s); setMismatch(m)
    setRiders(await fetchRunRiderCounts(r.map(x => x.id)))
    setLoading(false)

    if (r.length === 0 && !triedMaterialise.current) {
      triedMaterialise.current = true
      const res = await materialiseRuns(todayISO())
      if (res.success && (res.created ?? 0) > 0) {
        const again = await fetchActiveRuns()
        setRuns(again)
        setRiders(await fetchRunRiderCounts(again.map(x => x.id)))
        setSnapshot(await fetchTodaySnapshot())
      }
    }
  }, [])

  useEffect(() => { load() }, [load])

  // Live updates off the run row, which the derivation trigger keeps current —
  // never off the telemetry firehose. Refetches are coalesced so a burst of
  // fixes is one query, not one per fix.
  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setTimeout> | null = null
    let alertTimer: ReturnType<typeof setTimeout> | null = null

    const refetchRuns = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => { if (alive) fetchActiveRuns().then(r => { if (alive) setRuns(r) }) }, 400)
    }
    const refetchAlerts = () => {
      if (alertTimer) clearTimeout(alertTimer)
      alertTimer = setTimeout(() => { if (alive) fetchOpenAlerts().then(a => { if (alive) setAlerts(a) }) }, 400)
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

  const ackAlert = useCallback(async (id: string) => {
    const before = alerts
    setAlerts(prev => prev.map(a => (a.id === id ? { ...a, status: 'acknowledged' as const } : a)))
    if (!(await acknowledgeAlert(id)).success) setAlerts(before)
  }, [alerts])

  const dismissAlert = useCallback(async (id: string) => {
    const before = alerts
    setAlerts(prev => prev.filter(a => a.id !== id))
    if (!(await resolveAlert(id)).success) setAlerts(before)
  }, [alerts])

  const sortedAlerts = useMemo(
    () => [...alerts].sort((a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      new Date(b.last_seen_at).getTime() - new Date(a.last_seen_at).getTime()),
    [alerts],
  )

  const onRoad = useMemo(
    () => runs.filter(r => r.status === 'in_progress' || r.status === 'boarding'),
    [runs],
  )

  /**
   * Worst first. A bus that is both silent and late outranks one that is only
   * late, which outranks one that is merely running; within a tier the biggest
   * delay wins. Sorting by route name would bury the one bus anybody needs.
   */
  const sortedRuns = useMemo(() => {
    const rank = (r: TransportRun) => {
      const silent = r.telemetry_state !== 'live' && (r.status === 'in_progress' || r.status === 'boarding')
      const late = (r.delay_seconds ?? 0) > 300
      if (silent && late) return 0
      if (silent) return 1
      if (late) return 2
      return 3
    }
    return [...runs].sort((a, b) =>
      rank(a) - rank(b) || (b.delay_seconds ?? 0) - (a.delay_seconds ?? 0))
  }, [runs])

  const mapStops = useMemo(
    () => onRoad
      .filter(r => r.last_lat != null && r.last_lng != null)
      .map((r, i) => ({
        id: r.id,
        seq: i + 1,
        name: `${r.route?.name ?? 'Route'} · ${vehicleLabel(r.vehicle)}`,
        lat: r.last_lat as number,
        lng: r.last_lng as number,
        radius_m: 0,
      })),
    [onRoad],
  )

  const seats = snapshot ? seatEfficiency(snapshot) : null
  const missing = snapshot ? unaccounted(snapshot) : 0

  return (
    <div className="space-y-4">
      {/* ── Header strip ─────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <span className="inline-flex items-center gap-1.5 text-[#52525B]">
            <Bus size={14} className="text-[#A1A1AA]" />
            {loading ? 'Loading…' : `${onRoad.length} on the road`}
          </span>
          {onRoad.length > 0 && (
            <span className="inline-flex items-center gap-1.5 text-[#A1A1AA]">
              {mapStops.length} reporting a position
            </span>
          )}
          {snapshot && snapshot.runs_stale > 0 && (
            <span className="inline-flex items-center gap-1.5 font-semibold text-rose-600">
              <WifiOff size={13} /> {snapshot.runs_stale} silent
            </span>
          )}
        </div>
        <button className={ADMIN.ghostBtn} onClick={load} disabled={loading}>
          <RefreshCw size={13} /> Refresh
        </button>
      </div>

      {/* ── The map, full width ──────────────────────────────────── */}
      <TransportMap
        stops={mapStops}
        selectedStopId={selectedRunId}
        onStopClick={id => setSelectedRunId(id === selectedRunId ? null : id)}
        showFences={false}
        heightClass="h-[300px] md:h-[400px] lg:h-[min(52vh,34rem)]"
        className="rounded-xl overflow-hidden border border-[#E4E4E7]"
      />

      {/* ── Today, in numbers ────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          icon={<Users size={15} />}
          label="Picked up today"
          value={snapshot ? `${snapshot.riders_boarded}` : '—'}
          detail={snapshot ? `of ${snapshot.riders_expected} expected${missing > 0 ? ` · ${missing} not aboard` : ''}` : ''}
          tone={missing > 0 ? 'warn' : 'good'}
          bar={snapshot && snapshot.riders_expected
            ? snapshot.riders_boarded / snapshot.riders_expected : null}
        />
        <Stat
          icon={<CheckCheck size={15} />}
          label="Dropped off"
          value={snapshot ? `${snapshot.riders_dropped}` : '—'}
          detail={snapshot && snapshot.riders_excused > 0
            ? `${snapshot.riders_excused} on approved leave` : 'completed drop-offs'}
          tone="neutral"
          bar={snapshot && snapshot.riders_boarded
            ? snapshot.riders_dropped / snapshot.riders_boarded : null}
        />
        <Stat
          icon={<Gauge size={15} />}
          label="Seat efficiency"
          value={seats != null ? `${seats}%` : '—'}
          detail={snapshot ? `${snapshot.riders_boarded} riders · ${snapshot.seats_capacity} seats` : ''}
          tone={seats == null ? 'neutral' : seats < 40 ? 'warn' : 'good'}
          bar={seats != null ? seats / 100 : null}
        />
        <Stat
          icon={<Radio size={15} />}
          label="GPS health"
          value={snapshot?.gps_avg_coverage_pct != null ? `${snapshot.gps_avg_coverage_pct}%` : '—'}
          detail={snapshot?.gps_avg_coverage_pct != null
            ? `average coverage, last ${snapshot.gps_days} day${snapshot.gps_days === 1 ? '' : 's'}`
            : 'no rolled-up days yet'}
          tone={snapshot?.gps_avg_coverage_pct == null ? 'neutral'
            : snapshot.gps_avg_coverage_pct < 70 ? 'warn' : 'good'}
          bar={snapshot?.gps_avg_coverage_pct != null ? snapshot.gps_avg_coverage_pct / 100 : null}
        />
      </div>

      {/* ── Buses + what needs attention ─────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_20rem] lg:gap-5 xl:grid-cols-[1fr_22rem]">
        <div className={`${ADMIN.card} divide-y divide-[#F4F4F5] overflow-hidden`}>
          <div className="flex items-center justify-between px-4 py-2.5 bg-[#FAFAFA]">
            <span className={ADMIN.label}>Buses · worst first</span>
            <span className="text-[10px] text-[#A1A1AA]">{runs.length} today</span>
          </div>

          {loading ? (
            <div className="px-4 py-8 text-center text-xs text-[#A1A1AA]">Loading trips…</div>
          ) : runs.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <Bus size={22} className="mx-auto mb-2 text-[#A1A1AA]" />
              <p className="text-sm font-semibold text-[#52525B]">No trips today</p>
              <p className="mx-auto mt-0.5 max-w-xs text-[11px] text-[#A1A1AA]">
                Trips are created from the route schedules overnight, and again
                automatically when this screen finds none. If this stays empty,
                the routes have no active schedule for today.
              </p>
            </div>
          ) : (
            sortedRuns.map(r => {
              const age = fixAgeSeconds(r)
              const live = r.telemetry_state === 'live'
              const late = (r.delay_seconds ?? 0) > 300
              const c = riders[r.id]
              return (
                <button
                  key={r.id}
                  onClick={() => setSelectedRunId(r.id === selectedRunId ? null : r.id)}
                  className={`flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors ${
                    selectedRunId === r.id ? 'bg-[#FAFAFA]' : 'hover:bg-[#FAFAFA]'
                  }`}
                >
                  <span className="w-1 flex-shrink-0 self-stretch rounded-full"
                    style={{ background: r.route?.color ?? '#A1A1AA' }} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-[#27272A]">
                      {r.route?.name ?? 'Route'}
                      <span className="ml-2 text-[10px] font-bold uppercase tracking-wider text-[#A1A1AA]">
                        {DIRECTION_LABELS[r.direction]}
                      </span>
                    </p>
                    <p className="truncate text-[11px] text-[#71717A]">
                      {vehicleLabel(r.vehicle)} · {r.driver?.full_name ?? 'No driver'}
                      {r.next_stop_eta_at && ` · next stop ${relativeMinutes(r.next_stop_eta_at)}`}
                    </p>
                  </div>

                  {/* Pick-ups / drops for this bus, which is the number a
                      parent on the phone is actually asking about. */}
                  {c && (
                    <div className="hidden flex-shrink-0 text-right sm:block">
                      <p className="text-[11px] font-semibold tabular-nums text-[#27272A]">
                        {c.boarded}/{c.expected}
                      </p>
                      <p className="text-[10px] text-[#A1A1AA]">
                        aboard{c.dropped > 0 && ` · ${c.dropped} off`}
                      </p>
                    </div>
                  )}

                  <div className="flex-shrink-0 text-right">
                    <p className={`inline-flex items-center gap-1 text-[11px] font-semibold ${
                      live ? 'text-emerald-600' : r.status === 'scheduled' ? 'text-[#A1A1AA]' : 'text-rose-600'
                    }`}>
                      {live ? <Wifi size={11} /> : <WifiOff size={11} />}
                      {r.status === 'scheduled'
                        ? `Due ${formatClock(r.scheduled_start_at)}`
                        : live ? 'Live'
                          : age != null ? `${Math.round(age / 60)} min ago` : RUN_STATUS_LABELS[r.status]}
                    </p>
                    {late && (
                      <p className="text-[11px] font-semibold text-amber-600">
                        {Math.round((r.delay_seconds ?? 0) / 60)} min late
                      </p>
                    )}
                  </div>
                </button>
              )
            })
          )}
        </div>

        {/* Exceptions rail */}
        <div className={`${ADMIN.card} overflow-hidden`}>
          <div className="flex items-center justify-between bg-[#FAFAFA] px-4 py-2.5">
            <span className={ADMIN.label}>Needs attention</span>
            {sortedAlerts.length > 0 && (
              <span className="rounded-full bg-[#DC2626] px-1.5 py-0.5 text-[10px] font-bold text-white">
                {sortedAlerts.length}
              </span>
            )}
          </div>
          {sortedAlerts.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <Check size={22} className="mx-auto mb-2 text-emerald-500" />
              <p className="text-sm font-semibold text-[#52525B]">Nothing needs attention</p>
              <p className="mt-0.5 text-[11px] text-[#A1A1AA]">
                Offline buses, delays, deviations and children who didn&apos;t board
                all surface here.
              </p>
            </div>
          ) : (
            <div className="max-h-[32rem] space-y-2 overflow-y-auto p-2">
              {sortedAlerts.map(a => (
                <AlertCard
                  key={a.id}
                  alert={a}
                  onOpenRun={() => a.run_id && setSelectedRunId(a.run_id)}
                  onAck={() => ackAlert(a.id)}
                  onResolve={() => dismissAlert(a.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Insights ─────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <span className={ADMIN.label}>Insights</span>
        <button className={ADMIN.ghostBtn} onClick={() => setReportsOpen(true)}>
          <BarChart3 size={13} /> Full reports
        </button>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        <MismatchTile rows={mismatch} onOpen={() => setMismatchOpen(true)} />

        <div className={`${ADMIN.card} p-4`}>
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-[#ECFDF5] text-emerald-600">
              <IndianRupee size={17} />
            </span>
            <div className="min-w-0 flex-1">
              <p className={ADMIN.label}>Bus fees collected</p>
              <p className="mt-1 text-2xl font-bold leading-none tabular-nums text-[#27272A]">
                {snapshot ? inr(snapshot.fees_collected) : '—'}
              </p>
              {snapshot && snapshot.fees_billed > 0 && (
                <>
                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[#F4F4F5]">
                    <div
                      className="h-full rounded-full bg-emerald-500"
                      style={{ width: `${Math.min(100, (snapshot.fees_collected / snapshot.fees_billed) * 100)}%` }}
                    />
                  </div>
                  <p className="mt-1.5 text-xs text-[#71717A]">
                    of {inr(snapshot.fees_billed)} billed ·{' '}
                    <span className={snapshot.fees_overdue > 0 ? 'font-semibold text-rose-600' : ''}>
                      {inr(snapshot.fees_outstanding)} outstanding
                    </span>
                  </p>
                </>
              )}
              {snapshot && snapshot.fees_billed === 0 && (
                <p className="mt-1.5 text-xs text-[#71717A]">No bus fees issued yet.</p>
              )}
            </div>
          </div>
        </div>

        <div className={`${ADMIN.card} p-4`}>
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-[#EFF6FF] text-blue-600">
              <AlertTriangle size={17} />
            </span>
            <div className="min-w-0 flex-1">
              <p className={ADMIN.label}>Punctuality today</p>
              <p className="mt-1 text-2xl font-bold leading-none tabular-nums text-[#27272A]">
                {snapshot ? `${snapshot.runs_total - snapshot.runs_late}/${snapshot.runs_total}` : '—'}
              </p>
              <p className="mt-1.5 text-xs leading-snug text-[#71717A]">
                trips within five minutes of their timetable
                {snapshot && snapshot.runs_stale > 0 && (
                  <> · <span className="font-semibold text-rose-600">
                    {snapshot.runs_stale} not reporting, so not counted honestly
                  </span></>
                )}
              </p>
            </div>
          </div>
        </div>
      </div>

      <Modal
        open={mismatchOpen}
        onClose={() => setMismatchOpen(false)}
        title="Boarded the bus, absent in class"
        subtitle="Last 30 days · no approved leave on file"
        icon={AlertTriangle}
        size="lg"
      >
        <MismatchList rows={mismatch} />
      </Modal>

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

/* ── Pieces ────────────────────────────────────────────────────── */

const TONE_TEXT = { good: 'text-emerald-600', warn: 'text-amber-600', neutral: 'text-[#52525B]' }
const TONE_BAR = { good: 'bg-emerald-500', warn: 'bg-amber-500', neutral: 'bg-[#A1A1AA]' }

/**
 * A number, what it is out of, and a bar.
 *
 * The bar is the point: "17" means nothing and "17 of 24" means something, but
 * a filled track says it before either is read.
 */
function Stat({ icon, label, value, detail, tone, bar }: {
  icon: React.ReactNode
  label: string
  value: string
  detail?: string
  tone: keyof typeof TONE_TEXT
  bar?: number | null
}) {
  return (
    <div className={`${ADMIN.card} p-3.5`}>
      <div className="flex items-center gap-2">
        <span className={`${TONE_TEXT[tone]} flex-shrink-0`}>{icon}</span>
        <span className={ADMIN.label}>{label}</span>
      </div>
      <p className="mt-2 text-2xl font-bold leading-none tabular-nums text-[#27272A]">{value}</p>
      {bar != null && Number.isFinite(bar) && (
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[#F4F4F5]">
          <div
            className={`h-full rounded-full ${TONE_BAR[tone]}`}
            style={{ width: `${Math.max(0, Math.min(100, bar * 100))}%` }}
          />
        </div>
      )}
      {detail && <p className="mt-1.5 text-[11px] leading-snug text-[#71717A]">{detail}</p>}
    </div>
  )
}

const ALERT_TONE: Record<TransportAlert['severity'], string> = {
  critical: 'border-l-[#DC2626] bg-[#FEF2F2]',
  warning: 'border-l-[#D97706] bg-[#FFFBEB]',
  info: 'border-l-[#A1A1AA] bg-[#FAFAFA]',
}

function AlertCard({ alert, onOpenRun, onAck, onResolve }: {
  alert: TransportAlert
  onOpenRun: () => void
  onAck: () => void
  onResolve: () => void
}) {
  return (
    <div className={`rounded-lg border border-[#E4E4E7] border-l-[3px] p-2.5 ${ALERT_TONE[alert.severity]}`}>
      <p className="text-[10px] font-bold uppercase tracking-wider text-[#71717A]">
        {ALERT_TYPE_LABELS[alert.type] ?? alert.type}
      </p>
      <p className="mt-0.5 text-sm font-semibold leading-snug text-[#27272A]">{alert.title}</p>
      {alert.detail && (
        <p className="mt-0.5 text-[11px] leading-snug text-[#71717A]">{alert.detail}</p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {alert.run_id && (
          <button onClick={onOpenRun} className={ADMIN.ghostBtn}>Show bus</button>
        )}
        {alert.status === 'open' && (
          <button onClick={onAck} className={ADMIN.ghostBtn}>
            <Check size={12} /> Acknowledge
          </button>
        )}
        <button onClick={onResolve} className={ADMIN.darkBtn}>
          <CheckCheck size={12} /> Resolve
        </button>
      </div>
    </div>
  )
}
