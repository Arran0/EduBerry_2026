'use client'

import React, { useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import {
  AlarmClock, UserX, Timer, ChevronLeft, ChevronRight, FileText, Loader2, Users,
  AlertTriangle, FileSpreadsheet, Download, Eye, CalendarRange,
} from 'lucide-react'
import ModalShell from '@/components/ui/ModalShell'
import { SmartSelect } from '@/components/workspace/ui'
import type { SmartOption } from '@/components/workspace/ui'
import { GBTN, GINPUT } from '@/components/transport/glass'
import { fetchLateSummaryReport, fetchAttendanceTimezone, recomputePendingAttendance } from '@/lib/attendance'
import { fetchTeamStaffById } from '@/lib/teams'
import {
  ReportKind,
  REPORT_MAX_DAYS,
  PREVIEW_ROW_LIMIT,
  PDF_ROW_LIMIT,
  rangeDayCount,
  validateReportRange,
  fetchAbsenceIrregularReport,
  fetchTimeTrackingReport,
} from '@/lib/attendanceReports'
import {
  ReportData,
  StatementSpec,
  REPORT_TITLES,
  reportRowCount,
  estimatePages,
  buildReportSpec,
  downloadReportExcel,
  downloadStatement,
} from './generate'

const ReportPreviewModal = dynamic(() => import('./ReportPreviewModal'), { ssr: false })

interface Props {
  onClose: () => void
  /** The school's "today" — the range may not run past it. */
  todayStr: string
  /** Teams an admin can narrow a document to. */
  teams: { id: string; name: string }[]
}

interface ReportOption {
  kind: ReportKind
  title: string
  detail: string
  icon: typeof AlarmClock
  /** Icon chip gradient, as a Tailwind class. */
  chip: string
}

const OPTIONS: ReportOption[] = [
  {
    kind: 'late',
    title: 'Late summary',
    detail: 'Every late arrival in the range, with how late each one was.',
    icon: AlarmClock,
    chip: 'bg-[linear-gradient(135deg,#CBAB55,#A07F2A)]',
  },
  {
    kind: 'absence',
    title: 'Absence & irregular summary',
    detail: 'Absences, leave, half days and permission breaks — totals per person, then day by day.',
    icon: UserX,
    chip: 'bg-[linear-gradient(135deg,#f4515d,#c22834)]',
  },
  {
    kind: 'time',
    title: 'Time tracking report',
    detail: 'Check-in and check-out times for every staff member on every day you pick.',
    icon: Timer,
    chip: 'bg-[linear-gradient(135deg,#8d9857,#5f6a37)]',
  },
]

function shiftDate(d: string, days: number): string {
  const dt = new Date(d + 'T12:00:00')
  dt.setDate(dt.getDate() + days)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}

function monthStart(d: string): string {
  return `${d.slice(0, 7)}-01`
}

function presets(today: string): { key: string; label: string; start: string; end: string }[] {
  const lastMonthEnd = shiftDate(monthStart(today), -1)
  return [
    { key: 'month', label: 'This month', start: monthStart(today), end: today },
    { key: 'week', label: 'Last 7 days', start: shiftDate(today, -6), end: today },
    { key: 'last', label: 'Last month', start: monthStart(lastMonthEnd), end: lastMonthEnd },
    { key: 'today', label: 'Today', start: today, end: today },
  ]
}

type Outcome =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'error'; message: string }
  | { state: 'large'; data: ReportData; rows: number }

