'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Plus, Trash2, Save, Loader2, ChevronUp, ChevronDown, GripVertical, Check,
  Lock, Settings2, FileSpreadsheet, ImagePlus, X,
} from 'lucide-react'
import {
  Exam, ExamQuestion, QuestionOption, QuestionInput,
  fetchExamById, updateExam, fetchQuestions, addQuestion, updateQuestionsBulk,
  deleteQuestion, reorderQuestions, uploadExamQuestionImage,
  examPhase, isExamClosed, isFullyAutoGraded, EXAM_PHASE_META,
} from '@/lib/exam'
import {
  ExamMode, QuestionKind, ScoringParams,
  getExamMode, QUESTION_KINDS, kindFromQuestion, newQuestionDefaults, scoringSummary,
} from '@/lib/examScoring'
import {
  ExamSettingsForm, SettingsState, settingsFromExam, settingsToInput, settingsError,
  type AutoGradable,
} from '@/components/exam/ExamSettingsForm'
import QuestionTypePicker from '@/components/exam/QuestionTypePicker'
import ExcelQuestionImportModal from '@/components/exam/ExcelQuestionImportModal'
import AudienceEditor from '@/components/exam/AudienceEditor'
import {
  EXAM, Skeleton, StatStrip, QuestionImage, ExamPhaseChip, ImmediateResultsChip, PHASE_SHORT,
} from '@/components/exam/examUi'
import { FormattedTextarea, FormattedInput } from '@/components/exam/FormattedField'

function newOptionId(existing: QuestionOption[]): string {
  const used = new Set(existing.map(o => o.id))
  for (let i = 0; i < 26; i++) {
    const id = String.fromCharCode(97 + i)
    if (!used.has(id)) return id
  }
  return crypto.randomUUID().slice(0, 4)
}

/** Build the empty question payload for a freshly-chosen kind under a mode. */
function blankQuestionForKind(mode: ExamMode, kind: QuestionKind): QuestionInput {
  const d = newQuestionDefaults(mode, kind)
  const base = {
    type: d.type,
    prompt: '',
    marks: d.marks,
    multiple_select: d.multiple_select,
    scoring_strategy: d.scoring_strategy,
    scoring_params: d.scoring_params,
  }
  switch (kind) {
    case 'single_correct':
    case 'multiple_correct':
      return { ...base, options: [{ id: 'a', text: '' }, { id: 'b', text: '' }], correct_answer: [] }
    case 'integer':
      return { ...base, options: null, correct_answer: null }
    case 'true_false':
      return { ...base, options: null, correct_answer: true }
    case 'short_answer':
      return { ...base, options: null, correct_answer: '' }
    case 'subjective':
    default:
      return { ...base, options: null, correct_answer: null }
  }
}

/** The subset of a question the "Save questions" action persists. */
function questionToInput(q: ExamQuestion): Partial<QuestionInput> {
  return {
    prompt: q.prompt,
    marks: q.marks,
    type: q.type,
    multiple_select: q.multiple_select,
    options: q.options,
    correct_answer: q.correct_answer,
    scoring_strategy: q.scoring_strategy,
    scoring_params: q.scoring_params,
    image_url: q.image_url,
  }
}

