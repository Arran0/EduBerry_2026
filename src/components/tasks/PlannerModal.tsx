'use client'

import React, { useEffect, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import { FileSpreadsheet, Upload, Download, CheckCircle2, RefreshCw, Users, Clock, Trash2, Sparkles, CalendarClock } from 'lucide-react'
import {
  PlannerMode, PlannerRow, ParsedPlanner, emptyPlannerRows, periodColumnLabels, toISODate, generatePlannerDates,
  downloadPlannerTemplate, downloadPlannerRows, parsePlannerWorkbook, buildTaskInputsFromPlanner, importPlannerTasks,
} from '@/lib/planner'
import { fetchTeacherTimetable } from '@/lib/taskTimetable'
import { TaskPeriod, taskPeriods } from '@/lib/taskSlots'
import { UserProfile } from '@/lib/supabase'
import { Btn, Seg, Stepper, Notice, TaskSheet } from './ui'

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTH_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** A planner is a few kilobytes; anything past this is the wrong file, and is never parsed. */
const PLANNER_MAX_BYTES = 2 * 1024 * 1024

/** Step the anchor a week or a month back (-1) or forward (+1). */
function shiftAnchor(mode: PlannerMode, anchor: string, dir: number): string {
  if (mode === 'week') {
    const d = new Date(anchor + 'T00:00:00')
    d.setDate(d.getDate() + dir * 7)
    return toISODate(d)
  }
  const [y, m] = anchor.split('-').map(Number)
  const nd = new Date(y, (m - 1) + dir, 1)
  return `${nd.getFullYear()}-${String(nd.getMonth() + 1).padStart(2, '0')}`
}

/** "14 Jul – 20 Jul" for a week, "July 2026" for a month. */
function anchorLabel(mode: PlannerMode, anchor: string): string {
  if (mode === 'week') {
    const days = generatePlannerDates('week', anchor)
    const fmt = (iso: string) => {
      const d = new Date(iso + 'T00:00:00')
      return `${d.getDate()} ${MONTH_SHORT[d.getMonth()]}`
    }
    return `${fmt(days[0].date)} – ${fmt(days[6].date)}`
  }
  const [y, m] = anchor.split('-').map(Number)
  return `${MONTH_LONG[m - 1]} ${y}`
}

interface PlannerModalProps {
  onClose: () => void
  currentUserId: string
  defaultAssigneeId?: string
  availableAssignees?: UserProfile[]
  canAssignToOthers: boolean
  onImported: () => void
}

export default function PlannerModal({
  onClose, currentUserId, defaultAssigneeId, availableAssignees = [], canAssignToOthers, onImported,
}: PlannerModalProps) {
  const todayISO = toISODate(new Date())
  const todayYM = todayISO.slice(0, 7)

  const [tab, setTab] = useState<'upload' | 'draft'>('upload')
  const [assigneeId, setAssigneeId] = useState(defaultAssigneeId || currentUserId)
  const [submitting, setSubmitting] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [result, setResult] = useState<{ created: number; failed: number } | null>(null)

  // As many periods as the planned-for teacher's day has in the timetable.
  const [periodSlots, setPeriodSlots] = useState<TaskPeriod[]>([])
  const [periodsLoading, setPeriodsLoading] = useState(true)
  const [fromTimetable, setFromTimetable] = useState(false)

  // On phones one period column is wide and the rest shrink to a number; tap a
  // number (or focus a cell) to bring that column forward.
  const [activePeriod, setActivePeriod] = useState(0)
  const activeCol = periodSlots.length > 0 ? Math.min(activePeriod, periodSlots.length - 1) : 0
  const [isNarrow, setIsNarrow] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 639px)')
    const update = () => setIsNarrow(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])
  const draftColStyle = (isActive: boolean): React.CSSProperties =>
    isNarrow
      ? { width: isActive ? 'auto' : 44, minWidth: isActive ? 150 : 44, maxWidth: isActive ? undefined : 44, transition: 'min-width 300ms ease, max-width 300ms ease' }
      : { minWidth: 130 }

  useEffect(() => {
    let cancelled = false
    setPeriodsLoading(true)
    fetchTeacherTimetable(assigneeId).then(tt => {
      if (cancelled) return
      setPeriodSlots(taskPeriods(tt.periodCount))
      setFromTimetable(tt.periodOf.size > 0)
      setPeriodsLoading(false)
    })
    return () => { cancelled = true }
  }, [assigneeId])

  // ── Upload ────────────────────────────────────────────────────────────────
  const fileRef = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState('')
  const [parsed, setParsed] = useState<ParsedPlanner | null>(null)
  const [parseError, setParseError] = useState('')
  const [uploadSlotMapping, setUploadSlotMapping] = useState<(TaskPeriod | undefined)[]>([])
  const [showTemplatePanel, setShowTemplatePanel] = useState(false)
  const [tplMode, setTplMode] = useState<PlannerMode>('week')
  const [tplAnchor, setTplAnchor] = useState(todayISO)

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setFileName(file.name)
    setParseError('')
    setResult(null)
    setParsed(null)
    if (file.size > PLANNER_MAX_BYTES) {
      setParseError('That file is larger than 2 MB. A planner is only a few kilobytes, so check you picked the right file.')
      return
    }
    const reader = new FileReader()
    reader.onload = ev => {
      try {
        const data = new Uint8Array(ev.target!.result as ArrayBuffer)
        const workbook = XLSX.read(data, { type: 'array', cellDates: true })
        const res = parsePlannerWorkbook(workbook)
        if ('error' in res) { setParseError(res.error); return }
        setParsed(res)
        setUploadSlotMapping(res.periodLabels.map((_, i) => periodSlots[i] ?? periodSlots[periodSlots.length - 1]))
      } catch {
        setParseError('Could not read the file. Make sure it is a valid .xlsx file, ideally made from the template below.')
      }
    }
    reader.readAsArrayBuffer(file)
  }

  const uploadFilledCount = parsed ? parsed.rows.reduce((sum, r) => sum + r.periods.filter(p => p.trim()).length, 0) : 0

  const runImport = async (rows: PlannerRow[], slots: (TaskPeriod | undefined)[]) => {
    setSubmitting(true)
    setResult(null)
    const inputs = buildTaskInputsFromPlanner({ rows, periodSlots: slots, assigneeId })
    setProgress({ done: 0, total: inputs.length })
    const res = await importPlannerTasks(inputs, currentUserId, (done, total) => setProgress({ done, total }))
    setSubmitting(false)
    setResult({ created: res.created.length, failed: res.failed })
    if (res.created.length > 0) onImported()
  }

  // ── Draft ─────────────────────────────────────────────────────────────────
  const [draftMode, setDraftMode] = useState<PlannerMode>('week')
  const [draftAnchor, setDraftAnchor] = useState(todayISO)
  const [draftRows, setDraftRows] = useState<PlannerRow[]>([])

  // (Re)build the grid whenever the date range or the period count changes.
  useEffect(() => {
    if (periodsLoading) return
    setDraftRows(emptyPlannerRows(draftMode, draftAnchor, periodSlots.length))
  }, [draftMode, draftAnchor, periodSlots.length, periodsLoading])

  const handleDraftModeChange = (m: PlannerMode) => {
    setDraftMode(m)
    setDraftAnchor(m === 'week' ? todayISO : todayYM)
  }

  const updateDraftCell = (rowIdx: number, periodIdx: number, value: string) => {
    setDraftRows(prev => prev.map((r, i) => i !== rowIdx ? r : { ...r, periods: r.periods.map((p, j) => (j === periodIdx ? value : p)) }))
  }

  const draftFilledCount = draftRows.reduce((sum, r) => sum + r.periods.filter(p => p.trim()).length, 0)

  const periodsNote = periodsLoading
    ? 'Loading periods from the Timetable app…'
    : fromTimetable
      ? `${periodSlots.length} periods, from the timetable.`
      : `No timetable found, so ${periodSlots.length} periods are used.`

  const assigneePicker = canAssignToOthers && availableAssignees.length > 0 && (
    <label className="flex items-center gap-2 min-w-0">
      <span className="flex items-center gap-1.5 text-[12px] font-medium text-slate-500 flex-shrink-0"><Users size={13} /> Plan for</span>
      <select value={assigneeId} onChange={e => setAssigneeId(e.target.value)} className="tk-input !w-auto max-w-[15rem] cursor-pointer">
        {availableAssignees.map(u => <option key={u.id} value={u.id}>{u.full_name}{u.id === currentUserId ? ' (you)' : ''}</option>)}
      </select>
    </label>
  )

  const header = (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      {assigneePicker}
      <span className="flex items-start gap-1.5 text-[12px] text-slate-500 leading-snug min-w-0">
        <CalendarClock size={13} className="flex-shrink-0 mt-px text-amber-600" /> {periodsNote}
      </span>
    </div>
  )

  const footer = result ? (
    <div className="flex justify-end"><Btn tone="primary" onClick={onClose}>Done</Btn></div>
  ) : tab === 'upload' ? (
    <div className="flex items-center justify-end gap-2">
      <Btn onClick={onClose} disabled={submitting}>Cancel</Btn>
      <Btn tone="primary" onClick={() => parsed && runImport(parsed.rows, uploadSlotMapping)} disabled={!parsed || uploadFilledCount === 0 || submitting}>
        {submitting ? <RefreshCw size={14} className="animate-spin" /> : <Upload size={14} />}
        {submitting ? 'Importing…' : `Import ${uploadFilledCount || ''} task${uploadFilledCount !== 1 ? 's' : ''}`}
      </Btn>
    </div>
  ) : (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <Btn onClick={() => downloadPlannerRows({ periodLabels: periodColumnLabels(periodSlots), rows: draftRows, fileName: `planner-${draftMode}-${draftAnchor}.xlsx` })}>
        <Download size={14} /> Export
      </Btn>
      <Btn tone="primary" onClick={() => runImport(draftRows, periodSlots)} disabled={draftFilledCount === 0 || submitting}>
        {submitting ? <RefreshCw size={14} className="animate-spin" /> : <Sparkles size={14} />}
        {submitting ? 'Saving…' : `Save ${draftFilledCount || ''} task${draftFilledCount !== 1 ? 's' : ''}`}
      </Btn>
    </div>
  )

  const th = 'text-left px-3 py-2 text-[11.5px] font-semibold text-amber-900/70 whitespace-nowrap'

  return (
    <TaskSheet
      onClose={onClose}
      size="2xl"
      title="Planner"
      subtitle="Upload a filled planner, or draft one here"
      icon={FileSpreadsheet}
      minHClass="sm:min-h-[30rem]"
      footer={footer}
    >
      {result ? (
        <div className="py-8 text-center">
          <span className="inline-flex w-12 h-12 rounded-full bg-emerald-50 items-center justify-center mb-2"><CheckCircle2 size={24} className="text-emerald-600" /></span>
          <p className="text-[15px] font-semibold text-slate-800">Import complete</p>
          <p className="text-[13px] text-slate-500 mt-0.5">
            {result.created} task{result.created !== 1 ? 's' : ''} created
            {result.failed > 0 && <span className="text-red-600">, {result.failed} failed</span>}
          </p>
        </div>
      ) : submitting ? (
        <div className="py-10 max-w-sm mx-auto space-y-2">
          <div className="h-2 bg-amber-900/[0.07] rounded-full overflow-hidden">
            <div className="h-full rounded-full bg-gradient-to-r from-amber-400 to-orange-500 transition-[width]" style={{ width: progress.total > 0 ? `${(progress.done / progress.total) * 100}%` : '0%' }} />
          </div>
          <p className="text-[12.5px] text-slate-500 text-center tabular-nums">Creating tasks… {progress.done}/{progress.total}</p>
        </div>
      ) : (
        <div className="space-y-3">
          <Seg full value={tab} onChange={t => { setTab(t); setResult(null) }} options={[{ value: 'upload', label: 'Upload file' }, { value: 'draft', label: 'Draft in app' }]} className="sm:!inline-flex sm:!w-auto" />
          {header}

          {tab === 'upload' ? (
            <>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="w-full rounded-[16px] border-2 border-dashed border-amber-300/70 bg-amber-50/40 hover:bg-amber-50 hover:border-amber-400 px-4 py-6 text-center transition-colors"
              >
                <span className="tk-chip-icon w-10 h-10 mx-auto mb-2.5"><Upload size={18} /></span>
                <span className="block text-[13.5px] font-semibold text-slate-800 break-all">{fileName || 'Click to upload your filled planner (.xlsx)'}</span>
                <span className="block text-[12px] text-slate-500 mt-0.5">Needs DATE, DAY and PERIOD-N columns. Up to 2 MB.</span>
              </button>
              <input ref={fileRef} type="file" accept=".xlsx,.xls" className="sr-only" onChange={handleFile} />
              {parseError && <Notice>{parseError}</Notice>}

              <div className="tk-card !rounded-[14px] overflow-hidden">
                <button
                  type="button"
                  onClick={() => setShowTemplatePanel(v => !v)}
                  aria-expanded={showTemplatePanel}
                  className="w-full flex items-center gap-2 px-3.5 h-10 text-left text-[13px] font-semibold text-slate-700 hover:text-amber-800 transition-colors"
                >
                  <Download size={14} className="text-amber-600" /> Need a blank template?
                </button>
                {showTemplatePanel && (
                  <div className="border-t border-amber-900/[0.07] px-3.5 py-3 flex flex-wrap items-center gap-2">
                    <Seg value={tplMode} onChange={m => { setTplMode(m); setTplAnchor(m === 'week' ? todayISO : todayYM) }} options={[{ value: 'week', label: 'Weekly' }, { value: 'month', label: 'Monthly' }]} />
                    <Stepper
                      label={anchorLabel(tplMode, tplAnchor)}
                      onPrev={() => setTplAnchor(a => shiftAnchor(tplMode, a, -1))}
                      onNext={() => setTplAnchor(a => shiftAnchor(tplMode, a, 1))}
                      prevLabel={`Previous ${tplMode}`}
                      nextLabel={`Next ${tplMode}`}
                    />
                    <Btn tone="primary" disabled={periodsLoading} onClick={() => downloadPlannerTemplate({ mode: tplMode, anchor: tplAnchor, periodSlots })} className="ml-auto">
                      <Download size={13} /> Download
                    </Btn>
                    <p className="basis-full text-[12px] text-slate-500">Fill it in Excel, then upload it above, or use Draft in app instead.</p>
                  </div>
                )}
              </div>

              {parsed && (
                <div className="space-y-3">
                  <div>
                    <p className="flex items-center gap-1.5 text-[12px] font-semibold text-amber-800/80 mb-1.5"><Clock size={13} /> Map to period</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                      {parsed.periodLabels.map((label, i) => (
                        <label key={i} className="flex items-center gap-2 min-w-0">
                          <span className="text-[12px] font-medium text-slate-600 w-28 flex-shrink-0 break-words leading-tight">{label}</span>
                          <select
                            value={periodSlots.findIndex(s => s === uploadSlotMapping[i])}
                            onChange={e => {
                              const slot = periodSlots[Number(e.target.value)]
                              setUploadSlotMapping(prev => prev.map((v, j) => (j === i ? slot : v)))
                            }}
                            className="tk-input cursor-pointer"
                          >
                            {periodSlots.map((s, si) => <option key={si} value={si}>{s.label}</option>)}
                          </select>
                        </label>
                      ))}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
                    <span className="px-2.5 py-1 rounded-full bg-[#fbf6ee] border border-amber-900/[0.08] text-slate-600 font-medium">{parsed.rows.length} days</span>
                    <span className="px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-100 text-emerald-700 font-medium">{uploadFilledCount} tasks to create</span>
                  </div>
                  <div className="tk-card !rounded-[14px] overflow-hidden">
                    <div className="max-h-56 overflow-auto overscroll-contain">
                      <table className="w-full text-[12px] min-w-[420px]">
                        <thead className="sticky top-0 bg-[#fff8ec]">
                          <tr>
                            <th className={th}>Date</th>
                            <th className={th}>Day</th>
                            {parsed.periodLabels.map((l, i) => <th key={i} className={th}>{l}</th>)}
                          </tr>
                        </thead>
                        <tbody>
                          {parsed.rows.map((r, i) => (
                            <tr key={i} className="border-t border-amber-900/[0.06]">
                              <td className="px-3 py-1.5 whitespace-nowrap text-slate-600 tabular-nums">{r.date}</td>
                              <td className="px-3 py-1.5 text-slate-500">{r.day.slice(0, 3)}</td>
                              {r.periods.map((p, j) => <td key={j} className="px-3 py-1.5 text-slate-700 min-w-[7rem] max-w-[12rem] break-words align-top">{p || <span className="text-slate-300">–</span>}</td>)}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Seg value={draftMode} onChange={handleDraftModeChange} options={[{ value: 'week', label: 'Weekly' }, { value: 'month', label: 'Monthly' }]} />
                <Stepper
                  label={anchorLabel(draftMode, draftAnchor)}
                  onPrev={() => setDraftAnchor(a => shiftAnchor(draftMode, a, -1))}
                  onNext={() => setDraftAnchor(a => shiftAnchor(draftMode, a, 1))}
                  prevLabel={`Previous ${draftMode}`}
                  nextLabel={`Next ${draftMode}`}
                />
              </div>
              <div className="tk-card !rounded-[14px] overflow-hidden">
                <div className="max-h-[min(20rem,46dvh)] overflow-auto overscroll-contain">
                  <table className="w-full text-[12px]">
                    <thead className="sticky top-0 z-10 bg-[#fff8ec]">
                      <tr>
                        <th className={`${th} sticky left-0 bg-[#fff8ec]`}>Date</th>
                        <th className={th}>Day</th>
                        {periodSlots.map((s, i) => {
                          const isActive = i === activeCol
                          const shrunk = isNarrow && !isActive
                          return (
                            <th
                              key={i}
                              onClick={() => setActivePeriod(i)}
                              title={shrunk ? `${s.label}: tap to expand` : s.label}
                              style={draftColStyle(isActive)}
                              className={`py-2 text-[11.5px] font-semibold text-amber-900/70 select-none whitespace-nowrap ${isNarrow ? 'cursor-pointer' : ''} ${shrunk ? 'text-center px-1' : 'text-left px-3'}`}
                            >
                              {shrunk ? i + 1 : s.label}
                            </th>
                          )
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {draftRows.map((r, i) => (
                        <tr key={r.date} className="border-t border-amber-900/[0.06]">
                          <td className="px-3 py-1.5 whitespace-nowrap text-slate-700 font-medium sticky left-0 bg-white tabular-nums">{r.date.slice(5)}</td>
                          <td className="px-3 py-1.5 text-slate-500 whitespace-nowrap">{r.day.slice(0, 3)}</td>
                          {r.periods.map((p, j) => {
                            const isActive = j === activeCol
                            const shrunk = isNarrow && !isActive
                            return (
                              <td key={j} className="px-1 py-1" style={draftColStyle(isActive)}>
                                <input
                                  type="text"
                                  value={p}
                                  size={1}
                                  onChange={e => updateDraftCell(i, j, e.target.value)}
                                  onFocus={() => setActivePeriod(j)}
                                  placeholder={shrunk ? String(j + 1) : '–'}
                                  title={shrunk && p ? p : undefined}
                                  aria-label={`${r.day} ${r.date}, period ${j + 1}`}
                                  className={`w-full min-w-0 h-8 border-0 rounded-[8px] text-[12px] focus:outline-none focus:bg-amber-50 focus:ring-1 focus:ring-amber-300 placeholder:text-slate-300 ${p ? 'bg-[#fdf8f0]' : 'bg-transparent'} ${shrunk ? 'px-1 text-center' : 'px-2 text-left'}`}
                                />
                              </td>
                            )
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 text-[12px]">
                <span className="text-slate-500 tabular-nums">{draftFilledCount} period{draftFilledCount !== 1 ? 's' : ''} filled</span>
                <button
                  type="button"
                  onClick={() => setDraftRows(emptyPlannerRows(draftMode, draftAnchor, periodSlots.length))}
                  className="inline-flex items-center gap-1 h-8 px-2.5 rounded-full text-slate-500 hover:text-red-500 hover:bg-red-50 transition-colors"
                >
                  <Trash2 size={12} /> Clear grid
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </TaskSheet>
  )
}
