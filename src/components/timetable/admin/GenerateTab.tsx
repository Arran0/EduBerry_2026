'use client'

import React, { useState, useEffect, useMemo } from 'react'
import {
  Sparkles, Loader2, Save, Send, Trash2, AlertTriangle, CheckCircle2, Download,
  GraduationCap, LayoutGrid, Rows3, UserCog, ShieldQuestion, Wand2, X,
} from 'lucide-react'
import {
  createTimetable, replaceEntries, publishTimetable, updateTimetableMeta,
} from '@/lib/timetable'
import type {
  TimetableEntry, Timetable, TimetableStatus, ScheduleWeek, Weekday,
} from '@/lib/timetable'
import { solveTimetable } from '@/lib/timetable/solve'
import type { SolveProgress } from '@/lib/timetable/solve'
import { teacherIdsOf } from '@/lib/timetable'
import { computeHealth } from '@/lib/timetable/health'
import { exportTimetableToExcel } from '@/lib/timetable/export'
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
  BTN_PRIMARY, BTN_NEUTRAL, BTN_GO, BTN_SM, SmartSelect, SECTION_LABEL, INPUT, TAP, FOCUS,
} from '../ui'
import type { SmartOption } from '../ui'

type View = 'class' | 'teacher' | 'master'

const VIEWS: { key: View; label: string; icon: typeof Rows3 }[] = [
  { key: 'class', label: 'By class', icon: Rows3 },
  { key: 'teacher', label: 'By teacher', icon: UserCog },
  { key: 'master', label: 'Master grid', icon: LayoutGrid },
]

