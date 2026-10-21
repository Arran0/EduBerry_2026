'use client'

/**
 * Getting to a route: a smart search, a route dropdown, and "New route".
 *
 * The search is type-ahead over everything a route is known by — its name and
 * code, its bus and driver, its stops, and the children who ride it — so
 * "Ananya", "Temple Rd" and "KL-07" all land on the right route. Picking a
 * stop opens the route on Stops, picking a child opens it on Students.
 *
 * Beside it, a dropdown of every route — to-school routes first — for when
 * you know the route and just want to pick it.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeftFromLine, ArrowRightToLine, Check, ChevronDown, CornerDownLeft, MapPin, Plus,
  Route as RouteIcon, Search, User, X,
} from 'lucide-react'
import { vehicleLabel } from '@/lib/transport/vehicles'
import type { RouteSearchIndex } from '@/lib/transport/routes'
import type { TransportRoute } from '@/lib/transport/types'
import type { RouteTab } from './RouteWorkspace'
import { GBTN } from './glass'

interface Hit {
  key: string
  kind: 'route' | 'stop' | 'rider'
  routeId: string
  title: string
  sub: string
  tab?: RouteTab
  score: number
}

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')

/**
 * Every query word must appear somewhere in the text. Scored so a match at the
 * start of the name beats one in the middle, and a name beats a detail.
 */
function score(query: string[], primary: string, extra = ''): number | null {
  const p = norm(primary)
  const all = `${p} ${norm(extra)}`
  let total = 0
  for (const w of query) {
    const i = all.indexOf(w)
    if (i < 0) return null
    if (p.startsWith(w)) total += 30
    else if (p.includes(` ${w}`)) total += 20
    else if (p.includes(w)) total += 12
    else total += 4
  }
  return total
}

/** The matched part of a label, in bold. */
function Mark({ text, query }: { text: string; query: string[] }) {
  const n = norm(text)
  const w = query.find(q => n.includes(q))
  if (!w) return <>{text}</>
  const i = n.indexOf(w)
  return <>{text.slice(0, i)}<mark className="bg-transparent font-bold text-slate-900">{text.slice(i, i + w.length)}</mark>{text.slice(i + w.length)}</>
}

