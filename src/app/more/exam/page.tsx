'use client'

import React, { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import ProtectedLayout from '@/components/ProtectedLayout'
import { useAuth } from '@/contexts/AuthContext'
import { isStaffRole } from '@/lib/supabase'
import {
  FileText, Plus, Clock, Lock, Library, ChevronRight, Pencil,
  Users, CheckCircle2, AlertCircle,
} from 'lucide-react'
import {
  Exam,
  ExamTeacherSummary,
  ExamStudentSummary,
  fetchExamsForTeacher,
  fetchExamsForStudent,
} from '@/lib/exam'

type TeacherTab = 'active' | 'closed'

function examWindowLabel(exam: Exam): string | null {
  if (exam.start_at && exam.end_at) {
    const s = new Date(exam.start_at)
    const e = new Date(exam.end_at)
    return `${s.toLocaleDateString()} ${s.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} – ${e.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
  }
  if (exam.due_at) return `Due ${new Date(exam.due_at).toLocaleString()}`
  return null
}

export default function ExamPage() {
  const { user, profile } = useAuth()
  const router = useRouter()
  const isStaff = profile ? isStaffRole(profile.role) : false

  const [tab, setTab] = useState<TeacherTab>('active')
  const [loading, setLoading] = useState(true)
  const [teacherExams, setTeacherExams] = useState<{ active: ExamTeacherSummary[]; closed: ExamTeacherSummary[] }>({ active: [], closed: [] })
  const [studentExams, setStudentExams] = useState<{ active: ExamStudentSummary[]; closed: ExamStudentSummary[] }>({ active: [], closed: [] })

  const load = useCallback(async () => {
    if (!user) return
    setLoading(true)
    if (isStaff) {
      setTeacherExams(await fetchExamsForTeacher(user.id))
    } else {
      setStudentExams(await fetchExamsForStudent(user.id))
    }
    setLoading(false)
  }, [user, isStaff])

  useEffect(() => { load() }, [load])

  if (!user || !profile) return null

  const list = isStaff ? teacherExams[tab] : studentExams[tab]

  return (
    <ProtectedLayout>
      <div data-page-theme="academics" className="max-w-4xl mx-auto px-4 sm:px-6 py-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 mb-5">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center text-white shadow-sm">
              <FileText size={22} />
            </div>
            <div>
              <h1 className="font-display text-2xl font-bold text-slate-800">Exams</h1>
              <p className="text-xs text-slate-400">
                {isStaff ? 'Create, grade, and publish exams' : 'Take your exams and review results'}
              </p>
            </div>
          </div>
          {isStaff && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => router.push('/more/exam/pyq')}
                className="hidden sm:inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 text-sm text-slate-600 hover:bg-slate-50"
              >
                <Library size={15} /> PYQ
              </button>
              <button
                onClick={() => router.push('/more/exam/create')}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-500 text-white text-sm font-semibold hover:bg-amber-600"
              >
                <Plus size={16} /> New Exam
              </button>
            </div>
          )}
        </div>

        {/* Tabs */}
        <div className="bg-white border border-slate-200 rounded-2xl p-1.5 flex gap-1 mb-4 shadow-sm">
          {(['active', 'closed'] as TeacherTab[]).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-sm font-medium capitalize transition-all ${
                tab === t ? 'bg-amber-50 text-amber-600 shadow-sm' : 'text-slate-500 hover:bg-slate-50'
              }`}
            >
              {t === 'active' ? <Clock size={15} /> : <Lock size={15} />}
              {t}
            </button>
          ))}
        </div>

        {/* List */}
        {loading ? (
          <div className="text-center py-16">
            <div className="spinner mx-auto mb-3" />
            <p className="text-sm text-slate-500">Loading exams…</p>
          </div>
        ) : list.length === 0 ? (
          <div className="glass rounded-2xl p-10 text-center">
            <FileText size={36} className="text-slate-300 mx-auto mb-3" />
            <p className="text-slate-600 font-medium">No {tab} exams</p>
            {isStaff && tab === 'active' && (
              <p className="text-sm text-slate-400 mt-1">Create a new exam to get started.</p>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {isStaff
              ? (list as ExamTeacherSummary[]).map(ex => (
                  <TeacherExamCard key={ex.id} exam={ex} onOpen={() => router.push(`/more/exam/${ex.id}`)} onEdit={() => router.push(`/more/exam/${ex.id}/edit`)} />
                ))
              : (list as ExamStudentSummary[]).map(ex => (
                  <StudentExamCard
                    key={ex.id}
                    exam={ex}
                    onTake={() => router.push(`/more/exam/${ex.id}/take`)}
                    onReview={() => router.push(`/more/exam/${ex.id}/review`)}
                  />
                ))}
          </div>
        )}
      </div>
    </ProtectedLayout>
  )
}

function TeacherExamCard({ exam, onOpen, onEdit }: { exam: ExamTeacherSummary; onOpen: () => void; onEdit: () => void }) {
  const win = examWindowLabel(exam)
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between gap-3">
        <button onClick={onOpen} className="flex-1 min-w-0 text-left">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="font-semibold text-slate-800 truncate">{exam.title}</h3>
            {!exam.isOwner && <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">Grader</span>}
            {exam.grading_method !== 'none' && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-600 uppercase">{exam.grading_method}</span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400">
            {exam.subject && <span>{exam.subject}</span>}
            {win && <span className="flex items-center gap-1"><Clock size={12} />{win}</span>}
            <span className="flex items-center gap-1"><Users size={12} />{exam.gradedCount}/{exam.audienceCount} graded</span>
          </div>
        </button>
        <div className="flex items-center gap-1 shrink-0">
          {exam.isOwner && (
            <button onClick={onEdit} className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg" title="Edit">
              <Pencil size={15} />
            </button>
          )}
          <button onClick={onOpen} className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg">
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
  const status = closed
    ? 'Results published'
    : sub?.status === 'submitted' || sub?.status === 'graded'
      ? 'Submitted'
      : sub?.status === 'in_progress'
        ? 'In progress'
        : 'Not started'

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm flex items-center justify-between gap-3">
      <div className="min-w-0">
        <h3 className="font-semibold text-slate-800 truncate">{exam.title}</h3>
        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400 mt-0.5">
          {exam.subject && <span>{exam.subject}</span>}
          {win && <span className="flex items-center gap-1"><Clock size={12} />{win}</span>}
          <span className={`flex items-center gap-1 ${status === 'Submitted' ? 'text-emerald-500' : ''}`}>
            {status === 'Submitted' ? <CheckCircle2 size={12} /> : <AlertCircle size={12} />}{status}
          </span>
        </div>
      </div>
      {closed ? (
        <button onClick={onReview} className="shrink-0 px-4 py-2 rounded-xl bg-slate-800 text-white text-sm font-medium hover:bg-slate-900">Review</button>
      ) : (
        <button
          onClick={onTake}
          disabled={sub?.status === 'submitted' || sub?.status === 'graded'}
          className="shrink-0 px-4 py-2 rounded-xl bg-amber-500 text-white text-sm font-medium hover:bg-amber-600 disabled:opacity-50"
        >
          {sub?.status === 'in_progress' ? 'Resume' : 'Start'}
        </button>
      )}
    </div>
  )
}
