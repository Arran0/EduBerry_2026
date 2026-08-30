'use client'

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft, Download, FileSpreadsheet, Loader2, RotateCcw, TrendingUp,
  Users, XCircle, ChevronRight, AlertCircle,
} from 'lucide-react'
import ProtectedLayout from '@/components/ProtectedLayout'
import { useAuth } from '@/contexts/AuthContext'
import { isAdminRole } from '@/lib/supabase'
import { formatINR } from '@/components/fees/FeeCollectionSummary'
import YearToggler from '@/components/fees/YearToggler'
import { currentAcademicYear, listAcademicYears } from '@/lib/fees'
import {
  AgeingBar, BarList, StatTile, TrendLine, seriesColor,
  type BarDatum,
} from '@/components/fees/dashboard/Charts'
import {
  fetchDashboardTotals, fetchMethodSplit, fetchDailyCollection,
  fetchOutstandingByClass, fetchOutstandingByHead, fetchLedgerDetail,
  downloadAccountingExport,
  type DashboardTotals, type MethodSplit, type DailyPoint, type LedgerDetail,
  type ClassOutstanding, type HeadOutstanding,
} from '@/lib/fees/dashboard'
import { fetchAgeingTotals } from '@/lib/fees/collections'

/**
 * The leadership view.
 *
 * Every figure on this page is drillable down to individual ledger rows, which
 * is the whole reason the immutable ledger was built first: a principal asking
 * "where did that ₹4.2 lakh come from" gets a list of payments with gateway
 * references and UTRs, not a number they have to trust.
 *
 * Expected vs actual is stated as demand, collected and the percentage between
 * them rather than as a single "performance" score. A school's board asks for
 * collection percentage against demand; anything more processed than that
 * invites an argument about the formula instead of about the money.
 */

type Drill =
  | { kind: 'none' }
  | { kind: 'ledger'; title: string; filter: Parameters<typeof fetchLedgerDetail>[0] }

export default function FeeDashboardPage() {
  return (
    <ProtectedLayout>
      <DashboardGate />
    </ProtectedLayout>
  )
}

function DashboardGate() {
  const { profile } = useAuth()
  const router = useRouter()

  if (!profile) return <div className="p-8 text-center"><div className="spinner mx-auto" /></div>

  // Leadership reporting is for leadership. A teacher landing here by URL gets
  // a plain answer rather than an empty dashboard that looks broken.
  const allowed = isAdminRole(profile.role) || profile.role === 'principal'
  if (!allowed) {
    return (
      <div className="max-w-md mx-auto px-4 py-16 text-center">
        <AlertCircle size={32} className="text-slate-300 mx-auto mb-3" />
        <p className="text-sm font-medium text-slate-700">This dashboard is for school leadership</p>
        <p className="text-xs text-slate-400 mt-1.5">Fee reports are limited to admins and the principal.</p>
        <button onClick={() => router.push('/home')} className="mt-5 text-xs font-semibold text-slate-600 hover:text-slate-800">
          Back to home
        </button>
      </div>
    )
  }

  return <Dashboard />
}

