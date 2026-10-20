'use client'

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import dynamic from 'next/dynamic'
import { AnimatePresence } from 'framer-motion'
import { Plus, Users, ListOrdered, Calendar as CalendarIcon, FolderKanban, AlertTriangle, CheckCircle2, ChevronDown } from 'lucide-react'
import Avatar from '@/components/Avatar'
import { ProjectStatus, ProjectWithDetails, fetchProjectsForUser, getProjectStatus } from '@/lib/projects'
import { STATUS_DOT_COLORS } from '@/lib/tasks'
import { UserProfile, UserRole } from '@/lib/supabase'
import { TaskDeck, Btn, Chip, Panel, PanelHead, SearchField, Loading, Note, Stepper } from './ui'

const ProjectCard = dynamic(() => import('./ProjectCard'))
const NewProjectForm = dynamic(() => import('./NewProjectForm'))

interface ProjectsListProps {
  userId: string
  userRole: UserRole
  canEdit: boolean
  canCheck: boolean
  availableAssignees: UserProfile[]
}

type Row = ProjectWithDetails & { _status: ProjectStatus }

const ACTIVE_PAGE_SIZE = 12
const CLOSED_PAGE_SIZE = 8

/** One colour per project on the month timeline, in a fixed order. */
const BAR_COLORS = ['#B45309', '#0F766E', '#7C3AED', '#BE123C', '#0369A1', '#4D7C0F', '#C2410C', '#475569']

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function shortDate(iso: string | null): string {
  if (!iso) return '?'
  const [, m, d] = iso.split('-').map(Number)
  return `${d} ${MONTHS[m - 1]}`
}

