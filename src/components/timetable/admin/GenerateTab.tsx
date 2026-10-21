'use client'

import React, { useState, useEffect, useMemo } from 'react'
import {
  Sparkles, Loader2, Save, Send, Undo2, Trash2, AlertTriangle, CheckCircle2, Download,
  GraduationCap, UserCog, ShieldQuestion, Wand2, X, ChevronDown, ChevronUp,
} from 'lucide-react'
import {
  createTimetable, replaceEntries, publishTimetable, unpublishTimetable, updateTimetableMeta,
} from '@/lib/timetable'
import type {
  TimetableEntry, Timetable, TimetableStatus, ScheduleWeek, Weekday,
} from '@/lib/timetable'
import { solveTimetable } from '@/lib/timetable/solve'
import type { SolveProgress } from '@/lib/timetable/solve'
import { teacherIdsOf } from '@/lib/timetable'
import { computeHealth } from '@/lib/timetable/health'
import HealthPanel from '../HealthPanel'
import EditableTimetableGrid from '../EditableTimetableGrid'
import MasterTimetableEditor from '../MasterTimetableEditor'
import TeacherWeekView from '../TeacherWeekView'
import LessonStatsCard from '../LessonStatsCard'
import {
  proveFeasible, improveWeek, entriesFromResult, conflictGroups, describeConflictRule,
} from '@/lib/timetable/solverClient'
import type { SolverResult } from '@/lib/timetable/solverClient'
import { useTimetableDraft } from '../draft/TimetableDraftContext'
import { OverloadedTeachersNotice } from '../draft/TeacherLoad'
import {
  BTN_PRIMARY, BTN_NEUTRAL, BTN_GO, BTN_SM, SM_QUIET, SM_DANGER, SM_GHOST, SmartSelect, INPUT, ICON_BTN,
  Notice, Chip, Loading, askConfirm,
} from '../ui'
import type { SmartOption } from '../ui'

export type View = 'class' | 'teacher' | 'master'

/** What the workspace deck above the grid is given to show. */
export interface DeckProps {
  /** Draft or live, beside the timetable picker. */
  status?: React.ReactNode
  /** Generate · Save draft · Publish / Unpublish. */
  actions?: React.ReactNode
  /** One line per editor tile: what it holds. */
  counts?: Partial<Record<'config' | 'homeroom' | 'teacher' | 'subjects', string>>
}

