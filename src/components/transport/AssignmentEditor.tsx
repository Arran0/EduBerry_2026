'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Users, Search, Plus, X, MapPin, AlertTriangle, Sunrise, Sunset } from 'lucide-react'
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

const SELECT =
  'h-8 rounded-lg bg-white border border-slate-200 px-2 text-xs text-slate-800 focus:outline-none focus:border-[#B8983C] focus:ring-2 focus:ring-[#B8983C]/20 min-w-[8.5rem]'

/** Which trips of the day a set of assignments already covers. */
function covered(rows: AssignedRoute[]): { inbound: boolean; outbound: boolean } {
  return {
    inbound: rows.some(r => r.rides_inbound),
    outbound: rows.some(r => r.rides_outbound),
  }
}

/**
 * Who rides this route, where they get on and off, and which trips of the day.
 *
 * A child can be on more than one route — the morning bus 2 and the evening
 * bus 10 — so a student already on another route can still be added here. The
 * new assignment defaults to whichever direction they are not yet covered for,
 * and each row carries a To school / From school toggle. Each route a child
 * rides is billed separately (see the Fees tab).
 */
export default function AssignmentEditor({ route, onChanged }: { route: TransportRoute; onChanged?: () => void }) {
  const [assignments, setAssignments] = useState<TransportAssignment[]>([])
  const [stops, setStops] = useState<TransportStop[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Candidate[]>([])
  const [elsewhere, setElsewhere] = useState<Record<string, AssignedRoute[]>>({})
  const [searching, setSearching] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const [a, s] = await Promise.all([fetchAssignments(route.id), fetchStops(route.id)])
    setAssignments(a); setStops(s); setLoading(false)
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

  const add = async (c: Candidate) => {
    const others = (elsewhere[c.id] ?? []).filter(r => r.route_id !== route.id)
    const has = covered(others)
    // Fill the gap: someone already on a morning bus elsewhere joins this one
    // for the evening, and vice versa. Fully covered or new → both ways.
    const directions = has.inbound && !has.outbound ? { inbound: false, outbound: true }
      : has.outbound && !has.inbound ? { inbound: true, outbound: false }
      : { inbound: true, outbound: true }
    const res = await assignStudents(route.id, [c.id], {}, directions)
    if (res.success) { setQuery(''); setResults([]); await load(); onChanged?.() }
  }

  const patch = async (a: TransportAssignment, input: Partial<TransportAssignment>) => {
    setAssignments(as => as.map(x => (x.id === a.id ? { ...x, ...input } : x)))
    await updateAssignment(a.id, input as never)
  }

  const toggleDirection = (a: TransportAssignment, dir: 'inbound' | 'outbound') => {
    const next = dir === 'inbound'
      ? { rides_inbound: !a.rides_inbound, rides_outbound: a.rides_outbound }
      : { rides_inbound: a.rides_inbound, rides_outbound: !a.rides_outbound }
    // Riding neither direction is not riding — end the assignment instead.
    if (!next.rides_inbound && !next.rides_outbound) return
    patch(a, next)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
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
            {unassignedStop} without a stop — no ETA, no boarding prompt, no grid price
          </span>
        )}
      </div>

      <div className="relative">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
        <input
          className={`${GINPUT} pl-9 pr-9 h-10`}
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search a student by name to add them to this route…"
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
                        {!onThis && others.length > 0 && ` · also on ${others.map(o =>
                          `${o.route_name}${o.rides_inbound && !o.rides_outbound ? ' (morning)' : !o.rides_inbound && o.rides_outbound ? ' (evening)' : ''}`).join(', ')}`}
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
          This route has no stops yet, so riders cannot be given a pickup point. Add stops first.
        </p>
      )}

      {loading ? (
        <div className="space-y-1.5">{[0, 1, 2].map(i => <div key={i} className="h-14 rounded-xl bg-slate-100/80 animate-pulse" />)}</div>
      ) : assignments.length === 0 ? (
        <EmptyNote
          icon={Users}
          title="Nobody rides this route yet"
          detail="Search above to add students, then give each one a pickup and drop stop."
        />
      ) : (
        <ul className="divide-y divide-slate-200/70 rounded-2xl border border-slate-200/70 bg-white/70 overflow-hidden">
          {assignments.map(a => (
            <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5">
              <Avatar avatarUrl={a.student?.avatar_url ?? undefined} name={a.student?.full_name ?? '?'} size={30} userId={a.student_id} />
              <div className="flex-1 min-w-[9rem]">
                <p className="text-sm font-medium text-slate-900 truncate">{a.student?.full_name ?? 'Unknown'}</p>
                <p className="text-[11px] text-slate-500 truncate">
                  {a.student?.grade ? `Grade ${a.student.grade}${a.student.section ? ` · ${a.student.section}` : ''}` : 'No class'}
                  {a.location_label && ` · “${a.location_label}”`}
                </p>
              </div>

              <div className="lg-pill inline-flex items-center p-0.5" role="group" aria-label="Trips ridden">
                <DirToggle on={a.rides_inbound} onClick={() => toggleDirection(a, 'inbound')} icon={<Sunrise size={12} />} label="To school" />
                <DirToggle on={a.rides_outbound} onClick={() => toggleDirection(a, 'outbound')} icon={<Sunset size={12} />} label="From school" />
              </div>

              <label className="flex items-center gap-1.5">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Pickup</span>
                <select
                  className={SELECT}
                  value={a.pickup_stop_id ?? ''}
                  onChange={async e => { await patch(a, { pickup_stop_id: e.target.value || null }); load() }}
                >
                  <option value="">Not set</option>
                  {stops.map(s => <option key={s.id} value={s.id}>{s.seq}. {s.name}</option>)}
                </select>
              </label>

              <label className="flex items-center gap-1.5">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Drop</span>
                <select
                  className={SELECT}
                  value={a.drop_stop_id ?? ''}
                  onChange={async e => { await patch(a, { drop_stop_id: e.target.value || null }); load() }}
                >
                  <option value="">Same as pickup</option>
                  {stops.map(s => <option key={s.id} value={s.id}>{s.seq}. {s.name}</option>)}
                </select>
              </label>

              <button
                className="w-8 h-8 inline-flex items-center justify-center rounded-full text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors flex-shrink-0"
                aria-label="Remove from route"
                title="Remove from route"
                onClick={async () => {
                  if (!confirm(`Take ${a.student?.full_name} off this route from today?`)) return
                  await endAssignment(a.id)
                  await load()
                  onChanged?.()
                }}
              >
                <X size={15} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {stops.length > 0 && assignments.length > 0 && (
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Riders per stop</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {stops.map(s => (
              <span key={s.id} className="inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-full bg-white/80 border border-slate-200/70 text-slate-700">
                <span className="font-semibold">{s.seq}. {s.name}</span>
                <span className="text-slate-400 tabular-nums">{perStop[s.id] ?? 0}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function DirToggle({ on, onClick, icon, label }: { on: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      title={on ? `Rides ${label.toLowerCase()}` : `Doesn't ride ${label.toLowerCase()}`}
      className={`inline-flex items-center gap-1 h-7 px-2.5 rounded-full text-[11px] font-semibold transition ${
        on ? 'bg-gradient-to-b from-[#3D3B40] to-[#27272A] text-white shadow-sm' : 'text-slate-400 hover:text-slate-700'
      }`}
    >
      {icon}<span className="hidden md:inline">{label}</span>
    </button>
  )
}
