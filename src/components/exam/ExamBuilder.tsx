'use client'

import React, { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Plus, Trash2, Save, Loader2, ChevronUp, ChevronDown, GripVertical, Check,
} from 'lucide-react'
import {
  Exam, ExamQuestion, QuestionType, QuestionOption, CorrectAnswer,
  fetchExamById, updateExam, fetchQuestions, addQuestion, updateQuestion,
  deleteQuestion, reorderQuestions,
} from '@/lib/exam'
import {
  ExamSettingsForm, SettingsState, settingsFromExam, settingsToInput,
} from '@/components/exam/ExamSettingsForm'

const QUESTION_TYPES: { value: QuestionType; label: string }[] = [
  { value: 'mcq', label: 'Multiple choice' },
  { value: 'true_false', label: 'True / False' },
  { value: 'objective', label: 'Short answer' },
  { value: 'subjective', label: 'Subjective' },
]

function newOptionId(existing: QuestionOption[]): string {
  const used = new Set(existing.map(o => o.id))
  for (let i = 0; i < 26; i++) {
    const id = String.fromCharCode(97 + i)
    if (!used.has(id)) return id
  }
  return crypto.randomUUID().slice(0, 4)
}

export default function ExamBuilder({ examId }: { examId: string }) {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [exam, setExam] = useState<Exam | null>(null)
  const [settings, setSettings] = useState<SettingsState | null>(null)
  const [questions, setQuestions] = useState<ExamQuestion[]>([])
  const [savingSettings, setSavingSettings] = useState(false)
  const [settingsSaved, setSettingsSaved] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const ex = await fetchExamById(examId)
    setExam(ex)
    if (ex) setSettings(settingsFromExam(ex))
    setQuestions(await fetchQuestions(examId))
    setLoading(false)
  }, [examId])

  useEffect(() => { load() }, [load])

  const handleSaveSettings = async () => {
    if (!settings) return
    setSavingSettings(true)
    setSettingsSaved(false)
    await updateExam(examId, settingsToInput(settings))
    setSavingSettings(false)
    setSettingsSaved(true)
    setTimeout(() => setSettingsSaved(false), 2000)
  }

  const handleAddQuestion = async () => {
    const q = await addQuestion(examId, { type: 'mcq', prompt: '', marks: 1, options: [{ id: 'a', text: '' }, { id: 'b', text: '' }], correct_answer: [], multiple_select: false })
    if (q) setQuestions(prev => [...prev, q])
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

      {/* Questions */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-semibold text-slate-700">Questions <span className="text-slate-400 font-normal">({questions.length} · {exam.total_marks} marks)</span></h2>
        </div>
        <div className="space-y-3">
          {questions.map((q, idx) => (
            <QuestionEditor
              key={q.id}
              index={idx}
              total={questions.length}
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
    </div>
  )
}

// ── Per-question editor ──

function QuestionEditor({
  index, total, question, onSaved, onDelete, onMove,
}: {
  index: number
  total: number
  question: ExamQuestion
  onSaved: (q: ExamQuestion) => void
  onDelete: () => void
  onMove: (dir: -1 | 1) => void
}) {
  const [type, setType] = useState<QuestionType>(question.type)
  const [prompt, setPrompt] = useState(question.prompt)
  const [marks, setMarks] = useState(String(question.marks))
  const [options, setOptions] = useState<QuestionOption[]>(question.options ?? [])
  const [multi, setMulti] = useState(question.multiple_select)
  const [correct, setCorrect] = useState<CorrectAnswer>(question.correct_answer)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const field = 'w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-200'

  const correctIds: string[] = Array.isArray(correct) ? correct : []

  const changeType = (t: QuestionType) => {
    setType(t)
    if (t === 'mcq') {
      if (options.length === 0) setOptions([{ id: 'a', text: '' }, { id: 'b', text: '' }])
      setCorrect([])
    } else if (t === 'true_false') {
      setCorrect(true)
    } else {
      setCorrect(t === 'objective' ? '' : null)
    }
  }

  const toggleCorrect = (id: string) => {
    if (multi) {
      setCorrect(correctIds.includes(id) ? correctIds.filter(x => x !== id) : [...correctIds, id])
    } else {
      setCorrect([id])
    }
  }

  const handleSave = async () => {
    setSaving(true)
    setSaved(false)
    const ok = await updateQuestion(question.id, {
      type,
      prompt,
      marks: Number(marks) || 0,
      options: type === 'mcq' ? options : null,
      multiple_select: type === 'mcq' ? multi : false,
      correct_answer:
        type === 'mcq' ? correctIds
        : type === 'true_false' ? (typeof correct === 'boolean' ? correct : true)
        : type === 'objective' ? (typeof correct === 'string' ? correct : '')
        : null,
    })
    setSaving(false)
    if (ok) {
      onSaved({
        ...question, type, prompt, marks: Number(marks) || 0,
        options: type === 'mcq' ? options : null,
        multiple_select: type === 'mcq' ? multi : false,
        correct_answer:
          type === 'mcq' ? correctIds
          : type === 'true_false' ? (typeof correct === 'boolean' ? correct : true)
          : type === 'objective' ? (typeof correct === 'string' ? correct : '')
          : null,
      })
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
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => onMove(-1)} disabled={index === 0} className="p-1.5 text-slate-400 hover:bg-slate-100 rounded disabled:opacity-30"><ChevronUp size={15} /></button>
          <button onClick={() => onMove(1)} disabled={index === total - 1} className="p-1.5 text-slate-400 hover:bg-slate-100 rounded disabled:opacity-30"><ChevronDown size={15} /></button>
          <button onClick={onDelete} className="p-1.5 text-rose-400 hover:bg-rose-50 rounded"><Trash2 size={15} /></button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 mb-3">
        <select className={`${field} col-span-2`} value={type} onChange={e => changeType(e.target.value as QuestionType)}>
          {QUESTION_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <input className={field} type="number" value={marks} onChange={e => setMarks(e.target.value)} placeholder="Marks" />
      </div>

      <textarea className={`${field} mb-3`} rows={2} value={prompt} onChange={e => setPrompt(e.target.value)} placeholder="Question prompt" />

      {type === 'mcq' && (
        <div className="space-y-2 mb-3">
          <label className="flex items-center gap-2 text-xs text-slate-500">
            <input type="checkbox" className="accent-amber-500" checked={multi} onChange={e => { setMulti(e.target.checked); setCorrect([]) }} />
            Allow multiple correct answers
          </label>
          {options.map(opt => (
            <div key={opt.id} className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => toggleCorrect(opt.id)}
                title="Mark correct"
                className={`w-7 h-7 shrink-0 rounded-lg border flex items-center justify-center ${
                  correctIds.includes(opt.id) ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-slate-200 text-transparent'
                }`}
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

      {type === 'true_false' && (
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

      {type === 'objective' && (
        <input
          className={`${field} mb-3`}
          value={typeof correct === 'string' ? correct : ''}
          onChange={e => setCorrect(e.target.value)}
          placeholder="Reference answer (graded manually)"
        />
      )}

      {type === 'subjective' && (
        <p className="text-xs text-slate-400 mb-3">Subjective — graded manually, no preset answer.</p>
      )}

      <div className="flex justify-end">
        <button onClick={handleSave} disabled={saving} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 text-white text-sm hover:bg-slate-900 disabled:opacity-60">
          {saving ? <Loader2 size={14} className="animate-spin" /> : saved ? <Check size={14} /> : <Save size={14} />}
          {saved ? 'Saved' : 'Save question'}
        </button>
      </div>
    </div>
  )
}
