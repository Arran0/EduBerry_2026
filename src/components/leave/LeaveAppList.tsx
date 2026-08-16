'use client'

import React from 'react'
import { motion } from 'framer-motion'
import LeaveApplicationCard from './LeaveApplicationCard'
import { LEAVE_PAGE_SIZE, type LeaveApplicationWithDetails } from '@/lib/leave'
import type { PagedLeaveList } from '@/hooks/usePagedLeaveLists'

const containerV = { hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.06 } } }
const itemV = { hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0 } }

interface LeaveAppListProps {
  list: PagedLeaveList
  userId: string
  role: string
  isApprover: boolean
  canDelete?: boolean
  onRefresh: () => void
  onLoadMore: () => void
  /** Opens another application picked from a card's attendance calendar. */
  onViewLeave?: (app: LeaveApplicationWithDetails) => void
}

/**
 * A paged list of leave applications: the loaded window plus a "Load 10 more"
 * step. Only what is on screen has been fetched — the rest stays in the
 * database until the user asks for it.
 */
export default function LeaveAppList({
  list, userId, role, isApprover, canDelete, onRefresh, onLoadMore, onViewLeave,
}: LeaveAppListProps) {
  const remaining = Math.max(list.total - list.items.length, 0)

  return (
    <div>
      <motion.div variants={containerV} initial="hidden" animate="show" className="space-y-3">
        {list.items.map((app: LeaveApplicationWithDetails) => (
          <motion.div key={app.id} variants={itemV} id={`leave-app-${app.id}`} className="rounded-2xl">
            <LeaveApplicationCard
              application={app}
              currentUserId={userId}
              currentUserRole={role}
              isApprover={isApprover}
              canDelete={canDelete}
              onStatusChange={onRefresh}
              onViewLeave={onViewLeave}
            />
          </motion.div>
        ))}
      </motion.div>

      {list.hasMore && (
        <button
          onClick={onLoadMore}
          disabled={list.loadingMore}
          className="w-full mt-3 py-2.5 flex items-center justify-center gap-2 text-sm font-semibold text-slate-700 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors disabled:opacity-60"
        >
          {list.loadingMore ? (
            <>
              <span className="w-4 h-4 rounded-full border-2 border-slate-300 border-t-slate-600 animate-spin flex-shrink-0" />
              Loading…
            </>
          ) : (
            <>
              Load {Math.min(LEAVE_PAGE_SIZE, remaining)} more
              <span className="text-slate-400 font-normal">
                · showing {list.items.length} of {list.total}
              </span>
            </>
          )}
        </button>
      )}
    </div>
  )
}
