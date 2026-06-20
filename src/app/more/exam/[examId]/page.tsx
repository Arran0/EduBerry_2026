'use client'

import React, { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import ProtectedLayout from '@/components/ProtectedLayout'
import { useAuth } from '@/contexts/AuthContext'
import { isStaffRole } from '@/lib/supabase'
import {
  ChevronLeft, Pencil, FileText, Users, Shield, ClipboardCheck,
  FileSpreadsheet, BarChart3,
} from 'lucide-react'
import { Exam, fetchExamById } from '@/lib/exam'
import AudienceEditor from '@/components/exam/AudienceEditor'
import GradersEditor from '@/components/exam/GradersEditor'
import GradingTab from '@/components/exam/GradingTab'
import SheetTab from '@/components/exam/SheetTab'
import ResultsTab from '@/components/exam/ResultsTab'

type Tab = 'audience' | 'graders' | 'grading' | 'sheet' | 'results'

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'audience', label: 'Audience', icon: <Users size={15} /> },
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
  const [tab, setTab] = useState<Tab>('audience')

  const load = useCallback(async () => {
    setLoading(true)
    setExam(await fetchExamById(examId))
    setLoading(false)
  }, [examId])

  useEffect(() => { load() }, [load])

  if (!user || !profile) return null
  const isStaff = isStaffRole(profile.role)
  const isOwner = !!exam && exam.created_by === user.id

  return (
    <ProtectedLayout>
      <div data-page-theme="academics" className="max-w-3xl mx-auto px-4 sm:px-6 py-6">
        <button onClick={() => router.push('/more/exam')} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 mb-4">
          <ChevronLeft size={16} /> Back to Exams
        </button>

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
                  <h1 className="font-display text-xl font-bold text-slate-800 truncate">{exam.title}</h1>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400 mt-0.5">
                    {exam.subject && <span>{exam.subject}</span>}
                    {exam.grading_method !== 'none' && <span className="uppercase text-amber-600">{exam.grading_method}</span>}
                    <span>{exam.total_marks} marks</span>
                    {exam.results_published && <span className="text-emerald-500">Results published</span>}
                  </div>
                </div>
              </div>
              {isOwner && (
                <button onClick={() => router.push(`/more/exam/${examId}/edit`)} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 text-sm text-slate-600 hover:bg-slate-50 shrink-0">
                  <Pencil size={14} /> Edit
                </button>
              )}
            </div>

            {/* Tabs */}
            <div className="bg-white border border-slate-200 rounded-2xl p-1.5 flex gap-1 mb-4 overflow-x-auto shadow-sm">
              {TABS.map(t => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-all ${
                    tab === t.id ? 'bg-amber-50 text-amber-600 shadow-sm' : 'text-slate-500 hover:bg-slate-50'
                  }`}
                >
                  {t.icon}{t.label}
                </button>
              ))}
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
              {tab === 'audience' && <AudienceEditor examId={examId} readOnly={!isOwner} />}
              {tab === 'graders' && <GradersEditor examId={examId} currentUserId={user.id} canEdit={isOwner} />}
              {tab === 'grading' && <GradingTab exam={exam} canManage={isStaff} onPublished={load} />}
              {tab === 'sheet' && <SheetTab exam={exam} userId={user.id} />}
              {tab === 'results' && <ResultsTab exam={exam} userId={user.id} userRole={profile.role} canManage={isStaff} />}
            </div>
          </>
        )}
      </div>
    </ProtectedLayout>
  )
}
