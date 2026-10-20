'use client'

import React, { useEffect, useRef, useState } from 'react'
import { FileSpreadsheet, Upload, Download, CheckCircle2, Loader2, Trash2, CalendarClock, ChevronDown } from 'lucide-react'
import ModalShell from '@/components/ui/ModalShell'
import {
  PlannerMode, PlannerRow, ParsedPlanner, emptyPlannerRows, periodColumnLabels, toISODate, generatePlannerDates,
  downloadPlannerTemplate, downloadPlannerRows, readPlannerFile, buildTaskInputsFromPlanner, importPlannerTasks,
} from '@/lib/planner'
import { fetchActiveTimetablePeriodSlots } from '@/lib/taskPeriods'
import { TaskSlot, TASK_SLOTS, formatSlotTime } from '@/lib/taskSlots'
import { UserProfile } from '@/lib/supabase'
import { useMediaQuerySync } from '@/hooks/useMediaQuery'
import { Btn, FormGroup, FormRow, Notice, TASK_ICON, ROW_FIELD, Segmented, Stepper } from './ui'

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTH_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

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

/** "14 – 20 Jul" for a week, "July 2026" for a month. */
function anchorLabel(mode: PlannerMode, anchor: string): string {
  if (mode === 'week') {
    const days = generatePlannerDates('week', anchor)
    const a = new Date(days[0].date + 'T00:00:00')
    const b = new Date(days[6].date + 'T00:00:00')
    return a.getMonth() === b.getMonth()
      ? `${a.getDate()} – ${b.getDate()} ${MONTH_SHORT[b.getMonth()]}`
      : `${a.getDate()} ${MONTH_SHORT[a.getMonth()]} – ${b.getDate()} ${MONTH_SHORT[b.getMonth()]}`
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

  const [tab, setTab] = useState<'draft' | 'upload'>('draft')
  const [assigneeId, setAssigneeId] = useState(defaultAssigneeId || currentUserId)
  const [submitting, setSubmitting] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [result, setResult] = useState<{ created: number; failed: number } | null>(null)

  // Real periods from the active Timetable: count, labels and times.
  const [periodSlots, setPeriodSlots] = useState<TaskSlot[]>([])
  const [periodsLoading, setPeriodsLoading] = useState(true)
  const usingFallbackPeriods = periodSlots === TASK_SLOTS

  useEffect(() => {
    let cancelled = false
    fetchActiveTimetablePeriodSlots()
      .then(slots => { if (!cancelled) setPeriodSlots(slots) })
      .catch(() => { if (!cancelled) setPeriodSlots(TASK_SLOTS) })
      .finally(() => { if (!cancelled) setPeriodsLoading(false) })
    return () => { cancelled = true }
  }, [])

  // ── Upload ──────────────────────────────────────────────────────────────────
  const fileRef = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState('')
  const [reading, setReading] = useState(false)
  const [parsed, setParsed] = useState<ParsedPlanner | null>(null)
  const [parseError, setParseError] = useState('')
  const [uploadSlotMapping, setUploadSlotMapping] = useState<(TaskSlot | undefined)[]>([])
  const [showTemplate, setShowTemplate] = useState(false)
  const [tplMode, setTplMode] = useState<PlannerMode>('week')
  const [tplAnchor, setTplAnchor] = useState(todayISO)

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setFileName(file.name)
    setParseError('')
    setResult(null)
    setParsed(null)
    setReading(true)
    const res = await readPlannerFile(file)
    setReading(false)
    if ('error' in res) { setParseError(res.error); return }
    setParsed(res)
    setUploadSlotMapping(res.periodLabels.map((_, i) => periodSlots[i] ?? periodSlots[periodSlots.length - 1]))
  }

  const uploadFilledCount = parsed ? parsed.rows.reduce((sum, r) => sum + r.periods.filter(p => p.trim()).length, 0) : 0

  const runImport = async (rows: PlannerRow[], slots: (TaskSlot | undefined)[]) => {
    setSubmitting(true)
    setResult(null)
    const inputs = buildTaskInputsFromPlanner({ rows, periodSlots: slots, assigneeId })
    setProgress({ done: 0, total: inputs.length })
    const res = await importPlannerTasks(inputs, currentUserId, (done, total) => setProgress({ done, total }))
    setSubmitting(false)
    setResult({ created: res.created.length, failed: res.failed })
    if (res.created.length > 0) onImported()
  }

  // ── Draft ───────────────────────────────────────────────────────────────────
  const [draftMode, setDraftMode] = useState<PlannerMode>('week')
  const [draftAnchor, setDraftAnchor] = useState(todayISO)
  const [draftRows, setDraftRows] = useState<PlannerRow[]>([])

  useEffect(() => {
    if (periodsLoading) return
    setDraftRows(emptyPlannerRows(draftMode, draftAnchor, periodSlots.length))
  }, [draftMode, draftAnchor, periodSlots.length, periodsLoading])

  const changeDraftMode = (m: PlannerMode) => {
    setDraftMode(m)
    setDraftAnchor(m === 'week' ? todayISO : todayYM)
  }

  const updateDraftCell = (rowIdx: number, periodIdx: number, value: string) => {
    setDraftRows(prev => prev.map((r, i) => i !== rowIdx ? r : { ...r, periods: r.periods.map((p, j) => (j === periodIdx ? value : p)) }))
  }

  const draftFilledCount = draftRows.reduce((sum, r) => sum + r.periods.filter(p => p.trim()).length, 0)

  // On a phone one period column is wide and the rest shrink to a number;
  // tap a number (or type in a cell) to bring that column forward.
  const narrow = useMediaQuerySync('(max-width: 639px)')
  const [activePeriod, setActivePeriod] = useState(0)
  const activeCol = periodSlots.length > 0 ? Math.min(activePeriod, periodSlots.length - 1) : 0
  const colStyle = (isActive: boolean): React.CSSProperties =>
    narrow
      ? { width: isActive ? 'auto' : 40, minWidth: isActive ? 140 : 40, maxWidth: isActive ? undefined : 40, transition: 'min-width 300ms ease, max-width 300ms ease' }
      : { minWidth: 128 }

  // ── Shared ──────────────────────────────────────────────────────────────────
  const periodsNote = periodsLoading
    ? 'Loading periods from the timetable…'
    : usingFallbackPeriods
      ? `No timetable is published, so the ${periodSlots.length} standard periods are used.`
      : `${periodSlots.length} periods from the published timetable.`

  const planFor = canAssignToOthers && availableAssignees.length > 0 && (
    <FormGroup>
      <FormRow label="Plan for" hint={periodsNote}>
        <select value={assigneeId} onChange={e => setAssigneeId(e.target.value)} className={`${ROW_FIELD} pr-1 cursor-pointer max-w-[15rem]`}>
          {availableAssignees.map(u => <option key={u.id} value={u.id}>{u.full_name}{u.id === currentUserId ? ' (you)' : ''}</option>)}
        </select>
      </FormRow>
    </FormGroup>
  )

  const footer = result ? (
    <div className="flex justify-end"><Btn tone="dark" onClick={onClose}>Done</Btn></div>
  ) : tab === 'upload' ? (
    <div className="flex items-center justify-end gap-2">
      <Btn tone="ghost" onClick={onClose} disabled={submitting}>Cancel</Btn>
      <Btn tone="dark" onClick={() => parsed && runImport(parsed.rows, uploadSlotMapping)} disabled={!parsed || uploadFilledCount === 0 || submitting}>
        {submitting ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
        {submitting ? 'Adding…' : `Add ${uploadFilledCount || ''} task${uploadFilledCount === 1 ? '' : 's'}`}
      </Btn>
    </div>
  ) : (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <Btn
        tone="ghost"
        onClick={() => downloadPlannerRows({ periodLabels: periodColumnLabels(periodSlots), rows: draftRows, fileName: `planner-${draftMode}-${draftAnchor}.xlsx` })}
        disabled={periodsLoading}
      >
        <Download size={13} /> Download
      </Btn>
      <Btn tone="dark" onClick={() => runImport(draftRows, periodSlots)} disabled={draftFilledCount === 0 || submitting}>
        {submitting ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
        {submitting ? 'Adding…' : `Add ${draftFilledCount || ''} task${draftFilledCount === 1 ? '' : 's'}`}
      </Btn>
    </div>
  )

  return (
    <ModalShell
      onClose={onClose}
      size="2xl"
      sharp
      title="Planner"
      subtitle="Fill a week or month of periods, then add them as tasks"
      icon={<FileSpreadsheet size={16} />}
      iconClassName={TASK_ICON}
      minHClass="sm:min-h-[32rem]"
      footer={footer}
    >
      {result ? (
        <div className="py-6 text-center">
          <CheckCircle2 size={30} className="text-emerald-600 mx-auto mb-2" />
          <p className="text-[15px] font-semibold text-slate-900">{result.created} task{result.created !== 1 ? 's' : ''} added</p>
          {result.failed > 0 && <p className="text-[13px] text-rose-700 mt-1">{result.failed} could not be added. Try those again.</p>}
        </div>
      ) : submitting ? (
        <div className="py-10 max-w-sm mx-auto space-y-2">
          <div className="h-2 bg-[#EEEAE1] rounded-full overflow-hidden">
            <div className="h-full bg-[#27272A] transition-[width]" style={{ width: progress.total > 0 ? `${(progress.done / progress.total) * 100}%` : '0%' }} />
          </div>
          <p className="text-[12.5px] text-slate-500 text-center tabular-nums">Adding tasks… {progress.done} of {progress.total}</p>
        </div>
      ) : (
        <div className="space-y-3">
          <Segmented
            value={tab}
            onChange={setTab}
            options={[{ value: 'draft', label: 'Type it here' }, { value: 'upload', label: 'Upload a file' }]}
          />
          {planFor}
          {!planFor && (
            <p className="flex items-start gap-1.5 text-[12px] text-slate-500 leading-snug">
              <CalendarClock size={13} className="flex-shrink-0 mt-px" /> {periodsNote}
            </p>
          )}

          {tab === 'draft' ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Segmented value={draftMode} onChange={changeDraftMode} options={[{ value: 'week', label: 'Week' }, { value: 'month', label: 'Month' }]} className="!w-auto" />
                <Stepper
                  label={anchorLabel(draftMode, draftAnchor)}
                  onPrev={() => setDraftAnchor(a => shiftAnchor(draftMode, a, -1))}
                  onNext={() => setDraftAnchor(a => shiftAnchor(draftMode, a, 1))}
                  prevLabel={`Previous ${draftMode}`}
                  nextLabel={`Next ${draftMode}`}
                />
              </div>

              <div className="fx-card overflow-hidden">
                <div className="max-h-[min(22rem,48dvh)] overflow-auto overscroll-contain">
                  <table className="w-full text-[12.5px] border-collapse">
                    <thead className="sticky top-0 z-10">
                      <tr className="bg-[#F7F5F0] border-b border-[#EEEAE1]">
                        <th className="sticky left-0 z-10 bg-[#F7F5F0] text-left px-2.5 py-2 text-[11.5px] font-semibold text-slate-500 whitespace-nowrap">Day</th>
                        {periodSlots.map((s, i) => {
                          const isActive = i === activeCol
                          const shrunk = narrow && !isActive
                          return (
                            <th
                              key={i}
                              onClick={() => setActivePeriod(i)}
                              title={`${s.label}, ${formatSlotTime(s.start)} – ${formatSlotTime(s.end)}`}
                              style={colStyle(isActive)}
                              className={`py-2 text-[11.5px] font-semibold text-slate-500 select-none whitespace-nowrap ${narrow ? 'cursor-pointer' : ''} ${shrunk ? 'text-center px-1' : 'text-left px-2'}`}
                            >
                              {shrunk ? i + 1 : <>{s.label} <span className="font-normal text-slate-400">{formatSlotTime(s.start)}</span></>}
                            </th>
                          )
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {draftRows.map((r, i) => (
                        <tr key={r.date} className="border-t border-[#F0ECE3]">
                          <td className="sticky left-0 bg-white px-2.5 py-1 whitespace-nowrap text-slate-700 font-medium tabular-nums">
                            {r.day.slice(0, 3)} {Number(r.date.slice(8))}
                          </td>
                          {r.periods.map((p, j) => {
                            const isActive = j === activeCol
                            const shrunk = narrow && !isActive
                            return (
                              <td key={j} className="px-0.5 py-0.5" style={colStyle(isActive)}>
                                <input
                                  type="text"
                                  value={p}
                                  size={1}
                                  onChange={e => updateDraftCell(i, j, e.target.value)}
                                  onFocus={() => setActivePeriod(j)}
                                  placeholder={shrunk ? String(j + 1) : ''}
                                  title={shrunk && p ? p : undefined}
                                  aria-label={`${r.day} ${r.date}, period ${j + 1}`}
                                  className={`w-full min-w-0 h-8 border-0 rounded-[7px] bg-transparent text-[12.5px] focus:outline-none focus:bg-[#FBF6E9] focus:ring-1 focus:ring-[#B8983C]/50 placeholder:text-slate-300 ${shrunk ? 'px-0.5 text-center' : 'px-2'} ${p ? 'bg-[#FAF7F0]' : ''}`}
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
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <p className="text-[12px] text-slate-500 tabular-nums">{draftFilledCount} period{draftFilledCount !== 1 ? 's' : ''} filled. Each filled cell becomes one task.</p>
                <button
                  type="button"
                  onClick={() => setDraftRows(emptyPlannerRows(draftMode, draftAnchor, periodSlots.length))}
                  disabled={draftFilledCount === 0}
                  className="inline-flex items-center gap-1 h-8 px-2.5 rounded-full text-[12px] font-semibold text-slate-500 hover:text-rose-600 hover:bg-rose-50 disabled:opacity-40 disabled:pointer-events-none transition"
                >
                  <Trash2 size={12} /> Clear all
                </button>
              </div>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="w-full fx-card border-dashed px-4 py-6 text-center hover:bg-[#FAF7F0] transition-colors"
              >
                {reading ? <Loader2 size={20} className="animate-spin text-slate-400 mx-auto mb-2" /> : <Upload size={20} className="text-slate-400 mx-auto mb-2" />}
                <span className="block text-[13.5px] font-semibold text-slate-900 break-all">{fileName || 'Choose a filled planner (.xlsx)'}</span>
                <span className="block text-[12px] text-slate-500 mt-0.5">It needs Date, Day and Period columns. Up to 2 MB.</span>
              </button>
              <input ref={fileRef} type="file" accept=".xlsx,.xls" className="sr-only" onChange={handleFile} />
              {parseError && <Notice tone="error">{parseError}</Notice>}

              <div className="fx-card">
                <button
                  type="button"
                  onClick={() => setShowTemplate(v => !v)}
                  aria-expanded={showTemplate}
                  className="w-full flex items-center gap-2 px-3.5 min-h-[44px] text-left text-[13.5px] font-medium text-slate-900 hover:bg-[#FAF7F0] transition-colors"
                >
                  <Download size={14} className="text-slate-500" /> Get a blank template
                  <ChevronDown size={15} className={`ml-auto text-slate-400 transition-transform ${showTemplate ? 'rotate-180' : ''}`} />
                </button>
                {showTemplate && (
                  <div className="border-t border-[#EEEAE1] px-3.5 py-3 flex flex-wrap items-center gap-2">
                    <Segmented
                      value={tplMode}
                      onChange={m => { setTplMode(m); setTplAnchor(m === 'week' ? todayISO : todayYM) }}
                      options={[{ value: 'week', label: 'Week' }, { value: 'month', label: 'Month' }]}
                      className="!w-auto"
                    />
                    <Stepper
                      label={anchorLabel(tplMode, tplAnchor)}
                      onPrev={() => setTplAnchor(a => shiftAnchor(tplMode, a, -1))}
                      onNext={() => setTplAnchor(a => shiftAnchor(tplMode, a, 1))}
                      prevLabel={`Previous ${tplMode}`}
                      nextLabel={`Next ${tplMode}`}
                    />
                    <Btn tone="dark" disabled={periodsLoading} onClick={() => downloadPlannerTemplate({ mode: tplMode, anchor: tplAnchor, periodSlots })} className="ml-auto">
                      <Download size={13} /> Download
                    </Btn>
                  </div>
                )}
              </div>

              {parsed && (
                <>
                  <FormGroup title="Match the file's columns to periods">
                    {parsed.periodLabels.map((label, i) => (
                      <FormRow key={i} label={label}>
                        <select
                          value={periodSlots.findIndex(s => s === uploadSlotMapping[i])}
                          onChange={e => {
                            const slot = periodSlots[Number(e.target.value)]
                            setUploadSlotMapping(prev => prev.map((v, j) => (j === i ? slot : v)))
                          }}
                          className={`${ROW_FIELD} pr-1 cursor-pointer max-w-[15rem]`}
                        >
                          {periodSlots.map((s, si) => <option key={si} value={si}>{s.label}, {formatSlotTime(s.start)} – {formatSlotTime(s.end)}</option>)}
                        </select>
                      </FormRow>
                    ))}
                  </FormGroup>
                  <p className="text-[12px] text-slate-500 tabular-nums">{parsed.rows.length} days, {uploadFilledCount} tasks to add.</p>
                  <div className="fx-card overflow-hidden">
                    <div className="max-h-56 overflow-auto overscroll-contain">
                      <table className="w-full text-[12px] border-collapse">
                        <thead className="sticky top-0">
                          <tr className="bg-[#F7F5F0]">
                            <th className="text-left px-2.5 py-2 font-semibold text-slate-500 whitespace-nowrap">Date</th>
                            {parsed.periodLabels.map((l, i) => <th key={i} className="text-left px-2.5 py-2 font-semibold text-slate-500 whitespace-nowrap">{l}</th>)}
                          </tr>
                        </thead>
                        <tbody>
                          {parsed.rows.map((r, i) => (
                            <tr key={i} className="border-t border-[#F0ECE3]">
                              <td className="px-2.5 py-1.5 whitespace-nowrap text-slate-600 tabular-nums">{r.day.slice(0, 3)} {r.date}</td>
                              {r.periods.map((p, j) => <td key={j} className="px-2.5 py-1.5 text-slate-800 min-w-[7rem] max-w-[12rem] break-words align-top">{p || <span className="text-slate-300">–</span>}</td>)}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      )}
    </ModalShell>
  )
}
