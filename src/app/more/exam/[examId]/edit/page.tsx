'use client'

import React from 'react'
import { useParams, useRouter } from 'next/navigation'
import ProtectedLayout from '@/components/ProtectedLayout'
import { useAuth } from '@/contexts/AuthContext'
import { isStaffRole } from '@/lib/supabase'
import { ChevronLeft } from 'lucide-react'
import ExamBuilder from '@/components/exam/ExamBuilder'

export default function EditExamPage() {
  const { examId } = useParams<{ examId: string }>()
  const router = useRouter()
  const { user, profile } = useAuth()

  if (!user || !profile) return null

  return (
    <ProtectedLayout>
      <div data-page-theme="academics" className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <button onClick={() => router.push(`/more/exam/${examId}`)} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 mb-4">
          <ChevronLeft size={16} /> Back to Exam
        </button>
        {isStaffRole(profile.role)
          ? <ExamBuilder examId={examId} />
          : <div className="text-center py-16 text-slate-500">Only staff can edit exams.</div>}
      </div>
    </ProtectedLayout>
  )
}
