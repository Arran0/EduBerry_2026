'use client'

import React, { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Route as RouteIcon, Plus, ChevronRight, MapPin, Users, Power, Archive } from 'lucide-react'
import { ADMIN, SHEET, Sheet, SheetRowSkeleton } from '@/components/bus/adminUI'
import {
  fetchRoutes, fetchRouteStopCounts, fetchRouteStudentCounts, setRouteActive, archiveRoute,
} from '@/lib/transport/routes'
import { fetchVehicles, vehicleLabel } from '@/lib/transport/vehicles'
import { fetchTransportStaff } from '@/lib/transport/staff'
import type { TransportRoute, TransportStaff, TransportVehicle } from '@/lib/transport/types'
import RouteFormModal from '../RouteFormModal'
import { EmptyRow } from './FleetSection'

export default function RoutesSection() {
  const router = useRouter()
  const [routes, setRoutes] = useState<TransportRoute[]>([])
  const [stopCounts, setStopCounts] = useState<Record<string, number>>({})
  const [studentCounts, setStudentCounts] = useState<Record<string, number>>({})
  const [vehicles, setVehicles] = useState<TransportVehicle[]>([])
  const [crew, setCrew] = useState<TransportStaff[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<TransportRoute | null | undefined>(undefined)

  const load = useCallback(async () => {
    setLoading(true)
    // Four independent reads — fired together rather than awaited in sequence.
    const [r, stops, students, v, c] = await Promise.all([
      fetchRoutes(), fetchRouteStopCounts(), fetchRouteStudentCounts(), fetchVehicles(), fetchTransportStaff(),
    ])
    setRoutes(r); setStopCounts(stops); setStudentCounts(students)
    setVehicles(v); setCrew(c); setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const toggleActive = async (route: TransportRoute) => {
    // Optimistic: the toggle should feel instant, and a failed write reloads.
    setRoutes(rs => rs.map(r => (r.id === route.id ? { ...r, active: !r.active } : r)))
    const res = await setRouteActive(route.id, !route.active)
    if (!res.success) load()
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-[#71717A]">
          {loading ? 'Loading…' : `${routes.length} route${routes.length === 1 ? '' : 's'}`}
        </p>
        <button className={ADMIN.darkBtn} onClick={() => setEditing(null)}>
          <Plus size={14} /> New route
        </button>
      </div>

      <Sheet
        columns={
          <>
            <span className={`${SHEET.headCell} flex-1`}>Route</span>
            <span className={`${SHEET.headCell} w-28 text-center`}>Stops</span>
            <span className={`${SHEET.headCell} w-28 text-center`}>Students</span>
            <span className={`${SHEET.headCell} w-40`}>Bus &amp; driver</span>
            <span className={`${SHEET.headCell} w-20 text-right`}>Actions</span>
          </>
        }
      >
        {loading ? (
          <><SheetRowSkeleton /><SheetRowSkeleton /><SheetRowSkeleton /></>
        ) : routes.length === 0 ? (
          <EmptyRow
            icon={<RouteIcon size={22} />}
            title="No routes yet"
            detail="A route is an ordered list of stops. Create one, then place its stops on the map."
          />
        ) : (
          routes.map(r => {
            const stops = stopCounts[r.id] ?? 0
            const students = studentCounts[r.id] ?? 0
            const capacity = r.default_vehicle?.capacity ?? 0
            const over = capacity > 0 && students > capacity
            return (
              <div key={r.id} className={SHEET.row}>
                <div className={SHEET.bar} style={{ background: r.active ? r.color : '#D4D4D8' }} />
                <div className="flex items-center gap-3 flex-1 min-w-0 px-3 py-2.5">
                  <button
                    className="flex-1 min-w-0 text-left"
                    onClick={() => router.push(`/more/bus/routes/${r.id}`)}
                  >
                    <p className="text-sm font-semibold text-[#27272A] truncate">
                      {r.code && <span className="text-[#A1A1AA] mr-1.5">{r.code}</span>}
                      {r.name}
                      {!r.active && (
                        <span className="ml-2 text-[10px] font-bold uppercase tracking-wider text-[#A1A1AA]">
                          Paused
                        </span>
                      )}
                    </p>
                    <p className="text-[11px] text-[#71717A] truncate">
                      {r.description || 'No description'}
                    </p>
                    {/* Counts repeat on phones, where the columns are hidden. */}
                    <p className="text-[11px] text-[#A1A1AA] sm:hidden mt-0.5">
                      {stops} stops · {students} students
                    </p>
                  </button>

                  <span className="w-28 text-center text-sm text-[#52525B] hidden sm:flex items-center justify-center gap-1">
                    <MapPin size={12} className="text-[#A1A1AA]" /> {stops}
                  </span>
                  <span
                    className={`w-28 text-center text-sm hidden sm:flex items-center justify-center gap-1 ${
                      over ? 'text-rose-600 font-semibold' : 'text-[#52525B]'
                    }`}
                    title={over ? `${students} assigned but the bus seats ${capacity}` : undefined}
                  >
                    <Users size={12} className={over ? 'text-rose-500' : 'text-[#A1A1AA]'} />
                    {students}{capacity > 0 && <span className="text-[#A1A1AA]">/{capacity}</span>}
                  </span>
                  <div className="w-40 hidden sm:block min-w-0">
                    <p className="text-[11px] text-[#52525B] truncate">
                      {r.default_vehicle ? vehicleLabel(r.default_vehicle) : 'No bus set'}
                    </p>
                    <p className="text-[11px] text-[#A1A1AA] truncate">
                      {r.default_driver?.full_name ?? 'No driver set'}
                    </p>
                  </div>

                  <div className="w-20 flex items-center justify-end gap-1 flex-shrink-0">
                    <button
                      onClick={() => toggleActive(r)}
                      className={`p-1.5 rounded-md transition-colors ${
                        r.active
                          ? 'text-emerald-600 hover:bg-emerald-50'
                          : 'text-[#A1A1AA] hover:text-[#27272A] hover:bg-[#F4F4F5]'
                      }`}
                      aria-label={r.active ? 'Pause route' : 'Resume route'}
                      title={r.active ? 'Pause route' : 'Resume route'}
                    >
                      <Power size={14} />
                    </button>
                    <button
                      onClick={() => router.push(`/more/bus/routes/${r.id}`)}
                      className="p-1.5 rounded-md text-[#A1A1AA] hover:text-[#27272A] hover:bg-[#F4F4F5] transition-colors"
                      aria-label="Open route"
                    >
                      <ChevronRight size={16} />
                    </button>
                  </div>
                </div>
              </div>
            )
          })
        )}
      </Sheet>

      {routes.length > 0 && (
        <p className="text-[11px] text-[#A1A1AA]">
          Pausing a route stops it appearing in pickers but keeps its history.
          To retire one for good, open it and archive it — deleting would take a
          term of billing history with it.
        </p>
      )}

      {editing !== undefined && (
        <RouteFormModal
          route={editing}
          vehicles={vehicles}
          crew={crew}
          onClose={() => setEditing(undefined)}
          onSaved={id => {
            setEditing(undefined)
            // A brand-new route has nothing in it, so go straight to its stops.
            if (id && !editing) router.push(`/more/bus/routes/${id}`)
            else load()
          }}
        />
      )}
    </div>
  )
}
