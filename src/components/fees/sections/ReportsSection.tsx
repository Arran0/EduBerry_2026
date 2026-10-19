'use client'

// ─────────────────────────────────────────────────────────────────────────────
// Reports.
//
// What came in, month by month, and from which fees. The month chart and the
// fee list are one instrument — point at a fee and the months redraw as that
// fee's collection; on a phone a tap pins it.
//
// Under it, class by class: how many families have not fully paid and how
// much of what was billed has come in, as one sheet. The registers nobody
// reads daily — concessions, who collected what, refunds, RTE, the audit
// trail — are one button each.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { BadgePercent, BarChart3, Building2, Download, Loader2, ScrollText, Undo2, UsersRound } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useAcademicYear } from '@/contexts/AcademicYearContext'
import { useFeePermissions } from '@/hooks/useFeePermissions'
import ModalShell from '@/components/ui/ModalShell'
import { ADMIN, FEE_ICON, fmtDate, inr } from '@/components/fees/ui'
import { Empty, Notice } from '@/components/fees/shell'
import { FeeDeck } from '@/components/fees/glass'
import NoAccess from '@/components/fees/NoAccess'
import RefundQueue from '@/components/fees/reports/RefundQueue'
import RteRegister from '@/components/fees/reports/RteRegister'
import { gradeLabel } from '@/lib/grades'
import { exportRows } from '@/lib/feeExports'
import { fetchProfileList, type ProfileListRow } from '@/lib/fees/invoices'
import { monthLabel, sessionMonths } from '@/lib/fees/grid'
import {
  fetchAudit, fetchCollectionByHead, fetchConcessionSummary, fetchRefunds, fetchRteRegister,
  fetchStaffCollection, namesFor,
  type AuditRow, type ConcessionSummaryRow, type HeadCollection, type HeadMonth,
  type RefundRow, type RteRow, type StaffCollectionRow,
} from '@/lib/fees/reports'

/** The one hue the charts use: dark bronze, with a light step of it for the track. */
const INK = '#6B5536'
const TRACK = '#E9E2D4'

/** ₹ in the Indian short forms a chart axis can afford: 4.5K, 1.2L, 2.3Cr. */
function compactINR(n: number): string {
  const a = Math.abs(n)
  const fmt = (v: number) => (v >= 10 ? Math.round(v).toString() : v.toFixed(1).replace(/\.0$/, ''))
  if (a >= 1e7) return `₹${fmt(n / 1e7)}Cr`
  if (a >= 1e5) return `₹${fmt(n / 1e5)}L`
  if (a >= 1e3) return `₹${fmt(n / 1e3)}K`
  return `₹${Math.round(n)}`
}

/** A clean axis top: 1, 2 or 5 times a power of ten, at or above the peak. */
function niceMax(v: number): number {
  if (v <= 0) return 1
  const p = Math.pow(10, Math.floor(Math.log10(v)))
  const m = v / p
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p
}

type More = 'concessions' | 'staff' | 'refunds' | 'rte' | 'audit'

const MORE: { key: More; label: string; subtitle: string; icon: LucideIcon }[] = [
  { key: 'concessions', label: 'Concessions', subtitle: 'What was given up this session, and what fines and late fees brought back', icon: BadgePercent },
  { key: 'staff',       label: 'Collected by staff', subtitle: 'For reconciling a cash box, month by month', icon: UsersRound },
  { key: 'refunds',     label: 'Refunds',     subtitle: 'Requested, approved and paid out', icon: Undo2 },
  { key: 'rte',         label: 'RTE register', subtitle: 'Claims made to the state and what came back', icon: Building2 },
  { key: 'audit',       label: 'Audit trail', subtitle: 'Everything that happened, newest first', icon: ScrollText },
]

interface ClassRow {
  key: string; grade: number | null; section: string | null
  students: number; unpaid: number; overdue: number
  billed: number; paid: number; owing: number
}

