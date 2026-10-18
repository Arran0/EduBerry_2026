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
  AlertTriangle, Bus, Copy, IdCard, MessageCircle, Pencil, Plus, Search,
  Map as MapIcon, Radio, Route as RouteIcon, School, ScanLine, ShieldCheck, Trash2,
} from 'lucide-react'
import Avatar from '@/components/Avatar'
import { fmtINR } from '@/lib/formatMoney'
import { copyRoutesToYear, fetchRouteCounts, fetchRoutes, fetchRouteSearchIndex, type RouteSearchIndex } from '@/lib/transport/routes'
import { useMaybeAcademicYear } from '@/contexts/AcademicYearContext'
import { complianceWarnings, deleteVehicle, fetchVehicles, vehicleLabel } from '@/lib/transport/vehicles'
import { deleteTransportStaff, fetchCrewCandidates, fetchTransportStaff } from '@/lib/transport/staff'
import { currentPeriod, previewBills, type BillableRider } from '@/lib/transport/fees'
import { mapStatus, schoolStatus } from '../TransportSettings'
import { fetchMapSettings, fetchSchoolLocation, type MapSettings, type SchoolLocation } from '@/lib/transport/settings'
import type { TransportRoute, TransportStaff, TransportVehicle } from '@/lib/transport/types'
import { VEHICLE_STATUS_LABELS } from '@/lib/transport/types'
import RouteWorkspace, { type RouteTab } from '../RouteWorkspace'
import RouteNavigator from '../RouteNavigator'
import RouteFormModal from '../RouteFormModal'
import VehicleFormModal from '../VehicleFormModal'
import CrewFormModal from '../CrewFormModal'
import {
  CardHead, Content, EmptyNote, GBTN, GINPUT, GlassPanel, GlassTileButton,
} from '../glass'

export type ConnectionKey = 'whatsapp' | 'gps' | 'scan' | 'school' | 'map'

