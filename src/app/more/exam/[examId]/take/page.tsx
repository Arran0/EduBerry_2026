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
import { EXAM, Skeleton } from '@/components/exam/examUi'
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
} from '@/lib/exam'

type ResponseMap = Record<string, AnswerResponse>

// Reasons the student cannot take the exam right now.
type Blocked =
  | { kind: 'not_found' }
  | { kind: 'not_started'; startAt: string }
  | { kind: 'over' }
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
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
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

      const nowMs = Date.now()
      if (ex.results_published) {
        setBlocked({ kind: 'closed' })
        setLoading(false)
        return
      }
      if (ex.is_closed) {
        setBlocked({ kind: 'over' })
        setLoading(false)
        return
      }
      if (ex.start_at && nowMs < new Date(ex.start_at).getTime()) {
        setBlocked({ kind: 'not_started', startAt: ex.start_at })
        setLoading(false)
        return
      }
      if (ex.end_at && nowMs > new Date(ex.end_at).getTime()) {
        setBlocked({ kind: 'over' })
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

  // Deadline = earliest of (end_at) and (started_at + duration).
  const deadlineMs = useMemo(() => {
    if (!exam || !submission) return null
    const candidates: number[] = []
    if (exam.end_at) candidates.push(new Date(exam.end_at).getTime())
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
              className="flex items-center gap-1.5 text-sm text-[#71717A] hover:text-[#27272A] mb-4 transition-colors"
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
                className={`${EXAM.card} shadow-sm p-10 text-center`}
              >
                <CheckCircle2 size={44} className="text-emerald-500 mx-auto mb-3" />
                <h1 className="font-display text-2xl font-bold text-[#18181B]">Exam submitted</h1>
                <p className="text-sm text-[#71717A] mt-2">
                  Your answers have been recorded. Results will appear once your teacher publishes them.
                </p>
                <button
                  onClick={() => router.push('/more/exam')}
                  className="mt-6 px-5 py-2.5 rounded-lg bg-[var(--page-primary)] text-white text-sm font-semibold hover:bg-[var(--page-primary-dark)] transition-colors"
                >
                  Done
                </button>
              </motion.div>
            ) : blocked ? (
              <BlockedNotice blocked={blocked} onReview={() => router.push(`/more/exam/${examId}/review`)} />
            ) : exam ? (
              <>
                {/* Header + sticky timer */}
                <div className="sticky top-0 z-10 -mx-4 sm:-mx-6 px-4 sm:px-6 py-3 bg-[#FDFCF9]/85 backdrop-blur border-b border-[#E4E4E7] mb-5">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <h1 className="font-display text-lg font-bold text-[#18181B] truncate flex items-center gap-2">
                        <FileText size={18} className="text-[var(--page-accent)] shrink-0" />
                        {exam.title}
                      </h1>
                      <p className="text-xs text-[#A1A1AA]">
                        {questions.length} question{questions.length === 1 ? '' : 's'} · {exam.total_marks} marks
                      </p>
                    </div>
                    {secondsLeft != null && (
                      <div
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold tabular-nums ${
                          lowTime ? 'bg-rose-50 text-rose-600 animate-pulse' : 'bg-[var(--page-primary)] text-white'
                        }`}
                      >
                        <Clock size={15} />
                        {formatClock(secondsLeft)}
                      </div>
                    )}
                  </div>
                </div>

                {error && (
                  <div className="mb-4 px-4 py-3 bg-rose-50 border border-rose-200 rounded-xl text-sm text-rose-700 flex items-center gap-2">
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
                    <div className={`${EXAM.card} shadow-sm p-8 text-center text-sm text-[#71717A]`}>
                      This exam has no questions yet.
                    </div>
                  )}
                </div>

                {/* Submit */}
                <div className="mt-6 flex justify-end">
                  <button
                    onClick={() => handleSubmit(false)}
                    disabled={submitting}
                    className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-[var(--page-accent)] text-white text-sm font-semibold hover:brightness-95 disabled:opacity-60 transition-colors"
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
        <Skeleton className="h-9 w-24 rounded-lg" />
      </div>
      <div className="space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className={`${EXAM.card} shadow-sm p-5 space-y-3`}>
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-10 w-full rounded-xl" />
            <Skeleton className="h-10 w-full rounded-xl" />
          </div>
        ))}
      </div>
    </div>
  )
}

