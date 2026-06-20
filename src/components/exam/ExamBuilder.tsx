'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Plus, Trash2, Save, Loader2, ChevronUp, ChevronDown, GripVertical, Check,
} from 'lucide-react'
import {
  Exam, ExamQuestion, QuestionOption, CorrectAnswer, QuestionInput,
  fetchExamById, updateExam, fetchQuestions, addQuestion, updateQuestion,
  deleteQuestion, reorderQuestions,
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
    return <div className="text-center py-16"><div className="spinner mx-auto mb-3" /><p className="text-sm text-slate-500">Loading…</p></div>
  }
  if (!exam || !settings) {
    return <div className="glass rounded-2xl p-10 text-center text-slate-500">Exam not found.</div>
  }

  return (
    <div className="space-y-6">
      {/* Settings + Participants — side by side on wide screens */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        {/* Settings */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-semibold text-slate-700">Exam settings</h2>
            <button
              onClick={handleSaveSettings}
              disabled={savingSettings}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 text-white text-sm hover:bg-slate-900 disabled:opacity-60"
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
            <h2 className="font-semibold text-slate-700">Participants</h2>
          </div>
          <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
            <AudienceEditor examId={examId} />
          </div>
        </div>
      </div>

      {/* Questions */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-semibold text-slate-700">Questions <span className="text-slate-400 font-normal">({questions.length} · {totalMarks} marks)</span></h2>
        </div>
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 items-start">
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
          className="mt-3 w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl border-2 border-dashed border-slate-200 text-sm text-slate-500 hover:border-amber-300 hover:text-amber-600"
        >
          <Plus size={16} /> Add question
        </button>
      </div>

      <div className="flex justify-end">
        <button onClick={() => router.push(`/more/exam/${examId}`)} className="px-5 py-2.5 rounded-xl bg-amber-500 text-white text-sm font-semibold hover:bg-amber-600">
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

  const field = 'w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-200'
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
    <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 text-slate-400">
          <GripVertical size={16} />
          <span className="text-sm font-medium text-slate-600">Question {index + 1}</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-600 border border-amber-200">{meta.label}</span>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => onMove(-1)} disabled={index === 0} className="p-1.5 text-slate-400 hover:bg-slate-100 rounded disabled:opacity-30"><ChevronUp size={15} /></button>
          <button onClick={() => onMove(1)} disabled={index === total - 1} className="p-1.5 text-slate-400 hover:bg-slate-100 rounded disabled:opacity-30"><ChevronDown size={15} /></button>
          <button onClick={onDelete} className="p-1.5 text-rose-400 hover:bg-rose-50 rounded"><Trash2 size={15} /></button>
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
                } ${correctIds.includes(opt.id) ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-slate-200 text-transparent'}`}
              >
                <Check size={14} />
              </button>
              <input
                className={field}
                value={opt.text}
                onChange={e => setOptions(options.map(o => o.id === opt.id ? { ...o, text: e.target.value } : o))}
                placeholder={`Option ${opt.id.toUpperCase()}`}
              />
              <button onClick={() => { setOptions(options.filter(o => o.id !== opt.id)); setCorrect(correctIds.filter(x => x !== opt.id)) }} className="p-1.5 text-slate-300 hover:text-rose-400">
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          <button onClick={() => setOptions([...options, { id: newOptionId(options), text: '' }])} className="text-xs text-amber-600 hover:underline">+ Add option</button>
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
              className={`flex-1 px-3 py-2 rounded-lg border text-sm ${correct === o.v ? 'border-emerald-400 bg-emerald-50 text-emerald-700' : 'border-slate-200 text-slate-600'}`}
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
        <p className="text-xs text-slate-400 mb-3">Subjective — graded manually, no preset answer.</p>
      )}

      {/* Scoring */}
      <div className="border-t border-slate-100 pt-3 mb-3">
        {!editable ? (
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400">Scoring</span>
            <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
              {scoringSummary(question.scoring_strategy ?? 'manual', params)}
            </span>
          </div>
        ) : meta.manual ? (
          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-500">Marks</label>
            <input
              type="number" min={0}
              className="w-24 border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-200"
              value={String(params.correct)}
              onChange={e => setParam({ correct: Number(e.target.value) || 0 })}
            />
            <span className="text-xs text-slate-400">graded manually</span>
          </div>
        ) : (
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-[11px] text-slate-500 mb-0.5">Correct (+)</label>
              <input
                type="number"
                className="w-24 border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-200"
                value={String(params.correct)}
                onChange={e => setParam({ correct: Number(e.target.value) || 0 })}
              />
            </div>
            {fullCustom && (
              <div>
                <label className="block text-[11px] text-slate-500 mb-0.5">Wrong (−)</label>
                <input
                  type="number"
                  className="w-24 border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-200"
                  value={String(params.wrong)}
                  onChange={e => setParam({ wrong: Number(e.target.value) || 0 })}
                />
              </div>
            )}
            {fullCustom && kind === 'multiple_correct' && (
              <div>
                <label className="block text-[11px] text-slate-500 mb-0.5">Partial</label>
                <input
                  type="number"
                  className="w-24 border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-200"
                  value={String(params.partial ?? 0)}
                  onChange={e => setParam({ partial: Number(e.target.value) || 0 })}
                />
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex justify-end">
        <button onClick={handleSave} disabled={saving} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 text-white text-sm hover:bg-slate-900 disabled:opacity-60">
          {saving ? <Loader2 size={14} className="animate-spin" /> : saved ? <Check size={14} /> : <Save size={14} />}
          {saved ? 'Saved' : 'Save question'}
        </button>
      </div>
    </div>
  )
}
