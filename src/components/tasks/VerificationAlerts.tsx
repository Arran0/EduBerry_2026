'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { ShieldCheck, ChevronRight } from 'lucide-react'
import { fetchTasksAwaitingVerification, TaskAwaitingVerification } from '@/lib/tasks'

interface VerificationAlertsProps {
  userId: string
  /** Bump to force a reload (e.g. after a task is verified). */
  refreshKey?: number
  onNavigate: (assigneeId: string, dueDate: string | null, taskId: string) => void
}

/**
 * Shown above the weekly calendar for coordinators/principals/admin. Surfaces
 * tasks they assigned (with verification required) that the assignee has now
 * marked as "Checking" — so the assigner is no longer unaware. Each button is
 * labelled with the assignee's name and links straight to that assignee's
 * calendar, pointing at the exact task.
 */
export default function VerificationAlerts({ userId, refreshKey, onNavigate }: VerificationAlertsProps) {
  const [items, setItems] = useState<TaskAwaitingVerification[]>([])
  const [loaded, setLoaded] = useState(false)

  const load = useCallback(async () => {
    const data = await fetchTasksAwaitingVerification(userId)
    setItems(data)
    setLoaded(true)
  }, [userId])

  useEffect(() => { load() }, [load, refreshKey])

  if (!loaded || items.length === 0) return null

  return (
    <div className="glass rounded-2xl border border-amber-200 bg-amber-50/60 p-3 mb-4">
      <div className="flex items-center gap-2 mb-2.5">
        <ShieldCheck size={15} className="text-amber-600 flex-shrink-0" />
        <h3 className="text-sm font-semibold text-slate-700">
          Awaiting Your Verification
          <span className="ml-1.5 text-xs font-normal text-amber-600">({items.length})</span>
        </h3>
      </div>
      <div className="flex flex-wrap gap-2">
        {items.map(item => (
          <button
            key={`${item.taskId}-${item.assigneeId}`}
            onClick={() => onNavigate(item.assigneeId, item.dueDate, item.taskId)}
            className="group flex items-center gap-2 pl-2.5 pr-2 py-1.5 rounded-lg bg-white border border-amber-200 hover:border-amber-400 hover:bg-amber-50 transition-colors text-left shadow-sm"
            title={`Open ${item.assigneeName}'s calendar at this task`}
          >
            <span className="w-2 h-2 rounded-full bg-yellow-400 flex-shrink-0" />
            <span className="min-w-0">
              <span className="block text-xs font-semibold text-slate-700 truncate max-w-[180px]">
                {item.title}
              </span>
              <span className="block text-[10px] text-amber-700 truncate max-w-[180px]">
                {item.assigneeName}
              </span>
            </span>
            <ChevronRight size={14} className="text-amber-400 group-hover:text-amber-600 flex-shrink-0" />
          </button>
        ))}
      </div>
    </div>
  )
}
