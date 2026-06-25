'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Download, Wallet } from 'lucide-react'
import {
  CollectionRow, FeePaymentMethod, OFFLINE_METHODS, METHOD_LABELS, fetchCollectionReport,
} from '@/lib/fees'
import { UserProfile } from '@/lib/supabase'
import { exportRows } from '@/lib/feeExports'
import { formatINR } from './FeeCollectionSummary'

// Shared admin-aesthetic tokens (zinc + honey gold), mirroring page.tsx.
const card = 'bg-white border border-[#E4E4E7] rounded-xl'
const darkBtn = 'flex items-center justify-center gap-1.5 bg-[#27272A] hover:bg-[#18181B] text-white text-xs font-semibold px-3 py-2 rounded-lg transition-colors disabled:opacity-50'

type RangeKey = 'today' | 'yesterday' | 'custom'

const RANGES: { key: RangeKey; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'custom', label: 'Custom' },
]

function startOfDay(d: Date): Date { const x = new Date(d); x.setHours(0, 0, 0, 0); return x }
function endOfDay(d: Date): Date { const x = new Date(d); x.setHours(23, 59, 59, 999); return x }
function ymd(d: Date): string { return d.toLocaleDateString('en-CA') } // YYYY-MM-DD (local)
function refOf(r: CollectionRow): string { return r.upi_txn_ref || r.razorpay_payment_id || r.utr || '' }

/**
 * Daily Collection Report. Verified payments filtered by a date range
 * (Today / Yesterday / Custom) and payment method, with per-method totals and
 * an Excel export. Scoped to the academic year selected on the parent page.
 */
