'use client'

import React, { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import ProtectedLayout from '@/components/ProtectedLayout'
import { useAuth } from '@/contexts/AuthContext'
import { ChevronLeft, CheckCircle2, XCircle, Lock, MessageSquare } from 'lucide-react'
import {
  ExamReview, ExamQuestion, ExamAnswer, AnswerResponse, fetchStudentReview,
} from '@/lib/exam'

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

export default function ExamReviewPage() {
  const { examId } = useParams<{ examId: string }>()
  const router = useRouter()
  const { user, profile } = useAuth()
  const [review, setReview] = useState<ExamReview | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) return
    setLoading(true)
    fetchStudentReview(examId, user.id).then(r => { setReview(r); setLoading(false) })
  }, [examId, user])

  if (!user || !profile) return null

  const published = review?.exam.results_published
  const answersByQ: Record<string, ExamAnswer> = {}
  for (const a of review?.answers ?? []) answersByQ[a.question_id] = a

  return (
    <ProtectedLayout>
      <div data-page-theme="academics" className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <button onClick={() => router.push('/more/exam')} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 mb-4">
          <ChevronLeft size={16} /> Back to Exams
        </button>

        {loading ? (
          <div className="text-center py-16"><div className="spinner mx-auto mb-3" /><p className="text-sm text-slate-500">Loading…</p></div>
        ) : !review ? (
          <div className="glass rounded-2xl p-10 text-center text-slate-500">Exam not found.</div>
        ) : !published ? (
          <div className="glass rounded-2xl p-10 text-center">
            <Lock size={36} className="text-slate-300 mx-auto mb-3" />
            <p className="text-slate-600 font-medium">Results not published yet</p>
            <p className="text-sm text-slate-400 mt-1">Your teacher hasn&apos;t published the results for this exam.</p>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-3 mb-5">
              <div>
                <h1 className="font-display text-xl font-bold text-slate-800">{review.exam.title}</h1>
                {review.exam.subject && <p className="text-xs text-slate-400">{review.exam.subject}</p>}
              </div>
              {review.submission?.is_absent ? (
                <span className="text-sm px-3 py-1 rounded-full bg-rose-50 text-rose-500">Absent</span>
              ) : review.submission?.total_score != null ? (
                <div className="text-right">
                  <div className="text-lg font-bold text-slate-800 tabular-nums">{review.submission.total_score}<span className="text-slate-400 text-sm">/{review.submission.max_score}</span></div>
                  <div className="text-[11px] text-slate-400">your score</div>
                </div>
              ) : null}
            </div>

            <div className="space-y-3">
              {review.questions.map((q, idx) => {
                const ans = answersByQ[q.id]
                const isObjective = q.type === 'mcq' || q.type === 'true_false'
                return (
                  <div key={q.id} className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <p className="text-sm font-medium text-slate-800"><span className="text-slate-400 mr-2">Q{idx + 1}.</span>{q.prompt}</p>
                      <span className="shrink-0 text-sm font-semibold text-slate-700">{ans?.awarded_marks ?? 0}<span className="text-slate-400 font-normal">/{q.marks}</span></span>
                    </div>

                    <div className="text-sm text-slate-600 bg-slate-50 rounded-lg px-3 py-2 mb-2">
                      <span className="text-xs text-slate-400">Your answer: </span>{renderResponse(q, ans?.response ?? null)}
                    </div>

                    {correctText(q) && (
                      <div className="flex items-center gap-1.5 text-sm mb-1">
                        {isObjective && (ans?.is_correct === true
                          ? <CheckCircle2 size={15} className="text-emerald-500" />
                          : <XCircle size={15} className="text-rose-400" />)}
                        <span className="text-xs text-slate-400">{q.type === 'objective' ? 'Reference' : 'Correct'}: </span>
                        <span className="text-slate-600">{correctText(q)}</span>
                      </div>
                    )}

                    {ans?.remark && (
                      <div className="mt-2 flex items-start gap-2 text-sm bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 text-amber-800">
                        <MessageSquare size={14} className="mt-0.5 shrink-0" />
                        <span>{ans.remark}</span>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>
    </ProtectedLayout>
  )
}