function BlockedNotice({ blocked, onReview }: { blocked: Blocked; onReview: () => void }) {
  const map: Record<Blocked['kind'], { title: string; body: string }> = {
    not_found: { title: 'Exam not found', body: 'This exam does not exist or you do not have access.' },
    not_started: { title: 'Not started yet', body: '' },
    over: { title: 'Exam closed', body: 'The exam window has ended. You can no longer submit answers.' },
    submitted: { title: 'Already submitted', body: 'You have already submitted this exam.' },
    closed: { title: 'Results published', body: 'This exam is closed. You can review your answers.' },
  }
  const info = map[blocked.kind]
  const body =
    blocked.kind === 'not_started'
      ? `This exam opens on ${new Date(blocked.startAt).toLocaleString()}.`
      : info.body

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: [0.22, 0.61, 0.36, 1] }}
      className={`${EXAM.card} shadow-sm p-10 text-center`}
    >
      <AlertCircle size={40} className="text-[#D4D4D8] mx-auto mb-3" />
      <h1 className="font-display text-xl font-bold text-[#18181B]">{info.title}</h1>
      <p className="text-sm text-[#71717A] mt-2">{body}</p>
      {blocked.kind === 'closed' && (
        <button
          onClick={onReview}
          className="mt-6 px-5 py-2.5 rounded-lg bg-[var(--page-primary)] text-white text-sm font-semibold hover:bg-[var(--page-primary-dark)] transition-colors"
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
    <div className={`${EXAM.card} shadow-sm p-5`}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <p className="text-sm font-medium text-[#27272A]">
          <span className="text-[#A1A1AA] mr-2">Q{index}.</span>
          {question.prompt}
        </p>
        <span className="shrink-0 text-xs px-2 py-0.5 rounded-full bg-[#F4F4F5] text-[#71717A]">
          {question.marks} {question.marks === 1 ? 'mark' : 'marks'}
        </span>
      </div>

      {(question.type === 'subjective' || question.type === 'objective') && (
        <textarea
          value={typeof value === 'string' ? value : ''}
          onChange={e => onChange(e.target.value)}
          rows={question.type === 'subjective' ? 5 : 2}
          placeholder="Type your answer…"
          className="w-full px-3 py-2 bg-white border border-[#E4E4E7] rounded-xl text-sm text-[#27272A] focus:outline-none focus:border-[var(--page-primary)] transition-colors resize-y"
        />
      )}

      {question.type === 'integer' && (
        <input
          type="number"
          inputMode="numeric"
          value={typeof value === 'number' ? String(value) : ''}
          onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))}
          placeholder="Enter your numeric answer"
          className="w-full sm:w-64 px-3 py-2.5 bg-white border border-[#E4E4E7] rounded-xl text-sm text-[#27272A] focus:outline-none focus:border-[var(--page-primary)] transition-colors"
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
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border cursor-pointer text-sm font-medium transition-colors ${
                value === opt.val
                  ? 'border-[var(--page-accent)] bg-[var(--page-accent-light)] text-[var(--page-accent)]'
                  : 'border-[#E4E4E7] text-[#52525B] hover:bg-[#FAFAFA]'
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
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border cursor-pointer text-sm transition-colors ${
                  isChecked
                    ? 'border-[var(--page-accent)] bg-[var(--page-accent-light)] text-[var(--page-accent)]'
                    : 'border-[#E4E4E7] text-[#27272A] hover:bg-[#FAFAFA]'
                }`}
              >
                <input
                  type={question.multiple_select ? 'checkbox' : 'radio'}
                  className="accent-[var(--page-accent)]"
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
