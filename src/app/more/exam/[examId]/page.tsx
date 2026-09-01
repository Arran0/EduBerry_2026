'use client'

import React, { Suspense, useCallback, useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import ProtectedLayout from '@/components/ProtectedLayout'
import { useAuth } from '@/contexts/AuthContext'
import { isStaffRole } from '@/lib/supabase'
import {
  FileText, Shield, ClipboardCheck, ListChecks, Settings2,
  FileSpreadsheet, Link2, Trash2, Loader2,
} from 'lucide-react'
import {
  Exam, fetchExamById, deleteExam, countParticipants,
  reconcileExamClosure, examPhase, EXAM_PHASE_META,
} from '@/lib/exam'
import { getExamMode } from '@/lib/examScoring'
import GradersEditor from '@/components/exam/GradersEditor'
import GradingTab from '@/components/exam/GradingTab'
import SheetTab from '@/components/exam/SheetTab'
import ResultsTab from '@/components/exam/ResultsTab'
import MiniNav, { EXAM_MAX_W } from '@/components/exam/ExamNav'
import { EXAM, Skeleton, StatStrip, ExamPhaseChip, ImmediateResultsChip } from '@/components/exam/examUi'

type Tab = 'graders' | 'grading' | 'sheet' | 'results'

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'graders', label: 'Graders', icon: <Shield size={15} /> },
  { id: 'grading', label: 'Grading', icon: <ClipboardCheck size={15} /> },
  { id: 'sheet', label: 'Sheet', icon: <FileSpreadsheet size={15} /> },
  { id: 'results', label: 'Link Results', icon: <Link2 size={15} /> },
]

const TAB_IDS: Tab[] = ['graders', 'grading', 'sheet', 'results']

