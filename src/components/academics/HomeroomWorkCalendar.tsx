'use client'

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { AnimatePresence } from 'framer-motion'
import {
  Plus, ChevronRight, Clock, Star, ShieldCheck, Send, BookOpen, Users, CalendarDays,
  FileText, ExternalLink,
} from 'lucide-react'
import { Homeroom, fetchClassroomsHoldingHomeroomStudents } from '@/lib/homerooms'
import { SmartboardTask, fetchHomeroomCalendarTasks } from '@/lib/smartboard'
import { Classroom } from '@/lib/classrooms'
import SmartboardHomeworkForm from '@/components/smartboard/SmartboardHomeworkForm'
import ModalShell from '@/components/ui/ModalShell'
import WorkWeekCalendar, {
  CalendarViewMode, WorkWeekCalendarSkeleton, BLEED_CARD_INSET,
  addDays, formatDate, getWeekStart, parseDate, themeFromGradient,
} from '@/components/calendar/WorkWeekCalendar'

/** Only the fields the picker and row labels need. */
type MappableClassroom = Pick<Classroom, 'id' | 'title'>

const NO_TASKS: SmartboardTask[] = []

/** How far either side of today the calendar loads in one go — roughly a full
 *  academic year of week-stepping before a refetch is needed. */
const WINDOW_DAYS = 180

interface HomeroomWorkCalendarProps {
  userId: string
  /** Homerooms this teacher is the class teacher of (never empty). */
  homerooms: Homeroom[]
  /** Hex colours from the admin-configured academics banner theme. */
  themeGradFrom?: string
  themeGradTo?: string
}

/**
 * The class teacher's side of the School Work Calendar: the homework their
 * homeroom students carry, laid out with the same week calendar the students
 * and classrooms see.
 *
 * Every homework is mapped onto a classroom — one of those holding at least one
 * homeroom student. That classroom decides both where the homework shows up
 * (its own Calendar tab) and who sees it: only students enrolled there.
 */