export default function ReportsSection() {
  const { year } = useAcademicYear()
  const perms = useFeePermissions()
  const showAmounts = !perms.amountsHidden

  const [heads, setHeads] = useState<HeadCollection[]>([])
  const [monthRows, setMonthRows] = useState<HeadMonth[]>([])
  const [roster, setRoster] = useState<ProfileListRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [hoverHead, setHoverHead] = useState<string | null>(null)
  const [pinnedHead, setPinnedHead] = useState<string | null>(null)
  const [hoverMonth, setHoverMonth] = useState<string | null>(null)
  const [more, setMore] = useState<More | null>(null)

  const load = useCallback(async () => {
    if (!year) return
    setLoading(true); setError(null)
    try {
      const [byHead, list] = await Promise.all([fetchCollectionByHead(year.id), fetchProfileList(year.id)])
      setHeads(byHead.heads); setMonthRows(byHead.months); setRoster(list)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the reports.')
    } finally {
      setLoading(false)
    }
  }, [year])

  useEffect(() => { void load() }, [load])

  const months = useMemo(() => (year ? sessionMonths(year.starts_on, year.ends_on) : []), [year])
  const head = hoverHead ?? pinnedHead
  const headName = head ? heads.find(h => h.key === head)?.name ?? 'This fee' : null

  const series = useMemo(() => months.map(m => {
    const rows = monthRows.filter(r => r.month.slice(0, 7) === m.slice(0, 7))
    const total = rows.reduce((a, r) => a + (r.collected ?? 0), 0)
    const part = head ? rows.filter(r => r.head === head).reduce((a, r) => a + (r.collected ?? 0), 0) : total
    return { month: m, total, part }
  }), [months, monthRows, head])

  const totalCollected = heads.reduce((a, h) => a + (h.collected ?? 0), 0)
  const focusTotal = head ? heads.find(h => h.key === head)?.collected ?? 0 : totalCollected
  const peak = niceMax(Math.max(0, ...series.map(s => s.total)))
  const shown = hoverMonth ? series.find(s => s.month === hoverMonth) : null

  /** Every class with a bill, from the same roster the Students tab reads. */
  const classes = useMemo(() => {
    const m = new Map<string, ClassRow>()
    for (const r of roster) {
      if ((r.billed ?? 0) === 0 && r.overdue_bills === 0 && r.billed !== null) continue
      const sec = (r.section ?? '').trim().toUpperCase() || null
      const key = `${r.grade ?? 'x'}|${sec ?? ''}`
      const c = m.get(key) ?? { key, grade: r.grade, section: sec, students: 0, unpaid: 0, overdue: 0, billed: 0, paid: 0, owing: 0 }
      c.students += 1
      if ((r.outstanding ?? 0) > 0) c.unpaid += 1
      if (r.overdue_bills > 0) c.overdue += 1
      c.billed += r.billed ?? 0; c.paid += r.paid ?? 0; c.owing += r.outstanding ?? 0
      m.set(key, c)
    }
    return [...m.values()].sort((a, b) => (a.grade ?? 99) - (b.grade ?? 99) || (a.section ?? '').localeCompare(b.section ?? ''))
  }, [roster])

  const all = classes.reduce((t, c) => ({
    students: t.students + c.students, unpaid: t.unpaid + c.unpaid, overdue: t.overdue + c.overdue,
    billed: t.billed + c.billed, paid: t.paid + c.paid, owing: t.owing + c.owing,
  }), { students: 0, unpaid: 0, overdue: 0, billed: 0, paid: 0, owing: 0 })

  if (perms.loading) return <div className="p-10 flex justify-center"><Loader2 className="animate-spin text-slate-400" /></div>
  if (!perms.can('fees.reports.view')) return <NoAccess what="see the fee reports" />

  const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0)
  const th = 'px-2.5 py-1.5 text-[11.5px] font-medium text-slate-500 border-b border-r border-[#E4DFD4] last:border-r-0 whitespace-nowrap'
  const td = 'px-2.5 py-1.5 border-b border-r border-[#EEEAE1] last:border-r-0 tabular-nums whitespace-nowrap'

  return (
    <div className="space-y-4 sm:space-y-5">
      {perms.amountsHidden && (
        <Notice>Amounts are hidden for your account, so the chart is empty. The counts are complete.</Notice>
      )}
      {error && <Notice tone="error">{error}</Notice>}

      {/* ── Collection by month, by fee ───────────────────────────────── */}
      <FeeDeck title="Collection by month" icon={BarChart3}>
        {loading ? (
          <div className="fx-card py-20 flex justify-center"><Loader2 className="animate-spin text-slate-400" /></div>
        ) : (
          <div className="grid gap-2.5 sm:gap-3 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)] items-start">
            <div className="fx-card p-3.5 sm:p-4 min-w-0">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 mb-3">
                <p className="text-[13px] font-semibold text-slate-900 break-words">
                  {headName ?? 'All fees'}
                  <span className="font-normal text-slate-500"> · {shown ? monthLabel(shown.month) : `session ${year?.code ?? ''}`}</span>
                </p>
                <p className="font-display text-[1.35rem] font-bold tabular-nums text-slate-900">
                  {inr(shown ? shown.part : focusTotal, showAmounts)}
                </p>
              </div>
              <MonthBars series={series} peak={peak} focused={!!head} hoverMonth={hoverMonth}
                         onHover={setHoverMonth} showAmounts={showAmounts} />
              <p className="mt-2.5 text-[11.5px] text-slate-500 leading-snug">
                Money received against bills, by the month it came in.
                {head ? ' The light bars are every fee together.' : ' Point at a fee to see its months.'}
              </p>
            </div>

            <div className="fx-card min-w-0">
              <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-[#EEEAE1]">
                <h3 className="text-[13px] font-semibold text-slate-900">By fee <span className="font-normal text-slate-400">{heads.length}</span></h3>
                {pinnedHead ? (
                  <button onClick={() => setPinnedHead(null)} className="text-[12px] font-semibold text-[#8B6F47] hover:text-[#5E4A2F]">
                    Show all fees
                  </button>
                ) : <span className="text-[11.5px] text-slate-500">Share of collection</span>}
              </div>
              {heads.length === 0 ? (
                <Empty>Nothing has been billed this session yet.</Empty>
              ) : (
                // A school can have many heads, so the list keeps a fixed
                // height and scrolls inside itself.
                <ul onMouseLeave={() => setHoverHead(null)} className="max-h-[288px] overflow-y-auto overscroll-auto">
                  {heads.map(h => {
                    const share = totalCollected > 0 ? (h.collected ?? 0) / totalCollected : 0
                    const on = head === h.key
                    return (
                      <li key={h.key}>
                        <button
                          type="button"
                          onMouseEnter={() => setHoverHead(h.key)}
                          onFocus={() => setHoverHead(h.key)}
                          onBlur={() => setHoverHead(null)}
                          onClick={() => setPinnedHead(p => (p === h.key ? null : h.key))}
                          aria-pressed={pinnedHead === h.key}
                          className={`w-full text-left px-3 py-1.5 border-b border-[#F2EEE6] last:border-b-0 transition-colors focus-visible:outline-none ${
                            on ? 'bg-[#F7F2E7]' : 'hover:bg-[#FBF8F2]'}`}
                        >
                          <span className="flex items-baseline justify-between gap-3">
                            <span className={`text-[12.5px] leading-snug break-words min-w-0 ${on ? 'font-semibold text-slate-900' : 'text-slate-800'}`}>{h.name}</span>
                            <span className="text-[12.5px] font-semibold tabular-nums text-slate-900 flex-shrink-0">{inr(h.collected, showAmounts)}</span>
                          </span>
                          <span className="mt-1 flex items-center gap-2">
                            <span className="flex-1 h-[4px] rounded-full overflow-hidden" style={{ background: TRACK }}>
                              <span className="block h-full rounded-full" style={{ width: `${Math.max(share * 100, share > 0 ? 2 : 0)}%`, background: INK }} />
                            </span>
                            <span className="text-[11px] tabular-nums text-slate-500 flex-shrink-0">
                              {Math.round(share * 100)}% · {pct(h.collected ?? 0, h.billed ?? 0)}% of {inr(h.billed, showAmounts)}
                            </span>
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </div>
        )}
      </FeeDeck>

      {/* ── Class-wise overdue, as a sheet ─────────────────────────────── */}
      <FeeDeck
        title="Class-wise overdue"
        icon={UsersRound}
        actions={classes.length > 0 ? (
          <button onClick={() => void exportRows(
                    classes.map(c => ({
                      Class: c.grade === null ? 'No class' : `${gradeLabel(c.grade)}${c.section ? ` ${c.section}` : ''}`,
                      Students: c.students, 'Not fully paid': c.unpaid, Overdue: c.overdue,
                      Billed: showAmounts ? c.billed : '••••', Collected: showAmounts ? c.paid : '••••', Owing: showAmounts ? c.owing : '••••',
                    })), 'Class-wise overdue', 'fees-class-wise-overdue')}
                  className={ADMIN.ghostBtn}>
            <Download size={14} /> Export
          </button>
        ) : undefined}
      >
        {loading ? (
          <div className="fx-card py-12 flex justify-center"><Loader2 className="animate-spin text-slate-400" /></div>
        ) : classes.length === 0 ? (
          <div className="fx-card"><Empty>Nothing has been billed this session yet.</Empty></div>
        ) : (
          <div className="fx-card overflow-x-auto">
            <table className="w-full sm:min-w-[560px] text-[12.5px] border-collapse">
              <thead className="bg-[#F7F5F0] text-left">
                <tr>
                  <th className={th}>Class</th>
                  <th className={`${th} text-right`}><span className="sm:hidden">Unpaid</span><span className="max-sm:hidden">Not fully paid</span></th>
                  <th className={`${th} text-right max-sm:hidden`}>Overdue</th>
                  <th className={`${th} text-right`}>Collected</th>
                  <th className={`${th} text-right max-sm:hidden`}>Owing</th>
                </tr>
              </thead>
              <tbody>
                {classes.map(c => (
                  <tr key={c.key} className="hover:bg-[#FBF8F2]">
                    <td className={`${td} font-semibold text-slate-900`}>
                      {c.grade === null ? 'No class' : `${gradeLabel(c.grade)}${c.section ? ` ${c.section}` : ''}`}
                    </td>
                    <td className={`${td} text-right`}>
                      <b className={c.unpaid > 0 ? 'text-[#8A6A12]' : 'text-slate-400'}>{c.unpaid}</b>
                      <span className="text-slate-400"> of {c.students}</span>
                    </td>
                    <td className={`${td} max-sm:hidden text-right ${c.overdue > 0 ? 'text-[#A93232] font-semibold' : 'text-slate-400'}`}>{c.overdue}</td>
                    <td className={`${td} text-right`}>
                      <b className="text-slate-900">{inr(c.paid, showAmounts)}</b>
                      <span className="text-slate-400 max-sm:block"> of {inr(c.billed, showAmounts)} · {pct(c.paid, c.billed)}%</span>
                    </td>
                    <td className={`${td} max-sm:hidden text-right font-semibold ${c.owing > 0 ? 'text-[#8A6A12]' : 'text-slate-400'}`}>{inr(c.owing, showAmounts)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-[#F7F5F0] font-semibold">
                <tr>
                  <td className={`${td} text-slate-900`}>All classes</td>
                  <td className={`${td} text-right`}>{all.unpaid}<span className="text-slate-400 font-normal"> of {all.students}</span></td>
                  <td className={`${td} max-sm:hidden text-right text-[#A93232]`}>{all.overdue}</td>
                  <td className={`${td} text-right`}>{inr(all.paid, showAmounts)}<span className="text-slate-400 font-normal max-sm:block"> of {inr(all.billed, showAmounts)} · {pct(all.paid, all.billed)}%</span></td>
                  <td className={`${td} max-sm:hidden text-right text-[#8A6A12]`}>{inr(all.owing, showAmounts)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </FeeDeck>

      {/* ── Everything else, one button each ─────────────────────────── */}
      <div>
        <p className="text-[12.5px] text-slate-500 mb-2">More reports</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          {MORE.filter(m => m.key !== 'audit' || perms.can('fees.audit.view')).map(m => (
            <button key={m.key} onClick={() => setMore(m.key)}
                    className="fx-tile flex items-center gap-2.5 p-2.5 text-left min-w-0 hover:-translate-y-px transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B8983C]/60">
              <span className="icon-chip w-8 h-8 flex-shrink-0" style={{ background: 'linear-gradient(135deg, #3D3B40, #8B6F47)' }}>
                <m.icon size={15} className="relative z-10 text-white" />
              </span>
              <span className="text-[13px] font-semibold text-slate-900 leading-snug break-words min-w-0">{m.label}</span>
            </button>
          ))}
        </div>
      </div>

      {more && year && (
        <ModalShell
          onClose={() => setMore(null)}
          sharp
          size={more === 'staff' || more === 'concessions' ? 'xl' : '2xl'}
          title={MORE.find(m => m.key === more)!.label}
          subtitle={MORE.find(m => m.key === more)!.subtitle}
          icon={React.createElement(MORE.find(m => m.key === more)!.icon, { size: 16 })}
          iconClassName={FEE_ICON}
        >
          <MoreReport kind={more} yearId={year.id} showAmounts={showAmounts} />
        </ModalShell>
      )}
    </div>
  )
}

// ── The month chart ───────────────────────────────────────────────────────

function MonthBars({ series, peak, focused, hoverMonth, onHover, showAmounts }: {
  series: { month: string; total: number; part: number }[]
  peak: number
  focused: boolean
  hoverMonth: string | null
  onHover: (m: string | null) => void
  showAmounts: boolean
}) {
  const H = 176
  const best = series.reduce((a, s) => (s.part > a.part ? s : a), series[0] ?? { month: '', total: 0, part: 0 })
  return (
    <div className="relative" onMouseLeave={() => onHover(null)}>
      <div className="absolute inset-x-0 top-0 pointer-events-none" style={{ height: H }}>
        {[1, 0.5, 0].map(f => (
          <div key={f} className="absolute inset-x-0 flex items-center gap-1.5" style={{ top: (1 - f) * H - 6 }}>
            <span className="w-9 text-right text-[10.5px] text-slate-400 tabular-nums">{showAmounts ? compactINR(peak * f) : ''}</span>
            <span className={`flex-1 h-px ${f === 0 ? 'bg-slate-300' : 'bg-[#EEEAE1]'}`} />
          </div>
        ))}
      </div>

      <div className="relative pl-[2.6rem] flex items-end gap-[2px]" style={{ height: H }}>
        {series.map(s => {
          const tot = peak > 0 ? (s.total / peak) * H : 0
          const part = peak > 0 ? (s.part / peak) * H : 0
          const on = hoverMonth === s.month
          return (
            <button
              key={s.month}
              type="button"
              onMouseEnter={() => onHover(s.month)}
              onFocus={() => onHover(s.month)}
              onBlur={() => onHover(null)}
              onClick={() => onHover(on ? null : s.month)}
              aria-label={`${monthLabel(s.month)}: ${showAmounts ? inr(s.part) : 'hidden'}`}
              className="relative flex-1 min-w-0 h-full flex items-end justify-center focus-visible:outline-none"
            >
              <span className={`absolute inset-0 transition-colors ${on ? 'bg-[#B8983C]/[.07]' : ''}`} />
              {focused && tot > 0 && (
                <span className="absolute bottom-0 w-full max-w-[24px] rounded-t-[4px]" style={{ height: tot, background: TRACK }} />
              )}
              <span className="relative w-full max-w-[24px] rounded-t-[4px] transition-[height] duration-300 ease-out"
                    style={{ height: Math.max(part, s.part > 0 ? 2 : 0), background: INK, opacity: hoverMonth && !on ? 0.55 : 1 }} />
              {showAmounts && s.month === best.month && best.part > 0 && !hoverMonth && (
                <span className="absolute left-1/2 -translate-x-1/2 text-[10.5px] font-semibold text-slate-700 tabular-nums whitespace-nowrap"
                      style={{ bottom: Math.max(focused ? tot : part, part, 2) + 3 }}>
                  {compactINR(s.part)}
                </span>
              )}
            </button>
          )
        })}
      </div>

      <div className="pl-[2.6rem] mt-1.5 flex gap-[2px]">
        {series.map(s => (
          <span key={s.month} className={`flex-1 min-w-0 text-center text-[10.5px] leading-none ${hoverMonth === s.month ? 'text-slate-900 font-semibold' : 'text-slate-500'}`}>
            {monthLabel(s.month, false).slice(0, 3)}
          </span>
        ))}
      </div>
    </div>
  )
}

// ── The reports behind a button ───────────────────────────────────────────

function MoreReport({ kind, yearId, showAmounts }: { kind: More; yearId: string; showAmounts: boolean }) {
  const perms = useFeePermissions()
  const [concessions, setConcessions] = useState<ConcessionSummaryRow[]>([])
  const [staff, setStaff] = useState<StaffCollectionRow[]>([])
  const [refunds, setRefunds] = useState<RefundRow[]>([])
  const [rte, setRte] = useState<RteRow[]>([])
  const [audit, setAudit] = useState<AuditRow[]>([])
  const [names, setNames] = useState<Map<string, string>>(new Map())
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      if (kind === 'concessions') setConcessions(await fetchConcessionSummary(yearId))
      if (kind === 'staff') setStaff(await fetchStaffCollection(yearId))
      if (kind === 'refunds' || kind === 'rte' || kind === 'audit') {
        const rows = kind === 'refunds' ? await fetchRefunds(yearId)
          : kind === 'rte' ? await fetchRteRegister(yearId)
          : await fetchAudit({ yearId, limit: 200 })
        if (kind === 'refunds') setRefunds(rows as RefundRow[])
        if (kind === 'rte') setRte(rows as RteRow[])
        if (kind === 'audit') setAudit(rows as AuditRow[])
        const ids = [...new Set((rows as { student_id: string | null; actor_id?: string | null }[])
          .flatMap(r => [r.student_id, r.actor_id ?? null]).filter((x): x is string => Boolean(x)))]
        if (ids.length) setNames(await namesFor(ids))
      }
    } finally {
      setLoading(false)
    }
  }, [kind, yearId])

  useEffect(() => { void load() }, [load])

  if (loading) return <div className="py-16 flex justify-center"><Loader2 className="animate-spin text-slate-400" /></div>

  const th = 'px-2.5 py-1.5 text-[11.5px] font-medium text-slate-500 border-b border-[#E4DFD4] whitespace-nowrap'
  const td = 'px-2.5 py-1.5 border-b border-[#F0ECE3] tabular-nums'

  if (kind === 'concessions') {
    const first = concessions[0]
    const total = concessions.reduce((a, r) => a + Number(r.given_up ?? 0), 0)
    return concessions.length === 0 ? <Empty>No concessions this session.</Empty> : (
      <div className="space-y-3">
        <table className="w-full text-[13px]">
          <thead className="bg-[#F7F5F0] text-left">
            <tr><th className={th}>Kind</th><th className={`${th} text-right`}>Grants</th><th className={`${th} text-right`}>Students</th><th className={`${th} text-right`}>Given up</th></tr>
          </thead>
          <tbody>
            {concessions.map(r => (
              <tr key={r.kind}>
                <td className={`${td} capitalize text-slate-900`}>{r.kind}</td>
                <td className={`${td} text-right`}>{r.grants}</td>
                <td className={`${td} text-right`}>{r.students}</td>
                <td className={`${td} text-right font-semibold text-[#1F6B42]`}>{inr(r.given_up, showAmounts)}</td>
              </tr>
            ))}
            <tr className="font-semibold"><td className={td}>All</td><td className={td} /><td className={td} /><td className={`${td} text-right text-[#1F6B42]`}>{inr(total, showAmounts)}</td></tr>
          </tbody>
        </table>
        {first && (
          <p className="text-[12.5px] text-slate-600 leading-relaxed">
            Fines charged {inr(first.fines_charged, showAmounts)}, waived {inr(first.fines_waived, showAmounts)}.
            Late fees charged {inr(first.late_fees_charged, showAmounts)}, waived {inr(first.late_fees_waived, showAmounts)}.
          </p>
        )}
      </div>
    )
  }

  if (kind === 'staff') {
    return staff.length === 0 ? <Empty>Nothing collected yet this session.</Empty> : (
      <table className="w-full text-[13px]">
        <thead className="bg-[#F7F5F0] text-left">
          <tr><th className={th}>Collected by</th><th className={th}>Month</th><th className={`${th} text-right`}>Receipts</th><th className={`${th} text-right`}>Cash</th><th className={`${th} text-right`}>Total</th></tr>
        </thead>
        <tbody>
          {staff.map((r, i) => (
            <tr key={`${r.staff_id}-${r.month}-${i}`}>
              <td className={`${td} text-slate-900`}>{r.staff_name ?? 'Not recorded'}</td>
              <td className={`${td} whitespace-nowrap text-slate-600`}>{monthLabel(r.month)}</td>
              <td className={`${td} text-right text-slate-600`}>{r.receipts}{r.reversed > 0 && <span className="text-[#A93232]"> ({r.reversed} rev.)</span>}</td>
              <td className={`${td} text-right text-slate-600`}>{inr(r.cash, showAmounts)}</td>
              <td className={`${td} text-right font-semibold text-slate-900`}>{inr(r.collected, showAmounts)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    )
  }

  if (kind === 'refunds') {
    return <RefundQueue rows={refunds} names={names} showAmounts={showAmounts}
                        canDecide={perms.can('fees.refund.approve')} onChanged={load} />
  }

  if (kind === 'rte') {
    return <RteRegister rows={rte} names={names} yearId={yearId} showAmounts={showAmounts}
                        canManage={perms.can('fees.rte.manage')} onChanged={load} />
  }

  return audit.length === 0 ? <Empty>Nothing recorded yet this session.</Empty> : (
    <table className="w-full text-[13px]">
      <thead className="bg-[#F7F5F0] text-left">
        <tr><th className={th}>What</th><th className={th}>Who</th><th className={th}>When</th><th className={`${th} text-right`}>Amount</th></tr>
      </thead>
      <tbody>
        {audit.map(r => (
          <tr key={r.id}>
            <td className={`${td} text-slate-900`}>
              {r.student_id ? names.get(r.student_id) ?? 'Student' : 'School'}
              <span className="block text-[11.5px] text-slate-500">{r.action}{r.reason ? ` · ${r.reason}` : ''}</span>
            </td>
            <td className={`${td} text-slate-600`}>{names.get(r.actor_id ?? '') ?? (r.actor_id ? 'Staff' : 'The system')}</td>
            <td className={`${td} whitespace-nowrap text-slate-600`}>{fmtDate(r.created_at.slice(0, 10))}</td>
            <td className={`${td} text-right font-semibold`}>{r.amount === null ? '' : inr(r.amount, showAmounts)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
