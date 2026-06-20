'use client'

import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import ProtectedLayout from '@/components/ProtectedLayout'
import { useAuth } from '@/contexts/AuthContext'
import { isStaffRole } from '@/lib/supabase'
import { ChevronLeft, Loader2 } from 'lucide-react'
import { createExam, CreateExamInput } from '@/lib/exam'
import { ExamSettingsForm, emptySettings, SettingsState, settingsToInput } from '@/components/exam/ExamSettingsForm'

export default function CreateExamPage() {
  const { user, profile } = useAuth()
  const router = useRouter()
  const [settings, setSettings] = useState<SettingsState>(emptySettings())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!user || !profile) return null
  if (!isStaffRole(profile.role)) {
    return (
      <ProtectedLayout>
        <div className="max-w-2xl mx-auto px-4 py-16 text-center text-slate-500">Only staff can create exams.</div>
      </ProtectedLayout>
    )
  }

  const handleCreate = async () => {
    if (!settings.title.trim()) { setError('Title is required'); return }
    setSaving(true)
    setError(null)
    const input: CreateExamInput = settingsToInput(settings)
    const exam = await createExam(input, user.id)
    if (!exam) {
      setError('Could not create the exam')
      setSaving(false)
      return
    }
    router.push(`/more/exam/${exam.id}/edit`)
  }

  return (
    <ProtectedLayout>
      <div data-page-theme="academics" className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <button onClick={() => router.push('/more/exam')} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 mb-4">
          <ChevronLeft size={16} /> Back to Exams
        </button>

        <h1 className="font-display text-2xl font-bold text-slate-800 mb-1">New Exam</h1>
        <p className="text-sm text-slate-400 mb-5">Set up the basics. You&apos;ll add questions next.</p>

        {error && <div className="mb-4 px-4 py-3 bg-rose-50 border border-rose-200 rounded-xl text-sm text-rose-700">{error}</div>}

        <ExamSettingsForm value={settings} onChange={setSettings} />

        <div className="mt-6 flex justify-end">
          <button
            onClick={handleCreate}
            disabled={saving}
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-amber-500 text-white text-sm font-semibold hover:bg-amber-600 disabled:opacity-60"
          >
            {saving && <Loader2 size={16} className="animate-spin" />}
            Create &amp; Add Questions
          </button>
        </div>
      </div>
    </ProtectedLayout>
  )
}