function Dashboard() {
  const router = useRouter()
  const [year, setYear] = useState(currentAcademicYear())
  const [years, setYears] = useState<string[]>([])
  const [totals, setTotals] = useState<DashboardTotals | null>(null)
  const [ageing, setAgeing] = useState<Awaited<ReturnType<typeof fetchAgeingTotals>> | null>(null)
  const [methods, setMethods] = useState<MethodSplit[]>([])
  const [daily, setDaily] = useState<DailyPoint[]>([])
  const [classes, setClasses] = useState<ClassOutstanding[]>([])
  const [heads, setHeads] = useState<HeadOutstanding[]>([])
  const [drill, setDrill] = useState<Drill>({ kind: 'none' })
  const [exporting, setExporting] = useState<string | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const [t, a, m, d, c, h] = await Promise.all([
      fetchDashboardTotals(year),
      fetchAgeingTotals(year),
      fetchMethodSplit(),
      fetchDailyCollection(30),
      fetchOutstandingByClass(year),
      fetchOutstandingByHead(year),
    ])
    setTotals(t); setAgeing(a); setMethods(m); setDaily(d); setClasses(c); setHeads(h)
    setLoading(false)
  }, [year])

  useEffect(() => { load() }, [load])
  useEffect(() => { listAcademicYears().then(setYears) }, [])

  const classBars: BarDatum[] = useMemo(() => classes
    .filter(c => Number(c.outstanding) > 0)
    .sort((a, b) => Number(b.outstanding) - Number(a.outstanding))
    .slice(0, 12)
    .map(c => ({
      key: c.homeroom_id,
      label: c.homeroom_name || `Class ${c.grade ?? '?'}${c.section ?? ''}`,
      value: Number(c.outstanding),
      sub: `${c.students_with_dues} of ${c.students_billed} students · ${pct(Number(c.paid), Number(c.billed))}% collected`,
    })), [classes])

  const headBars: BarDatum[] = useMemo(() => heads
    .filter(h => Number(h.outstanding) > 0)
    .slice(0, 12)
    .map(h => ({
      key: h.fee_head_id ?? 'unassigned',
      label: h.head_name ?? 'Unassigned',
      value: Number(h.outstanding),
      sub: `${formatINR(Number(h.paid))} collected of ${formatINR(Number(h.billed))}`,
    })), [heads])

  const methodBars: BarDatum[] = useMemo(() => methods.map(m => ({
    key: m.method,
    label: m.label,
    value: m.amount,
    sub: `${m.count} payment${m.count === 1 ? '' : 's'}`,
  })), [methods])

  const runExport = async (format: 'tally' | 'zoho') => {
    setExporting(format); setExportError(null)
    const from = new Date(); from.setDate(1); from.setHours(0, 0, 0, 0)
    const res = await downloadAccountingExport(format, from.toISOString(), new Date().toISOString())
    setExporting(null)
    if (!res.success) setExportError(res.error ?? 'The export could not be produced.')
  }

  return (
    <div data-page-theme="fees" className="pb-16">
      <header className="sticky top-0 z-20 bg-white/95 backdrop-blur border-b border-slate-100">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-3">
          <button
            onClick={() => router.push('/more/fees')}
            aria-label="Back to fees"
            className="p-2 -ml-2 text-slate-400 hover:text-slate-700 rounded-lg"
          >
            <ArrowLeft size={18} />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="text-sm font-bold text-slate-800">Fee dashboard</h1>
            <p className="text-[11px] text-slate-400">Collections, arrears and reconciliation</p>
          </div>
          {years.length > 1 && <YearToggler years={years} value={year} onChange={setYear} />}
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-4 space-y-6">
        {loading || !totals ? (
          <div className="py-20 text-center"><div className="spinner mx-auto" /></div>
        ) : (
          <>
            {/* Headline numbers. Not charts — a single figure never is. */}
            <section className="grid grid-cols-2 lg:grid-cols-4 gap-2">
              <StatTile
                label="Collected today" value={formatINR(totals.todayCollection)}
                sub={`${formatINR(totals.monthCollection)} this month`}
                onClick={() => setDrill({
                  kind: 'ledger', title: "Today's collection",
                  filter: { from: startOfTodayIso(), kind: 'payment' },
                })}
              />
              <StatTile
                label="Collection rate" value={`${totals.collectionRate}%`}
                sub={`${formatINR(totals.collected)} of ${formatINR(totals.demand)} demand`}
                tone={totals.collectionRate >= 85 ? 'good' : totals.collectionRate >= 60 ? 'default' : 'warn'}
              />
              <StatTile
                label="Outstanding" value={formatINR(totals.outstanding)}
                sub={`${totals.studentsWithDues} of ${totals.studentsBilled} students`}
                onClick={() => router.push('/more/fees?section=defaulters')}
              />
              <StatTile
                label="Overdue" value={formatINR(totals.overdue)}
                sub="Past the grace period"
                tone={totals.overdue > 0 ? 'critical' : 'good'}
                onClick={() => router.push('/more/fees?section=defaulters')}
              />
            </section>

            <section className="grid lg:grid-cols-2 gap-4">
              <Card title="Collection, last 30 days" icon={<TrendingUp size={14} />}>
                <TrendLine data={daily} />
              </Card>

              <Card title="Arrears by age" icon={<Users size={14} />}>
                {ageing && (
                  <AgeingBar data={[
                    { label: 'Not yet due', value: ageing.current },
                    { label: '1–30 days', value: ageing['1-30'] },
                    { label: '31–60 days', value: ageing['31-60'] },
                    { label: '61–90 days', value: ageing['61-90'] },
                    { label: 'Over 90 days', value: ageing['90+'] },
                  ]} />
                )}
              </Card>
            </section>

            <section className="grid lg:grid-cols-2 gap-4">
              <Card title="Outstanding by class" sub="Largest first · tap for the class">
                <BarList
                  data={classBars}
                  emptyLabel="Every class is fully collected."
                  onSelect={d => router.push(`/more/fees?section=defaulters&homeroom=${d.key}`)}
                />
              </Card>

              <Card title="Outstanding by fee head">
                <BarList data={headBars} emptyLabel="Nothing outstanding under any head." />
              </Card>
            </section>

            <section className="grid lg:grid-cols-2 gap-4">
              <Card title="How parents paid" sub="This month">
                <BarList
                  data={methodBars}
                  colorFor={d => seriesColor(methodBars.findIndex(m => m.key === d.key))}
                  emptyLabel="No payments this month yet."
                  onSelect={d => setDrill({
                    kind: 'ledger', title: `${d.label} payments`,
                    filter: { from: startOfMonthIso(), method: d.key, kind: 'payment' },
                  })}
                />
              </Card>

              <Card title="Exceptions" sub="Worth a look before month end">
                <div className="space-y-2">
                  <ExceptionRow
                    icon={<RotateCcw size={13} />}
                    label="Refunded this month"
                    value={formatINR(totals.refundsThisMonth)}
                    onClick={() => setDrill({
                      kind: 'ledger', title: 'Refunds this month',
                      filter: { from: startOfMonthIso(), kind: 'refund' },
                    })}
                  />
                  <ExceptionRow
                    icon={<XCircle size={13} />}
                    label="Failed payment attempts"
                    value={String(totals.failedThisMonth)}
                    hint="No money moved — nothing to reconcile"
                  />
                  <ExceptionRow
                    icon={<Users size={13} />}
                    label="Students with dues"
                    value={String(totals.studentsWithDues)}
                    onClick={() => router.push('/more/fees?section=defaulters')}
                  />
                </div>
              </Card>
            </section>

            <Card title="Accounting export" sub="This month's ledger, ready to import">
              <p className="text-xs text-slate-500 leading-relaxed mb-3">
                Built from the transaction ledger, so refunds appear as their own vouchers
                rather than shrinking a receipt. Set a ledger account on every fee head first —
                Tally creates a new ledger for a name it does not recognise instead of
                refusing the import.
              </p>
              <div className="flex flex-wrap gap-2">
                <ExportButton
                  label="Tally XML" busy={exporting === 'tally'}
                  onClick={() => runExport('tally')} icon={<Download size={13} />}
                />
                <ExportButton
                  label="Zoho Books CSV" busy={exporting === 'zoho'}
                  onClick={() => runExport('zoho')} icon={<FileSpreadsheet size={13} />}
                />
              </div>
              {exportError && (
                <div className="flex items-start gap-2 mt-3 p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800">
                  <AlertCircle size={14} className="flex-shrink-0 mt-0.5" /> {exportError}
                </div>
              )}
            </Card>
          </>
        )}
      </main>

      {drill.kind === 'ledger' && (
        <LedgerDrawer title={drill.title} filter={drill.filter} onClose={() => setDrill({ kind: 'none' })} />
      )}
    </div>
  )
}

