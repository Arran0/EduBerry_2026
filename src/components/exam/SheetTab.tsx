'use client'

import React, { useEffect, useState } from 'react'
import { FileSpreadsheet, Library, Loader2, Check } from 'lucide-react'
import { Exam, ExamQuestion, fetchQuestions, saveAsPyq } from '@/lib/exam'
import { exportExamSheet } from '@/lib/examExport'
import { Skeleton } from '@/components/exam/examUi'

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

  if (loading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-4 w-1/3 mb-4" />
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="border border-[#F0F0F0] rounded-xl p-3 space-y-2">
            <Skeleton className="h-3.5 w-3/4" />
            <Skeleton className="h-2.5 w-1/3" />
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-[#71717A]">{questions.length} questions · {exam.total_marks} marks</p>
        <div className="flex items-center gap-2">
          <button onClick={handleSavePyq} disabled={savingPyq} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#E4E4E7] bg-white text-sm text-[#71717A] hover:text-[#27272A] hover:border-[#D4D4D8] disabled:opacity-60 transition-colors">
            {savingPyq ? <Loader2 size={14} className="animate-spin" /> : pyqSaved ? <Check size={14} /> : <Library size={14} />}
            {pyqSaved ? 'Saved to PYQ' : 'Save as PYQ'}
          </button>
          <button onClick={handleExport} disabled={exporting} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#27272A] text-white text-sm hover:bg-[#18181B] disabled:opacity-60 transition-colors">
            {exporting ? <Loader2 size={14} className="animate-spin" /> : <FileSpreadsheet size={14} />}
            Export
          </button>
        </div>
      </div>

      <div className="space-y-2">
        {questions.map((q, idx) => {
          const k = keyText(q)
          return (
            <div key={q.id} className="border border-[#F0F0F0] rounded-xl p-3">
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm text-[#27272A]"><span className="text-[#A1A1AA] mr-2">Q{idx + 1}.</span>{q.prompt}</p>
                <span className="shrink-0 text-xs text-[#A1A1AA]">{q.marks}m · {q.type}</span>
              </div>
              {q.type === 'mcq' && (
                <ul className="mt-1.5 ml-6 text-xs text-[#71717A] list-disc">
                  {(q.options ?? []).map(o => <li key={o.id}>{o.text}</li>)}
                </ul>
              )}
              {k && <p className="mt-1 ml-6 text-xs text-emerald-600">Key: {k}</p>}
            </div>
          )
        })}
        {questions.length === 0 && <p className="text-sm text-[#A1A1AA] text-center py-6">No questions.</p>}
      </div>
    </div>
  )
}
