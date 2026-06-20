'use client'

import React, { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import ProtectedLayout from '@/components/ProtectedLayout'
import { useAuth } from '@/contexts/AuthContext'
import { isStaffRole, UserProfile } from '@/lib/supabase'
import { ChevronLeft, Loader2, Check, CheckCircle2, XCircle } from 'lucide-react'
import {
  Exam, ExamQuestion, ExamAnswer, ExamSubmission, AnswerResponse,
  fetchExamById, fetchQuestions, fetchAnswers, fetchProfilesByIds,
  fetchSubmissionForStudent, gradeAnswer, finalizeSubmission,
} from '@/lib/exam'
import { isManualQuestion } from '@/lib/examGrading'

function renderResponse(q: ExamQuestion, resp: AnswerResponse): string {
  if (resp == null || resp === '') return '—'
  if (q.type === 'true_false') return resp === true ? 'True' : resp === false ? 'False' : '—'
  if (q.type === 'mcq') {
    const ids = Array.isArray(resp) ? resp : []
    const labels = (q.options ?? []).filter(o => ids.includes(o.id)).map(o => o.text)
    return labels.length ? labels.join(', ') : '—'
  }
  return typeof resp === 'string' ? resp : String(resp)
}

function correctText(q: ExamQuestion): string | null {
  if (q.type === 'true_false') return q.correct_answer === true ? 'True' : 'False'
  if (q.type === 'mcq') {
    const ids = Array.isArray(q.correct_answer) ? q.correct_answer : []
    return (q.options ?? []).filter(o => ids.includes(o.id)).map(o => o.text).join(', ')
  }
  if (q.type === 'objective') return typeof q.correct_answer === 'string' ? q.correct_answer : null
  return null
}

export default function GradeSubmissionPage() {
  const { examId, studentId } = useParams<{ examId: string; studentId: string }>()
  const router = useRouter()
  const { user, profile } = useAuth()

  const [loading, setLoading] = useState(true)
  const [exam, setExam] = useState<Exam | null>(null)
  const [student, setStudent] = useState<UserProfile | null>(null)
  const [questions, setQuestions] = useState<ExamQuestion[]>([])
  const [submission, setSubmission] = useState<ExamSubmission | null>(null)
  const [answers, setAnswers] = useState<Record<string, ExamAnswer>>({})
  // Local edits for manual questions: { [questionId]: { marks, remark } }
  const [edits, setEdits] = useState<Record<string, { marks: string; remark: string }>>({})
  const [savingId, setSavingId] = useState<string | null>(null)
  const [savedId, setSavedId] = useState<string | null>(null)
  const [finalizing, setFinalizing] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const [ex, qs, sub, profs] = await Promise.all([
      fetchExamById(examId),
      fetchQuestions(examId),
      fetchSubmissionForStudent(examId, studentId),
      fetchProfilesByIds([studentId]),
    ])
    setExam(ex)
    setQuestions(qs)
    setSubmission(sub)
    setStudent(profs[0] ?? null)

    if (sub) {
      const ans = await fetchAnswers(sub.id)
      const byQ: Record<string, ExamAnswer> = {}
      const ed: Record<string, { marks: string; remark: string }> = {}
      for (const a of ans) {
        byQ[a.question_id] = a
        ed[a.question_id] = {
          marks: a.awarded_marks != null ? String(a.awarded_marks) : '',
          remark: a.remark ?? '',
        }
      }
      setAnswers(byQ)
      setEdits(ed)
    }
    setLoading(false)
  }, [examId, studentId])

  useEffect(() => { load() }, [load])

  if (!user || !profile) return null

  const handleSaveManual = async (q: ExamQuestion) => {
    if (!submission) return
    const edit = edits[q.id] ?? { marks: '', remark: '' }
    const marks = Math.max(0, Math.min(q.marks, Number(edit.marks) || 0))
    setSavingId(q.id)
    await gradeAnswer(submission.id, q.id, marks, edit.remark.trim() || null, user.id)
    setSavingId(null)
    setSavedId(q.id)
    setTimeout(() => setSavedId(s => (s === q.id ? null : s)), 1500)
  }

  const handleFinalize = async () => {
    if (!submission) return
    setFinalizing(true)
    await finalizeSubmission(submission.id, user.id)
    setFinalizing(false)
    router.push(`/more/exam/${examId}`)
  }

  // Running total from current edits (manual) + stored auto marks.
  const runningTotal = questions.reduce((sum, q) => {
    if (isManualQuestion(q)) return sum + (Number(edits[q.id]?.marks) || 0)
    return sum + (answers[q.id]?.awarded_marks ?? 0)
  }, 0)
  const maxTotal = questions.reduce((s, q) => s + q.marks, 0)

  return (
    <ProtectedLayout>
      <div data-page-theme="academics" className="max-w-3xl mx-auto px-4 sm:px-6 py-6">
        <button onClick={() => router.push(`/more/exam/${examId}`)} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 mb-4">
          <ChevronLeft size={16} /> Back to Exam
        </button>

        {loading ? (
          <div className="text-center py-16"><div className="spinner mx-auto mb-3" /><p className="text-sm text-slate-500">Loading…</p></div>
        ) : !exam || !isStaffRole(profile.role) ? (
          <div className="glass rounded-2xl p-10 text-center text-slate-500">Not available.</div>
        ) : !submission ? (
          <div className="glass rounded-2xl p-10 text-center text-slate-500">
            {student?.full_name ?? 'This student'} has not attempted this exam.
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-3 mb-5">
              <div>
                <h1 className="font-display text-xl font-bold text-slate-800">{student?.full_name}</h1>
                <p className="text-xs text-slate-400">{exam.title}</p>
              </div>
              <div className="text-right">
                <div className="text-lg font-bold text-slate-800 tabular-nums">{Math.round(runningTotal * 100) / 100}<span className="text-slate-400 text-sm">/{maxTotal}</span></div>
                <div className="text-[11px] text-slate-400">running total</div>
              </div>
            </div>

            <div className="space-y-3">
              {questions.map((q, idx) => {
                const ans = answers[q.id]
                const manual = isManualQuestion(q)
                return (
                  <div key={q.id} className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <p className="text-sm font-medium text-slate-800"><span className="text-slate-400 mr-2">Q{idx + 1}.</span>{q.prompt}</p>
                      <span className="shrink-0 text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">{q.marks} marks</span>
                    </div>

                    <div className="text-sm text-slate-600 bg-slate-50 rounded-lg px-3 py-2 mb-2">
                      <span className="text-xs text-slate-400">Answer: </span>{renderResponse(q, ans?.response ?? null)}
                    </div>

                    {!manual ? (
                      <div className="flex items-center gap-2 text-sm">
                        {ans?.is_correct === true ? (
                          <span className="inline-flex items-center gap-1 text-emerald-600"><CheckCircle2 size={15} /> Correct</span>
                        ) : ans?.is_correct === false ? (
                          <span className="inline-flex items-center gap-1 text-rose-500"><XCircle size={15} /> Incorrect</span>
                        ) : (
                          <span className="text-slate-400">Not answered</span>
                        )}
                        <span className="text-slate-400">·</span>
                        <span className="font-medium text-slate-700">{ans?.awarded_marks ?? 0} marks (auto)</span>
                        {correctText(q) && <span className="text-xs text-slate-400 ml-auto">Key: {correctText(q)}</span>}
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {correctText(q) && <p className="text-xs text-slate-400">Reference: {correctText(q)}</p>}
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            min={0}
                            max={q.marks}
                            value={edits[q.id]?.marks ?? ''}
                            onChange={e => setEdits(prev => ({ ...prev, [q.id]: { marks: e.target.value, remark: prev[q.id]?.remark ?? '' } }))}
                            placeholder="0"
                            className="w-20 border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-200"
                          />
                          <span className="text-xs text-slate-400">/ {q.marks}</span>
                          <input
                            value={edits[q.id]?.remark ?? ''}
                            onChange={e => setEdits(prev => ({ ...prev, [q.id]: { marks: prev[q.id]?.marks ?? '', remark: e.target.value } }))}
                            placeholder="Remark (optional)"
                            className="flex-1 border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-200"
                          />
                          <button onClick={() => handleSaveManual(q)} disabled={savingId === q.id} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-800 text-white text-xs hover:bg-slate-900 disabled:opacity-60">
                            {savingId === q.id ? <Loader2 size={13} className="animate-spin" /> : savedId === q.id ? <Check size={13} /> : 'Save'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            <div className="mt-6 flex justify-end">
              <button onClick={handleFinalize} disabled={finalizing} className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-amber-500 text-white text-sm font-semibold hover:bg-amber-600 disabled:opacity-60">
                {finalizing ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                Finalize grading
              </button>
            </div>
          </>
        )}
      </div>
    </ProtectedLayout>
  )
}