export default function GenerateTab() {
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
  const [view, setView] = useState<View>('master')

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
    setView('class')
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
        ? 'Generated — every period placed.'
        : `Generated — ${result.unplacedCount} period(s) could not be placed.`,
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
  const clearAll = () => {
    const pinned = entries.filter((e) => e.isLocked).length
    if (
      pinned > 0 &&
      !confirm(
        `This clears the whole week, including ${pinned} pinned period${pinned === 1 ? '' : 's'}. ` +
        'Continue?',
      )
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
          ? 'Proved: a complete timetable is possible.'
          : outcome.result.status === 'impossible'
            ? 'Proved: these rules cannot all hold. See below.'
            : 'Ran out of time before it could decide.',
      )
    }
    setProving(false)
  }

  const handleImprove = async () => {
    if (entries.length === 0) {
      flash('Generate a week first — this tidies the one on screen.')
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
          ? 'These rules no longer allow this week — run "Can this be built?".'
          : result.status === 'invalid'
            ? 'The solver rejected the problem. Nothing changed.'
            : 'No tidier week found in the time available. Yours is unchanged.',
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
        `Discarded a tidier week that would have lost ${entries.length - improved.length} ` +
        'period(s). Yours is unchanged.',
      )
      setImproving(false)
      return
    }
    // Pinned cells are given to the solver as fixed, so they come back where
    // they were; keeping the originals would double them up.
    setEntries(improved)
    setUnplaced(result.unplacedPeriods)
    flash(
      `Tidied — ${result.unplacedPeriods} unplaced, was health ${before}.` +
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
  const emptyOverwriteRefused = () =>
    entries.length === 0 &&
    timetable !== null &&
    !confirm(
      'This draft has no lessons in it. Saving will erase every period stored for ' +
      `"${timetable.name}". Save anyway?`,
    )

  const handleSave = async () => {
    if (emptyOverwriteRefused()) return
    setSaving(true)
    const tt = await ensureTimetable()
    if (!tt) {
      flash('Could not create timetable record — check console.')
      setSaving(false)
      return
    }
    const written = await replaceEntries(tt.id, entries)
    flash(
      written === null
        ? 'Could not save — nothing was changed. Check console.'
        : `Draft saved — ${written} period(s) stored.`,
    )
    setSaving(false)
  }

  const handlePublish = async () => {
    if (liveConflicts.length > 0 && !confirm('There are unresolved conflicts. Publish anyway?')) return
    if (emptyOverwriteRefused()) return
    setPublishing(true)
    const tt = await ensureTimetable()
    if (!tt) {
      flash('Could not create timetable record — check console.')
      setPublishing(false)
      return
    }
    // null, not falsy: an empty week is a legitimate save, zero rows and all.
    if ((await replaceEntries(tt.id, entries)) === null) {
      flash('Could not save — nothing was changed, so nothing was published. Check console.')
      setPublishing(false)
      return
    }
    const ok = await publishTimetable(tt)
    if (ok) {
      // Update status locally so the grid stays visible (no full reload/spinner).
      setTimetable((prev) =>
        prev ? { ...prev, status: 'published' as TimetableStatus, published_at: new Date().toISOString() } : prev,
      )
      flash('Timetable published and activated — students and staff can now see it.')
    } else {
      flash('Could not publish.')
    }
    setPublishing(false)
  }

  // Export the selected class's current grid to Excel, materialising the
  // in-memory placements into joined entries the exporter understands.
  const handleExport = () => {
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

  if (loading) {
    return (
      <div className="flex justify-center py-16 text-[#A1A1AA]">
        <Loader2 className="animate-spin" size={22} />
      </div>
    )
  }

  if (requirements.length === 0 || !weeks.some((w) => w.slots.length > 0)) {
    return (
      <div className="py-12 text-center text-[#71717A] text-sm">
        Add teaching <strong>period slots</strong> (Configuration) and <strong>requirements</strong> before generating.
      </div>
    )
  }

  const isPublished = timetable?.status === 'published'
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

  return (
    <div className="space-y-3">
      {/* ── Controls ──────────────────────────────────────────
          Everything above the grid is kept to one compact block so the grid
          itself is what the page is about. Three buttons carry the workflow;
          the solver's two questions and the housekeeping actions sit in a
          quieter row beneath them. */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-stretch gap-1.5">
          {generating ? (
            /* No stop button: a pass is 2.5 seconds and the whole search
               settles on its own, so the only thing worth showing is how far
               through it is. A button whose only job is to abandon work the
               user just asked for is a button pressed by mistake. */
            <div
              role="status"
              aria-live="polite"
              className="relative overflow-hidden flex-1 min-w-[10rem] sm:flex-none sm:w-44 inline-flex items-center justify-center gap-1.5 bg-[#27272A] text-[#F5F5F5] px-3 min-h-[2.75rem] sm:min-h-0 sm:py-1.5 text-sm sm:text-[13px] font-medium"
            >
              <span
                aria-hidden
                className="absolute inset-y-0 left-0 bg-[#B8983C]/35 transition-[width] duration-700 ease-out motion-reduce:transition-none"
                style={{ width: `${progress ? (progress.pass / progress.maxPasses) * 100 : 6}%` }}
              />
              <Loader2 className="animate-spin relative flex-shrink-0" size={14} />
              <span className="relative truncate tabular-nums">
                {progress
                  ? `Searching · ${(progress.elapsedMs / 1000).toFixed(0)}s`
                  : 'Starting…'}
              </span>
            </div>
          ) : (
            <button
              onClick={handleGenerate}
              className={`${BTN_PRIMARY} flex-1 min-w-[10rem] sm:flex-none sm:w-44`}
            >
              <Sparkles size={14} className="text-[#B8983C]" />
              {entries.some((e) => e.isLocked) ? 'Regenerate' : 'Generate'}
            </button>
          )}
          <button onClick={handleSave} disabled={saving} className={`${BTN_NEUTRAL} flex-1 min-w-[8rem] sm:flex-none`}>
            {saving ? <Loader2 className="animate-spin" size={14} /> : <Save size={14} />}
            Save draft
          </button>
          <button onClick={handlePublish} disabled={publishing} className={`${BTN_GO} flex-1 min-w-[8rem] sm:flex-none`}>
            {publishing ? <Loader2 className="animate-spin" size={14} /> : <Send size={14} />}
            Publish
          </button>

          {/* Name + status, on the same line from lg up — it is one field and
              one word, and giving it its own row cost the grid a row of height. */}
          <div className="flex items-center gap-2 w-full lg:w-auto lg:flex-1 lg:min-w-[14rem]">
            <input
              className={`${INPUT} lg:flex-1`}
              placeholder={`Name — e.g. ${config.name} Term 1`}
              aria-label="Timetable name"
              value={timetableName}
              onChange={(e) => setTimetableName(e.target.value)}
            />
            {isPublished ? (
              <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-emerald-700 px-2 py-1 bg-emerald-50 border border-emerald-200 flex-shrink-0">
                <CheckCircle2 size={12} /> Live
              </span>
            ) : (
              <span className="text-[10px] font-bold uppercase tracking-widest text-[#71717A] px-2 py-1 bg-[#F5F5F5] border border-[#E4E4E7] flex-shrink-0">
                Draft
              </span>
            )}
          </div>
        </div>

        {/* Secondary actions. Quieter on purpose — these are answers to
            questions about the week, not steps in building one. */}
        <div className="flex flex-wrap items-center gap-x-1 gap-y-1 text-[#71717A]">
          <button
            onClick={handleProve}
            disabled={proving || improving}
            className={`${BTN_SM} text-[#52525B] hover:bg-[#F5F5F5] hover:text-[#18181B]`}
            title="Proves whether every required period can be placed, and names the rules that collide if not"
          >
            {proving ? <Loader2 className="animate-spin" size={12} /> : <ShieldQuestion size={12} />}
            {proving ? 'Checking…' : 'Can this be built?'}
          </button>
          <Sep />
          <button
            onClick={handleImprove}
            disabled={improving || proving || entries.length === 0}
            className={`${BTN_SM} text-[#52525B] hover:bg-[#F5F5F5] hover:text-[#18181B]`}
            title="Rearranges this week for a better spread without losing a lesson. Regenerate searches from scratch and can come back worse; this one never does."
          >
            {improving ? <Loader2 className="animate-spin" size={12} /> : <Wand2 size={12} />}
            {improving ? 'Tidying…' : 'Tidy up this week'}
          </button>
          <Sep />
          <button
            onClick={clearUnlocked}
            disabled={entries.length === 0}
            className={`${BTN_SM} text-[#52525B] hover:bg-rose-50 hover:text-rose-700`}
            title="Empties every period that is not pinned"
          >
            <Trash2 size={12} /> Clear unpinned
          </button>
          <Sep />
          <button
            onClick={clearAll}
            disabled={entries.length === 0}
            className={`${BTN_SM} text-[#52525B] hover:bg-rose-50 hover:text-rose-700`}
            title="Empties the whole week, pinned periods included"
          >
            <Trash2 size={12} /> Clear all
          </button>
          {view === 'class' && (
            <>
              <Sep />
              <button onClick={handleExport} className={`${BTN_SM} text-[#52525B] hover:bg-[#F5F5F5] hover:text-[#18181B]`}>
                <Download size={12} /> Export class
              </button>
            </>
          )}

          {/* Status, inline with the actions rather than on a row of its own. */}
          <span className="ml-auto flex items-center gap-x-3 gap-y-1 flex-wrap text-xs tabular-nums">
            {liveConflicts.length > 0 ? (
              <span className="inline-flex items-center gap-1 text-rose-600 font-semibold">
                <AlertTriangle size={13} /> {liveConflicts.length} conflict{liveConflicts.length === 1 ? '' : 's'}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-emerald-600 font-medium">
                <CheckCircle2 size={13} /> No conflicts
              </span>
            )}
            {unplaced != null && unplaced > 0 && (
              <span className="inline-flex items-center gap-1 text-amber-600 font-semibold">
                <AlertTriangle size={13} /> {unplaced} unplaced
              </span>
            )}
            {progress ? (
              <span className="text-[#71717A]">
                best so far{' '}
                {progress.bestUnplaced === 0 ? 'all placed' : `${progress.bestUnplaced} unplaced`}
              </span>
            ) : lastRun ? (
              <span className="text-[#A1A1AA] hidden sm:inline">{lastRun}</span>
            ) : null}
            {toast && <span className="text-[#18181B] font-medium">{toast}</span>}
          </span>
        </div>
      </div>

      {/* Assignments no timetable can satisfy, before anything is generated. */}
      {overloaded.length > 0 && (
        <OverloadedTeachersNotice
          overloaded={overloaded}
          teacherName={(id) => teachers.find((t) => t.id === id)?.full_name ?? 'Teacher'}
        />
      )}

      {solverError && (
        <p className="flex items-start gap-2 px-3 py-2 bg-amber-50 border border-amber-200 text-[12px] text-amber-800">
          <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
          <span>{solverError}</span>
        </p>
      )}

      {/* What the solver proved. Kept apart from the health score: health is a
          judgement about a week, this is a fact about the rules. */}
      {proof && (
        <div className="border border-[#E4E4E7]">
          <div className="flex items-baseline gap-2 px-3 py-1.5 bg-[#FAFAFA] border-b border-[#E4E4E7]">
            <span className={SECTION_LABEL}>
              {proof.status === 'feasible' ? 'Proved possible' : proof.status === 'impossible' ? 'Proved impossible' : 'Undecided'}
            </span>
            <span className="text-[11px] text-[#A1A1AA] tabular-nums">
              {(proof.wallTimeMs / 1000).toFixed(1)}s · {proof.variables.toLocaleString()} variables
            </span>
            <button
              onClick={() => setProof(null)}
              aria-label="Dismiss"
              className={`ml-auto p-0.5 text-[#A1A1AA] hover:text-[#18181B] ${TAP} ${FOCUS}`}
            >
              <X size={13} />
            </button>
          </div>
          {proof.status === 'feasible' ? (
            <p className="px-3 py-2 text-xs text-emerald-700 flex items-start gap-2">
              <CheckCircle2 size={14} className="flex-shrink-0 mt-0.5" />
              <span>
                Every required period can be placed. If Generate still leaves periods out, that is
                the search falling short rather than the rules — run it again, or Tidy up.
              </span>
            </p>
          ) : proof.status === 'impossible' ? (
            <div className="px-3 py-2 space-y-2">
              <p className="text-xs text-[#52525B]">
                Each group below is independent. Relaxing any <em>one</em> rule in a group resolves it.
              </p>
              {conflictGroups(proof.conflicts).map((group, i) => (
                <div key={i} className="border-l-2 border-rose-300 pl-2.5">
                  <p className="text-[11px] font-bold uppercase tracking-widest text-rose-700">
                    Conflict {i + 1}
                  </p>
                  <ul className="mt-0.5">
                    {group.map((c) => (
                      <li key={c.tag} className="text-xs text-[#18181B] flex gap-1.5">
                        <span className="text-[#A1A1AA]">·</span>
                        <span>{describeConflictRule(c, conflictNames)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              {proof.conflictsTruncated && (
                <p className="text-[11px] text-[#71717A] italic">
                  Stopped on its time limit — there may be more. Fix these and check again.
                </p>
              )}
            </div>
          ) : (
            <p className="px-3 py-2 text-xs text-[#71717A]">
              Ran out of time before it could decide either way.
            </p>
          )}
        </div>
      )}

      <HealthPanel report={health} />

      {/* ── The grid ──────────────────────────────────────────
          Its own framed panel with its own header bar, so it reads as the
          subject of the page rather than as the last thing on it. */}
      <section className="border border-[#A1A1AA] bg-white">
        <div className="flex flex-wrap items-center gap-2 px-2 py-2 border-b border-[#E4E4E7] bg-[#FAFAF9]">
          <div className="inline-flex border border-[#D4D4D8] bg-white flex-shrink-0">
            {VIEWS.map((v, i) => {
              const Icon = v.icon
              const active = view === v.key
              return (
                <button
                  key={v.key}
                  onClick={() => setView(v.key)}
                  aria-pressed={active}
                  className={`inline-flex items-center gap-1.5 px-2.5 min-h-[2.25rem] sm:min-h-0 sm:py-1.5 text-[13px] sm:text-xs font-medium ${TAP} ${FOCUS} ${
                    i > 0 ? 'border-l border-[#D4D4D8]' : ''
                  } ${active ? 'bg-[#27272A] text-white' : 'text-[#52525B] hover:bg-[#F5F5F5]'}`}
                  title={v.label}
                >
                  <Icon size={13} className={active ? 'text-[#B8983C]' : undefined} />
                  <span className="hidden sm:inline">{v.label}</span>
                </button>
              )
            })}
          </div>

          {view === 'class' && (
            <div className="flex-1 min-w-[10rem]">
              <SmartSelect
                options={homeroomOptions}
                value={selectedHomeroomId}
                onChange={setSelectedHomeroomId}
                placeholder="Select class…"
                searchPlaceholder="Search classes…"
                leadingIcon={<GraduationCap size={14} className="text-[#71717A] flex-shrink-0" />}
              />
            </div>
          )}
          {view === 'teacher' && (
            <div className="flex-1 min-w-[10rem]">
              <SmartSelect
                options={teacherOptions}
                value={selectedTeacherId}
                onChange={setSelectedTeacherId}
                placeholder="Select teacher…"
                searchPlaceholder="Search staff…"
                leadingIcon={<UserCog size={14} className="text-[#71717A] flex-shrink-0" />}
              />
            </div>
          )}
          {view === 'master' && (
            <p className="text-[11px] text-[#A1A1AA] ml-auto hidden md:block">
              Drag to move · click to open · red = clash
            </p>
          )}
          {view === 'class' && weeks.length > 1 && (
            <span className="text-[11px] text-[#71717A] flex-shrink-0">
              {selectedWeek.name}
            </span>
          )}
        </div>

        <div className="p-2">
          {emptyBands.map((w) => (
            <p key={w.groupId ?? 'base'} className="flex items-start gap-2 px-3 py-2 mb-2 bg-amber-50 border border-amber-200 text-[12px] text-amber-800">
              <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
              <span>
                <strong>{w.name}</strong> has classes but no period slots, so nothing can be
                scheduled for them. Add its periods in Configuration.
              </span>
            </p>
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
                <LessonStatsCard dimension="class" id={selectedHomeroomId} className="mt-2" />
              </>
            )
          ) : view === 'teacher' ? (
            <TeacherWeekView teacherId={selectedTeacherId} />
          ) : masterSections.length === 0 ? (
            <p className="py-10 text-center text-sm text-[#A1A1AA]">
              No classes are scheduled yet.
            </p>
          ) : (
            /* One grid per period group. Two bells are two different sets of
               period rows and cannot share a grid, so a school running both
               gets both — each with its own fit, zoom and full screen. */
            <div className="space-y-4">
              {masterSections.map(({ week, homerooms }) => (
                <div key={week.groupId ?? 'base'}>
                  {masterSections.length > 1 && (
                    <div className="flex items-baseline gap-2 mb-1">
                      <span className={SECTION_LABEL}>{week.name}</span>
                      <span className="text-[11px] text-[#A1A1AA] tabular-nums">
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

/** A hairline between secondary actions, so the row reads as a list. */
function Sep() {
  return <span aria-hidden className="hidden sm:inline-block w-px h-4 bg-[#E4E4E7] mx-0.5" />
}
