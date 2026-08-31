'use client'

import React, { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, FileText, AlertCircle, Loader2, ArrowRight } from 'lucide-react'
import { createExam, CreateExamInput } from '@/lib/exam'
import {
  ExamSettingsForm, emptySettings, SettingsState, settingsToInput,
} from '@/components/exam/ExamSettingsForm'
import AudiencePicker, { AudienceValue } from '@/components/exam/AudiencePicker'

/**
 * Animated bottom-sheet (desktop: centered modal) for creating an exam.
 * Settings and participants live in the same flow — there is no separate
 * participant section. Mirrors the New Announcement card's motion so opening
 * the creator feels smooth rather than a hard page navigation.
 */
export default function NewExamSheet({
  isOpen,
  onClose,
  onCreated,
  userId,
}: {
  isOpen: boolean
  onClose: () => void
  onCreated: (examId: string) => void
  userId: string
}) {
  const [settings, setSettings] = useState<SettingsState>(emptySettings())
  const [audience, setAudience] = useState<AudienceValue>({ homerooms: [], students: [] })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reset = () => {
    setSettings(emptySettings())
    setAudience({ homerooms: [], students: [] })
    setError(null)
    setSaving(false)
  }

  const handleClose = () => {
    if (saving) return
    reset()
    onClose()
  }

  const handleCreate = async () => {
    if (!settings.title.trim()) { setError('Title is required'); return }
    setSaving(true)
    setError(null)
    const input: CreateExamInput = settingsToInput(settings)
    const exam = await createExam(input, userId, {
      homeroomIds: audience.homerooms.map(h => h.id),
      userIds: audience.students.map(s => s.id),
    })
    if (!exam) {
      setError('Could not create the exam. Please sign out and back in if this persists.')
      setSaving(false)
      return
    }
    reset()
    onCreated(exam.id)
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center sm:p-4 bg-black/50 backdrop-blur-sm"
          onClick={handleClose}
        >
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'tween', duration: 0.42, ease: [0.32, 0.72, 0, 1] }}
            className="bg-white rounded-t-lg sm:rounded-lg shadow-2xl w-full sm:max-w-lg flex flex-col max-h-[90svh] sm:max-h-[90vh]"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex-shrink-0 bg-white rounded-t-lg border-b border-[#EAE7DF] px-4 py-3.5 sm:px-5 sm:py-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-md bg-gradient-to-br from-[#27272A] to-[#18181B] ring-1 ring-inset ring-[#B8983C]/70 flex items-center justify-center shrink-0">
                  <FileText size={17} className="text-[#D4BC6A]" />
                </div>
                <div>
                  <h2 className="text-base sm:text-lg font-bold text-[#18181B] leading-tight">New Exam</h2>
                  <p className="text-[11px] text-[#A8A29A]">Set the details, then add questions</p>
                </div>
              </div>
              <button
                onClick={handleClose}
                className="p-2 text-[#A1A1AA] hover:text-[#27272A] hover:bg-[#F4F4F5] rounded-md transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto overscroll-contain p-4 sm:p-5 space-y-4 pb-6">
              <ExamSettingsForm value={settings} onChange={setSettings} />

              <div className="bg-white border border-[#EAE7DF] rounded-lg p-5 shadow-sm">
                <AudiencePicker value={audience} onChange={setAudience} />
              </div>

              {error && (
                <div className="flex items-center gap-2 p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-700 text-sm">
                  <AlertCircle size={16} className="flex-shrink-0" />
                  <span>{error}</span>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex-shrink-0 border-t border-[#EAE7DF] p-4 sm:px-5 bg-white rounded-b-lg">
              <button
                onClick={handleCreate}
                disabled={saving}
                className="w-full inline-flex items-center justify-center gap-2 px-6 py-3 rounded-md bg-[#B8983C] text-white text-sm font-semibold hover:bg-[#9C7F2C] shadow-[0_6px_18px_-6px_rgba(184,152,60,0.65)] disabled:opacity-60 disabled:shadow-none transition-colors"
              >
                {saving ? <Loader2 size={16} className="animate-spin" /> : <ArrowRight size={16} />}
                Create &amp; Add Questions
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
