'use client'

import React, { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { useParams, useRouter } from 'next/navigation'
import ProtectedLayout from '@/components/ProtectedLayout'
import { useAuth } from '@/contexts/AuthContext'
import { isStaffRole, UserProfile } from '@/lib/supabase'
import { ChevronLeft, Loader2, Check, CheckCircle2, XCircle, Lock } from 'lucide-react'
import {
  Exam, ExamQuestion, ExamAnswer, ExamSubmission, AnswerResponse,
  fetchExamById, fetchQuestions, fetchAnswers, fetchProfilesByIds,
  fetchSubmissionForStudent, gradeAnswer, finalizeSubmission, isExamClosed,
} from '@/lib/exam'
import { isManualQuestion } from '@/lib/examGrading'
import { EXAM_MAX_W } from '@/components/exam/ExamNav'
import { EXAM, Skeleton, QuestionImage } from '@/components/exam/examUi'

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

  // A closed exam (results published) is read-only — grading is locked.
  const locked = !!exam && isExamClosed(exam)

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
      <div data-page-theme="exam">
        <div style={{ minHeight: '100vh' }}>
          <div className={`${EXAM_MAX_W} mx-auto px-4 sm:px-6 lg:px-8 py-6`}>
            <button onClick={() => router.push(`/more/exam/${examId}`)} className={`${EXAM.ghostBtnSm} mb-4`}>
              <ChevronLeft size={14} /> Back to Exam
            </button>

            {loading ? (
              <GradeSkeleton />
            ) : !exam || !isStaffRole(profile.role) ? (
              <div className={`${EXAM.card} p-10 text-center text-[#71717A]`}>Not available.</div>
            ) : !submission ? (
              <div className={`${EXAM.card} p-10 text-center text-[#71717A]`}>
                {student?.full_name ?? 'This student'} has not attempted this exam.
              </div>
            ) : (
              <>
                <div className="sticky top-0 z-10 -mx-4 sm:-mx-6 px-4 sm:px-6 py-3 mb-5 bg-[#FDFCF9]/90 backdrop-blur border-b border-[#E4E1D8] flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className={EXAM.eyebrow}>Grading</p>
                    <h1 className="font-display text-xl font-bold text-[#18181B] truncate mt-0.5">{student?.full_name}</h1>
                    <p className="text-[11px] text-[#A8A29A] truncate">{exam.title}</p>
                  </div>
                  <div className="text-right shrink-0 border-l border-[#E4E1D8] pl-3">
                    <p className={EXAM.label}>Running total</p>
                    <div className="mt-1 font-display text-xl font-bold leading-none text-[#18181B] tabular-nums">
                      {Math.round(runningTotal * 100) / 100}<span className="text-[#A8A29A] text-sm">/{maxTotal}</span>
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  {questions.map((q, idx) => {
                    const ans = answers[q.id]
                    const manual = isManualQuestion(q)
                    return (
                      <motion.div
                        key={q.id}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.28, delay: Math.min(idx * 0.04, 0.3), ease: [0.22, 0.61, 0.36, 1] }}
                        className={`${EXAM.card} p-4`}
                      >
                        <div className="flex items-start justify-between gap-3 mb-2">
                          <p className="text-sm font-medium text-[#27272A]"><span className="text-[#A1A1AA] mr-2">Q{idx + 1}.</span>{q.prompt}</p>
                          <span className="shrink-0 border border-[#E4E1D8] bg-[#FAF9F6] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#52525B] tabular-nums">{q.marks} marks</span>
                        </div>

                        {q.image_url && <QuestionImage src={q.image_url} alt={`Figure for question ${idx + 1}`} className="mb-2" />}

                        <div className="text-sm text-[#52525B] bg-[#F8F8F7] px-3 py-2 mb-2">
                          <span className="text-xs text-[#A1A1AA]">Answer: </span>{renderResponse(q, ans?.response ?? null)}
                        </div>

                        {!manual ? (
                          <div className="flex items-center gap-2 text-sm">
                            {ans?.is_correct === true ? (
                              <span className="inline-flex items-center gap-1 text-emerald-600"><CheckCircle2 size={15} /> Correct</span>
                            ) : ans?.is_correct === false ? (
                              <span className="inline-flex items-center gap-1 text-rose-500"><XCircle size={15} /> Incorrect</span>
                            ) : (
                              <span className="text-[#A1A1AA]">Not answered</span>
                            )}
                            <span className="text-[#A1A1AA]">·</span>
                            <span className="font-medium text-[#27272A]">{ans?.awarded_marks ?? 0} marks (auto)</span>
                            {correctText(q) && <span className="text-xs text-[#A1A1AA] ml-auto">Key: {correctText(q)}</span>}
                          </div>
                        ) : (
                          <div className="space-y-2">
                            {correctText(q) && <p className="text-xs text-[#A1A1AA]">Reference: {correctText(q)}</p>}
                            <div className="flex items-center gap-2">
                              <input
                                type="number"
                                min={0}
                                max={q.marks}
                                disabled={locked}
                                value={edits[q.id]?.marks ?? ''}
                                onChange={e => setEdits(prev => ({ ...prev, [q.id]: { marks: e.target.value, remark: prev[q.id]?.remark ?? '' } }))}
                                placeholder="0"
                                className="w-20 h-8 bg-white border border-[#E4E1D8] px-2 text-sm tabular-nums text-[#18181B] focus:outline-none focus:border-[#B8983C] focus:ring-1 focus:ring-[#B8983C]/25 transition-colors"
                              />
                              <span className="text-xs text-[#A1A1AA]">/ {q.marks}</span>
                              <input
                                disabled={locked}
                                value={edits[q.id]?.remark ?? ''}
                                onChange={e => setEdits(prev => ({ ...prev, [q.id]: { marks: prev[q.id]?.marks ?? '', remark: e.target.value } }))}
                                placeholder="Remark (optional)"
                                className="flex-1 h-8 bg-white border border-[#E4E1D8] px-2 text-sm text-[#18181B] placeholder:text-[#A8A29A] focus:outline-none focus:border-[#B8983C] focus:ring-1 focus:ring-[#B8983C]/25 transition-colors"
                              />
                              <button onClick={() => handleSaveManual(q)} disabled={locked || savingId === q.id} className={EXAM.darkBtnSm}>
                                {savingId === q.id ? <Loader2 size={13} className="animate-spin" /> : savedId === q.id ? <Check size={13} /> : 'Save'}
                              </button>
                            </div>
                          </div>
                        )}
                      </motion.div>
                    )
                  })}
                </div>

                <div className="mt-6 flex items-center justify-end gap-3">
                  {locked && (
                    <span className="inline-flex items-center gap-1.5 text-xs text-[#A1A1AA]">
                      <Lock size={13} /> Results published — grading is locked
                    </span>
                  )}
                  <button onClick={handleFinalize} disabled={locked || finalizing} className={EXAM.goldBtnLg}>
                    {finalizing ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                    Finalize grading
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </ProtectedLayout>
  )
}

function GradeSkeleton() {
  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-5 py-3">
        <div className="space-y-2">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-3 w-28" />
        </div>
        <Skeleton className="h-10 w-16" />
      </div>
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className={`${EXAM.card} p-4 space-y-2`}>
            <Skeleton className="h-3.5 w-3/4" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-7 w-1/2" />
          </div>
        ))}
      </div>
    </div>
  )
}