function ExamDetailPageContent() {
  const { examId } = useParams<{ examId: string }>()
  const router = useRouter()
  const searchParams = useSearchParams()
  const { user, profile } = useAuth()

  const [exam, setExam] = useState<Exam | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('graders')

  // Deep-link support, e.g. /more/exam/[examId]?tab=grading
  useEffect(() => {
    const t = searchParams.get('tab')
    if (t && (TAB_IDS as string[]).includes(t)) setTab(t as Tab)
  }, [searchParams])
  const [participantCount, setParticipantCount] = useState<number | null>(null)
  const [busy, setBusy] = useState<null | 'delete'>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const [ex, count] = await Promise.all([fetchExamById(examId), countParticipants(examId)])
    // Applies a due auto-close (immediate-results exams) on open.
    const fresh = ex ? await reconcileExamClosure(ex) : null
    setExam(fresh)
    setParticipantCount(count)
    setLoading(false)
  }, [examId])

  useEffect(() => { load() }, [load])

  if (!user || !profile) return null
  const isStaff = isStaffRole(profile.role)
  const isOwner = !!exam && exam.created_by === user.id
  // RLS only lets a managing staff member load the exam (owner / grader /
  // admin / principal / coordinator-of-creator), so a staff viewer here can manage it.
  const canManage = isStaff && !!exam

  const handleDelete = async () => {
    if (!exam) return
    if (!confirm('Delete this exam permanently? This cannot be undone.')) return
    setBusy('delete')
    const res = await deleteExam(exam.id)
    setBusy(null)
    if (res.success) router.push('/more/exam')
    else alert(res.error ?? 'Could not delete exam.')
  }

  const canDelete = isOwner && participantCount === 0
  const modeLabel = exam && exam.exam_mode !== 'school' ? getExamMode(exam.exam_mode).label : null

  return (
    <ProtectedLayout>
      <div data-page-theme="exam">
        <div style={{ minHeight: '100vh' }}>
          <div className={`${EXAM_MAX_W} mx-auto px-4 sm:px-6 lg:px-8 py-6`}>
            <div className="flex items-center justify-between gap-2 mb-4">
              <button onClick={() => router.push('/more/exam')} className={EXAM.ghostBtnSm}>
                <ListChecks size={14} /> All Exams
              </button>
              <button onClick={() => router.push(`/more/exam/${examId}/edit`)} className={EXAM.ghostBtnSm}>
                <Settings2 size={14} /> Pre-Exam Manager
              </button>
            </div>

            {loading ? (
              <DetailSkeleton />
            ) : !exam ? (
              <div className={`${EXAM.cardBleed} p-10 text-center text-[#71717A]`}>Exam not found.</div>
            ) : !isStaff ? (
              <div className={`${EXAM.cardBleed} p-10 text-center text-[#71717A]`}>This page is for staff.</div>
            ) : (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.28, ease: [0.22, 0.61, 0.36, 1] }}
              >
                {/* Header */}
                <div className="flex items-start justify-between gap-3 pb-4 mb-4 border-b border-[#E4E1D8]">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className={`w-11 h-11 ${EXAM.iconTile}`}>
                      <FileText size={22} className="text-[#D4BC6A]" />
                    </div>
                    <div className="min-w-0">
                      <p className={EXAM.eyebrow}>Post-Exam Manager</p>
                      <h1 className="font-display text-2xl font-bold text-[#18181B] truncate mt-1">{exam.title}</h1>
                      <div className="flex flex-wrap items-center gap-1.5 mt-2">
                        {exam.subject && <span className={EXAM.tag}>{exam.subject}</span>}
                        {modeLabel && <span className={EXAM.tagGold}>{modeLabel}</span>}
                        <ExamPhaseChip phase={examPhase(exam)} />
                        {exam.immediate_results && <ImmediateResultsChip />}
                      </div>
                    </div>
                  </div>
                  {isOwner && (
                    <button
                      onClick={handleDelete}
                      disabled={!canDelete || busy === 'delete'}
                      title={canDelete ? 'Delete exam' : 'Remove all participants before deleting'}
                      className={`${EXAM.iconBtnDanger} shrink-0`}
                    >
                      {busy === 'delete' ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                    </button>
                  )}
                </div>

                {/* Instrument panel */}
                <StatStrip
                  className="mb-3"
                  items={[
                    { label: 'Total marks', value: exam.total_marks },
                    { label: 'Participants', value: participantCount ?? '—' },
                    { label: 'Duration', value: exam.duration_minutes ? `${exam.duration_minutes}m` : '—' },
                    {
                      label: 'Results',
                      value: exam.results_published ? 'Published' : 'Withheld',
                      accent: !exam.results_published,
                    },
                  ]}
                />
                <p className="text-[11px] text-[#A8A29A] mb-4">{EXAM_PHASE_META[examPhase(exam)].hint}</p>

                {/* Tabs */}
                <MiniNav
                  className="mb-4"
                  items={TABS.map(t => ({
                    id: t.id,
                    label: t.label,
                    icon: t.icon,
                    active: tab === t.id,
                    onClick: () => setTab(t.id),
                  }))}
                />

                <div className={`${EXAM.cardBleed} p-5`}>
                  <AnimatePresence mode="wait">
                    <motion.div
                      key={tab}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -6 }}
                      transition={{ duration: 0.16 }}
                    >
                      {tab === 'graders' && <GradersEditor examId={examId} createdBy={exam.created_by} currentUserId={user.id} canEdit={isOwner} />}
                      {tab === 'grading' && <GradingTab exam={exam} canManage={canManage} onPublished={load} />}
                      {tab === 'sheet' && <SheetTab exam={exam} userId={user.id} />}
                      {tab === 'results' && <ResultsTab exam={exam} userId={user.id} userRole={profile.role} canManage={canManage} />}
                    </motion.div>
                  </AnimatePresence>
                </div>
              </motion.div>
            )}
          </div>
        </div>
      </div>
    </ProtectedLayout>
  )
}

export default function ExamDetailPage() {
  return (
    <Suspense fallback={
      <ProtectedLayout>
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="spinner" />
        </div>
      </ProtectedLayout>
    }>
      <ExamDetailPageContent />
    </Suspense>
  )
}

function DetailSkeleton() {
  return (
    <div>
      {/* Header */}
      <div className="flex items-start gap-3 pb-4 mb-4 border-b border-[#E4E1D8]">
        <Skeleton className="w-11 h-11 shrink-0" />
        <div className="flex-1 space-y-2 pt-1">
          <Skeleton className="h-6 w-56" />
          <Skeleton className="h-3.5 w-40" />
        </div>
      </div>
      {/* Stats */}
      <Skeleton className="h-[62px] w-full mb-4" />
      {/* Tabs */}
      <Skeleton className="h-10 w-full mb-4" />
      {/* Body */}
      <div className={`${EXAM.cardBleed} p-5 space-y-3`}>
        <Skeleton className="h-4 w-1/3" />
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 py-1">
            <Skeleton className="w-9 h-9 rounded-full shrink-0" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-3.5 w-2/5" />
              <Skeleton className="h-2.5 w-3/5" />
            </div>
            <Skeleton className="h-7 w-16 shrink-0" />
          </div>
        ))}
      </div>
    </div>
  )
}
