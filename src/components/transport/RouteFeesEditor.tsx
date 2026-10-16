'use client'

/**
 * A trip's fee grid, and what every rider on it will be billed.
 *
 * Top: one row per stop — a round-trip price and an optional one-way price.
 * Below: every rider, the amount that grid gives them, and a custom amount that
 * overrides it for that child alone. The figure shown is always the one a bill
 * would carry, with where it came from beside it, so nobody has to work out
 * which rule applied.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { IndianRupee, MapPin, Receipt, RotateCcw, Users } from 'lucide-react'
import Avatar from '@/components/Avatar'
import { fmtINRExact } from '@/lib/formatMoney'
import { fetchAssignments, updateAssignment } from '@/lib/transport/assignments'
import { fetchStops } from '@/lib/transport/stops'
import { fetchStopFees, resolveRiderFee, saveStopFee, type StopFee } from '@/lib/transport/fees'
import type { TransportAssignment, TransportRoute, TransportStop } from '@/lib/transport/types'
import { EmptyNote, GBTN } from './glass'
import BillingRun from './BillingRun'

const MONEY =
  'w-full h-8 rounded-lg bg-white border border-slate-200 pl-6 pr-2 text-sm text-right tabular-nums text-slate-900 placeholder:text-slate-300 focus:outline-none focus:border-[#B8983C] focus:ring-2 focus:ring-[#B8983C]/20 transition'

const toNum = (s: string): number | null => {
  const t = s.trim()
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null
}

/** A rupee input that saves on blur or Enter, and shows a tick while it does. */
function MoneyInput({ value, placeholder, onCommit, label }: {
  value: number | null
  placeholder?: string
  onCommit: (v: number | null) => Promise<void> | void
  label: string
}) {
  const [draft, setDraft] = useState(value == null ? '' : String(value))
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle')
  useEffect(() => { setDraft(value == null ? '' : String(value)) }, [value])

  const commit = async () => {
    const next = toNum(draft)
    if (next === value || (draft.trim() === '' && value == null)) return
    setState('saving')
    await onCommit(next)
    setState('saved')
    setTimeout(() => setState('idle'), 1200)
  }

  return (
    <div className="relative">
      <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[12px] text-slate-400 pointer-events-none">₹</span>
      <input
        inputMode="decimal"
        aria-label={label}
        className={`${MONEY} ${state === 'saved' ? '!border-emerald-400' : ''}`}
        value={draft}
        placeholder={placeholder}
        onChange={e => setDraft(e.target.value.replace(/[^\d.]/g, ''))}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
      />
    </div>
  )
}

