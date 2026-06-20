'use client'

import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import ProtectedLayout from '@/components/ProtectedLayout'
import { useAuth } from '@/contexts/AuthContext'
import { isStaffRole } from '@/lib/supabase'
import NewExamSheet from '@/components/exam/NewExamSheet'

/**
 * Direct route to the exam creator. The creator itself is an animated sheet
 * (see NewExamSheet) opened over the exam list, so this page just hosts it —
 * the primary entry point is the "New Exam" button on /more/exam.
 */
export default function CreateExamPage() {
  const { user, profile } = useAuth()
  const router = useRouter()
  const [open, setOpen] = useState(true)

  if (!user || !profile) return null
  if (!isStaffRole(profile.role)) {
    return (
      <ProtectedLayout>
        <div className="max-w-2xl mx-auto px-4 py-16 text-center text-slate-500">Only staff can create exams.</div>
      </ProtectedLayout>
    )
  }

  return (
    <ProtectedLayout>
      <div data-page-theme="exam" className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-16 text-center text-slate-400">
        Opening the exam creator…
      </div>
      <NewExamSheet
        isOpen={open}
        onClose={() => { setOpen(false); router.push('/more/exam') }}
        userId={user.id}
        onCreated={(examId) => router.push(`/more/exam/${examId}/edit`)}
      />
    </ProtectedLayout>
  )
}