export default function HomeroomWorkCalendar({
  userId, homerooms,
  themeGradFrom = '#0891b2',
  themeGradTo   = '#0f766e',
}: HomeroomWorkCalendarProps) {
  const [activeHomeroomId, setActiveHomeroomId] = useState(homerooms[0]?.id ?? '')
  const [classrooms, setClassrooms] = useState<MappableClassroom[]>([])
  const [tasks, setTasks]   = useState<SmartboardTask[]>([])
  const [loading, setLoading] = useState(true)

  const [weekStart, setWeekStart]     = useState(() => getWeekStart(new Date()))
  const [selectedDay, setSelectedDay] = useState<Date | null>(null)
  const [viewMode, setViewMode]       = useState<CalendarViewMode>('daily')

  const [showForm, setShowForm]     = useState(false)
  const [newHwDate, setNewHwDate]   = useState('')
  const [editTask, setEditTask]     = useState<SmartboardTask | null>(null)
  const [detailTask, setDetailTask] = useState<SmartboardTask | null>(null)

  const activeHomeroom = homerooms.find(h => h.id === activeHomeroomId) ?? homerooms[0]

  // A homeroom disappearing (reassignment mid-session) shouldn't strand the view.
  useEffect(() => {
    if (homerooms.length > 0 && !homerooms.some(h => h.id === activeHomeroomId)) {
      setActiveHomeroomId(homerooms[0].id)
    }
  }, [homerooms, activeHomeroomId])

  // ── Data ───────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    if (!activeHomeroom) return
    setLoading(true)
    const mappable = await fetchClassroomsHoldingHomeroomStudents([activeHomeroom.id])
    const today = new Date()
    const data = await fetchHomeroomCalendarTasks(
      [activeHomeroom.id],
      mappable.map(c => c.id),
      formatDate(addDays(today, -WINDOW_DAYS)),
      formatDate(addDays(today, WINDOW_DAYS)),
    )
    setClassrooms(mappable)
    setTasks(data)
    setLoading(false)
  }, [activeHomeroom])

  useEffect(() => { load() }, [load])

  const classroomTitle = useMemo(
    () => new Map(classrooms.map(c => [c.id, c.title])),
    [classrooms],
  )

  // Bucket dated tasks by day so the calendar's per-day lookups are map reads.
  const tasksByDay = useMemo(() => {
    const map = new Map<string, SmartboardTask[]>()
    for (const task of tasks) {
      if (!task.due_date) continue
      const key = formatDate(parseDate(task.due_date))
      const bucket = map.get(key)
      if (bucket) bucket.push(task)
      else map.set(key, [task])
    }
    return map
  }, [tasks])

  const tasksForDay = useCallback(
    (day: Date) => tasksByDay.get(formatDate(day)) ?? NO_TASKS,
    [tasksByDay],
  )

  const undated = tasks.filter(t => !t.due_date)

  // ── Rows ───────────────────────────────────────────────────────────────────
  const scopeLabel = (task: SmartboardTask) => task.classroom_id
    ? classroomTitle.get(task.classroom_id) ?? 'Classroom'
    : `Whole homeroom · ${activeHomeroom?.name ?? ''}`

  /** The calendar also surfaces work subject teachers set in the classrooms
   *  these students attend. Those stay read-only here — a class teacher edits
   *  their own homework and anything set for the homeroom as a whole. */
  const canEdit = (task: SmartboardTask) =>
    task.created_by === userId || (!!activeHomeroom && task.homeroom_id === activeHomeroom.id)

  const openTask = (task: SmartboardTask) =>
    canEdit(task) ? setEditTask(task) : setDetailTask(task)

  const renderTask = (task: SmartboardTask, compact: boolean) => {
    if (compact) {
      return (
        <button
          onClick={() => openTask(task)}
          className="block w-full text-left text-[10px] p-1.5 rounded-lg border border-slate-200 bg-white transition-all hover:shadow-sm"
        >
          <p className="font-semibold leading-tight text-slate-800">{task.title}</p>
          <div className="flex items-center gap-1 mt-1 flex-wrap">
            <span className="inline-block px-1 py-0.5 rounded text-[8px] font-bold bg-purple-100 text-purple-700">HW</span>
            {task.edu_points > 0 && (
              <span className="inline-flex items-center gap-0.5 text-[9px] font-semibold text-amber-700">
                <Star size={8} /> {task.edu_points}
              </span>
            )}
          </div>
        </button>
      )
    }

    return (
      <div
        onClick={() => openTask(task)}
        className="flex items-start gap-3 px-3 sm:px-4 py-3 cursor-pointer hover:bg-slate-50 active:bg-slate-100 transition-colors"
      >
        <span className="self-stretch w-1 rounded-full bg-purple-400 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold leading-snug text-slate-800">{task.title}</p>
          {task.description && (
            <p className="text-xs text-slate-600 leading-snug line-clamp-2 mt-0.5">{task.description}</p>
          )}
          <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
            <span className="inline-block px-1.5 py-0.5 rounded text-[9px] font-bold bg-purple-100 text-purple-700">HOMEWORK</span>
            {task.timing && (
              <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-slate-600">
                <Clock size={10} /> {task.timing}
              </span>
            )}
            {task.edu_points > 0 && (
              <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-amber-700">
                <Star size={10} /> {task.edu_points} EP
              </span>
            )}
            {task.require_check && (
              <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-emerald-700">
                <ShieldCheck size={10} /> Verified
              </span>
            )}
            {task.requires_submission && (
              <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-indigo-700">
                <Send size={10} /> Submission
              </span>
            )}
            <span className="inline-flex items-center gap-0.5 text-[10px] text-slate-600 truncate max-w-[12rem]">
              <Users size={10} className="flex-shrink-0" /> {scopeLabel(task)}
            </span>
          </div>
        </div>
        <ChevronRight size={15} className="text-slate-400 flex-shrink-0 mt-1" />
      </div>
    )
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  if (!activeHomeroom) return null

  const theme = themeFromGradient(themeGradFrom, themeGradTo)
  const classroomHint = 'The homework appears in this classroom, and only its students see it on their calendars.'
  // Every homework is mapped to a classroom, so with none on offer (no homeroom
  // student is enrolled anywhere yet) there is nothing to create against.
  const canCreate = classrooms.length > 0

  const upsertTask = (task: SmartboardTask) =>
    setTasks(prev => prev.some(t => t.id === task.id)
      ? prev.map(t => t.id === task.id ? task : t)
      : [...prev, task])

  return (
    <div className="space-y-4">

      {/* Homeroom scope — only worth showing when the teacher owns several */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        {homerooms.length > 1 ? (
          <div className="flex items-center gap-1.5 flex-wrap min-w-0">
            {homerooms.map(h => {
              const on = h.id === activeHomeroom.id
              return (
                <button
                  key={h.id}
                  onClick={() => { setActiveHomeroomId(h.id); setSelectedDay(null) }}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all active:scale-95 ${
                    on ? 'text-white shadow-sm' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:text-slate-800'
                  }`}
                  style={on ? { background: `linear-gradient(to right, ${themeGradFrom}, ${themeGradTo})` } : undefined}
                >
                  {h.name}
                </button>
              )
            })}
          </div>
        ) : (
          <p className="text-xs text-slate-500 min-w-0 truncate">
            Homework for <span className="font-semibold text-slate-700">{activeHomeroom.name}</span>
          </p>
        )}
        <button
          onClick={() => { setNewHwDate(''); setShowForm(true) }}
          disabled={!canCreate}
          title={canCreate ? undefined : 'No classroom yet holds a student from this homeroom'}
          // keep-round: this stays a pill even where the page squares its
          // corners for staff (pro chrome) — see globals.css.
          className="keep-round flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-semibold text-white transition-all shadow-lg hover:brightness-95 active:scale-95 flex-shrink-0 disabled:opacity-40 disabled:shadow-none disabled:active:scale-100 disabled:cursor-not-allowed"
          style={{ background: themeGradFrom }}
        >
          <Plus size={13} /> New Homework
        </button>
      </div>

      {!loading && !canCreate && (
        <p className="text-xs text-slate-500 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 leading-relaxed">
          Homework is set against a classroom, and none could be found holding a student from{' '}
          <span className="font-semibold text-slate-700">{activeHomeroom.name}</span>. Check that
          its students are enrolled in their classrooms, and that your admin has applied the latest
          database update.
        </p>
      )}

      {loading ? (
        <WorkWeekCalendarSkeleton weekStart={weekStart} theme={theme} rootClassName={BLEED_CARD_INSET} />
      ) : (
        <>
          <WorkWeekCalendar<SmartboardTask>
            weekStart={weekStart}
            onWeekStartChange={setWeekStart}
            selectedDay={selectedDay}
            onSelectDay={setSelectedDay}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            itemsForDay={tasksForDay}
            itemKey={task => task.id}
            renderItem={renderTask}
            itemLabel={task => task.title}
            onAddForDay={canCreate ? day => { setNewHwDate(formatDate(day)); setShowForm(true) } : undefined}
            addNoun="homework"
            emptyDayLabel="No homework set for this day."
            theme={theme}
            rootClassName={BLEED_CARD_INSET}
          />

          {tasks.length === 0 && (
            <div className="-mx-4 sm:mx-0 bg-white border-y sm:border sm:rounded-2xl border-slate-200 p-10 text-center">
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-3" style={{ background: theme.primaryLight }}>
                <CalendarDays size={26} style={{ color: theme.primary }} />
              </div>
              <p className="text-slate-700 font-semibold text-sm mb-1">No homework yet</p>
              <p className="text-slate-600 text-xs">
                Add homework for {activeHomeroom.name} — map it to a classroom to reach just that group.
              </p>
            </div>
          )}

          {undated.length > 0 && (
            <div className="-mx-4 sm:mx-0 bg-white border-y sm:border sm:rounded-2xl border-slate-200 overflow-hidden">
              <div className="flex items-center gap-2 px-3 sm:px-4 py-3 border-b border-slate-100">
                <BookOpen size={13} className="text-slate-500" />
                <h3 className="text-sm font-semibold text-slate-700">No Due Date</h3>
                <span className="text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full ml-0.5">{undated.length}</span>
              </div>
              <div className="divide-y divide-slate-100">
                {undated.map(task => (
                  <React.Fragment key={task.id}>{renderTask(task, false)}</React.Fragment>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* New homework */}
      <AnimatePresence>
        {showForm && (
          <ModalShell onClose={() => { setShowForm(false); setNewHwDate('') }} bare>
            <SmartboardHomeworkForm
              createdBy={userId}
              homeroomId={activeHomeroom.id}
              classrooms={classrooms}
              requireClassroom
              classroomHint={classroomHint}
              defaultDueDate={newHwDate}
              onCancel={() => { setShowForm(false); setNewHwDate('') }}
              onCreated={task => { upsertTask(task); setShowForm(false); setNewHwDate('') }}
            />
          </ModalShell>
        )}
      </AnimatePresence>

      {/* Homework set elsewhere — read-only */}
      <AnimatePresence>
        {detailTask && (
          <ModalShell
            onClose={() => setDetailTask(null)}
            size="lg"
            title="Homework"
            subtitle={scopeLabel(detailTask)}
            icon={<BookOpen size={16} />}
            iconClassName="bg-purple-100 text-purple-600"
            bodyClassName="space-y-3"
          >
            <h2 className="text-lg font-bold leading-snug text-slate-800">{detailTask.title}</h2>
            {detailTask.description && (
              <p className="text-sm text-slate-600 leading-relaxed p-3.5 bg-slate-50 rounded-2xl">{detailTask.description}</p>
            )}
            <div className="flex items-center gap-2 flex-wrap">
              {detailTask.due_date && (
                <span className="text-xs font-semibold text-slate-700 bg-slate-100 px-2 py-0.5 rounded-lg">
                  Due {parseDate(detailTask.due_date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
                </span>
              )}
              {detailTask.timing && (
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-600">
                  <Clock size={11} /> {detailTask.timing}
                </span>
              )}
              {detailTask.edu_points > 0 && (
                <span className="inline-flex items-center gap-0.5 text-xs font-semibold text-amber-600 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
                  <Star size={10} /> {detailTask.edu_points} EP
                </span>
              )}
              {detailTask.require_check && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-medium flex items-center gap-1">
                  <ShieldCheck size={10} /> Needs verification
                </span>
              )}
              {detailTask.requires_submission && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 font-medium flex items-center gap-1">
                  <Send size={10} /> Submission required
                </span>
              )}
            </div>
            {detailTask.attachment_url && (
              <a
                href={detailTask.attachment_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-700 text-sm font-medium hover:bg-slate-100 transition-colors"
              >
                <FileText size={14} className="flex-shrink-0" />
                <span className="flex-1 truncate">{detailTask.attachment_name || 'Attachment'}</span>
                <ExternalLink size={12} className="flex-shrink-0" />
              </a>
            )}
            <p className="text-xs text-slate-500 leading-relaxed pt-1 border-t border-slate-100">
              Set by a teacher of this classroom — open the classroom to edit or track it.
            </p>
          </ModalShell>
        )}
      </AnimatePresence>

      {/* Edit homework */}
      <AnimatePresence>
        {editTask && (
          <ModalShell onClose={() => setEditTask(null)} size="lg" bare>
            <SmartboardHomeworkForm
              createdBy={userId}
              homeroomId={activeHomeroom.id}
              classrooms={classrooms}
              requireClassroom
              classroomHint={classroomHint}
              task={editTask}
              onCancel={() => setEditTask(null)}
              onUpdated={task => { upsertTask(task); setEditTask(null) }}
              onDeleted={id => { setTasks(prev => prev.filter(t => t.id !== id)); setEditTask(null) }}
            />
          </ModalShell>
        )}
      </AnimatePresence>
    </div>
  )
}
