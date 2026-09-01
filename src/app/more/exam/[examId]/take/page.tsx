'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { useParams, useRouter } from 'next/navigation'
import ProtectedLayout from '@/components/ProtectedLayout'
import { useAuth } from '@/contexts/AuthContext'
import {
  Clock,
  FileText,
  ChevronLeft,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Send,
} from 'lucide-react'
import { EXAM_MAX_W } from '@/components/exam/ExamNav'
import { EXAM, Skeleton, QuestionImage } from '@/components/exam/examUi'
import {
  Exam,
  StudentExamQuestion,
  ExamSubmission,
  AnswerResponse,
  fetchExamById,
  fetchQuestionsForStudent,
  fetchAnswers,
  startAttempt,
  saveAnswer,
  submitExam,
  examPhase,
  attemptDeadline,
  isExamClosed,
  canReviewExam,
} from '@/lib/exam'

type ResponseMap = Record<string, AnswerResponse>

// Reasons the student cannot take the exam right now.
type Blocked =
  | { kind: 'not_found' }
  | { kind: 'not_started'; startAt: string }
  /** Past the due/end time: attempts are over, the teacher is still grading. */
  | { kind: 'past_due'; dueAt: string | null }
  | { kind: 'submitted' }
  | { kind: 'closed' }

