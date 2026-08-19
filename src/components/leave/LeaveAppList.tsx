'use client'

import React from 'react'
import { motion } from 'framer-motion'
import LeaveApplicationCard, { type LeaveCardVariant } from './LeaveApplicationCard'
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
  /**
   * `card` (default) stacks separate rounded panels. `row` renders a mail-style
   * list: flush rows divided by hairlines, each shut until it's opened.
   */
  variant?: LeaveCardVariant
}

/**
 * A paged list of leave applications: the loaded window plus a "Load 10 more"
 * step. Only what is on screen has been fetched — the rest stays in the
 * database until the user asks for it.
 */
export default function LeaveAppList({
  list, userId, role, isApprover, canDelete, onRefresh, onLoadMore, variant = 'card',
}: LeaveAppListProps) {
  const remaining = Math.max(list.total - list.items.length, 0)
  const isRow = variant === 'row'

  return (
    <div>
      <motion.div
        variants={containerV}
        initial="hidden"
        animate="show"
        className={isRow
          // No rounded card around the rows: this list is already inside one
          // (the popup, or the page's own surface). Nesting a second card just
          // spends width on borders — the rows run edge to edge instead.
          ? 'bg-white border-y border-slate-200 divide-y divide-slate-100'
          : 'space-y-3'}
      >
        {list.items.map((app: LeaveApplicationWithDetails) => (
          <motion.div
            key={app.id}
            variants={itemV}
            id={`leave-app-${app.id}`}
            className={isRow ? '' : 'rounded-2xl'}
          >
            <LeaveApplicationCard
              application={app}
              currentUserId={userId}
              currentUserRole={role}
              isApprover={isApprover}
              canDelete={canDelete}
              variant={variant}
              onStatusChange={onRefresh}
            />
          </motion.div>
        ))}
      </motion.div>

      {list.hasMore && (
        <button
          onClick={onLoadMore}
          disabled={list.loadingMore}
          className={`w-full py-2.5 flex items-center justify-center gap-2 text-sm font-semibold text-slate-700 bg-white transition-colors disabled:opacity-60 ${
            isRow
              ? 'border-b border-slate-200 hover:bg-slate-50'
              : 'mt-3 border border-slate-200 rounded-xl hover:bg-slate-50'
          }`}
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
