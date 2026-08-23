'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import ProtectedLayout from '@/components/ProtectedLayout'
import PageBanner from '@/components/PageBanner'
import { useAuth } from '@/contexts/AuthContext'
import { isStaffRole } from '@/lib/supabase'
import { EXAM_BANNER_DEFAULT } from '@/lib/pageConfig'
import {
  FileText, Plus, Clock, Lock, Library, ChevronRight, Pencil, Search, X,
  CheckCircle2, AlertCircle, ClipboardCheck, Layers, Award,
} from 'lucide-react'
import {
  Exam,
  ExamPhase,
  ExamTeacherSummary,
  ExamStudentSummary,
  fetchExamsForTeacher,
  fetchExamsForStudent,
} from '@/lib/exam'
import { getExamMode } from '@/lib/examScoring'
import NewExamSheet from '@/components/exam/NewExamSheet'
import MiniNav, { EXAM_MAX_W } from '@/components/exam/ExamNav'
import {
  EXAM, FadeIn, ExamRowListSkeleton, ExamRowList, ExamStatsSkeleton, ExamStats, ExamStatCard,
  ExamPhaseChip, ImmediateResultsChip,
} from '@/components/exam/examUi'

type TeacherTab = 'active' | 'closed'

/** The Active tab is ordered in lifecycle order. */
const ACTIVE_PHASES: ExamPhase[] = ['open', 'grading', 'scheduled']

const MAX_W = EXAM_MAX_W

/* Column tracks shared by each table's header strip and its rows, so the two
   stay locked together. Below `md` the rows abandon the grid and stack. */
const TEACHER_COLS = 'md:grid md:grid-cols-[minmax(0,1fr)_6.5rem_9.5rem_8.5rem_3.75rem] md:items-center md:gap-3'
const STUDENT_COLS = 'md:grid md:grid-cols-[minmax(0,1fr)_6.5rem_9.5rem_7.5rem_5rem] md:items-center md:gap-3'

const COL_HEAD = 'text-[10px] font-bold uppercase tracking-[0.12em] text-[#8A8578]'

