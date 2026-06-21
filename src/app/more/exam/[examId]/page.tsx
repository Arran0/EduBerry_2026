'use client'

import React, { useCallback, useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useParams, useRouter } from 'next/navigation'
import ProtectedLayout from '@/components/ProtectedLayout'
import { useAuth } from '@/contexts/AuthContext'
import { isStaffRole } from '@/lib/supabase'
import {
  FileText, Shield, ClipboardCheck, ListChecks, Settings2,
  FileSpreadsheet, BarChart3, Lock, Unlock, Trash2, Loader2,
} from 'lucide-react'
import {
  Exam, fetchExamById, closeExam, reopenExam, deleteExam, countParticipants,
} from '@/lib/exam'
import { getExamMode } from '@/lib/examScoring'
import GradersEditor from '@/components/exam/GradersEditor'
import GradingTab from '@/components/exam/GradingTab'
import SheetTab from '@/components/exam/SheetTab'
import ResultsTab from '@/components/exam/ResultsTab'
import MiniNav, { EXAM_MAX_W } from '@/components/exam/ExamNav'
import { EXAM, Skeleton } from '@/components/exam/examUi'

type Tab = 'graders' | 'grading' | 'sheet' | 'results'

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'graders', label: 'Graders', icon: <Shield size={15} /> },
  { id: 'grading', label: 'Grading', icon: <ClipboardCheck size={15} /> },
  { id: 'sheet', label: 'Sheet', icon: <FileSpreadsheet size={15} /> },
  { id: 'results', label: 'Results', icon: <BarChart3 size={15} /> },
]

export default function ExamDetailPage() {
  const { examId } = useParams<{ examId: string }>()
  const router = useRouter()
  const { user, profile } = useAuth()

  const [exam, setExam] = useState<Exam | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('graders')
  const [participantCount, setParticipantCount] = useState<number | null>(null)
  const [busy, setBusy] = useState<null | 'close' | 'delete'>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const [ex, count] = await Promise.all([fetchExamById(examId), countParticipants(examId)])
    setExam(ex)
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

  const handleToggleClose = async () => {
    if (!exam) return
    if (!exam.is_closed && !confirm('Close this exam? Students who haven’t submitted will be marked absent and can no longer attempt it.')) return
    setBusy('close')
    if (exam.is_closed) await reopenExam(exam.id)
    else await closeExam(exam.id)
    await load()
    setBusy(null)
  }

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
            <div className="flex items-center justify-between mb-4">
              <button
                onClick={() => router.push('/more/exam')}
                className="inline-flex items-center gap-1.5 text-sm text-[#71717A] hover:text-[#27272A] transition-colors"
              >
                <ListChecks size={15} /> All Exams
              </button>
              <button
                onClick={() => router.push(`/more/exam/${examId}/edit`)}
                className="inline-flex items-center gap-1.5 text-sm text-[#71717A] hover:text-[#27272A] transition-colors"
              >
                <Settings2 size={15} /> Pre-Exam Manager
              </button>
            </div>

            {loading ? (
              <DetailSkeleton />
            ) : !exam ? (
              <div className={`${EXAM.card} shadow-sm p-10 text-center text-[#71717A]`}>Exam not found.</div>
            ) : !isStaff ? (
              <div className={`${EXAM.card} shadow-sm p-10 text-center text-[#71717A]`}>This page is for staff.</div>
            ) : (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.28, ease: [0.22, 0.61, 0.36, 1] }}
              >
                {/* Header */}
                <div className="flex items-start justify-between gap-3 mb-5">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="w-11 h-11 rounded-xl bg-[var(--page-primary)] flex items-center justify-center shrink-0">
                      <FileText size={22} className="text-[var(--page-accent)]" />
                    </div>
                    <div className="min-w-0">
                      <h1 className="font-display text-2xl font-bold text-[#18181B]">Post-Exam Manager</h1>
                      <p className="text-sm font-medium text-[#52525B] truncate mt-0.5">{exam.title}</p>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-[#A1A1AA] mt-0.5">
                        {exam.subject && <span>{exam.subject}</span>}
                        {modeLabel && <span className="uppercase text-[var(--page-accent)] font-semibold">{modeLabel}</span>}
                        <span>{exam.total_marks} marks</span>
                        {exam.results_published && <span className="text-emerald-500">Results published</span>}
                        {exam.is_closed && <span className="inline-flex items-center gap-1 text-[#71717A]"><Lock size={11} /> Closed</span>}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {canManage && (
                      <button onClick={handleToggleClose} disabled={busy === 'close'} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[#E4E4E7] bg-white text-sm text-[#71717A] hover:text-[#27272A] hover:border-[#D4D4D8] disabled:opacity-60 transition-colors">
                        {busy === 'close' ? <Loader2 size={14} className="animate-spin" /> : exam.is_closed ? <Unlock size={14} /> : <Lock size={14} />}
                        {exam.is_closed ? 'Reopen' : 'Close'}
                      </button>
                    )}
                    {isOwner && (
                      <button
                        onClick={handleDelete}
                        disabled={!canDelete || busy === 'delete'}
                        title={canDelete ? 'Delete exam' : 'Remove all participants before deleting'}
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-rose-200 bg-white text-sm text-rose-500 hover:bg-rose-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      >
                        {busy === 'delete' ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                      </button>
                    )}
                  </div>
                </div>

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

                <div className={`${EXAM.card} shadow-sm p-5`}>
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

function DetailSkeleton() {
  return (
    <div>
      {/* Header */}
      <div className="flex items-start gap-3 mb-5">
        <Skeleton className="w-11 h-11 rounded-xl shrink-0" />
        <div className="flex-1 space-y-2 pt-1">
          <Skeleton className="h-6 w-56" />
          <Skeleton className="h-3.5 w-40" />
          <Skeleton className="h-3 w-32" />
        </div>
      </div>
      {/* Tabs */}
      <Skeleton className="h-12 w-full rounded-xl mb-4" />
      {/* Body */}
      <div className={`${EXAM.card} shadow-sm p-5 space-y-3`}>
        <Skeleton className="h-4 w-1/3" />
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 py-1">
            <Skeleton className="w-9 h-9 rounded-full shrink-0" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-3.5 w-2/5" />
              <Skeleton className="h-2.5 w-3/5" />
            </div>
            <Skeleton className="h-7 w-16 rounded-lg shrink-0" />
          </div>
        ))}
      </div>
    </div>
  )
}