export default function RouteFeesEditor({ route }: { route: TransportRoute }) {
  const [stops, setStops] = useState<TransportStop[]>([])
  const [grid, setGrid] = useState<Record<string, StopFee>>({})
  const [riders, setRiders] = useState<TransportAssignment[]>([])
  const [loading, setLoading] = useState(true)
  const [issuing, setIssuing] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const [s, g, a] = await Promise.all([fetchStops(route.id), fetchStopFees(route.id), fetchAssignments(route.id)])
    setStops(s.filter(x => x.kind !== 'school')); setGrid(g); setRiders(a); setLoading(false)
  }, [route.id])

  useEffect(() => { load() }, [load])

  const ridersAt = useMemo(() => {
    const m: Record<string, number> = {}
    for (const a of riders) {
      for (const id of new Set([a.pickup_stop_id, a.drop_stop_id].filter(Boolean) as string[])) m[id] = (m[id] ?? 0) + 1
    }
    return m
  }, [riders])

  const resolved = useMemo(
    () => riders.map(a => ({ a, fee: resolveRiderFee(a, grid) })),
    [riders, grid],
  )
  const monthly = resolved.reduce((t, r) => t + (r.fee.amount ?? 0), 0)
  const missing = resolved.filter(r => r.fee.source === 'missing').length
  const custom = resolved.filter(r => r.fee.source === 'custom').length

  const setStopFee = async (stopId: string, key: 'amount_round' | 'amount_one_way', v: number | null) => {
    const cur = grid[stopId] ?? { stop_id: stopId, route_id: route.id, amount_round: null, amount_one_way: null }
    const next = { ...cur, [key]: v }
    setGrid(g => ({ ...g, [stopId]: next }))
    await saveStopFee(stopId, route.id, { amount_round: next.amount_round, amount_one_way: next.amount_one_way })
  }

  const setCustom = async (a: TransportAssignment, v: number | null) => {
    setRiders(rs => rs.map(x => (x.id === a.id ? { ...x, fee_amount: v } : x)))
    await updateAssignment(a.id, { fee_amount: v })
  }

  if (loading) {
    return <div className="space-y-2">{[0, 1, 2, 3].map(i => <div key={i} className="h-12 rounded-xl bg-slate-100/80 animate-pulse" />)}</div>
  }

  return (
    <div className="space-y-5">
      {/* Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        <Mini icon={IndianRupee} label="Billed per month" value={fmtINRExact(monthly)} />
        <Mini icon={Users} label="Riders priced" value={`${riders.length - missing}/${riders.length}`} tone={missing > 0 ? 'warn' : undefined} />
        <Mini icon={MapPin} label="Stops priced" value={`${stops.filter(s => grid[s.id]?.amount_round != null).length}/${stops.length}`} />
        <Mini icon={Receipt} label="Custom amounts" value={String(custom)} />
      </div>

      {/* The grid */}
      <section>
        <div className="flex items-end justify-between gap-3 mb-2">
          <div>
            <h3 className="text-[13px] font-bold text-slate-900">Fee grid</h3>
            <p className="text-[11.5px] text-slate-500 leading-snug max-w-xl">
              Price each stop once. A child riding both ways pays the round-trip price of the dearer of
              their pickup and drop stops; a child riding one way pays the one-way price (or the
              round-trip price if no one-way price is set).
            </p>
          </div>
        </div>

        {stops.length === 0 ? (
          <EmptyNote icon={MapPin} title="No stops to price yet" detail="Add this route's stops on the Stops tab, then come back to set their fees." />
        ) : (
          <div className="rounded-2xl border border-slate-200/70 bg-white/70 overflow-hidden">
            <div className="hidden sm:grid grid-cols-[2.25rem_1fr_5rem_8.5rem_8.5rem] gap-3 items-center px-3 py-2 bg-slate-50/80 border-b border-slate-200/70">
              <span />
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Stop</span>
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 text-center">Riders</span>
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 text-right">Round trip / mo</span>
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 text-right">One way / mo</span>
            </div>
            <ul className="divide-y divide-slate-200/60">
              {stops.map(s => (
                <li key={s.id} className="grid grid-cols-[2.25rem_1fr] sm:grid-cols-[2.25rem_1fr_5rem_8.5rem_8.5rem] gap-x-3 gap-y-2 items-center px-3 py-2">
                  <span className="w-7 h-7 rounded-full text-[11px] font-bold text-white flex items-center justify-center shadow-sm"
                    style={{ background: `linear-gradient(135deg, ${route.color}, color-mix(in srgb, ${route.color} 70%, black))` }}>
                    {s.seq}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-slate-900 truncate">{s.name}</span>
                    {s.landmark && <span className="block text-[11px] text-slate-500 truncate">{s.landmark}</span>}
                  </span>
                  <span className="hidden sm:block text-center text-sm tabular-nums text-slate-600">{ridersAt[s.id] ?? 0}</span>
                  <div className="col-span-2 sm:col-span-1 grid grid-cols-2 sm:contents gap-2">
                    <MoneyInput
                      label={`Round trip fee for ${s.name}`}
                      value={grid[s.id]?.amount_round ?? null}
                      placeholder="—"
                      onCommit={v => setStopFee(s.id, 'amount_round', v)}
                    />
                    <MoneyInput
                      label={`One way fee for ${s.name}`}
                      value={grid[s.id]?.amount_one_way ?? null}
                      placeholder={grid[s.id]?.amount_round != null ? String(grid[s.id]?.amount_round) : '—'}
                      onCommit={v => setStopFee(s.id, 'amount_one_way', v)}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* Riders */}
      <section>
        <div className="flex flex-wrap items-end justify-between gap-3 mb-2">
          <div>
            <h3 className="text-[13px] font-bold text-slate-900">What each rider pays</h3>
            <p className="text-[11.5px] text-slate-500 leading-snug max-w-xl">
              From the grid unless you type a custom amount, which applies to that child on this trip only.
              A child on two trips gets a bill for each.
            </p>
          </div>
          <button className={GBTN.primary} onClick={() => setIssuing(v => !v)} disabled={riders.length === 0}>
            <Receipt size={14} /> {issuing ? 'Close' : 'Issue a month'}
          </button>
        </div>

        {issuing && (
          <div className="mb-3">
            <BillingRun routeIds={[route.id]} compact onIssued={load} />
          </div>
        )}

        {riders.length === 0 ? (
          <EmptyNote icon={Users} title="No riders on this route" detail="Add students on the Students tab." />
        ) : (
          <ul className="rounded-2xl border border-slate-200/70 bg-white/70 overflow-hidden divide-y divide-slate-200/60">
            {resolved.map(({ a, fee }) => {
              const both = a.rides_inbound && a.rides_outbound
              const trips = both ? 'Both ways' : a.rides_inbound ? 'To school only' : 'From school only'
              const gridOnly = resolveRiderFee({ ...a, fee_amount: null }, grid)
              return (
                <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5">
                  <Avatar avatarUrl={a.student?.avatar_url ?? undefined} name={a.student?.full_name ?? '?'} size={30} userId={a.student_id} />
                  <div className="flex-1 min-w-[10rem]">
                    <p className="text-sm font-medium text-slate-900 truncate">{a.student?.full_name ?? 'Unknown'}</p>
                    <p className="text-[11px] text-slate-500 truncate">
                      {trips} · {a.pickup_stop?.name ?? 'no pickup stop'}
                      {a.drop_stop && a.drop_stop.id !== a.pickup_stop_id ? ` → ${a.drop_stop.name}` : ''}
                    </p>
                  </div>
                  <SourcePill source={fee.source} basis={fee.basis} />
                  <span className={`w-24 text-right text-sm font-bold tabular-nums ${fee.amount == null ? 'text-amber-600' : 'text-slate-900'}`}>
                    {fee.amount == null ? 'No price' : fmtINRExact(fee.amount)}
                  </span>
                  <div className="w-32 flex items-center gap-1">
                    <MoneyInput
                      label={`Custom fee for ${a.student?.full_name ?? 'rider'}`}
                      value={a.fee_amount ?? null}
                      placeholder={gridOnly.amount != null ? `${gridOnly.amount}` : 'Custom'}
                      onCommit={v => setCustom(a, v)}
                    />
                    {a.fee_amount != null && (
                      <button onClick={() => setCustom(a, null)} className="w-7 h-7 flex-shrink-0 inline-flex items-center justify-center rounded-full text-slate-400 hover:text-slate-800 hover:bg-white" title="Back to the grid price" aria-label="Clear custom amount">
                        <RotateCcw size={13} />
                      </button>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}

function SourcePill({ source, basis }: { source: 'custom' | 'grid' | 'missing'; basis: 'round' | 'one_way' | null }) {
  const cfg = source === 'custom'
    ? { text: 'Custom', cls: 'bg-[#F5EEDC] text-[#8B6F47] border-[#E9DDBB]' }
    : source === 'grid'
      ? { text: basis === 'one_way' ? 'Grid · one way' : 'Grid · round trip', cls: 'bg-slate-50 text-slate-600 border-slate-200' }
      : { text: 'Set a price', cls: 'bg-amber-50 text-amber-700 border-amber-200' }
  return <span className={`text-[10.5px] font-semibold px-2 py-0.5 rounded-full border ${cfg.cls}`}>{cfg.text}</span>
}

function Mini({ icon: Icon, label, value, tone }: { icon: React.ElementType; label: string; value: string; tone?: 'warn' }) {
  return (
    <div className="fee-mini">
      <span className="fee-mini-icon"><Icon size={14} /></span>
      <span className="min-w-0">
        <span className={`block text-[15px] font-bold leading-tight tabular-nums ${tone === 'warn' ? 'text-amber-700' : 'text-slate-900'}`}>{value}</span>
        <span className="block text-[10.5px] font-semibold text-slate-500 truncate">{label}</span>
      </span>
    </div>
  )
}
