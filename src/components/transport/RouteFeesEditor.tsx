'use client'

/**
 * How a route is priced, and what every rider on it will be billed.
 *
 * The first decision is the route's: price by stop (each stop has a monthly
 * price and riders pay their stop's) or by student (each rider has their own
 * amount). Until that is chosen the tab asks nothing else, and the route's
 * riders are left out of billing runs. Switching later keeps both sets of
 * amounts — only the chosen one bills.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowUpRight, IndianRupee, MapPin, Receipt, UserRound, Users, Wand2 } from 'lucide-react'
import Avatar from '@/components/Avatar'
import { fmtINRExact } from '@/lib/formatMoney'
import { fetchAssignments, updateAssignment } from '@/lib/transport/assignments'
import { fetchStops } from '@/lib/transport/stops'
import { updateRoute } from '@/lib/transport/routes'
import { fetchStopFees, resolveRiderFee, riderStopId, saveStopFee, type StopFee } from '@/lib/transport/fees'
import type { RouteFeeMode, TransportAssignment, TransportRoute, TransportStop } from '@/lib/transport/types'
import { BUS, EmptyNote, GBTN, GlassSegments } from './glass'

const MONEY =
  'w-full h-8 rounded-lg bg-white border border-slate-200 pl-6 pr-2 text-sm text-right tabular-nums text-slate-900 placeholder:text-slate-300 focus:outline-none focus:border-[#B8983C] focus:ring-2 focus:ring-[#B8983C]/20 transition'

const toNum = (s: string): number | null => {
  const t = s.trim()
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null
}

/** A rupee input that saves on blur or Enter, and flashes green when it has. */
function MoneyInput({ value, placeholder, onCommit, label }: {
  value: number | null
  placeholder?: string
  onCommit: (v: number | null) => Promise<void> | void
  label: string
}) {
  const [draft, setDraft] = useState(value == null ? '' : String(value))
  const [saved, setSaved] = useState(false)
  useEffect(() => { setDraft(value == null ? '' : String(value)) }, [value])

  const commit = async () => {
    const next = toNum(draft)
    if (next === value) return
    await onCommit(next)
    setSaved(true)
    setTimeout(() => setSaved(false), 1200)
  }

  return (
    <div className="relative">
      <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[12px] text-slate-400 pointer-events-none">₹</span>
      <input
        inputMode="decimal"
        aria-label={label}
        className={`${MONEY} ${saved ? '!border-emerald-400' : ''}`}
        value={draft}
        placeholder={placeholder}
        onChange={e => setDraft(e.target.value.replace(/[^\d.]/g, ''))}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
      />
    </div>
  )
}

