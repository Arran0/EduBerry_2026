'use client'

// ============================================================
// Excel question-paper importer — lets a teacher upload a full question
// paper as a spreadsheet instead of typing every question into the builder.
// One row = one question. The column set mirrors exactly what the manual
// question editor supports (single/multiple-correct MCQ with any number of
// options, integer, true/false, short answer, subjective) so nothing about
// the existing question model has to change — a parsed row becomes the same
// QuestionInput the "Add question" flow produces, then addQuestionsBulk
// inserts them all in one shot via the exam mode's own scoring engine.
// ============================================================

import React, { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X, Upload, FileSpreadsheet, AlertCircle, CheckCircle2, Download, Loader2,
} from 'lucide-react'
import * as XLSX from 'xlsx'
import { addQuestionsBulk, ExamQuestion, QuestionInput, QuestionOption, CorrectAnswer } from '@/lib/exam'
import {
  ExamMode, QuestionKind, ScoringParams, getExamMode, QUESTION_KINDS, newQuestionDefaults,
} from '@/lib/examScoring'
import { EXAM } from '@/components/exam/examUi'

const MAX_OPTIONS = 8
const OPTION_LETTERS = Array.from({ length: MAX_OPTIONS }, (_, i) => String.fromCharCode(65 + i)) // A..H

const TYPE_ALIASES: Record<string, QuestionKind> = {
  'single correct': 'single_correct', 'single_correct': 'single_correct', 'single': 'single_correct',
  'mcq': 'single_correct', 'mcq (single)': 'single_correct', 'single correct mcq': 'single_correct',
  'multiple correct': 'multiple_correct', 'multiple_correct': 'multiple_correct', 'multi correct': 'multiple_correct',
  'multiple select': 'multiple_correct', 'mcq (multiple)': 'multiple_correct', 'multiple correct mcq': 'multiple_correct',
  'integer': 'integer', 'integer / numerical': 'integer', 'numerical': 'integer', 'number': 'integer', 'numeric': 'integer',
  'true/false': 'true_false', 'true / false': 'true_false', 'true false': 'true_false', 'truefalse': 'true_false',
  'tf': 'true_false', 'boolean': 'true_false',
  'short answer': 'short_answer', 'short_answer': 'short_answer', 'objective': 'short_answer',
  'fill in the blank': 'short_answer', 'fill in blank': 'short_answer',
  'subjective': 'subjective', 'essay': 'subjective', 'long answer': 'subjective', 'descriptive': 'subjective',
}

