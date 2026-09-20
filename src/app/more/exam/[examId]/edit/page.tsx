'use client'

import React from 'react'
import { useParams, useRouter } from 'next/navigation'
import ProtectedLayout from '@/components/ProtectedLayout'
import { useAuth } from '@/contexts/AuthContext'
import { isStaffRole } from '@/lib/supabase'
import { ListChecks, ClipboardCheck } from 'lucide-react'
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
            <div className="flex items-center justify-between gap-2 mb-4">
              <button onClick={() => router.push('/more/exam')} className={EXAM.ghostBtnSm}>
                <ListChecks size={14} /> All Exams
              </button>
              <button onClick={() => router.push(`/more/exam/${examId}`)} className={EXAM.ghostBtnSm}>
                <ClipboardCheck size={14} /> Post-Exam Manager
              </button>
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