function localToday(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function ProjectsList({ userId, userRole, canEdit, canCheck, availableAssignees }: ProjectsListProps) {
  const [projects, setProjects] = useState<ProjectWithDetails[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showNewProject, setShowNewProject] = useState(false)
  const [calendarMonth, setCalendarMonth] = useState(() => new Date())
  const [showClosed, setShowClosed] = useState(false)
  const [closedSearch, setClosedSearch] = useState('')
  const [activeVisible, setActiveVisible] = useState(ACTIVE_PAGE_SIZE)
  const [closedVisible, setClosedVisible] = useState(CLOSED_PAGE_SIZE)

  const loadProjects = useCallback(async () => {
    const data = await fetchProjectsForUser(userId, userRole)
    setProjects(data)
    setLoading(false)
  }, [userId, userRole])

  useEffect(() => { loadProjects() }, [loadProjects])

  // The open project is looked up by id, so it always shows the fresh copy
  // after a reload and closes if it was deleted.
  const selectedProject = selectedId ? projects.find(p => p.id === selectedId) ?? null : null

  const { active, closed } = useMemo(() => {
    const active: Row[] = []
    const closed: Row[] = []
    for (const p of projects) {
      const status = getProjectStatus(p.end_date, p.subtasks)
      ;(status.isCompleted || status.isCompletedAfterDue ? closed : active).push({ ...p, _status: status })
    }
    // Overdue first, then the original order.
    active.sort((a, b) => Number(b._status.isOverdue) - Number(a._status.isOverdue))
    return { active, closed }
  }, [projects])

  const filteredClosed = useMemo(() => {
    const q = closedSearch.trim().toLowerCase()
    if (!q) return closed.slice(0, closedVisible)
    return closed.filter(p => p.title.toLowerCase().includes(q) || (p.description || '').toLowerCase().includes(q))
  }, [closed, closedSearch, closedVisible])

  const newButton = canEdit ? (
    <Btn tone="dark" onClick={() => setShowNewProject(true)} className="!h-9">
      <Plus size={15} /> New project
    </Btn>
  ) : undefined

  return (
    <div className="space-y-4 sm:space-y-5">
      <TaskDeck title="Projects" icon={FolderKanban} actions={newButton}>
        {loading ? (
          <Loading label="Loading projects…" />
        ) : projects.length === 0 ? (
          <Panel>
            <div className="px-4 py-8 text-center">
              <FolderKanban size={28} className="text-slate-300 mx-auto mb-2" />
              <p className="text-[13.5px] font-semibold text-slate-800">No projects yet</p>
              <p className="text-[12.5px] text-slate-500 mt-0.5">
                {canEdit ? 'A project groups related subtasks and the people doing them.' : 'Projects you are added to will show here.'}
              </p>
              {canEdit && <Btn tone="dark" onClick={() => setShowNewProject(true)} className="mt-3"><Plus size={14} /> Create a project</Btn>}
            </div>
          </Panel>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] gap-2.5 sm:gap-3 items-start">
            <div className="space-y-2.5 sm:space-y-3 min-w-0">
              <Panel>
                <PanelHead title={<>Active <span className="text-slate-400 font-medium tabular-nums">{active.length}</span></>} />
                {active.length === 0 ? (
                  <Note>Every project is complete.</Note>
                ) : (
                  <div className="divide-y divide-[#EEEAE1]">
                    {active.slice(0, activeVisible).map(p => <ProjectRow key={p.id} project={p} onOpen={() => setSelectedId(p.id)} />)}
                  </div>
                )}
                {activeVisible < active.length && (
                  <button onClick={() => setActiveVisible(c => c + ACTIVE_PAGE_SIZE)} className="w-full h-10 border-t border-[#EEEAE1] text-[12.5px] font-semibold text-[#8B6F47] hover:bg-[#FAF7F0] transition-colors">
                    Show {Math.min(ACTIVE_PAGE_SIZE, active.length - activeVisible)} more
                  </button>
                )}
              </Panel>

              {closed.length > 0 && (
                <Panel>
                  <button
                    onClick={() => setShowClosed(v => !v)}
                    aria-expanded={showClosed}
                    className="w-full flex items-center gap-2 px-3.5 min-h-[44px] text-left hover:bg-[#FAF7F0] transition-colors"
                  >
                    <CheckCircle2 size={15} className="text-emerald-600 flex-shrink-0" />
                    <span className="text-[13.5px] font-semibold text-slate-900">Completed</span>
                    <span className="text-[12.5px] font-medium text-slate-400 tabular-nums">{closed.length}</span>
                    <ChevronDown size={15} className={`ml-auto text-slate-400 transition-transform duration-200 ${showClosed ? 'rotate-180' : ''}`} />
                  </button>
                  {showClosed && (
                    <div className="border-t border-[#EEEAE1]">
                      <div className="p-2.5">
                        <SearchField value={closedSearch} onChange={setClosedSearch} placeholder="Search completed projects" />
                      </div>
                      <div className="divide-y divide-[#EEEAE1] border-t border-[#EEEAE1]">
                        {filteredClosed.map(p => <ProjectRow key={p.id} project={p} onOpen={() => setSelectedId(p.id)} />)}
                        {filteredClosed.length === 0 && <Note className="!py-5">No completed project matches that.</Note>}
                      </div>
                      {!closedSearch && closedVisible < closed.length && (
                        <button onClick={() => setClosedVisible(c => c + CLOSED_PAGE_SIZE)} className="w-full h-10 border-t border-[#EEEAE1] text-[12.5px] font-semibold text-[#8B6F47] hover:bg-[#FAF7F0] transition-colors">
                          Show more
                        </button>
                      )}
                    </div>
                  )}
                </Panel>
              )}
            </div>

            <MonthTimeline
              projects={projects}
              month={calendarMonth}
              onMonth={setCalendarMonth}
              onOpen={id => setSelectedId(id)}
            />
          </div>
        )}
      </TaskDeck>

      <AnimatePresence>
        {selectedProject && (
          <ProjectCard
            key={selectedProject.id}
            project={selectedProject}
            canEdit={canEdit}
            canCheck={canCheck}
            onClose={() => setSelectedId(null)}
            onUpdated={loadProjects}
            availableAssignees={availableAssignees}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showNewProject && (
          <NewProjectForm
            onClose={() => setShowNewProject(false)}
            onProjectCreated={() => { loadProjects(); setShowNewProject(false) }}
            currentUserId={userId}
            availableAssignees={availableAssignees}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

function ProjectRow({ project, onOpen }: { project: Row; onOpen: () => void }) {
  const countable = project.subtasks.filter(s => s.status !== 'dismissed')
  const total = countable.length
  const done = countable.filter(s => s.status === 'done' || s.status === 'checked').length
  const progress = total > 0 ? Math.round((done / total) * 100) : 0
  const { isOverdue, isCompleted, isCompletedAfterDue } = project._status
  const accent = isOverdue ? '#E11D48' : isCompletedAfterDue ? '#EA580C' : 'transparent'

  return (
    <button onClick={onOpen} className="w-full flex items-stretch text-left hover:bg-[#FAF7F0] transition-colors">
      <span className="w-[3px] flex-shrink-0" style={{ background: accent }} />
      <span className="flex-1 min-w-0 flex items-start gap-3 px-3 py-2.5">
        <span className="flex-1 min-w-0">
          <span className="flex flex-wrap items-center gap-1.5">
            <span className={`text-[13.5px] font-semibold leading-snug break-words min-w-0 ${isCompleted || isCompletedAfterDue ? 'text-slate-500' : 'text-slate-900'}`}>
              {project.title}
            </span>
            {project.sequential_mode && <Chip tone="neutral"><ListOrdered size={10} /> In order</Chip>}
            {isOverdue && <Chip tone="bad"><AlertTriangle size={10} /> Overdue</Chip>}
            {isCompleted && <Chip tone="good"><CheckCircle2 size={10} /> Done</Chip>}
            {isCompletedAfterDue && <Chip tone="gold">Done late</Chip>}
          </span>
          {project.description && (
            <span className="block text-[12px] text-slate-500 leading-snug mt-0.5 break-words">{project.description}</span>
          )}
          <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1 text-[11.5px] text-slate-500">
            {(project.start_date || project.end_date) && (
              <span className="inline-flex items-center gap-1"><CalendarIcon size={11} />{shortDate(project.start_date)} – {shortDate(project.end_date)}</span>
            )}
            <span className="inline-flex items-center gap-1"><Users size={11} />{project.members.length}</span>
            <span className={`font-medium ${project._status.color}`}>{project._status.label}</span>
          </span>
          {total > 0 && (
            <span className="flex items-center gap-2 mt-1.5">
              <span className="flex-1 h-1.5 bg-[#EEEAE1] rounded-full overflow-hidden">
                <span className="block h-full rounded-full bg-gradient-to-r from-[#B45309] to-[#EA580C]" style={{ width: `${progress}%` }} />
              </span>
              <span className="text-[11px] text-slate-500 tabular-nums flex-shrink-0">{done}/{total}</span>
            </span>
          )}
        </span>
        <span className="hidden sm:flex -space-x-2 flex-shrink-0 pt-0.5">
          {project.members.slice(0, 3).map(m => (
            <span key={m.id} className="rounded-full ring-2 ring-white" title={m.user?.full_name || 'Unknown'}>
              <Avatar avatarUrl={m.user?.avatar_url} name={m.user?.full_name} size={26} />
            </span>
          ))}
          {project.members.length > 3 && (
            <span className="w-[26px] h-[26px] rounded-full bg-[#EEEAE1] ring-2 ring-white flex items-center justify-center text-[10px] font-bold text-slate-600">
              +{project.members.length - 3}
            </span>
          )}
        </span>
      </span>
    </button>
  )
}

/**
 * Projects across one month. Bars are placed by percentage of the month, so
 * the chart fits any width — no sideways scrolling on a phone.
 */
function MonthTimeline({ projects, month, onMonth, onOpen }: {
  projects: ProjectWithDetails[]
  month: Date
  onMonth: (d: Date) => void
  onOpen: (id: string) => void
}) {
  const y = month.getFullYear()
  const m = month.getMonth()
  const days = new Date(y, m + 1, 0).getDate()
  const pad = (n: number) => String(n).padStart(2, '0')
  const monthStart = `${y}-${pad(m + 1)}-01`
  const monthEnd = `${y}-${pad(m + 1)}-${pad(days)}`
  const label = month.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
  const today = localToday()
  const todayDay = today >= monthStart && today <= monthEnd ? Number(today.slice(8)) : null

  const rows = projects.filter(p => {
    if (!p.start_date && !p.end_date) return false
    const s = p.start_date || p.end_date!
    const e = p.end_date || p.start_date!
    return s <= monthEnd && e >= monthStart
  })

  // Day n spans [(n-1)/days, n/days] of the track.
  const pct = (day: number) => ((day - 1) / days) * 100
  const dayOf = (iso: string) => (iso < monthStart ? 1 : iso > monthEnd ? days + 1 : Number(iso.slice(8)))
  const ticks = [1, 8, 15, 22, 29].filter(d => d <= days)

  return (
    <Panel className="min-w-0">
      <PanelHead
        title="Timeline"
        right={
          <Stepper
            label={label}
            onPrev={() => onMonth(new Date(y, m - 1, 1))}
            onNext={() => onMonth(new Date(y, m + 1, 1))}
            prevLabel="Previous month"
            nextLabel="Next month"
            className="!bg-[#F4F1EA] !shadow-none"
          />
        }
      />
      {rows.length === 0 ? (
        <Note className="!py-6">No project runs during {label}.</Note>
      ) : (
        <div className="px-3 pb-2.5 pt-1">
          {/* Day scale, aligned with the bar tracks */}
          <div className="grid grid-cols-1 sm:grid-cols-[8.5rem_minmax(0,1fr)] gap-x-3">
            <span className="hidden sm:block" />
            <div className="relative h-5 text-[10.5px] text-slate-400 tabular-nums">
              {ticks.map(d => (
                <span key={d} className="absolute top-1 -translate-x-1/2 first:translate-x-0" style={{ left: `${pct(d)}%` }}>{d}</span>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            {rows.map((p, i) => {
              const color = BAR_COLORS[i % BAR_COLORS.length]
              const s = p.start_date || p.end_date!
              const e = p.end_date || p.start_date!
              const startDay = dayOf(s)
              const endDay = Math.min(dayOf(e), days)
              const left = pct(startDay)
              const width = Math.max(pct(endDay + 1) - left, 100 / days)
              const dots = p.subtasks.filter(st => st.due_date && st.due_date >= monthStart && st.due_date <= monthEnd)
              return (
                <button
                  key={p.id}
                  onClick={() => onOpen(p.id)}
                  className="w-full grid grid-cols-1 sm:grid-cols-[8.5rem_minmax(0,1fr)] items-center gap-x-3 gap-y-1 py-1 rounded-[8px] text-left hover:bg-[#FAF7F0] transition-colors"
                >
                  <span className="flex items-center gap-1.5 min-w-0">
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: color }} />
                    <span className="text-[12.5px] font-medium text-slate-800 leading-snug break-words min-w-0">{p.title}</span>
                  </span>
                  <span className="relative block h-5 rounded-full bg-[#F4F1EA]">
                    {todayDay && <span className="absolute -top-0.5 -bottom-0.5 w-px bg-rose-400/70" style={{ left: `${pct(todayDay) + 50 / days}%` }} aria-hidden />}
                    <span
                      className="absolute inset-y-[3px] rounded-full"
                      style={{ left: `${left}%`, width: `${width}%`, background: `${color}40`, boxShadow: `inset 0 0 0 1px ${color}66` }}
                    />
                    {dots.map(st => (
                      <span
                        key={st.id}
                        className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2.5 h-2.5 rounded-full ring-2 ring-white ${STATUS_DOT_COLORS[st.status] ?? 'bg-slate-400'}`}
                        style={{ left: `${pct(Number(st.due_date!.slice(8))) + 50 / days}%` }}
                        title={`${st.title}, due ${shortDate(st.due_date)}`}
                      />
                    ))}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </Panel>
  )
}
