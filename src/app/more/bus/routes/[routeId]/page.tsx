'use client'

import React, { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import {
  ArrowLeft, Pencil, MapPin, Clock, Users, Bus, Archive, RotateCcw,
} from 'lucide-react'
import ProtectedLayout from '@/components/ProtectedLayout'
import { ADMIN, SegTabs } from '@/components/bus/adminUI'
import StopEditor from '@/components/transport/StopEditor'
import ScheduleEditor from '@/components/transport/ScheduleEditor'
import AssignmentEditor from '@/components/transport/AssignmentEditor'
import RouteFormModal from '@/components/transport/RouteFormModal'
import { archiveRoute, fetchRoute, restoreRoute } from '@/lib/transport/routes'
import { fetchVehicles, vehicleLabel } from '@/lib/transport/vehicles'
import { fetchTransportStaff } from '@/lib/transport/staff'
import type { TransportRoute, TransportStaff, TransportVehicle } from '@/lib/transport/types'

type Tab = 'stops' | 'schedules' | 'students'

export default function RouteDetailPage() {
  const params = useParams<{ routeId: string }>()
  const routeId = params.routeId

  const [route, setRoute] = useState<TransportRoute | null>(null)
  const [vehicles, setVehicles] = useState<TransportVehicle[]>([])
  const [crew, setCrew] = useState<TransportStaff[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('stops')
  const [editing, setEditing] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const [r, v, c] = await Promise.all([
      fetchRoute(routeId), fetchVehicles(), fetchTransportStaff(),
    ])
    setRoute(r); setVehicles(v); setCrew(c); setLoading(false)
  }, [routeId])

  useEffect(() => { load() }, [load])

  return (
    <ProtectedLayout adminOnly>
      <div className="min-h-screen" style={{ background: ADMIN.pageBg }}>
        <div className="max-w-5xl mx-auto px-4 py-5 space-y-4">
          <Link
            href="/more/bus"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#71717A] hover:text-[#27272A] transition-colors"
          >
            <ArrowLeft size={14} /> Transport
          </Link>

          {loading ? (
            <div className="h-28 rounded-xl bg-white border border-[#E4E4E7] animate-pulse" />
          ) : !route ? (
            <div className={`${ADMIN.card} px-4 py-10 text-center`}>
              <p className="text-sm font-semibold text-[#52525B]">Route not found</p>
              <p className="text-xs text-[#A1A1AA] mt-1">It may have been deleted.</p>
            </div>
          ) : (
            <>
              <div className="rounded-xl overflow-hidden bg-[#27272A] text-white">
                <div className="h-1" style={{ background: route.color }} />
                <div className="px-4 py-4 flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <h1 className="text-lg font-bold truncate">
                      {route.code && <span className="text-[#A1A1AA] mr-2">{route.code}</span>}
                      {route.name}
                      {route.archived_at ? (
                        <span className="ml-2 text-[10px] font-bold uppercase tracking-wider text-[#A1A1AA]">Archived</span>
                      ) : !route.active ? (
                        <span className="ml-2 text-[10px] font-bold uppercase tracking-wider text-amber-400">Paused</span>
                      ) : null}
                    </h1>
                    {route.description && (
                      <p className="text-xs text-[#A1A1AA] mt-0.5 truncate">{route.description}</p>
                    )}
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-[11px] text-[#D4D4D8]">
                      <span className="inline-flex items-center gap-1">
                        <Bus size={12} />
                        {route.default_vehicle ? vehicleLabel(route.default_vehicle) : 'No bus set'}
                        {route.default_vehicle?.capacity ? ` · ${route.default_vehicle.capacity} seats` : ''}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Users size={12} />
                        {route.default_driver?.full_name ?? 'No driver set'}
                        {route.default_attendant?.full_name && ` · ${route.default_attendant.full_name}`}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={() => setEditing(true)}
                      className="p-2 rounded-lg text-[#A1A1AA] hover:text-white hover:bg-white/10 transition-colors"
                      aria-label="Edit route"
                    >
                      <Pencil size={15} />
                    </button>
                    <button
                      onClick={async () => {
                        if (route.archived_at) { await restoreRoute(route.id); load(); return }
                        if (!confirm(`Archive “${route.name}”? It stays in reports and billing history but disappears from the pickers.`)) return
                        await archiveRoute(route.id)
                        load()
                      }}
                      className="p-2 rounded-lg text-[#A1A1AA] hover:text-white hover:bg-white/10 transition-colors"
                      aria-label={route.archived_at ? 'Restore route' : 'Archive route'}
                      title={route.archived_at ? 'Restore route' : 'Archive route'}
                    >
                      {route.archived_at ? <RotateCcw size={15} /> : <Archive size={15} />}
                    </button>
                  </div>
                </div>
              </div>

              <SegTabs
                tabs={[
                  { key: 'stops', label: 'Stops', icon: <MapPin size={14} /> },
                  { key: 'schedules', label: 'Schedules', icon: <Clock size={14} /> },
                  { key: 'students', label: 'Students', icon: <Users size={14} /> },
                ]}
                value={tab}
                onChange={setTab}
              />

              {tab === 'stops' && <StopEditor route={route} />}
              {tab === 'schedules' && <ScheduleEditor route={route} vehicles={vehicles} crew={crew} />}
              {tab === 'students' && <AssignmentEditor route={route} />}

            </>
          )}
        </div>
      </div>

      {editing && route && (
        <RouteFormModal
          route={route}
          vehicles={vehicles}
          crew={crew}
          onClose={() => setEditing(false)}
          onSaved={() => { setEditing(false); load() }}
        />
      )}
    </ProtectedLayout>
  )
}
