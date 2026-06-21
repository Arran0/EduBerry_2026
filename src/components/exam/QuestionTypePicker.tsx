'use client'

import React from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { X, CheckCircle2, ListChecks, Hash, ToggleLeft, AlignLeft, FileText } from 'lucide-react'
import {
  ExamMode, QuestionKind, getExamMode, QUESTION_KINDS, defaultScoring, scoringSummary,
} from '@/lib/examScoring'

const KIND_ICON: Record<QuestionKind, React.ReactNode> = {
  single_correct:   <CheckCircle2 size={18} />,
  multiple_correct: <ListChecks size={18} />,
  integer:          <Hash size={18} />,
  true_false:       <ToggleLeft size={18} />,
  short_answer:     <AlignLeft size={18} />,
  subjective:       <FileText size={18} />,
}

/**
 * Modal shown before the question editor opens when the current exam mode
 * allows more than one question type. Picking a kind determines the editor
 * UI, validation and automatic scoring.
 */
export default function QuestionTypePicker({
  open,
  mode,
  onPick,
  onClose,
}: {
  open: boolean
  mode: ExamMode
  onPick: (kind: QuestionKind) => void
  onClose: () => void
}) {
  if (typeof document === 'undefined') return null
  const cfg = getExamMode(mode)

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-0 z-[60] flex items-end sm:items-center sm:justify-center sm:p-4 bg-black/50 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            initial={{ y: '100%', opacity: 0.6 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: '100%', opacity: 0.6 }}
            transition={{ type: 'tween', duration: 0.36, ease: [0.32, 0.72, 0, 1] }}
            className="bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl w-full sm:max-w-md"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#F0F0F0]">
              <div>
                <h2 className="text-base font-bold text-[#18181B]">What type of question?</h2>
                <p className="text-xs text-[#A1A1AA]">{cfg.label} mode</p>
              </div>
              <button onClick={onClose} className="p-2 text-[#A1A1AA] hover:text-[#27272A] hover:bg-[#F4F4F5] rounded-lg transition-colors">
                <X size={18} />
              </button>
            </div>

            <div className="p-4 space-y-2">
              {cfg.allowedKinds.map(kind => {
                const meta = QUESTION_KINDS[kind]
                const def = defaultScoring(mode, kind)
                return (
                  <button
                    key={kind}
                    onClick={() => onPick(kind)}
                    className="w-full flex items-center gap-3 p-3 rounded-xl border border-[#E4E4E7] hover:border-[var(--page-accent)] hover:bg-[var(--page-accent-light)]/60 transition-colors text-left"
                  >
                    <div className="w-10 h-10 rounded-xl bg-[var(--page-accent-light)] text-[var(--page-accent)] flex items-center justify-center shrink-0">
                      {KIND_ICON[kind]}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-[#18181B]">{meta.label}</p>
                      <p className="text-xs text-[#A1A1AA]">{scoringSummary(def.strategy, def.params)}</p>
                    </div>
                  </button>
                )
              })}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