export default function ExamBuilder({ examId }: { examId: string }) {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [exam, setExam] = useState<Exam | null>(null)
  const [settings, setSettings] = useState<SettingsState | null>(null)
  const [questions, setQuestions] = useState<ExamQuestion[]>([])
  const [questionsDirty, setQuestionsDirty] = useState(false)
  const [savingSettings, setSavingSettings] = useState(false)
  const [settingsSaved, setSettingsSaved] = useState(false)
  const [savingQuestions, setSavingQuestions] = useState(false)
  const [questionsSaved, setQuestionsSaved] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    // Exam settings and questions are independent — fetch in parallel.
    const [ex, qs] = await Promise.all([fetchExamById(examId), fetchQuestions(examId)])
    setExam(ex)
    if (ex) setSettings(settingsFromExam(ex))
    setQuestions(qs)
    setQuestionsDirty(false)
    setLoading(false)
  }, [examId])

  useEffect(() => { load() }, [load])

  const mode: ExamMode = settings?.exam_mode ?? exam?.exam_mode ?? 'school'
  const modeCfg = getExamMode(mode)
  const modeLabel = mode !== 'school' ? modeCfg.label : null
  const totalMarks = useMemo(() => questions.reduce((s, q) => s + Number(q.marks || 0), 0), [questions])

  // Immediate results need a fully auto-graded paper.
  const autoGradable: AutoGradable = useMemo(() => {
    if (questions.length === 0) return 'no_questions'
    return isFullyAutoGraded(questions) ? 'yes' : 'has_manual'
  }, [questions])

  // Adding a manual question to an immediate-results exam takes the option
  // away again — drop the setting so it can't be saved in an invalid state.
  useEffect(() => {
    if (autoGradable !== 'yes') {
      setSettings(prev => (prev?.immediate_results ? { ...prev, immediate_results: false } : prev))
    }
  }, [autoGradable])

  // Editing is locked once the exam closes (results published).
  const locked = !!exam && isExamClosed(exam)
  const phase = exam ? examPhase(exam) : 'scheduled'

  const handleSaveSettings = async () => {
    if (!settings) return
    const invalid = settingsError(settings)
    if (invalid) {
      setSaveError(invalid)
      return
    }
    setSaveError(null)
    setSavingSettings(true)
    setSettingsSaved(false)
    await updateExam(examId, settingsToInput(settings))
    const fresh = await fetchExamById(examId)
    if (fresh) setExam(fresh)
    setSavingSettings(false)
    setSettingsSaved(true)
    setTimeout(() => setSettingsSaved(false), 2000)
  }

  const createQuestion = async (kind: QuestionKind) => {
    setPickerOpen(false)
    const q = await addQuestion(examId, blankQuestionForKind(mode, kind))
    if (q) setQuestions(prev => [...prev, q])
  }

  const handleAddQuestion = () => {
    if (modeCfg.allowedKinds.length === 1) {
      createQuestion(modeCfg.allowedKinds[0])
    } else {
      setPickerOpen(true)
    }
  }

  const handleDeleteQuestion = async (id: string) => {
    await deleteQuestion(id)
    setQuestions(prev => prev.filter(q => q.id !== id))
  }

  const handleMove = async (index: number, dir: -1 | 1) => {
    const target = index + dir
    if (target < 0 || target >= questions.length) return
    const next = [...questions]
    ;[next[index], next[target]] = [next[target], next[index]]
    setQuestions(next)
    await reorderQuestions(examId, next.map(q => q.id))
  }

  const handleQuestionChange = (id: string, patch: Partial<ExamQuestion>) => {
    setQuestions(prev => prev.map(q => (q.id === id ? { ...q, ...patch } : q)))
    setQuestionsDirty(true)
  }

  const handleSaveQuestions = async () => {
    setSavingQuestions(true)
    setQuestionsSaved(false)
    const ok = await updateQuestionsBulk(
      examId,
      questions.map(q => ({ id: q.id, input: questionToInput(q) })),
    )
    setSavingQuestions(false)
    if (ok) {
      setQuestionsDirty(false)
      setQuestionsSaved(true)
      setTimeout(() => setQuestionsSaved(false), 2000)
    }
  }

  const handleDone = () => {
    if (questionsDirty && !confirm('You have unsaved question edits. Leave without saving?')) return
    router.push(`/more/exam/${examId}`)
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }
  if (!exam || !settings) {
    return <div className={`${EXAM.cardBleed} p-10 text-center text-[#71717A]`}>Exam not found.</div>
  }

  return (
    <div className="space-y-6">
      {/* Header — mirrors the Post-Exam Manager: eyebrow label, exam title and
          metadata chips. Exams are never closed by hand: they close when
          results are published, or at an immediate-results exam's auto-close. */}
      <div className="flex items-start gap-3 min-w-0 pb-4 border-b border-[#E4E1D8]">
        <div className={`w-11 h-11 ${EXAM.iconTile}`}>
          <Settings2 size={22} className="text-[#D4BC6A]" />
        </div>
        <div className="min-w-0">
          <p className={EXAM.eyebrow}>Pre-Exam Manager</p>
          <h1 className="font-display text-2xl font-bold text-[#18181B] truncate mt-1">{exam.title}</h1>
          <div className="flex flex-wrap items-center gap-1.5 mt-2">
            {exam.subject && <span className={EXAM.tag}>{exam.subject}</span>}
            {modeLabel && <span className={EXAM.tagGold}>{modeLabel}</span>}
            <ExamPhaseChip phase={phase} />
            {exam.immediate_results && <ImmediateResultsChip />}
          </div>
        </div>
      </div>

      <div>
        <StatStrip
          items={[
            { label: 'Questions', value: questions.length },
            { label: 'Total marks', value: totalMarks },
            { label: 'Duration', value: exam.duration_minutes ? `${exam.duration_minutes}m` : '—' },
            { label: 'Stage', value: PHASE_SHORT[phase], accent: true },
          ]}
        />
        <p className="mt-2 text-[11px] text-[#A8A29A]">{EXAM_PHASE_META[phase].hint}</p>
      </div>

      {locked && (
        <div className="flex items-start gap-2 border border-[#E4E1D8] bg-[#FAF9F6] px-4 py-3 text-sm text-[#71717A]">
          <Lock size={15} className="mt-0.5 shrink-0 text-[#B8983C]" />
          <span>
            This exam is closed — results are published, so its settings and questions are locked.
          </span>
        </div>
      )}

      {/* Everything below is editing surface — inert once the exam is closed. */}
      <div
        className={`space-y-6 ${locked ? 'opacity-60 pointer-events-none select-none' : ''}`}
        aria-disabled={locked}
      >
      {/* Settings */}
      <div>
        <div className={EXAM.sectionHeader}>
          <h2 className={EXAM.sectionLabel}>Exam settings</h2>
          <button
            onClick={handleSaveSettings}
            disabled={savingSettings}
            className={EXAM.darkBtn}
          >
            {savingSettings ? <Loader2 size={14} className="animate-spin" /> : settingsSaved ? <Check size={14} /> : <Save size={14} />}
            {settingsSaved ? 'Saved' : 'Save'}
          </button>
        </div>
        <ExamSettingsForm value={settings} onChange={setSettings} autoGradable={autoGradable} />
        {saveError && <p className="mt-2 text-xs text-rose-500">{saveError}</p>}
      </div>

      {/* Participants */}
      <div>
        <div className={EXAM.sectionHeader}>
          <h2 className={EXAM.sectionLabel}>Participants</h2>
        </div>
        <div className={`${EXAM.cardBleed} p-4`}>
          <AudienceEditor examId={examId} />
        </div>
      </div>

      {/* Questions */}
      <div>
        <div className={EXAM.sectionHeader}>
          <h2 className={EXAM.sectionLabel}>
            Questions <span className="ml-1 font-semibold text-[#A8A29A] tabular-nums">{questions.length} · {totalMarks} marks</span>
          </h2>
          <div className="flex items-center gap-2">
            {questionsDirty && !savingQuestions && (
              <span className="hidden sm:inline text-[10px] font-bold uppercase tracking-[0.12em] text-[#B8983C]">Unsaved</span>
            )}
            <button onClick={() => setImportOpen(true)} className={EXAM.ghostBtnSm}>
              <FileSpreadsheet size={13} /> Import
            </button>
            {questions.length > 0 && (
              <button
                onClick={handleSaveQuestions}
                disabled={savingQuestions || !questionsDirty}
                className={EXAM.darkBtnSm}
              >
                {savingQuestions ? <Loader2 size={13} className="animate-spin" /> : questionsSaved ? <Check size={13} /> : <Save size={13} />}
                {savingQuestions ? 'Saving…' : questionsSaved ? 'Saved' : 'Save questions'}
              </button>
            )}
          </div>
        </div>
        <div className="space-y-3">
          {questions.map((q, idx) => (
            <QuestionEditor
              key={q.id}
              index={idx}
              total={questions.length}
              mode={mode}
              question={q}
              onChange={patch => handleQuestionChange(q.id, patch)}
              onDelete={() => handleDeleteQuestion(q.id)}
              onMove={dir => handleMove(idx, dir)}
            />
          ))}
          {questions.length === 0 && (
            <div className={`${EXAM.cardBleed} px-4 py-10 text-center`}>
              <p className="text-sm font-semibold text-[#18181B]">No questions yet</p>
              <p className="mt-1 text-xs text-[#A8A29A]">Add them one at a time, or import a whole paper from Excel.</p>
            </div>
          )}
        </div>
        <button
          onClick={handleAddQuestion}
          className="mt-3 w-full flex items-center justify-center gap-2 h-11 border border-dashed border-[#D8D2C4] bg-white text-xs font-bold uppercase tracking-[0.1em] text-[#8A8578] hover:border-[#B8983C] hover:text-[#B8983C] hover:bg-[#FAF9F6] transition-colors"
        >
          <Plus size={15} /> Add question
        </button>
      </div>
      </div>

      <div className="flex justify-end border-t border-[#E4E1D8] pt-4">
        <button onClick={handleDone} className={EXAM.goldBtn}>
          Done
        </button>
      </div>

      <QuestionTypePicker
        open={pickerOpen}
        mode={mode}
        onPick={createQuestion}
        onClose={() => setPickerOpen(false)}
      />

      {importOpen && (
        <ExcelQuestionImportModal
          examId={examId}
          mode={mode}
          onClose={() => setImportOpen(false)}
          onImported={imported => setQuestions(prev => [...prev, ...imported])}
        />
      )}
    </div>
  )
}

