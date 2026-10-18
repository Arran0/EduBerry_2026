'use client'

import React, { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { X, CalendarDays } from 'lucide-react'
import LeaveApplicationCard from './LeaveApplicationCard'
import { fetchLeaveApplicationById, type LeaveApplicationWithDetails } from '@/lib/leave'
import { SHEET_MOTION } from '@/lib/sheetMotion'

interface LeaveApplicationDetailModalProps {
  /** Application to show, or null when the popup is closed. */
  applicationId: string | null
  currentUserId: string
  currentUserRole: string
  canDelete?: boolean
  onClose: () => void
  /** Fired after a decision or deletion, so the underlying lists can refresh. */
  onChanged?: () => void
  /**
   * Overlay stacking. Defaults to `z-40` — raise it when the leave app is
   * itself hosted in a popup, so this opens above its host instead of behind.
   */
  zClass?: string
}

/** True when the viewer still owes this application a decision. */
function viewerCanDecide(
  app: LeaveApplicationWithDetails,
  userId: string,
  role: string,
): boolean {
  return app.approvals.some(a =>
    a.status === 'pending' &&
    (a.approver_id === userId || (!a.approver_id && a.approver_role === role))
  )
}

/**
 * Opens one leave application on its own, fetched by id.
 *
 * Deep links (from the home notifications box or an attendance calendar) used
 * to land on a full list and scroll to the right card, which meant loading
 * every neighbouring application just to show one. This fetches exactly the
 * application asked for.
 *
 * Sits below z-50 on purpose: the card's own review / attendance / delete
 * popups open on top of it.
 */
export default function LeaveApplicationDetailModal({
  applicationId,
  currentUserId,
  currentUserRole,
  canDelete = false,
  onClose,
  onChanged,
  zClass = 'z-40',
}: LeaveApplicationDetailModalProps) {
  const [application, setApplication] = useState<LeaveApplicationWithDetails | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    if (!applicationId) return
    setLoading(true)
    setApplication(await fetchLeaveApplicationById(applicationId))
    setLoading(false)
  }, [applicationId])

  useEffect(() => {
    if (!applicationId) { setApplication(null); return }
    load()
  }, [applicationId, load])

  // Close on Escape, matching the backdrop click.
  useEffect(() => {
    if (!applicationId) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [applicationId, onClose])

  const handleStatusChange = () => {
    load()
    onChanged?.()
  }

  if (typeof document === 'undefined') return null

  return createPortal(
    <AnimatePresence>
      {applicationId && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className={`fixed inset-0 ${zClass} flex items-end sm:items-center justify-center p-3 sm:p-4 bg-[#1c1a1e]/45`}
          onClick={onClose}
        >
          <motion.div
            {...SHEET_MOTION} // slides, never fades — see lib/sheetMotion
            className="lg-sheet relative rounded-[28px] w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            <div className="relative z-[3] flex items-center gap-3 px-4 sm:px-5 pt-4 pb-3 flex-shrink-0">
              <div className="icon-chip w-10 h-10 flex-shrink-0 bg-gradient-to-br from-violet-500 to-indigo-600">
                <CalendarDays size={17} className="relative z-10 text-white" />
              </div>
              <h3 className="flex-1 font-display text-[1.05rem] font-bold text-slate-900 leading-tight headline">Leave application</h3>
              <button
                onClick={onClose}
                className="lg-control w-9 h-9 flex-shrink-0"
              >
                <X size={16} />
              </button>
            </div>

            <div className="lg-sheet-card relative z-[3] mx-2 mb-2 overflow-y-auto overscroll-contain flex-1 px-4 py-4">
              {loading && !application ? (
                <div className="text-center py-12">
                  <div className="spinner mx-auto mb-3" />
                  <p className="text-sm text-slate-500">Loading…</p>
                </div>
              ) : application ? (
                <LeaveApplicationCard
                  application={application}
                  currentUserId={currentUserId}
                  currentUserRole={currentUserRole}
                  isApprover={viewerCanDecide(application, currentUserId, currentUserRole)}
                  canDelete={canDelete}
                  onStatusChange={handleStatusChange}
                />
              ) : (
                <div className="text-center py-12">
                  <p className="text-sm text-slate-500">
                    This application is no longer available.
                  </p>
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
