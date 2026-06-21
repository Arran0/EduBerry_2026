'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import ProtectedLayout from '@/components/ProtectedLayout'
import PageBanner from '@/components/PageBanner'
import { useAuth } from '@/contexts/AuthContext'
import { isStaffRole } from '@/lib/supabase'
import { EXAM_BANNER_DEFAULT } from '@/lib/pageConfig'
import {
  FileText, Plus, Clock, Lock, Library, ChevronRight, Pencil,
  Users, CheckCircle2, AlertCircle, ClipboardCheck,
} from 'lucide-react'
import {
  Exam,
  ExamTeacherSummary,
  ExamStudentSummary,
  fetchExamsForTeacher,
  fetchExamsForStudent,
} from '@/lib/exam'
import { getExamMode } from '@/lib/examScoring'
import NewExamSheet from '@/components/exam/NewExamSheet'
import MiniNav, { EXAM_MAX_W } from '@/components/exam/ExamNav'
import {
  EXAM, FadeIn, ExamListSkeleton, ExamStatsSkeleton, ExamStats, ExamStatCard,
} from '@/components/exam/examUi'

type TeacherTab = 'active' | 'closed'

const MAX_W = EXAM_MAX_W

function examWindowLabel(exam: Exam): string | null {
  if (exam.due_at) return `Due ${new Date(exam.due_at).toLocaleString()}`
  if (exam.start_at) return `Opens ${new Date(exam.start_at).toLocaleString()}`
  return null
}

function modeBadge(exam: Exam): string | null {
  if (!exam.exam_mode || exam.exam_mode === 'school') return null
  return getExamMode(exam.exam_mode).label
}

