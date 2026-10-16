'use client'

/**
 * Configuration — everything that is set up rather than watched.
 *
 * Routes, fleet and crew used to be three separate popups, which kept apart
 * the three things that only make sense together: a route is a bus, a driver
 * and a list of children. So they are one page here, and each refers to the
 * others —
 *
 *   network at a glance
 *   → routes: pick one on the left, work on it on the right
 *     (stops · schedules · students · fees — the fee grid lives with the route)
 *   → fleet & crew: each bus and each person shows the routes they serve
 *   → monthly bills: issue a month for every route at once
 *   → connections: WhatsApp, GPS and scanning, still in their own popups
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle, Bus, IdCard, IndianRupee, Map as MapIcon, MapPin, MessageCircle, Pencil, Phone, Plus,
  Radio, Receipt, Route as RouteIcon, ScanLine, ShieldCheck, SlidersHorizontal, Trash2, Users,
} from 'lucide-react'
import Avatar from '@/components/Avatar'
import { fmtINR } from '@/lib/formatMoney'
import { fetchRouteCounts, fetchRoutes, fetchRouteSearchIndex, type RouteSearchIndex } from '@/lib/transport/routes'
import { complianceWarnings, deleteVehicle, fetchVehicles, vehicleLabel } from '@/lib/transport/vehicles'
import { deleteTransportStaff, fetchCrewCandidates, fetchTransportStaff } from '@/lib/transport/staff'
import { currentPeriod, previewBills, type BillableRider } from '@/lib/transport/fees'
import { mapProviderStatus } from '@/lib/transport/mapTiles'
import type { TransportRoute, TransportStaff, TransportVehicle } from '@/lib/transport/types'
import { STAFF_KIND_LABELS, VEHICLE_STATUS_LABELS } from '@/lib/transport/types'
import RouteWorkspace, { type RouteTab } from '../RouteWorkspace'
import RouteNavigator from '../RouteNavigator'
import RouteFormModal from '../RouteFormModal'
import VehicleFormModal from '../VehicleFormModal'
import CrewFormModal from '../CrewFormModal'
import BillingRun from '../BillingRun'
import {
  BUS, CardHead, Content, EmptyNote, GBTN, GlassPanel, GlassTileButton,
} from '../glass'

export type ConnectionKey = 'whatsapp' | 'gps' | 'scan'

export default function ConfigurationSection({ onOpenPanel, routeId, onRouteChange }: {
  onOpenPanel: (key: ConnectionKey) => void
  /** The open route, held by the page so it survives in the URL (`?route=`). */
  routeId: string | null
  onRouteChange: (routeId: string | null) => void
}) {
  const [routes, setRoutes] = useState<TransportRoute[]>([])
  const [counts, setCounts] = useState<{ stops: Record<string, number>; students: Record<string, number> }>({ stops: {}, students: {} })
  const [vehicles, setVehicles] = useState<TransportVehicle[]>([])
  const [crew, setCrew] = useState<TransportStaff[]>([])
  const [candidates, setCandidates] = useState<Awaited<ReturnType<typeof fetchCrewCandidates>>>([])
  const [billing, setBilling] = useState<BillableRider[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [index, setIndex] = useState<RouteSearchIndex | null>(null)
  const [tab, setTab] = useState<RouteTab>('stops')
  const selectedId = routeId
  const setSelectedId = onRouteChange
  const [newRoute, setNewRoute] = useState(false)
  const [editVehicle, setEditVehicle] = useState<TransportVehicle | null | undefined>(undefined)
  const [editCrew, setEditCrew] = useState<TransportStaff | null | undefined>(undefined)
  const routesRef = useRef<HTMLDivElement>(null)

  /** Open a route, optionally on a given tab. */
  const openRoute = useCallback((id: string, t?: RouteTab) => {
    setSelectedId(id)
    if (t) setTab(t)
  }, [setSelectedId])

  /** Open a route from a bus or crew row, and bring the route panel into view. */
  const pickRoute = useCallback((id: string) => {
    openRoute(id)
    routesRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [openRoute])

  // Kept in a ref so loadRoutes can default the selection without depending on it.
  const selectedRef = useRef(selectedId)
  useEffect(() => { selectedRef.current = selectedId }, [selectedId])

  const loadRoutes = useCallback(async () => {
    const [r, c, ix] = await Promise.all([fetchRoutes(true), fetchRouteCounts(), fetchRouteSearchIndex()])
    setRoutes(r); setCounts(c); setIndex(ix)
    const cur = selectedRef.current
    if (!cur || !r.some(x => x.id === cur)) setSelectedId(r.find(x => !x.archived_at)?.id ?? r[0]?.id ?? null)
  }, [setSelectedId])

  const loadFleet = useCallback(async () => {
    const [v, c, cand] = await Promise.all([fetchVehicles(), fetchTransportStaff(), fetchCrewCandidates()])
    setVehicles(v); setCrew(c); setCandidates(cand)
  }, [])

  const loadBilling = useCallback(async () => {
    setBilling(await previewBills(currentPeriod()))
  }, [])

  useEffect(() => {
    Promise.all([loadRoutes(), loadFleet(), loadBilling()]).then(() => setLoading(false))
  }, [loadRoutes, loadFleet, loadBilling])

  const onRouteChanged = useCallback(() => { loadRoutes(); loadBilling() }, [loadRoutes, loadBilling])

  const live = routes.filter(r => !r.archived_at)
  const selected = routes.find(r => r.id === selectedId) ?? null

  const totals = useMemo(() => {
    const riders = live.reduce((n, r) => n + (counts.students[r.id] ?? 0), 0)
    const stops = live.reduce((n, r) => n + (counts.stops[r.id] ?? 0), 0)
    const warnings = vehicles.reduce((n, v) => n + (complianceWarnings(v).length > 0 ? 1 : 0), 0)
    const priced = (billing ?? []).filter(b => b.fee.amount != null)
    return {
      riders, stops, warnings,
      monthly: priced.reduce((n, b) => n + (b.fee.amount ?? 0), 0),
      unpriced: (billing ?? []).length - priced.length,
    }
  }, [live, counts, vehicles, billing])

  // Who runs what — the cross-reference that makes fleet and crew one view.
  const routesByVehicle = useMemo(() => {
    const m: Record<string, TransportRoute[]> = {}
    for (const r of live) if (r.default_vehicle_id) (m[r.default_vehicle_id] ??= []).push(r)
    return m
  }, [live])
  const routesByPerson = useMemo(() => {
    const m: Record<string, { route: TransportRoute; as: 'driver' | 'attendant' }[]> = {}
    for (const r of live) {
      if (r.default_driver_id) (m[r.default_driver_id] ??= []).push({ route: r, as: 'driver' })
      if (r.default_attendant_id) (m[r.default_attendant_id] ??= []).push({ route: r, as: 'attendant' })
    }
    return m
  }, [live])

  const map = mapProviderStatus()

  return (
    <div className="space-y-5">
      {/* ── Network at a glance ───────────────────────────────────── */}
      <GlassPanel eyebrow="Configuration" title="Transport network" icon={SlidersHorizontal}>
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2 px-0.5">
          <Tile icon={RouteIcon} value={loading ? '—' : `${live.filter(r => r.active).length}`} label="Routes running" sub={`${live.length - live.filter(r => r.active).length} paused`} />
          <Tile icon={MapPin} value={loading ? '—' : `${totals.stops}`} label="Stops" sub="across all routes" />
          <Tile icon={Users} value={loading ? '—' : `${totals.riders}`} label="Riders assigned" sub="one per route ridden" />
          <Tile icon={Bus} value={loading ? '—' : `${vehicles.filter(v => v.status === 'active').length}`} label="Buses in service"
            sub={totals.warnings > 0 ? `${totals.warnings} with papers due` : 'papers current'} tone={totals.warnings > 0 ? 'warn' : undefined} />
          <Tile icon={IdCard} value={loading ? '—' : `${crew.filter(c => c.active).length}`} label="Crew" sub={`${crew.filter(c => c.kind === 'driver').length} drivers · ${crew.filter(c => c.kind === 'attendant').length} attendants`} />
          <Tile icon={IndianRupee} value={billing ? fmtINR(totals.monthly) : '—'} label="Billed per month"
            sub={totals.unpriced > 0 ? `${totals.unpriced} riders without a price` : 'every rider priced'} tone={totals.unpriced > 0 ? 'warn' : undefined} />
        </div>
      </GlassPanel>

      {/* ── Routes ────────────────────────────────────────────────── */}
      <div ref={routesRef} className="scroll-mt-4">
      <GlassPanel eyebrow="Routes & trips" title="Routes" icon={RouteIcon} delay={0.04}>
        <div className="px-0.5 pb-3">
          {loading ? (
            <div className="h-10 rounded-full bg-white/60 animate-pulse" />
          ) : (
            <RouteNavigator
              routes={routes}
              index={index}
              riders={counts.students}
              selectedId={selectedId}
              onSelect={openRoute}
              onNew={() => setNewRoute(true)}
            />
          )}
        </div>

        {loading ? (
          <div className="space-y-3">
            <div className="h-40 rounded-[18px] bg-white/60 animate-pulse" />
            <div className="h-80 rounded-[18px] bg-white/60 animate-pulse" />
          </div>
        ) : selected ? (
          <RouteWorkspace
            key={selected.id}
            route={selected}
            vehicles={vehicles}
            crew={crew}
            riders={counts.students[selected.id] ?? 0}
            onChanged={onRouteChanged}
            tab={tab}
            onTabChange={setTab}
          />
        ) : (
          <Content>
            <EmptyNote
              icon={RouteIcon}
              title="No routes yet"
              detail="A route runs one way — to school or from school — with its own stops, bus, driver, schedule and riders. Create the first one."
              action={<button className={GBTN.primary} onClick={() => setNewRoute(true)}><Plus size={14} /> New route</button>}
            />
          </Content>
        )}
      </GlassPanel>
      </div>

      {/* ── Fleet & crew ──────────────────────────────────────────── */}
      <GlassPanel eyebrow="Fleet & crew" title="Buses and the people who run them" icon={Bus} delay={0.08}>
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
          <Content className="p-4">
            <CardHead icon={Bus} label={`Buses · ${vehicles.length}`}
              right={<button className={GBTN.secondary} onClick={() => setEditVehicle(null)}><Plus size={13} /> Add bus</button>} />
            <div className="mt-3">
              {loading ? <RowSkeletons /> : vehicles.length === 0 ? (
                <EmptyNote icon={Bus} title="No buses yet" detail="Add the buses this school runs. Routes and schedules attach to them." />
              ) : (
                <ul className="divide-y divide-slate-200/60">
                  {vehicles.map(v => {
                    const w = complianceWarnings(v)
                    const on = routesByVehicle[v.id] ?? []
                    return (
                      <li key={v.id} className="group flex items-start gap-3 py-2.5">
                        <span className={`mt-1.5 w-2 h-2 rounded-full flex-shrink-0 ${v.status === 'active' ? 'bg-emerald-500' : v.status === 'maintenance' ? 'bg-amber-500' : 'bg-slate-300'}`} />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-slate-900 truncate">
                            {vehicleLabel(v)}
                            {v.status !== 'active' && <span className="ml-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">{VEHICLE_STATUS_LABELS[v.status]}</span>}
                          </p>
                          <p className="text-[11px] text-slate-500 truncate">
                            {v.registration_no}{v.make_model ? ` · ${v.make_model}` : ''} · {v.capacity || '—'} seats
                          </p>
                          <RouteChips items={on.map(r => ({ route: r }))} empty="Not the default bus on any route" onPick={pickRoute} />
                          {w.length > 0 && (
                            <p className={`mt-1 inline-flex items-center gap-1 text-[11px] font-semibold ${w[0].expired ? 'text-rose-600' : 'text-amber-600'}`}>
                              <AlertTriangle size={11} />
                              {w[0].label} {w[0].expired ? `expired ${Math.abs(w[0].daysLeft)}d ago` : `due in ${w[0].daysLeft}d`}
                              {w.length > 1 && ` +${w.length - 1}`}
                            </p>
                          )}
                        </div>
                        <RowActions
                          onEdit={() => setEditVehicle(v)}
                          onDelete={async () => {
                            if (!confirm(`Delete ${vehicleLabel(v)}? Routes pointing at it will lose the link.`)) return
                            await deleteVehicle(v.id)
                            loadFleet(); loadRoutes()
                          }}
                        />
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </Content>

          <Content className="p-4">
            <CardHead icon={IdCard} label={`Drivers & attendants · ${crew.length}`}
              right={
                <button className={GBTN.secondary} onClick={() => setEditCrew(null)} disabled={candidates.length === 0}
                  title={candidates.length === 0 ? 'Create a driver account in User Management first' : undefined}>
                  <Plus size={13} /> Add crew
                </button>
              } />
            {candidates.length === 0 && !loading && (
              <p className="mt-2 text-[11px] text-slate-500">
                No driver accounts yet. Create one in User Management — attendants use a driver account too.
              </p>
            )}
            <div className="mt-3">
              {loading ? <RowSkeletons /> : crew.length === 0 ? (
                <EmptyNote icon={IdCard} title="No crew yet" detail="Add the drivers and attendants who work the routes. Parents see their name and phone." />
              ) : (
                <ul className="divide-y divide-slate-200/60">
                  {crew.map(c => {
                    const on = routesByPerson[c.profile_id] ?? []
                    const licDays = c.licence_expiry
                      ? Math.round((new Date(c.licence_expiry + 'T00:00:00').getTime() - new Date().setHours(0, 0, 0, 0)) / 86_400_000)
                      : null
                    return (
                      <li key={c.id} className="flex items-start gap-3 py-2.5">
                        <Avatar avatarUrl={c.profile?.avatar_url} name={c.profile?.full_name ?? '?'} size={32} userId={c.profile_id} />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-slate-900 truncate flex items-center gap-1.5">
                            {c.profile?.full_name ?? 'Unknown'}
                            {c.verified_at && <ShieldCheck size={13} className="text-emerald-500 flex-shrink-0" />}
                            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{STAFF_KIND_LABELS[c.kind]}</span>
                            {!c.active && <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">· Inactive</span>}
                          </p>
                          <p className="text-[11px] text-slate-500 truncate flex items-center gap-1.5">
                            {c.licence_no ? `DL ${c.licence_no}` : c.kind === 'driver' ? 'No licence on file' : (c.employee_code || 'No employee code')}
                            {c.phone && <><span className="text-slate-300">·</span><Phone size={10} /> {c.phone}</>}
                          </p>
                          <RouteChips
                            items={on.map(x => ({ route: x.route, note: x.as === 'attendant' ? 'attending' : undefined }))}
                            empty="Not on any route by default"
                            onPick={pickRoute}
                          />
                          {licDays != null && licDays <= 30 && (
                            <p className={`mt-1 inline-flex items-center gap-1 text-[11px] font-semibold ${licDays < 0 ? 'text-rose-600' : 'text-amber-600'}`}>
                              <AlertTriangle size={11} /> Licence {licDays < 0 ? `expired ${Math.abs(licDays)}d ago` : `expires in ${licDays}d`}
                            </p>
                          )}
                        </div>
                        <RowActions
                          onEdit={() => setEditCrew(c)}
                          onDelete={async () => {
                            if (!confirm(`Remove the ${STAFF_KIND_LABELS[c.kind].toLowerCase()} record for ${c.profile?.full_name}?`)) return
                            await deleteTransportStaff(c.id)
                            loadFleet()
                          }}
                        />
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </Content>
        </div>
      </GlassPanel>

      {/* ── Monthly bills ─────────────────────────────────────────── */}
      <GlassPanel eyebrow="Billing" title="Issue a month of bus fees" icon={Receipt} delay={0.1}
        ambient={['#10b981', BUS.gold, BUS.taupe]}>
        <Content className="p-3 sm:p-4">
          <p className="mb-3 text-[12px] leading-snug text-slate-600 max-w-3xl">
            One bill per rider per route, priced from each route&apos;s fee grid or the rider&apos;s custom amount
            (choose by-stop or by-student pricing on each route&apos;s <span className="font-semibold">Fees</span> tab above).
            A child on a to-school route and a from-school route gets a bill for each. Running a month twice only bills whoever
            was missed the first time.
          </p>
          <BillingRun onIssued={loadBilling} />
        </Content>
      </GlassPanel>

      {/* ── Connections ───────────────────────────────────────────── */}
      <GlassPanel eyebrow="Connections" title="WhatsApp, GPS & scanning" icon={Radio} delay={0.12}>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2.5">
          <GlassTileButton icon={MessageCircle} label="WhatsApp" detail="Message templates and the sending account" onClick={() => onOpenPanel('whatsapp')} />
          <GlassTileButton icon={Radio} label="GPS" detail="Hardware already fitted to the buses" onClick={() => onOpenPanel('gps')} />
          <GlassTileButton icon={ScanLine} label="Scan" detail="Cards, fobs and QR — only if you want them" onClick={() => onOpenPanel('scan')} />
          <div className="lg-content flex items-center gap-3 p-3.5">
            <span className="icon-chip w-10 h-10 flex-shrink-0" style={{ background: map.connected ? 'linear-gradient(135deg,#34d399,#059669)' : `linear-gradient(135deg, ${BUS.charcoal}, ${BUS.bronze})` }}>
              <MapIcon size={17} className="relative z-10 text-white" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-slate-900">Map · {map.label}</span>
              <span className="mt-0.5 inline-flex items-center gap-1.5 text-[10.5px] font-semibold text-slate-600">
                <span className={`w-1.5 h-1.5 rounded-full ${map.connected ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                {map.connected ? 'Mapbox connected' : 'Mapbox not connected'}
              </span>
              <span className="block text-[11px] leading-snug text-slate-500">{map.detail}</span>
            </span>
          </div>
        </div>
      </GlassPanel>

      {newRoute && (
        <RouteFormModal
          route={null}
          vehicles={vehicles}
          crew={crew}
          onClose={() => setNewRoute(false)}
          onSaved={async id => {
            setNewRoute(false)
            await loadRoutes()
            // A new route is empty, so open it where the work starts: its stops.
            if (id) openRoute(id, 'stops')
          }}
        />
      )}
      {editVehicle !== undefined && (
        <VehicleFormModal
          vehicle={editVehicle}
          onClose={() => setEditVehicle(undefined)}
          onSaved={() => { setEditVehicle(undefined); loadFleet(); loadRoutes() }}
        />
      )}
      {editCrew !== undefined && (
        <CrewFormModal
          staff={editCrew}
          candidates={candidates}
          onClose={() => setEditCrew(undefined)}
          onSaved={() => { setEditCrew(undefined); loadFleet() }}
        />
      )}
    </div>
  )
}

/* ── Pieces ────────────────────────────────────────────────────── */

function Tile({ icon: Icon, value, label, sub, tone }: {
  icon: React.ElementType; value: string; label: string; sub?: string; tone?: 'warn'
}) {
  return (
    <div className="lg-content flex items-center gap-3 p-3 min-w-0">
      <span className="fee-mini-icon !w-9 !h-9 !rounded-xl"><Icon size={16} /></span>
      <span className="min-w-0">
        <span className="block font-display text-[1.25rem] font-bold leading-tight text-slate-900 tabular-nums">{value}</span>
        <span className="block text-[11px] font-semibold text-slate-600 truncate">{label}</span>
        {sub && <span className={`block text-[10.5px] truncate ${tone === 'warn' ? 'font-semibold text-amber-700' : 'text-slate-400'}`}>{sub}</span>}
      </span>
    </div>
  )
}

function RouteChips({ items, empty, onPick }: {
  items: { route: TransportRoute; note?: string }[]
  empty: string
  onPick: (routeId: string) => void
}) {
  if (items.length === 0) return <p className="mt-1 text-[11px] text-slate-400">{empty}</p>
  return (
    <div className="mt-1.5 flex flex-wrap gap-1">
      {items.map(({ route, note }) => (
        <button
          key={`${route.id}-${note ?? ''}`}
          onClick={() => onPick(route.id)}
          className="inline-flex items-center gap-1.5 rounded-full border border-slate-200/80 bg-white/80 px-2 py-0.5 text-[10.5px] font-semibold text-slate-700 hover:bg-white hover:border-[#B8983C]/60 transition"
          title="Open this route above"
        >
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: route.color }} />
          {route.name}{note ? <span className="font-medium text-slate-400">· {note}</span> : null}
        </button>
      ))}
    </div>
  )
}

function RowActions({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }) {
  return (
    <div className="flex items-center gap-0.5 flex-shrink-0">
      <button onClick={onEdit} className={GBTN.icon} aria-label="Edit"><Pencil size={14} /></button>
      <button onClick={onDelete} className={`${GBTN.icon} hover:!text-rose-600 hover:!bg-rose-50`} aria-label="Delete"><Trash2 size={14} /></button>
    </div>
  )
}

function RowSkeletons() {
  return <div className="space-y-2">{[0, 1, 2].map(i => <div key={i} className="h-12 rounded-xl bg-slate-100/80 animate-pulse" />)}</div>
}
