'use client'

import React, { useState, useEffect, useCallback, useMemo } from 'react'
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

/** "12 Oct", and whether that date has passed. */
function formatDue(dateStr: string | null): { label: string; overdue: boolean } {
  if (!dateStr) return { label: 'No date', overdue: false }
  const [y, m, d] = dateStr.split('-').map(Number)
  if (!y || !m || !d) return { label: 'No date', overdue: false }
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return { label: `${d} ${MONTHS[m - 1]}`, overdue: new Date(y, m - 1, d) < today }
}

interface AssigneeGroup {
  assigneeId: string
  name: string
  avatarUrl: string | null
  tasks: TaskAwaitingVerification[]
}

/**
 * Above the week, for coordinators, principals and admins: tasks they set
 * that need a check, which the assignee has now marked done. Grouped by
 * person; each row opens that person's calendar at the task.
 */
export default function VerificationAlerts({ userId, refreshKey, onNavigate }: VerificationAlertsProps) {
  const [items, setItems] = useState<TaskAwaitingVerification[]>([])
  const [loaded, setLoaded] = useState(false)
  const [collapsed, setCollapsed] = useState(false)

  const load = useCallback(async () => {
    setItems(await fetchTasksAwaitingVerification(userId))
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
    <section className="fx-card fx-bleed border-l-[3px] !border-l-[#B8983C] overflow-hidden">
      <button
        type="button"
        onClick={() => setCollapsed(v => !v)}
        aria-expanded={!collapsed}
        className="w-full flex items-center gap-2 px-3.5 min-h-[44px] text-left hover:bg-[#FAF7F0] transition-colors"
      >
        <ShieldCheck size={15} className="text-[#8B6F47] flex-shrink-0" />
        <h3 className="text-[13.5px] font-semibold text-slate-900 leading-snug flex-1 min-w-0">
          Waiting for you to check <span className="ml-1 text-[12.5px] font-bold text-[#8B6F47] tabular-nums">{items.length}</span>
        </h3>
        <ChevronDown size={15} className={`text-slate-400 transition-transform duration-200 flex-shrink-0 ${collapsed ? '' : 'rotate-180'}`} />
      </button>

      {!collapsed && (
        <div className="border-t border-[#EEEAE1] grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 max-h-[22rem] overflow-y-auto overscroll-contain">
          {groups.map(group => (
            <div key={group.assigneeId} className="bg-white min-w-0 border-b md:border-r border-[#EEEAE1]">
              <div className="flex items-center gap-2 px-3 py-1.5 bg-[#FAF8F3]">
                <Avatar avatarUrl={group.avatarUrl} name={group.name} size={22} userId={group.assigneeId} />
                <span className="text-[12.5px] font-semibold text-slate-800 flex-1 min-w-0 break-words">{group.name}</span>
                <span className="text-[11px] font-bold text-[#7A5D12] bg-[#FBF1D6] rounded-full px-1.5 h-[18px] leading-[18px] tabular-nums flex-shrink-0">{group.tasks.length}</span>
              </div>
              {group.tasks.map(task => {
                const due = formatDue(task.dueDate)
                return (
                  <button
                    key={task.taskId}
                    onClick={() => onNavigate(task.assigneeId, task.dueDate, task.taskId)}
                    className="group w-full flex items-center gap-2 px-3 py-1.5 border-t border-[#F3F0E8] hover:bg-[#FAF7F0] transition-colors text-left"
                    title={`Open ${group.name}'s calendar at this task`}
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 flex-shrink-0" />
                    <span className="text-[12.5px] text-slate-800 flex-1 min-w-0 leading-snug break-words">{task.title}</span>
                    <span className={`text-[11px] tabular-nums flex-shrink-0 ${due.overdue ? 'text-rose-600 font-semibold' : 'text-slate-400'}`}>{due.label}</span>
                    <ChevronRight size={13} className="text-slate-300 group-hover:text-[#8B6F47] flex-shrink-0" />
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