// ── Per-question editor ──
// Fully controlled: every edit reports straight back into the parent's
// `questions` array via onChange, and nothing is written to the database
// until the single "Save questions" button (in ExamBuilder) is pressed.
// Reordering and deleting still happen immediately — only content edits
// (prompt, options, answers, scoring, image) are batched.

function QuestionEditor({
  index, total, mode, question, onChange, onDelete, onMove,
}: {
  index: number
  total: number
  mode: ExamMode
  question: ExamQuestion
  onChange: (patch: Partial<ExamQuestion>) => void
  onDelete: () => void
  onMove: (dir: -1 | 1) => void
}) {
  const kind = kindFromQuestion(question.type, question.multiple_select)
  const meta = QUESTION_KINDS[kind]
  const modeCfg = getExamMode(mode)
  // School & Custom let the teacher tune marks; Custom additionally exposes
  // the wrong/partial penalties. Fixed modes (NEET/JEE) show scoring read-only.
  const editable = modeCfg.scoringEditable
  const fullCustom = mode === 'custom'

  const fileRef = useRef<HTMLInputElement>(null)
  const [uploadingImage, setUploadingImage] = useState(false)
  const [imageError, setImageError] = useState('')

  const field = EXAM.field
  const numField = 'w-20 h-8 bg-white border border-[#E4E1D8] px-2 text-sm tabular-nums text-[#18181B] focus:outline-none focus:border-[#B8983C] focus:ring-1 focus:ring-[#B8983C]/25 transition-colors'
  const options = question.options ?? []
  const correct = question.correct_answer
  const correctIds: string[] = Array.isArray(correct) ? correct : []
  const isMcq = kind === 'single_correct' || kind === 'multiple_correct'
  const params: ScoringParams = question.scoring_params ?? { correct: question.marks, wrong: 0, blank: 0 }

  const toggleCorrect = (id: string) => {
    if (kind === 'multiple_correct') {
      onChange({ correct_answer: correctIds.includes(id) ? correctIds.filter(x => x !== id) : [...correctIds, id] })
    } else {
      onChange({ correct_answer: [id] })
    }
  }

  const setParam = (patch: Partial<ScoringParams>) => {
    const next: ScoringParams = { ...params, ...patch }
    const change: Partial<ExamQuestion> = { scoring_params: next }
    if (patch.correct !== undefined) change.marks = Number(patch.correct) || 0
    onChange(change)
  }

  const handlePickImage = () => fileRef.current?.click()

  const handleImageFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) { setImageError('Please choose an image file.'); return }
    setImageError('')
    setUploadingImage(true)
    const url = await uploadExamQuestionImage(file, question.exam_id)
    setUploadingImage(false)
    if (!url) { setImageError('Upload failed. Please try again.'); return }
    onChange({ image_url: url })
  }

  return (
    <div className={EXAM.cardBleed}>
      {/* Question header band — index, kind, and the reorder/delete controls. */}
      <div className="flex items-center justify-between gap-2 h-10 px-3 bg-[#FAF9F6] border-b border-[#E4E1D8]">
        <div className="flex items-center gap-2 min-w-0">
          <GripVertical size={14} className="text-[#C7C2B6] shrink-0" />
          <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#18181B] tabular-nums">Q{index + 1}</span>
          <span className={EXAM.tagGold}>{meta.label}</span>
        </div>
        <div className="flex items-center">
          <button onClick={() => onMove(-1)} disabled={index === 0} title="Move up" className="h-7 w-7 flex items-center justify-center text-[#A8A29A] hover:text-[#18181B] hover:bg-white disabled:opacity-25 transition-colors"><ChevronUp size={15} /></button>
          <button onClick={() => onMove(1)} disabled={index === total - 1} title="Move down" className="h-7 w-7 flex items-center justify-center text-[#A8A29A] hover:text-[#18181B] hover:bg-white disabled:opacity-25 transition-colors"><ChevronDown size={15} /></button>
          <button onClick={onDelete} title="Delete question" className="h-7 w-7 flex items-center justify-center text-[#C7B6B6] hover:text-rose-600 hover:bg-rose-50 transition-colors"><Trash2 size={15} /></button>
        </div>
      </div>

      <div className="p-4">
      <FormattedTextarea
        className={`${EXAM.textarea} mb-3`}
        rows={2}
        value={question.prompt}
        onChange={text => onChange({ prompt: text })}
        placeholder="Question prompt — paste from Word/Docs, or Ctrl/Cmd+. superscript, Ctrl/Cmd+, subscript"
      />

      {/* Attached figure — always shown expanded, never a collapsed thumbnail. */}
      <div className="mb-3">
        {question.image_url ? (
          <div className="relative">
            <QuestionImage src={question.image_url} alt={`Figure for question ${index + 1}`} />
            <button
              onClick={() => onChange({ image_url: null })}
              title="Remove image"
              className="absolute top-2 right-2 h-7 w-7 flex items-center justify-center bg-black/70 text-white hover:bg-black transition-colors"
            >
              <X size={14} />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={handlePickImage}
            disabled={uploadingImage}
            className="w-full flex items-center justify-center gap-2 h-9 border border-dashed border-[#E4E1D8] text-[11px] font-semibold uppercase tracking-[0.08em] text-[#A8A29A] hover:border-[#B8983C] hover:text-[#B8983C] transition-colors disabled:opacity-60"
          >
            {uploadingImage ? <Loader2 size={14} className="animate-spin" /> : <ImagePlus size={14} />}
            {uploadingImage ? 'Uploading…' : 'Attach a figure'}
          </button>
        )}
        <input ref={fileRef} type="file" accept="image/*" className="sr-only" onChange={handleImageFile} />
        {imageError && <p className={EXAM.error}>{imageError}</p>}
      </div>

      {isMcq && (
        <div className="space-y-2 mb-3">
          {options.map(opt => (
            <div key={opt.id} className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => toggleCorrect(opt.id)}
                title="Mark correct"
                className={`w-9 h-9 shrink-0 flex items-center justify-center border transition-colors ${
                  correctIds.includes(opt.id)
                    ? 'bg-emerald-600 border-emerald-600 text-white'
                    : 'border-[#E4E1D8] text-transparent hover:border-emerald-400 hover:text-emerald-300'
                }`}
              >
                <Check size={14} />
              </button>
              <FormattedInput
                wrapperClassName="flex-1"
                className={field}
                value={opt.text}
                onChange={text => onChange({ options: options.map(o => o.id === opt.id ? { ...o, text } : o) })}
                placeholder={`Option ${opt.id.toUpperCase()}`}
              />
              <button
                onClick={() => onChange({
                  options: options.filter(o => o.id !== opt.id),
                  correct_answer: correctIds.filter(x => x !== opt.id),
                })}
                title="Remove option"
                className="h-9 w-9 shrink-0 flex items-center justify-center text-[#C7C2B6] hover:text-rose-600 hover:bg-rose-50 transition-colors"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          <button
            onClick={() => onChange({ options: [...options, { id: newOptionId(options), text: '' }] })}
            className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#B8983C] hover:text-[#9C7F2C] transition-colors"
          >
            + Add option
          </button>
        </div>
      )}

      {kind === 'integer' && (
        <input
          className={`${field} mb-3`}
          type="number"
          value={typeof correct === 'number' ? String(correct) : ''}
          onChange={e => onChange({ correct_answer: e.target.value === '' ? null : Number(e.target.value) })}
          placeholder="Correct numeric answer"
        />
      )}

      {kind === 'true_false' && (
        <div className="flex mb-3 border border-[#E4E1D8]">
          {[{ l: 'True', v: true }, { l: 'False', v: false }].map((o, i) => (
            <button
              key={o.l}
              onClick={() => onChange({ correct_answer: o.v })}
              className={`flex-1 h-9 text-xs font-bold uppercase tracking-[0.1em] transition-colors ${i > 0 ? 'border-l border-[#E4E1D8]' : ''} ${
                correct === o.v ? 'bg-emerald-600 text-white' : 'bg-white text-[#8A8578] hover:bg-[#FAF9F6] hover:text-[#18181B]'
              }`}
            >
              {o.l}
            </button>
          ))}
        </div>
      )}

      {kind === 'short_answer' && (
        <FormattedInput
          className={`${field} mb-3`}
          value={typeof correct === 'string' ? correct : ''}
          onChange={text => onChange({ correct_answer: text })}
          placeholder="Reference answer (graded manually)"
        />
      )}

      {kind === 'subjective' && (
        <p className="text-xs text-[#A8A29A] mb-3">Subjective — graded manually, no preset answer.</p>
      )}
      </div>

      {/* Scoring — a footer band, so every question card ends on the same line. */}
      <div className="flex flex-wrap items-end gap-4 px-4 py-2.5 bg-[#FAF9F6] border-t border-[#E4E1D8]">
        {!editable ? (
          <div className="flex items-center gap-2">
            <span className={EXAM.label}>Scoring</span>
            <span className="text-xs font-semibold text-[#52525B] tabular-nums">
              {scoringSummary(question.scoring_strategy ?? 'manual', params)}
            </span>
          </div>
        ) : meta.manual ? (
          <div className="flex items-end gap-2">
            <div>
              <label className={EXAM.fieldLabel}>Marks</label>
              <input
                type="number" min={0}
                className={numField}
                value={String(params.correct)}
                onChange={e => setParam({ correct: Number(e.target.value) || 0 })}
              />
            </div>
            <span className="pb-2 text-[11px] text-[#A8A29A]">graded manually</span>
          </div>
        ) : (
          <>
            <div>
              <label className={EXAM.fieldLabel}>Correct (+)</label>
              <input
                type="number"
                className={numField}
                value={String(params.correct)}
                onChange={e => setParam({ correct: Number(e.target.value) || 0 })}
              />
            </div>
            {fullCustom && (
              <div>
                <label className={EXAM.fieldLabel}>Wrong (−)</label>
                <input
                  type="number"
                  className={numField}
                  value={String(params.wrong)}
                  onChange={e => setParam({ wrong: Number(e.target.value) || 0 })}
                />
              </div>
            )}
            {fullCustom && kind === 'multiple_correct' && (
              <div>
                <label className={EXAM.fieldLabel}>Partial</label>
                <input
                  type="number"
                  className={numField}
                  value={String(params.partial ?? 0)}
                  onChange={e => setParam({ partial: Number(e.target.value) || 0 })}
                />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
