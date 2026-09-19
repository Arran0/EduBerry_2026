'use client'

// ─────────────────────────────────────────────────────────────────────────────
// The Collection Center.
//
// One screen that answers "how are we doing, and where is the money stuck?".
// Four headline figures stay on screen whichever tab is open, because the
// question a principal asks does not change when the evidence does.
//
// Everything here reads the Round 4 views, which read the same tables the
// counter writes to. No figure on this page is computed a second way, so no
// two tabs can disagree — and a masked reader gets the same charts, the same
// counts and the same classes with dots where the rupees are, because the
// database withheld the numbers rather than the interface hiding them.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import {
  ArrowLeft, BarChart3, CalendarDays, Download, FileClock, Loader2,
  Landmark, Search, ScrollText, BadgePercent, Send,
} from 'lucide-react'
import ProtectedLayout from '@/components/ProtectedLayout'
import { AcademicYearProvider, useAcademicYear } from '@/contexts/AcademicYearContext'
import { useFeePermissions } from '@/hooks/useFeePermissions'
import { ADMIN, fmtDate, inr } from '@/components/fees/ui'
import YearScope from '@/components/fees/config/YearScope'
import { FeeScreen, StatStrip, TabBar, Notice, Empty, Loading, type TabDef } from '@/components/fees/shell'
import NoAccess from '@/components/fees/NoAccess'
import FeeSearch from '@/components/fees/reports/FeeSearch'
import RefundQueue from '@/components/fees/reports/RefundQueue'
import RteRegister from '@/components/fees/reports/RteRegister'
import {
  AgingCliff, CollectionCalendar, DefaulterHeatmap, EfficiencyBar,
} from '@/components/fees/reports/charts'
import { gradeLabel } from '@/lib/grades'
import { exportRows } from '@/lib/feeExports'
import { sendReminders } from '@/lib/fees/charges'
import { fetchUnpaidInvoices, type InvoiceRow } from '@/lib/fees/invoices'
import {
  fetchAging, fetchAudit, fetchCollectionDaily, fetchConcessionSummary,
  fetchDefaultersByClass, fetchInstrumentPipeline, fetchRefunds, fetchRteRegister,
  fetchStaffCollection, fetchYearSummary, namesFor,
  type AgingRow, type AuditRow, type CollectionDayRow, type ConcessionSummaryRow,
  type DefaulterClassRow, type InstrumentPipelineRow, type RefundRow, type RteRow,
  type StaffCollectionRow, type YearSummaryRow,
} from '@/lib/fees/reports'

type Tab = 'overview' | 'collections' | 'outstanding' | 'instruments' | 'concessions' | 'operations'

const TABS: TabDef<Tab>[] = [
  { key: 'overview',    label: 'Overview',    icon: BarChart3 },
  { key: 'collections', label: 'Collections', icon: CalendarDays },
  { key: 'outstanding', label: 'Outstanding', icon: FileClock },
  { key: 'instruments', label: 'Instruments', icon: Landmark },
  { key: 'concessions', label: 'Concessions', icon: BadgePercent },
  { key: 'operations',  label: 'Operations',  icon: ScrollText },
]

