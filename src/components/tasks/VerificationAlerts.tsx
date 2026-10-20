'use client'

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ShieldCheck, ChevronRight, ChevronDown } from 'lucide-react'
import Avatar from '@/components/Avatar'
import { fetchTasksAwaitingVerification, TaskAwaitingVerification } from '@/lib/tasks'

interface VerificationAlertsProps {
  userId: string
  /** Bump to force a reload (e.g. after a task is verified). */
  refreshKey?: number
  onNavigate: (assigneeId: string, dueDate: string | null, taskId: string) => void
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Format a YYYY-MM-DD date into a short label, flagging past-due dates. */
function formatDue(dateStr: string | null): { label: string; overdue: boolean } {
  if (!dateStr) return { label: 'No date', overdue: false }
  const [y, m, d] = dateStr.split('-').map(Number)
  if (!y || !m || !d) return { label: 'No date', overdue: false }
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const dt = new Date(y, m - 1, d)
  return { label: `${MONTHS[m - 1]} ${d}`, overdue: dt < today }
}

interface AssigneeGroup {
  assigneeId: string
  name: string
  avatarUrl: string | null
  tasks: TaskAwaitingVerification[]
}

/**
 * Shown above the weekly calendar for coordinators/principals/admin. Surfaces
 * tasks they assigned (with verification required) that the assignee has now
 * marked as "Checking" — so the assigner is no longer unaware. Tasks are grouped
 * per assignee so the list stays tidy even with many of them; each row links
 * straight to that assignee's calendar, pointing at the exact task.
 */
export default function VerificationAlerts({ userId, refreshKey, onNavigate }: VerificationAlertsProps) {
  const [items, setItems] = useState<TaskAwaitingVerification[]>([])
  const [loaded, setLoaded] = useState(false)
  const [collapsed, setCollapsed] = useState(false)

  const load = useCallback(async () => {
    const data = await fetchTasksAwaitingVerification(userId)
    setItems(data)
    setLoaded(true)
  }, [userId])

  useEffect(() => { load() }, [load, refreshKey])

  const groups = useMemo<AssigneeGroup[]>(() => {
    const map = new Map<string, AssigneeGroup>()
    for (const item of items) {
      let group = map.get(item.assigneeId)
      if (!group) {
        group = { assigneeId: item.assigneeId, name: item.assigneeName, avatarUrl: item.assigneeAvatarUrl, tasks: [] }
        map.set(item.assigneeId, group)
      }
      group.tasks.push(item)
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name))
  }, [items])

  if (!loaded || items.length === 0) return null

  return (
    <div className="tk-card mb-3 sm:mb-4 overflow-hidden">
      <button
        type="button"
        onClick={() => setCollapsed(v => !v)}
        className="tk-card-head w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left hover:bg-amber-50 transition-colors"
      >
        <span className="tk-chip-icon w-7 h-7 !rounded-[10px]"><ShieldCheck size={14} /></span>
        <h3 className="text-[13.5px] font-semibold text-slate-800 flex-1 min-w-0">
          Awaiting your verification
          <span className="ml-1.5 inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-amber-100 text-amber-800 text-[11px] font-bold tabular-nums">{items.length}</span>
        </h3>
        <ChevronDown
          size={16}
          className={`text-amber-500 transition-transform duration-200 flex-shrink-0 ${collapsed ? '-rotate-90' : ''}`}
        />
      </button>

      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="p-2.5 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2 max-h-[340px] overflow-y-auto overscroll-contain">
              {groups.map(group => (
                <div key={group.assigneeId} className="rounded-[14px] border border-amber-900/[0.08] bg-white overflow-hidden min-w-0">
                  <div className="flex items-center gap-2 px-3 py-1.5 bg-[#fffaf2] border-b border-amber-900/[0.06]">
                    <Avatar avatarUrl={group.avatarUrl} name={group.name} size={24} userId={group.assigneeId} />
                    <span className="text-[12.5px] font-semibold text-slate-700 break-words min-w-0 flex-1">{group.name}</span>
                    <span className="text-[10px] font-semibold text-amber-700 bg-amber-100 rounded-full px-1.5 py-0.5 leading-none flex-shrink-0">
                      {group.tasks.length}
                    </span>
                  </div>
                  <div className="divide-y divide-amber-900/[0.05]">
                    {group.tasks.map(task => {
                      const due = formatDue(task.dueDate)
                      return (
                        <button
                          key={task.taskId}
                          onClick={() => onNavigate(task.assigneeId, task.dueDate, task.taskId)}
                          className="group w-full flex items-center gap-2 px-3 py-1.5 hover:bg-amber-50/60 transition-colors text-left"
                          title={`Open ${group.name}'s calendar at this task`}
                        >
                          <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 flex-shrink-0" />
                          <span className="text-[12.5px] text-slate-700 break-words min-w-0 flex-1 leading-snug group-hover:text-amber-900">
                            {task.title}
                          </span>
                          <span className={`text-[10px] flex-shrink-0 ${due.overdue ? 'text-red-500 font-semibold' : 'text-slate-400'}`}>
                            {due.label}
                          </span>
                          <ChevronRight size={13} className="text-slate-300 group-hover:text-amber-500 flex-shrink-0" />
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
