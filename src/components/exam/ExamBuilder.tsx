'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Plus, Trash2, Save, Loader2, ChevronUp, ChevronDown, GripVertical, Check,
  Lock, Unlock,
} from 'lucide-react'
import {
  Exam, ExamQuestion, QuestionOption, CorrectAnswer, QuestionInput,
  fetchExamById, updateExam, fetchQuestions, addQuestion, updateQuestion,
  deleteQuestion, reorderQuestions, closeExam, reopenExam,
} from '@/lib/exam'
import {
  ExamMode, QuestionKind, ScoringParams,
  getExamMode, QUESTION_KINDS, kindFromQuestion, newQuestionDefaults, scoringSummary,
} from '@/lib/examScoring'
import {
  ExamSettingsForm, SettingsState, settingsFromExam, settingsToInput,
} from '@/components/exam/ExamSettingsForm'
import QuestionTypePicker from '@/components/exam/QuestionTypePicker'
import AudienceEditor from '@/components/exam/AudienceEditor'
import { EXAM, Skeleton } from '@/components/exam/examUi'

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

export default function ExamBuilder({ examId }: { examId: string }) {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [exam, setExam] = useState<Exam | null>(null)
  const [settings, setSettings] = useState<SettingsState | null>(null)
  const [questions, setQuestions] = useState<ExamQuestion[]>([])
  const [savingSettings, setSavingSettings] = useState(false)
  const [settingsSaved, setSettingsSaved] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [togglingClose, setTogglingClose] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    // Exam settings and questions are independent — fetch in parallel.
    const [ex, qs] = await Promise.all([fetchExamById(examId), fetchQuestions(examId)])
    setExam(ex)
    if (ex) setSettings(settingsFromExam(ex))
    setQuestions(qs)
    setLoading(false)
  }, [examId])

  useEffect(() => { load() }, [load])

  const mode: ExamMode = settings?.exam_mode ?? exam?.exam_mode ?? 'school'
  const modeCfg = getExamMode(mode)
  const totalMarks = useMemo(() => questions.reduce((s, q) => s + Number(q.marks || 0), 0), [questions])

  const handleToggleClose = async () => {
    if (!exam) return
    if (!exam.is_closed && !confirm('Close this exam? Students who haven’t submitted will be marked absent and can no longer attempt it.')) return
    setTogglingClose(true)
    if (exam.is_closed) await reopenExam(exam.id)
    else await closeExam(exam.id)
    const fresh = await fetchExamById(examId)
    setExam(fresh)
    setTogglingClose(false)
  }

  const handleSaveSettings = async () => {
    if (!settings) return
    setSavingSettings(true)
    setSettingsSaved(false)
    await updateExam(examId, settingsToInput(settings))
    setExam(prev => (prev ? { ...prev, exam_mode: settings.exam_mode } : prev))
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

  const handleQuestionSaved = (saved: ExamQuestion) => {
    setQuestions(prev => prev.map(q => (q.id === saved.id ? saved : q)))
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-64 w-full rounded-xl" />
        <Skeleton className="h-40 w-full rounded-xl" />
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    )
  }
  if (!exam || !settings) {
    return <div className={`${EXAM.card} shadow-sm p-10 text-center text-[#71717A]`}>Exam not found.</div>
  }

  return (
    <div className="space-y-6">
      {/* Lifecycle control — same simple design as the Post-Exam Manager. */}
      <div className="flex items-center justify-between gap-3">
        {exam.is_closed
          ? <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#71717A]"><Lock size={12} /> Closed</span>
          : <span />}
        <button
          onClick={handleToggleClose}
          disabled={togglingClose}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[#E4E4E7] bg-white text-sm text-[#71717A] hover:text-[#27272A] hover:border-[#D4D4D8] disabled:opacity-60 transition-colors"
        >
          {togglingClose ? <Loader2 size={14} className="animate-spin" /> : exam.is_closed ? <Unlock size={14} /> : <Lock size={14} />}
          {exam.is_closed ? 'Reopen' : 'Close'}
        </button>
      </div>

      {/* Settings */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-semibold text-[#27272A]">Exam settings</h2>
          <button
            onClick={handleSaveSettings}
            disabled={savingSettings}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--page-primary)] text-white text-sm hover:bg-[var(--page-primary-dark)] disabled:opacity-60 transition-colors"
          >
            {savingSettings ? <Loader2 size={14} className="animate-spin" /> : settingsSaved ? <Check size={14} /> : <Save size={14} />}
            {settingsSaved ? 'Saved' : 'Save'}
          </button>
        </div>
        <ExamSettingsForm value={settings} onChange={setSettings} />
      </div>

      {/* Participants */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-semibold text-[#27272A]">Participants</h2>
        </div>
        <div className={`${EXAM.card} shadow-sm p-5`}>
          <AudienceEditor examId={examId} />
        </div>
      </div>

      {/* Questions */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-semibold text-[#27272A]">Questions <span className="text-[#A1A1AA] font-normal">({questions.length} · {totalMarks} marks)</span></h2>
        </div>
        <div className="space-y-3">
          {questions.map((q, idx) => (
            <QuestionEditor
              key={q.id}
              index={idx}
              total={questions.length}
              mode={mode}
              question={q}
              onSaved={handleQuestionSaved}
              onDelete={() => handleDeleteQuestion(q.id)}
              onMove={dir => handleMove(idx, dir)}
            />
          ))}
        </div>
        <button
          onClick={handleAddQuestion}
          className="mt-3 w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl border-2 border-dashed border-[#E4E4E7] text-sm text-[#71717A] hover:border-[var(--page-accent)] hover:text-[var(--page-accent)] transition-colors"
        >
          <Plus size={16} /> Add question
        </button>
      </div>

      <div className="flex justify-end">
        <button onClick={() => router.push(`/more/exam/${examId}`)} className="px-5 py-2.5 rounded-lg bg-[#B8983C] text-white text-sm font-semibold hover:bg-[#9C7F2C] shadow-[0_4px_14px_-4px_rgba(184,152,60,0.5)] transition-colors">
          Done
        </button>
      </div>

      <QuestionTypePicker
        open={pickerOpen}
        mode={mode}
        onPick={createQuestion}
        onClose={() => setPickerOpen(false)}
      />
    </div>
  )
}

// ── Per-question editor ──

function QuestionEditor({
  index, total, mode, question, onSaved, onDelete, onMove,
}: {
  index: number
  total: number
  mode: ExamMode
  question: ExamQuestion
  onSaved: (q: ExamQuestion) => void
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

  const [prompt, setPrompt] = useState(question.prompt)
  const [options, setOptions] = useState<QuestionOption[]>(question.options ?? [])
  const [correct, setCorrect] = useState<CorrectAnswer>(question.correct_answer)
  const [params, setParams] = useState<ScoringParams>(
    question.scoring_params ?? { correct: question.marks, wrong: 0, blank: 0 },
  )
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const field = 'w-full bg-white border border-[#E4E4E7] rounded-lg px-3 py-2 text-sm text-[#27272A] focus:outline-none focus:border-[var(--page-primary)] transition-colors'
  const correctIds: string[] = Array.isArray(correct) ? correct : []
  const isMcq = kind === 'single_correct' || kind === 'multiple_correct'

  const toggleCorrect = (id: string) => {
    if (kind === 'multiple_correct') {
      setCorrect(correctIds.includes(id) ? correctIds.filter(x => x !== id) : [...correctIds, id])
    } else {
      setCorrect([id])
    }
  }

  const setParam = (patch: Partial<ScoringParams>) => setParams(p => ({ ...p, ...patch }))

  const handleSave = async () => {
    setSaving(true)
    setSaved(false)
    const marks = Number(params.correct) || 0
    const finalParams: ScoringParams = { ...params, correct: marks }
    const updates: Partial<QuestionInput> = {
      prompt,
      marks,
      type: question.type,
      multiple_select: question.multiple_select,
      options: isMcq ? options : null,
      correct_answer:
        isMcq ? correctIds
        : kind === 'true_false' ? (typeof correct === 'boolean' ? correct : true)
        : kind === 'integer' ? (typeof correct === 'number' ? correct : (correct == null ? null : Number(correct)))
        : kind === 'short_answer' ? (typeof correct === 'string' ? correct : '')
        : null,
      scoring_strategy: question.scoring_strategy,
      scoring_params: finalParams,
    }
    const ok = await updateQuestion(question.id, updates)
    setSaving(false)
    if (ok) {
      onSaved({ ...question, ...updates } as ExamQuestion)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    }
  }

  return (
    <div className={`${EXAM.card} shadow-sm p-4`}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 text-[#A1A1AA]">
          <GripVertical size={16} />
          <span className="text-sm font-medium text-[#52525B]">Question {index + 1}</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--page-accent-light)] text-[var(--page-accent)] border border-[#E7E2D8] font-semibold">{meta.label}</span>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => onMove(-1)} disabled={index === 0} className="p-1.5 text-[#A1A1AA] hover:bg-[#F4F4F5] rounded disabled:opacity-30 transition-colors"><ChevronUp size={15} /></button>
          <button onClick={() => onMove(1)} disabled={index === total - 1} className="p-1.5 text-[#A1A1AA] hover:bg-[#F4F4F5] rounded disabled:opacity-30 transition-colors"><ChevronDown size={15} /></button>
          <button onClick={onDelete} className="p-1.5 text-rose-400 hover:bg-rose-50 rounded transition-colors"><Trash2 size={15} /></button>
        </div>
      </div>

      <textarea className={`${field} mb-3`} rows={2} value={prompt} onChange={e => setPrompt(e.target.value)} placeholder="Question prompt" />

      {isMcq && (
        <div className="space-y-2 mb-3">
          {options.map(opt => (
            <div key={opt.id} className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => toggleCorrect(opt.id)}
                title="Mark correct"
                className={`w-7 h-7 shrink-0 flex items-center justify-center border ${
                  kind === 'multiple_correct' ? 'rounded-lg' : 'rounded-full'
                } ${correctIds.includes(opt.id) ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-[#E4E4E7] text-transparent'}`}
              >
                <Check size={14} />
              </button>
              <input
                className={field}
                value={opt.text}
                onChange={e => setOptions(options.map(o => o.id === opt.id ? { ...o, text: e.target.value } : o))}
                placeholder={`Option ${opt.id.toUpperCase()}`}
              />
              <button onClick={() => { setOptions(options.filter(o => o.id !== opt.id)); setCorrect(correctIds.filter(x => x !== opt.id)) }} className="p-1.5 text-[#D4D4D8] hover:text-rose-400 transition-colors">
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          <button onClick={() => setOptions([...options, { id: newOptionId(options), text: '' }])} className="text-xs text-[var(--page-accent)] font-medium hover:underline">+ Add option</button>
        </div>
      )}

      {kind === 'integer' && (
        <input
          className={`${field} mb-3`}
          type="number"
          value={typeof correct === 'number' ? String(correct) : ''}
          onChange={e => setCorrect(e.target.value === '' ? null : Number(e.target.value))}
          placeholder="Correct numeric answer"
        />
      )}

      {kind === 'true_false' && (
        <div className="flex gap-2 mb-3">
          {[{ l: 'True', v: true }, { l: 'False', v: false }].map(o => (
            <button
              key={o.l}
              onClick={() => setCorrect(o.v)}
              className={`flex-1 px-3 py-2 rounded-lg border text-sm ${correct === o.v ? 'border-emerald-400 bg-emerald-50 text-emerald-700' : 'border-[#E4E4E7] text-[#52525B]'}`}
            >
              {o.l} {correct === o.v && '✓'}
            </button>
          ))}
        </div>
      )}

      {kind === 'short_answer' && (
        <input
          className={`${field} mb-3`}
          value={typeof correct === 'string' ? correct : ''}
          onChange={e => setCorrect(e.target.value)}
          placeholder="Reference answer (graded manually)"
        />
      )}

      {kind === 'subjective' && (
        <p className="text-xs text-[#A1A1AA] mb-3">Subjective — graded manually, no preset answer.</p>
      )}

      {/* Scoring */}
      <div className="border-t border-[#F0F0F0] pt-3 mb-3">
        {!editable ? (
          <div className="flex items-center gap-2">
            <span className="text-xs text-[#A1A1AA]">Scoring</span>
            <span className="text-xs px-2 py-0.5 rounded-full bg-[#F4F4F5] text-[#52525B]">
              {scoringSummary(question.scoring_strategy ?? 'manual', params)}
            </span>
          </div>
        ) : meta.manual ? (
          <div className="flex items-center gap-2">
            <label className="text-xs text-[#71717A]">Marks</label>
            <input
              type="number" min={0}
              className="w-24 bg-white border border-[#E4E4E7] rounded-lg px-3 py-1.5 text-sm text-[#27272A] focus:outline-none focus:border-[var(--page-primary)] transition-colors"
              value={String(params.correct)}
              onChange={e => setParam({ correct: Number(e.target.value) || 0 })}
            />
            <span className="text-xs text-[#A1A1AA]">graded manually</span>
          </div>
        ) : (
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-[11px] text-[#71717A] mb-0.5">Correct (+)</label>
              <input
                type="number"
                className="w-24 bg-white border border-[#E4E4E7] rounded-lg px-3 py-1.5 text-sm text-[#27272A] focus:outline-none focus:border-[var(--page-primary)] transition-colors"
                value={String(params.correct)}
                onChange={e => setParam({ correct: Number(e.target.value) || 0 })}
              />
            </div>
            {fullCustom && (
              <div>
                <label className="block text-[11px] text-[#71717A] mb-0.5">Wrong (−)</label>
                <input
                  type="number"
                  className="w-24 bg-white border border-[#E4E4E7] rounded-lg px-3 py-1.5 text-sm text-[#27272A] focus:outline-none focus:border-[var(--page-primary)] transition-colors"
                  value={String(params.wrong)}
                  onChange={e => setParam({ wrong: Number(e.target.value) || 0 })}
                />
              </div>
            )}
            {fullCustom && kind === 'multiple_correct' && (
              <div>
                <label className="block text-[11px] text-[#71717A] mb-0.5">Partial</label>
                <input
                  type="number"
                  className="w-24 bg-white border border-[#E4E4E7] rounded-lg px-3 py-1.5 text-sm text-[#27272A] focus:outline-none focus:border-[var(--page-primary)] transition-colors"
                  value={String(params.partial ?? 0)}
                  onChange={e => setParam({ partial: Number(e.target.value) || 0 })}
                />
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex justify-end">
        <button onClick={handleSave} disabled={saving} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--page-primary)] text-white text-sm hover:bg-[var(--page-primary-dark)] disabled:opacity-60 transition-colors">
          {saving ? <Loader2 size={14} className="animate-spin" /> : saved ? <Check size={14} /> : <Save size={14} />}
          {saved ? 'Saved' : 'Save question'}
        </button>
      </div>
    </div>
  )
}