function parseKind(raw: unknown): QuestionKind | null {
  const s = String(raw ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
  return TYPE_ALIASES[s] ?? null
}

function parseBool(raw: string): boolean | null {
  const s = raw.trim().toLowerCase()
  if (['true', 't', 'yes', 'y', '1'].includes(s)) return true
  if (['false', 'f', 'no', 'n', '0'].includes(s)) return false
  return null
}

interface ParsedRow {
  rowNum: number
  kind: QuestionKind | null
  rawType: string
  prompt: string
  marks: number | null
  options: QuestionOption[]
  correctLetters: string[]
  rawCorrect: string
  wrong?: number
  partial?: number
  error?: string
}

function parseWorkbook(workbook: XLSX.WorkBook, mode: ExamMode): ParsedRow[] {
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })
  const cfg = getExamMode(mode)

  return rawRows.map((row, i): ParsedRow | null => {
    const get = (keys: string[]) => {
      for (const key of Object.keys(row)) {
        if (keys.some(k => key.trim().toLowerCase() === k.toLowerCase())) return row[key]
      }
      return ''
    }

    const rawType = String(get(['type', 'question type']) || '').trim()
    const prompt = String(get(['question', 'prompt', 'question text']) || '').trim()
    const rawMarksCell = get(['marks', 'mark'])
    const rawCorrect = String(get(['correct answer', 'correct_answer', 'answer', 'correct']) || '').trim()
    const rawWrongCell = get(['wrong marks', 'wrong', 'negative marks'])
    const rawPartialCell = get(['partial marks', 'partial'])

    if (!rawType && !prompt) return null // fully blank row

    const options: QuestionOption[] = []
    OPTION_LETTERS.forEach(letter => {
      const text = String(get([`option ${letter.toLowerCase()}`, `opt ${letter.toLowerCase()}`, `option${letter.toLowerCase()}`]) || '').trim()
      if (text) options.push({ id: letter.toLowerCase(), text })
    })

    const kind = parseKind(rawType)
    let error: string | undefined

    if (!prompt) error = 'Missing question text'
    else if (!kind) error = `Unknown type "${rawType}"`
    else if (!cfg.allowedKinds.includes(kind)) error = `"${QUESTION_KINDS[kind].label}" isn't allowed in ${cfg.label} mode`

    const marks = rawMarksCell === '' || rawMarksCell == null ? null : Number(rawMarksCell)
    if (!error && marks != null && !Number.isFinite(marks)) error = 'Invalid marks value'

    const correctLetters = rawCorrect
      .split(/[,\s/&]+/)
      .map(s => s.trim().toUpperCase())
      .filter(Boolean)

    if (!error && (kind === 'single_correct' || kind === 'multiple_correct')) {
      if (options.length < 2) error = 'Needs at least 2 options'
      else if (correctLetters.length === 0) error = 'Missing correct answer'
      else if (kind === 'single_correct' && correctLetters.length !== 1) error = 'Single Correct needs exactly one correct letter'
      else if (!correctLetters.every(l => options.some(o => o.id === l.toLowerCase()))) error = 'Correct answer references a missing option'
    }
    if (!error && kind === 'true_false') {
      if (parseBool(rawCorrect) === null) error = rawCorrect ? `Invalid True/False value "${rawCorrect}"` : 'Missing correct answer'
    }
    if (!error && kind === 'integer') {
      if (rawCorrect === '' || !Number.isFinite(Number(rawCorrect))) error = 'Missing or invalid numeric answer'
    }

    const wrong = rawWrongCell === '' || rawWrongCell == null ? undefined : Number(rawWrongCell)
    const partial = rawPartialCell === '' || rawPartialCell == null ? undefined : Number(rawPartialCell)

    return { rowNum: i + 2, kind, rawType, prompt, marks, options, correctLetters, rawCorrect, wrong, partial, error }
  }).filter((r): r is ParsedRow => r !== null)
}

/** Turn a validated row into the same QuestionInput the manual editor produces. */
function toQuestionInput(row: ParsedRow, mode: ExamMode): QuestionInput {
  const kind = row.kind as QuestionKind
  const def = newQuestionDefaults(mode, kind, row.marks ?? undefined)
  const params: ScoringParams = { ...def.scoring_params }
  if (mode === 'custom') {
    if (row.wrong != null && Number.isFinite(row.wrong)) params.wrong = row.wrong
    if (kind === 'multiple_correct' && row.partial != null && Number.isFinite(row.partial)) params.partial = row.partial
  }

  let options: QuestionOption[] | null = null
  let correct_answer: CorrectAnswer = null
  switch (kind) {
    case 'single_correct':
    case 'multiple_correct':
      options = row.options
      correct_answer = row.correctLetters.map(l => l.toLowerCase())
      break
    case 'true_false':
      correct_answer = parseBool(row.rawCorrect) ?? true
      break
    case 'integer':
      correct_answer = Number(row.rawCorrect)
      break
    case 'short_answer':
      correct_answer = row.rawCorrect || ''
      break
    default:
      correct_answer = null
  }

  return {
    type: def.type,
    prompt: row.prompt,
    marks: def.marks,
    options,
    correct_answer,
    multiple_select: def.multiple_select,
    scoring_strategy: def.scoring_strategy,
    scoring_params: params,
  }
}

