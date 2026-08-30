'use client'

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { AlertTriangle, Bell, Download, Loader2, Search, CheckCircle2 } from 'lucide-react'
import { formatINR } from './FeeCollectionSummary'
import { exportRows } from '@/lib/feeExports'
import {
  fetchDefaulters, fetchAgeingTotals, scheduleReminders, sendQueuedReminders,
  type DefaulterRow,
} from '@/lib/fees/collections'
import { AGEING_LABELS, type AgeingState } from '@/lib/fees/engine/ageing'

/**
 * Who owes what, and for how long.
 *
 * Sorted oldest-debt-first rather than largest-first, because that is the order
 * an office actually works in: a ₹90,000 bill due next week is not a problem,
 * and a ₹4,000 one ninety days late is.
 *
 * A student's "worst" state is their oldest unpaid fee, not an average. A child
 * with one fee ninety days late and one due next week is a ninety-day problem,
 * and averaging that away is how a school stops noticing.
 */

interface Props {
  year?: string
  onOpenStudent?: (studentId: string) => void
}

const BUCKETS = [
  { key: 'current' as const, label: 'Not yet due', tone: 'text-slate-600 bg-slate-50 border-slate-200' },
  { key: '1-30' as const, label: '1–30 days', tone: 'text-amber-700 bg-amber-50 border-amber-200' },
  { key: '31-60' as const, label: '31–60 days', tone: 'text-orange-700 bg-orange-50 border-orange-200' },
  { key: '61-90' as const, label: '61–90 days', tone: 'text-rose-700 bg-rose-50 border-rose-200' },
  { key: '90+' as const, label: 'Over 90 days', tone: 'text-rose-800 bg-rose-100 border-rose-300' },
]

const STATE_FILTERS: { key: 'all' | AgeingState; label: string }[] = [
  { key: 'all', label: 'Everyone with dues' },
  { key: 'due_soon', label: 'Due this week' },
  { key: 'due_today', label: 'Due today' },
  { key: 'overdue_30', label: '1–30 overdue' },
  { key: 'overdue_60', label: '31–60 overdue' },
  { key: 'overdue_90', label: '61–90 overdue' },
  { key: 'overdue_90_plus', label: '90+ overdue' },
]

