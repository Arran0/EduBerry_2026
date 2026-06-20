'use client'

import React from 'react'
import { useParams, useRouter } from 'next/navigation'
import ProtectedLayout from '@/components/ProtectedLayout'
import { useAuth } from '@/contexts/AuthContext'
import { isStaffRole } from '@/lib/supabase'
import { ListChecks, ClipboardCheck, Settings2 } from 'lucide-react'
import ExamBuilder from '@/components/exam/ExamBuilder'
import MiniNav, { EXAM_MAX_W } from '@/components/exam/ExamNav'

export default function EditExamPage() {
  const { examId } = useParams<{ examId: string }>()
  const router = useRouter()
  const { user, profile } = useAuth()

  if (!user || !profile) return null

  return (
    <ProtectedLayout>
      <div data-page-theme="exam" className={`${EXAM_MAX_W} mx-auto px-4 sm:px-6 lg:px-8 py-6`}>
        {/* Navigation */}
        <MiniNav
          className="mb-4"
          items={[
            { id: 'all', label: 'All Exams', icon: <ListChecks size={15} />, onClick: () => router.push('/more/exam') },
            { id: 'post', label: 'Post-Exam Manager', icon: <ClipboardCheck size={15} />, onClick: () => router.push(`/more/exam/${examId}`) },
          ]}
        />

        {/* Prominent header */}
        <div className="flex items-start gap-3 mb-5">
          <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center text-white shadow-sm shrink-0">
            <Settings2 size={22} />
          </div>
          <div className="min-w-0">
            <h1 className="font-display text-2xl font-bold text-slate-800">Pre-Exam Manager</h1>
            <p className="text-sm text-slate-400 mt-0.5">Build exam settings, questions, and participants.</p>
          </div>
        </div>

        {isStaffRole(profile.role)
          ? <ExamBuilder examId={examId} />
          : <div className="text-center py-16 text-slate-500">Only staff can edit exams.</div>}
      </div>
    </ProtectedLayout>
  )
}
