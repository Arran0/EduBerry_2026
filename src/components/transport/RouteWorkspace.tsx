'use client'

/**
 * Everything about one route, in one place: who drives it, where it stops,
 * when it runs, who rides it and what they pay.
 *
 * Used twice — inline in the Configuration tab, beside the route list, and as
 * the whole of /more/bus/routes/[id] — so the two can never drift apart.
 */

import React, { useState } from 'react'
import {
  Archive, ArrowLeftFromLine, ArrowRightToLine, Bus, Clock, IndianRupee, MapPin, Pencil, RotateCcw, Users, UserRound,
} from 'lucide-react'
import { archiveRoute, restoreRoute } from '@/lib/transport/routes'
import { vehicleLabel } from '@/lib/transport/vehicles'
import type { TransportRoute, TransportStaff, TransportVehicle } from '@/lib/transport/types'
import StopEditor from './StopEditor'
import ScheduleEditor from './ScheduleEditor'
import AssignmentEditor from './AssignmentEditor'
import RouteFeesEditor from './RouteFeesEditor'
import RouteFormModal from './RouteFormModal'
import { BUS, GlassSegments } from './glass'

export type RouteTab = 'stops' | 'schedules' | 'students' | 'fees'

export default function RouteWorkspace({
  route, vehicles, crew, riders, onChanged, tab: controlledTab, onTabChange, initialTab = 'stops',
}: {
  route: TransportRoute
  vehicles: TransportVehicle[]
  crew: TransportStaff[]
  /** Active rider count, when the caller already has it. */
  riders?: number
  onChanged: () => void
  /** Control the tab from outside (the Configuration search opens a rider's route on Students). */
  tab?: RouteTab
  onTabChange?: (tab: RouteTab) => void
  initialTab?: RouteTab
}) {
  const [ownTab, setOwnTab] = useState<RouteTab>(initialTab)
  const tab = controlledTab ?? ownTab
  const setTab = (t: RouteTab) => { setOwnTab(t); onTabChange?.(t) }
  const [editing, setEditing] = useState(false)

  const capacity = route.default_vehicle?.capacity ?? 0
  const fill = capacity > 0 && riders != null ? Math.min(1, riders / capacity) : null
  const over = capacity > 0 && riders != null && riders > capacity

  // No pause here: a route stops making trips by pausing its schedule, and
  // leaves for good by being archived.
  const status = route.archived_at ? { text: 'Archived', cls: 'bg-slate-100 text-slate-500' } : null

  return (
    <div className="min-w-0">
      {/* Header — the route's identity on a tinted strip of its own colour. */}
      <div className="relative overflow-hidden rounded-[18px] p-4 sm:p-5 text-white"
        style={{ background: `linear-gradient(135deg, ${BUS.ink} 0%, ${BUS.charcoal} 60%, ${BUS.bronze} 140%)` }}>
        <div aria-hidden className="absolute inset-x-0 top-0 h-[3px]" style={{ background: route.color }} />
        <div aria-hidden className="absolute inset-0 bg-[linear-gradient(160deg,rgba(255,255,255,.12),transparent_45%)]" />

        <div className="relative flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              {route.code && (
                <span className="px-2 py-0.5 rounded-md bg-white/15 text-[11px] font-bold tracking-wide">{route.code}</span>
              )}
              {status && <span className={`px-2 py-0.5 rounded-full text-[10.5px] font-bold ${status.cls}`}>{status.text}</span>}
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/15 text-[10.5px] font-bold">
                {route.direction === 'inbound' ? <ArrowRightToLine size={11} /> : <ArrowLeftFromLine size={11} />}
                {route.direction === 'inbound' ? 'To school' : 'From school'}
              </span>
            </div>
            <h2 className="mt-1.5 font-display text-[1.35rem] sm:text-[1.6rem] font-bold leading-tight headline truncate">{route.name}</h2>
            {route.description && <p className="text-[12px] text-white/70 truncate max-w-xl">{route.description}</p>}
          </div>

          <div className="flex items-center gap-1">
            <HeaderBtn label="Edit route" onClick={() => setEditing(true)}><Pencil size={15} /></HeaderBtn>
            <HeaderBtn
              label={route.archived_at ? 'Restore route' : 'Archive route'}
              onClick={async () => {
                if (route.archived_at) { await restoreRoute(route.id); onChanged(); return }
                if (!confirm(`Archive “${route.name}”? It stays in reports and billing history but disappears from the pickers.`)) return
                await archiveRoute(route.id)
                onChanged()
              }}
            >
              {route.archived_at ? <RotateCcw size={15} /> : <Archive size={15} />}
            </HeaderBtn>
          </div>
        </div>

        <div className="relative mt-4 grid grid-cols-1 sm:grid-cols-3 gap-2">
          <Fact icon={Bus} label="Bus" value={route.default_vehicle ? vehicleLabel(route.default_vehicle) : 'Not set'}
            sub={capacity ? `${capacity} seats` : undefined} />
          <Fact icon={UserRound} label="Driver" value={route.default_driver?.full_name ?? 'Not set'}
            sub={route.default_attendant?.full_name ? `with ${route.default_attendant.full_name}` : 'no attendant'} />
          <div className="rounded-xl bg-white/10 border border-white/10 px-3 py-2 backdrop-blur-sm">
            <p className="text-[10px] font-bold uppercase tracking-wider text-white/60 flex items-center gap-1"><Users size={11} /> Riders</p>
            <p className={`mt-0.5 text-sm font-semibold tabular-nums ${over ? 'text-rose-300' : ''}`}>
              {riders ?? '—'}{capacity ? <span className="text-white/60"> / {capacity}</span> : ''}
            </p>
            {fill != null && (
              <div className="mt-1.5 h-1.5 rounded-full bg-white/15 overflow-hidden">
                <div className="h-full rounded-full transition-all" style={{ width: `${fill * 100}%`, background: over ? '#fda4af' : BUS.goldSoft }} />
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="mt-3.5 mb-3.5 flex justify-center sm:justify-start">
        <GlassSegments
          stretch
          layoutId={`route-tab-${route.id}`}
          value={tab}
          onChange={setTab}
          items={[
            { key: 'stops', label: 'Stops', icon: MapPin },
            { key: 'schedules', label: 'Schedules', icon: Clock },
            { key: 'students', label: 'Students', icon: Users },
            { key: 'fees', label: 'Fees', icon: IndianRupee },
          ]}
        />
      </div>

      <div className="lg-content p-3 sm:p-4">
        {tab === 'stops' && <StopEditor route={route} />}
        {tab === 'schedules' && <ScheduleEditor route={route} vehicles={vehicles} crew={crew} />}
        {tab === 'students' && <AssignmentEditor route={route} onChanged={onChanged} />}
        {tab === 'fees' && <RouteFeesEditor route={route} onChanged={onChanged} />}
      </div>

      {editing && (
        <RouteFormModal
          route={route}
          vehicles={vehicles}
          crew={crew}
          onClose={() => setEditing(false)}
          onSaved={() => { setEditing(false); onChanged() }}
        />
      )}
    </div>
  )
}

function HeaderBtn({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} title={label} aria-label={label}
      className="w-9 h-9 inline-flex items-center justify-center rounded-full text-white/70 hover:text-white hover:bg-white/15 transition active:scale-95">
      {children}
    </button>
  )
}

function Fact({ icon: Icon, label, value, sub }: { icon: React.ElementType; label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl bg-white/10 border border-white/10 px-3 py-2 backdrop-blur-sm min-w-0">
      <p className="text-[10px] font-bold uppercase tracking-wider text-white/60 flex items-center gap-1"><Icon size={11} /> {label}</p>
      <p className="mt-0.5 text-sm font-semibold truncate">{value}</p>
      {sub && <p className="text-[11px] text-white/60 truncate">{sub}</p>}
    </div>
  )
}
