'use client'

import React from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { X, ExternalLink } from 'lucide-react'
import { LeaveApplicationWithDetails, LEAVE_TYPE_LABELS, LEAVE_STATUS_LABELS } from '@/lib/leave'

export function canViewLeaveApp(
  app: LeaveApplicationWithDetails,
  viewerUserId?: string,
  viewerRole?: string,
): boolean {
  if (!viewerUserId || !viewerRole) return false
  if (viewerRole === 'admin' || viewerRole === 'principal') return true
  if (app.applicant_id === viewerUserId) return true
  return app.approvals.some(a =>
    a.approver_id === viewerUserId ||
    (!a.approver_id && a.approver_role === viewerRole)
  )
}

interface LeaveAppPreviewModalProps {
  application: LeaveApplicationWithDetails
  onClose: () => void
  viewerUserId?: string
  viewerRole?: string
  /** Opens the full OD / Leave app on this application. Omit to hide the button. */
  onViewFull?: (app: LeaveApplicationWithDetails) => void
}

/**
 * The compact "application alone" popup — date, type, status and reason, plus
 * an optional link into the full OD / Leave app. Not the full app itself.
 * Shared by the calendar's leave-day dot, the updates popup, and the Home
 * page notification click, so all three open the exact same card.
 */
export default function LeaveAppPreviewModal({
  application, onClose, viewerUserId, viewerRole, onViewFull,
}: LeaveAppPreviewModalProps) {
  if (typeof document === 'undefined') return null

  return createPortal(
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          className="bg-white rounded-2xl shadow-2xl w-full max-w-xs overflow-hidden"
          onClick={e => e.stopPropagation()}
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
            <div>
              <p className="text-sm font-bold text-slate-800">
                {new Date(application.start_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                {application.end_date !== application.start_date && (
                  <> – {new Date(application.end_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</>
                )}
              </p>
              <p className="text-[11px] text-slate-400 mt-0.5">
                {LEAVE_TYPE_LABELS[application.leave_type]} · {LEAVE_STATUS_LABELS[application.status]}
              </p>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
            >
              <X size={15} />
            </button>
          </div>
          <div className="px-4 py-3 space-y-3">
            <p className="text-sm text-slate-700 leading-relaxed">{application.reason}</p>
            {onViewFull && canViewLeaveApp(application, viewerUserId, viewerRole) && (
              <button
                onClick={() => onViewFull(application)}
                className="w-full flex items-center justify-center gap-1.5 py-2 text-xs font-semibold text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors"
              >
                <ExternalLink size={12} />
                View in OD / Leave Manager
              </button>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body
  )
}
