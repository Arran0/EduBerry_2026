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
import DriverOverrideEditor from '@/components/bus/DriverOverrideEditor'
import { archiveRoute, fetchRoute, restoreRoute } from '@/lib/transport/routes'
import { fetchVehicles, vehicleLabel } from '@/lib/transport/vehicles'
import { fetchTransportStaff } from '@/lib/transport/staff'
import { fetchDriverOverrides } from '@/lib/bus'
import type { TransportRoute, TransportStaff, TransportVehicle } from '@/lib/transport/types'
import type { TripDriverOverride } from '@/lib/bus'

type Tab = 'stops' | 'schedules' | 'students'

export default function RouteDetailPage() {
  const params = useParams<{ routeId: string }>()
  const routeId = params.routeId

  const [route, setRoute] = useState<TransportRoute | null>(null)
  const [vehicles, setVehicles] = useState<TransportVehicle[]>([])
  const [crew, setCrew] = useState<TransportStaff[]>([])
  const [overrides, setOverrides] = useState<TripDriverOverride[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('stops')
  const [editing, setEditing] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const [r, v, c, o] = await Promise.all([
      fetchRoute(routeId), fetchVehicles(), fetchTransportStaff(), fetchDriverOverrides(routeId),
    ])
    setRoute(r); setVehicles(v); setCrew(c); setOverrides(o); setLoading(false)
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

              {tab === 'schedules' && (
                <div className={`${ADMIN.card} p-4`}>
                  <p className={ADMIN.label}>Substitute driver for a date</p>
                  <p className="text-[11px] text-[#A1A1AA] mt-1 mb-3">
                    A stop-gap until Round 2, where the driver is recorded on each day&apos;s
                    trip run instead and a substitution is simply a different value on that run.
                  </p>
                  <DriverOverrideEditor
                    tripId={route.id}
                    overrides={overrides}
                    drivers={crew
                      .filter(c => c.kind === 'driver' && c.active && c.profile)
                      .map(c => ({
                        id: c.profile_id,
                        full_name: c.profile!.full_name,
                        avatar_url: c.profile!.avatar_url,
                        role: 'driver' as const,
                        email: '',
                        created_at: '',
                        updated_at: '',
                      }))}
                    onChanged={load}
                  />
                </div>
              )}
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