function formatClock(totalSeconds: number): string {
  const s = Math.max(0, totalSeconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`
}

export default function TakeExamPage() {
  const { examId } = useParams<{ examId: string }>()
  const router = useRouter()
  const { user, profile } = useAuth()

  const [loading, setLoading] = useState(true)
  const [exam, setExam] = useState<Exam | null>(null)
  const [questions, setQuestions] = useState<StudentExamQuestion[]>([])
  const [submission, setSubmission] = useState<ExamSubmission | null>(null)
  const [responses, setResponses] = useState<ResponseMap>({})
  const [blocked, setBlocked] = useState<Blocked | null>(null)
  // Whether the review page is open to this student (published results, or an
  // immediate-results exam they have already been graded on).
  const [reviewable, setReviewable] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  // Set when the exam publishes results immediately, so the score can be
  // shown on the confirmation screen instead of "wait for your teacher".
  const [instantResult, setInstantResult] = useState<{ totalScore: number; maxScore: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())

  // Debounce timers for autosave, keyed by question id.
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  // Latest responses, so submit can flush without stale closure.
  const responsesRef = useRef<ResponseMap>({})
  responsesRef.current = responses

  // ── Load exam, attempt, questions, saved answers ──
  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!examId || !user) return
      setLoading(true)

      // Questions only depend on examId, so fetch them alongside the exam
      // instead of waiting for the gating checks + attempt to resolve first.
      const examP = fetchExamById(examId)
      const questionsP = fetchQuestionsForStudent(examId)

      const ex = await examP
      if (cancelled) return
      if (!ex) {
        setBlocked({ kind: 'not_found' })
        setLoading(false)
        return
      }
      setExam(ex)

      // Attempts are only allowed while the exam is open: not before it
      // starts, and never once it is past due (even though the exam stays in
      // the Active list until results are published).
      const phase = examPhase(ex)
      if (phase === 'published' || isExamClosed(ex)) {
        setReviewable(true)
        setBlocked({ kind: 'closed' })
        setLoading(false)
        return
      }
      if (phase === 'scheduled' && ex.start_at) {
        setBlocked({ kind: 'not_started', startAt: ex.start_at })
        setLoading(false)
        return
      }
      if (phase === 'grading') {
        setBlocked({ kind: 'past_due', dueAt: ex.due_at ?? ex.end_at })
        setLoading(false)
        return
      }

      const sub = await startAttempt(examId, user.id)
      if (cancelled) return
      if (!sub) {
        setError('Could not start the exam. You may not have access.')
        setLoading(false)
        return
      }
      if (sub.status === 'submitted' || sub.status === 'graded' || sub.is_absent) {
        setReviewable(canReviewExam(ex, sub))
        setBlocked({ kind: 'submitted' })
        setLoading(false)
        return
      }
      setSubmission(sub)

      const [qs, saved] = await Promise.all([questionsP, fetchAnswers(sub.id)])
      if (cancelled) return
      setQuestions(qs)
      const initial: ResponseMap = {}
      for (const a of saved) initial[a.question_id] = a.response
      setResponses(initial)
      setLoading(false)
    }
    load()
    return () => {
      cancelled = true
    }
  }, [examId, user])

  // ── Ticking clock (1s) ──
  useEffect(() => {
    if (!submission || submitted) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [submission, submitted])

  // Deadline = earliest of (due_at / end_at) and (started_at + duration).
  const deadlineMs = useMemo(() => {
    if (!exam || !submission) return null
    const candidates: number[] = []
    const windowEnd = attemptDeadline(exam)
    if (windowEnd != null) candidates.push(windowEnd)
    if (exam.duration_minutes && submission.started_at) {
      candidates.push(new Date(submission.started_at).getTime() + exam.duration_minutes * 60_000)
    }
    return candidates.length ? Math.min(...candidates) : null
  }, [exam, submission])

  const secondsLeft = deadlineMs != null ? Math.floor((deadlineMs - now) / 1000) : null

  const flushSaves = useCallback(async (sub: ExamSubmission) => {
    const timers = Object.values(saveTimers.current) as ReturnType<typeof setTimeout>[]
    for (const timer of timers) clearTimeout(timer)
    saveTimers.current = {}
    const entries = Object.entries(responsesRef.current) as [string, AnswerResponse][]
    await Promise.all(entries.map(([qid, resp]) => saveAnswer(sub.id, qid, resp)))
  }, [])

  const handleSubmit = useCallback(
    async (auto = false) => {
      if (!submission || submitting || submitted) return
      setSubmitting(true)
      setError(null)
      await flushSaves(submission)
      const res = await submitExam(submission.id)
      if (res.success) {
        if (res.immediateResults && res.totalScore != null && res.maxScore != null) {
          setInstantResult({ totalScore: res.totalScore, maxScore: res.maxScore })
        }
        setSubmitted(true)
      } else {
        setError(res.error ?? 'Submission failed')
        if (!auto) setSubmitting(false)
        else setSubmitted(true) // on auto-submit failure, still leave the exam
      }
      setSubmitting(false)
    },
    [submission, submitting, submitted, flushSaves],
  )

  // Auto-submit when the clock runs out.
  useEffect(() => {
    if (secondsLeft != null && secondsLeft <= 0 && submission && !submitted && !submitting) {
      handleSubmit(true)
    }
  }, [secondsLeft, submission, submitted, submitting, handleSubmit])

  const handleChange = (questionId: string, value: AnswerResponse) => {
    setResponses(prev => ({ ...prev, [questionId]: value }))
    if (!submission) return
    clearTimeout(saveTimers.current[questionId])
    saveTimers.current[questionId] = setTimeout(() => {
      saveAnswer(submission.id, questionId, value)
    }, 800)
  }

  if (!user || !profile) return null

  const lowTime = secondsLeft != null && secondsLeft <= 60

  return (
    <ProtectedLayout>
      <div data-page-theme="exam">
        <div style={{ minHeight: '100vh' }}>
          <div className={`${EXAM_MAX_W} mx-auto px-4 sm:px-6 lg:px-8 py-6`}>
            <button
              onClick={() => router.push('/more/exam')}
              className={`${EXAM.ghostBtnSm} mb-4`}
            >
              <ChevronLeft size={16} /> Back to Exams
            </button>

            {loading ? (
              <TakeSkeleton />
            ) : submitted ? (
              <motion.div
                initial={{ opacity: 0, scale: 0.97 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.3, ease: [0.22, 0.61, 0.36, 1] }}
                className={`${EXAM.card} p-10 text-center`}
              >
                <CheckCircle2 size={44} className="text-emerald-500 mx-auto mb-3" />
                <h1 className="font-display text-2xl font-bold text-[#18181B]">Exam submitted</h1>
                {instantResult ? (
                  <>
                    <p className="text-sm text-[#71717A] mt-2">Your paper was graded automatically — here&apos;s your score.</p>
                    <div className="mt-5 inline-flex items-baseline gap-1 px-6 py-4 bg-[#F4F2EC] border border-[#E7E2D8]">
                      <span className="font-display text-4xl font-bold text-[#18181B] tabular-nums">{instantResult.totalScore}</span>
                      <span className="text-lg text-[#A1A1AA] tabular-nums">/{instantResult.maxScore}</span>
                    </div>
                    <div className="mt-6 flex items-center justify-center gap-2">
                      <button
                        onClick={() => router.push(`/more/exam/${examId}/review`)}
                        className={EXAM.darkBtn}
                      >
                        Review answers
                      </button>
                      <button
                        onClick={() => router.push('/more/exam')}
                        className={EXAM.ghostBtn}
                      >
                        Done
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-sm text-[#71717A] mt-2">
                      Your answers have been recorded. Results will appear once your teacher publishes them.
                    </p>
                    <button
                      onClick={() => router.push('/more/exam')}
                      className={`${EXAM.darkBtn} mt-6`}
                    >
                      Done
                    </button>
                  </>
                )}
              </motion.div>
            ) : blocked ? (
              <BlockedNotice
                blocked={blocked}
                canReview={reviewable}
                onReview={() => router.push(`/more/exam/${examId}/review`)}
              />
            ) : exam ? (
              <>
                {/* Header + sticky timer */}
                <div className="sticky top-0 z-10 -mx-4 sm:-mx-6 px-4 sm:px-6 py-3 bg-[#FDFCF9]/85 backdrop-blur border-b border-[#E4E1D8] mb-5">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <h1 className="font-display text-lg font-bold text-[#18181B] truncate flex items-center gap-2">
                        <FileText size={18} className="text-[#B8983C] shrink-0" />
                        {exam.title}
                      </h1>
                      <p className="text-xs text-[#A1A1AA]">
                        {questions.length} question{questions.length === 1 ? '' : 's'} · {exam.total_marks} marks
                      </p>
                    </div>
                    {secondsLeft != null && (
                      <div
                        className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold tabular-nums ${
                          lowTime ? 'bg-rose-50 text-rose-600 animate-pulse' : 'bg-[#1C1C1F] text-white'
                        }`}
                      >
                        <Clock size={15} />
                        {formatClock(secondsLeft)}
                      </div>
                    )}
                  </div>
                </div>

                {error && (
                  <div className="mb-4 px-4 py-3 bg-rose-50 border border-rose-200 text-sm text-rose-700 flex items-center gap-2">
                    <AlertCircle size={15} /> {error}
                  </div>
                )}

                {/* Questions */}
                <div className="space-y-4">
                  {questions.map((q, idx) => (
                    <motion.div
                      key={q.id}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.28, delay: Math.min(idx * 0.04, 0.3), ease: [0.22, 0.61, 0.36, 1] }}
                    >
                      <QuestionCard
                        index={idx + 1}
                        question={q}
                        value={responses[q.id]}
                        onChange={val => handleChange(q.id, val)}
                      />
                    </motion.div>
                  ))}
                  {questions.length === 0 && (
                    <div className={`${EXAM.card} p-8 text-center text-sm text-[#71717A]`}>
                      This exam has no questions yet.
                    </div>
                  )}
                </div>

                {/* Submit */}
                <div className="mt-6 flex justify-end">
                  <button
                    onClick={() => handleSubmit(false)}
                    disabled={submitting}
                    className={EXAM.goldBtnLg}
                  >
                    {submitting ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                    Submit Exam
                  </button>
                </div>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </ProtectedLayout>
  )
}

