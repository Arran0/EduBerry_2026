'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import {
  AlertTriangle, Bus, Check, CheckCheck, Loader2, MapPin, RefreshCw, Wifi, WifiOff, Calendar,
} from 'lucide-react'
import { ADMIN } from '@/components/bus/adminUI'
import { supabase } from '@/lib/supabase'
import {
  acknowledgeAlert, fetchActiveRuns, fetchOpenAlerts, fixAgeSeconds, formatClock,
  materialiseRuns, relativeMinutes, resolveAlert, todayISO,
} from '@/lib/transport/runs'
import { vehicleLabel } from '@/lib/transport/vehicles'
import type { TransportAlert, TransportRun } from '@/lib/transport/types'
import { ALERT_TYPE_LABELS, DIRECTION_LABELS, RUN_STATUS_LABELS } from '@/lib/transport/types'

const TransportMap = dynamic(() => import('../TransportMap'), {
  ssr: false,
  loading: () => (
    <div className="h-[420px] rounded-xl border border-[#E4E4E7] bg-[#FAFAFA] flex items-center justify-center">
      <Loader2 className="animate-spin text-[#A1A1AA]" size={20} />
    </div>
  ),
})

/** Severity drives order, not colour alone — an emergency must be at the top. */
const SEVERITY_RANK: Record<TransportAlert['severity'], number> = { critical: 0, warning: 1, info: 2 }