function ReportsInner() {
  const { year, years } = useAcademicYear()
  const perms = useFeePermissions()
  const [tab, setTab] = useState<Tab>('overview')

  const [summary, setSummary] = useState<YearSummaryRow | null>(null)
  const [daily, setDaily] = useState<CollectionDayRow[]>([])
  const [aging, setAging] = useState<AgingRow[]>([])
  const [classes, setClasses] = useState<DefaulterClassRow[]>([])
  const [concessions, setConcessions] = useState<ConcessionSummaryRow[]>([])
  const [pipeline, setPipeline] = useState<InstrumentPipelineRow[]>([])
  const [staff, setStaff] = useState<StaffCollectionRow[]>([])
  const [refunds, setRefunds] = useState<RefundRow[]>([])
  const [rte, setRte] = useState<RteRow[]>([])
  const [audit, setAudit] = useState<AuditRow[]>([])
  const [unpaid, setUnpaid] = useState<InvoiceRow[]>([])
  const [names, setNames] = useState<Map<string, string>>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searching, setSearching] = useState(false)
  const [reminding, setReminding] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const showAmounts = !perms.amountsHidden
  // A boolean rather than `perms` itself — see the note on the hub's loader.
  const canSeeAudit = perms.can('fees.audit.view')

  // What each tab needs, so opening the Collection Center does not pull the
  // whole module down. This page used to fetch eleven datasets on mount —
  // every tab's, including up to five thousand invoice rows — for a reader who
  // in practice looks at Overview and leaves.
  //
  // Overview's four headline figures are one view, so they stay eager; the
  // rest arrive when their tab is first opened and are then kept.
  // A ref, not state. `load` reads it to decide whether a tab is already in
  // hand, and writes it when a fetch lands — as state that would put `load` in
  // its own dependency chain, which is exactly the loop this module had to fix
  // on the hub. A ref keeps `load` stable and the bookkeeping invisible to
  // rendering, which is what it is: nothing on screen depends on it.
  const fetched = useRef<Set<Tab | 'headline'>>(new Set())

  const load = useCallback(async (what: Tab | 'headline' | 'all', force = false) => {
    if (!year) return
    if (!force && what !== 'all' && fetched.current.has(what)) return
    setLoading(true)
    try {
      const want = (t: Tab | 'headline') => what === 'all' || what === t

      const [s, d, a, c, cs, p, st, rf, rt, au, un] = await Promise.all([
        want('headline') || want('overview') ? fetchYearSummary(year.id) : null,
        want('overview') || want('collections') ? fetchCollectionDaily(year.id) : null,
        want('outstanding') ? fetchAging(year.id) : null,
        want('outstanding') ? fetchDefaultersByClass(year.id) : null,
        want('concessions') ? fetchConcessionSummary(year.id) : null,
        want('instruments') ? fetchInstrumentPipeline(year.id) : null,
        want('instruments') ? fetchStaffCollection(year.id) : null,
        want('instruments') ? fetchRefunds(year.id) : null,
        want('operations') ? fetchRteRegister(year.id) : null,
        want('operations') && canSeeAudit ? fetchAudit({ yearId: year.id, limit: 200 }) : null,
        // Only the two tabs with a Remind button need the bills behind it.
        want('outstanding') || want('operations') ? fetchUnpaidInvoices(year.id) : null,
      ])

      if (s) setSummary(s)
      if (d) setDaily(d)
      if (a) setAging(a)
      if (c) setClasses(c)
      if (cs) setConcessions(cs)
      if (p) setPipeline(p)
      if (st) setStaff(st)
      if (rf) setRefunds(rf)
      if (rt) setRte(rt)
      if (au) setAudit(au)
      if (un) setUnpaid(un)

      if (what === 'all') {
        fetched.current.add('headline')
        TABS.forEach(t => fetched.current.add(t.key))
      } else {
        fetched.current.add(what)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the reports.')
    } finally {
      setLoading(false)
    }
  }, [year, canSeeAudit])

  // The headline strip and whichever tab is open. Changing the session throws
  // the cache away, because every figure on the page is scoped to one.
  useEffect(() => { fetched.current = new Set() }, [year])
  useEffect(() => { void load('headline') }, [load])
  useEffect(() => { void load(tab) }, [load, tab])

  /** After a write, re-fetch what is on screen rather than everything. */
  const reload = useCallback(async () => {
    await load('headline', true)
    await load(tab, true)
  }, [load, tab])

  // Names for the refund queue, the RTE register and the audit trail, fetched
  // once for all three rather than per row.
  //
  // `namesFor` batches. This used to slice to the first 300 ids, so an audit
  // trail longer than that showed "Student" for every row past it — silently,
  // because a truncated list still renders.
  const nameIds = useMemo(() => Array.from(new Set([
    ...refunds.map(r => r.student_id),
    ...rte.map(r => r.student_id),
    ...audit.map(a => a.student_id).filter((x): x is string => Boolean(x)),
  ])).sort().join(','), [refunds, rte, audit])

  useEffect(() => {
    if (!nameIds) return
    let cancelled = false
    void namesFor(nameIds.split(',')).then(m => { if (!cancelled) setNames(m) })
    return () => { cancelled = true }
  }, [nameIds])

  const todayCollected = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10)
    const rows = daily.filter(d => d.day === today)
    if (rows.length === 0) return 0
    if (rows.every(r => r.collected === null)) return null
    return rows.reduce((a, r) => a + Number(r.collected ?? 0), 0)
  }, [daily])

  /** Remind every family in one class, straight from the heatmap. */
  const remindClass = async (row: DefaulterClassRow) => {
    const key = `${row.grade}-${row.section}`
    setReminding(key)
    setNote(null)
    try {
      const { supabase } = await import('@/lib/supabase')
      let q = supabase.from('profiles').select('id').eq('role', 'student').eq('grade', row.grade)
      if (row.section) q = q.eq('section', row.section)
      const { data } = await q
      const ids = new Set((data ?? []).map(r => (r as { id: string }).id))
      const bills = unpaid.filter(i => ids.has(i.student_id)).map(i => i.id)
      if (bills.length === 0) { setNote('Nothing to remind about in that class.'); return }
      const result = await sendReminders(bills, 'fee_reminder_overdue')
      setNote(`${result.queued} reminder${result.queued === 1 ? '' : 's'} queued for ` +
              `${gradeLabel(row.grade)}${row.section ?? ''}.`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Those reminders were not queued.')
    } finally {
      setReminding(null)
    }
  }

  if (perms.loading) {
    return <div className="p-10 flex justify-center"><Loader2 className="animate-spin text-[#8C8878]" /></div>
  }
  if (!perms.can('fees.reports.view')) return <NoAccess what="see the fee reports" />

  return (
    <FeeScreen
      title="Collection Center"
      subtitle={<>Session {summary?.code ?? year?.code ?? '—'}
              {summary?.session_progress !== null && summary?.session_progress !== undefined
                && ` · ${summary.session_progress}% through`}</>}
      icon={<BarChart3 size={17} style={{ color: '#B8983C' }} />}
      back={{ href: '/more/fees', label: 'Fees' }}
      actions={<><button onClick={() => setSearching(true)}
                  className="inline-flex items-center gap-1.5 bg-[#27272A] hover:bg-[#18181B] text-white border border-[#27272A]
                               text-[10.5px] font-bold uppercase tracking-[0.08em] px-2.5 py-[7px]">
            <Search size={13} /> Search
          </button><YearScope /></>}
    >
      {/* The four figures that never leave the screen. */}
      <StatStrip
        loading={loading}
        stats={[
          { label: 'Collected', value: inr(summary?.collected, showAmounts) },
          { label: 'Outstanding', value: inr(summary?.outstanding, showAmounts),
            tone: (summary?.outstanding ?? 0) > 0 ? '#7A6220' : undefined },
          { label: 'Efficiency',
            value: summary?.efficiency === null || summary?.efficiency === undefined
              ? '—' : `${summary.efficiency}%` },
          { label: 'Today', value: inr(todayCollected, showAmounts), strong: true },
        ]}
      />

      {perms.amountsHidden && (
        <Notice>
          Amounts are hidden for your account — the rupee figures are not sent to this device at
          all. Every count, class and chart below is still complete.
        </Notice>
      )}

      <TabBar<Tab> active={tab} onChange={setTab} tabs={TABS} />

      {error && <Notice tone="error">{error}</Notice>}
      {note && <Notice tone="good">{note}</Notice>}

      {loading ? (
        <div className="p-10 flex justify-center"><Loader2 className="animate-spin text-[#8C8878]" /></div>
      ) : tab === 'overview' ? (
        <Overview summary={summary} showAmounts={showAmounts} daily={daily} />
      ) : tab === 'collections' ? (
        <div className="space-y-4">
          {summary && (
            <CollectionCalendar rows={daily} startsOn={summary.starts_on}
                                endsOn={summary.ends_on} showAmounts={showAmounts} />
          )}
          <ByMethod rows={daily} showAmounts={showAmounts} />
        </div>
      ) : tab === 'outstanding' ? (
        <div className="space-y-4">
          <AgingCliff rows={aging} showAmounts={showAmounts} />
          <DefaulterHeatmap rows={classes} showAmounts={showAmounts}
                            onPick={perms.can('fees.reminder.send')
                              ? row => void remindClass(row) : undefined} />
          <ClassTable rows={classes} showAmounts={showAmounts}
                      canRemind={perms.can('fees.reminder.send')}
                      reminding={reminding} onRemind={remindClass} />
        </div>
      ) : tab === 'instruments' ? (
        <div className="space-y-4">
          <Pipeline rows={pipeline} showAmounts={showAmounts} />
          <StaffTable rows={staff} showAmounts={showAmounts} />
          <RefundQueue rows={refunds} names={names} showAmounts={showAmounts}
                       canDecide={perms.can('fees.refund.approve')} onChanged={reload} />
        </div>
      ) : tab === 'concessions' ? (
        <ConcessionTable rows={concessions} showAmounts={showAmounts} />
      ) : (
        <div className="space-y-4">
          {year && (
            <RteRegister rows={rte} names={names} yearId={year.id} showAmounts={showAmounts}
                         canManage={perms.can('fees.rte.manage')} onChanged={reload} />
          )}
          {years.length > 1 && perms.can('fees.config.clone_year') && year && (
            <CarryForward years={years.map(y => ({ id: y.id, code: y.code }))}
                          currentId={year.id} showAmounts={showAmounts} onDone={reload} />
          )}
          <AuditTrail rows={audit} names={names} showAmounts={showAmounts}
                      canSee={perms.can('fees.audit.view')} />
        </div>
      )}


      {searching && year && (
        <FeeSearch yearId={year.id} showAmounts={showAmounts}
                   canRemind={perms.can('fees.reminder.send')}
                   unpaid={unpaid} onClose={() => setSearching(false)} />
      )}
    </FeeScreen>
  )
}