export default function RouteNavigator({
  routes, index, riders, selectedId, onSelect, onNew,
}: {
  routes: TransportRoute[]
  index: RouteSearchIndex | null
  riders: Record<string, number>
  selectedId: string | null
  onSelect: (routeId: string, tab?: RouteTab) => void
  onNew: () => void
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)

  // Order: to-school, then from-school; running before paused before archived.
  const ordered = useMemo(() => {
    const rank = (r: TransportRoute) => (r.archived_at ? 2 : r.active ? 0 : 1)
    return [...routes].sort((a, b) =>
      (a.direction === b.direction ? 0 : a.direction === 'inbound' ? -1 : 1)
      || rank(a) - rank(b) || a.name.localeCompare(b.name))
  }, [routes])
  const byId = useMemo(() => new Map(routes.map(r => [r.id, r])), [routes])

  const words = useMemo(() => norm(query).split(/\s+/).filter(Boolean), [query])

  const hits = useMemo<Hit[]>(() => {
    if (words.length === 0) return []
    const out: Hit[] = []
    for (const r of routes) {
      const dir = r.direction === 'inbound' ? 'to school' : 'from school'
      const sc = score(words, `${r.code ?? ''} ${r.name}`.trim(),
        `${r.description ?? ''} ${vehicleLabel(r.default_vehicle)} ${r.default_driver?.full_name ?? ''} ${dir}`)
      if (sc != null) {
        out.push({
          key: `r:${r.id}`, kind: 'route', routeId: r.id, score: sc + 5,
          title: `${r.code ? `${r.code} · ` : ''}${r.name}`,
          sub: `${r.direction === 'inbound' ? 'To school' : 'From school'} · ${r.default_vehicle ? vehicleLabel(r.default_vehicle) : 'no bus'} · ${r.default_driver?.full_name ?? 'no driver'}`,
        })
      }
    }
    for (const s of index?.stops ?? []) {
      const r = byId.get(s.route_id)
      if (!r) continue
      const sc = score(words, s.name, s.landmark ?? '')
      if (sc != null) out.push({ key: `s:${s.route_id}:${s.name}`, kind: 'stop', routeId: r.id, tab: 'stops', score: sc, title: s.name, sub: `Stop on ${r.name}${s.landmark ? ` · ${s.landmark}` : ''}` })
    }
    for (const x of index?.riders ?? []) {
      const r = byId.get(x.route_id)
      if (!r) continue
      const sc = score(words, x.name)
      if (sc != null) {
        out.push({
          key: `p:${x.route_id}:${x.student_id}`, kind: 'rider', routeId: r.id, tab: 'students', score: sc,
          title: x.name,
          sub: `${x.grade ? `Grade ${x.grade}${x.section ? ` ${x.section}` : ''} · ` : ''}rides ${r.name} (${r.direction === 'inbound' ? 'to school' : 'from school'})`,
        })
      }
    }
    // Best first within each kind, a handful of each; the kind with the best
    // match leads, so "Temple Rd" puts the stop above routes that only
    // mention a temple in their description.
    const take = (k: Hit['kind'], n: number) => out.filter(h => h.kind === k).sort((a, b) => b.score - a.score).slice(0, n)
    return [take('route', 6), take('rider', 6), take('stop', 5)]
      .filter(g => g.length > 0)
      .sort((a, b) => b[0].score - a[0].score)
      .flat()
  }, [words, routes, index, byId])

  useEffect(() => { setActive(0) }, [query])

  // Close on a click anywhere else.
  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (!boxRef.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  // "/" focuses the search, the way it does on most admin tools.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) && !t.isContentEditable) {
        e.preventDefault(); inputRef.current?.focus(); setOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const pick = (h: Hit) => {
    onSelect(h.routeId, h.tab)
    setQuery(''); setOpen(false); inputRef.current?.blur()
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive(a => Math.min(hits.length - 1, a + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(0, a - 1)) }
    else if (e.key === 'Enter' && hits[active]) { e.preventDefault(); pick(hits[active]) }
    else if (e.key === 'Escape') { setOpen(false); inputRef.current?.blur() }
  }

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-2">
        {/* Smart search */}
        <div ref={boxRef} className="relative flex-1 min-w-0">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => { setQuery(e.target.value); setOpen(true) }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
            role="combobox"
            aria-expanded={open && hits.length > 0}
            aria-controls="route-search-results"
            aria-activedescendant={hits[active] ? `rs-${active}` : undefined}
            placeholder="Search routes, stops, buses, drivers, students…"
            className="w-full h-10 rounded-full bg-white/90 border border-white pl-10 pr-16 text-sm text-slate-900 placeholder:text-slate-400 shadow-[inset_0_1px_2px_rgba(15,23,42,.06),0_6px_16px_-12px_rgba(15,23,42,.4)] focus:outline-none focus:ring-2 focus:ring-[#F5B800]/40 transition"
          />
          {query ? (
            <button onClick={() => { setQuery(''); inputRef.current?.focus() }} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-800" aria-label="Clear search">
              <X size={15} />
            </button>
          ) : (
            <kbd className="hidden sm:inline-flex absolute right-3 top-1/2 -translate-y-1/2 h-5 min-w-[1.25rem] items-center justify-center rounded-md border border-slate-200 bg-slate-50 px-1 text-[10.5px] font-semibold text-slate-400">/</kbd>
          )}

          {open && words.length > 0 && (
            <div id="route-search-results" role="listbox" className="absolute z-40 left-0 right-0 mt-2 lg-tooltip !bg-white/[.97] !p-1.5 max-h-[22rem] overflow-y-auto">
              {hits.length === 0 ? (
                <p className="px-3 py-3 text-xs text-slate-500">Nothing matches “{query}”.</p>
              ) : hits.map((h, i) => {
                const Icon = h.kind === 'route' ? RouteIcon : h.kind === 'stop' ? MapPin : User
                const r = byId.get(h.routeId)
                const first = i === 0 || hits[i - 1].kind !== h.kind
                return (
                  <React.Fragment key={h.key}>
                    {first && (
                      <p className="px-2.5 pt-1.5 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                        {h.kind === 'route' ? 'Routes' : h.kind === 'rider' ? 'Students' : 'Stops'}
                      </p>
                    )}
                    <button
                      id={`rs-${i}`}
                      role="option"
                      aria-selected={i === active}
                      onMouseEnter={() => setActive(i)}
                      onClick={() => pick(h)}
                      className={`w-full flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors ${i === active ? 'bg-slate-100/80' : ''}`}
                    >
                      <span className="w-7 h-7 flex-shrink-0 rounded-lg flex items-center justify-center text-white" style={{ background: r?.color ?? '#94A0B1' }}>
                        <Icon size={13} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13px] text-slate-700 truncate"><Mark text={h.title} query={words} /></span>
                        <span className="block text-[11px] text-slate-500 truncate">{h.sub}</span>
                      </span>
                      {i === active && <CornerDownLeft size={13} className="flex-shrink-0 text-slate-400" />}
                    </button>
                  </React.Fragment>
                )
              })}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <RoutePicker routes={ordered} selectedId={selectedId} riders={riders} onSelect={id => onSelect(id)} />
          <button onClick={onNew} className={`${GBTN.primary} !h-10 flex-shrink-0`}>
            <Plus size={15} /> <span className="hidden sm:inline">New route</span><span className="sm:hidden">New</span>
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * Choose a route from a list — the routes grouped by direction, each with its
 * bus and how many ride it. Keyboard: arrows move, Enter picks, Esc closes.
 */
function RoutePicker({ routes, selectedId, riders, onSelect }: {
  routes: TransportRoute[]
  selectedId: string | null
  riders: Record<string, number>
  onSelect: (routeId: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [hi, setHi] = useState(0)
  const ref = useRef<HTMLDivElement>(null)
  const current = routes.find(r => r.id === selectedId) ?? null

  useEffect(() => {
    if (!open) return
    setHi(Math.max(0, routes.findIndex(r => r.id === selectedId)))
    const onDoc = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open, routes, selectedId])

  useEffect(() => {
    if (!open) return
    document.getElementById(`rp-${hi}`)?.scrollIntoView({ block: 'nearest' })
  }, [hi, open])

  const choose = (id: string) => { onSelect(id); setOpen(false) }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setOpen(true); return }
    if (!open) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi(h => Math.min(routes.length - 1, h + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(h => Math.max(0, h - 1)) }
    else if (e.key === 'Enter') { e.preventDefault(); if (routes[hi]) choose(routes[hi].id) }
    else if (e.key === 'Escape') { e.preventDefault(); setOpen(false) }
  }

  return (
    <div ref={ref} className="relative flex-1 sm:flex-none min-w-0">
      <button
        onClick={() => setOpen(o => !o)}
        onKeyDown={onKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="lg-pill w-full sm:w-[19rem] h-10 inline-flex items-center gap-2 pl-3.5 pr-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F5B800]/60"
      >
        {current ? (
          <>
            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: current.color }} />
            <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-slate-900">
              {current.code ? <span className="text-slate-400 mr-1">{current.code}</span> : null}{current.name}
            </span>
            <span className="flex-shrink-0 text-[10.5px] font-semibold text-slate-400">
              {current.direction === 'inbound' ? 'To school' : 'From school'}
            </span>
          </>
        ) : (
          <span className="flex-1 text-[13px] text-slate-500">{routes.length ? 'Choose a route' : 'No routes yet'}</span>
        )}
        <ChevronDown size={15} className={`flex-shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && routes.length > 0 && (
        // On a phone the picker sits at the left of its row and nearly fills
        // it, so the list hangs from both of its edges; from sm up it opens
        // under the picker's right edge at a fixed width.
        <div role="listbox" className="absolute z-40 left-0 right-0 sm:left-auto sm:w-[26rem] mt-2 lg-tooltip !bg-white/[.97] !p-1.5 max-h-[min(26rem,60vh)] overflow-y-auto">
          {routes.map((r, i) => {
            const first = i === 0 || routes[i - 1].direction !== r.direction
            const on = r.id === selectedId
            const n = riders[r.id] ?? 0
            const cap = r.default_vehicle?.capacity ?? 0
            return (
              <React.Fragment key={r.id}>
                {first && (
                  <p className="flex items-center gap-1 px-2.5 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    {r.direction === 'inbound' ? <ArrowRightToLine size={11} /> : <ArrowLeftFromLine size={11} />}
                    {r.direction === 'inbound' ? 'To school' : 'From school'}
                  </p>
                )}
                <button
                  id={`rp-${i}`}
                  role="option"
                  aria-selected={on}
                  onMouseEnter={() => setHi(i)}
                  onClick={() => choose(r.id)}
                  className={`w-full flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors ${i === hi ? 'bg-slate-100/80' : ''} ${r.archived_at ? 'opacity-55' : ''}`}
                >
                  <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: r.color }} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-semibold text-slate-900 truncate">
                      {r.code ? <span className="text-slate-400 mr-1">{r.code}</span> : null}{r.name}
                      {r.archived_at && <span className="ml-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">Archived</span>}
                    </span>
                    <span className="block text-[11px] text-slate-500 truncate">
                      {r.default_vehicle ? vehicleLabel(r.default_vehicle) : 'No bus'} · {r.default_driver?.full_name ?? 'no driver'}
                    </span>
                  </span>
                  <span className={`flex-shrink-0 text-[11px] font-semibold tabular-nums ${cap && n > cap ? 'text-rose-600' : 'text-slate-500'}`}>
                    {n}{cap ? `/${cap}` : ''}
                  </span>
                  {on && <Check size={14} className="flex-shrink-0 text-[#2E6BE6]" />}
                </button>
              </React.Fragment>
            )
          })}
        </div>
      )}
    </div>
  )
}
