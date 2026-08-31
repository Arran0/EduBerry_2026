'use client'

import React, { useEffect, useState } from 'react'
import { FileSpreadsheet, Library, Loader2, Check } from 'lucide-react'
import { Exam, ExamQuestion, fetchQuestions, fetchPyqBySourceExam, saveAsPyq } from '@/lib/exam'
import { exportExamSheet } from '@/lib/examExport'
import { EXAM, Skeleton, QuestionImage } from '@/components/exam/examUi'

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
  // Persisted, not a transient flash — a saved snapshot already exists (or
  // was just created) in the PYQ library, so the button reflects that
  // permanently instead of reverting a couple of seconds later.
  const [pyqSaved, setPyqSaved] = useState(false)

  useEffect(() => {
    Promise.all([fetchQuestions(exam.id), fetchPyqBySourceExam(exam.id)]).then(([qs, pyq]) => {
      setQuestions(qs)
      setPyqSaved(!!pyq)
      setLoading(false)
    })
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
    if (ok) setPyqSaved(true)
  }

  if (loading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-4 w-1/3 mb-4" />
        <div className={EXAM.listWrap}>
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="p-3 space-y-2">
              <Skeleton className="h-3.5 w-3/4" />
              <Skeleton className="h-2.5 w-1/3" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-[#71717A]">{questions.length} questions · {exam.total_marks} marks</p>
        <div className="flex items-center gap-2">
          <button
            onClick={handleSavePyq}
            disabled={savingPyq || pyqSaved}
            title={pyqSaved ? 'This exam is already in the PYQ library' : undefined}
            className={EXAM.ghostBtn}
          >
            {savingPyq ? <Loader2 size={14} className="animate-spin" /> : pyqSaved ? <Check size={14} className="text-emerald-500" /> : <Library size={14} />}
            {pyqSaved ? 'Saved to PYQ' : 'Save as PYQ'}
          </button>
          <button onClick={handleExport} disabled={exporting} className={EXAM.darkBtn}>
            {exporting ? <Loader2 size={14} className="animate-spin" /> : <FileSpreadsheet size={14} />}
            Export
          </button>
        </div>
      </div>

      <div className={EXAM.listWrap}>
        {questions.map((q, idx) => {
          const k = keyText(q)
          return (
            <div key={q.id} className="px-3 py-2.5">
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm text-[#27272A]"><span className="text-[#A1A1AA] mr-2 tabular-nums">Q{idx + 1}.</span>{q.prompt}</p>
                <span className="shrink-0 text-xs text-[#A1A1AA] tabular-nums">{q.marks}m · {q.type}</span>
              </div>
              {q.image_url && (
                <div className="mt-2 ml-6">
                  <QuestionImage src={q.image_url} alt={`Figure for question ${idx + 1}`} />
                </div>
              )}
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
