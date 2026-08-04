'use client'

import React, { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { X, CalendarDays } from 'lucide-react'
import LeaveApplicationCard from './LeaveApplicationCard'
import { fetchLeaveApplicationById, type LeaveApplicationWithDetails } from '@/lib/leave'

interface LeaveApplicationDetailModalProps {
  /** Application to show, or null when the popup is closed. */
  applicationId: string | null
  currentUserId: string
  currentUserRole: string
  canDelete?: boolean
  onClose: () => void
  /** Fired after a decision or deletion, so the underlying lists can refresh. */
  onChanged?: () => void
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
          className="fixed inset-0 z-40 flex items-end sm:items-center justify-center p-3 sm:p-4 bg-black/50 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.96, opacity: 0, y: 16 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.96, opacity: 0, y: 16 }}
            className="bg-white rounded-3xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 px-5 pt-5 pb-4 border-b border-slate-100 flex-shrink-0">
              <div className="p-2 bg-slate-100 rounded-xl">
                <CalendarDays size={16} className="text-slate-500" />
              </div>
              <h3 className="flex-1 font-bold text-slate-800">Leave Application</h3>
              <button
                onClick={onClose}
                className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            <div className="overflow-y-auto flex-1 px-4 py-4">
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
