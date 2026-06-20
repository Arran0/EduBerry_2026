'use client'

import React, { useCallback, useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useParams, useRouter } from 'next/navigation'
import ProtectedLayout from '@/components/ProtectedLayout'
import { useAuth } from '@/contexts/AuthContext'
import { isStaffRole } from '@/lib/supabase'
import {
  Pencil, FileText, Shield, ClipboardCheck, ListChecks, Settings2,
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
      <div data-page-theme="exam" className={`${EXAM_MAX_W} mx-auto px-4 sm:px-6 lg:px-8 py-6`}>
        <MiniNav
          className="mb-4"
          items={[
            { id: 'all', label: 'All Exams', icon: <ListChecks size={15} />, onClick: () => router.push('/more/exam') },
            { id: 'pre', label: 'Pre-Exam Manager', icon: <Settings2 size={15} />, onClick: () => router.push(`/more/exam/${examId}/edit`) },
          ]}
        />

        {loading ? (
          <div className="text-center py-16"><div className="spinner mx-auto mb-3" /><p className="text-sm text-slate-500">Loading…</p></div>
        ) : !exam ? (
          <div className="glass rounded-2xl p-10 text-center text-slate-500">Exam not found.</div>
        ) : !isStaff ? (
          <div className="glass rounded-2xl p-10 text-center text-slate-500">This page is for staff.</div>
        ) : (
          <>
            {/* Header */}
            <div className="flex items-start justify-between gap-3 mb-5">
              <div className="flex items-start gap-3 min-w-0">
                <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center text-white shadow-sm shrink-0">
                  <FileText size={22} />
                </div>
                <div className="min-w-0">
                  <h1 className="font-display text-2xl font-bold text-slate-800">Post-Exam Manager</h1>
                  <p className="text-sm font-medium text-slate-600 truncate mt-0.5">{exam.title}</p>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400 mt-0.5">
                    {exam.subject && <span>{exam.subject}</span>}
                    {modeLabel && <span className="uppercase text-amber-600">{modeLabel}</span>}
                    <span>{exam.total_marks} marks</span>
                    {exam.results_published && <span className="text-emerald-500">Results published</span>}
                    {exam.is_closed && <span className="inline-flex items-center gap-1 text-slate-500"><Lock size={11} /> Closed</span>}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {canManage && (
                  <button onClick={handleToggleClose} disabled={busy === 'close'} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-60">
                    {busy === 'close' ? <Loader2 size={14} className="animate-spin" /> : exam.is_closed ? <Unlock size={14} /> : <Lock size={14} />}
                    {exam.is_closed ? 'Reopen' : 'Close'}
                  </button>
                )}
                {canManage && (
                  <button onClick={() => router.push(`/more/exam/${examId}/edit`)} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 text-sm text-slate-600 hover:bg-slate-50">
                    <Pencil size={14} /> Edit
                  </button>
                )}
                {isOwner && (
                  <button
                    onClick={handleDelete}
                    disabled={!canDelete || busy === 'delete'}
                    title={canDelete ? 'Delete exam' : 'Remove all participants before deleting'}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-rose-200 text-sm text-rose-500 hover:bg-rose-50 disabled:opacity-40 disabled:cursor-not-allowed"
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

            <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
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
          </>
        )}
      </div>
    </ProtectedLayout>
  )
}
