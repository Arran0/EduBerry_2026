'use client'

import React, { Suspense, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft, ChevronDown, Route as RouteIcon } from 'lucide-react'
import ProtectedLayout from '@/components/ProtectedLayout'
import { ADMIN } from '@/components/bus/adminUI'
import RouteWorkspace, { type RouteTab } from '@/components/transport/RouteWorkspace'
import { EmptyNote, GlassPanel } from '@/components/transport/glass'
import { fetchRoute, fetchRouteCounts, fetchRoutes } from '@/lib/transport/routes'
import { fetchVehicles } from '@/lib/transport/vehicles'
import { fetchTransportStaff } from '@/lib/transport/staff'
import type { TransportRoute, TransportStaff, TransportVehicle } from '@/lib/transport/types'

const TABS: RouteTab[] = ['stops', 'schedules', 'students', 'fees']

export default function RouteDetailPage() {
  return (
    <Suspense fallback={null}>
      <RouteDetail />
    </Suspense>
  )
}

/**
 * One route, full width — the same workspace the Configuration tab shows
 * beside its route list, for when a route needs the whole screen (placing
 * twenty stops on the map) or a link to send someone.
 */
function RouteDetail() {
  const params = useParams<{ routeId: string }>()
  const routeId = params.routeId
  const router = useRouter()
  const search = useSearchParams()
  const tabParam = search.get('tab') as RouteTab | null

  const [route, setRoute] = useState<TransportRoute | null>(null)
  const [routes, setRoutes] = useState<TransportRoute[]>([])
  const [riders, setRiders] = useState<number | undefined>(undefined)
  const [vehicles, setVehicles] = useState<TransportVehicle[]>([])
  const [crew, setCrew] = useState<TransportStaff[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const [r, all, counts, v, c] = await Promise.all([
      fetchRoute(routeId), fetchRoutes(), fetchRouteCounts(), fetchVehicles(), fetchTransportStaff(),
    ])
    setRoute(r); setRoutes(all); setRiders(counts.students[routeId] ?? 0)
    setVehicles(v); setCrew(c); setLoading(false)
  }, [routeId])

  useEffect(() => { setLoading(true); load() }, [load])

  return (
    <ProtectedLayout adminOnly>
      <div data-page-theme="bus" className="min-h-screen">
        <div className={`${ADMIN.shell} px-4 sm:px-6 lg:px-8 py-5 space-y-4`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Link
              href="/more/bus?tab=config"
              className="lg-pill inline-flex items-center gap-1.5 h-9 px-3.5 text-[12.5px] font-semibold text-slate-700 hover:text-slate-900 transition"
            >
              <ArrowLeft size={14} /> Transport · Configuration
            </Link>

            {routes.length > 1 && (
              <label className="lg-pill relative inline-flex items-center gap-2 h-9 pl-3.5 pr-8 text-[12.5px] font-semibold text-slate-700">
                <RouteIcon size={14} className="text-slate-400" />
                <span className="sr-only">Switch route</span>
                <select
                  value={routeId}
                  onChange={e => router.push(`/more/bus/routes/${e.target.value}`)}
                  className="appearance-none bg-transparent pr-1 focus:outline-none cursor-pointer max-w-[14rem] truncate"
                >
                  {routes.map(r => <option key={r.id} value={r.id}>{r.code ? `${r.code} · ` : ''}{r.name}</option>)}
                </select>
                <ChevronDown size={14} className="absolute right-3 text-slate-400 pointer-events-none" />
              </label>
            )}
          </div>

          <GlassPanel>
            {loading ? (
              <div className="space-y-3">
                <div className="h-40 rounded-[18px] bg-white/60 animate-pulse" />
                <div className="h-10 w-80 max-w-full rounded-full bg-white/60 animate-pulse" />
                <div className="h-96 rounded-[18px] bg-white/60 animate-pulse" />
              </div>
            ) : !route ? (
              <div className="lg-content">
                <EmptyNote icon={RouteIcon} title="Route not found" detail="It may have been deleted." />
              </div>
            ) : (
              <RouteWorkspace
                key={route.id}
                route={route}
                vehicles={vehicles}
                crew={crew}
                riders={riders}
                onChanged={load}
                initialTab={tabParam && TABS.includes(tabParam) ? tabParam : 'stops'}
              />
            )}
          </GlassPanel>
        </div>
      </div>
    </ProtectedLayout>
  )
}
