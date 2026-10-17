'use client'

/**
 * Issue one month of bus fees — into the fee app.
 *
 * Bus fees are ordinary fee-app bills under the session's "Bus fee" head: one
 * bill per child, a line per route they ride, collected and receipted in Fees
 * like everything else. This panel and the fee grid's monthly issue call the
 * same database function, so a month issued from either is the same month.
 *
 * The preview shows, per route, who will be billed, who already has been, and
 * who has no price yet — before anything is written. Running a month twice
 * only bills whoever was missed the first time.
 */

import React, { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, ArrowUpRight, CheckCircle2, Loader2, Receipt } from 'lucide-react'
import { fmtINRExact } from '@/lib/formatMoney'
import { issueTransport, type TransportIssueSummary } from '@/lib/fees/grid'
import { currentPeriod, periodLabel, sessionForMonth } from '@/lib/transport/fees'
import { GBTN, GINPUT } from './glass'

export default function BillingRun({ routeIds, compact = false, onIssued }: {
  /** Restrict to these routes; every running route when omitted. */
  routeIds?: string[]
  compact?: boolean
  onIssued?: () => void
}) {
  const [period, setPeriod] = useState(currentPeriod())
  const [due, setDue] = useState('')
  const [session, setSession] = useState<{ id: string; code: string } | null | undefined>(undefined)
  const [preview, setPreview] = useState<TransportIssueSummary | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)

  const routeKey = routeIds?.join(',') ?? ''
  const month = `${period}-01`

  const load = useCallback(async () => {
    setPreview(null); setError(null)
    const s = await sessionForMonth(period)
    setSession(s)
    if (!s) return
    try {
      setPreview(await issueTransport(s.id, month, false, { due_date: due || null, route_ids: routeKey ? routeKey.split(',') : null }))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not preview the month.')
    }
  }, [period, month, due, routeKey])

  useEffect(() => { load() }, [load])

  const issue = async () => {
    if (!session || !preview || preview.lines === 0) return
    if (!confirm(`Issue ${preview.invoices} bus fee bill${preview.invoices === 1 ? '' : 's'} for ${periodLabel(period)}, totalling ${fmtINRExact(preview.total)}? They appear in Fees under “Bus fee”.`)) return
    setBusy(true); setError(null); setResult(null)
    try {
      const done = await issueTransport(session.id, month, true, { due_date: due || null, route_ids: routeKey ? routeKey.split(',') : null })
      setResult(`Issued ${done.invoices} bill${done.invoices === 1 ? '' : 's'} for ${periodLabel(period)} — ${fmtINRExact(done.total)}.`)
      onIssued?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not issue the bills.')
    } finally {
      setBusy(false)
      load()
    }
  }

  const single = routeIds?.length === 1
  const skipped = (preview?.unset ?? 0) + (preview?.unpriced ?? 0)

  return (
    <div className={`rounded-2xl border border-slate-200/70 bg-white/75 ${compact ? 'p-3' : 'p-4'}`}>
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2.5 items-end">
        <label className="block">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Month</span>
          <input type="month" className={`${GINPUT} mt-1`} value={period}
            onChange={e => { if (e.target.value) setPeriod(e.target.value) }} />
        </label>
        <label className="block">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Due date</span>
          <input type="date" className={`${GINPUT} mt-1`} value={due} onChange={e => setDue(e.target.value)} />
        </label>
        <Link href="/more/fees?section=collection" className={`${GBTN.secondary} !h-9`}>
          Collect in Fees <ArrowUpRight size={13} />
        </Link>
      </div>
      <p className="mt-1.5 text-[11px] text-slate-500">
        Billed under the fee app’s <span className="font-semibold text-slate-700">Bus fee</span> head
        {session ? ` for ${session.code}` : ''}. Leave the due date empty to use the month’s due date from Fees (the 10th by default).
      </p>

      <div className="mt-3">
        {session === null ? (
          <p className="text-xs text-amber-700 py-2">No academic session covers {periodLabel(period)}. Add it in Fees → academic years first.</p>
        ) : !preview && !error ? (
          <p className="flex items-center gap-2 text-xs text-slate-500 py-3"><Loader2 size={14} className="animate-spin" /> Working out who to bill…</p>
        ) : preview && preview.by_route.length === 0 ? (
          <p className="text-xs text-slate-500 py-3">Nobody rides {single ? 'this route' : 'any running route'} yet.</p>
        ) : preview ? (
          <>
            {(!compact || preview.by_route.length > 1) && (
              <div className="rounded-xl border border-slate-200/70 overflow-hidden">
                <div className="grid grid-cols-[1fr_4rem_4rem_4.5rem_6rem] gap-2 px-3 py-1.5 bg-slate-50/80 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  <span>Route</span><span className="text-center">To bill</span><span className="text-center">Done</span><span className="text-center">No price</span><span className="text-right">Amount</span>
                </div>
                <ul className="max-h-56 overflow-y-auto divide-y divide-slate-200/60">
                  {preview.by_route.map(r => (
                    <li key={r.route_id} className="grid grid-cols-[1fr_4rem_4rem_4.5rem_6rem] gap-2 px-3 py-1.5 text-[12.5px] tabular-nums">
                      <span className="truncate font-medium text-slate-800">
                        {r.route_name}
                        {r.unset && <span className="ml-1.5 text-[10.5px] font-semibold text-amber-700">· pricing not chosen</span>}
                      </span>
                      <span className="text-center text-slate-700">{r.ready}</span>
                      <span className="text-center text-slate-400">{r.already}</span>
                      <span className={`text-center ${r.unpriced ? 'font-semibold text-amber-600' : 'text-slate-400'}`}>{r.unpriced}</span>
                      <span className="text-right font-semibold text-slate-900">{fmtINRExact(r.total)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <p className="text-[12px] text-slate-600 leading-snug">
                <span className="font-semibold text-slate-900">{preview.invoices}</span> bill{preview.invoices === 1 ? '' : 's'}
                {preview.lines !== preview.invoices && <> ({preview.lines} route lines)</>} for {periodLabel(period)}, due {preview.due_date}
                {preview.already > 0 && <> · <span className="text-slate-500">{preview.already} already billed</span></>}
                {skipped > 0 && (
                  <span className="block text-[11.5px] font-semibold text-amber-700">
                    <AlertTriangle size={12} className="inline -mt-0.5 mr-1" />
                    {skipped} rider{skipped === 1 ? '' : 's'} skipped — {preview.unset > 0 ? 'choose by-stop or by-student pricing on the route’s Fees tab' : 'set their price on the route’s Fees tab'}.
                  </span>
                )}
              </p>
              <button className={GBTN.primary} onClick={issue} disabled={busy || preview.lines === 0}>
                {busy ? <Loader2 size={14} className="animate-spin" /> : <Receipt size={14} />}
                Issue {preview.lines > 0 ? `· ${fmtINRExact(preview.total)}` : 'bills'}
              </button>
            </div>
          </>
        ) : null}
        {error && <p className="mt-2 flex items-center gap-1.5 text-[12px] font-semibold text-rose-600"><AlertTriangle size={13} /> {error}</p>}
        {result && <p className="mt-2 flex items-center gap-1.5 text-[12px] font-semibold text-emerald-700"><CheckCircle2 size={13} /> {result}</p>}
      </div>
    </div>
  )
}
