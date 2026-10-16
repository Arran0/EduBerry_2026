'use client'

/**
 * Getting to a route: a smart search, a toggler, and "New route".
 *
 * The search is type-ahead over everything a route is known by — its name and
 * code, its bus and driver, its stops, and the children who ride it — so
 * "Ananya", "Temple Rd" and "KL-07" all land on the right route. Picking a
 * stop opens the route on Stops, picking a child opens it on Students.
 *
 * Under it, every route as a chip, to-school routes first, and a stepper to
 * walk through them in order.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeftFromLine, ArrowRightToLine, ChevronLeft, ChevronRight, CornerDownLeft, MapPin, Plus,
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

  const idx = ordered.findIndex(r => r.id === selectedId)
  const step = (d: -1 | 1) => {
    if (ordered.length === 0) return
    const next = ordered[(idx + d + ordered.length) % ordered.length]
    onSelect(next.id)
  }

  const inbound = ordered.filter(r => r.direction === 'inbound')
  const outbound = ordered.filter(r => r.direction === 'outbound')

  return (
    <div className="space-y-2.5">
      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
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
            className="w-full h-10 rounded-full bg-white/90 border border-white pl-10 pr-16 text-sm text-slate-900 placeholder:text-slate-400 shadow-[inset_0_1px_2px_rgba(15,23,42,.06),0_6px_16px_-12px_rgba(15,23,42,.4)] focus:outline-none focus:ring-2 focus:ring-[#B8983C]/40 transition"
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
                      <span className="w-7 h-7 flex-shrink-0 rounded-lg flex items-center justify-center text-white" style={{ background: r?.color ?? '#A1A1AA' }}>
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
          {/* Stepper */}
          <div className="lg-pill inline-flex items-center h-10 px-1" role="group" aria-label="Step through routes">
            <button onClick={() => step(-1)} disabled={ordered.length < 2} className={GBTN.icon} aria-label="Previous route"><ChevronLeft size={16} /></button>
            <span className="px-1.5 text-[12px] font-semibold text-slate-600 tabular-nums whitespace-nowrap">
              {idx >= 0 ? idx + 1 : '–'} / {ordered.length}
            </span>
            <button onClick={() => step(1)} disabled={ordered.length < 2} className={GBTN.icon} aria-label="Next route"><ChevronRight size={16} /></button>
          </div>
          <button onClick={onNew} className={`${GBTN.primary} !h-10 flex-1 sm:flex-none`}>
            <Plus size={15} /> New route
          </button>
        </div>
      </div>

      {/* Toggler — every route, grouped by direction */}
      {ordered.length > 0 && (
        <div className="flex items-stretch gap-2 overflow-x-auto scrollbar-none pb-0.5 -mx-0.5 px-0.5">
          {[{ label: 'To school', icon: ArrowRightToLine, list: inbound }, { label: 'From school', icon: ArrowLeftFromLine, list: outbound }]
            .filter(g => g.list.length > 0)
            .map(g => (
              <div key={g.label} className="lg-pill flex-shrink-0 inline-flex items-center gap-0.5 p-1">
                <span className="inline-flex items-center gap-1 pl-2 pr-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400 whitespace-nowrap">
                  <g.icon size={11} /> {g.label}
                </span>
                {g.list.map(r => {
                  const on = r.id === selectedId
                  return (
                    <button
                      key={r.id}
                      onClick={() => onSelect(r.id)}
                      aria-pressed={on}
                      title={`${r.name} · ${riders[r.id] ?? 0} riders`}
                      className={`inline-flex flex-shrink-0 items-center gap-1.5 h-8 px-3 rounded-full text-[12.5px] font-semibold whitespace-nowrap transition ${
                        on ? 'text-white shadow-[inset_0_1px_0_rgba(255,255,255,.16),0_4px_10px_-4px_rgba(15,23,42,.45)]' : 'text-slate-600 hover:bg-white hover:text-slate-900'
                      } ${r.archived_at || !r.active ? 'opacity-60' : ''}`}
                      style={on ? { background: 'linear-gradient(150deg, #3D3B40, #27272A)' } : undefined}
                    >
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: r.color }} />
                      {r.code || r.name}
                      <span className={`tabular-nums text-[10.5px] ${on ? 'text-white/60' : 'text-slate-400'}`}>{riders[r.id] ?? 0}</span>
                    </button>
                  )
                })}
              </div>
            ))}
        </div>
      )}
    </div>
  )
}
