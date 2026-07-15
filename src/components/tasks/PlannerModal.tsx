'use client'

import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import * as XLSX from 'xlsx'
import {
  X, FileSpreadsheet, Upload, Download, CheckCircle2, AlertCircle,
  RefreshCw, Users, Clock, Trash2, Sparkles,
} from 'lucide-react'
import {
  PlannerMode, PlannerRow, ParsedPlanner,
  emptyPlannerRows, defaultPeriodLabels, toISODate,
  downloadPlannerTemplate, downloadPlannerRows, parsePlannerWorkbook,
  buildTaskInputsFromPlanner, importPlannerTasks,
} from '@/lib/planner'
import { TASK_SLOTS, formatSlotTime } from '@/lib/taskSlots'
import { UserProfile } from '@/lib/supabase'

const MAX_PERIODS = 8

function defaultSlotIndices(n: number): number[] {
  return Array.from({ length: n }, (_, i) => Math.min(i, TASK_SLOTS.length - 1))
}

interface PlannerModalProps {
  isOpen: boolean
  onClose: () => void
  currentUserId: string
  defaultAssigneeId?: string
  availableAssignees?: UserProfile[]
  canAssignToOthers: boolean
  onImported: () => void
}

export default function PlannerModal({
  isOpen, onClose, currentUserId, defaultAssigneeId,
  availableAssignees = [], canAssignToOthers, onImported,
}: PlannerModalProps) {
  const todayISO = toISODate(new Date())
  const todayYM = todayISO.slice(0, 7)

  const [tab, setTab] = useState<'upload' | 'draft'>('upload')
  const [grade, setGrade] = useState('')
  const [subject, setSubject] = useState('')
  const [assigneeId, setAssigneeId] = useState(defaultAssigneeId || currentUserId)

  const [submitting, setSubmitting] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [result, setResult] = useState<{ created: number; failed: number } | null>(null)

  useEffect(() => {
    if (isOpen) {
      setResult(null)
      setSubmitting(false)
      setAssigneeId(defaultAssigneeId || currentUserId)
    }
  }, [isOpen, defaultAssigneeId, currentUserId])

  // ── Upload tab ────────────────────────────────────────────────────────────
  const fileRef = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState('')
  const [parsed, setParsed] = useState<ParsedPlanner | null>(null)
  const [parseError, setParseError] = useState('')
  const [uploadSlotIndices, setUploadSlotIndices] = useState<number[]>([])
  const [showTemplatePanel, setShowTemplatePanel] = useState(false)
  const [tplMode, setTplMode] = useState<PlannerMode>('week')
  const [tplAnchor, setTplAnchor] = useState(todayISO)
  const [tplPeriodCount, setTplPeriodCount] = useState(3)

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    setParseError('')
    setResult(null)
    setParsed(null)

    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const data = new Uint8Array(ev.target!.result as ArrayBuffer)
        const workbook = XLSX.read(data, { type: 'array', cellDates: true })
        const res = parsePlannerWorkbook(workbook)
        if ('error' in res) {
          setParseError(res.error)
          return
        }
        setParsed(res)
        setGrade(res.grade || '')
        setSubject(res.subject || '')
        setUploadSlotIndices(defaultSlotIndices(res.periodLabels.length))
      } catch {
        setParseError('Could not read file. Make sure it is a valid .xlsx file — ideally exported from the template below.')
      }
    }
    reader.readAsArrayBuffer(file)
    e.target.value = ''
  }

  const uploadFilledCount = parsed
    ? parsed.rows.reduce((sum, r) => sum + r.periods.filter(p => p.trim()).length, 0)
    : 0

  const handleUploadImport = async () => {
    if (!parsed || uploadFilledCount === 0) return
    setSubmitting(true)
    setResult(null)
    const inputs = buildTaskInputsFromPlanner({
      rows: parsed.rows,
      periodSlotIndices: uploadSlotIndices,
      assigneeId,
      grade: grade || parsed.grade,
      subject: subject || parsed.subject,
    })
    setProgress({ done: 0, total: inputs.length })
    const res = await importPlannerTasks(inputs, currentUserId, (done, total) => setProgress({ done, total }))
    setSubmitting(false)
    setResult({ created: res.created.length, failed: res.failed })
    if (res.created.length > 0) onImported()
  }

  // ── Draft tab ─────────────────────────────────────────────────────────────
  const [draftMode, setDraftMode] = useState<PlannerMode>('week')
  const [draftAnchor, setDraftAnchor] = useState(todayISO)
  const [draftPeriodCount, setDraftPeriodCount] = useState(3)
  const [draftRows, setDraftRows] = useState<PlannerRow[]>(() => emptyPlannerRows('week', todayISO, 3))
  const [draftSlotIndices, setDraftSlotIndices] = useState<number[]>(defaultSlotIndices(3))

  const handleDraftModeChange = (m: PlannerMode) => {
    const anchor = m === 'week' ? todayISO : todayYM
    setDraftMode(m)
    setDraftAnchor(anchor)
    setDraftRows(emptyPlannerRows(m, anchor, draftPeriodCount))
  }

  const handleDraftAnchorChange = (anchor: string) => {
    setDraftAnchor(anchor)
    setDraftRows(emptyPlannerRows(draftMode, anchor, draftPeriodCount))
  }

  const handleDraftPeriodCount = (n: number) => {
    const clamped = Math.max(1, Math.min(MAX_PERIODS, n))
    setDraftPeriodCount(clamped)
    setDraftRows(prev => prev.map(r => ({
      ...r,
      periods: Array.from({ length: clamped }, (_, i) => r.periods[i] ?? ''),
    })))
    setDraftSlotIndices(defaultSlotIndices(clamped))
  }

  const updateDraftCell = (rowIdx: number, periodIdx: number, value: string) => {
    setDraftRows(prev => prev.map((r, i) =>
      i !== rowIdx ? r : { ...r, periods: r.periods.map((p, j) => (j === periodIdx ? value : p)) }
    ))
  }

  const draftFilledCount = draftRows.reduce((sum, r) => sum + r.periods.filter(p => p.trim()).length, 0)

  const handleDraftExport = () => {
    downloadPlannerRows({
      grade, subject,
      periodLabels: defaultPeriodLabels(draftPeriodCount),
      rows: draftRows,
      fileName: `planner-${draftMode}-${draftAnchor}.xlsx`,
    })
  }

  const handleDraftSave = async () => {
    if (draftFilledCount === 0) return
    setSubmitting(true)
    setResult(null)
    const inputs = buildTaskInputsFromPlanner({
      rows: draftRows,
      periodSlotIndices: draftSlotIndices,
      assigneeId,
      grade, subject,
    })
    setProgress({ done: 0, total: inputs.length })
    const res = await importPlannerTasks(inputs, currentUserId, (done, total) => setProgress({ done, total }))
    setSubmitting(false)
    setResult({ created: res.created.length, failed: res.failed })
    if (res.created.length > 0) onImported()
  }

  // ── Shared bits ───────────────────────────────────────────────────────────

  const tabBtn = (t: 'upload' | 'draft', label: string) => (
    <button
      type="button"
      onClick={() => { setTab(t); setResult(null) }}
      className={`flex-1 px-3 py-1.5 rounded-md text-sm font-semibold transition-all ${tab === t ? 'bg-white text-slate-700 shadow-sm' : 'text-slate-400'}`}
    >
      {label}
    </button>
  )

  const slotMapper = (labels: string[], indices: number[], onChange: (i: number, slotIdx: number) => void) => (
    <div className="space-y-1.5">
      <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide flex items-center gap-1.5">
        <Clock size={12} /> Period → Time slot
      </label>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
        {labels.map((label, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="text-xs font-medium text-slate-500 w-20 truncate flex-shrink-0">{label}</span>
            <select
              value={indices[i] ?? 0}
              onChange={e => onChange(i, Number(e.target.value))}
              className="flex-1 min-w-0 border border-slate-200 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-emerald-500"
            >
              {TASK_SLOTS.map((s, si) => (
                <option key={si} value={si}>{s.label} · {formatSlotTime(s.start)}–{formatSlotTime(s.end)}</option>
              ))}
            </select>
          </div>
        ))}
      </div>
    </div>
  )

  const assigneePicker = (
    canAssignToOthers && availableAssignees.length > 0 && (
      <div>
        <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5 flex items-center gap-1.5">
          <Users size={12} /> Assign to
        </label>
        <select
          value={assigneeId}
          onChange={e => setAssigneeId(e.target.value)}
          className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500"
        >
          {availableAssignees.map(u => (
            <option key={u.id} value={u.id}>{u.full_name}{u.id === currentUserId ? ' (You)' : ''}</option>
          ))}
        </select>
      </div>
    )
  )

  const gradeSubjectInputs = (
    <div className="grid grid-cols-2 gap-3">
      <input
        type="text" value={grade} onChange={e => setGrade(e.target.value)}
        placeholder="Grade (optional)"
        className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500"
      />
      <input
        type="text" value={subject} onChange={e => setSubject(e.target.value)}
        placeholder="Subject (optional)"
        className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500"
      />
    </div>
  )

  const resultBanner = result && (
    <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-1">
      <div className="flex items-center gap-2 text-slate-800 font-semibold text-sm">
        <CheckCircle2 size={16} className="text-emerald-600 flex-shrink-0" />
        Import complete
      </div>
      <p className="text-sm text-slate-500">
        {result.created} task{result.created !== 1 ? 's' : ''} created
        {result.failed > 0 && <span className="text-rose-600"> · {result.failed} failed</span>}
      </p>
    </div>
  )

  const progressBar = submitting && (
    <div className="space-y-1.5">
      <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
        <div
          className="h-full bg-emerald-500 transition-all"
          style={{ width: progress.total > 0 ? `${(progress.done / progress.total) * 100}%` : '0%' }}
        />
      </div>
      <p className="text-xs text-slate-400 text-center">Creating tasks… {progress.done}/{progress.total}</p>
    </div>
  )

  if (!isOpen) return null

  const modal = (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      >
        <motion.div
          initial={{ y: '100%', opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: '100%', opacity: 0 }}
          transition={{ type: 'spring', damping: 40, stiffness: 320 }}
          className="bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl w-full sm:max-w-3xl flex flex-col overflow-hidden"
          style={{ maxHeight: '92dvh' }}
          onClick={e => e.stopPropagation()}
        >
          {/* Drag handle */}
          <div className="flex justify-center pt-3 pb-1 sm:hidden flex-shrink-0">
            <div className="w-10 h-1 rounded-full bg-slate-300" />
          </div>

          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 flex-shrink-0">
            <div className="flex items-center gap-3 min-w-0">
              <div className="icon-chip w-11 h-11 flex-shrink-0" style={{ background: 'linear-gradient(135deg, #10b981, #059669)' }}>
                <FileSpreadsheet size={20} className="relative z-10 text-white drop-shadow-sm" />
              </div>
              <div className="min-w-0">
                <h2 className="text-base sm:text-lg font-bold text-slate-800 leading-tight">Planner</h2>
                <p className="text-xs text-slate-400 truncate">Import or draft a weekly/monthly planner</p>
              </div>
            </div>
            <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-colors flex-shrink-0">
              <X size={18} />
            </button>
          </div>

          {/* Tabs */}
          <div className="px-4 sm:px-5 pt-4 flex-shrink-0">
            <div className="flex items-center bg-slate-100 rounded-lg p-1">
              {tabBtn('upload', 'Upload File')}
              {tabBtn('draft', 'Draft in App')}
            </div>
          </div>

          {/* Body */}
          <div className="overflow-y-auto flex-1 px-4 sm:px-5 py-4 space-y-4">

            {tab === 'upload' && (
              <>
                {!result && (
                  <>
                    <div
                      className="border-2 border-dashed border-slate-200 hover:border-slate-300 rounded-xl p-6 text-center cursor-pointer transition-colors"
                      onClick={() => fileRef.current?.click()}
                    >
                      <div className="w-10 h-10 border border-slate-200 bg-slate-50 rounded-xl flex items-center justify-center mx-auto mb-3">
                        <Upload size={18} className="text-slate-400" />
                      </div>
                      {fileName ? (
                        <p className="text-sm font-medium text-slate-800">{fileName}</p>
                      ) : (
                        <>
                          <p className="text-sm font-medium text-slate-700">Click to upload your filled planner (.xlsx)</p>
                          <p className="text-xs text-slate-400 mt-1">Needs DATE, DAY and PERIOD-N columns</p>
                        </>
                      )}
                      <input ref={fileRef} type="file" accept=".xlsx,.xls" className="sr-only" onChange={handleFile} />
                    </div>

                    <button
                      type="button"
                      onClick={() => setShowTemplatePanel(v => !v)}
                      className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-800 font-medium transition-colors"
                    >
                      <Download size={12} /> Need a blank template?
                    </button>

                    <AnimatePresence>
                      {showTemplatePanel && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.2 }} className="overflow-hidden"
                        >
                          <div className="border border-slate-200 rounded-xl p-3.5 space-y-3 bg-slate-50">
                            <div className="flex items-center bg-white rounded-lg p-1 border border-slate-200 w-fit">
                              {(['week', 'month'] as PlannerMode[]).map(m => (
                                <button
                                  key={m} type="button"
                                  onClick={() => { setTplMode(m); setTplAnchor(m === 'week' ? todayISO : todayYM) }}
                                  className={`px-3 py-1 rounded-md text-xs font-semibold capitalize transition-all ${tplMode === m ? 'bg-emerald-500 text-white' : 'text-slate-500'}`}
                                >
                                  {m}ly
                                </button>
                              ))}
                            </div>
                            <div className="flex items-center gap-3 flex-wrap">
                              <input
                                type={tplMode === 'week' ? 'date' : 'month'}
                                value={tplAnchor}
                                onChange={e => setTplAnchor(e.target.value)}
                                className="border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs bg-white"
                              />
                              <div className="flex items-center gap-1.5 text-xs text-slate-500">
                                Periods
                                <input
                                  type="number" min={1} max={MAX_PERIODS} value={tplPeriodCount}
                                  onChange={e => setTplPeriodCount(Math.max(1, Math.min(MAX_PERIODS, Number(e.target.value))))}
                                  className="w-14 border border-slate-200 rounded-lg px-2 py-1.5 text-xs bg-white"
                                />
                              </div>
                              <button
                                type="button"
                                onClick={() => downloadPlannerTemplate({ mode: tplMode, anchor: tplAnchor, grade, subject, periodCount: tplPeriodCount })}
                                className="ml-auto flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-900 text-white text-xs font-semibold rounded-lg transition-colors"
                              >
                                <Download size={12} /> Download
                              </button>
                            </div>
                            <p className="text-[11px] text-slate-400">
                              Fill it in Excel, then upload it above — or use &ldquo;Draft in App&rdquo; instead.
                            </p>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>

                    {parseError && (
                      <p className="text-xs text-rose-600 flex items-center gap-1.5">
                        <AlertCircle size={13} /> {parseError}
                      </p>
                    )}
                  </>
                )}

                {parsed && !result && (
                  <div className="space-y-3">
                    {gradeSubjectInputs}
                    {assigneePicker}
                    {slotMapper(parsed.periodLabels, uploadSlotIndices, (i, slotIdx) =>
                      setUploadSlotIndices(prev => prev.map((v, j) => (j === i ? slotIdx : v)))
                    )}

                    <div className="flex items-center gap-2 text-xs">
                      <span className="px-2.5 py-1 bg-slate-100 text-slate-600 font-medium rounded-lg">
                        {parsed.rows.length} days
                      </span>
                      <span className="px-2.5 py-1 bg-emerald-50 text-emerald-700 font-medium rounded-lg">
                        {uploadFilledCount} tasks to create
                      </span>
                    </div>

                    <div className="border border-slate-200 rounded-xl overflow-hidden">
                      <div className="max-h-56 overflow-y-auto overflow-x-auto">
                        <table className="w-full text-xs min-w-[420px]">
                          <thead className="bg-slate-800 sticky top-0">
                            <tr>
                              <th className="text-left px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-slate-300">Date</th>
                              <th className="text-left px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-slate-300">Day</th>
                              {parsed.periodLabels.map((l, i) => (
                                <th key={i} className="text-left px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-slate-300">{l}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {parsed.rows.map((r, i) => (
                              <tr key={i} className="border-t border-slate-100 odd:bg-white even:bg-slate-50/60">
                                <td className="px-3 py-2 whitespace-nowrap text-slate-600">{r.date}</td>
                                <td className="px-3 py-2 text-slate-500">{r.day.slice(0, 3)}</td>
                                {r.periods.map((p, j) => (
                                  <td key={j} className="px-3 py-2 text-slate-700 max-w-[160px] truncate">{p || '—'}</td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                )}

                {resultBanner}
                {progressBar}
              </>
            )}

            {tab === 'draft' && (
              <>
                {!result && (
                  <>
                    <div className="flex items-center gap-3 flex-wrap">
                      <div className="flex items-center bg-slate-100 rounded-lg p-1">
                        {(['week', 'month'] as PlannerMode[]).map(m => (
                          <button
                            key={m} type="button"
                            onClick={() => handleDraftModeChange(m)}
                            className={`px-3 py-1.5 rounded-md text-xs font-semibold capitalize transition-all ${draftMode === m ? 'bg-white text-slate-700 shadow-sm' : 'text-slate-400'}`}
                          >
                            {m}ly
                          </button>
                        ))}
                      </div>
                      <input
                        type={draftMode === 'week' ? 'date' : 'month'}
                        value={draftAnchor}
                        onChange={e => handleDraftAnchorChange(e.target.value)}
                        className="border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs bg-white"
                      />
                      <div className="flex items-center gap-1.5 text-xs text-slate-500">
                        Periods
                        <input
                          type="number" min={1} max={MAX_PERIODS} value={draftPeriodCount}
                          onChange={e => handleDraftPeriodCount(Number(e.target.value))}
                          className="w-14 border border-slate-200 rounded-lg px-2 py-1.5 text-xs bg-white"
                        />
                      </div>
                    </div>

                    {gradeSubjectInputs}
                    {assigneePicker}
                    {slotMapper(defaultPeriodLabels(draftPeriodCount), draftSlotIndices, (i, slotIdx) =>
                      setDraftSlotIndices(prev => prev.map((v, j) => (j === i ? slotIdx : v)))
                    )}

                    <div className="border border-slate-200 rounded-xl overflow-hidden">
                      <div className="max-h-72 overflow-y-auto overflow-x-auto">
                        <table className="w-full text-xs min-w-[420px]">
                          <thead className="bg-slate-800 sticky top-0 z-10">
                            <tr>
                              <th className="text-left px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-slate-300 sticky left-0 bg-slate-800">Date</th>
                              <th className="text-left px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-slate-300">Day</th>
                              {defaultPeriodLabels(draftPeriodCount).map((l, i) => (
                                <th key={i} className="text-left px-2 py-2 text-[10px] font-bold uppercase tracking-widest text-slate-300 min-w-[130px]">{l}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {draftRows.map((r, i) => (
                              <tr key={r.date} className="border-t border-slate-100 odd:bg-white even:bg-slate-50/60">
                                <td className="px-3 py-2 whitespace-nowrap text-slate-600 font-medium sticky left-0 odd:bg-white even:bg-slate-50/60">{r.date.slice(5)}</td>
                                <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{r.day.slice(0, 3)}</td>
                                {r.periods.map((p, j) => (
                                  <td key={j} className="px-1 py-1">
                                    <input
                                      type="text" value={p}
                                      onChange={e => updateDraftCell(i, j, e.target.value)}
                                      placeholder="—"
                                      className="w-full border-0 bg-transparent px-2 py-1.5 text-xs focus:outline-none focus:bg-emerald-50 rounded-lg placeholder:text-slate-300"
                                    />
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-400">{draftFilledCount} period{draftFilledCount !== 1 ? 's' : ''} filled</span>
                      <button
                        type="button"
                        onClick={() => setDraftRows(emptyPlannerRows(draftMode, draftAnchor, draftPeriodCount))}
                        className="flex items-center gap-1 text-slate-400 hover:text-rose-500 transition-colors"
                      >
                        <Trash2 size={11} /> Clear grid
                      </button>
                    </div>
                  </>
                )}

                {resultBanner}
                {progressBar}
              </>
            )}
          </div>

          {/* Footer */}
          <div
            className="px-4 sm:px-5 py-3 border-t border-slate-100 flex-shrink-0 flex items-center gap-2"
            style={{ paddingBottom: 'max(12px, env(safe-area-inset-bottom))' }}
          >
            {result ? (
              <button
                onClick={onClose}
                className="w-full flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-900 text-white font-semibold py-3.5 rounded-2xl transition-all text-sm"
              >
                Done
              </button>
            ) : tab === 'upload' ? (
              <button
                onClick={handleUploadImport}
                disabled={!parsed || uploadFilledCount === 0 || submitting}
                className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 text-white font-semibold py-3.5 rounded-2xl transition-all disabled:opacity-50 text-sm shadow-lg shadow-emerald-500/25 active:scale-[0.98]"
              >
                {submitting ? <><RefreshCw size={16} className="animate-spin" /> Importing…</> : <>Import {uploadFilledCount || ''} Task{uploadFilledCount !== 1 ? 's' : ''}</>}
              </button>
            ) : (
              <>
                <button
                  onClick={handleDraftExport}
                  className="flex items-center justify-center gap-2 px-4 py-3.5 border border-slate-200 hover:bg-slate-50 text-slate-600 font-semibold rounded-2xl transition-all text-sm flex-shrink-0"
                >
                  <Download size={16} /> <span className="hidden sm:inline">Export</span>
                </button>
                <button
                  onClick={handleDraftSave}
                  disabled={draftFilledCount === 0 || submitting}
                  className="flex-1 flex items-center justify-center gap-2 bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 text-white font-semibold py-3.5 rounded-2xl transition-all disabled:opacity-50 text-sm shadow-lg shadow-emerald-500/25 active:scale-[0.98]"
                >
                  {submitting ? <><RefreshCw size={16} className="animate-spin" /> Saving…</> : <><Sparkles size={16} /> Save {draftFilledCount || ''} Task{draftFilledCount !== 1 ? 's' : ''}</>}
                </button>
              </>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )

  return typeof document !== 'undefined' ? createPortal(modal, document.body) : null
}
