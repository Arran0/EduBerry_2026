'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Users, Search, Plus, X, MapPin, AlertTriangle } from 'lucide-react'
import Avatar from '@/components/Avatar'
import {
  fetchAssignments, endAssignment, updateAssignment, assignStudents,
  fetchAssignableStudents, fetchAssignedRouteByStudent, countByStop, type AssignedRoute,
} from '@/lib/transport/assignments'
import { fetchStops } from '@/lib/transport/stops'
import { vehicleLabel } from '@/lib/transport/vehicles'
import type { TransportAssignment, TransportRoute, TransportStop } from '@/lib/transport/types'
import { EmptyNote, GINPUT } from './glass'

interface Candidate { id: string; full_name: string; avatar_url?: string | null; grade?: number | null; section?: string | null }

/** The stop picker inside a rider row: borderless until it needs attention. */
const SELECT =
  'w-full h-7 appearance-none rounded-md bg-slate-50 hover:bg-slate-100 pl-2 pr-6 text-[12px] text-slate-800 truncate focus:outline-none focus:ring-2 focus:ring-[#B8983C]/30 cursor-pointer'

const directionNote = (o: AssignedRoute) =>
  o.rides_inbound && !o.rides_outbound ? ' (to school)' : !o.rides_inbound && o.rides_outbound ? ' (from school)' : ''

/**
 * Who rides this route, and their one stop on it.
 *
 * A route runs one way, so a rider has one stop: where they are picked up on a
 * to-school route, where they are dropped on a from-school route. A child who
 * rides both ways is on two routes — one each way — so a student already on
 * another route can still be added here for the other half of their day.
 *
 * The stop is stored as the pickup stop either way (it is "their stop" to every
 * screen that reads it); on a from-school route the drop stop mirrors it,
 * because that is the column the trip builder reads for that direction.
 */
