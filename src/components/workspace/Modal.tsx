'use client'

import React, { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import useBodyScrollLock from '@/hooks/useBodyScrollLock'

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl' | '2xl'

const SIZE: Record<ModalSize, string> = {
  sm: 'sm:max-w-md',
  md: 'sm:max-w-2xl',
  lg: 'sm:max-w-4xl',
  xl: 'sm:max-w-6xl',
  // For editors with their own multi-column layout (the timetable entity hubs).
  '2xl': 'sm:max-w-[96rem]',
}

interface ModalProps {
  open: boolean
  onClose: () => void
  title: string
  subtitle?: string
  icon?: LucideIcon
  size?: ModalSize
  /**
   * Pin the panel to its maximum height instead of letting it shrink to fit.
   * Use it when several screens share one modal and should not visibly resize
   * as you switch between them — it also gives the body a definite height, so
   * children can lay themselves out with `h-full` and scroll internally.
   */
  fullHeight?: boolean
  children: React.ReactNode
  footer?: React.ReactNode
}

/**
 * Shared modal shell for the timetable admin workspace. Portal + dimmed
 * overlay + panel, with a mobile bottom-sheet (drag handle, rounded top) that
 * becomes a centered flat card on desktop — matching the flat zinc aesthetic of
 * `workspace/ui.tsx`. Extracted from the overlay pattern copy-pasted across the
 * app (see `BulkImportModal`) so every entity popup stays visually identical.
 *
 * Closes on Escape and on backdrop click; the panel stops propagation so clicks
 * inside never dismiss it.
 */
export default function Modal({
  open, onClose, title, subtitle, icon: Icon, size = 'lg', fullHeight = false, children, footer,
}: ModalProps) {
  // Body scroll is frozen by the shared refcounted lock — see the hook for why
  // the save/restore-per-modal version leaves the page stuck when two stack.
  useBodyScrollLock(open)

  // Close on Escape while open.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (typeof document === 'undefined') return null

  const modal = (
    <AnimatePresence>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 bg-black/60 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 40, opacity: 0 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            onClick={(e) => e.stopPropagation()}
            className={`bg-white w-full ${SIZE[size]} ${
              fullHeight ? 'h-[92dvh] sm:h-[88vh]' : 'max-h-[92dvh] sm:max-h-[88vh]'
            } flex flex-col shadow-2xl rounded-t-2xl sm:rounded-none overflow-hidden`}
          >
            {/* Header */}
            <div className="bg-[#27272A] px-5 pt-3 pb-3.5 flex-shrink-0">
              <div className="w-10 h-1 bg-white/30 rounded-full mx-auto mb-3 sm:hidden" />
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  {Icon && (
                    <div className="p-2 bg-white/10 rounded-lg flex-shrink-0">
                      <Icon size={18} className="text-white" />
                    </div>
                  )}
                  <div className="min-w-0">
                    <h2 className="font-semibold text-white text-base truncate">{title}</h2>
                    {subtitle && <p className="text-xs text-[#A1A1AA] truncate">{subtitle}</p>}
                  </div>
                </div>
                <button
                  onClick={onClose}
                  className="p-1.5 bg-white/10 hover:bg-white/20 rounded-lg transition-colors flex-shrink-0"
                  aria-label="Close"
                >
                  <X size={16} className="text-white" />
                </button>
              </div>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-5">{children}</div>

            {/* Footer */}
            {footer && (
              <div className="flex-shrink-0 border-t border-[#E4E4E7] bg-[#FAFAF9] px-4 sm:px-5 py-3">
                {footer}
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )

  return createPortal(modal, document.body)
}
