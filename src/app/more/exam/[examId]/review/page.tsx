'use client'

import React, { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { useParams, useRouter } from 'next/navigation'
import ProtectedLayout from '@/components/ProtectedLayout'
import { useAuth } from '@/contexts/AuthContext'
import { ChevronLeft, CheckCircle2, XCircle, Lock, MessageSquare } from 'lucide-react'
import {
  ExamReview, ExamQuestion, ExamAnswer, AnswerResponse, fetchStudentReview,
} from '@/lib/exam'
import { EXAM_MAX_W } from '@/components/exam/ExamNav'
import { EXAM, EXAM_BG, Skeleton } from '@/components/exam/examUi'

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
  if (q.type === 'integer') return q.correct_answer != null ? String(q.correct_answer) : null
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
      <div data-page-theme="exam">
        <div data-page-theme="admin" style={{ backgroundColor: EXAM_BG, minHeight: '100vh' }}>
          <div className={`${EXAM_MAX_W} mx-auto px-4 sm:px-6 lg:px-8 py-6`}>
            <button onClick={() => router.push('/more/exam')} className="flex items-center gap-1.5 text-sm text-[#71717A] hover:text-[#27272A] mb-4 transition-colors">
              <ChevronLeft size={16} /> Back to Exams
            </button>

            {loading ? (
              <ReviewSkeleton />
            ) : !review ? (
              <div className={`${EXAM.card} shadow-sm p-10 text-center text-[#71717A]`}>Exam not found.</div>
            ) : !published ? (
              <div className={`${EXAM.card} shadow-sm p-10 text-center`}>
                <Lock size={36} className="text-[#D4D4D8] mx-auto mb-3" />
                <p className="text-[#27272A] font-semibold">Results not published yet</p>
                <p className="text-sm text-[#A1A1AA] mt-1">Your teacher hasn&apos;t published the results for this exam.</p>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between gap-3 mb-5">
                  <div>
                    <h1 className="font-display text-xl font-bold text-[#18181B]">{review.exam.title}</h1>
                    {review.exam.subject && <p className="text-xs text-[#A1A1AA]">{review.exam.subject}</p>}
                  </div>
                  {review.submission?.is_absent ? (
                    <span className="text-sm px-3 py-1 rounded-full bg-rose-50 text-rose-500">Absent</span>
                  ) : review.submission?.total_score != null ? (
                    <div className="text-right">
                      <div className="text-lg font-bold text-[#18181B] tabular-nums">{review.submission.total_score}<span className="text-[#A1A1AA] text-sm">/{review.submission.max_score}</span></div>
                      <div className="text-[11px] text-[#A1A1AA]">your score</div>
                    </div>
                  ) : null}
                </div>

                <div className="space-y-3">
                  {review.questions.map((q, idx) => {
                    const ans = answersByQ[q.id]
                    const isObjective = q.type === 'mcq' || q.type === 'true_false' || q.type === 'integer'
                    return (
                      <motion.div
                        key={q.id}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.28, delay: Math.min(idx * 0.04, 0.3), ease: [0.22, 0.61, 0.36, 1] }}
                        className={`${EXAM.card} shadow-sm p-4`}
                      >
                        <div className="flex items-start justify-between gap-3 mb-2">
                          <p className="text-sm font-medium text-[#27272A]"><span className="text-[#A1A1AA] mr-2">Q{idx + 1}.</span>{q.prompt}</p>
                          <span className="shrink-0 text-sm font-semibold text-[#27272A] tabular-nums">{ans?.awarded_marks ?? 0}<span className="text-[#A1A1AA] font-normal">/{q.marks}</span></span>
                        </div>

                        <div className="text-sm text-[#52525B] bg-[#F8F8F7] rounded-lg px-3 py-2 mb-2">
                          <span className="text-xs text-[#A1A1AA]">Your answer: </span>{renderResponse(q, ans?.response ?? null)}
                        </div>

                        {correctText(q) && (
                          <div className="flex items-center gap-1.5 text-sm mb-1">
                            {isObjective && (ans?.is_correct === true
                              ? <CheckCircle2 size={15} className="text-emerald-500" />
                              : <XCircle size={15} className="text-rose-400" />)}
                            <span className="text-xs text-[#A1A1AA]">{q.type === 'objective' ? 'Reference' : 'Correct'}: </span>
                            <span className="text-[#52525B]">{correctText(q)}</span>
                          </div>
                        )}

                        {ans?.remark && (
                          <div className="mt-2 flex items-start gap-2 text-sm bg-[#F4F2EC] border border-[#E7E2D8] rounded-lg px-3 py-2 text-[#7A6320]">
                            <MessageSquare size={14} className="mt-0.5 shrink-0" />
                            <span>{ans.remark}</span>
                          </div>
                        )}
                      </motion.div>
                    )
                  })}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </ProtectedLayout>
  )
}

function ReviewSkeleton() {
  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-5">
        <div className="space-y-2">
          <Skeleton className="h-5 w-44" />
          <Skeleton className="h-3 w-24" />
        </div>
        <Skeleton className="h-10 w-16 rounded-lg" />
      </div>
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className={`${EXAM.card} shadow-sm p-4 space-y-2`}>
            <Skeleton className="h-3.5 w-3/4" />
            <Skeleton className="h-8 w-full rounded-lg" />
            <Skeleton className="h-3 w-1/3" />
          </div>
        ))}
      </div>
    </div>
  )
}
