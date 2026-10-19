'use client'

// ─────────────────────────────────────────────────────────────────────────────
// Reports.
//
// One question first: what came in, month by month, and from which fees. The
// month chart and the fee-head list are one instrument — point at a fee head
// and the months redraw as that head's collection; point away and they are the
// whole school's again. On a phone a tap pins a head.
//
// Under it, where money is stuck: what each class still owes, with a reminder
// a press away. Everything else — payment modes, who collected what, cheques,
// refunds, the RTE register, the audit trail — is one button each, opened when
// it is wanted rather than scrolled past every time.
//
// Finding a particular bill is the Bills tab's job, so there is no search here.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  BarChart3, Building2, Download, Landmark, Loader2, ScrollText, Send, Undo2, UsersRound, Wallet,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useAcademicYear } from '@/contexts/AcademicYearContext'
import { useFeePermissions } from '@/hooks/useFeePermissions'
import ModalShell from '@/components/ui/ModalShell'
import { ADMIN, FEE_ICON, fmtDate, inr } from '@/components/fees/ui'
import { CELL, Col, Empty, List, ListHead, Notice, Row, Segmented } from '@/components/fees/shell'
import { FeeDeck } from '@/components/fees/glass'
import NoAccess from '@/components/fees/NoAccess'
import RefundQueue from '@/components/fees/reports/RefundQueue'
import RteRegister from '@/components/fees/reports/RteRegister'
import { gradeLabel } from '@/lib/grades'
import { exportRows } from '@/lib/feeExports'
import { sendReminders } from '@/lib/fees/charges'
import { fetchUnpaidInvoices } from '@/lib/fees/invoices'
import { monthLabel, sessionMonths } from '@/lib/fees/grid'
import { MODE_LABEL, modeOf } from '@/lib/fees/bills'
import {
  fetchAudit, fetchCollectionByHead, fetchCollectionDaily, fetchDefaultersByClass,
  fetchInstrumentPipeline, fetchRefunds, fetchRteRegister, fetchStaffCollection, namesFor,
  type AuditRow, type CollectionDayRow, type DefaulterClassRow, type HeadCollection, type HeadMonth,
  type InstrumentPipelineRow, type RefundRow, type RteRow, type StaffCollectionRow,
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

type More = 'modes' | 'staff' | 'cheques' | 'refunds' | 'rte' | 'audit'

const MORE: { key: More; label: string; subtitle: string; icon: LucideIcon }[] = [
  { key: 'modes',   label: 'Payment modes',     subtitle: 'How families paid this session', icon: Wallet },
  { key: 'staff',   label: 'Collected by staff', subtitle: 'For reconciling a cash box, month by month', icon: UsersRound },
  { key: 'cheques', label: 'Cheques',           subtitle: 'Cheques and drafts, from in hand to cleared', icon: Landmark },
  { key: 'refunds', label: 'Refunds',           subtitle: 'Requested, approved and paid out', icon: Undo2 },
  { key: 'rte',     label: 'RTE register',      subtitle: 'Claims made to the state and what came back', icon: Building2 },
  { key: 'audit',   label: 'Audit trail',       subtitle: 'Everything that happened, newest first', icon: ScrollText },
]

export default function ReportsSection() {
  const { year } = useAcademicYear()
  const perms = useFeePermissions()
  const showAmounts = !perms.amountsHidden

  const [heads, setHeads] = useState<HeadCollection[]>([])
  const [monthRows, setMonthRows] = useState<HeadMonth[]>([])
  const [classes, setClasses] = useState<DefaulterClassRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [hoverHead, setHoverHead] = useState<string | null>(null)
  const [pinnedHead, setPinnedHead] = useState<string | null>(null)
  const [hoverMonth, setHoverMonth] = useState<string | null>(null)
  const [view, setView] = useState<'chart' | 'table'>('chart')
  const [more, setMore] = useState<More | null>(null)
  const [reminding, setReminding] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!year) return
    setLoading(true); setError(null)
    try {
      const [byHead, cls] = await Promise.all([
        fetchCollectionByHead(year.id),
        fetchDefaultersByClass(year.id),
      ])
      setHeads(byHead.heads); setMonthRows(byHead.months); setClasses(cls)
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

  /** Collected per month: the whole school, and the focused head if any. */
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

  /** Remind every family in one class with something overdue. */
  const remindClass = async (row: DefaulterClassRow) => {
    if (!year) return
    const key = `${row.grade}-${row.section}`
    setReminding(key); setNote(null); setError(null)
    try {
      const { supabase } = await import('@/lib/supabase')
      let q = supabase.from('profiles').select('id').eq('role', 'student').eq('grade', row.grade)
      if (row.section) q = q.eq('section', row.section)
      const [{ data }, unpaid] = await Promise.all([q, fetchUnpaidInvoices(year.id)])
      const ids = new Set((data ?? []).map(r => (r as { id: string }).id))
      const bills = unpaid.filter(i => ids.has(i.student_id)).map(i => i.id)
      if (bills.length === 0) { setNote('Nothing to remind about in that class.'); return }
      const result = await sendReminders(bills, 'fee_reminder_overdue')
      setNote(`${result.queued} reminder${result.queued === 1 ? '' : 's'} queued for ${gradeLabel(row.grade)}${row.section ? ` ${row.section}` : ''}.`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Those reminders were not queued.')
    } finally {
      setReminding(null)
    }
  }

  if (perms.loading) return <div className="p-10 flex justify-center"><Loader2 className="animate-spin text-slate-400" /></div>
  if (!perms.can('fees.reports.view')) return <NoAccess what="see the fee reports" />

  const classesSorted = [...classes].sort((a, b) => Number(b.outstanding ?? 0) - Number(a.outstanding ?? 0)
    || b.students_owing - a.students_owing)

  return (
    <div className="space-y-4 sm:space-y-5">
      {perms.amountsHidden && (
        <Notice>Amounts are hidden for your account, so the charts are empty. The counts below are complete.</Notice>
      )}
      {error && <Notice tone="error">{error}</Notice>}
      {note && <Notice tone="good">{note}</Notice>}

      {/* ── Collection by month, by fee ───────────────────────────────── */}
      <FeeDeck
        title="Collection by month"
        icon={BarChart3}
        actions={<Segmented<'chart' | 'table'> size="sm" value={view} onChange={setView}
                   options={[{ key: 'chart', label: 'Chart' }, { key: 'table', label: 'Table' }]} />}
      >
        {loading ? (
          <div className="fx-card py-20 flex justify-center"><Loader2 className="animate-spin text-slate-400" /></div>
        ) : (
          <div className="grid gap-2.5 sm:gap-3 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] items-start">
            {/* The months */}
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

              {view === 'chart' ? (
                <MonthBars series={series} peak={peak} focused={!!head} hoverMonth={hoverMonth}
                           onHover={setHoverMonth} showAmounts={showAmounts} />
              ) : (
                <div className="max-h-[300px] overflow-y-auto">
                  <table className="w-full text-[13px]">
                    <thead>
                      <tr className="text-left text-[11.5px] text-slate-500">
                        <th className="font-medium py-1.5">Month</th>
                        {head && <th className="font-medium py-1.5 text-right">{headName}</th>}
                        <th className="font-medium py-1.5 text-right">All fees</th>
                      </tr>
                    </thead>
                    <tbody>
                      {series.map(s => (
                        <tr key={s.month} className="border-t border-[#F0ECE3]">
                          <td className="py-1.5 text-slate-700">{monthLabel(s.month)}</td>
                          {head && <td className="py-1.5 text-right tabular-nums font-semibold text-slate-900">{inr(s.part, showAmounts)}</td>}
                          <td className="py-1.5 text-right tabular-nums text-slate-600">{inr(s.total, showAmounts)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="mt-2.5 text-[11.5px] text-slate-500 leading-snug">
                Money received against bills, by the month it came in.
                {head ? ' The light bars are every fee together.' : ' Point at a fee to see its months.'}
              </p>
            </div>

            {/* The fees */}
            <div className="fx-card min-w-0">
              <div className="flex items-center justify-between gap-2 px-3.5 pt-3 pb-2 border-b border-[#EEEAE1]">
                <h3 className="text-[13px] font-semibold text-slate-900">By fee</h3>
                {pinnedHead ? (
                  <button onClick={() => setPinnedHead(null)} className="text-[12px] font-semibold text-[#8B6F47] hover:text-[#5E4A2F]">
                    Show all fees
                  </button>
                ) : (
                  <span className="text-[11.5px] text-slate-500">Share of collection</span>
                )}
              </div>
              {heads.length === 0 ? (
                <Empty>Nothing has been billed this session yet.</Empty>
              ) : (
                <ul onMouseLeave={() => setHoverHead(null)}>
                  {heads.map(h => {
                    const share = totalCollected > 0 ? (h.collected ?? 0) / totalCollected : 0
                    const rate = (h.billed ?? 0) > 0 ? Math.round(((h.collected ?? 0) / (h.billed ?? 1)) * 100) : null
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
                          className={`w-full text-left px-3.5 py-2.5 border-b border-[#F2EEE6] last:border-b-0 transition-colors
                                      focus-visible:outline-none ${on ? 'bg-[#F7F2E7]' : 'hover:bg-[#FBF8F2]'}`}
                        >
                          <span className="flex items-baseline justify-between gap-3">
                            <span className={`text-[13.5px] leading-snug break-words min-w-0 ${on ? 'font-semibold text-slate-900' : 'text-slate-800'}`}>
                              {h.name}
                            </span>
                            <span className="text-[13.5px] font-bold tabular-nums text-slate-900 flex-shrink-0">
                              {inr(h.collected, showAmounts)}
                            </span>
                          </span>
                          <span className="mt-1.5 flex items-center gap-2.5">
                            <span className="flex-1 h-[6px] rounded-full overflow-hidden" style={{ background: TRACK }}>
                              <span className="block h-full rounded-full" style={{ width: `${Math.max(share * 100, share > 0 ? 2 : 0)}%`, background: INK }} />
                            </span>
                            <span className="text-[11.5px] tabular-nums text-slate-500 w-[2.6rem] text-right flex-shrink-0">
                              {Math.round(share * 100)}%
                            </span>
                          </span>
                          <span className="block mt-1 text-[11.5px] text-slate-500 leading-snug">
                            {inr(h.billed, showAmounts)} billed{rate !== null && showAmounts ? ` · ${rate}% collected` : ''}
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

      {/* ── Where money is stuck ──────────────────────────────────────── */}
      <FeeDeck
        title="Still owed, by class"
        icon={UsersRound}
        actions={classesSorted.length > 0 ? (
          <button onClick={() => void exportRows(
                    classesSorted.map(r => ({
                      Class: `${gradeLabel(r.grade)}${r.section ?? ''}`,
                      'Students owing': r.students_owing,
                      Bills: r.bills,
                      'Most days late': r.worst_days_late ?? 0,
                      Owing: showAmounts && r.outstanding !== null ? Number(r.outstanding) : '••••',
                    })), 'Owed by class', 'fees-owed-by-class')}
                  className={ADMIN.ghostBtn}>
            <Download size={14} /> Export
          </button>
        ) : undefined}
      >
        {loading ? (
          <div className="fx-card py-12 flex justify-center"><Loader2 className="animate-spin text-slate-400" /></div>
        ) : classesSorted.length === 0 ? (
          <div className="fx-card"><Empty>Nothing is owed. Every bill this session is settled.</Empty></div>
        ) : (
          <List className="!mx-0 sm:!mx-0 max-sm:!border-x">
            <ListHead cols="sm:grid-cols-[minmax(0,120px)_minmax(0,1fr)_120px_128px]">
              <Col>Class</Col><Col>Owing</Col><Col right>Amount</Col><Col right>&nbsp;</Col>
            </ListHead>
            {classesSorted.map(r => {
              const key = `${r.grade}-${r.section}`
              return (
                <Row key={key} cols="sm:grid-cols-[minmax(0,120px)_minmax(0,1fr)_120px_128px]">
                  <span className={`${CELL.A1} text-[13.5px] font-semibold text-slate-900`}>
                    {gradeLabel(r.grade)}{r.section ? ` ${r.section}` : ''}
                  </span>
                  <span className={`${CELL.A2} text-[12px] text-slate-500 leading-snug`}>
                    {r.students_owing} student{r.students_owing === 1 ? '' : 's'} · {r.bills} bill{r.bills === 1 ? '' : 's'}
                    {r.worst_days_late !== null && r.worst_days_late > 0 ? ` · up to ${r.worst_days_late} days late` : ''}
                  </span>
                  <span className={`${CELL.B1} text-right text-[13.5px] font-bold tabular-nums text-[#8A6A12]`}>
                    {inr(r.outstanding, showAmounts)}
                  </span>
                  <span className={`${CELL.B2} flex justify-end`}>
                    {perms.can('fees.reminder.send') && (
                      <button onClick={() => void remindClass(r)} disabled={reminding === key}
                              className={`${ADMIN.ghostBtn} !h-7 !px-2.5 !text-[12px]`}>
                        {reminding === key ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} Remind
                      </button>
                    )}
                  </span>
                </Row>
              )
            })}
          </List>
        )}
      </FeeDeck>

      {/* ── Everything else, one button each ─────────────────────────── */}
      <div>
        <p className="text-[12.5px] text-slate-500 mb-2">More reports</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
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
          sharp size="2xl"
          title={MORE.find(m => m.key === more)!.label}
          subtitle={MORE.find(m => m.key === more)!.subtitle}
          icon={React.createElement(MORE.find(m => m.key === more)!.icon, { size: 16 })}
          iconClassName={FEE_ICON}
          minHClass="sm:min-h-[28rem]"
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
      {/* Gridlines and their values: the top, the middle and the floor. */}
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
              className="relative flex-1 min-w-0 h-full flex items-end justify-center focus-visible:outline-none group"
            >
              <span className={`absolute inset-0 transition-colors ${on ? 'bg-[#B8983C]/[.07]' : ''}`} />
              {/* The whole school, as a light track behind a focused fee. */}
              {focused && tot > 0 && (
                <span className="absolute bottom-0 w-full max-w-[24px] rounded-t-[4px]" style={{ height: tot, background: TRACK }} />
              )}
              <span className="relative w-full max-w-[24px] rounded-t-[4px] transition-[height] duration-300 ease-out"
                    style={{ height: Math.max(part, s.part > 0 ? 2 : 0), background: INK, opacity: hoverMonth && !on ? 0.55 : 1 }} />
              {/* The one value printed on the chart: the best month. */}
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
  const [daily, setDaily] = useState<CollectionDayRow[]>([])
  const [staff, setStaff] = useState<StaffCollectionRow[]>([])
  const [pipeline, setPipeline] = useState<InstrumentPipelineRow[]>([])
  const [refunds, setRefunds] = useState<RefundRow[]>([])
  const [rte, setRte] = useState<RteRow[]>([])
  const [audit, setAudit] = useState<AuditRow[]>([])
  const [names, setNames] = useState<Map<string, string>>(new Map())
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      if (kind === 'modes') setDaily(await fetchCollectionDaily(yearId))
      if (kind === 'staff') setStaff(await fetchStaffCollection(yearId))
      if (kind === 'cheques') setPipeline(await fetchInstrumentPipeline(yearId))
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

  if (kind === 'modes') {
    const by = new Map<string, { receipts: number; collected: number | null }>()
    for (const r of daily) {
      const k = MODE_LABEL[modeOf(r.method)]
      const seen = by.get(k) ?? { receipts: 0, collected: null }
      by.set(k, {
        receipts: seen.receipts + r.receipts,
        collected: r.collected === null ? seen.collected : (seen.collected ?? 0) + Number(r.collected),
      })
    }
    const list = [...by.entries()].sort((a, b) => (b[1].collected ?? 0) - (a[1].collected ?? 0))
    const total = list.reduce((a, [, v]) => a + (v.collected ?? 0), 0)
    return list.length === 0 ? <Empty>Nothing collected yet this session.</Empty> : (
      <div className="divide-y divide-[#F0ECE3]">
        {list.map(([mode, v]) => {
          const share = total > 0 ? (v.collected ?? 0) / total : 0
          return (
            <div key={mode} className="py-2.5">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[13.5px] text-slate-900">{mode}</span>
                <span className="text-[13.5px] font-bold tabular-nums text-slate-900">{inr(v.collected, showAmounts)}</span>
              </div>
              <div className="mt-1.5 flex items-center gap-2.5">
                <span className="flex-1 h-[6px] rounded-full overflow-hidden" style={{ background: TRACK }}>
                  <span className="block h-full rounded-full" style={{ width: `${share * 100}%`, background: INK }} />
                </span>
                <span className="text-[11.5px] text-slate-500 tabular-nums flex-shrink-0">
                  {v.receipts} receipt{v.receipts === 1 ? '' : 's'}
                </span>
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  if (kind === 'staff') {
    const cols = 'sm:grid-cols-[minmax(0,1fr)_110px_120px_120px]'
    return staff.length === 0 ? <Empty>Nothing collected yet this session.</Empty> : (
      <List className="!mx-0 sm:!mx-0 max-sm:!border-x">
        <ListHead cols={cols}><Col>Collected by</Col><Col>Month</Col><Col right>Cash</Col><Col right>Total</Col></ListHead>
        {staff.map((r, i) => (
          <Row key={`${r.staff_id}-${r.month}-${i}`} cols={cols}>
            <span className={`${CELL.A1} text-[13.5px] text-slate-900 break-words`}>{r.staff_name ?? 'Not recorded'}</span>
            <span className={`${CELL.A2} text-[12px] text-slate-500`}>
              {monthLabel(r.month)} · {r.receipts} receipt{r.receipts === 1 ? '' : 's'}
              {r.reversed > 0 && <span className="text-[#A93232]"> · {r.reversed} reversed</span>}
            </span>
            <span className={`${CELL.B2} text-right text-[12px] text-slate-500 tabular-nums`}>
              {inr(r.cash, showAmounts)}<span className="sm:hidden"> cash</span>
            </span>
            <span className={`${CELL.B1} text-right text-[13.5px] font-bold tabular-nums text-slate-900`}>{inr(r.collected, showAmounts)}</span>
          </Row>
        ))}
      </List>
    )
  }

  if (kind === 'cheques') {
    const STATE: Record<string, string> = {
      received: 'In hand', deposited: 'At the bank', cleared: 'Cleared', bounced: 'Bounced', cancelled: 'Cancelled',
    }
    const stuck = pipeline.reduce((a, r) => a + r.overdue_to_present, 0)
    return pipeline.length === 0 ? <Empty>No cheques or drafts this session.</Empty> : (
      <div className="space-y-3">
        {stuck > 0 && <Notice tone="warn">{stuck} past the day it should have been presented. Open the bill to mark it deposited.</Notice>}
        <List className="!mx-0 sm:!mx-0 max-sm:!border-x">
          {pipeline.map((r, i) => (
            <Row key={`${r.kind}-${r.status}-${i}`} cols="sm:grid-cols-[minmax(0,1fr)_120px_120px]">
              <span className={`${CELL.A1} text-[13.5px] text-slate-900`}>{r.kind === 'dd' ? 'Demand drafts' : 'Cheques'}</span>
              <span className={`${CELL.A2} text-[12px] text-slate-500`}>{STATE[r.status] ?? r.status} · {r.instruments}</span>
              <span className={`${CELL.B1} text-right text-[13.5px] font-bold tabular-nums text-slate-900`}>{inr(r.amount, showAmounts)}</span>
            </Row>
          ))}
        </List>
      </div>
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

  const cols = 'sm:grid-cols-[minmax(0,1fr)_minmax(0,140px)_150px_100px]'
  return audit.length === 0 ? <Empty>Nothing recorded yet this session.</Empty> : (
    <List className="!mx-0 sm:!mx-0 max-sm:!border-x">
      <ListHead cols={cols}><Col>What</Col><Col>Who</Col><Col>When</Col><Col right>Amount</Col></ListHead>
      {audit.map(r => (
        <Row key={r.id} cols={cols}>
          <span className={`${CELL.A1} min-w-0`}>
            <span className="block text-[13px] text-slate-900 break-words">
              {r.student_id ? names.get(r.student_id) ?? 'Student' : 'School'}
              {r.reason ? <span className="text-slate-500"> · {r.reason}</span> : null}
            </span>
            <span className="block text-[11.5px] text-slate-500 break-words">{r.action}</span>
          </span>
          <span className={`${CELL.A2} text-[12px] text-slate-500 break-words`}>
            {names.get(r.actor_id ?? '') ?? (r.actor_id ? 'Staff' : 'The system')}
          </span>
          <span className={`${CELL.B2} text-[12px] text-slate-500 text-right sm:text-left`}>
            {fmtDate(r.created_at.slice(0, 10))}
          </span>
          <span className={`${CELL.B1} text-right text-[13px] font-bold tabular-nums text-slate-900`}>
            {r.amount === null ? '' : inr(r.amount, showAmounts)}
          </span>
        </Row>
      ))}
    </List>
  )
}