/** Day and month alone — "23 Aug" — all a phone row has width for. */
function shortWhen(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

/** Day, month and clock — "23 Aug, 14:30" — for a table cell. */
function compactWhen(iso: string): string {
  const d = new Date(iso)
  return `${shortWhen(iso)}, ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`
}

/**
 * The exam's next meaningful moment, at three lengths: `short` for phone meta
 * lines, `when` for the table column, `full` for the cell's tooltip. The verb
 * keeps the date unambiguous wherever it lands.
 */
function examWindow(exam: Exam): { verb: string; short: string; when: string; full: string } | null {
  const iso = exam.due_at ?? exam.start_at
  if (!iso) return null
  const verb = exam.due_at ? 'Due' : 'Opens'
  return { verb, short: shortWhen(iso), when: compactWhen(iso), full: `${verb} ${new Date(iso).toLocaleString()}` }
}

function modeBadge(exam: Exam): string | null {
  if (!exam.exam_mode || exam.exam_mode === 'school') return null
  return getExamMode(exam.exam_mode).label
}

function matchesQuery(exam: Exam, q: string): boolean {
  if (!q) return true
  const needle = q.toLowerCase()
  return exam.title.toLowerCase().includes(needle) || (exam.subject ?? '').toLowerCase().includes(needle)
}

export default function ExamPage() {
  const { user, profile } = useAuth()
  const router = useRouter()
  const isStaff = profile ? isStaffRole(profile.role) : false
  const isAdmin = profile?.role === 'admin'

  const [tab, setTab] = useState<TeacherTab>('active')
  const [query, setQuery] = useState('')
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

  // The summary rail — four metrics across both lists, so the rail reads as a
  // standing picture of the space rather than of whichever tab is open.
  const stats = useMemo<ExamStatCard[]>(() => {
    if (isStaff) {
      const toGrade = teacherExams.active.reduce((s, e) => s + Math.max(0, e.audienceCount - e.gradedCount), 0)
      const openNow = teacherExams.active.filter(e => e.phase === 'open').length
      return [
        { label: 'Active', value: String(teacherExams.active.length), icon: <Layers size={12} /> },
        { label: 'Open now', value: String(openNow), icon: <Clock size={12} /> },
        { label: 'To grade', value: String(toGrade), icon: <ClipboardCheck size={12} />, accent: toGrade > 0 },
        { label: 'Closed', value: String(teacherExams.closed.length), icon: <Lock size={12} /> },
      ]
    }
    const all = [...studentExams.active, ...studentExams.closed]
    const todo = studentExams.active.filter(e => {
      const st = e.submission?.status
      return e.phase === 'open' && !e.submission?.is_absent && st !== 'submitted' && st !== 'graded'
    }).length
    const submitted = all.filter(e => e.submission?.status === 'submitted' || e.submission?.status === 'graded').length
    const results = all.filter(e => e.canReview).length
    return [
      { label: 'To do', value: String(todo), icon: <Clock size={12} />, accent: todo > 0 },
      { label: 'Submitted', value: String(submitted), icon: <CheckCircle2 size={12} /> },
      { label: 'Results out', value: String(results), icon: <Award size={12} /> },
      { label: 'All exams', value: String(all.length), icon: <Layers size={12} /> },
    ]
  }, [isStaff, teacherExams, studentExams])

  const counts = isStaff
    ? { active: teacherExams.active.length, closed: teacherExams.closed.length }
    : { active: studentExams.active.length, closed: studentExams.closed.length }

  // Active exams run in lifecycle order (open → grading → scheduled), with the
  // stage carried inline per row instead of splitting the table into sections.
  const teacherRows = useMemo(() => {
    const rows = teacherExams[tab].filter(e => matchesQuery(e, query))
    return tab === 'active'
      ? [...rows].sort((a, b) => ACTIVE_PHASES.indexOf(a.phase) - ACTIVE_PHASES.indexOf(b.phase))
      : rows
  }, [teacherExams, tab, query])

  const studentRows = useMemo(
    () => studentExams[tab].filter(e => matchesQuery(e, query)),
    [studentExams, tab, query],
  )

  if (!user || !profile) return null

  const empty = (isStaff ? teacherRows : studentRows).length === 0

  return (
    <ProtectedLayout>
      <div data-page-theme="exam" style={{ minHeight: '100vh', backgroundColor: '#FDFCF9' }}>
        <PageBanner
          settingKey="exam_banner"
          defaultBanner={EXAM_BANNER_DEFAULT}
          icon={<FileText size={26} className="text-white" />}
          backgroundIcon={<FileText size={180} className="text-white" />}
          eyebrow="Assessment"
          title="Exams"
          subtitle={isStaff ? 'Create, grade, and publish exams' : 'Take your exams and review results'}
          compactMobileTitle
          elevated
          isAdmin={isAdmin}
          maxWidth={MAX_W}
          onEditingChange={setBannerEditing}
          actions={isStaff ? (
            <div className="flex items-center gap-2">
              <button
                onClick={() => router.push('/more/exam/pyq')}
                className="hidden sm:inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/15 border border-white/25 text-sm font-semibold text-white backdrop-blur-sm hover:bg-white/25 active:scale-[0.97] transition-all"
              >
                <Library size={15} /> PYQ
              </button>
              <button
                onClick={() => setShowNew(true)}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#B8983C] text-white text-sm font-semibold hover:bg-[#9C7F2C] active:scale-[0.97] shadow-[0_4px_14px_-4px_rgba(184,152,60,0.6),inset_0_1px_0_rgba(255,255,255,0.25)] transition-all"
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
          {/* Summary rail — rides up over the banner's lower edge */}
          <div className="relative z-10 -mt-5 sm:-mt-7 mb-3">
            {loading ? <ExamStatsSkeleton /> : <ExamStats cards={stats} />}
          </div>

          {/* Toolbar — tabs and search share one line so the table starts higher */}
          <div className="flex flex-col sm:flex-row gap-2 mb-3">
            <MiniNav
              className="sm:w-80 shrink-0"
              items={(['active', 'closed'] as TeacherTab[]).map(t => ({
                id: t,
                label: t.charAt(0).toUpperCase() + t.slice(1),
                icon: t === 'active' ? <Clock size={15} /> : <Lock size={15} />,
                badge: counts[t],
                active: tab === t,
                onClick: () => setTab(t),
              }))}
            />
            <div className="relative flex-1 min-w-0">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#A8A29A] pointer-events-none" />
              <input
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search title or subject"
                aria-label="Search exams"
                className="w-full h-full bg-white border border-[#E4E1D8] rounded-2xl pl-9 pr-8 py-2.5 text-sm text-[#27272A] placeholder:text-[#A8A29A] shadow-[0_1px_2px_rgba(28,28,31,0.04)] focus:outline-none focus:border-[#B8983C] focus:ring-2 focus:ring-[#B8983C]/15 transition-all"
              />
              {query && (
                <button
                  onClick={() => setQuery('')}
                  aria-label="Clear search"
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 rounded-full text-[#A8A29A] hover:text-[#27272A] hover:bg-[#F4F4F5] transition-colors"
                >
                  <X size={14} />
                </button>
              )}
            </div>
          </div>

          {/* Table */}
          {loading ? (
            <ExamRowListSkeleton rows={8} />
          ) : empty ? (
            <FadeIn>
              <div className={`${EXAM.card} shadow-sm p-10 text-center`}>
                <div className={`w-14 h-14 mx-auto mb-3.5 ${EXAM.iconTile}`}>
                  <FileText size={24} className="text-[#D4BC6A]" strokeWidth={1.6} />
                </div>
                <p className="text-[#27272A] font-semibold">
                  {query ? `No exams match “${query}”` : `No ${tab} exams`}
                </p>
                {query ? (
                  <button onClick={() => setQuery('')} className="text-sm text-[#9C7F2C] font-semibold mt-1.5 hover:text-[#7A631F] transition-colors">
                    Clear search
                  </button>
                ) : isStaff && tab === 'active' ? (
                  <p className="text-sm text-[#A1A1AA] mt-1">Create a new exam to get started.</p>
                ) : null}
              </div>
            </FadeIn>
          ) : isStaff ? (
            <ExamRowList
              items={teacherRows}
              keyOf={ex => ex.id}
              header={
                <div className={`px-3 sm:px-4 py-2 ${TEACHER_COLS}`}>
                  <span className={COL_HEAD}>Exam</span>
                  <span className={COL_HEAD}>Subject</span>
                  <span className={COL_HEAD}>{tab === 'active' ? 'Window' : 'Closed'}</span>
                  <span className={COL_HEAD}>Graded</span>
                  <span className={`${COL_HEAD} text-right`}>Open</span>
                </div>
              }
              renderRow={ex => (
                <TeacherExamRow
                  exam={ex}
                  showPhase={tab === 'active'}
                  onOpen={() => router.push(`/more/exam/${ex.id}`)}
                  onEdit={() => router.push(`/more/exam/${ex.id}/edit`)}
                />
              )}
            />
          ) : (
            <ExamRowList
              items={studentRows}
              keyOf={ex => ex.id}
              header={
                <div className={`px-3 sm:px-4 py-2 ${STUDENT_COLS}`}>
                  <span className={COL_HEAD}>Exam</span>
                  <span className={COL_HEAD}>Subject</span>
                  <span className={COL_HEAD}>Window</span>
                  <span className={COL_HEAD}>Status</span>
                  <span className={`${COL_HEAD} text-right`}>Action</span>
                </div>
              }
              renderRow={ex => (
                <StudentExamRow
                  exam={ex}
                  onTake={() => router.push(`/more/exam/${ex.id}/take`)}
                  onReview={() => router.push(`/more/exam/${ex.id}/review`)}
                />
              )}
            />
          )}
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

function TeacherExamRow({ exam, showPhase, onOpen, onEdit }: { exam: ExamTeacherSummary; showPhase: boolean; onOpen: () => void; onEdit: () => void }) {
  const win = examWindow(exam)
  const badge = modeBadge(exam)
  const total = Math.max(0, exam.audienceCount)
  const graded = Math.max(0, Math.min(exam.gradedCount, total))
  const pct = total > 0 ? Math.round((graded / total) * 100) : 0
  const complete = total > 0 && graded >= total

  return (
    <div className={`group px-3 sm:px-4 py-2 hover:bg-[#F4F2EC]/60 transition-colors flex items-center justify-between gap-3 ${TEACHER_COLS}`}>
      {/* Exam */}
      <button onClick={onOpen} className="flex items-center gap-2.5 min-w-0 flex-1 text-left">
        <FileText size={15} className="text-[#B8983C] shrink-0" />
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="font-semibold text-sm text-[#18181B] tracking-[-0.01em] truncate">{exam.title}</span>
            {badge && (
              <span className="text-[10px] px-1.5 py-px rounded bg-[#F4F2EC] text-[#9C7F2C] border border-[#E7E2D8] font-bold uppercase tracking-wide shrink-0">{badge}</span>
            )}
            {exam.immediate_results && <ImmediateResultsChip compact />}
            {showPhase && <span className="shrink-0"><ExamPhaseChip phase={exam.phase} compact /></span>}
          </div>
          {/* Mobile meta line — the columns hidden below `md`, folded inline */}
          <div className="flex md:hidden flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] text-[#A8A29A] mt-0.5">
            {exam.subject && <span className="font-medium text-[#71717A]">{exam.subject}</span>}
            {win && <span>{win.verb} {win.short}</span>}
            <span className={`font-semibold tabular-nums ${complete ? 'text-emerald-600' : 'text-[#9C7F2C]'}`}>{graded}/{total}</span>
          </div>
        </div>
      </button>

      {/* Subject */}
      <span className="hidden md:block text-xs text-[#71717A] truncate">{exam.subject || '—'}</span>

      {/* Window */}
      <span className="hidden md:block text-xs text-[#A8A29A] tabular-nums truncate" title={win?.full}>
        {win ? `${win.verb} ${win.when}` : '—'}
      </span>

      {/* Graded */}
      <div className="hidden md:flex items-center gap-2">
        <div className="h-1.5 flex-1 rounded-full bg-[#EDEAE2] overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{ width: `${pct}%`, background: complete ? '#16a34a' : 'linear-gradient(90deg,#B8983C,#D4BC6A)' }}
          />
        </div>
        <span className={`text-[11px] font-semibold tabular-nums shrink-0 ${complete ? 'text-emerald-600' : 'text-[#9C7F2C]'}`}>
          {graded}/{total}
        </span>
      </div>

      {/* Actions */}
      <div className="hidden md:flex items-center justify-end gap-0.5">
        {exam.isOwner && (
          <button onClick={onEdit} className="p-1.5 text-[#A1A1AA] hover:text-[#27272A] hover:bg-[#EDEAE2] rounded-lg transition-colors" title="Edit exam">
            <Pencil size={14} />
          </button>
        )}
        <button onClick={onOpen} className="p-1.5 text-[#A1A1AA] hover:text-[#27272A] hover:bg-[#EDEAE2] rounded-lg transition-all group-hover:translate-x-0.5" title="Open exam">
          <ChevronRight size={15} />
        </button>
      </div>

      {/* Actions, phone */}
      <div className="flex md:hidden items-center gap-0.5 shrink-0">
        {exam.isOwner && (
          <button onClick={onEdit} className="p-1.5 text-[#A1A1AA] active:text-[#27272A] rounded-lg" title="Edit exam">
            <Pencil size={14} />
          </button>
        )}
        <button onClick={onOpen} className="p-1.5 text-[#A1A1AA] active:text-[#27272A] rounded-lg" title="Open exam">
          <ChevronRight size={15} />
        </button>
      </div>
    </div>
  )
}

function StudentExamRow({ exam, onTake, onReview }: { exam: ExamStudentSummary; onTake: () => void; onReview: () => void }) {
  const win = examWindow(exam)
  const sub = exam.submission
  const handedIn = sub?.status === 'submitted' || sub?.status === 'graded'
  // Attempts are only possible while the exam is open — past due it is over,
  // even though the teacher may still be grading.
  const canAttempt = exam.phase === 'open' && !sub?.is_absent && !handedIn

  // Kept to one or two words so the status column never collides with the
  // action button; the long form lives in the cell's tooltip.
  const status = sub?.is_absent
    ? { label: 'Absent', full: 'Marked absent' }
    : exam.canReview
      ? { label: 'Results out', full: 'Results published' }
      : handedIn
        ? { label: 'Submitted', full: 'Submitted — awaiting results' }
        : sub?.status === 'in_progress' && exam.phase === 'open'
          ? { label: 'In progress', full: 'Attempt in progress' }
          : exam.phase === 'scheduled'
            ? { label: 'Not open', full: 'Not open yet' }
            : exam.phase === 'open'
              ? { label: 'Not started', full: 'Not started' }
              : { label: 'Missed', full: 'Missed — past due' }

  const done = status.label === 'Submitted' || status.label === 'Results out'
  const statusTone = done
    ? 'text-emerald-600'
    : status.label === 'Absent' || status.label === 'Missed'
      ? 'text-rose-500'
      : status.label === 'In progress'
        ? 'text-[#9C7F2C]'
        : 'text-[#A8A29A]'

  const statusNode = (
    <span title={status.full} className={`flex items-center gap-1 min-w-0 text-[11px] font-semibold ${statusTone}`}>
      {done ? <CheckCircle2 size={11} className="shrink-0" /> : <AlertCircle size={11} className="shrink-0" />}
      <span className="truncate">{status.label}</span>
    </span>
  )

  const action = exam.canReview ? (
    <button onClick={onReview} className="w-full px-2.5 py-1.5 rounded-lg bg-[#1C1C1F] text-white text-xs font-semibold hover:bg-black active:scale-[0.97] shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] transition-all">
      Review
    </button>
  ) : canAttempt ? (
    <button
      onClick={onTake}
      className="w-full px-2.5 py-1.5 rounded-lg bg-[#B8983C] text-white text-xs font-semibold hover:bg-[#9C7F2C] active:scale-[0.97] shadow-[inset_0_1px_0_rgba(255,255,255,0.2)] transition-all"
    >
      {sub?.status === 'in_progress' ? 'Resume' : 'Start'}
    </button>
  ) : (
    <span className="block w-full text-center px-2.5 py-1.5 rounded-lg bg-[#F2F0EA] text-[#A1A1AA] text-xs font-medium">
      {handedIn ? 'Sent' : exam.phase === 'scheduled' ? 'Soon' : 'Closed'}
    </span>
  )

  return (
    <div className={`group px-3 sm:px-4 py-2 hover:bg-[#F4F2EC]/60 transition-colors flex items-center justify-between gap-3 ${STUDENT_COLS}`}>
      {/* Exam */}
      <div className="flex items-center gap-2.5 min-w-0">
        <FileText size={15} className="text-[#9C7F2C] shrink-0" />
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="font-semibold text-sm text-[#18181B] tracking-[-0.01em] truncate">{exam.title}</span>
            {exam.immediate_results && !exam.canReview && <ImmediateResultsChip compact />}
          </div>
          {/* Mobile meta line — the columns hidden below `md`, folded inline */}
          <div className="flex md:hidden flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] text-[#A8A29A] mt-0.5">
            {exam.subject && <span className="font-medium text-[#71717A]">{exam.subject}</span>}
            {win && <span>{win.verb} {win.short}</span>}
            {statusNode}
          </div>
        </div>
      </div>

      {/* Subject */}
      <span className="hidden md:block text-xs text-[#71717A] truncate">{exam.subject || '—'}</span>

      {/* Window */}
      <span className="hidden md:block text-xs text-[#A8A29A] tabular-nums truncate" title={win?.full}>
        {win ? `${win.verb} ${win.when}` : '—'}
      </span>

      {/* Status */}
      <div className="hidden md:block min-w-0 overflow-hidden">{statusNode}</div>

      {/* Action */}
      <div className="shrink-0 w-[5rem] md:w-auto">{action}</div>
    </div>
  )
}
