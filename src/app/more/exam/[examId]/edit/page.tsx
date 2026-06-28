'use client'

import React from 'react'
import { useParams, useRouter } from 'next/navigation'
import ProtectedLayout from '@/components/ProtectedLayout'
import { useAuth } from '@/contexts/AuthContext'
import { isStaffRole } from '@/lib/supabase'
import { ListChecks, ClipboardCheck, Settings2 } from 'lucide-react'
import ExamBuilder from '@/components/exam/ExamBuilder'
import { EXAM_MAX_W } from '@/components/exam/ExamNav'
import { EXAM } from '@/components/exam/examUi'

export default function EditExamPage() {
  const { examId } = useParams<{ examId: string }>()
  const router = useRouter()
  const { user, profile } = useAuth()

  if (!user || !profile) return null

  return (
    <ProtectedLayout>
      <div data-page-theme="exam">
        <div style={{ minHeight: '100vh' }}>
          <div className={`${EXAM_MAX_W} mx-auto px-4 sm:px-6 lg:px-8 py-6`}>
            {/* Navigation */}
            <div className="flex items-center justify-between mb-4">
              <button
                onClick={() => router.push('/more/exam')}
                className="inline-flex items-center gap-1.5 text-sm text-[#71717A] px-3 py-1.5 rounded-lg border border-transparent hover:text-[#27272A] hover:bg-[#F4F4F5] hover:border-[#E4E4E7] transition-colors"
              >
                <ListChecks size={15} /> All Exams
              </button>
              <button
                onClick={() => router.push(`/more/exam/${examId}`)}
                className="inline-flex items-center gap-1.5 text-sm text-[#71717A] px-3 py-1.5 rounded-lg border border-transparent hover:text-[#27272A] hover:bg-[#F4F4F5] hover:border-[#E4E4E7] transition-colors"
              >
                <ClipboardCheck size={15} /> Post-Exam Manager
              </button>
            </div>

            {/* Prominent header */}
            <div className="flex items-start gap-3 mb-5">
              <div className={`w-11 h-11 ${EXAM.iconTile}`}>
                <Settings2 size={22} className="text-[var(--page-accent)]" />
              </div>
              <div className="min-w-0">
                <h1 className="font-display text-2xl font-bold text-[#18181B]">Pre-Exam Manager</h1>
                <p className="text-sm text-[#A1A1AA] mt-0.5">Build exam settings, questions, and participants.</p>
              </div>
            </div>

            {isStaffRole(profile.role)
              ? <ExamBuilder examId={examId} />
              : <div className="text-center py-16 text-[#71717A]">Only staff can edit exams.</div>}
          </div>
        </div>
      </div>
    </ProtectedLayout>
  )
}