export default function AssignmentEditor({ route, onChanged }: { route: TransportRoute; onChanged?: () => void }) {
  const [assignments, setAssignments] = useState<TransportAssignment[]>([])
  const [stops, setStops] = useState<TransportStop[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Candidate[]>([])
  const [elsewhere, setElsewhere] = useState<Record<string, AssignedRoute[]>>({})
  const [searching, setSearching] = useState(false)
  /** The stop the list is narrowed to; 'none' for riders with no stop yet. */
  const [stopFilter, setStopFilter] = useState<string | null>(null)

  const inbound = route.direction === 'inbound'
  const stopWord = inbound ? 'pickup point' : 'drop point'

  const load = useCallback(async () => {
    setLoading(true)
    const [a, s] = await Promise.all([fetchAssignments(route.id), fetchStops(route.id)])
    setAssignments(a); setStops(s.filter(x => x.kind !== 'school')); setLoading(false)
  }, [route.id])

  useEffect(() => { load() }, [load])

  // Debounced search — one query per pause, not one per keystroke.
  useEffect(() => {
    if (!query.trim()) { setResults([]); return }
    let cancelled = false
    setSearching(true)
    const t = setTimeout(async () => {
      const found = await fetchAssignableStudents(query)
      if (cancelled) return
      const byStudent = await fetchAssignedRouteByStudent(found.map(f => f.id))
      if (cancelled) return
      setResults(found as Candidate[])
      setElsewhere(byStudent)
      setSearching(false)
    }, 250)
    return () => { cancelled = true; clearTimeout(t) }
  }, [query])

  const perStop = useMemo(() => countByStop(assignments), [assignments])
  const capacity = route.default_vehicle?.capacity ?? 0
  const over = capacity > 0 && assignments.length > capacity
  const unassignedStop = assignments.filter(a => !a.pickup_stop_id).length

  // Along the route, then by name, so the list reads in the order the bus
  // meets them; riders still without a stop come first, since they need work.
  const seqOf = useMemo(() => new Map(stops.map(s => [s.id, s.seq])), [stops])
  const shown = useMemo(() => {
    const list = stopFilter === 'none' ? assignments.filter(a => !a.pickup_stop_id)
      : stopFilter ? assignments.filter(a => a.pickup_stop_id === stopFilter)
      : assignments
    return [...list].sort((x, y) =>
      (x.pickup_stop_id ? seqOf.get(x.pickup_stop_id) ?? 999 : -1) - (y.pickup_stop_id ? seqOf.get(y.pickup_stop_id) ?? 999 : -1)
      || (x.student?.full_name ?? '').localeCompare(y.student?.full_name ?? ''))
  }, [assignments, stopFilter, seqOf])

  const add = async (c: Candidate) => {
    const res = await assignStudents(route.id, [c.id], {}, { inbound, outbound: !inbound })
    if (res.success) { setQuery(''); setResults([]); await load(); onChanged?.() }
  }

  const setStop = async (a: TransportAssignment, stopId: string | null) => {
    const patch = { pickup_stop_id: stopId, drop_stop_id: inbound ? null : stopId }
    setAssignments(as => as.map(x => (x.id === a.id ? { ...x, ...patch } : x)))
    await updateAssignment(a.id, patch)
    load()
  }

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className={`inline-flex items-center gap-1.5 text-sm font-semibold ${over ? 'text-rose-600' : 'text-slate-700'}`}>
          <Users size={15} className={over ? 'text-rose-500' : 'text-slate-400'} />
          {assignments.length} rider{assignments.length === 1 ? '' : 's'}
          {capacity > 0 && <span className="font-medium text-slate-400"> · {capacity} seats</span>}
        </span>
        {over && (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-rose-600">
            <AlertTriangle size={12} />
            {assignments.length - capacity} over capacity on {vehicleLabel(route.default_vehicle)}
          </span>
        )}
        {unassignedStop > 0 && (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-600">
            <MapPin size={12} />
            {unassignedStop} without a {stopWord}
          </span>
        )}
      </div>

      <div className="relative">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
        <input
          className={`${GINPUT} pl-9 pr-9 !h-9`}
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Add a student — type a name…"
        />
        {query && (
          <button
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-800"
            onClick={() => { setQuery(''); setResults([]) }}
            aria-label="Clear"
          >
            <X size={15} />
          </button>
        )}
        {query.trim() && (
          <div className="absolute z-30 left-0 right-0 mt-1.5 lg-tooltip !p-1 max-h-72 overflow-y-auto">
            {searching ? (
              <p className="px-3 py-3 text-xs text-slate-500">Searching…</p>
            ) : results.length === 0 ? (
              <p className="px-3 py-3 text-xs text-slate-500">No students match “{query}”.</p>
            ) : (
              results.map(r => {
                const theirs = elsewhere[r.id] ?? []
                const onThis = theirs.some(x => x.route_id === route.id)
                const others = theirs.filter(x => x.route_id !== route.id)
                return (
                  <button
                    key={r.id}
                    className="w-full flex items-center gap-2.5 rounded-xl px-2.5 py-2 hover:bg-white text-left disabled:opacity-50"
                    disabled={onThis}
                    onClick={() => add(r)}
                  >
                    <Avatar avatarUrl={r.avatar_url ?? undefined} name={r.full_name} size={28} userId={r.id} />
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm text-slate-900 truncate">{r.full_name}</span>
                      <span className="block text-[11px] text-slate-500 truncate">
                        {r.grade ? `Grade ${r.grade}${r.section ? ` · ${r.section}` : ''}` : 'No class'}
                        {onThis && ' · already on this route'}
                        {!onThis && others.length > 0 && ` · also on ${others.map(o => `${o.route_name}${directionNote(o)}`).join(', ')}`}
                      </span>
                    </span>
                    {!onThis && <Plus size={15} className="text-slate-400 flex-shrink-0" />}
                  </button>
                )
              })
            )}
          </div>
        )}
      </div>

      {stops.length === 0 && (
        <p className="text-[11.5px] text-amber-600">
          This route has no stops yet, so riders cannot be given a {stopWord}. Add stops first.
        </p>
      )}

      {/* Riders per stop, which is also the filter. */}
      {stops.length > 0 && assignments.length > 0 && (
        <div className="-mx-0.5 flex gap-1 overflow-x-auto scrollbar-none px-0.5 pb-0.5">
          <Chip on={stopFilter === null} onClick={() => setStopFilter(null)} label="All" n={assignments.length} />
          {unassignedStop > 0 && (
            <Chip on={stopFilter === 'none'} onClick={() => setStopFilter(stopFilter === 'none' ? null : 'none')} label="No stop" n={unassignedStop} warn />
          )}
          {stops.map(s => (
            <Chip key={s.id} on={stopFilter === s.id} onClick={() => setStopFilter(stopFilter === s.id ? null : s.id)}
              label={`${s.seq}. ${s.name}`} n={perStop[s.id] ?? 0} />
          ))}
        </div>
      )}

      {loading ? (
        <div className="space-y-1">{[0, 1, 2, 3].map(i => <div key={i} className="h-9 rounded-lg bg-slate-100/80 animate-pulse" />)}</div>
      ) : assignments.length === 0 ? (
        <EmptyNote
          icon={Users}
          title="Nobody rides this route yet"
          detail={`Search above to add students, then give each one a ${stopWord}.`}
        />
      ) : (
        // One line per rider, two columns from lg: a full bus of forty fits
        // on a desktop screen and about fifteen on a phone.
        <ul className="grid grid-cols-1 lg:grid-cols-2 lg:gap-x-4 rounded-xl border border-slate-200/70 bg-white/70 px-2 sm:px-2.5">
          {shown.map(a => (
            <li key={a.id} className="flex items-center gap-2 h-10 border-b border-slate-200/60 last:border-b-0 lg:[&:nth-last-child(2):nth-child(odd)]:border-b-0">
              <span className="hidden sm:block flex-shrink-0">
                <Avatar avatarUrl={a.student?.avatar_url ?? undefined} name={a.student?.full_name ?? '?'} size={22} userId={a.student_id} />
              </span>
              <span className="flex-1 min-w-0 flex items-baseline gap-1.5">
                <span className="text-[13px] font-medium text-slate-900 truncate">{a.student?.full_name ?? 'Unknown'}</span>
                <span className="flex-shrink-0 text-[10.5px] text-slate-400 tabular-nums">
                  {a.student?.grade ? `${a.student.grade}${a.student.section ? a.student.section : ''}` : ''}
                </span>
              </span>

              <span className="relative w-[44%] sm:w-[11rem] flex-shrink-0">
                <select
                  aria-label={`${stopWord} for ${a.student?.full_name ?? 'rider'}`}
                  className={`${SELECT} ${a.pickup_stop_id ? '' : '!bg-amber-50 !text-amber-800 ring-1 ring-amber-200'}`}
                  value={a.pickup_stop_id ?? ''}
                  onChange={e => setStop(a, e.target.value || null)}
                >
                  <option value="">No {stopWord}</option>
                  {stops.map(s => <option key={s.id} value={s.id}>{s.seq}. {s.name}</option>)}
                </select>
                <MapPin size={11} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              </span>

              <button
                className="w-7 h-7 -mr-1 inline-flex items-center justify-center rounded-full text-slate-300 hover:text-rose-600 hover:bg-rose-50 transition-colors flex-shrink-0"
                aria-label={`Take ${a.student?.full_name ?? 'rider'} off this route`}
                title="Take off this route"
                onClick={async () => {
                  if (!confirm(`Take ${a.student?.full_name} off this route from today?`)) return
                  await endAssignment(a.id)
                  await load()
                  onChanged?.()
                }}
              >
                <X size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Chip({ on, onClick, label, n, warn }: { on: boolean; onClick: () => void; label: string; n: number; warn?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`inline-flex flex-shrink-0 items-center gap-1.5 h-7 px-2.5 rounded-full text-[11.5px] font-semibold whitespace-nowrap transition ${
        on ? 'bg-[#27272A] text-white'
          : warn ? 'bg-amber-50 text-amber-800 ring-1 ring-amber-200'
          : 'bg-white/80 text-slate-700 ring-1 ring-slate-200/80 hover:bg-white'
      }`}
    >
      {label}
      <span className={`tabular-nums ${on ? 'text-white/60' : 'text-slate-400'}`}>{n}</span>
    </button>
  )
}