export default function DefaultersSection({ year, onOpenStudent }: Props) {
  const [rows, setRows] = useState<DefaulterRow[] | null>(null)
  const [totals, setTotals] = useState<Awaited<ReturnType<typeof fetchAgeingTotals>> | null>(null)
  const [filter, setFilter] = useState<'all' | AgeingState>('all')
  const [search, setSearch] = useState('')
  const [reminding, setReminding] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    setRows(null)
    const [d, t] = await Promise.all([
      fetchDefaulters({ year, states: filter === 'all' ? undefined : [filter] }),
      fetchAgeingTotals(year),
    ])
    setRows(d); setTotals(t)
  }, [year, filter])

  useEffect(() => { load() }, [load])

  const visible = useMemo(() => {
    if (!rows) return []
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(r =>
      r.student_name.toLowerCase().includes(q) || (r.class_label ?? '').toLowerCase().includes(q),
    )
  }, [rows, search])

  const runReminders = async () => {
    setReminding(true); setNotice(null)
    const queued = await scheduleReminders()
    if (!queued.success) { setReminding(false); setNotice(queued.error ?? 'Could not queue reminders.'); return }

    const sent = await sendQueuedReminders()
    setReminding(false)
    if (!sent.success) {
      setNotice(`${queued.queued ?? 0} reminders queued, but sending failed: ${sent.error}`)
      return
    }
    // Skipped is not a failure and is reported as its own number: a parent with
    // no push-enabled device will never receive one, and hiding that behind a
    // "sent" count would misrepresent the school's actual reach.
    setNotice(
      `${sent.sent ?? 0} sent` +
      (sent.skipped ? `, ${sent.skipped} had no reachable device` : '') +
      (sent.failed ? `, ${sent.failed} failed` : '') +
      (queued.queued === 0 ? ' — nothing new was due a reminder.' : '.'),
    )
  }

  const download = () => {
    exportRows(
      visible.map(r => ({
        Student: r.student_name,
        Class: r.class_label ?? '',
        Outstanding: r.outstanding,
        'Open fees': r.open_fees,
        'Earliest due': r.earliest_due ?? '',
        Status: AGEING_LABELS[r.worst.state],
        'Not yet due': r.buckets.current,
        '1-30': r.buckets['1-30'],
        '31-60': r.buckets['31-60'],
        '61-90': r.buckets['61-90'],
        '90+': r.buckets['90+'],
      })),
      'Defaulters',
      `defaulters-${year ?? 'all'}`,
    )
  }

  return (
    <div className="space-y-4">
      {/* Ageing summary */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
        {BUCKETS.map(b => (
          <div key={b.key} className={`rounded-xl border p-3 ${b.tone}`}>
            <p className="text-[11px] font-medium opacity-80">{b.label}</p>
            <p className="text-base font-bold mt-0.5 tabular-nums">
              {totals ? formatINR(totals[b.key]) : '—'}
            </p>
          </div>
        ))}
      </div>

      {/* Controls */}
      <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
        <div className="relative flex-1 min-w-0">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search by name or class"
            className="w-full pl-9 pr-3 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-300"
          />
        </div>
        <select
          value={filter} onChange={e => setFilter(e.target.value as 'all' | AgeingState)}
          className="px-3 py-2.5 text-sm border border-slate-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-slate-300"
        >
          {STATE_FILTERS.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
        </select>
        <div className="flex gap-2">
          <button
            onClick={download} disabled={!visible.length}
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2.5 rounded-xl border border-slate-200 text-slate-600 hover:border-slate-300 disabled:opacity-40"
          >
            <Download size={14} /> Export
          </button>
          <button
            onClick={runReminders} disabled={reminding}
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2.5 rounded-xl bg-slate-800 text-white hover:bg-slate-900 disabled:opacity-50"
          >
            {reminding ? <Loader2 size={14} className="animate-spin" /> : <Bell size={14} />}
            Send reminders
          </button>
        </div>
      </div>

      {notice && (
        <div className="flex items-start gap-2 p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-600">
          <CheckCircle2 size={14} className="flex-shrink-0 mt-0.5 text-slate-400" /> {notice}
        </div>
      )}

      {/* List */}
      {rows === null ? (
        <div className="py-10 text-center"><div className="spinner mx-auto" /></div>
      ) : visible.length === 0 ? (
        <div className="py-12 text-center">
          <CheckCircle2 size={32} className="text-emerald-500 mx-auto mb-3" />
          <p className="text-sm font-medium text-slate-700">Nothing outstanding here</p>
          <p className="text-xs text-slate-400 mt-1">
            {search ? 'No student matches that search.' : 'Every fee in this view has been collected.'}
          </p>
        </div>
      ) : (
        <>
          <p className="text-xs text-slate-400">
            {visible.length} student{visible.length === 1 ? '' : 's'} ·{' '}
            {formatINR(visible.reduce((s, r) => s + r.outstanding, 0))} outstanding
          </p>
          <div className="space-y-1.5">
            {visible.map(r => (
              <DefaulterCard key={r.student_id} row={r} onOpen={onOpenStudent} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function DefaulterCard({ row, onOpen }: { row: DefaulterRow; onOpen?: (id: string) => void }) {
  const severe = row.worst.bucket === '61-90' || row.worst.bucket === '90+'
  return (
    <button
      onClick={() => onOpen?.(row.student_id)}
      className="w-full text-left p-3 rounded-xl border border-slate-200 hover:border-slate-300 transition-colors bg-white"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-800 truncate">{row.student_name}</p>
          <p className="text-[11px] text-slate-400 mt-0.5">
            {row.class_label ?? 'No class'} · {row.open_fees} unpaid fee{row.open_fees === 1 ? '' : 's'}
            {row.earliest_due && ` · oldest due ${new Date(row.earliest_due).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`}
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-sm font-bold text-slate-800 tabular-nums">{formatINR(row.outstanding)}</p>
          <span className={`inline-flex items-center gap-1 text-[10px] font-semibold mt-1 px-1.5 py-0.5 rounded ${
            severe ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-600'
          }`}>
            {severe && <AlertTriangle size={9} />}
            {AGEING_LABELS[row.worst.state]}
          </span>
        </div>
      </div>
    </button>
  )
}
