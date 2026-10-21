'use client'

/**
 * When the route runs.
 *
 * A route runs one way, so it has exactly one schedule, and this tab is that
 * schedule's form rather than a list of them. Every field the old "New
 * schedule" popup asked for is here and the essential ones are required — a
 * route with no saved schedule never becomes a trip, so the tab says so in as
 * many words until it is filled in.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, Clock, Loader2, Save, Trash2, Wand2 } from 'lucide-react'
import {
  applyEvenOffsets, createSchedule, deleteSchedule, describeDays, fetchSchedules, formatTime,
  stopTimings, updateSchedule,
} from '@/lib/transport/schedules'
import { fetchStops } from '@/lib/transport/stops'
import { vehicleLabel } from '@/lib/transport/vehicles'
import type {
  ScheduleInput, TransportRoute, TransportSchedule, TransportStaff, TransportStop, TransportVehicle,
} from '@/lib/transport/types'
import { DIRECTION_LABELS, WEEKDAYS } from '@/lib/transport/types'
import { GBTN, GINPUT } from './glass'

interface Form {
  label: string
  days_of_week: number[]
  start_time: string
  end_time: string
  vehicle_id: string
  driver_id: string
  auto_start: boolean
  active: boolean
}

function formFrom(route: TransportRoute, s: TransportSchedule | null): Form {
  return {
    label: s?.label ?? '',
    days_of_week: s?.days_of_week ?? [1, 2, 3, 4, 5],
    start_time: s?.start_time?.slice(0, 5) ?? '',
    end_time: s?.end_time?.slice(0, 5) ?? '',
    // Prefilled from the route's defaults so the common case is one click.
    vehicle_id: s?.vehicle_id ?? route.default_vehicle_id ?? '',
    driver_id: s?.driver_id ?? route.default_driver_id ?? '',
    auto_start: s?.auto_start ?? true,
    active: s?.active ?? true,
  }
}

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
  const [form, setForm] = useState<Form>(() => formFrom(route, null))
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [spreadMin, setSpreadMin] = useState('45')

  // The route's one schedule: the first in its own direction.
  const schedule = useMemo(
    () => schedules.find(s => s.direction === route.direction) ?? null,
    [schedules, route.direction],
  )
  const extras = schedules.filter(s => s.id !== schedule?.id)

  const load = useCallback(async () => {
    setLoading(true)
    const [sch, st] = await Promise.all([fetchSchedules(route.id), fetchStops(route.id)])
    setSchedules(sch); setStops(st); setLoading(false)
    setForm(formFrom(route, sch.find(s => s.direction === route.direction) ?? null))
  }, [route])

  useEffect(() => { load() }, [load])

  const set = <K extends keyof Form>(k: K, v: Form[K]) => { setForm(f => ({ ...f, [k]: v })); setMessage(null) }
  const toggleDay = (day: number) => {
    const days = new Set(form.days_of_week)
    if (days.has(day)) days.delete(day)
    else days.add(day)
    set('days_of_week', [...days].sort((a, b) => a - b))
  }

  const drivers = crew.filter(c => c.kind === 'driver' && c.active)

  const missing: string[] = []
  if (form.days_of_week.length === 0) missing.push('the days it runs')
  if (!form.start_time) missing.push('a departure time')
  if (!form.end_time) missing.push('an arrival time')
  if (form.start_time && form.end_time && form.end_time <= form.start_time) missing.push('an arrival after the departure')
  if (!form.vehicle_id) missing.push('a bus')
  if (!form.driver_id) missing.push('a driver')

  const dirty = JSON.stringify(form) !== JSON.stringify(formFrom(route, schedule))

  const save = async () => {
    if (missing.length) { setMessage({ ok: false, text: `Set ${missing.join(', ')}.` }); return }
    setSaving(true); setMessage(null)
    const payload: ScheduleInput = {
      route_id: route.id,
      direction: route.direction,
      label: form.label.trim() || null,
      days_of_week: form.days_of_week,
      start_time: form.start_time,
      end_time: form.end_time,
      vehicle_id: form.vehicle_id,
      driver_id: form.driver_id,
      attendant_id: null,
      auto_start: form.auto_start,
      active: form.active,
    }
    const res = schedule ? await updateSchedule(schedule.id, payload) : await createSchedule(payload)
    setSaving(false)
    if (!res.success) { setMessage({ ok: false, text: res.error ?? 'Could not save the schedule.' }); return }
    setMessage({ ok: true, text: 'Schedule saved.' })
    load()
  }

  const spread = async () => {
    const minutes = Number(spreadMin)
    if (!Number.isFinite(minutes) || minutes <= 0) return
    setSaving(true)
    await applyEvenOffsets(route.id, route.direction, minutes)
    setSaving(false)
    load()
  }

  if (loading) {
    return <div className="space-y-2">{[0, 1, 2].map(i => <div key={i} className="h-14 rounded-xl bg-slate-100/80 animate-pulse" />)}</div>
  }

  const timings = schedule ? stopTimings(schedule, stops) : []
  const untimed = timings.filter(t => t.at === null).length
  const label = 'text-[10px] font-bold uppercase tracking-wider text-slate-500'

  return (
    <div className="space-y-4">
      {/* Status — the one thing to know about a route's schedule. */}
      {!schedule ? (
        <div className="flex items-start gap-2.5 rounded-2xl border border-amber-200 bg-amber-50/80 px-3.5 py-3">
          <AlertTriangle size={16} className="mt-0.5 flex-shrink-0 text-amber-600" />
          <p className="text-[12.5px] leading-snug text-amber-800">
            <span className="font-semibold">Not scheduled yet.</span> This route won&apos;t become a trip on any day
            until its schedule below is filled in and saved.
          </p>
        </div>
      ) : (
        <div className="flex items-start gap-2.5 rounded-2xl border border-emerald-200 bg-emerald-50/70 px-3.5 py-3">
          <CheckCircle2 size={16} className="mt-0.5 flex-shrink-0 text-emerald-600" />
          <p className="text-[12.5px] leading-snug text-emerald-800">
            <span className="font-semibold">{DIRECTION_LABELS[route.direction]}</span> · {describeDays(schedule.days_of_week)} ·
            departs {formatTime(schedule.start_time)}, arrives {formatTime(schedule.end_time)}
            {!schedule.active && <span className="font-semibold"> · paused</span>}
          </p>
        </div>
      )}

      {stops.length === 0 && (
        <p className="text-[11.5px] text-amber-600">Add this route&apos;s stops first — the schedule times them.</p>
      )}

      {/* The schedule itself */}
      <div className="rounded-2xl border border-slate-200/70 bg-white/75 p-3.5 sm:p-4 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <label className="block">
            <span className={label}>Direction</span>
            <div className={`${GINPUT} mt-1 flex items-center text-slate-500 bg-slate-50/80`}>
              {DIRECTION_LABELS[route.direction]} <span className="ml-1.5 text-[11px] text-slate-400">· set on the route</span>
            </div>
          </label>
          <label className="block">
            <span className={label}>Departs *</span>
            <input type="time" className={`${GINPUT} mt-1 ${!form.start_time ? '!border-amber-300' : ''}`} value={form.start_time} onChange={e => set('start_time', e.target.value)} />
          </label>
          <label className="block">
            <span className={label}>Arrives *</span>
            <input type="time" className={`${GINPUT} mt-1 ${!form.end_time ? '!border-amber-300' : ''}`} value={form.end_time} onChange={e => set('end_time', e.target.value)} />
          </label>
          <label className="block">
            <span className={label}>Label</span>
            <input className={`${GINPUT} mt-1`} value={form.label} placeholder={route.direction === 'inbound' ? 'Morning pickup' : 'Evening drop'} onChange={e => set('label', e.target.value)} />
          </label>
        </div>

        <div>
          <span className={label}>Runs on *</span>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {WEEKDAYS.map(d => {
              const on = form.days_of_week.includes(d.value)
              return (
                <button
                  key={d.value}
                  type="button"
                  onClick={() => toggleDay(d.value)}
                  aria-pressed={on}
                  className={`h-8 min-w-[3rem] px-3 rounded-full text-xs font-semibold transition ${
                    on ? 'bg-gradient-to-b from-[#1B3F8A] to-[#13306B] text-white shadow-sm' : 'bg-white border border-slate-200 text-slate-500 hover:text-slate-800'
                  }`}
                >
                  {d.short}
                </button>
              )
            })}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block">
            <span className={label}>Bus *</span>
            <select className={`${GINPUT} mt-1 ${!form.vehicle_id ? '!border-amber-300' : ''}`} value={form.vehicle_id} onChange={e => set('vehicle_id', e.target.value)}>
              <option value="">Choose a bus</option>
              {vehicles.map(v => <option key={v.id} value={v.id}>{vehicleLabel(v)}{v.capacity ? ` · ${v.capacity} seats` : ''}</option>)}
            </select>
          </label>
          <label className="block">
            <span className={label}>Driver *</span>
            <select className={`${GINPUT} mt-1 ${!form.driver_id ? '!border-amber-300' : ''}`} value={form.driver_id} onChange={e => set('driver_id', e.target.value)}>
              <option value="">Choose a driver</option>
              {drivers.map(d => <option key={d.id} value={d.profile_id}>{d.profile?.full_name ?? 'Unknown'}</option>)}
            </select>
          </label>
        </div>
        {(vehicles.length === 0 || drivers.length === 0) && (
          <p className="text-[11px] text-amber-700">
            {vehicles.length === 0 ? 'No buses yet' : 'No drivers yet'} — add them under Fleet &amp; crew on this page first.
          </p>
        )}

        <div className="flex flex-col sm:flex-row sm:items-start gap-3 sm:gap-6">
          <label className="flex items-start gap-2 text-[12.5px] text-slate-700">
            <input type="checkbox" className="mt-0.5 accent-[#1B3F8A]" checked={form.auto_start} onChange={e => set('auto_start', e.target.checked)} />
            <span>
              Start the trip automatically when the bus moves
              <span className="block text-[11px] text-slate-500">Otherwise the driver taps Start.</span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-[12.5px] text-slate-700">
            <input type="checkbox" className="mt-0.5 accent-[#1B3F8A]" checked={form.active} onChange={e => set('active', e.target.checked)} />
            <span>
              Running
              <span className="block text-[11px] text-slate-500">Untick to stop this route making trips for a while — a bus in for repairs, a holiday week.</span>
            </span>
          </label>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200/70 pt-3">
          <p className={`text-[12px] ${message ? (message.ok ? 'text-emerald-700 font-semibold' : 'text-rose-600 font-semibold') : 'text-slate-500'}`}>
            {message?.text ?? (missing.length ? `Still needed: ${missing.join(', ')}.` : dirty ? 'Unsaved changes.' : schedule ? 'All saved.' : 'Ready to save.')}
          </p>
          <button className={GBTN.primary} onClick={save} disabled={saving || (!dirty && !!schedule)}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            {schedule ? 'Save schedule' : 'Save and schedule route'}
          </button>
        </div>
      </div>

      {/* Stop times */}
      {schedule && stops.length > 0 && (
        <div className="rounded-2xl border border-slate-200/70 bg-white/75 p-3.5 sm:p-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-[13px] font-bold text-slate-900 flex items-center gap-1.5"><Clock size={14} className="text-slate-400" /> Arrival at each stop</p>
              <p className="text-[11.5px] text-slate-500">
                Stored as minutes after departure, so moving the departure time moves every stop with it.
                {untimed > 0 && <span className="font-semibold text-amber-700"> {untimed} stop{untimed === 1 ? '' : 's'} untimed.</span>}
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-slate-500">Trip takes</span>
              <input className={`${GINPUT} !w-16 !h-8 text-center`} inputMode="numeric" value={spreadMin} onChange={e => setSpreadMin(e.target.value.replace(/\D/g, ''))} />
              <span className="text-[11px] text-slate-500">min</span>
              <button className={GBTN.secondary} onClick={spread} disabled={saving}>
                <Wand2 size={13} /> Spread evenly
              </button>
            </div>
          </div>
          <ul className="mt-3 divide-y divide-slate-200/60 rounded-xl border border-slate-200/70 bg-white/80">
            {timings.map(t => (
              <li key={t.stop.id} className="flex items-center gap-2.5 px-3 py-1.5">
                <span className="w-5 text-[11px] text-slate-400 tabular-nums">{t.stop.seq}</span>
                <span className="flex-1 min-w-0 text-[12.5px] text-slate-700 truncate">{t.stop.name}</span>
                <span className={`text-[12.5px] font-semibold tabular-nums ${t.at ? 'text-slate-900' : 'text-amber-600'}`}>
                  {t.at ? formatTime(t.at) : 'Not set'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Leftovers from before a route had one direction. */}
      {extras.length > 0 && (
        <div className="rounded-2xl border border-slate-200/70 bg-white/60 p-3.5">
          <p className="text-[12px] font-semibold text-slate-700">Other schedules on this route</p>
          <p className="text-[11px] text-slate-500">Left over from before a route had a single schedule. They still create trips — delete them unless that is intended.</p>
          <ul className="mt-2 space-y-1">
            {extras.map(x => (
              <li key={x.id} className="flex items-center gap-2 text-[12px] text-slate-600">
                <span className="flex-1">{DIRECTION_LABELS[x.direction]} · {describeDays(x.days_of_week)} · {formatTime(x.start_time)}</span>
                <button
                  className={`${GBTN.icon} hover:!text-rose-600`}
                  aria-label="Delete schedule"
                  onClick={async () => { if (confirm('Delete this schedule?')) { await deleteSchedule(x.id); load() } }}
                >
                  <Trash2 size={13} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