export default function ReportsModal({ onClose, todayStr, teams }: Props) {
  const reduceMotion = useReducedMotion()
  const [kind, setKind] = useState<ReportKind | null>(null)
  const [startDate, setStartDate] = useState(monthStart(todayStr))
  const [endDate, setEndDate] = useState(todayStr)
  const [teamId, setTeamId] = useState('')
  const [outcome, setOutcome] = useState<Outcome>({ state: 'idle' })
  const [preview, setPreview] = useState<{ data: ReportData; spec: StatementSpec } | null>(null)
  const [busy, setBusy] = useState<'pdf' | 'excel' | null>(null)

  const option = OPTIONS.find(o => o.kind === kind) ?? null
  const dayCount = rangeDayCount(startDate, endDate)
  const rangeError = validateReportRange(startDate, endDate, todayStr)
  const teamOptions: SmartOption[] = useMemo(() => teams.map(t => ({ value: t.id, label: t.name })), [teams])
  const scopeLabel = teams.find(t => t.id === teamId)?.name ?? 'All staff'
  const rangePresets = useMemo(() => presets(todayStr), [todayStr])

  // Any change to what the document covers invalidates the last result.
  const reset = () => setOutcome({ state: 'idle' })

  const generate = async () => {
    if (!kind || rangeError) return
    setOutcome({ state: 'loading' })
    try {
      // Same as opening the day view: apply any rule changed since the last
      // look, so the document never scores a day against a stale rule.
      await recomputePendingAttendance()
      const staffIds = teamId ? (await fetchTeamStaffById(teamId)).map(m => m.id) : undefined
      let data: ReportData | null
      if (kind === 'late') {
        const [rows, timezone] = await Promise.all([
          fetchLateSummaryReport(startDate, endDate, staffIds),
          fetchAttendanceTimezone(),
        ])
        // An empty team would otherwise read as "the whole school" downstream.
        data = { kind: 'late', startDate, endDate, timezone, rows: staffIds && staffIds.length === 0 ? [] : rows }
      } else if (kind === 'absence') {
        data = await fetchAbsenceIrregularReport(startDate, endDate, todayStr, staffIds)
      } else {
        data = await fetchTimeTrackingReport(startDate, endDate, todayStr, staffIds)
      }
      if (!data) {
        setOutcome({ state: 'error', message: 'The attendance records could not be read in full. Try again.' })
        return
      }
      const rows = reportRowCount(data)
      if (rows > PREVIEW_ROW_LIMIT) {
        setOutcome({ state: 'large', data, rows })
        return
      }
      const spec = await buildReportSpec(data, scopeLabel)
      setPreview({ data, spec })
      setOutcome({ state: 'idle' })
    } catch (e) {
      console.error('report generation failed:', e)
      setOutcome({ state: 'error', message: 'The report could not be built. Try again.' })
    }
  }

  const downloadLargePdf = async (data: ReportData) => {
    setBusy('pdf')
    try { await downloadStatement(await buildReportSpec(data, scopeLabel)) } catch (e) { console.error('pdf download failed:', e) }
    setBusy(null)
  }

  const downloadLargeExcel = async (data: ReportData) => {
    setBusy('excel')
    try { await downloadReportExcel(data) } catch (e) { console.error('excel download failed:', e) }
    setBusy(null)
  }

  const step = option ? 'configure' : 'choose'
  const slide = reduceMotion ? {} : {
    initial: { opacity: 0, x: step === 'configure' ? 24 : -24 },
    animate: { opacity: 1, x: 0 },
    exit: { opacity: 0, x: step === 'configure' ? -24 : 24 },
    transition: { duration: 0.22, ease: [0.16, 1, 0.3, 1] as const },
  }

  return (
    <>
      <ModalShell
        onClose={onClose}
        glass
        size="lg"
        title={option ? option.title : 'Documents'}
        subtitle={option ? 'Pick the dates, then preview' : 'Pick a report to preview and download'}
        icon={option ? <option.icon size={17} className="text-white" /> : <FileText size={17} className="text-white" />}
        iconClassName={option?.chip ?? 'bg-[linear-gradient(135deg,#3D3B40,#27272A)]'}
        minHClass="sm:min-h-[30rem]"
        headerActions={option && (
          <button onClick={() => { setKind(null); reset() }} aria-label="All documents" className={`${GBTN.secondary} !px-2.5 sm:!px-3.5`}>
            <ChevronLeft size={14} /> <span className="hidden sm:inline">All documents</span>
          </button>
        )}
        footer={option && (
          <button
            onClick={generate}
            disabled={!!rangeError || outcome.state === 'loading'}
            className={`${GBTN.primary} w-full h-11 text-[13.5px]`}
          >
            {outcome.state === 'loading'
              ? <><Loader2 size={15} className="animate-spin" /> Building preview…</>
              : <><Eye size={15} /> Preview document</>}
          </button>
        )}
      >
        <AnimatePresence mode="wait" initial={false}>
          {step === 'choose' ? (
            <motion.div key="choose" {...slide} className="space-y-2.5">
              {OPTIONS.map(o => (
                <button
                  key={o.kind}
                  onClick={() => { setKind(o.kind); reset() }}
                  className="group w-full flex items-center gap-3.5 p-3.5 rounded-2xl text-left bg-[#FAF9F6] border border-[#27272A]/[0.06] hover:bg-white hover:border-[#B8983C]/40 hover:shadow-[0_10px_24px_-16px_rgba(15,23,42,0.45)] active:scale-[0.99] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B8983C]/60"
                >
                  <span className={`icon-chip w-11 h-11 flex-shrink-0 ${o.chip}`}>
                    <o.icon size={19} className="relative z-10 text-white" />
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-[14px] font-semibold text-slate-900">{o.title}</span>
                    <span className="block text-[12px] leading-snug text-slate-500 mt-0.5">{o.detail}</span>
                  </span>
                  <ChevronRight size={16} className="text-slate-300 group-hover:text-[#B8983C] group-hover:translate-x-0.5 transition flex-shrink-0" />
                </button>
              ))}
              <p className="text-[11.5px] text-slate-500 pt-1 px-1">
                Every document opens as a preview first. One document covers up to {REPORT_MAX_DAYS} days.
              </p>
            </motion.div>
          ) : (
            <motion.div key="configure" {...slide} className="space-y-4">
              {/* Range */}
              <div>
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {rangePresets.map(p => {
                    const active = p.start === startDate && p.end === endDate
                    return (
                      <button
                        key={p.key}
                        onClick={() => { setStartDate(p.start); setEndDate(p.end); reset() }}
                        className={`h-8 px-3 rounded-full text-[12px] font-semibold transition ${
                          active
                            ? 'bg-[#27272A] text-white shadow-[inset_0_1px_0_rgba(255,255,255,.16)]'
                            : 'bg-[#F4F2EE] text-slate-600 hover:bg-[#ECE8E1] hover:text-slate-900'
                        }`}
                      >
                        {p.label}
                      </button>
                    )
                  })}
                </div>
                <div className="grid grid-cols-2 gap-2.5">
                  <label className="block">
                    <span className="block text-[12px] font-medium text-slate-500 mb-1">From</span>
                    <input type="date" value={startDate} max={todayStr}
                      onChange={e => { setStartDate(e.target.value); reset() }} className={GINPUT} />
                  </label>
                  <label className="block">
                    <span className="block text-[12px] font-medium text-slate-500 mb-1">To</span>
                    <input type="date" value={endDate} max={todayStr}
                      onChange={e => { setEndDate(e.target.value); reset() }} className={GINPUT} />
                  </label>
                </div>

                {/* How much of the 31-day allowance the range uses. */}
                <div className="mt-3 flex items-center gap-3">
                  <div className="flex-1 h-1.5 rounded-full bg-[#EEEBE5] overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${dayCount > REPORT_MAX_DAYS ? 'bg-red-500' : 'bg-[#B8983C]'}`}
                      style={{ width: `${Math.min(100, (dayCount / REPORT_MAX_DAYS) * 100)}%` }}
                    />
                  </div>
                  <span className={`text-[12px] font-semibold tabular-nums flex items-center gap-1 ${dayCount > REPORT_MAX_DAYS ? 'text-red-600' : 'text-slate-600'}`}>
                    <CalendarRange size={13} />
                    {dayCount} / {REPORT_MAX_DAYS} days
                  </span>
                </div>
                {rangeError && (
                  <p className="mt-2 flex items-center gap-1.5 text-[12px] text-red-600">
                    <AlertTriangle size={13} className="flex-shrink-0" /> {rangeError}
                  </p>
                )}
              </div>

              {/* Scope */}
              {teamOptions.length > 0 && (
                <div>
                  <span className="block text-[12px] font-medium text-slate-500 mb-1">Staff</span>
                  <SmartSelect
                    options={teamOptions}
                    value={teamId}
                    onChange={v => { setTeamId(v); reset() }}
                    allowClear
                    placeholder="All staff"
                    searchPlaceholder="Search teams…"
                    emptyText="No teams"
                    className="w-full"
                    leadingIcon={<Users size={14} className="text-slate-500 flex-shrink-0" />}
                  />
                </div>
              )}

              {outcome.state === 'error' && (
                <p className="flex items-start gap-2 text-[12.5px] text-red-700 bg-red-50 border border-red-100 rounded-xl px-3 py-2.5">
                  <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" /> {outcome.message}
                </p>
              )}

              {/* Too large to preview: say how large, offer the fix, and still
                  let the file through where a PDF is practical at all. */}
              {outcome.state === 'large' && (
                <motion.div
                  initial={reduceMotion ? false : { opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="rounded-2xl border border-amber-200 bg-amber-50/80 p-3.5"
                >
                  <div className="flex items-start gap-2.5">
                    <span className="w-8 h-8 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center flex-shrink-0">
                      <AlertTriangle size={15} />
                    </span>
                    <div className="min-w-0">
                      <p className="text-[13.5px] font-semibold text-amber-900">
                        {outcome.rows > PDF_ROW_LIMIT ? 'Too large for a PDF' : 'Too large to preview'}
                      </p>
                      <p className="text-[12px] leading-snug text-amber-800 mt-0.5">
                        {outcome.rows.toLocaleString()} rows — about {estimatePages(outcome.rows)} pages.
                        {' '}Shorten the date range{teamOptions.length > 0 ? ' or pick a team' : ''} to preview it here
                        {outcome.rows > PDF_ROW_LIMIT ? ', or take it as a spreadsheet.' : ', or download it without a preview.'}
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <button
                      onClick={() => downloadLargePdf(outcome.data)}
                      disabled={busy !== null || outcome.rows > PDF_ROW_LIMIT}
                      className={GBTN.secondary}
                    >
                      {busy === 'pdf' ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                      {busy === 'pdf' ? 'Preparing…' : 'PDF anyway'}
                    </button>
                    <button onClick={() => downloadLargeExcel(outcome.data)} disabled={busy !== null} className={GBTN.secondary}>
                      {busy === 'excel' ? <Loader2 size={14} className="animate-spin" /> : <FileSpreadsheet size={14} />}
                      Excel
                    </button>
                  </div>
                </motion.div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </ModalShell>

      <AnimatePresence>
        {preview && (
          <ReportPreviewModal
            spec={preview.spec}
            data={preview.data}
            title={REPORT_TITLES[preview.data.kind]}
            subtitle={`${scopeLabel} · ${rangeDayCount(preview.data.startDate, preview.data.endDate)} day${rangeDayCount(preview.data.startDate, preview.data.endDate) === 1 ? '' : 's'}`}
            onClose={() => setPreview(null)}
          />
        )}
      </AnimatePresence>
    </>
  )
}