function correctSummary(row: ParsedRow): string {
  if (!row.kind) return '—'
  switch (row.kind) {
    case 'single_correct':
    case 'multiple_correct':
      return row.correctLetters.join(', ') || '—'
    case 'true_false':
      return row.rawCorrect || '—'
    case 'integer':
      return row.rawCorrect || '—'
    case 'short_answer':
      return row.rawCorrect ? 'reference set' : 'manual'
    default:
      return 'manual'
  }
}

function downloadTemplate(mode: ExamMode) {
  const cfg = getExamMode(mode)
  const headers = ['Type', 'Question', 'Marks', ...OPTION_LETTERS.map(l => `Option ${l}`), 'Correct Answer']
  if (mode === 'custom') headers.push('Wrong Marks', 'Partial Marks')

  const exampleFor: Record<QuestionKind, (string | number)[]> = {
    single_correct: [
      'Single Correct', 'Which gas is most abundant in Earth’s atmosphere?', newQuestionDefaults(mode, 'single_correct').marks,
      'Oxygen', 'Nitrogen', 'Carbon dioxide', 'Argon', '', '', '', '', 'B',
    ],
    multiple_correct: [
      'Multiple Correct', 'Which of these are prime numbers?', newQuestionDefaults(mode, 'multiple_correct').marks,
      '2', '3', '4', '9', '', '', '', '', 'A, B',
    ],
    integer: [
      'Integer', 'What is 7 × 6?', newQuestionDefaults(mode, 'integer').marks,
      '', '', '', '', '', '', '', '', '42',
    ],
    true_false: [
      'True/False', 'The sun rises in the west.', newQuestionDefaults(mode, 'true_false').marks,
      '', '', '', '', '', '', '', '', 'False',
    ],
    short_answer: [
      'Short Answer', 'Name the capital of France.', newQuestionDefaults(mode, 'short_answer').marks,
      '', '', '', '', '', '', '', '', 'Paris',
    ],
    subjective: [
      'Subjective', 'Explain the causes of the French Revolution in your own words.', newQuestionDefaults(mode, 'subjective').marks,
      '', '', '', '', '', '', '', '', '',
    ],
  }

  const rows = cfg.allowedKinds.map(kind => {
    const base = exampleFor[kind]
    if (mode === 'custom') return [...base, 0, kind === 'multiple_correct' ? 0 : '']
    return base
  })

  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Questions')

  const instructions = [
    ['How to fill this sheet'],
    ['One row = one question.'],
    [`Type must be one of: ${cfg.allowedKinds.map(k => QUESTION_KINDS[k].label).join(', ')} (for ${cfg.label} mode).`],
    ['Option A..H — fill only as many as the question needs; leave the rest blank.'],
    ['Correct Answer:'],
    ['  Single/Multiple Correct — the option letter(s), e.g. "B" or "A, C".'],
    ['  True/False — "True" or "False".'],
    ['  Integer — the numeric answer, e.g. "42".'],
    ['  Short Answer — a reference answer (still graded manually).'],
    ['  Subjective — leave blank; graded manually.'],
    ['Marks — leave blank to use the mode default shown in the example row.'],
  ]
  const wsInfo = XLSX.utils.aoa_to_sheet(instructions)
  XLSX.utils.book_append_sheet(wb, wsInfo, 'Instructions')

  XLSX.writeFile(wb, `${cfg.id}-question-import-template.xlsx`)
}