// ── Drilldown ───────────────────────────────────────────────────────────────

function LedgerDrawer({
  title, filter, onClose,
}: {
  title: string
  filter: Parameters<typeof fetchLedgerDetail>[0]
  onClose: () => void
}) {
  const [rows, setRows] = useState<LedgerDetail[] | null>(null)

  useEffect(() => { fetchLedgerDetail(filter).then(setRows) }, [filter])

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl w-full sm:max-w-2xl max-h-[88dvh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="w-10 h-1 bg-slate-200 rounded-full mx-auto mt-3 mb-1 sm:hidden" />
        <div className="sticky top-0 bg-white border-b border-slate-100 px-5 py-4 flex items-center justify-between">
          <div>
            <h2 className="font-bold text-slate-800 text-sm">{title}</h2>
            <p className="text-[11px] text-slate-400">
              {rows === null ? 'Loading…' : `${rows.length} ledger entr${rows.length === 1 ? 'y' : 'ies'}`}
            </p>
          </div>
          <button onClick={onClose} className="p-2 -mr-1 text-slate-400 hover:text-slate-700 rounded-lg" aria-label="Close">
            <XCircle size={18} />
          </button>
        </div>

        <div className="p-5">
          {rows === null ? (
            <div className="py-10 text-center"><div className="spinner mx-auto" /></div>
          ) : rows.length === 0 ? (
            <p className="text-xs text-slate-400 py-10 text-center">Nothing here for this period.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {rows.map(r => (
                <li key={r.id} className="py-2.5 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-slate-800 truncate">
                      {r.student_name ?? 'Unattributed'}
                    </p>
                    <p className="text-[10px] text-slate-400 mt-0.5">
                      {new Date(r.occurred_at).toLocaleString('en-IN', {
                        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                      })}
                      {r.method && ` · ${r.method.replace(/_/g, ' ')}`}
                    </p>
                    {/* The reference is the point of a drilldown — it is what
                        gets matched against a bank statement. */}
                    {(r.gateway_payment_id || r.utr) && (
                      <p className="text-[10px] text-slate-400 font-mono truncate mt-0.5">
                        {r.gateway_payment_id ?? r.utr}
                      </p>
                    )}
                  </div>
                  <span className={`text-xs font-semibold tabular-nums shrink-0 ${
                    r.direction === 'credit' ? 'text-slate-800' : 'text-rose-600'
                  }`}>
                    {r.direction === 'credit' ? '' : '−'}{formatINR(Number(r.amount))}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Bits ────────────────────────────────────────────────────────────────────

function Card({ title, sub, icon, children }: {
  title: string; sub?: string; icon?: React.ReactNode; children: React.ReactNode
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex items-baseline justify-between gap-2 mb-3">
        <h2 className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
          {icon && <span className="text-slate-400">{icon}</span>}{title}
        </h2>
        {sub && <span className="text-[10px] text-slate-400 shrink-0">{sub}</span>}
      </div>
      {children}
    </section>
  )
}

function ExceptionRow({ icon, label, value, hint, onClick }: {
  icon: React.ReactNode; label: string; value: string; hint?: string; onClick?: () => void
}) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag
      {...(onClick ? { onClick, type: 'button' as const } : {})}
      className={`w-full flex items-center justify-between gap-3 p-2.5 rounded-xl border border-slate-200 text-left ${
        onClick ? 'hover:border-slate-300 transition-colors' : ''
      }`}
    >
      <span className="flex items-center gap-2 min-w-0">
        <span className="text-slate-400 shrink-0">{icon}</span>
        <span className="min-w-0">
          <span className="block text-xs text-slate-700 truncate">{label}</span>
          {hint && <span className="block text-[10px] text-slate-400">{hint}</span>}
        </span>
      </span>
      <span className="flex items-center gap-1 shrink-0">
        <span className="text-xs font-semibold text-slate-800 tabular-nums">{value}</span>
        {onClick && <ChevronRight size={13} className="text-slate-300" />}
      </span>
    </Tag>
  )
}

function ExportButton({ label, busy, onClick, icon }: {
  label: string; busy: boolean; onClick: () => void; icon: React.ReactNode
}) {
  return (
    <button
      onClick={onClick} disabled={busy}
      className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2.5 rounded-xl border border-slate-200 text-slate-700 hover:border-slate-300 disabled:opacity-50"
    >
      {busy ? <Loader2 size={13} className="animate-spin" /> : icon}
      {label}
    </button>
  )
}

function pct(paid: number, billed: number): number {
  return billed > 0 ? Math.round((paid / billed) * 100) : 0
}

function startOfTodayIso(): string {
  const d = new Date(); d.setHours(0, 0, 0, 0)
  return d.toISOString()
}

function startOfMonthIso(): string {
  const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0)
  return d.toISOString()
}
