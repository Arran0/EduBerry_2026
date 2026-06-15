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
    <div className="glass rounded-2xl border border-amber-200 bg-amber-50/60 mb-4 overflow-hidden">
      <button
        type="button"
        onClick={() => setCollapsed(v => !v)}
        className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-amber-50 transition-colors"
      >
        <ShieldCheck size={15} className="text-amber-600 flex-shrink-0" />
        <h3 className="text-sm font-semibold text-slate-700 flex-1">
          Awaiting Your Verification
          <span className="ml-1.5 text-xs font-normal text-amber-600">({items.length})</span>
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
            <div className="px-3 pb-3 grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-h-[360px] overflow-y-auto">
              {groups.map(group => (
                <div key={group.assigneeId} className="rounded-xl border border-amber-200/70 bg-white overflow-hidden">
                  <div className="flex items-center gap-2 px-3 py-2 bg-amber-50/70 border-b border-amber-100">
                    <Avatar avatarUrl={group.avatarUrl} name={group.name} size={24} userId={group.assigneeId} />
                    <span className="text-xs font-semibold text-slate-700 truncate flex-1">{group.name}</span>
                    <span className="text-[10px] font-semibold text-amber-700 bg-amber-100 rounded-full px-1.5 py-0.5 leading-none flex-shrink-0">
                      {group.tasks.length}
                    </span>
                  </div>
                  <div className="divide-y divide-slate-100">
                    {group.tasks.map(task => {
                      const due = formatDue(task.dueDate)
                      return (
                        <button
                          key={task.taskId}
                          onClick={() => onNavigate(task.assigneeId, task.dueDate, task.taskId)}
                          className="group w-full flex items-center gap-2 px-3 py-2 hover:bg-amber-50/60 transition-colors text-left"
                          title={`Open ${group.name}'s calendar at this task`}
                        >
                          <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 flex-shrink-0" />
                          <span className="text-xs text-slate-700 truncate flex-1 group-hover:text-slate-900">
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
