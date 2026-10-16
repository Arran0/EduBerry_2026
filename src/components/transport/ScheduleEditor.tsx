'use client'

import React, { useCallback, useEffect, useState } from 'react'
import { Clock, Plus, Trash2, Pencil, ArrowRight, ArrowLeft, Wand2 } from 'lucide-react'
import {
  fetchSchedules, deleteSchedule, describeDays, formatTime, stopTimings, applyEvenOffsets,
} from '@/lib/transport/schedules'
import { fetchStops } from '@/lib/transport/stops'
import { vehicleLabel } from '@/lib/transport/vehicles'
import type {
  TransportRoute, TransportSchedule, TransportStaff, TransportStop, TransportVehicle,
} from '@/lib/transport/types'
import { DIRECTION_LABELS } from '@/lib/transport/types'
import ScheduleFormModal from './ScheduleFormModal'
import { GBTN } from './glass'

export default function ScheduleEditor({
  route, vehicles, crew,
}: {
  route: TransportRoute
  vehicles: TransportVehicle[]
  crew: TransportStaff[]
}) {
  const [schedules, setSchedules] = useState<TransportSchedule[]>([])
  const [stops, setStops] = useState<TransportStop[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<TransportSchedule | null | undefined>(undefined)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const [sch, st] = await Promise.all([fetchSchedules(route.id), fetchStops(route.id)])
    setSchedules(sch); setStops(st); setLoading(false)
  }, [route.id])

  useEffect(() => { load() }, [load])

  const spread = async (schedule: TransportSchedule) => {
    const input = prompt(
      `How many minutes does the ${DIRECTION_LABELS[schedule.direction].toLowerCase()} run take, first stop to last?`,
      '45',
    )
    if (!input) return
    const minutes = Number(input)
    if (!Number.isFinite(minutes) || minutes <= 0) return
    setBusy(true)
    await applyEvenOffsets(route.id, schedule.direction, minutes)
    setBusy(false)
    load()
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500">
          {loading ? 'Loading…' : `${schedules.length} schedule${schedules.length === 1 ? '' : 's'}`}
        </p>
        <button className={GBTN.primary} onClick={() => setEditing(null)} disabled={stops.length === 0}>
          <Plus size={14} /> New schedule
        </button>
      </div>

      {stops.length === 0 && (
        <p className="text-[11px] text-slate-400">Add stops to this route before scheduling it.</p>
      )}

      {schedules.length === 0 && !loading && stops.length > 0 && (
        <div className="border border-dashed border-slate-200 rounded-2xl px-4 py-8 text-center">
          <Clock size={20} className="mx-auto text-slate-400 mb-2" />
          <p className="text-sm font-semibold text-slate-600">No schedules yet</p>
          <p className="text-[11px] text-slate-400 mt-0.5 max-w-sm mx-auto">
            A schedule says when this route runs and in which direction — usually one to
            school in the morning and one home in the afternoon.
          </p>
        </div>
      )}

      <div className="space-y-2">
        {schedules.map(s => {
          const timings = stopTimings(s, stops)
          const missing = timings.filter(t => t.at === null).length
          const open = expanded === s.id
          return (
            <div key={s.id} className="rounded-2xl border border-slate-200/70 bg-white/75 overflow-hidden">
              <button
                className="w-full flex items-center gap-3 px-3 py-3 text-left hover:bg-white transition-colors"
                onClick={() => setExpanded(open ? null : s.id)}
              >
                <span
                  className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${
                    s.direction === 'inbound' ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-700'
                  }`}
                >
                  {s.direction === 'inbound' ? <ArrowRight size={14} /> : <ArrowLeft size={14} />}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-900 truncate">
                    {s.label || DIRECTION_LABELS[s.direction]} · {formatTime(s.start_time)}
                    {!s.active && (
                      <span className="ml-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">Paused</span>
                    )}
                  </p>
                  <p className="text-[11px] text-slate-500 truncate">
                    {describeDays(s.days_of_week)}
                    {' · '}
                    {s.vehicle ? vehicleLabel(s.vehicle) : route.default_vehicle ? `${vehicleLabel(route.default_vehicle)} (route default)` : 'No bus'}
                    {' · '}
                    {s.driver?.full_name ?? route.default_driver?.full_name ?? 'No driver'}
                  </p>
                </div>
                {missing > 0 && (
                  <span className="text-[10px] font-bold uppercase tracking-wider text-amber-600 flex-shrink-0">
                    {missing} stop{missing === 1 ? '' : 's'} untimed
                  </span>
                )}
              </button>

              {open && (
                <div className="border-t border-slate-100 px-3 py-3 space-y-3">
                  <div className="flex flex-wrap gap-2">
                    <button className={GBTN.secondary} onClick={() => setEditing(s)}>
                      <Pencil size={13} /> Edit
                    </button>
                    <button className={GBTN.secondary} onClick={() => spread(s)} disabled={busy}>
                      <Wand2 size={13} /> Spread stop times evenly
                    </button>
                    <button
                      className={GBTN.secondary}
                      onClick={async () => {
                        if (!confirm('Delete this schedule?')) return
                        await deleteSchedule(s.id)
                        load()
                      }}
                    >
                      <Trash2 size={13} /> Delete
                    </button>
                  </div>

                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Scheduled arrival at each stop</p>
                    <div className="mt-1.5 divide-y divide-slate-100 border border-slate-100 rounded-lg">
                      {timings.map(t => (
                        <div key={t.stop.id} className="flex items-center gap-2 px-2.5 py-1.5">
                          <span className="w-5 text-[11px] text-slate-400 flex-shrink-0">{t.stop.seq}</span>
                          <span className="flex-1 min-w-0 text-xs text-slate-600 truncate">{t.stop.name}</span>
                          <span className={`text-xs font-semibold ${t.at ? 'text-slate-900' : 'text-amber-600'}`}>
                            {t.at ? formatTime(t.at) : 'Not set'}
                          </span>
                        </div>
                      ))}
                    </div>
                    <p className="text-[11px] text-slate-400 mt-1.5">
                      Stop times are stored as an offset in minutes from this schedule&apos;s
                      departure, so a second departure on the same stops needs no re-entry.
                    </p>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {editing !== undefined && (
        <ScheduleFormModal
          schedule={editing}
          route={route}
          vehicles={vehicles}
          crew={crew}
          onClose={() => setEditing(undefined)}
          onSaved={() => { setEditing(undefined); load() }}
        />
      )}
    </div>
  )
}