export default function RouteFeesEditor({ route, onChanged }: { route: TransportRoute; onChanged?: () => void }) {
  const [mode, setMode] = useState<RouteFeeMode | null>(route.fee_mode ?? null)
  const [stops, setStops] = useState<TransportStop[]>([])
  const [grid, setGrid] = useState<Record<string, StopFee>>({})
  const [riders, setRiders] = useState<TransportAssignment[]>([])
  const [loading, setLoading] = useState(true)
  const [fillAmount, setFillAmount] = useState('')

  useEffect(() => { setMode(route.fee_mode ?? null) }, [route.fee_mode])

  const load = useCallback(async () => {
    setLoading(true)
    const [s, g, a] = await Promise.all([fetchStops(route.id), fetchStopFees(route.id), fetchAssignments(route.id)])
    setStops(s.filter(x => x.kind !== 'school')); setGrid(g); setRiders(a); setLoading(false)
  }, [route.id])

  useEffect(() => { load() }, [load])

  const chooseMode = async (next: RouteFeeMode) => {
    setMode(next)
    await updateRoute(route.id, { fee_mode: next })
    onChanged?.()
  }

  const ridersAt = useMemo(() => {
    const m: Record<string, number> = {}
    for (const a of riders) { const id = riderStopId(a); if (id) m[id] = (m[id] ?? 0) + 1 }
    return m
  }, [riders])

  const resolved = useMemo(() => riders.map(a => ({ a, fee: resolveRiderFee(a, grid, mode) })), [riders, grid, mode])
  const monthly = resolved.reduce((t, r) => t + (r.fee.amount ?? 0), 0)
  const missing = resolved.filter(r => r.fee.amount == null).length

  const setStopFee = async (stopId: string, v: number | null) => {
    setGrid(g => ({ ...g, [stopId]: { stop_id: stopId, route_id: route.id, amount: v } }))
    await saveStopFee(stopId, route.id, v)
  }

  const setStudentFee = async (a: TransportAssignment, v: number | null) => {
    setRiders(rs => rs.map(x => (x.id === a.id ? { ...x, fee_amount: v } : x)))
    await updateAssignment(a.id, { fee_amount: v })
  }

  const fillEmpty = async () => {
    const v = toNum(fillAmount)
    if (v == null) return
    const empty = riders.filter(a => a.fee_amount == null)
    setRiders(rs => rs.map(x => (x.fee_amount == null ? { ...x, fee_amount: v } : x)))
    await Promise.all(empty.map(a => updateAssignment(a.id, { fee_amount: v })))
    setFillAmount('')
  }

  if (loading) {
    return <div className="space-y-2">{[0, 1, 2, 3].map(i => <div key={i} className="h-12 rounded-xl bg-slate-100/80 animate-pulse" />)}</div>
  }

  // ── Step one: choose how this route is priced ──────────────────────
  if (!mode) {
    return (
      <div className="py-2">
        <h3 className="text-[15px] font-bold text-slate-900">How is this route priced?</h3>
        <p className="mt-0.5 text-[12px] text-slate-500 max-w-xl">
          Choose once for the route. Its riders are left out of billing until you do. You can switch later — the
          amounts you entered for the other way are kept.
        </p>
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <ModeCard
            icon={MapPin}
            title="By stop"
            detail={`Give each ${route.direction === 'inbound' ? 'pickup' : 'drop'} point a monthly price. Every rider pays the price of their stop — the usual choice when fares follow distance.`}
            onClick={() => chooseMode('stop')}
          />
          <ModeCard
            icon={UserRound}
            title="By student"
            detail="Type a monthly amount for each rider. For schools that agree a fare per family, or where every child pays something different."
            onClick={() => chooseMode('student')}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <GlassSegments
          layoutId={`fee-mode-${route.id}`}
          size="sm"
          value={mode}
          onChange={chooseMode}
          items={[
            { key: 'stop', label: 'Priced by stop', icon: MapPin },
            { key: 'student', label: 'Priced by student', icon: UserRound },
          ]}
        />
        {/* Billing happens in the fee app, under its Bus fee head. This opens
            its issue panel with the month view, the Bus fee and this route
            already picked. */}
        <Link href={`/more/fees?tab=config&issue=bus&route=${route.id}`} className={GBTN.primary}>
          <Receipt size={14} /> Issue in fee app <ArrowUpRight size={13} />
        </Link>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        <Mini icon={IndianRupee} label="Billed per month" value={fmtINRExact(monthly)} />
        <Mini icon={Users} label="Riders priced" value={`${riders.length - missing}/${riders.length}`} tone={missing > 0 ? 'warn' : undefined} />
        {mode === 'stop' ? (
          <Mini icon={MapPin} label="Stops priced" value={`${stops.filter(s => grid[s.id]?.amount != null).length}/${stops.length}`} />
        ) : (
          <Mini icon={UserRound} label="Average per rider" value={riders.length - missing > 0 ? fmtINRExact(monthly / (riders.length - missing)) : '—'} />
        )}
        <Mini icon={Receipt} label="Bills per month" value={String(riders.length - missing)} />
      </div>

      {mode === 'stop' ? (
        stops.length === 0 ? (
          <EmptyNote icon={MapPin} title="No stops to price yet" detail="Add this route's stops on the Stops tab, then come back to price them." />
        ) : (
          <section>
            <h3 className="mb-2 text-[13px] font-bold text-slate-900">
              Price per {route.direction === 'inbound' ? 'pickup' : 'drop'} point
            </h3>
            <div className="rounded-2xl border border-slate-200/70 bg-white/70 overflow-hidden">
              <div className="hidden sm:grid grid-cols-[2.25rem_1fr_5rem_8rem_7rem] gap-3 items-center px-3 py-2 bg-slate-50/80 border-b border-slate-200/70 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                <span /><span>Stop</span><span className="text-center">Riders</span><span className="text-right">Per month</span><span className="text-right">Stop total</span>
              </div>
              <ul className="divide-y divide-slate-200/60">
                {stops.map(s => {
                  const amt = grid[s.id]?.amount ?? null
                  const n = ridersAt[s.id] ?? 0
                  return (
                    <li key={s.id} className="grid grid-cols-[2.25rem_1fr_7rem] sm:grid-cols-[2.25rem_1fr_5rem_8rem_7rem] gap-x-3 items-center px-3 py-2">
                      <StopDot seq={s.seq} color={route.color} />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-slate-900 truncate">{s.name}</span>
                        <span className="block text-[11px] text-slate-500 truncate sm:hidden">{n} rider{n === 1 ? '' : 's'}</span>
                        {s.landmark && <span className="hidden sm:block text-[11px] text-slate-500 truncate">{s.landmark}</span>}
                      </span>
                      <span className="hidden sm:block text-center text-sm tabular-nums text-slate-600">{n}</span>
                      <MoneyInput label={`Monthly fee for ${s.name}`} value={amt} placeholder="Set price" onCommit={v => setStopFee(s.id, v)} />
                      <span className="hidden sm:block text-right text-sm font-semibold tabular-nums text-slate-700">
                        {amt != null && n > 0 ? fmtINRExact(amt * n) : '—'}
                      </span>
                    </li>
                  )
                })}
              </ul>
            </div>
          </section>
        )
      ) : null}

      <section>
        <div className="mb-2 flex flex-wrap items-end justify-between gap-3">
          <h3 className="text-[13px] font-bold text-slate-900">
            {mode === 'stop' ? 'What each rider pays' : 'Amount per rider'}
          </h3>
          {mode === 'student' && riders.some(a => a.fee_amount == null) && (
            <div className="flex items-center gap-1.5">
              <div className="relative w-28">
                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[12px] text-slate-400 pointer-events-none">₹</span>
                <input
                  inputMode="decimal"
                  aria-label="Amount for riders without one"
                  className={MONEY}
                  value={fillAmount}
                  placeholder="Amount"
                  onChange={e => setFillAmount(e.target.value.replace(/[^\d.]/g, ''))}
                  onKeyDown={e => { if (e.key === 'Enter') fillEmpty() }}
                />
              </div>
              <button className={GBTN.secondary} onClick={fillEmpty} disabled={toNum(fillAmount) == null}>
                <Wand2 size={13} /> Fill empty
              </button>
            </div>
          )}
        </div>

        {riders.length === 0 ? (
          <EmptyNote icon={Users} title="No riders on this route" detail="Add students on the Students tab." />
        ) : (
          <ul className="rounded-2xl border border-slate-200/70 bg-white/70 overflow-hidden divide-y divide-slate-200/60">
            {resolved.map(({ a, fee }) => (
              <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5">
                <Avatar avatarUrl={a.student?.avatar_url ?? undefined} name={a.student?.full_name ?? '?'} size={30} userId={a.student_id} />
                <div className="flex-1 min-w-[10rem]">
                  <p className="text-sm font-medium text-slate-900 truncate">{a.student?.full_name ?? 'Unknown'}</p>
                  <p className="text-[11px] text-slate-500 truncate">
                    {route.direction === 'inbound' ? 'Picked up at ' : 'Dropped at '}
                    {a.pickup_stop?.name ?? <span className="text-amber-600">no stop set</span>}
                  </p>
                </div>
                {mode === 'stop' ? (
                  <span className={`w-28 text-right text-sm font-bold tabular-nums ${fee.amount == null ? 'text-amber-600' : 'text-slate-900'}`}>
                    {fee.amount != null ? fmtINRExact(fee.amount) : riderStopId(a) ? 'Stop unpriced' : 'No stop'}
                  </span>
                ) : (
                  <div className="w-32">
                    <MoneyInput
                      label={`Monthly fee for ${a.student?.full_name ?? 'rider'}`}
                      value={a.fee_amount ?? null}
                      placeholder="Amount"
                      onCommit={v => setStudentFee(a, v)}
                    />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function ModeCard({ icon: Icon, title, detail, onClick }: { icon: React.ElementType; title: string; detail: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="group text-left rounded-2xl border border-slate-200/80 bg-white/80 p-4 transition hover:bg-white hover:border-[#B8983C]/60 hover:-translate-y-0.5 hover:shadow-[0_14px_28px_-18px_rgba(15,23,42,.5)] active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B8983C]/60"
    >
      <span className="icon-chip w-10 h-10" style={{ background: `linear-gradient(135deg, ${BUS.charcoal}, ${BUS.bronze})` }}>
        <Icon size={17} className="relative z-10 text-white" />
      </span>
      <span className="mt-3 block text-sm font-bold text-slate-900">{title}</span>
      <span className="mt-1 block text-[12px] leading-snug text-slate-500">{detail}</span>
      <span className="mt-3 inline-flex text-[12px] font-semibold text-[#8B6F47] group-hover:underline underline-offset-2">Use this →</span>
    </button>
  )
}

function StopDot({ seq, color }: { seq: number; color: string }) {
  return (
    <span className="w-7 h-7 rounded-full text-[11px] font-bold text-white flex items-center justify-center shadow-sm"
      style={{ background: `linear-gradient(135deg, ${color}, color-mix(in srgb, ${color} 70%, black))` }}>
      {seq}
    </span>
  )
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
