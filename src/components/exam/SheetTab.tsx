'use client'

import React, { useEffect, useState } from 'react'
import { FileSpreadsheet, Library, Loader2, Check } from 'lucide-react'
import { Exam, ExamQuestion, fetchQuestions, saveAsPyq } from '@/lib/exam'
import { exportExamSheet } from '@/lib/examExport'

function keyText(q: ExamQuestion): string | null {
  if (q.type === 'true_false') return q.correct_answer === true ? 'True' : 'False'
  if (q.type === 'mcq') {
    const ids = Array.isArray(q.correct_answer) ? q.correct_answer : []
    return (q.options ?? []).filter(o => ids.includes(o.id)).map(o => o.text).join(', ')
  }
  if (q.type === 'integer') return q.correct_answer != null ? String(q.correct_answer) : null
  if (q.type === 'objective') return typeof q.correct_answer === 'string' ? q.correct_answer : null
  return null
}

export default function SheetTab({ exam, userId }: { exam: Exam; userId: string }) {
  const [questions, setQuestions] = useState<ExamQuestion[]>([])
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [savingPyq, setSavingPyq] = useState(false)
  const [pyqSaved, setPyqSaved] = useState(false)

  useEffect(() => {
    fetchQuestions(exam.id).then(qs => { setQuestions(qs); setLoading(false) })
  }, [exam.id])

  const handleExport = async () => {
    setExporting(true)
    await exportExamSheet(exam.id)
    setExporting(false)
  }

  const handleSavePyq = async () => {
    setSavingPyq(true)
    const ok = await saveAsPyq(exam.id, userId)
    setSavingPyq(false)
    if (ok) { setPyqSaved(true); setTimeout(() => setPyqSaved(false), 2000) }
  }

  if (loading) return <div className="text-center py-10"><div className="spinner mx-auto" /></div>

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-500">{questions.length} questions · {exam.total_marks} marks</p>
        <div className="flex items-center gap-2">
          <button onClick={handleSavePyq} disabled={savingPyq} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-60">
            {savingPyq ? <Loader2 size={14} className="animate-spin" /> : pyqSaved ? <Check size={14} /> : <Library size={14} />}
            {pyqSaved ? 'Saved to PYQ' : 'Save as PYQ'}
          </button>
          <button onClick={handleExport} disabled={exporting} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 text-white text-sm hover:bg-slate-900 disabled:opacity-60">
            {exporting ? <Loader2 size={14} className="animate-spin" /> : <FileSpreadsheet size={14} />}
            Export
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-2 items-start">
        {questions.map((q, idx) => {
          const k = keyText(q)
          return (
            <div key={q.id} className="border border-slate-100 rounded-xl p-3">
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm text-slate-700"><span className="text-slate-400 mr-2">Q{idx + 1}.</span>{q.prompt}</p>
                <span className="shrink-0 text-xs text-slate-400">{q.marks}m · {q.type}</span>
              </div>
              {q.type === 'mcq' && (
                <ul className="mt-1.5 ml-6 text-xs text-slate-500 list-disc">
                  {(q.options ?? []).map(o => <li key={o.id}>{o.text}</li>)}
                </ul>
              )}
              {k && <p className="mt-1 ml-6 text-xs text-emerald-600">Key: {k}</p>}
            </div>
          )
        })}
        {questions.length === 0 && <p className="col-span-full text-sm text-slate-400 text-center py-6">No questions.</p>}
      </div>
    </div>
  )
}