// ── Sub-components ──

function TakeSkeleton() {
  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-5 py-3">
        <div className="space-y-2">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-3 w-32" />
        </div>
        <Skeleton className="h-9 w-24" />
      </div>
      <div className="space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className={`${EXAM.card} p-5 space-y-3`}>
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ))}
      </div>
    </div>
  )
}

function BlockedNotice({
  blocked,
  canReview,
  onReview,
}: {
  blocked: Blocked
  canReview: boolean
  onReview: () => void
}) {
  const map: Record<Blocked['kind'], { title: string; body: string }> = {
    not_found: { title: 'Exam not found', body: 'This exam does not exist or you do not have access.' },
    not_started: { title: 'Not started yet', body: '' },
    past_due: { title: 'Past due', body: 'This exam is past its due date, so it can no longer be attempted. Results will appear once your teacher publishes them.' },
    submitted: { title: 'Already submitted', body: 'You have already submitted this exam.' },
    closed: { title: 'Results published', body: 'This exam is closed. You can review your answers.' },
  }
  const info = map[blocked.kind]
  const body =
    blocked.kind === 'not_started'
      ? `This exam opens on ${new Date(blocked.startAt).toLocaleString()}.`
      : blocked.kind === 'past_due' && blocked.dueAt
        ? `This exam was due on ${new Date(blocked.dueAt).toLocaleString()}, so it can no longer be attempted. Results will appear once your teacher publishes them.`
        : info.body

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: [0.22, 0.61, 0.36, 1] }}
      className={`${EXAM.card} p-10 text-center`}
    >
      <AlertCircle size={40} className="text-[#D4D4D8] mx-auto mb-3" />
      <h1 className="font-display text-xl font-bold text-[#18181B]">{info.title}</h1>
      <p className="text-sm text-[#71717A] mt-2">{body}</p>
      {canReview && (
        <button
          onClick={onReview}
          className={`${EXAM.darkBtn} mt-6`}
        >
          Review answers
        </button>
      )}
    </motion.div>
  )
}