export default function CollectionReportSection({ year, onStudentClick }: { year: string; onStudentClick?: (student: UserProfile) => void }) {
  const [range, setRange] = useState<RangeKey>('today')
  const [fromDate, setFromDate] = useState<string>(ymd(new Date()))
  const [toDate, setToDate] = useState<string>(ymd(new Date()))
  const [methods, setMethods] = useState<Set<FeePaymentMethod>>(new Set())
  const [rows, setRows] = useState<CollectionRow[]>([])
  const [loading, setLoading] = useState(true)

  // Resolve the active range to concrete from/to timestamps.
  const window = useMemo(() => {
    const today = new Date()
    if (range === 'today') return { from: startOfDay(today), to: endOfDay(today) }
    if (range === 'yesterday') {
      const y = new Date(today); y.setDate(y.getDate() - 1)
      return { from: startOfDay(y), to: endOfDay(y) }
    }
    return { from: startOfDay(new Date(fromDate)), to: endOfDay(new Date(toDate)) }
  }, [range, fromDate, toDate])

  const load = useCallback(async () => {
    setLoading(true)
    const data = await fetchCollectionReport({
      from: window.from.toISOString(),
      to: window.to.toISOString(),
      methods: methods.size ? [...methods] : undefined,
      year,
    })
    setRows(data)
    setLoading(false)
  }, [window, methods, year])

  useEffect(() => { load() }, [load])

  const toggleMethod = (m: FeePaymentMethod) =>
    setMethods(prev => { const n = new Set(prev); n.has(m) ? n.delete(m) : n.add(m); return n })

  // Per-method totals + grand total.
  const totals = useMemo(() => {
    const byMethod = new Map<FeePaymentMethod, number>()
    let grand = 0
    for (const r of rows) {
      const amt = Number(r.amount) || 0
      byMethod.set(r.method, (byMethod.get(r.method) ?? 0) + amt)
      grand += amt
    }
    return { byMethod, grand }
  }, [rows])

  const onExport = () => {
    const out = rows.map(r => ({
      Date: r.verified_at ? new Date(r.verified_at).toLocaleString('en-IN') : '',
      Student: r.fee?.student?.full_name ?? '—',
      Fee: r.fee?.description || r.fee?.fee_head?.name || 'School fee',
      Method: METHOD_LABELS[r.method] ?? r.method,
      Reference: refOf(r),
      'Amount (₹)': Number(r.amount) || 0,
    }))
    const label = range === 'custom' ? `${fromDate}_to_${toDate}` : range
    exportRows(out, `Collection ${year}`, `collection-report-${label}`)
  }

  return (
    <div className="space-y-4">
      {/* Date range */}
      <div className="flex border-b border-[#E4E4E7]">
        {RANGES.map(r => {
          const active = range === r.key
          return (
            <button key={r.key} onClick={() => setRange(r.key)}
              className={`px-4 pb-2 text-xs font-semibold border-b-2 -mb-px transition-colors ${
                active ? 'border-[#27272A] text-[#18181B]' : 'border-transparent text-[#A1A1AA] hover:text-[#71717A]'
              }`}>
              {r.label}
            </button>
          )
        })}
      </div>

      {range === 'custom' && (
        <div className="flex flex-col sm:flex-row gap-2">
          <label className="flex-1 text-xs font-semibold text-[#71717A]">
            From
            <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
              className="mt-1 w-full bg-white border border-[#E4E4E7] rounded-lg px-3 py-2 text-sm text-[#27272A] focus:outline-none focus:border-[#27272A]" />
          </label>
          <label className="flex-1 text-xs font-semibold text-[#71717A]">
            To
            <input type="date" value={toDate} onChange={e => setToDate(e.target.value)}
              className="mt-1 w-full bg-white border border-[#E4E4E7] rounded-lg px-3 py-2 text-sm text-[#27272A] focus:outline-none focus:border-[#27272A]" />
          </label>
        </div>
      )}

      {/* Method filter */}
      <div className="flex flex-wrap gap-1.5">
        {OFFLINE_METHODS.map(m => {
          const on = methods.has(m)
          return (
            <button key={m} onClick={() => toggleMethod(m)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                on ? 'bg-[#27272A] border-[#27272A] text-white' : 'bg-white border-[#E4E4E7] text-[#71717A] hover:border-[#D4D4D8]'
              }`}>
              {METHOD_LABELS[m]}
            </button>
          )
        })}
        {methods.size > 0 && (
          <button onClick={() => setMethods(new Set())}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold text-[#A1A1AA] hover:text-[#27272A]">
            Clear
          </button>
        )}
      </div>

      {/* Totals + export summary bar */}
      <div className={`${card} shadow-sm p-3.5 flex flex-wrap items-center justify-between gap-3`}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <div className="flex items-baseline gap-1.5">
            <span className="text-xl font-bold text-[#18181B] tabular-nums">{formatINR(totals.grand)}</span>
            <span className="text-xs text-[#A1A1AA]">· {rows.length} payment{rows.length === 1 ? '' : 's'}</span>
          </div>
          {[...totals.byMethod.entries()].map(([m, amt]) => (
            <span key={m} className="text-[11px] px-2.5 py-1 rounded-full bg-[#F4F2EC] border border-[#E7E2D8] text-[#71717A] font-semibold tabular-nums">
              {METHOD_LABELS[m]} · {formatINR(amt)}
            </span>
          ))}
        </div>
        <button onClick={onExport} disabled={rows.length === 0} className={darkBtn}>
          <Download size={14} /> Export Excel
        </button>
      </div>

      {/* Table */}
      {loading ? (
        <div className="text-center py-12"><div className="spinner mx-auto mb-3" /><p className="text-sm text-[#71717A]">Loading…</p></div>
      ) : rows.length === 0 ? (
        <div className={`${card} p-8 text-center`}>
          <div className="w-14 h-14 mx-auto mb-3 rounded-xl bg-[#F4F2EC] border border-[#E7E2D8] flex items-center justify-center">
            <Wallet size={24} className="text-[#A8896B]" strokeWidth={1.6} />
          </div>
          <p className="text-sm text-[#71717A]">No collections in this range.</p>
        </div>
      ) : (
        <div className={`${card} shadow-sm overflow-hidden`}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#FAFAFA] border-b border-[#E4E4E7] text-left">
                  <th className="px-3 py-2.5 font-semibold text-[#71717A] text-xs uppercase tracking-wide">Date</th>
                  <th className="px-3 py-2.5 font-semibold text-[#71717A] text-xs uppercase tracking-wide">Student</th>
                  <th className="px-3 py-2.5 font-semibold text-[#71717A] text-xs uppercase tracking-wide">Fee</th>
                  <th className="px-3 py-2.5 font-semibold text-[#71717A] text-xs uppercase tracking-wide">Method</th>
                  <th className="px-3 py-2.5 font-semibold text-[#71717A] text-xs uppercase tracking-wide text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id} className="border-b border-[#F4F4F5] last:border-0">
                    <td className="px-3 py-2.5 text-[#71717A] whitespace-nowrap text-xs">
                      {r.verified_at ? new Date(r.verified_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}
                    </td>
                    <td className="px-3 py-2.5">
                      {r.fee?.student ? (
                        <button onClick={() => onStudentClick?.(r.fee!.student!)}
                          className="font-medium text-[#18181B] hover:underline underline-offset-2 text-left">
                          {r.fee.student.full_name}
                        </button>
                      ) : <span className="text-[#71717A]">—</span>}
                    </td>
                    <td className="px-3 py-2.5 text-[#71717A] truncate max-w-[160px]">{r.fee?.description || r.fee?.fee_head?.name || 'School fee'}</td>
                    <td className="px-3 py-2.5">
                      <span className="text-[11px] px-2 py-0.5 rounded-full bg-[#F4F4F5] text-[#52525B] font-semibold">{METHOD_LABELS[r.method] ?? r.method}</span>
                    </td>
                    <td className="px-3 py-2.5 text-right font-bold text-[#18181B] tabular-nums whitespace-nowrap">{formatINR(r.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
