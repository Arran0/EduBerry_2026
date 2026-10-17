'use client'

/**
 * Finished trips, and the replay of any one of them.
 *
 * The list is the index and the replay is the answer; on a wide screen they sit
 * side by side, because an admin working a complaint compares two trips and
 * would otherwise be navigating back and forth to do it.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { CalendarDays, History, Loader2, Wifi, WifiOff } from 'lucide-react'
import { ADMIN, EmptyRow } from '../glassAdmin'
import { fetchRoutes } from '@/lib/transport/routes'
import { fetchReplay, fetchRunHistory, type RunReplay } from '@/lib/transport/replay'
import { formatClock } from '@/lib/transport/runs'
import { formatDelay } from '@/lib/transport/reports'
import { vehicleLabel } from '@/lib/transport/vehicles'
import { DIRECTION_LABELS, RUN_STATUS_LABELS, type TransportRoute, type TransportRun } from '@/lib/transport/types'
import ReplayPlayer from '../ReplayPlayer'

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toLocaleDateString('en-CA')
}

export default function HistorySection() {
  const [routes, setRoutes] = useState<TransportRoute[]>([])
  const [runs, setRuns] = useState<TransportRun[]>([])
  const [loading, setLoading] = useState(true)
  const [routeId, setRouteId] = useState<string>('')
  const [from, setFrom] = useState(isoDaysAgo(13))
  const [to, setTo] = useState(isoDaysAgo(0))
  const [selected, setSelected] = useState<TransportRun | null>(null)
  const [replay, setReplay] = useState<RunReplay | null>(null)
  const [replayLoading, setReplayLoading] = useState(false)

  useEffect(() => { fetchRoutes().then(setRoutes) }, [])

  const load = useCallback(async () => {
    setLoading(true)
    const rows = await fetchRunHistory({ from, to, routeId: routeId || null })
    setRuns(rows)
    setLoading(false)
  }, [from, to, routeId])

  useEffect(() => { load() }, [load])

  const open = useCallback(async (run: TransportRun) => {
    setSelected(run)
    setReplayLoading(true)
    setReplay(await fetchReplay(run.id))
    setReplayLoading(false)
  }, [])

  // Grouped by day so a fortnight reads as a fortnight rather than as sixty
  // rows whose dates the eye has to parse individually.
  const byDate = useMemo(() => {
    const groups = new Map<string, TransportRun[]>()
    for (const r of runs) {
      const list = groups.get(r.service_date) ?? []
      list.push(r)
      groups.set(r.service_date, list)
    }
    return [...groups.entries()]
  }, [runs])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className={ADMIN.label}>From</span>
          <input type="date" value={from} max={to} onChange={e => setFrom(e.target.value)}
            className={`${ADMIN.inputPlain} w-auto`} />
        </label>
        <label className="flex flex-col gap-1">
          <span className={ADMIN.label}>To</span>
          <input type="date" value={to} min={from} onChange={e => setTo(e.target.value)}
            className={`${ADMIN.inputPlain} w-auto`} />
        </label>
        <label className="flex flex-col gap-1 min-w-[12rem]">
          <span className={ADMIN.label}>Route</span>
          <select value={routeId} onChange={e => setRouteId(e.target.value)} className={ADMIN.inputPlain}>
            <option value="">Every route</option>
            {routes.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </label>
        <p className="text-xs text-[#71717A] ml-auto pb-2.5">
          {loading ? 'Loading…' : `${runs.length} finished trip${runs.length === 1 ? '' : 's'}`}
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[17rem_1fr] xl:grid-cols-[19rem_1fr] gap-4 lg:gap-5 items-start">
        <div className={`${ADMIN.card} overflow-hidden lg:sticky lg:top-4 lg:max-h-[calc(100vh-6rem)] overflow-y-auto`}>
          {loading ? (
            <div className="px-4 py-10 text-center text-xs text-[#A1A1AA]">
              <Loader2 size={16} className="animate-spin mx-auto mb-2" /> Loading trips…
            </div>
          ) : byDate.length === 0 ? (
            <EmptyRow
              icon={<History size={22} />}
              title="No finished trips"
              detail="Trips appear here once they end. Nothing in this window has completed yet."
            />
          ) : byDate.map(([date, dayRuns]) => (
            <div key={date}>
              <p className="sticky top-0 z-10 bg-[#FAFAFA] border-y border-[#F4F4F5] px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-[#71717A] flex items-center gap-1.5">
                <CalendarDays size={11} className="text-[#A1A1AA]" />
                {new Date(`${date}T00:00:00`).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })}
              </p>
              {dayRuns.map(r => {
                const active = selected?.id === r.id
                const late = (r.delay_seconds ?? 0) > 300
                return (
                  <button
                    key={r.id}
                    onClick={() => open(r)}
                    className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left border-b border-[#F4F4F5] last:border-b-0 transition-colors ${
                      active ? 'bg-[#FAFAFA]' : 'hover:bg-[#FAFAFA]'
                    }`}
                  >
                    <span className="w-1 self-stretch rounded-full flex-shrink-0"
                      style={{ background: r.route?.color ?? '#A1A1AA' }} />
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-semibold text-[#27272A] truncate">
                        {r.route?.name ?? 'Route'}
                        <span className="ml-1.5 text-[10px] font-bold uppercase tracking-wider text-[#A1A1AA]">
                          {DIRECTION_LABELS[r.direction]}
                        </span>
                      </span>
                      <span className="block text-[11px] text-[#71717A] truncate">
                        {formatClock(r.started_at ?? r.scheduled_start_at)} · {vehicleLabel(r.vehicle)}
                      </span>
                    </span>
                    <span className="text-right flex-shrink-0">
                      <span className={`block text-[11px] font-semibold ${
                        r.status === 'completed' ? 'text-[#52525B]' : 'text-rose-600'
                      }`}>
                        {RUN_STATUS_LABELS[r.status]}
                      </span>
                      {late && (
                        <span className="block text-[11px] font-semibold text-amber-600">
                          {formatDelay(r.delay_seconds)}
                        </span>
                      )}
                    </span>
                  </button>
                )
              })}
            </div>
          ))}
        </div>

        <div>
          {!selected ? (
            <div className="border border-dashed border-[#E4E4E7] rounded-xl px-6 py-16 text-center">
              <History size={26} className="mx-auto text-[#A1A1AA] mb-2" />
              <p className="text-sm font-semibold text-[#52525B]">Pick a trip to replay it</p>
              <p className="text-[11px] text-[#A1A1AA] mt-1 max-w-sm mx-auto">
                You will see the path the bus drove, when it reached each stop against
                when it was meant to, and who got on where.
              </p>
            </div>
          ) : replayLoading ? (
            <div className="h-[460px] rounded-xl border border-[#E4E4E7] bg-[#FAFAFA] flex items-center justify-center">
              <Loader2 className="animate-spin text-[#A1A1AA]" size={20} />
            </div>
          ) : !replay ? (
            <div className="border border-dashed border-[#E4E4E7] rounded-xl px-6 py-12 text-center">
              <WifiOff size={22} className="mx-auto text-[#A1A1AA] mb-2" />
              <p className="text-sm font-semibold text-[#52525B]">Could not load that trip</p>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <h3 className="text-base font-bold text-[#27272A]">
                  {selected.route?.name ?? 'Route'}
                  <span className="ml-2 text-[11px] font-bold uppercase tracking-wider text-[#A1A1AA]">
                    {DIRECTION_LABELS[selected.direction]}
                  </span>
                </h3>
                <span className="text-xs text-[#71717A]">
                  {new Date(`${selected.service_date}T00:00:00`).toLocaleDateString([], { dateStyle: 'medium' })}
                  {' · '}{vehicleLabel(selected.vehicle)}
                  {selected.driver?.full_name && ` · ${selected.driver.full_name}`}
                </span>
                <span className="text-[11px] font-semibold text-[#A1A1AA] inline-flex items-center gap-1 ml-auto">
                  {replay.track.length > 0 ? <Wifi size={11} /> : <WifiOff size={11} />}
                  {replay.track.length} position{replay.track.length === 1 ? '' : 's'}
                </span>
              </div>
              <ReplayPlayer replay={replay} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