function QuestionCard({
  index,
  question,
  value,
  onChange,
}: {
  index: number
  question: StudentExamQuestion
  value: AnswerResponse
  onChange: (val: AnswerResponse) => void
}) {
  const selected: string[] = Array.isArray(value) ? value : []

  const toggleMulti = (id: string) => {
    const next = selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id]
    onChange(next)
  }

  return (
    <div className={`${EXAM.card} p-5`}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <p className="text-sm font-medium text-[#27272A]">
          <span className="text-[#A1A1AA] mr-2">Q{index}.</span>
          {question.prompt}
        </p>
        <span className="shrink-0 border border-[#E4E1D8] bg-[#FAF9F6] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#52525B]">
          {question.marks} {question.marks === 1 ? 'mark' : 'marks'}
        </span>
      </div>

      {question.image_url && <QuestionImage src={question.image_url} alt={`Figure for question ${index}`} className="mb-3" />}

      {(question.type === 'subjective' || question.type === 'objective') && (
        <textarea
          value={typeof value === 'string' ? value : ''}
          onChange={e => onChange(e.target.value)}
          rows={question.type === 'subjective' ? 5 : 2}
          placeholder="Type your answer…"
          className="w-full px-3 py-2 bg-white border border-[#E4E1D8] text-sm text-[#27272A] focus:outline-none focus:border-[#B8983C] focus:ring-2 focus:ring-[#B8983C]/15 transition-all resize-y"
        />
      )}

      {question.type === 'integer' && (
        <input
          type="number"
          inputMode="numeric"
          value={typeof value === 'number' ? String(value) : ''}
          onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))}
          placeholder="Enter your numeric answer"
          className="w-full sm:w-64 px-3 py-2.5 bg-white border border-[#E4E1D8] text-sm text-[#27272A] focus:outline-none focus:border-[#B8983C] focus:ring-2 focus:ring-[#B8983C]/15 transition-all"
        />
      )}

      {question.type === 'true_false' && (
        <div className="flex gap-3">
          {[
            { label: 'True', val: true },
            { label: 'False', val: false },
          ].map(opt => (
            <label
              key={opt.label}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 border cursor-pointer text-sm font-medium transition-colors ${
                value === opt.val
                  ? 'border-[#B8983C] bg-[#F4F2EC] text-[#B8983C]'
                  : 'border-[#E4E1D8] text-[#52525B] hover:bg-[#FAFAFA]'
              }`}
            >
              <input
                type="radio"
                className="hidden"
                checked={value === opt.val}
                onChange={() => onChange(opt.val)}
              />
              {opt.label}
            </label>
          ))}
        </div>
      )}

      {question.type === 'mcq' && (
        <div className="space-y-2">
          {(question.options ?? []).map(opt => {
            const isChecked = selected.includes(opt.id)
            return (
              <label
                key={opt.id}
                className={`flex items-center gap-3 px-3 py-2.5 border cursor-pointer text-sm transition-colors ${
                  isChecked
                    ? 'border-[#B8983C] bg-[#F4F2EC] text-[#B8983C]'
                    : 'border-[#E4E1D8] text-[#27272A] hover:bg-[#FAFAFA]'
                }`}
              >
                <input
                  type={question.multiple_select ? 'checkbox' : 'radio'}
                  className="accent-[#B8983C]"
                  checked={isChecked}
                  onChange={() => (question.multiple_select ? toggleMulti(opt.id) : onChange([opt.id]))}
                />
                {opt.text}
              </label>
            )
          })}
          {(question.options ?? []).length === 0 && (
            <p className="text-xs text-[#A1A1AA]">No options provided.</p>
          )}
        </div>
      )}
    </div>
  )
}
