'use client'

/**
 * Issue one month of bus fees.
 *
 * Pick the month, a due date and (optionally) the fee head the bills file
 * under; the preview shows, per trip, who will be billed, who already has been
 * this month, and who has no price yet — before anything is written. Riders
 * already billed and riders without a price are skipped, never guessed at, so
 * running the same month twice is harmless.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, Loader2, Receipt } from 'lucide-react'
import { fmtINRExact } from '@/lib/formatMoney'
import { fetchBusFeeHeads, type BusFeeHead } from '@/lib/bus'
import {
  currentPeriod, issueBills, periodLabel, previewBills, type BillableRider,
} from '@/lib/transport/fees'
import { GBTN, GINPUT } from './glass'

function defaultDue(period: string): string {
  return `${period}-10`
}

export default function BillingRun({ routeIds, compact = false, onIssued }: {
  /** Restrict to these routes; every active route when omitted. */
  routeIds?: string[]
  compact?: boolean
  onIssued?: () => void
}) {
  const [period, setPeriod] = useState(currentPeriod())
  const [due, setDue] = useState(defaultDue(currentPeriod()))
  const [heads, setHeads] = useState<BusFeeHead[]>([])
  const [headId, setHeadId] = useState<string>('')
  const [rows, setRows] = useState<BillableRider[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)

  const routeKey = routeIds?.join(',') ?? ''

  const load = useCallback(async () => {
    setRows(null)
    setRows(await previewBills(period, routeKey ? routeKey.split(',') : undefined))
  }, [period, routeKey])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    fetchBusFeeHeads().then(h => {
      const active = h.filter(x => x.active)
      setHeads(active)
      // Default to a head that reads like a monthly bus fee, if there is one.
      const guess = active.find(x => /month/i.test(x.name)) ?? active[0]
      if (guess) setHeadId(guess.id)
    })
  }, [])

  const byRoute = useMemo(() => {
    const m = new Map<string, { name: string; ready: number; billed: number; missing: number; total: number }>()
    for (const r of rows ?? []) {
      const cur = m.get(r.route_id) ?? { name: r.route_name, ready: 0, billed: 0, missing: 0, total: 0 }
      if (r.alreadyBilled) cur.billed++
      else if (r.fee.amount == null || r.fee.amount <= 0) cur.missing++
      else { cur.ready++; cur.total += r.fee.amount }
      m.set(r.route_id, cur)
    }
    return [...m.entries()].map(([id, v]) => ({ id, ...v }))
  }, [rows])

  const ready = byRoute.reduce((n, r) => n + r.ready, 0)
  const total = byRoute.reduce((n, r) => n + r.total, 0)
  const missing = byRoute.reduce((n, r) => n + r.missing, 0)
  const billed = byRoute.reduce((n, r) => n + r.billed, 0)

  const issue = async () => {
    if (!rows || ready === 0) return
    if (!confirm(`Issue ${ready} bus fee bill${ready === 1 ? '' : 's'} for ${periodLabel(period)}, totalling ${fmtINRExact(total)}?`)) return
    setBusy(true); setResult(null)
    const res = await issueBills(rows, { period, dueDate: due || null, feeHeadId: headId || null })
    setBusy(false)
    setResult(res.success
      ? { ok: true, text: `Issued ${res.issued} bill${res.issued === 1 ? '' : 's'} for ${periodLabel(period)}.` }
      : { ok: false, text: res.error ?? 'Could not issue the bills.' })
    await load()
    if (res.success) onIssued?.()
  }

  return (
    <div className={`rounded-2xl border border-slate-200/70 bg-white/75 ${compact ? 'p-3' : 'p-4'}`}>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
        <label className="block">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Month</span>
          <input
            type="month"
            className={`${GINPUT} mt-1`}
            value={period}
            onChange={e => { if (e.target.value) { setPeriod(e.target.value); setDue(defaultDue(e.target.value)) } }}
          />
        </label>
        <label className="block">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Due date</span>
          <input type="date" className={`${GINPUT} mt-1`} value={due} onChange={e => setDue(e.target.value)} />
        </label>
        <label className="block">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Fee head</span>
          <select className={`${GINPUT} mt-1`} value={headId} onChange={e => setHeadId(e.target.value)}>
            <option value="">None</option>
            {heads.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
          </select>
        </label>
      </div>

      <div className="mt-3">
        {rows === null ? (
          <p className="flex items-center gap-2 text-xs text-slate-500 py-3"><Loader2 size={14} className="animate-spin" /> Working out who to bill…</p>
        ) : rows.length === 0 ? (
          <p className="text-xs text-slate-500 py-3">Nobody is assigned to {routeIds?.length === 1 ? 'this route' : 'any active route'} yet.</p>
        ) : (
          <>
            {!compact || byRoute.length > 1 ? (
              <div className="rounded-xl border border-slate-200/70 overflow-hidden">
                <div className="grid grid-cols-[1fr_4rem_4rem_4rem_6rem] gap-2 px-3 py-1.5 bg-slate-50/80 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  <span>Trip</span><span className="text-center">To bill</span><span className="text-center">Done</span><span className="text-center">No price</span><span className="text-right">Amount</span>
                </div>
                <ul className="max-h-56 overflow-y-auto divide-y divide-slate-200/60">
                  {byRoute.map(r => (
                    <li key={r.id} className="grid grid-cols-[1fr_4rem_4rem_4rem_6rem] gap-2 px-3 py-1.5 text-[12.5px] tabular-nums">
                      <span className="truncate font-medium text-slate-800">{r.name}</span>
                      <span className="text-center text-slate-700">{r.ready}</span>
                      <span className="text-center text-slate-400">{r.billed}</span>
                      <span className={`text-center ${r.missing ? 'font-semibold text-amber-600' : 'text-slate-400'}`}>{r.missing}</span>
                      <span className="text-right font-semibold text-slate-900">{fmtINRExact(r.total)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <p className="text-[12px] text-slate-600 leading-snug">
                <span className="font-semibold text-slate-900">{ready}</span> to bill for {periodLabel(period)}
                {billed > 0 && <> · <span className="text-slate-500">{billed} already billed</span></>}
                {missing > 0 && (
                  <> · <span className="inline-flex items-center gap-1 font-semibold text-amber-700"><AlertTriangle size={12} />{missing} without a price — skipped</span></>
                )}
              </p>
              <button className={GBTN.primary} onClick={issue} disabled={busy || ready === 0}>
                {busy ? <Loader2 size={14} className="animate-spin" /> : <Receipt size={14} />}
                Issue {ready > 0 ? `${ready} · ${fmtINRExact(total)}` : 'bills'}
              </button>
            </div>
          </>
        )}
        {result && (
          <p className={`mt-2 flex items-center gap-1.5 text-[12px] font-semibold ${result.ok ? 'text-emerald-700' : 'text-rose-600'}`}>
            {result.ok ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />} {result.text}
          </p>
        )}
      </div>
    </div>
  )
}
