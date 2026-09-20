'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Users, Search, Plus, X, MapPin, AlertTriangle } from 'lucide-react'
import Avatar from '@/components/Avatar'
import { ADMIN } from '@/components/bus/adminUI'
import {
  fetchAssignments, endAssignment, updateAssignment, assignStudents,
  fetchAssignableStudents, fetchAssignedRouteByStudent, countByStop,
} from '@/lib/transport/assignments'
import { fetchStops } from '@/lib/transport/stops'
import { vehicleLabel } from '@/lib/transport/vehicles'
import type { TransportAssignment, TransportRoute, TransportStop } from '@/lib/transport/types'
import { Select } from './formUI'

interface Candidate { id: string; full_name: string; avatar_url?: string | null; grade?: number | null; section?: string | null }

export default function AssignmentEditor({ route }: { route: TransportRoute }) {
  const [assignments, setAssignments] = useState<TransportAssignment[]>([])
  const [stops, setStops] = useState<TransportStop[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Candidate[]>([])
  const [alreadyOn, setAlreadyOn] = useState<Record<string, string>>({})
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
      const routeByStudent = await fetchAssignedRouteByStudent(found.map(f => f.id))
      if (cancelled) return
      setResults(found as Candidate[])
      setAlreadyOn(routeByStudent)
      setSearching(false)
    }, 250)
    return () => { cancelled = true; clearTimeout(t) }
  }, [query])

  const perStop = useMemo(() => countByStop(assignments), [assignments])
  const capacity = route.default_vehicle?.capacity ?? 0
  const over = capacity > 0 && assignments.length > capacity
  const unassignedStop = assignments.filter(a => !a.pickup_stop_id).length

  const add = async (studentId: string) => {
    const res = await assignStudents(route.id, [studentId])
    if (res.success) { setQuery(''); setResults([]); load() }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1.5 text-sm">
          <Users size={15} className={over ? 'text-rose-500' : 'text-[#A1A1AA]'} />
          <span className={over ? 'text-rose-600 font-semibold' : 'text-[#52525B]'}>
            {assignments.length} assigned
            {capacity > 0 && <span className="text-[#A1A1AA]"> of {capacity} seats</span>}
          </span>
        </div>
        {over && (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-rose-600">
            <AlertTriangle size={12} />
            {assignments.length - capacity} over capacity on {vehicleLabel(route.default_vehicle)}
          </span>
        )}
        {unassignedStop > 0 && (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-600">
            <MapPin size={12} />
            {unassignedStop} without a stop — they get no ETA and no boarding prompt
          </span>
        )}
      </div>

      <div className="relative">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#A1A1AA]" />
        <input
          className={ADMIN.input}
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search a student by name to add them…"
        />
        {query && (
          <button
            className="absolute right-3 top-1/2 -translate-y-1/2 text-[#A1A1AA] hover:text-[#27272A]"
            onClick={() => { setQuery(''); setResults([]) }}
            aria-label="Clear"
          >
            <X size={15} />
          </button>
        )}
        {query.trim() && (
          <div className="absolute z-20 left-0 right-0 mt-1 bg-white border border-[#E4E4E7] rounded-xl shadow-lg max-h-64 overflow-y-auto">
            {searching ? (
              <p className="px-3 py-3 text-xs text-[#A1A1AA]">Searching…</p>
            ) : results.length === 0 ? (
              <p className="px-3 py-3 text-xs text-[#A1A1AA]">No students match “{query}”.</p>
            ) : (
              results.map(r => {
                const onThisRoute = alreadyOn[r.id] === route.id
                const onAnother = alreadyOn[r.id] && !onThisRoute
                return (
                  <button
                    key={r.id}
                    className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-[#FAFAFA] text-left disabled:opacity-50"
                    disabled={!!alreadyOn[r.id]}
                    onClick={() => add(r.id)}
                  >
                    <Avatar avatarUrl={r.avatar_url ?? undefined} name={r.full_name} size={26} userId={r.id} />
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm text-[#27272A] truncate">{r.full_name}</span>
                      <span className="block text-[11px] text-[#A1A1AA] truncate">
                        {r.grade ? `Grade ${r.grade}${r.section ? ` · ${r.section}` : ''}` : 'No class'}
                        {onThisRoute && ' · already on this route'}
                        {onAnother && ' · already on another route'}
                      </span>
                    </span>
                    {!alreadyOn[r.id] && <Plus size={14} className="text-[#A1A1AA] flex-shrink-0" />}
                  </button>
                )
              })
            )}
          </div>
        )}
      </div>

      {stops.length === 0 && (
        <p className="text-[11px] text-amber-600">
          This route has no stops yet, so students cannot be given a pickup point. Add stops first.
        </p>
      )}

      {loading ? (
        <p className="text-xs text-[#A1A1AA] py-6 text-center">Loading students…</p>
      ) : assignments.length === 0 ? (
        <div className="border border-dashed border-[#E4E4E7] rounded-xl px-4 py-8 text-center">
          <Users size={20} className="mx-auto text-[#A1A1AA] mb-2" />
          <p className="text-sm font-semibold text-[#52525B]">Nobody rides this route yet</p>
          <p className="text-[11px] text-[#A1A1AA] mt-0.5">
            Search above to add students, then give each one a pickup and drop stop.
          </p>
        </div>
      ) : (
        <div className={`${ADMIN.card} divide-y divide-[#F4F4F5] overflow-hidden`}>
          {assignments.map(a => (
            <div key={a.id} className="flex flex-wrap items-center gap-2 px-3 py-2.5">
              <Avatar
                avatarUrl={a.student?.avatar_url ?? undefined}
                name={a.student?.full_name ?? '?'}
                size={28}
                userId={a.student_id}
              />
              <div className="flex-1 min-w-[9rem]">
                <p className="text-sm text-[#27272A] truncate">{a.student?.full_name ?? 'Unknown'}</p>
                <p className="text-[11px] text-[#A1A1AA] truncate">
                  {a.student?.grade ? `Grade ${a.student.grade}${a.student.section ? ` · ${a.student.section}` : ''}` : 'No class'}
                  {a.location_label && ` · “${a.location_label}”`}
                </p>
              </div>

              <label className="flex items-center gap-1.5">
                <span className="text-[10px] font-bold uppercase tracking-wider text-[#A1A1AA]">Pickup</span>
                <Select
                  className="!py-1.5 !text-xs !w-auto min-w-[8rem]"
                  value={a.pickup_stop_id ?? ''}
                  onChange={async e => {
                    const v = e.target.value || null
                    setAssignments(as => as.map(x => (x.id === a.id ? { ...x, pickup_stop_id: v } : x)))
                    await updateAssignment(a.id, { pickup_stop_id: v })
                    load()
                  }}
                >
                  <option value="">Not set</option>
                  {stops.map(s => <option key={s.id} value={s.id}>{s.seq}. {s.name}</option>)}
                </Select>
              </label>

              <label className="flex items-center gap-1.5">
                <span className="text-[10px] font-bold uppercase tracking-wider text-[#A1A1AA]">Drop</span>
                <Select
                  className="!py-1.5 !text-xs !w-auto min-w-[8rem]"
                  value={a.drop_stop_id ?? ''}
                  onChange={async e => {
                    const v = e.target.value || null
                    setAssignments(as => as.map(x => (x.id === a.id ? { ...x, drop_stop_id: v } : x)))
                    await updateAssignment(a.id, { drop_stop_id: v })
                    load()
                  }}
                >
                  <option value="">Same as pickup</option>
                  {stops.map(s => <option key={s.id} value={s.id}>{s.seq}. {s.name}</option>)}
                </Select>
              </label>

              <button
                className="p-1.5 rounded-md text-[#A1A1AA] hover:text-rose-600 hover:bg-rose-50 transition-colors flex-shrink-0"
                aria-label="Remove from route"
                title="Remove from route"
                onClick={async () => {
                  if (!confirm(`Take ${a.student?.full_name} off this route from today?`)) return
                  await endAssignment(a.id)
                  load()
                }}
              >
                <X size={15} />
              </button>
            </div>
          ))}
        </div>
      )}

      {stops.length > 0 && assignments.length > 0 && (
        <div>
          <p className={ADMIN.label}>Riders per stop</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {stops.map(s => (
              <span
                key={s.id}
                className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full bg-[#F4F4F5] text-[#52525B]"
              >
                <span className="font-semibold">{s.seq}. {s.name}</span>
                <span className="text-[#A1A1AA]">{perStop[s.id] ?? 0}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