function Overview({
  summary, showAmounts, daily,
}: { summary: YearSummaryRow | null; showAmounts: boolean; daily: CollectionDayRow[] }) {
  if (!summary) {
    return <div className={`${ADMIN.card} p-10 text-center text-sm text-[#8C8878]`}>
      Nothing has been billed in this session yet.
    </div>
  }

  const recent = [...daily].sort((a, b) => b.day.localeCompare(a.day)).slice(0, 12)

  return (
    <div className="grid lg:grid-cols-3 gap-4">
      <div className="lg:col-span-2 space-y-4">
        <EfficiencyBar efficiency={summary.efficiency}
                       sessionProgress={summary.session_progress} />

        <div className={ADMIN.card}>
          <div className="px-4 py-2.5 border-b border-[#F0ECE2]">
            <h3 className={ADMIN.label}>What the school is owed, and why</h3>
          </div>
          <div className="p-4 space-y-1">
            <Line label="Fees billed" value={summary.gross} showAmounts={showAmounts} />
            <Line label="Late fees" value={summary.late_fees} showAmounts={showAmounts} />
            <Line label="Fines" value={summary.fines} showAmounts={showAmounts} />
            <Line label="Brought forward from last session" value={summary.opening_balances}
                  showAmounts={showAmounts} />
            <Line label="Tax" value={summary.tax} showAmounts={showAmounts} />
            <Line label="Concessions given" value={summary.concessions} showAmounts={showAmounts}
                  negative />
            <div className="border-t border-[#E3DFD3] pt-2 mt-2">
              <Line label="Payable" value={summary.payable} showAmounts={showAmounts} strong />
              <Line label="Collected" value={summary.collected} showAmounts={showAmounts} />
              <Line label="Refunded" value={summary.refunded} showAmounts={showAmounts} negative />
            </div>
            <div className="border-t border-[#E3DFD3] pt-2 mt-2">
              <Line label="Still outstanding" value={summary.outstanding} showAmounts={showAmounts}
                    strong tone="amber" />
            </div>
          </div>
          <p className="px-4 py-2.5 text-[11px] text-[#8C8878] border-t border-[#F0ECE2] leading-relaxed">
            Every figure here comes from the same invoices and payments the counter writes, so no
            other report can disagree with this one.
          </p>
        </div>
      </div>

      <div className="space-y-4">
        <div className={ADMIN.card}>
          <div className="px-4 py-2.5 border-b border-[#F0ECE2]">
            <h3 className={ADMIN.label}>Money landing</h3>
          </div>
          {recent.length === 0 ? (
            <p className="px-4 py-6 text-sm text-[#8C8878]">Nothing collected yet.</p>
          ) : recent.map((d, i) => (
            <div key={`${d.day}-${d.method}-${i}`}
                 className="flex items-center gap-3 px-4 py-2 border-b border-[#F0ECE2] last:border-0">
              <span className="text-xs text-[#6B675A] flex-1">{fmtDate(d.day)}</span>
              <span className="text-[11px] text-[#8C8878]">{d.method}</span>
              <span className="text-sm font-semibold text-[#18181B]">
                {inr(d.collected, showAmounts)}
              </span>
            </div>
          ))}
        </div>

        <div className={`${ADMIN.card} p-4`}>
          <div className={ADMIN.label}>Bills</div>
          <div className="mt-2 space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-[#6B675A]">Issued</span>
              <span className="font-semibold text-[#18181B]">{summary.bills}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#6B675A]">Past due</span>
              <span className="font-semibold text-[#7A6220]">{summary.overdue_bills}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#6B675A]">Students billed</span>
              <span className="font-semibold text-[#18181B]">{summary.students}</span>
            </div>
          </div>
        </div>

        {(Number(summary.rte_claimed ?? 0) > 0 || Number(summary.rte_reimbursed ?? 0) > 0) && (
          <div className={`${ADMIN.card} p-4`}>
            <div className={ADMIN.label}>RTE</div>
            <div className="mt-2 space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-[#6B675A]">Claimed</span>
                <span className="font-semibold text-[#18181B]">{inr(summary.rte_claimed, showAmounts)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#6B675A]">Reimbursed</span>
                <span className="font-semibold text-[#1F6B42]">{inr(summary.rte_reimbursed, showAmounts)}</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function Line({
  label, value, showAmounts, negative, strong, tone,
}: {
  label: string
  value: number | null
  showAmounts: boolean
  negative?: boolean
  strong?: boolean
  tone?: 'amber'
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5">
      <span className={`text-sm ${strong ? 'font-semibold text-[#18181B]' : 'text-[#6B675A]'}`}>
        {label}
      </span>
      <span className={`text-sm tabular-nums ${
        strong ? 'font-bold' : 'font-medium'} ${
        tone === 'amber' ? 'text-[#7A6220]' : negative ? 'text-[#1F6B42]' : 'text-[#18181B]'}`}>
        {negative && showAmounts && value ? '−' : ''}{inr(value, showAmounts)}
      </span>
    </div>
  )
}

// ── Collections by method ─────────────────────────────────────────────────
function ByMethod({ rows, showAmounts }: { rows: CollectionDayRow[]; showAmounts: boolean }) {
  const byMethod = new Map<string, { receipts: number; collected: number | null }>()
  rows.forEach(r => {
    const seen = byMethod.get(r.method) ?? { receipts: 0, collected: null }
    byMethod.set(r.method, {
      receipts: seen.receipts + r.receipts,
      collected: r.collected === null ? seen.collected : (seen.collected ?? 0) + Number(r.collected),
    })
  })
  const list = Array.from(byMethod.entries()).sort((a, b) => b[1].receipts - a[1].receipts)
  const peak = Math.max(1, ...list.map(([, v]) => v.receipts))

  return (
    <div className={ADMIN.card}>
      <div className="px-4 py-2.5 border-b border-[#F0ECE2] flex items-center justify-between">
        <h3 className={ADMIN.label}>How families paid</h3>
        <button onClick={() => void exportRows(
                  list.map(([method, v]) => ({
                    Method: method, Receipts: v.receipts,
                    Collected: showAmounts && v.collected !== null ? v.collected : '••••',
                  })), 'By method', 'fee-collection-by-method')}
                className={ADMIN.ghostBtn}>
          <Download size={13} /> Export
        </button>
      </div>
      {list.length === 0 ? (
        <p className="px-4 py-8 text-sm text-[#8C8878]">Nothing collected yet.</p>
      ) : list.map(([method, v]) => (
        <div key={method} className="px-4 py-2.5 border-b border-[#F0ECE2] last:border-0">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-[#18181B] capitalize">{method.replace('_', ' ')}</span>
            <span className="text-[11px] text-[#8C8878]">{v.receipts} receipts</span>
            <span className="text-sm font-semibold text-[#18181B] w-28 text-right">
              {inr(v.collected, showAmounts)}
            </span>
          </div>
          <div className="mt-1.5 h-1.5 bg-[#F4F1E7]">
            <div className="h-full bg-[#B8983C]" style={{ width: `${(v.receipts / peak) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  )
}

// ── The class table under the heatmap ─────────────────────────────────────
function ClassTable({
  rows, showAmounts, canRemind, reminding, onRemind,
}: {
  rows: DefaulterClassRow[]
  showAmounts: boolean
  canRemind: boolean
  reminding: string | null
  onRemind: (row: DefaulterClassRow) => Promise<void>
}) {
  const sorted = [...rows].sort((a, b) => Number(b.outstanding ?? 0) - Number(a.outstanding ?? 0)
    || b.students_owing - a.students_owing)

  return (
    <div className={ADMIN.card}>
      <div className="px-4 py-2.5 border-b border-[#F0ECE2] flex items-center justify-between">
        <h3 className={ADMIN.label}>Class by class</h3>
        <button onClick={() => void exportRows(
                  sorted.map(r => ({
                    Class: `${gradeLabel(r.grade)}${r.section ?? ''}`,
                    'Students owing': r.students_owing,
                    Bills: r.bills,
                    'Worst days late': r.worst_days_late ?? 0,
                    Outstanding: showAmounts && r.outstanding !== null ? Number(r.outstanding) : '••••',
                  })), 'Defaulters', 'fee-defaulters-by-class')}
                className={ADMIN.ghostBtn}>
          <Download size={13} /> Export
        </button>
      </div>
      {sorted.length === 0 ? (
        <p className="px-4 py-8 text-sm text-[#8C8878]">Nothing outstanding.</p>
      ) : sorted.map(r => {
        const key = `${r.grade}-${r.section}`
        return (
          <div key={key}
               className="flex flex-wrap items-center gap-3 px-4 py-2.5 border-b border-[#F0ECE2] last:border-0">
            <span className="text-sm font-semibold text-[#18181B] w-16">
              {gradeLabel(r.grade)}{r.section ?? ''}
            </span>
            <span className="text-[11px] text-[#8C8878] flex-1">
              {r.students_owing} student{r.students_owing === 1 ? '' : 's'} · {r.bills} bills
              {r.worst_days_late !== null && r.worst_days_late > 0
                ? ` · worst ${r.worst_days_late} days late` : ''}
            </span>
            <span className="text-sm font-semibold text-[#18181B] w-28 text-right">
              {inr(r.outstanding, showAmounts)}
            </span>
            {canRemind && (
              <button onClick={() => void onRemind(r)} disabled={reminding === key}
                      className={ADMIN.ghostBtn}>
                {reminding === key ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                Remind all
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── The cheque pipeline ───────────────────────────────────────────────────
const INSTRUMENT_STATE: Record<string, string> = {
  received: 'In hand', deposited: 'At the bank', cleared: 'Cleared',
  bounced: 'Bounced', cancelled: 'Cancelled',
}

function Pipeline({ rows, showAmounts }: { rows: InstrumentPipelineRow[]; showAmounts: boolean }) {
  const stuck = rows.reduce((a, r) => a + r.overdue_to_present, 0)
  return (
    <div className={ADMIN.card}>
      <div className="px-4 py-2.5 border-b border-[#F0ECE2] flex items-center justify-between">
        <h3 className={ADMIN.label}>Cheques and drafts</h3>
        {stuck > 0 && (
          <span className="text-[11px] text-[#7A6220]">
            {stuck} past the day it should have been presented
          </span>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-8 text-sm text-[#8C8878]">No cheques or drafts this session.</p>
      ) : rows.map((r, i) => (
        <div key={`${r.kind}-${r.status}-${i}`}
             className="flex flex-wrap items-center gap-3 px-4 py-2.5 border-b border-[#F0ECE2] last:border-0">
          <span className="text-sm text-[#18181B] w-32 capitalize">
            {r.kind === 'dd' ? 'Demand draft' : 'Cheque'}
          </span>
          <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 ${
            r.status === 'bounced' ? 'bg-[#FCECEC] text-[#A93232] border border-[#EFCCCC]'
              : r.status === 'cleared' ? 'bg-[#EAF5EE] text-[#1F6B42] border border-[#C6E3D2]'
              : 'bg-[#F4F1E7] text-[#6B675A] border border-[#E3DFD3]'}`}>
            {INSTRUMENT_STATE[r.status] ?? r.status}
          </span>
          <span className="text-[11px] text-[#8C8878] flex-1">{r.instruments}</span>
          <span className="text-sm font-semibold text-[#18181B] w-28 text-right">
            {inr(r.amount, showAmounts)}
          </span>
        </div>
      ))}
    </div>
  )
}

function StaffTable({ rows, showAmounts }: { rows: StaffCollectionRow[]; showAmounts: boolean }) {
  return (
    <div className={ADMIN.card}>
      <div className="px-4 py-2.5 border-b border-[#F0ECE2] flex items-center justify-between">
        <h3 className={ADMIN.label}>Who collected what</h3>
        <span className="text-[11px] text-[#8C8878]">
          For reconciling a cash box, not for ranking anyone
        </span>
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-8 text-sm text-[#8C8878]">Nothing collected yet.</p>
      ) : rows.map((r, i) => (
        <div key={`${r.staff_id}-${r.month}-${i}`}
             className="flex flex-wrap items-center gap-3 px-4 py-2.5 border-b border-[#F0ECE2] last:border-0">
          <span className="text-sm text-[#18181B] flex-1 min-w-[140px]">
            {r.staff_name ?? 'Not recorded'}
          </span>
          <span className="text-[11px] text-[#8C8878]">{fmtDate(r.month)}</span>
          <span className="text-[11px] text-[#8C8878]">{r.receipts} receipts</span>
          {r.reversed > 0 && (
            <span className="text-[11px] text-[#A93232]">{r.reversed} reversed</span>
          )}
          <span className="text-sm text-[#6B675A] w-24 text-right">
            cash {inr(r.cash, showAmounts)}
          </span>
          <span className="text-sm font-semibold text-[#18181B] w-28 text-right">
            {inr(r.collected, showAmounts)}
          </span>
        </div>
      ))}
    </div>
  )
}

// ── Given away against recovered ──────────────────────────────────────────
function ConcessionTable({
  rows, showAmounts,
}: { rows: ConcessionSummaryRow[]; showAmounts: boolean }) {
  const first = rows[0]
  return (
    <div className="space-y-4">
      <div className={ADMIN.card}>
        <div className="px-4 py-2.5 border-b border-[#F0ECE2]">
          <h3 className={ADMIN.label}>Given away on purpose</h3>
        </div>
        {rows.length === 0 ? (
          <p className="px-4 py-8 text-sm text-[#8C8878]">No concessions this session.</p>
        ) : rows.map(r => (
          <div key={r.kind}
               className="flex flex-wrap items-center gap-3 px-4 py-2.5 border-b border-[#F0ECE2] last:border-0">
            <span className="text-sm text-[#18181B] w-32 capitalize">{r.kind}</span>
            <span className="text-[11px] text-[#8C8878] flex-1">
              {r.grants} grant{r.grants === 1 ? '' : 's'} to {r.students} student{r.students === 1 ? '' : 's'}
            </span>
            <span className="text-sm font-semibold text-[#1F6B42] w-28 text-right">
              {inr(r.given_up, showAmounts)}
            </span>
          </div>
        ))}
      </div>

      {first && (
        <div className={`${ADMIN.card} p-4`}>
          <div className={ADMIN.label}>Recovered the other way</div>
          <div className="mt-3">
            <StatStrip stats={[
              { label: 'Fines charged', value: inr(first.fines_charged, showAmounts) },
              { label: 'Fines waived', value: inr(first.fines_waived, showAmounts) },
              { label: 'Late fees charged', value: inr(first.late_fees_charged, showAmounts) },
              { label: 'Late fees waived', value: inr(first.late_fees_waived, showAmounts) },
            ]} />
          </div>
          <p className="mt-3 text-[11px] text-[#8C8878] leading-relaxed">
            A school that waives most of what it charges is running a policy it does not believe in.
            Worth reading these two panels together once a term.
          </p>
        </div>
      )}
    </div>
  )
}

function CarryForward({
  years, currentId, showAmounts, onDone,
}: {
  years: { id: string; code: string }[]
  currentId: string
  showAmounts: boolean
  onDone: () => Promise<void> | void
}) {
  const [to, setTo] = useState('')
  const [preview, setPreview] = useState<{ students: number; total: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async (commit: boolean) => {
    if (!to) return
    setBusy(true)
    setError(null)
    try {
      const { carryForward } = await import('@/lib/fees/reports')
      const result = await carryForward(currentId, to, commit)
      setPreview({ students: result.students, total: result.total })
      if (commit) { setPreview(null); await onDone() }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The carry-forward did not run.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={`${ADMIN.card} p-4`}>
      <h3 className="text-sm font-bold text-[#18181B]">Carry unpaid dues into the next session</h3>
      <p className="text-xs text-[#8C8878] mt-1 leading-relaxed">
        What a family still owes at the end of this session becomes their opening balance in the
        next, named with the session it came from. Preview it first — this writes a debt against
        real families.
      </p>
      <div className="flex flex-wrap items-center gap-2 mt-3">
        <select value={to} onChange={e => { setTo(e.target.value); setPreview(null) }}
                className="bg-white border border-[#E3DFD3] px-2 py-1.5 text-xs text-[#18181B]
                           focus:outline-none focus:border-[#27272A]">
          <option value="">Carry into…</option>
          {years.filter(y => y.id !== currentId).map(y => (
            <option key={y.id} value={y.id}>{y.code}</option>
          ))}
        </select>
        <button onClick={() => void run(false)} disabled={busy || !to} className={ADMIN.ghostBtn}>
          {busy && <Loader2 size={13} className="animate-spin" />} Preview
        </button>
        <button onClick={() => void run(true)} disabled={busy || !preview || preview.students === 0}
                className={ADMIN.darkBtn}>
          Carry it forward
        </button>
      </div>
      {preview && (
        <p className="mt-2 text-xs text-[#18181B]">
          {preview.students} student{preview.students === 1 ? '' : 's'} would carry
          {' '}{inr(preview.total, showAmounts)} forward. Nothing has been written yet.
        </p>
      )}
      {error && <p className="mt-2 text-xs text-[#A93232]">{error}</p>}
    </div>
  )
}

// ── Operations: the audit trail ───────────────────────────────────────────
function AuditTrail({
  rows, names, showAmounts, canSee,
}: {
  rows: AuditRow[]
  names: Map<string, string>
  showAmounts: boolean
  canSee: boolean
}) {
  if (!canSee) {
    return (
      <div className={`${ADMIN.card} p-6 text-center`}>
        <p className="text-sm text-[#8C8878]">
          The audit trail needs the <code className="text-[#6B675A]">fees.audit.view</code> permission.
        </p>
      </div>
    )
  }

  return (
    <div className={ADMIN.card}>
      <div className="px-4 py-2.5 border-b border-[#F0ECE2] flex items-center justify-between">
        <h3 className={ADMIN.label}>Everything that happened</h3>
        <span className="text-[11px] text-[#8C8878]">Newest first · append only</span>
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-8 text-sm text-[#8C8878]">Nothing recorded yet this session.</p>
      ) : rows.map(r => (
        <div key={r.id}
             className="flex flex-wrap items-center gap-3 px-4 py-2 border-b border-[#F0ECE2] last:border-0">
          <span className="font-mono text-[11px] text-[#6B675A] w-44">{r.action}</span>
          <span className="text-xs text-[#18181B] flex-1 min-w-[140px]">
            {r.student_id ? names.get(r.student_id) ?? 'Student' : '—'}
            {r.reason && <span className="text-[#8C8878]"> · {r.reason}</span>}
          </span>
          <span className="text-[11px] text-[#8C8878]">
            {names.get(r.actor_id ?? '') ?? (r.actor_id ? 'Staff' : 'The system')}
          </span>
          <span className="text-[11px] text-[#8C8878] w-32 text-right">
            {new Date(r.created_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
          </span>
          <span className="text-xs font-semibold text-[#18181B] w-24 text-right">
            {r.amount === null ? '' : inr(r.amount, showAmounts)}
          </span>
        </div>
      ))}
    </div>
  )
}

export default function ReportsPage() {
  return (
    <ProtectedLayout staffOnly>
      <AcademicYearProvider>
        <ReportsInner />
      </AcademicYearProvider>
    </ProtectedLayout>
  )
}