export default function ExamPage() {
  const { user, profile } = useAuth()
  const router = useRouter()
  const isStaff = profile ? isStaffRole(profile.role) : false
  const isAdmin = profile?.role === 'admin'

  const [tab, setTab] = useState<TeacherTab>('active')
  const [loading, setLoading] = useState(true)
  const [teacherExams, setTeacherExams] = useState<{ active: ExamTeacherSummary[]; closed: ExamTeacherSummary[] }>({ active: [], closed: [] })
  const [studentExams, setStudentExams] = useState<{ active: ExamStudentSummary[]; closed: ExamStudentSummary[] }>({ active: [], closed: [] })
  const [showNew, setShowNew] = useState(false)
  const [bannerEditing, setBannerEditing] = useState(false)

  const load = useCallback(async () => {
    if (!user || !profile) return
    setLoading(true)
    if (isStaff) {
      setTeacherExams(await fetchExamsForTeacher(user.id, profile.role))
    } else {
      setStudentExams(await fetchExamsForStudent(user.id))
    }
    setLoading(false)
  }, [user, profile, isStaff])

  useEffect(() => { load() }, [load])

  // Summary stat cards (Fee-Manager style) — computed across both lists.
  const stats = useMemo<ExamStatCard[]>(() => {
    if (isStaff) {
      const toGrade = teacherExams.active.reduce((s, e) => s + Math.max(0, e.audienceCount - e.gradedCount), 0)
      return [
        { label: 'Active', value: String(teacherExams.active.length), sub: 'open exams', icon: <Clock size={16} className="text-[var(--page-accent)]" />, tone: 'dark' },
        { label: 'To grade', value: String(toGrade), sub: 'submissions pending', icon: <ClipboardCheck size={16} className="text-[#71717A]" />, tone: 'light' },
      ]
    }
    const all = [...studentExams.active, ...studentExams.closed]
    const todo = studentExams.active.filter(e => {
      const st = e.submission?.status
      return !e.is_closed && !e.submission?.is_absent && st !== 'submitted' && st !== 'graded'
    }).length
    const submitted = all.filter(e => e.submission?.status === 'submitted' || e.submission?.status === 'graded').length
    return [
      { label: 'To do', value: String(todo), sub: 'exams to take', icon: <Clock size={16} className="text-[var(--page-accent)]" />, tone: 'dark' },
      { label: 'Awaiting results', value: String(submitted), sub: 'submitted exams', icon: <CheckCircle2 size={16} className="text-[#71717A]" />, tone: 'light' },
    ]
  }, [isStaff, teacherExams, studentExams])

  if (!user || !profile) return null

  const list = isStaff ? teacherExams[tab] : studentExams[tab]

  return (
    <ProtectedLayout>
      <div data-page-theme="exam" style={{ minHeight: '100vh' }}>
        <div>
          <PageBanner
            settingKey="exam_banner"
            defaultBanner={EXAM_BANNER_DEFAULT}
            icon={<FileText size={24} className="text-white" />}
            backgroundIcon={<FileText size={180} className="text-white" />}
            title="Exams"
            subtitle={isStaff ? 'Create, grade, and publish exams' : 'Take your exams and review results'}
            isAdmin={isAdmin}
            maxWidth={MAX_W}
            onBack={() => router.back()}
            onEditingChange={setBannerEditing}
            actions={isStaff ? (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => router.push('/more/exam/pyq')}
                  className="hidden sm:inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/15 border border-white/25 text-sm text-white hover:bg-white/25 transition-colors"
                >
                  <Library size={15} /> PYQ
                </button>
                <button
                  onClick={() => setShowNew(true)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[var(--page-accent)] text-white text-sm font-semibold hover:brightness-95 shadow-sm transition-all"
                >
                  <Plus size={16} /> New Exam
                </button>
              </div>
            ) : undefined}
          />

          <div
            className={`${MAX_W} mx-auto px-4 sm:px-6 lg:px-8 pb-10 transition-all duration-200 ${
              bannerEditing ? 'opacity-30 blur-[1px] pointer-events-none select-none' : ''
            }`}
            aria-hidden={bannerEditing}
          >
            {/* Summary cards — overlap the banner, Fee-Manager style */}
            <div className="relative z-10 -mt-6 sm:-mt-8 mb-4">
              {loading ? <ExamStatsSkeleton /> : <ExamStats cards={stats} />}
            </div>

            {/* Tabs */}
            <MiniNav
              className="mb-4"
              items={(['active', 'closed'] as TeacherTab[]).map(t => ({
                id: t,
                label: t.charAt(0).toUpperCase() + t.slice(1),
                icon: t === 'active' ? <Clock size={15} /> : <Lock size={15} />,
                active: tab === t,
                onClick: () => setTab(t),
              }))}
            />

            {/* List */}
            {loading ? (
              <ExamListSkeleton rows={5} />
            ) : list.length === 0 ? (
              <FadeIn>
                <div className={`${EXAM.card} shadow-sm p-10 text-center`}>
                  <div className="w-16 h-16 mx-auto mb-4 rounded-xl bg-[var(--page-primary)] flex items-center justify-center">
                    <FileText size={28} className="text-[var(--page-accent)]" strokeWidth={1.6} />
                  </div>
                  <p className="text-[#27272A] font-semibold">No {tab} exams</p>
                  {isStaff && tab === 'active' && (
                    <p className="text-sm text-[#A1A1AA] mt-1">Create a new exam to get started.</p>
                  )}
                </div>
              </FadeIn>
            ) : (
              <div className="space-y-3">
                {isStaff
                  ? (list as ExamTeacherSummary[]).map((ex, i) => (
                      <FadeIn key={ex.id} index={i}>
                        <TeacherExamCard exam={ex} onOpen={() => router.push(`/more/exam/${ex.id}`)} onEdit={() => router.push(`/more/exam/${ex.id}/edit`)} />
                      </FadeIn>
                    ))
                  : (list as ExamStudentSummary[]).map((ex, i) => (
                      <FadeIn key={ex.id} index={i}>
                        <StudentExamCard
                          exam={ex}
                          onTake={() => router.push(`/more/exam/${ex.id}/take`)}
                          onReview={() => router.push(`/more/exam/${ex.id}/review`)}
                        />
                      </FadeIn>
                    ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <NewExamSheet
        isOpen={showNew}
        onClose={() => setShowNew(false)}
        userId={user.id}
        onCreated={(examId) => { setShowNew(false); router.push(`/more/exam/${examId}/edit`) }}
      />
    </ProtectedLayout>
  )
}

function TeacherExamCard({ exam, onOpen, onEdit }: { exam: ExamTeacherSummary; onOpen: () => void; onEdit: () => void }) {
  const win = examWindowLabel(exam)
  const badge = modeBadge(exam)
  return (
    <div className={`${EXAM.cardHover} p-4`}>
      <div className="flex items-start justify-between gap-3">
        <button onClick={onOpen} className="flex items-start gap-3 flex-1 min-w-0 text-left">
          <div className="w-10 h-10 rounded-lg bg-[var(--page-primary)] flex items-center justify-center shrink-0">
            <FileText size={18} className="text-[var(--page-accent)]" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <h3 className="font-semibold text-[#18181B] truncate">{exam.title}</h3>
              {!exam.isOwner && <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#F4F4F5] text-[#71717A] font-semibold uppercase tracking-wide flex-shrink-0">Manage</span>}
              {badge && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--page-accent-light)] text-[var(--page-accent)] font-semibold uppercase tracking-wide flex-shrink-0">{badge}</span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs text-[#A1A1AA]">
              {exam.subject && <span>{exam.subject}</span>}
              {win && <span className="flex items-center gap-1"><Clock size={12} />{win}</span>}
              <span className="flex items-center gap-1"><Users size={12} />{exam.gradedCount}/{exam.audienceCount} graded</span>
            </div>
          </div>
        </button>
        <div className="flex items-center gap-1 shrink-0">
          {exam.isOwner && (
            <button onClick={onEdit} className="p-2 text-[#A1A1AA] hover:text-[#27272A] hover:bg-[#F4F4F5] rounded-lg transition-colors" title="Edit">
              <Pencil size={15} />
            </button>
          )}
          <button onClick={onOpen} className="p-2 text-[#A1A1AA] hover:text-[#27272A] hover:bg-[#F4F4F5] rounded-lg transition-colors">
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
    </div>
  )
}

function StudentExamCard({ exam, onTake, onReview }: { exam: ExamStudentSummary; onTake: () => void; onReview: () => void }) {
  const win = examWindowLabel(exam)
  const closed = exam.results_published
  const sub = exam.submission
  const status = sub?.is_absent
    ? 'Absent'
    : closed
      ? 'Results published'
      : sub?.status === 'submitted' || sub?.status === 'graded'
        ? 'Submitted'
        : sub?.status === 'in_progress'
          ? 'In progress'
          : 'Not started'

  return (
    <div className={`${EXAM.card} shadow-sm p-4 flex items-center justify-between gap-3`}>
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-10 h-10 rounded-lg bg-[#F4F4F5] border border-[#E4E4E7] flex items-center justify-center shrink-0">
          <FileText size={18} className="text-[#71717A]" />
        </div>
        <div className="min-w-0">
          <h3 className="font-semibold text-[#18181B] truncate">{exam.title}</h3>
          <div className="flex flex-wrap items-center gap-3 text-xs text-[#A1A1AA] mt-0.5">
            {exam.subject && <span>{exam.subject}</span>}
            {win && <span className="flex items-center gap-1"><Clock size={12} />{win}</span>}
            <span className={`flex items-center gap-1 ${status === 'Submitted' ? 'text-emerald-500' : ''}`}>
              {status === 'Submitted' ? <CheckCircle2 size={12} /> : <AlertCircle size={12} />}{status}
            </span>
          </div>
        </div>
      </div>
      {closed ? (
        <button onClick={onReview} className="shrink-0 px-4 py-2 rounded-lg bg-[var(--page-primary)] text-white text-sm font-semibold hover:bg-[var(--page-primary-dark)] transition-colors">Review</button>
      ) : exam.is_closed || sub?.is_absent ? (
        <span className="shrink-0 px-4 py-2 rounded-lg bg-[#F4F4F5] text-[#A1A1AA] text-sm font-medium">Closed</span>
      ) : (
        <button
          onClick={onTake}
          disabled={sub?.status === 'submitted' || sub?.status === 'graded'}
          className="shrink-0 px-4 py-2 rounded-lg bg-[var(--page-accent)] text-white text-sm font-semibold hover:brightness-95 disabled:opacity-50 transition-all"
        >
          {sub?.status === 'in_progress' ? 'Resume' : 'Start'}
        </button>
      )}
    </div>
  )
}