export default function GenerateTab({ view, onViewChange, renderDeck, viewSwitch, onPublishedChange }: {
  view: View
  onViewChange: (v: View) => void
  renderDeck: (p: DeckProps) => React.ReactNode
  /** Whole school · By class · By teacher, drawn right above the grid. */
  viewSwitch?: React.ReactNode
  /** Called after a publish or unpublish, so the timetable list can refresh. */
  onPublishedChange?: () => void
}) {
  const draft = useTimetableDraft()
  const {
    config, loading, slots, requirements, unavailability, constraints, combinedInput,
    slotGroups, slotGroupIds, weeks, weekFor, rooms, subjects, teachers, scheduledHomerooms,
    homeroomsLite, entries, setEntries, timetable, setTimetable, slotClash, overloaded,
    liveConflicts, allConflicts, overrideToday, moveEntry,
  } = draft

  const [selectedHomeroomId, setSelectedHomeroomId] = useState<string>('')
  const [selectedTeacherId, setSelectedTeacherId] = useState<string>('')
  const [timetableName, setTimetableName] = useState<string>('')
  const [toolsOpen, setToolsOpen] = useState(false)

  const [generating, setGenerating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [unplaced, setUnplaced] = useState<number | null>(null)
  const [toast, setToast] = useState<string>('')
  const [progress, setProgress] = useState<SolveProgress | null>(null)
  const [lastRun, setLastRun] = useState<string>('')

  // The constraint solver, which answers the two questions a search cannot:
  // is this possible at all, and how much better can this week be.
  const [proving, setProving] = useState(false)
  const [improving, setImproving] = useState(false)
  const [proof, setProof] = useState<SolverResult | null>(null)
  const [solverError, setSolverError] = useState('')

  useEffect(() => {
    setTimetableName(timetable?.name ?? config.name)
  }, [timetable, config.name])

  useEffect(() => {
    if (scheduledHomerooms.length > 0 && !scheduledHomerooms.some((h) => h.id === selectedHomeroomId)) {
      setSelectedHomeroomId(scheduledHomerooms[0].id)
    }
  }, [scheduledHomerooms, selectedHomeroomId])

  // Teachers that actually appear in the draft or in a requirement — a staff
  // list of 200 is unusable as a picker when 30 of them teach.
  const scheduledTeachers = useMemo(() => {
    const ids = new Set<string>()
    for (const e of entries) for (const t of teacherIdsOf(e)) ids.add(t)
    for (const r of requirements) for (const t of teacherIdsOf(r)) ids.add(t)
    return teachers.filter((t) => ids.has(t.id))
  }, [entries, requirements, teachers])

  useEffect(() => {
    if (scheduledTeachers.length > 0 && !scheduledTeachers.some((t) => t.id === selectedTeacherId)) {
      setSelectedTeacherId(scheduledTeachers[0].id)
    }
  }, [scheduledTeachers, selectedTeacherId])

  const health = useMemo(() => {
    const hrName = new Map(draft.homerooms.map((h) => [h.id, h.name]))
    const tName = new Map(teachers.map((t) => [t.id, t.full_name]))
    const sName = new Map(subjects.map((s) => [s.id, s.name]))
    return computeHealth({
      entries, requirements, constraints, slots, config, homerooms: homeroomsLite, unavailability,
      slotGroups, homeroomGroupIds: slotGroupIds, combined: combinedInput,
      conflicts: allConflicts,
      homeroomName: (id) => hrName.get(id) ?? 'Class',
      teacherName: (id) => tName.get(id) ?? 'Teacher',
      subjectName: (id) => sName.get(id) ?? 'Subject',
    })
  }, [entries, requirements, constraints, slots, config, homeroomsLite, unavailability, slotGroups, slotGroupIds, combinedInput, allConflicts, draft.homerooms, teachers, subjects])

  const homeroomOptions: SmartOption[] = useMemo(
    () => scheduledHomerooms.map((h) => ({ value: h.id, label: h.name })),
    [scheduledHomerooms],
  )
  const teacherOptions: SmartOption[] = useMemo(
    () => scheduledTeachers.map((t) => ({ value: t.id, label: t.full_name, sublabel: t.email ?? undefined })),
    [scheduledTeachers],
  )

  // The master view's grids: the classes of each period group against that
  // group's own week. With no period groups this is a single section and the
  // view looks exactly as it always did.
  const masterSections = useMemo(
    () =>
      weeks
        .map((week) => ({
          week,
          homerooms: scheduledHomerooms.filter((h) => (slotGroupIds[h.id] ?? null) === week.groupId),
        }))
        .filter((sec) => sec.homerooms.length > 0 && sec.week.slots.length > 0),
    [weeks, scheduledHomerooms, slotGroupIds],
  )


  const flash = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(''), 3000)
  }

  // Clicking a class on the master grid is a request to look at that class on
  // its own — 34 rows of 66 cells is for spotting a problem, not for reading one
  // class's week, so the name jumps to the view that is.
  const openClass = (homeroomId: string) => {
    setSelectedHomeroomId(homeroomId)
    onViewChange('class')
  }

  const handleGenerate = async () => {
    setGenerating(true)
    setProgress(null)
    setLastRun('')
    const locked = entries.filter((e) => e.isLocked)
    const result = await solveTimetable(
      {
        config,
        slots,
        slotGroups,
        homeroomGroupIds: slotGroupIds,
        requirements,
        unavailability,
        constraints,
        homerooms: homeroomsLite,
        combined: combinedInput,
        rooms,
        locked,
        seed: Math.floor(Math.random() * 1_000_000),
      },
      { onProgress: setProgress },
    )
    setEntries(result.entries)
    setUnplaced(result.unplacedCount)
    setGenerating(false)
    setProgress(null)

    // What the run actually spent, so a search cut short by its budget is
    // visible rather than looking like the solver's best possible answer.
    const d = result.diagnostics
    setLastRun(
      `${(d.elapsedMs / 1000).toFixed(1)}s · ${d.restarts} attempts · ` +
      `${d.moves.toLocaleString()} improvements`,
    )
    flash(
      result.unplacedCount === 0
        ? 'Done. Every period is placed.'
        : `Done. ${result.unplacedCount} period${result.unplacedCount === 1 ? '' : 's'} could not be placed.`,
    )
  }

  const clearUnlocked = () => setEntries((prev) => prev.filter((e) => e.isLocked))

  /**
   * Empties the week, pins included.
   *
   * "Clear unpinned" deliberately spares the pins, which is what you want
   * nine times in ten — and useless the one time you want to start over, when
   * the pins are exactly what you are trying to get rid of. Pins are invisible
   * on an empty grid, so losing them silently would be worse than asking.
   */
  const clearAll = async () => {
    const pinned = entries.filter((e) => e.isLocked).length
    if (
      pinned > 0 &&
      !(await askConfirm({
        title: 'Clear the whole week?',
        body: `This also removes ${pinned} pinned period${pinned === 1 ? '' : 's'}. Nothing is saved until you press Save draft.`,
        confirmLabel: 'Clear all',
        tone: 'danger',
      }))
    ) return
    setEntries([])
    setUnplaced(null)
    flash('Week cleared.')
  }

  // ── Constraint solver ─────────────────────────────────────
  // The problem exactly as the in-browser solver is given it, so a proof is a
  // proof about the timetable the admin is actually asking for.
  const solverInput = () => ({
    config,
    slots,
    slotGroups,
    homeroomGroupIds: slotGroupIds,
    requirements,
    unavailability,
    constraints,
    homerooms: homeroomsLite,
    combined: combinedInput,
    rooms,
    locked: entries.filter((e) => e.isLocked),
  })

  const handleProve = async () => {
    setProving(true)
    setProof(null)
    setSolverError('')
    const outcome = await proveFeasible(solverInput())
    if (!outcome.ok) setSolverError(outcome.error)
    else {
      setProof(outcome.result)
      flash(
        outcome.result.status === 'feasible'
          ? 'A complete timetable is possible.'
          : outcome.result.status === 'impossible'
            ? 'These rules cannot all hold. The clashing rules are listed below.'
            : 'Ran out of time before it could decide.',
      )
    }
    setProving(false)
  }

  const handleImprove = async () => {
    if (entries.length === 0) {
      flash('Generate a week first. Tidy up works on the week on screen.')
      return
    }
    setImproving(true)
    setSolverError('')
    const before = Math.round(health.score)
    const outcome = await improveWeek(solverInput(), entries)
    if (!outcome.ok) {
      setSolverError(outcome.error)
      setImproving(false)
      return
    }
    const { result, payload } = outcome
    if (result.placements.length === 0) {
      // Not an error, and not a reason to touch the grid: the solver simply
      // did not come back with a week to apply. Which of those it was decides
      // whether there is anything the admin can do about it.
      flash(
        result.status === 'impossible'
          ? 'These rules no longer allow this week. Run "Check if possible".'
          : result.status === 'invalid'
            ? 'The solver could not read this timetable. Nothing changed.'
            : 'No better week found in the time available. Yours is unchanged.',
      )
      setImproving(false)
      return
    }
    const improved = entriesFromResult(
      payload, result, rooms,
      [...homeroomsLite.map((h) => h.id), ...requirements.map((r) => r.homeroom_id)],
    )
    // The guarantee this button is sold on, enforced here rather than trusted:
    // the solver holds completeness across its stages, but a bad payload or a
    // future change to it must not be able to quietly cost the week a lesson.
    if (improved.length < entries.length) {
      flash(
        `Skipped a result that would have lost ${entries.length - improved.length} ` +
        `period${entries.length - improved.length === 1 ? '' : 's'}. Yours is unchanged.`,
      )
      setImproving(false)
      return
    }
    // Pinned cells are given to the solver as fixed, so they come back where
    // they were; keeping the originals would double them up.
    setEntries(improved)
    setUnplaced(result.unplacedPeriods)
    flash(
      `Tidied. ${result.unplacedPeriods} unplaced, health was ${before}.` +
      (result.overCapPeriods > 0 ? ` ${result.overCapPeriods} over a per-day cap.` : ''),
    )
    setImproving(false)
  }

  const conflictNames = useMemo(() => ({
    homeroom: (id: string) => draft.homerooms.find((h) => h.id === id)?.name ?? 'a class',
    teacher: (id: string) => teachers.find((t) => t.id === id)?.full_name ?? 'a teacher',
    subject: (id: string) => subjects.find((s) => s.id === id)?.name ?? 'a subject',
    combinedSubject: (id: string) => {
      const c = draft.combinedClasses.find((x) => x.id === id)
      return c?.subject_id ? subjects.find((s) => s.id === c.subject_id)?.name : undefined
    },
    requirement: (id: string) => {
      const r = requirements.find((x) => x.id === id)
      if (!r) return undefined
      const hr = draft.homerooms.find((h) => h.id === r.homeroom_id)?.name ?? 'a class'
      const sub = subjects.find((s) => s.id === r.subject_id)?.name ?? 'a subject'
      return `${sub} for ${hr}`
    },
  }), [draft.homerooms, draft.combinedClasses, teachers, subjects, requirements])

  // ── Persistence ───────────────────────────────────────────
  const resolvedName = () => timetableName.trim() || config.name

  const ensureTimetable = async (): Promise<Timetable | null> => {
    if (timetable) {
      if (timetable.name !== resolvedName()) {
        await updateTimetableMeta(timetable.id, { name: resolvedName() })
      }
      return timetable
    }
    const created = await createTimetable({
      config_id: config.id,
      name: resolvedName(),
      status: 'draft',
    })
    if (created) setTimetable(created)
    return created
  }

  /**
   * Saving an empty week over a saved one wipes it, and a blank grid is much
   * more often a draft that hasn't been generated yet than a week the admin
   * means to erase. The save is destructive by design, so this is the one
   * shape of it worth asking about.
   */
  const emptyOverwriteRefused = async () =>
    entries.length === 0 &&
    timetable !== null &&
    !(await askConfirm({
      title: 'Save an empty week?',
      body: `This draft has no lessons. Saving erases every period stored for "${timetable.name}".`,
      confirmLabel: 'Save anyway',
      tone: 'danger',
    }))

  const handleSave = async () => {
    if (await emptyOverwriteRefused()) return
    setSaving(true)
    const tt = await ensureTimetable()
    if (!tt) {
      flash('Could not create the timetable. Nothing was saved.')
      setSaving(false)
      return
    }
    const written = await replaceEntries(tt.id, entries)
    flash(
      written === null
        ? 'Could not save. Nothing was changed.'
        : `Draft saved. ${written} period${written === 1 ? '' : 's'} stored.`,
    )
    setSaving(false)
  }

  const handlePublish = async () => {
    if (
      liveConflicts.length > 0 &&
      !(await askConfirm({
        title: 'Publish with clashes?',
        body: `${liveConflicts.length} clash${liveConflicts.length === 1 ? ' is' : 'es are'} still on the grid. Students and staff will see the week as it is.`,
        confirmLabel: 'Publish anyway',
      }))
    ) return
    if (await emptyOverwriteRefused()) return
    setPublishing(true)
    const tt = await ensureTimetable()
    if (!tt) {
      flash('Could not create the timetable. Nothing was published.')
      setPublishing(false)
      return
    }
    // null, not falsy: an empty week is a legitimate save, zero rows and all.
    if ((await replaceEntries(tt.id, entries)) === null) {
      flash('Could not save, so nothing was published.')
      setPublishing(false)
      return
    }
    const ok = await publishTimetable(tt)
    if (ok) {
      // Update status locally so the grid stays visible (no full reload/spinner).
      setTimetable((prev) =>
        prev ? { ...prev, status: 'published' as TimetableStatus, published_at: new Date().toISOString() } : prev,
      )
      flash('Published. Students and staff can see it now.')
      onPublishedChange?.()
    } else {
      flash('Could not publish.')
    }
    setPublishing(false)
  }

  const handleUnpublish = async () => {
    if (!timetable) return
    if (!(await askConfirm({
      title: 'Unpublish this timetable?',
      body: 'Students and staff stop seeing it. Its periods are kept as a draft, and you can publish it again at any time.',
      confirmLabel: 'Unpublish',
    }))) return
    setPublishing(true)
    const ok = await unpublishTimetable(timetable)
    if (ok) {
      setTimetable((prev) => (prev ? { ...prev, status: 'draft' as TimetableStatus } : prev))
      flash('Unpublished. Only admins can see it now.')
      onPublishedChange?.()
    } else {
      flash('Could not unpublish.')
    }
    setPublishing(false)
  }

  // Export the selected class's current grid to Excel, materialising the
  // in-memory placements into joined entries the exporter understands.
  // The spreadsheet writer is loaded when an export is asked for, not with the page.
  const handleExport = async () => {
    const { exportTimetableToExcel } = await import('@/lib/timetable/export')
    const subjectById = new Map(subjects.map((s) => [s.id, s]))
    const teacherById = new Map(teachers.map((t) => [t.id, t]))
    const roomById = new Map(rooms.map((r) => [r.id, r]))
    const week = weekFor(selectedHomeroomId)
    const exportEntries = entries
      .filter((e) => e.homeroomId === selectedHomeroomId)
      .map((e) => ({
        id: '', timetable_id: '', homeroom_id: e.homeroomId, day: e.day, slot_id: e.slotId,
        subject_id: e.subjectId, teacher_id: e.teacherId, teacher_ids: teacherIdsOf(e),
        room_id: e.roomId, is_locked: e.isLocked,
        teacher_name: e.teacherId ? teacherById.get(e.teacherId)?.full_name ?? null : null,
        teacher_names: teacherIdsOf(e)
          .map((id) => teacherById.get(id)?.full_name)
          .filter((n): n is string => !!n),
        created_at: '', updated_at: '',
        subject: e.subjectId ? subjectById.get(e.subjectId) : undefined,
        teacher: e.teacherId ? teacherById.get(e.teacherId) ?? undefined : undefined,
        room: e.roomId ? roomById.get(e.roomId) : undefined,
      })) as TimetableEntry[]
    const className = scheduledHomerooms.find((h) => h.id === selectedHomeroomId)?.name ?? 'class'
    exportTimetableToExcel({
      fileName: `${className.replace(/\s+/g, '-').toLowerCase()}-timetable.xlsx`,
      sheetName: className,
      days: week.days,
      slots: week.slots,
      entries: exportEntries,
      secondary: (e) => e.teacher?.full_name ?? null,
    })
  }

  // What each editor tile holds, so the deck says where the week stands.
  const teachingPeriods = weeks.reduce((n, w) => Math.max(n, w.slots.length), 0)
  const counts: DeckProps['counts'] = {
    config: weeks.length > 1
      ? `${weeks.length} period groups`
      : `${teachingPeriods} period${teachingPeriods === 1 ? '' : 's'} · ${config.working_days.length} days`,
    homeroom: `${scheduledHomerooms.length} of ${draft.homerooms.length} with lessons`,
    teacher: `${scheduledTeachers.length} teaching`,
    subjects: `${subjects.length} subject${subjects.length === 1 ? '' : 's'} · ${rooms.length} room${rooms.length === 1 ? '' : 's'}`,
  }

  if (loading) {
    return (
      <div className="space-y-4">
        {renderDeck({})}
        <Loading />
      </div>
    )
  }

  if (requirements.length === 0 || !weeks.some((w) => w.slots.length > 0)) {
    return (
      <div className="space-y-4">
        {renderDeck({ counts })}
        <div className="fx-card fx-bleed px-4 py-12 text-center">
          <p className="text-[14px] font-semibold text-slate-800">Nothing to generate yet</p>
          <p className="mt-1 mx-auto max-w-md text-[12.5px] leading-relaxed text-slate-500">
            Add the periods of the day in Configuration and each class&rsquo;s lessons in Classes.
            Then generate the week here.
          </p>
        </div>
      </div>
    )
  }

  // Visible to students and staff only when the week is published and its
  // config is switched on — publishing does both, unpublishing undoes both.
  const isPublished = timetable?.status === 'published' && config.is_active
  const selectedWeek: ScheduleWeek = weekFor(selectedHomeroomId)
  // The class grid still draws break rows, which the schedule week leaves out.
  const selectedWeekSlots = slots
    .filter((s) => (s.group_id ?? null) === selectedWeek.groupId)
    .sort((a, b) => a.position - b.position)

  // Bands that hold classes but have no periods yet. An empty grid reads as a
  // solver failure, so it is said plainly instead.
  const emptyBands = weeks.filter(
    (w) => w.slots.length === 0 && scheduledHomerooms.some((h) => (slotGroupIds[h.id] ?? null) === w.groupId),
  )

  const hasOverride = (homeroomId: string, day: Weekday, slotId: string) =>
    overrideToday(homeroomId, day, slotId, null) !== null

  const busy = generating || saving || publishing

  const actions = (
    <>
      {generating ? (
        /* No stop button: a pass is a few seconds and the search settles on
           its own, so all there is to show is how far through it is. */
        <div
          role="status"
          aria-live="polite"
          className="relative overflow-hidden flex-1 sm:flex-none sm:w-40 inline-flex items-center justify-center gap-1.5 h-10 sm:h-8 px-3.5 rounded-full bg-gradient-to-b from-[#3D3B40] to-[#27272A] text-white text-[13px] sm:text-[12.5px] font-semibold"
        >
          <span
            aria-hidden
            className="absolute inset-y-0 left-0 bg-[#B8983C]/40 transition-[width] duration-700 ease-out motion-reduce:transition-none"
            style={{ width: `${progress ? (progress.pass / progress.maxPasses) * 100 : 6}%` }}
          />
          <Loader2 className="animate-spin relative flex-shrink-0" size={14} />
          <span className="relative tabular-nums">
            {progress ? `Searching ${(progress.elapsedMs / 1000).toFixed(0)}s` : 'Starting…'}
          </span>
        </div>
      ) : (
        <button onClick={handleGenerate} disabled={busy} className={`${BTN_PRIMARY} flex-1 sm:flex-none sm:min-w-[8.5rem]`}>
          <Sparkles size={14} className="text-[#E9DDBB]" />
          {entries.some((e) => e.isLocked) ? 'Regenerate' : 'Generate'}
        </button>
      )}
      <button onClick={handleSave} disabled={busy} className={`${BTN_NEUTRAL} flex-1 sm:flex-none`}>
        {saving ? <Loader2 className="animate-spin" size={14} /> : <Save size={14} />}
        {/* Saving a published week updates what people see straight away. */}
        {isPublished ? 'Save' : 'Save draft'}
      </button>
      {isPublished ? (
        <button
          onClick={handleUnpublish}
          disabled={busy}
          className={`${BTN_NEUTRAL} flex-1 sm:flex-none`}
          title="Hide this timetable from students and staff"
        >
          {publishing ? <Loader2 className="animate-spin" size={14} /> : <Undo2 size={14} />}
          Unpublish
        </button>
      ) : (
        <button onClick={handlePublish} disabled={busy} className={`${BTN_GO} flex-1 sm:flex-none`}>
          {publishing ? <Loader2 className="animate-spin" size={14} /> : <Send size={14} />}
          Publish
        </button>
      )}
    </>
  )

  const status = isPublished
    ? <Chip tone="good" title="Students and staff see this timetable"><CheckCircle2 size={11} /> Published</Chip>
    : <Chip tone="neutral" title="Only admins see this until it is published">Not published</Chip>

  return (
    <div className="space-y-3 sm:space-y-4">
      {renderDeck({ status, actions, counts })}

      {/* ── Tools ─────────────────────────────────────────────
          The name, the solver's two questions and the housekeeping, with the
          week's status at the end of the row. Quieter than the deck: these
          answer questions about the week rather than build it. On a phone
          they fold behind "More" so the grid is not pushed off the screen. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div role="status" aria-live="polite" className="order-first lg:order-last flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-[12px] tabular-nums flex-1 min-w-0 lg:flex-none lg:ml-auto lg:justify-end">
          {liveConflicts.length > 0 ? (
            <Chip tone="bad"><AlertTriangle size={11} /> {liveConflicts.length} clash{liveConflicts.length === 1 ? '' : 'es'}</Chip>
          ) : (
            <Chip tone="good"><CheckCircle2 size={11} /> No clashes</Chip>
          )}
          {unplaced != null && unplaced > 0 && (
            <Chip tone="gold"><AlertTriangle size={11} /> {unplaced} unplaced</Chip>
          )}
          {progress ? (
            <span className="text-slate-500">
              Best so far: {progress.bestUnplaced === 0 ? 'all placed' : `${progress.bestUnplaced} unplaced`}
            </span>
          ) : lastRun ? (
            <span className="text-slate-400">{lastRun}</span>
          ) : null}
          {toast && <span className="text-slate-900 font-medium break-words min-w-0">{toast}</span>}
        </div>
        <button
          onClick={() => setToolsOpen((o) => !o)}
          aria-expanded={toolsOpen}
          className={`sm:hidden order-first ${BTN_SM} ${SM_GHOST}`}
        >
          {toolsOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />} {toolsOpen ? 'Less' : 'More'}
        </button>
        <label className={`${toolsOpen ? 'flex' : 'hidden'} sm:flex items-center gap-2 min-w-0 basis-full sm:basis-[240px] sm:flex-1 lg:max-w-sm`}>
          <span className="text-[12px] font-semibold text-slate-500 flex-shrink-0">Name</span>
          <input
            className={INPUT}
            placeholder={`${config.name} term 1`}
            aria-label="Timetable name"
            value={timetableName}
            onChange={(e) => setTimetableName(e.target.value)}
          />
        </label>
        <div className={`${toolsOpen ? 'flex' : 'hidden'} sm:flex flex-wrap items-center gap-0.5 -mx-1`}>
          <button
            onClick={handleProve}
            disabled={proving || improving}
            className={`${BTN_SM} ${SM_QUIET}`}
            title="Checks whether every required period can be placed, and names the rules that collide if not"
          >
            {proving ? <Loader2 className="animate-spin" size={13} /> : <ShieldQuestion size={13} />}
            {proving ? 'Checking…' : 'Check if possible'}
          </button>
          <button
            onClick={handleImprove}
            disabled={improving || proving || entries.length === 0}
            className={`${BTN_SM} ${SM_QUIET}`}
            title="Rearranges this week for a better spread without losing a lesson"
          >
            {improving ? <Loader2 className="animate-spin" size={13} /> : <Wand2 size={13} />}
            {improving ? 'Tidying…' : 'Tidy up'}
          </button>
          <button
            onClick={clearUnlocked}
            disabled={entries.length === 0}
            className={`${BTN_SM} ${SM_DANGER}`}
            title="Empties every period that is not pinned"
          >
            <Trash2 size={13} /> Clear unpinned
          </button>
          <button
            onClick={clearAll}
            disabled={entries.length === 0}
            className={`${BTN_SM} ${SM_DANGER}`}
            title="Empties the whole week, pinned periods included"
          >
            <Trash2 size={13} /> Clear all
          </button>
          {view === 'class' && (
            <button onClick={handleExport} className={`${BTN_SM} ${SM_QUIET}`}>
              <Download size={13} /> Export class
            </button>
          )}
        </div>
      </div>

      {/* Assignments no timetable can satisfy, before anything is generated. */}
      {overloaded.length > 0 && (
        <OverloadedTeachersNotice
          overloaded={overloaded}
          teacherName={(id) => teachers.find((t) => t.id === id)?.full_name ?? 'Teacher'}
        />
      )}

      {solverError && <Notice tone="warn">{solverError}</Notice>}

      {/* What the solver found. Kept apart from the health score: health is a
          judgement about a week, this is a fact about the rules. */}
      {proof && (
        <div className="fx-card min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pl-3.5 pr-1.5 py-1.5 border-b border-[#EEEAE1]">
            <span className="text-[13px] font-semibold text-slate-900">
              {proof.status === 'feasible' ? 'Possible' : proof.status === 'impossible' ? 'Not possible' : 'Undecided'}
            </span>
            <span className="text-[11.5px] text-slate-400 tabular-nums">
              {(proof.wallTimeMs / 1000).toFixed(1)}s · {proof.variables.toLocaleString()} variables
            </span>
            <button onClick={() => setProof(null)} aria-label="Dismiss" className={`ml-auto ${ICON_BTN}`}>
              <X size={14} />
            </button>
          </div>
          {proof.status === 'feasible' ? (
            <p className="px-3.5 py-2.5 text-[12.5px] leading-relaxed text-[#1F6B42] flex items-start gap-2">
              <CheckCircle2 size={14} className="flex-shrink-0 mt-0.5" />
              <span>
                Every required period can be placed. If Generate still leaves some out, run it
                again or use Tidy up.
              </span>
            </p>
          ) : proof.status === 'impossible' ? (
            <div className="px-3.5 py-2.5 space-y-2.5">
              <p className="text-[12.5px] text-slate-600">
                Each group below clashes on its own. Relaxing any one rule in a group fixes it.
              </p>
              {conflictGroups(proof.conflicts).map((group, i) => (
                <div key={i} className="border-l-[3px] border-[#C24141] pl-2.5">
                  <p className="text-[12px] font-semibold text-[#962C2C]">Clash {i + 1}</p>
                  <ul className="mt-0.5 space-y-0.5">
                    {group.map((c) => (
                      <li key={c.tag} className="text-[12.5px] text-slate-800 leading-snug break-words">
                        {describeConflictRule(c, conflictNames)}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              {proof.conflictsTruncated && (
                <p className="text-[12px] text-slate-500">
                  Stopped at its time limit, so there may be more. Fix these and check again.
                </p>
              )}
            </div>
          ) : (
            <p className="px-3.5 py-2.5 text-[12.5px] text-slate-500">
              Ran out of time before it could decide either way.
            </p>
          )}
        </div>
      )}

      <HealthPanel report={health} />

      {viewSwitch && <div className="flex justify-center sm:justify-start">{viewSwitch}</div>}

      {/* ── The grid ──────────────────────────────────────────
          The subject of the page: a square sheet, edge to edge on a phone. */}
      <section className="fx-card fx-bleed min-w-0">
        {view !== 'master' && (
          <div className="flex flex-wrap items-center gap-2 px-2.5 sm:px-3 py-2.5 border-b border-[#EEEAE1]">
            {view === 'class' ? (
              <div className="flex-1 min-w-0 basis-[220px] sm:max-w-sm">
                <SmartSelect
                  options={homeroomOptions}
                  value={selectedHomeroomId}
                  onChange={setSelectedHomeroomId}
                  placeholder="Choose a class"
                  searchPlaceholder="Search classes…"
                  leadingIcon={<GraduationCap size={14} className="text-slate-400 flex-shrink-0" />}
                />
              </div>
            ) : (
              <div className="flex-1 min-w-0 basis-[220px] sm:max-w-sm">
                <SmartSelect
                  options={teacherOptions}
                  value={selectedTeacherId}
                  onChange={setSelectedTeacherId}
                  placeholder="Choose a teacher"
                  searchPlaceholder="Search staff…"
                  leadingIcon={<UserCog size={14} className="text-slate-400 flex-shrink-0" />}
                />
              </div>
            )}
            {view === 'class' && weeks.length > 1 && <Chip tone="neutral">{selectedWeek.name}</Chip>}

          </div>
        )}

        <div className="p-2 sm:p-3 space-y-2">
          {emptyBands.map((w) => (
            <Notice key={w.groupId ?? 'base'} tone="warn">
              <strong>{w.name}</strong> has classes but no periods, so nothing can be scheduled
              for them. Add its periods in Configuration.
            </Notice>
          ))}

          {view === 'class' ? (
            selectedHomeroomId && (
              <>
                <EditableTimetableGrid
                  days={selectedWeek.days}
                  slots={selectedWeekSlots}
                  homeroomId={selectedHomeroomId}
                  homeroomName={scheduledHomerooms.find((h) => h.id === selectedHomeroomId)?.name ?? 'Class'}
                  entries={entries}
                  unavailability={unavailability}
                  subjects={subjects}
                  teachers={teachers}
                  rooms={rooms}
                  constraints={constraints}
                  homerooms={homeroomsLite}
                  slotClash={slotClash}
                  hasOverride={hasOverride}
                  onMove={moveEntry}
                />
                <LessonStatsCard dimension="class" id={selectedHomeroomId} />
              </>
            )
          ) : view === 'teacher' ? (
            <TeacherWeekView teacherId={selectedTeacherId} />
          ) : masterSections.length === 0 ? (
            <p className="py-10 text-center text-[13px] text-slate-500">No classes have lessons yet.</p>
          ) : (
            /* One grid per period group. Two bells are two different sets of
               period rows and cannot share a grid, so a school running both
               gets both — each with its own fit, zoom and full screen. */
            <div className="space-y-4">
              {masterSections.map(({ week, homerooms }) => (
                <div key={week.groupId ?? 'base'} className="min-w-0">
                  {masterSections.length > 1 && (
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 mb-1.5 px-0.5">
                      <span className="text-[13px] font-semibold text-slate-900">{week.name}</span>
                      <span className="text-[11.5px] text-slate-400 tabular-nums">
                        {homerooms.length} classes · {week.days.length} days × {week.slots.length} periods
                      </span>
                    </div>
                  )}
                  <MasterTimetableEditor
                    days={week.days}
                    slots={week.slots}
                    homerooms={homerooms}
                    entries={entries}
                    subjects={subjects}
                    teachers={teachers}
                    rooms={rooms}
                    unavailability={unavailability}
                    constraints={constraints}
                    homeroomsLite={homeroomsLite}
                    slotClash={slotClash}
                    hasOverride={hasOverride}
                    onMove={moveEntry}
                    onOpenClass={openClass}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