export default function ExcelQuestionImportModal({
  examId, mode, onClose, onImported,
}: {
  examId: string
  mode: ExamMode
  onClose: () => void
  onImported: (questions: ExamQuestion[]) => void
}) {
  const cfg = getExamMode(mode)
  const fileRef = useRef<HTMLInputElement>(null)
  const [rows, setRows] = useState<ParsedRow[]>([])
  const [fileName, setFileName] = useState('')
  const [parseError, setParseError] = useState('')
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<{ count: number } | null>(null)

  const validRows = rows.filter(r => !r.error)
  const invalidRows = rows.filter(r => r.error)

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    setParseError('')
    setResult(null)

    const reader = new FileReader()
    reader.onload = ev => {
      try {
        const data = new Uint8Array(ev.target!.result as ArrayBuffer)
        const workbook = XLSX.read(data, { type: 'array' })
        const parsed = parseWorkbook(workbook, mode)
        if (parsed.length === 0) {
          setParseError('No question rows found. Check the file has a Type and Question column.')
          setRows([])
          return
        }
        setRows(parsed)
      } catch {
        setParseError('Could not read file. Make sure it is a valid .xlsx or .csv file.')
        setRows([])
      }
    }
    reader.readAsArrayBuffer(file)
    e.target.value = ''
  }

  const handleImport = async () => {
    if (validRows.length === 0) return
    setImporting(true)
    setParseError('')
    const inputs = validRows.map(r => toQuestionInput(r, mode))
    const inserted = await addQuestionsBulk(examId, inputs)
    setImporting(false)
    if (inserted.length === 0) {
      setParseError('Import failed. Please try again.')
      return
    }
    setResult({ count: inserted.length })
    onImported(inserted)
  }

  const handleClose = () => {
    if (importing) return
    onClose()
  }

  const modal = (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
        className="fixed inset-0 z-[60] flex items-end sm:items-center sm:justify-center sm:p-4 bg-black/50 backdrop-blur-sm"
        onClick={handleClose}
      >
        <motion.div
          initial={{ y: '100%', opacity: 0.6 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: '100%', opacity: 0.6 }}
          transition={{ type: 'tween', duration: 0.36, ease: [0.32, 0.72, 0, 1] }}
          onClick={e => e.stopPropagation()}
          className="bg-white w-full sm:max-w-2xl max-h-[92dvh] sm:max-h-[85vh] flex flex-col shadow-2xl overflow-hidden"
        >
          {/* Header */}
          <div className="flex-shrink-0 bg-gradient-to-br from-[#27272A] to-[#18181B] px-5 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 bg-white/10 ring-1 ring-inset ring-[#B8983C]/70 flex items-center justify-center shrink-0">
                <FileSpreadsheet size={17} className="text-[#D4BC6A]" />
              </div>
              <div>
                <h2 className="text-base font-bold text-white leading-tight">Import questions from Excel</h2>
                <p className="text-[11px] text-[#A1A1AA]">{cfg.label} mode &middot; {cfg.allowedKinds.map(k => QUESTION_KINDS[k].label).join(', ')}</p>
              </div>
            </div>
            <button onClick={handleClose} className="h-8 w-8 flex items-center justify-center text-[#A1A1AA] hover:text-white hover:bg-white/10 transition-colors">
              <X size={18} />
            </button>
          </div>

          {/* Body */}
          <div className="overflow-y-auto flex-1 p-5 space-y-4" style={{ backgroundColor: '#FDFCF9' }}>
            {result ? (
              <div className={`${EXAM.card} p-4 flex items-center gap-3`}>
                <CheckCircle2 size={20} className="text-emerald-600 shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-[#18181B]">Imported {result.count} question{result.count !== 1 ? 's' : ''}</p>
                  <p className="text-xs text-[#71717A]">They&rsquo;ve been added to the end of this exam&rsquo;s question list.</p>
                </div>
              </div>
            ) : (
              <>
                <div
                  className="border-2 border-dashed border-[#E4E1D8] hover:border-[#B8983C] p-6 text-center cursor-pointer transition-colors bg-white"
                  onClick={() => fileRef.current?.click()}
                >
                  <div className="w-10 h-10 border border-[#E4E1D8] bg-[#F4F2EC] flex items-center justify-center mx-auto mb-3">
                    <Upload size={18} className="text-[#8A8578]" />
                  </div>
                  {fileName ? (
                    <p className="text-sm font-medium text-[#18181B]">{fileName}</p>
                  ) : (
                    <>
                      <p className="text-sm font-medium text-[#27272A]">Click to upload .xlsx or .csv</p>
                      <p className="text-xs text-[#A1A1AA] mt-1">One row per question &middot; Type, Question, Options, Correct Answer</p>
                    </>
                  )}
                  <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="sr-only" onChange={handleFile} />
                </div>

                <button
                  type="button"
                  onClick={() => downloadTemplate(mode)}
                  className="flex items-center gap-1.5 text-xs text-[#8A8578] hover:text-[#18181B] font-medium transition-colors"
                >
                  <Download size={12} /> Download {cfg.label} template
                </button>

                {parseError && (
                  <p className="text-xs text-rose-600 flex items-center gap-1.5">
                    <AlertCircle size={13} /> {parseError}
                  </p>
                )}
              </>
            )}

            {/* Preview table */}
            {rows.length > 0 && !result && (
              <div className="space-y-2">
                <div className="flex flex-wrap gap-2 text-xs">
                  <span className="px-2.5 py-1 bg-white border border-[#E4E1D8] text-[#52525B] font-medium">
                    {validRows.length} ready to import
                  </span>
                  {invalidRows.length > 0 && (
                    <span className="px-2.5 py-1 bg-rose-50 border border-rose-200 text-rose-700 font-medium">
                      {invalidRows.length} invalid &middot; skipped
                    </span>
                  )}
                </div>

                <div className="border border-[#E4E1D8] overflow-hidden">
                  <div className="max-h-64 overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-[#27272A] sticky top-0">
                        <tr>
                          <th className="text-left px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-[#A1A1AA]">Row</th>
                          <th className="text-left px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-[#A1A1AA]">Type</th>
                          <th className="text-left px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-[#A1A1AA]">Question</th>
                          <th className="text-left px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-[#A1A1AA]">Marks</th>
                          <th className="text-left px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-[#A1A1AA]">Correct</th>
                          <th className="text-left px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-[#A1A1AA]">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map(r => (
                          <tr key={r.rowNum} className={`border-t border-[#F0EEE7] ${r.error ? 'bg-rose-50/60' : 'bg-white'}`}>
                            <td className="px-3 py-2 text-[#A1A1AA] tabular-nums">{r.rowNum}</td>
                            <td className="px-3 py-2 text-[#52525B]">{r.kind ? QUESTION_KINDS[r.kind].label : r.rawType || '—'}</td>
                            <td className="px-3 py-2 truncate max-w-[220px] text-[#52525B]">{r.prompt || '—'}</td>
                            <td className="px-3 py-2 text-[#71717A] tabular-nums">{r.marks ?? (r.kind ? newQuestionDefaults(mode, r.kind).marks : '—')}</td>
                            <td className="px-3 py-2 text-[#71717A]">{correctSummary(r)}</td>
                            <td className="px-3 py-2">
                              {r.error ? (
                                <span className="text-rose-600 flex items-center gap-1"><AlertCircle size={11} />{r.error}</span>
                              ) : (
                                <span className="text-emerald-600 flex items-center gap-1"><CheckCircle2 size={11} />Ready</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between px-5 py-4 border-t border-[#F0EEE7] bg-white flex-shrink-0">
            <button
              onClick={handleClose}
              className="h-8 px-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-[#8A8578] hover:text-[#18181B] hover:bg-[#FAF9F6] transition-colors"
            >
              {result ? 'Close' : 'Cancel'}
            </button>
            {!result && (
              <button
                onClick={handleImport}
                disabled={validRows.length === 0 || importing}
                className={EXAM.goldBtn}
              >
                {importing ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                {importing ? 'Importing…' : `Import ${validRows.length || ''} question${validRows.length === 1 ? '' : 's'}`}
              </button>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )

  return typeof document !== 'undefined' ? createPortal(modal, document.body) : null
}