export default function LiveSection() {
  const router = useRouter()
  const [runs, setRuns] = useState<TransportRun[]>([])
  const [alerts, setAlerts] = useState<TransportAlert[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)

  // Which runs are on the board right now, readable from a subscription
  // callback without making `runs` a dependency of the channel effect (which
  // would tear the channel down and rebuild it on every position update).
  const runIds = useRef<Set<string>>(new Set())
  useEffect(() => { runIds.current = new Set(runs.map(r => r.id)) }, [runs])

  const load = useCallback(async () => {
    const [r, a] = await Promise.all([fetchActiveRuns(), fetchOpenAlerts()])
    setRuns(r); setAlerts(a); setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  /**
   * Live updates, without the refetch storm.
   *
   * Every GPS fix updates its run row, so on a thirty-bus fleet this channel
   * fires several times a second. Re-running the whole fleet query on each one
   * would re-read every run, route, vehicle and crew profile for a position
   * that moved twelve metres. So an UPDATE is merged into the row we already
   * hold — the changed columns are exactly what the payload carries, and the
   * embedded route/vehicle/driver objects survive untouched. Only an INSERT or
   * DELETE changes which runs exist, and only that is worth a refetch, coalesced
   * so a burst of them costs one query.
   */
  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setTimeout> | null = null

    const refetchRuns = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => { if (alive) fetchActiveRuns().then(r => { if (alive) setRuns(r) }) }, 400)
    }
    let alertTimer: ReturnType<typeof setTimeout> | null = null
    const refetchAlerts = () => {
      if (alertTimer) clearTimeout(alertTimer)
      alertTimer = setTimeout(() => { if (alive) fetchOpenAlerts().then(a => { if (alive) setAlerts(a) }) }, 400)
    }

    const channel = supabase
      .channel('transport_fleet_live')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'transport_trip_runs' },
        payload => {
          if (!alive) return
          const next = payload.new as Partial<TransportRun> & { id?: string }
          if (!next?.id) return
          // A run that was not on the board — a late-created one, or one that
          // just became today's — still needs its joins, so fetch it properly.
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

  const sortedAlerts = useMemo(
    () => [...alerts].sort((a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      new Date(b.last_seen_at).getTime() - new Date(a.last_seen_at).getTime()),
    [alerts],
  )

  const onRoad = runs.filter(r => r.status === 'in_progress' || r.status === 'boarding')
  const withPosition = onRoad.filter(r => r.last_lat != null && r.last_lng != null)

  // Every live bus as a numbered pin. Reusing the stop marker keeps one visual
  // language across the module rather than inventing a second one for buses.
  const mapStops = withPosition.map((r, i) => ({
    id: r.id,
    seq: i + 1,
    name: `${r.route?.name ?? 'Route'} · ${vehicleLabel(r.vehicle)}`,
    lat: r.last_lat as number,
    lng: r.last_lng as number,
    radius_m: 0,
  }))

  const generate = async () => {
    setBusy(true)
    const res = await materialiseRuns(todayISO())
    setBusy(false)
    if (res.success) load()
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3 text-xs">
          <span className="inline-flex items-center gap-1.5 text-[#52525B]">
            <Bus size={14} className="text-[#A1A1AA]" />
            {loading ? 'Loading…' : `${onRoad.length} on the road`}
          </span>
          {onRoad.length > 0 && (
            <span className="inline-flex items-center gap-1.5 text-[#A1A1AA]">
              {withPosition.length} reporting
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button className={ADMIN.ghostBtn} onClick={load} disabled={loading}>
            <RefreshCw size={13} /> Refresh
          </button>
          <button className={ADMIN.ghostBtn} onClick={generate} disabled={busy}>
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Calendar size={13} />}
            Generate today&apos;s trips
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_22rem] gap-4">
        <div className="space-y-3">
          <TransportMap
            stops={mapStops}
            selectedStopId={selectedRunId}
            onStopClick={id => setSelectedRunId(id === selectedRunId ? null : id)}
            showFences={false}
            height={420}
            className="rounded-xl overflow-hidden border border-[#E4E4E7]"
          />

          <div className={`${ADMIN.card} divide-y divide-[#F4F4F5] overflow-hidden`}>
            {loading ? (
              <div className="px-4 py-8 text-center text-xs text-[#A1A1AA]">Loading trips…</div>
            ) : runs.length === 0 ? (
              <div className="px-4 py-10 text-center">
                <Bus size={22} className="mx-auto text-[#A1A1AA] mb-2" />
                <p className="text-sm font-semibold text-[#52525B]">No trips today</p>
                <p className="text-[11px] text-[#A1A1AA] mt-0.5 max-w-xs mx-auto">
                  Trips are generated overnight from the route schedules. Use
                  &ldquo;Generate today&apos;s trips&rdquo; if you have just set them up.
                </p>
              </div>
            ) : (
              runs.map(r => {
                const age = fixAgeSeconds(r)
                const live = r.telemetry_state === 'live'
                const late = (r.delay_seconds ?? 0) > 600
                return (
                  <button
                    key={r.id}
                    onClick={() => setSelectedRunId(r.id === selectedRunId ? null : r.id)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors ${
                      selectedRunId === r.id ? 'bg-[#FAFAFA]' : 'hover:bg-[#FAFAFA]'
                    }`}
                  >
                    <span className="w-1 self-stretch rounded-full flex-shrink-0"
                      style={{ background: r.route?.color ?? '#A1A1AA' }} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-[#27272A] truncate">
                        {r.route?.name ?? 'Route'}
                        <span className="ml-2 text-[10px] font-bold uppercase tracking-wider text-[#A1A1AA]">
                          {DIRECTION_LABELS[r.direction]}
                        </span>
                      </p>
                      <p className="text-[11px] text-[#71717A] truncate">
                        {vehicleLabel(r.vehicle)} · {r.driver?.full_name ?? 'No driver'}
                        {r.next_stop_eta_at && ` · next stop ${relativeMinutes(r.next_stop_eta_at)}`}
                      </p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className={`text-[11px] font-semibold inline-flex items-center gap-1 ${
                        live ? 'text-emerald-600' : r.status === 'scheduled' ? 'text-[#A1A1AA]' : 'text-rose-600'
                      }`}>
                        {live ? <Wifi size={11} /> : <WifiOff size={11} />}
                        {r.status === 'scheduled'
                          ? `Due ${formatClock(r.scheduled_start_at)}`
                          : live ? 'Live'
                            : age != null ? `${Math.round(age / 60)} min ago` : RUN_STATUS_LABELS[r.status]}
                      </p>
                      {late && (
                        <p className="text-[11px] text-amber-600 font-semibold">
                          {Math.round((r.delay_seconds ?? 0) / 60)} min late
                        </p>
                      )}
                    </div>
                  </button>
                )
              })
            )}
          </div>
        </div>

        {/* Exceptions rail. This is the differentiator: everything wrong across
            the fleet, ordered by how much it matters, with an action on each. */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className={ADMIN.label}>Exceptions</p>
            {sortedAlerts.length > 0 && (
              <span className="text-[11px] font-bold text-rose-600">{sortedAlerts.length} open</span>
            )}
          </div>

          {sortedAlerts.length === 0 ? (
            <div className="border border-dashed border-[#E4E4E7] rounded-xl px-4 py-8 text-center">
              <CheckCheck size={20} className="mx-auto text-emerald-500 mb-2" />
              <p className="text-sm font-semibold text-[#52525B]">Nothing needs attention</p>
              <p className="text-[11px] text-[#A1A1AA] mt-0.5">
                Offline buses, delays, deviations and children who didn&apos;t board all
                surface here.
              </p>
            </div>
          ) : (
            <div className="space-y-2 max-h-[34rem] overflow-y-auto pr-0.5">
              {sortedAlerts.map(a => (
                <AlertCard
                  key={a.id}
                  alert={a}
                  onOpenRun={() => a.run_id && setSelectedRunId(a.run_id)}
                  onAck={async () => { await acknowledgeAlert(a.id); load() }}
                  onResolve={async () => { await resolveAlert(a.id); load() }}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function AlertCard({
  alert, onOpenRun, onAck, onResolve,
}: {
  alert: TransportAlert
  onOpenRun: () => void
  onAck: () => void
  onResolve: () => void
}) {
  const critical = alert.severity === 'critical'
  return (
    <div
      className={`rounded-xl border px-3 py-2.5 ${
        critical ? 'border-rose-200 bg-rose-50' : 'border-amber-200 bg-amber-50'
      }`}
    >
      <div className="flex items-start gap-2">
        <AlertTriangle
          size={14}
          className={`mt-0.5 flex-shrink-0 ${critical ? 'text-rose-600' : 'text-amber-600'}`}
        />
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-semibold ${critical ? 'text-rose-900' : 'text-amber-900'}`}>
            {alert.title}
          </p>
          {alert.detail && (
            <p className={`text-[11px] mt-0.5 ${critical ? 'text-rose-700' : 'text-amber-700'}`}>
              {alert.detail}
            </p>
          )}
          <p className="text-[10px] uppercase tracking-wider text-[#A1A1AA] mt-1">
            {ALERT_TYPE_LABELS[alert.type]}
            {alert.route?.name ? ` · ${alert.route.name}` : ''}
            {alert.occurrences > 1 ? ` · seen ${alert.occurrences}×` : ''}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-1.5 mt-2">
        {alert.run_id && (
          <button
            onClick={onOpenRun}
            className="text-[11px] font-semibold text-[#52525B] hover:text-[#27272A] px-2 py-1 rounded-md hover:bg-white/60 transition-colors inline-flex items-center gap-1"
          >
            <MapPin size={11} /> Show on map
          </button>
        )}
        {alert.status === 'open' && (
          <button
            onClick={onAck}
            className="text-[11px] font-semibold text-[#52525B] hover:text-[#27272A] px-2 py-1 rounded-md hover:bg-white/60 transition-colors inline-flex items-center gap-1"
          >
            <Check size={11} /> Acknowledge
          </button>
        )}
        <button
          onClick={onResolve}
          className="text-[11px] font-semibold text-emerald-700 hover:text-emerald-900 px-2 py-1 rounded-md hover:bg-white/60 transition-colors inline-flex items-center gap-1"
        >
          <CheckCheck size={11} /> Resolve
        </button>
      </div>
    </div>
  )
}