export default function ConfigurationSection({ onOpenPanel, routeId, onRouteChange, settingsVersion = 0 }: {
  onOpenPanel: (key: ConnectionKey) => void
  /** Bumped by the page when a settings popup closes, so the tiles re-read their status. */
  settingsVersion?: number
  /** The open route, held by the page so it survives in the URL (`?route=`). */
  routeId: string | null
  onRouteChange: (routeId: string | null) => void
}) {
  // Routes, their riders and the billing preview are the banner session's.
  // Buses, drivers and the connection settings are the school's, shared by
  // every session.
  const yearScope = useMaybeAcademicYear()
  const session = yearScope?.year ?? null
  const yearId = session?.id ?? null
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
    const [r, c, ix] = await Promise.all([fetchRoutes(true, yearId), fetchRouteCounts(), fetchRouteSearchIndex()])
    setRoutes(r); setCounts(c); setIndex(ix)
    const cur = selectedRef.current
    if (!cur || !r.some(x => x.id === cur)) setSelectedId(r.find(x => !x.archived_at)?.id ?? r[0]?.id ?? null)
  }, [setSelectedId, yearId])

  const loadFleet = useCallback(async () => {
    const [v, c, cand] = await Promise.all([fetchVehicles(), fetchTransportStaff(), fetchCrewCandidates()])
    setVehicles(v); setCrew(c); setCandidates(cand)
  }, [])

  const [school, setSchool] = useState<SchoolLocation | null | undefined>(undefined)
  const [mapSettings, setMapSettings] = useState<MapSettings | null | undefined>(undefined)
  useEffect(() => {
    fetchSchoolLocation(true).then(setSchool)
    fetchMapSettings(true).then(setMapSettings)
  }, [settingsVersion])

  const loadBilling = useCallback(async () => {
    setBilling(await previewBills(currentPeriod(), undefined, yearId))
  }, [yearId])

  useEffect(() => {
    setLoading(true)
    Promise.all([loadRoutes(), loadFleet(), loadBilling()]).then(() => setLoading(false))
  }, [loadRoutes, loadFleet, loadBilling])

  // A session with no routes yet can start from another session's network.
  const copySources = (yearScope?.years ?? []).filter(y => y.id !== yearId)
  const [copyFrom, setCopyFrom] = useState<string>('')
  useEffect(() => {
    const prefer = yearScope?.activeYear && yearScope.activeYear.id !== yearId ? yearScope.activeYear.id : copySources[0]?.id
    setCopyFrom(prefer ?? '')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [yearId, yearScope?.years.length])
  const [copying, setCopying] = useState(false)
  const copyRoutes = async () => {
    if (!yearId || !copyFrom) return
    const from = copySources.find(y => y.id === copyFrom)
    if (!confirm(`Copy every running route of ${from?.code ?? 'that session'} — stops, fees, schedules and riders — into ${session?.code}?`)) return
    setCopying(true)
    const res = await copyRoutesToYear(copyFrom, yearId)
    setCopying(false)
    if (!res.success) { alert(res.error ?? 'Could not copy the routes'); return }
    if (!res.copied) alert(`${from?.code ?? 'That session'} has no running routes to copy.`)
    await Promise.all([loadRoutes(), loadBilling()])
  }

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
    const m: Record<string, TransportRoute[]> = {}
    for (const r of live) if (r.default_driver_id) (m[r.default_driver_id] ??= []).push(r)
    return m
  }, [live])


  return (
    <div className="space-y-5">
      {/* ── Network at a glance ───────────────────────────────────── */}
      {/* One strip of six figures rather than six cards: the numbers are a
          glance, not a destination, and they were taking a phone's whole
          first screen. Three across on a phone, six on a desktop. */}
      <GlassPanel className="z-30" bodyClassName="!pt-2 sm:!pt-3">
        <div className="lg-content grid grid-cols-3 xl:grid-cols-6">
          <Tile i={0} value={loading ? '—' : `${live.length}`} label="Routes" sub={`${live.filter(r => r.direction === 'inbound').length} to · ${live.filter(r => r.direction === 'outbound').length} from school`} />
          <Tile i={1} value={loading ? '—' : `${totals.stops}`} label="Stops" sub="across all routes" />
          <Tile i={2} value={loading ? '—' : `${totals.riders}`} label="Riders" sub="one per route ridden" />
          <Tile i={3} value={loading ? '—' : `${vehicles.filter(v => v.status === 'active').length}`} label="Buses"
            sub={totals.warnings > 0 ? `${totals.warnings} papers due` : 'papers current'} tone={totals.warnings > 0 ? 'warn' : undefined}
            detail={totals.warnings > 0
              ? `${totals.warnings} bus${totals.warnings === 1 ? ' has' : 'es have'} insurance, fitness, permit or PUC expired or due within 30 days. The bus list below marks which.`
              : undefined} />
          <Tile i={4} value={loading ? '—' : `${crew.filter(c => c.active).length}`} label="Drivers" sub={`${crew.length - crew.filter(c => c.active).length} inactive`} />
          <Tile i={5} value={billing ? fmtINR(totals.monthly) : '—'} label="Per month" align="right"
            sub={totals.unpriced > 0 ? `${totals.unpriced} unpriced` : 'all priced'} tone={totals.unpriced > 0 ? 'warn' : undefined}
            detail={totals.unpriced > 0
              ? `${totals.unpriced} rider${totals.unpriced === 1 ? ' has' : 's have'} no monthly price yet, so they would be left out of a Bus fee issue. Either their route’s pricing (by stop or by student) is not chosen, or their stop or their own amount is empty. Open each route’s Fees tab to fix it.`
              : 'Every rider on a running route has a monthly price.'} />
        </div>
      </GlassPanel>

      {/* ── Routes ────────────────────────────────────────────────── */}
      <div ref={routesRef} className="relative z-20 scroll-mt-4">
      <GlassPanel eyebrow={session ? `Routes & trips · ${session.code}` : 'Routes & trips'} title="Routes" icon={RouteIcon} delay={0.04}>
        <div className="px-0.5 pb-2 sm:pb-3">
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
              title={session ? `No routes in ${session.code} yet` : 'No routes yet'}
              detail="A route runs one way — to school or from school — with its own stops, bus, driver, schedule and riders. Create the first one, or carry another session's routes over."
              action={
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <button className={GBTN.primary} onClick={() => setNewRoute(true)}><Plus size={14} /> New route</button>
                  {copySources.length > 0 && (
                    <span className="inline-flex items-center gap-1.5">
                      <select value={copyFrom} onChange={e => setCopyFrom(e.target.value)} aria-label="Session to copy from"
                        className={`${GINPUT} !w-auto !h-9 !rounded-full pr-7 text-[12.5px] font-semibold`}>
                        {copySources.map(y => <option key={y.id} value={y.id}>{y.code}</option>)}
                      </select>
                      <button className={GBTN.secondary} onClick={copyRoutes} disabled={copying || !copyFrom}>
                        <Copy size={14} /> {copying ? 'Copying…' : 'Copy routes'}
                      </button>
                    </span>
                  )}
                </div>
              }
            />
          </Content>
        )}
      </GlassPanel>
      </div>

      {/* ── Fleet & crew ──────────────────────────────────────────── */}
      <GlassPanel eyebrow="Fleet & crew" title="Buses and drivers" icon={Bus} delay={0.08}>
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
          <Content className="p-3 sm:p-4 flex flex-col">
            <CardHead icon={Bus} label={`Buses · ${vehicles.length}`}
              right={<button className={`${GBTN.secondary} !h-8`} onClick={() => setEditVehicle(null)}><Plus size={13} /> Add bus</button>} />
            <SearchList
              loading={loading}
              items={vehicles}
              placeholder="Search buses by name, number, model or route…"
              haystack={v => [vehicleLabel(v), v.registration_no, v.make_model, VEHICLE_STATUS_LABELS[v.status],
                ...(routesByVehicle[v.id] ?? []).flatMap(r => [r.name, r.code])].filter(Boolean).join(' ')}
              empty={<EmptyNote icon={Bus} title="No buses yet" detail="Add the buses this school runs. Routes and schedules attach to them." />}
              row={v => {
                const w = complianceWarnings(v)
                const on = routesByVehicle[v.id] ?? []
                return (
                  <li key={v.id} className="group flex items-center gap-2.5 px-2 py-1.5 rounded-xl hover:bg-slate-50">
                    <span title={VEHICLE_STATUS_LABELS[v.status]}
                      className={`w-2 h-2 rounded-full flex-shrink-0 ${v.status === 'active' ? 'bg-emerald-500' : v.status === 'maintenance' ? 'bg-amber-500' : 'bg-slate-300'}`} />
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-semibold text-slate-900 truncate leading-tight">
                        {vehicleLabel(v)}
                        <span className="ml-1.5 text-[11px] font-normal text-slate-500">
                          {v.registration_no !== vehicleLabel(v) ? `${v.registration_no} · ` : ''}{v.capacity || '—'} seats
                        </span>
                      </p>
                    </div>
                    {w.length > 0 && (
                      <span title={w.map(x => `${x.label} ${x.expired ? `expired ${Math.abs(x.daysLeft)} days ago` : `due in ${x.daysLeft} days`}`).join('\n')}
                        className={`inline-flex items-center gap-1 text-[10.5px] font-semibold flex-shrink-0 ${w[0].expired ? 'text-rose-600' : 'text-amber-600'}`}>
                        <AlertTriangle size={11} /> {w[0].label}{w.length > 1 ? ` +${w.length - 1}` : ''}
                      </span>
                    )}
                    <RouteChips items={on.map(r => ({ route: r }))} onPick={pickRoute} />
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
              }}
            />
          </Content>

          <Content className="p-3 sm:p-4 flex flex-col">
            <CardHead icon={IdCard} label={`Drivers · ${crew.length}`}
              right={
                <button className={`${GBTN.secondary} !h-8`} onClick={() => setEditCrew(null)} disabled={candidates.length === 0}
                  title={candidates.length === 0 ? 'Create a driver account in User Management first' : undefined}>
                  <Plus size={13} /> Add driver
                </button>
              } />
            {candidates.length === 0 && !loading && (
              <p className="mt-2 text-[11px] text-slate-500">No driver accounts yet. Create one in User Management first.</p>
            )}
            <SearchList
              loading={loading}
              items={crew}
              placeholder="Search drivers by name, phone, licence or route…"
              haystack={c => [c.profile?.full_name, c.phone, c.licence_no, c.employee_code, c.badge_no,
                ...(routesByPerson[c.profile_id] ?? []).flatMap(r => [r.name, r.code])].filter(Boolean).join(' ')}
              empty={<EmptyNote icon={IdCard} title="No drivers yet" detail="Add the drivers who work the routes. Parents see their name and phone." />}
              row={c => {
                const on = routesByPerson[c.profile_id] ?? []
                const licDays = c.licence_expiry
                  ? Math.round((new Date(c.licence_expiry + 'T00:00:00').getTime() - new Date().setHours(0, 0, 0, 0)) / 86_400_000)
                  : null
                return (
                  <li key={c.id} className={`group flex items-center gap-2.5 px-2 py-1.5 rounded-xl hover:bg-slate-50 ${c.active ? '' : 'opacity-60'}`}>
                    <Avatar avatarUrl={c.profile?.avatar_url} name={c.profile?.full_name ?? '?'} size={26} userId={c.profile_id} />
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-semibold text-slate-900 truncate leading-tight flex items-center gap-1">
                        <span className="truncate">{c.profile?.full_name ?? 'Unknown'}</span>
                        {c.verified_at && <ShieldCheck size={12} className="text-emerald-500 flex-shrink-0" aria-label="Verified" />}
                        <span className="ml-1 text-[11px] font-normal text-slate-500 truncate">
                          {c.phone || (c.licence_no ? `DL ${c.licence_no}` : 'No phone')}{!c.active ? ' · inactive' : ''}
                        </span>
                      </p>
                    </div>
                    {licDays != null && licDays <= 30 && (
                      <span title={`Licence ${licDays < 0 ? `expired ${Math.abs(licDays)} days ago` : `expires in ${licDays} days`}`}
                        className={`inline-flex items-center gap-1 text-[10.5px] font-semibold flex-shrink-0 ${licDays < 0 ? 'text-rose-600' : 'text-amber-600'}`}>
                        <AlertTriangle size={11} /> Licence
                      </span>
                    )}
                    <RouteChips items={on.map(r => ({ route: r }))} onPick={pickRoute} />
                    <RowActions
                      onEdit={() => setEditCrew(c)}
                      onDelete={async () => {
                        if (!confirm(`Remove the driver record for ${c.profile?.full_name}?`)) return
                        await deleteTransportStaff(c.id)
                        loadFleet()
                      }}
                    />
                  </li>
                )
              }}
            />
          </Content>
        </div>
      </GlassPanel>

      {/* ── Connections & settings ─────────────────────────────────── */}
      <div id="transport-settings" className="scroll-mt-4">
        <GlassPanel eyebrow="Connections & settings" title="Messaging, devices and maps" icon={Radio} delay={0.12}>
          {/* Three across on a phone (two rows), five on a desktop (one). */}
          <div className="grid grid-cols-3 lg:grid-cols-5 gap-1.5 sm:gap-2.5">
            <GlassTileButton icon={MessageCircle} label="WhatsApp" detail="Message templates and the sending account" onClick={() => onOpenPanel('whatsapp')} />
            <GlassTileButton icon={Radio} label="GPS" detail="Hardware already fitted to the buses" onClick={() => onOpenPanel('gps')} />
            <GlassTileButton icon={ScanLine} label="Scan" detail="Cards, fobs and QR — only if you want them" onClick={() => onOpenPanel('scan')} />
            <GlassTileButton icon={School} label="School location" detail="Where the Operations map opens" status={schoolStatus(school)} onClick={() => onOpenPanel('school')} />
            <GlassTileButton icon={MapIcon} label="Map provider" detail="Your own Mapbox key, or the fallback" status={mapStatus(mapSettings)} onClick={() => onOpenPanel('map')} />
          </div>
        </GlassPanel>
      </div>

      {newRoute && (
        <RouteFormModal
          route={null}
          yearId={yearId}
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

/**
 * A headline number. When there is more to say than fits under it, the whole
 * explanation opens in a box on hover or keyboard focus.
 */
function Tile({ i, value, label, sub, tone, detail, align = 'left' }: {
  /** Position in the strip, for its hairlines: three across on a phone, six on a desktop. */
  i: number
  value: string; label: string; sub?: string; tone?: 'warn'; detail?: string
  /** Which edge the hover box lines up with — 'right' for tiles at the end of a row. */
  align?: 'left' | 'right'
}) {
  return (
    <div className={`group relative min-w-0 px-3 py-2 sm:px-4 sm:py-2.5 border-slate-200/70 ${
      i % 3 ? 'border-l' : i > 0 ? 'xl:border-l' : ''} ${i >= 3 ? 'border-t xl:border-t-0' : ''}`}
      tabIndex={detail ? 0 : undefined}>
      <span className={`flex items-baseline gap-1.5 min-w-0 ${detail ? 'cursor-help' : ''}`}>
        <span className="font-display text-[1.05rem] sm:text-[1.2rem] font-bold leading-tight text-slate-900 tabular-nums truncate">{value}</span>
        {tone === 'warn' && <span className="w-1.5 h-1.5 rounded-full bg-amber-500 flex-shrink-0 self-center" aria-hidden />}
      </span>
      <span className="block text-[11px] font-semibold text-slate-600 truncate">{label}</span>
      {sub && <span className={`hidden sm:block text-[10.5px] truncate ${tone === 'warn' ? 'font-semibold text-amber-700' : 'text-slate-400'}`}>{sub}</span>}
      {detail && (
        <div role="tooltip"
          className={`lg-tooltip !bg-white/[.97] absolute ${align === 'right' ? 'right-0' : 'left-0'} w-64 sm:w-72 top-full mt-1 z-40 hidden group-hover:block group-focus-visible:block text-[12px] leading-snug text-slate-700`}>
          {tone === 'warn' && <AlertTriangle size={12} className="inline -mt-0.5 mr-1 text-amber-600" />}
          {detail}
        </div>
      )}
    </div>
  )
}

/**
 * A fixed-height, scrolling list with a type-ahead search above it. Every
 * word typed must appear somewhere in an item's searchable text.
 */
function SearchList<T extends { id: string }>({ items, haystack, row, placeholder, empty, loading }: {
  items: T[]
  haystack: (item: T) => string
  row: (item: T) => React.ReactNode
  placeholder: string
  empty: React.ReactNode
  loading: boolean
}) {
  const [q, setQ] = useState('')
  const words = q.toLowerCase().split(/\s+/).filter(Boolean)
  const shown = words.length
    ? items.filter(it => { const h = haystack(it).toLowerCase(); return words.every(w => h.includes(w)) })
    : items
  return (
    <div className="mt-2.5 flex flex-col">
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
        <input className={`${GINPUT} pl-8 pr-16 !h-8 text-[12.5px]`} value={q} onChange={e => setQ(e.target.value)}
          placeholder={placeholder} aria-label={placeholder} />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10.5px] text-slate-400 tabular-nums">
          {q ? `${shown.length}/${items.length}` : items.length}
        </span>
      </div>
      {/* A fixed height keeps the two lists level side by side; stacked on a
          phone, a short list only takes the room it needs. */}
      <div className="mt-2 max-h-[19rem] xl:h-[19rem] overflow-y-auto overscroll-contain -mx-1 px-1">
        {loading ? <RowSkeletons /> : items.length === 0 ? empty : shown.length === 0 ? (
          <p className="py-8 text-center text-xs text-slate-500">Nothing matches “{q}”.</p>
        ) : (
          <ul className="space-y-0.5">{shown.map(row)}</ul>
        )}
      </div>
    </div>
  )
}

/** The routes a bus or driver serves, compact: the first two, then a count. */
function RouteChips({ items, onPick }: {
  items: { route: TransportRoute }[]
  onPick: (routeId: string) => void
}) {
  if (items.length === 0) return <span className="hidden sm:inline text-[10.5px] text-slate-400 flex-shrink-0">no route</span>
  return (
    <span className="hidden sm:flex items-center gap-1 flex-shrink-0 max-w-[45%]">
      {items.slice(0, 2).map(({ route }) => (
        <button
          key={route.id}
          onClick={() => onPick(route.id)}
          className="inline-flex items-center gap-1 rounded-full border border-slate-200/80 bg-white/80 px-1.5 py-px text-[10.5px] font-semibold text-slate-700 hover:bg-white hover:border-[#B8983C]/60 transition truncate max-w-[9rem]"
          title={`Open ${route.name} above`}
        >
          <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: route.color }} />
          <span className="truncate">{route.code || route.name}</span>
        </button>
      ))}
      {items.length > 2 && (
        <span className="text-[10.5px] font-semibold text-slate-400" title={items.slice(2).map(x => x.route.name).join(', ')}>+{items.length - 2}</span>
      )}
    </span>
  )
}

function RowActions({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }) {
  return (
    <div className="flex items-center flex-shrink-0 sm:opacity-0 sm:group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
      <button onClick={onEdit} className={`${GBTN.icon} !w-7 !h-7`} aria-label="Edit"><Pencil size={13} /></button>
      <button onClick={onDelete} className={`${GBTN.icon} !w-7 !h-7 hover:!text-rose-600 hover:!bg-rose-50`} aria-label="Delete"><Trash2 size={13} /></button>
    </div>
  )
}

function RowSkeletons() {
  return <div className="space-y-1">{[0, 1, 2, 3, 4].map(i => <div key={i} className="h-9 rounded-xl bg-slate-100/80 animate-pulse" />)}</div>
}
