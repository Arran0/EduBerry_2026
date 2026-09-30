'use client'

import React, { useState, useEffect, useMemo } from 'react'
import {
  Sparkles, Loader2, Save, Send, Trash2, AlertTriangle, CheckCircle2, Download,
  GraduationCap, LayoutGrid, Rows3, UserCog, CalendarRange,
} from 'lucide-react'
import {
  createTimetable, replaceEntries, publishTimetable, updateTimetableMeta,
} from '@/lib/timetable'
import type {
  TimetableEntry, Timetable, TimetableStatus, ScheduleWeek,
} from '@/lib/timetable'
import { generateTimetable } from '@/lib/timetable/generator'
import { teacherIdsOf } from '@/lib/timetable'
import { computeHealth } from '@/lib/timetable/health'
import { exportTimetableToExcel } from '@/lib/timetable/export'
import HealthPanel from '../HealthPanel'
import EditableTimetableGrid from '../EditableTimetableGrid'
import MasterTimetableEditor from '../MasterTimetableEditor'
import TeacherWeekView from '../TeacherWeekView'
import { useTimetableDraft } from '../draft/TimetableDraftContext'
import { BTN_NEUTRAL, SmartSelect, SECTION_LABEL, INPUT } from '../ui'
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
    homeroomsLite, entries, setEntries, timetable, setTimetable, slotClash,
    groupName, liveConflicts, allConflicts, cellConflicts,
    setCellEntry, clearCellEntry, togglePin, moveEntry,
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
      slotGroups, homeroomGroupIds: slotGroupIds,
      conflicts: allConflicts,
      homeroomName: (id) => hrName.get(id) ?? 'Class',
      teacherName: (id) => tName.get(id) ?? 'Teacher',
      subjectName: (id) => sName.get(id) ?? 'Subject',
    })
  }, [entries, requirements, constraints, slots, config, homeroomsLite, unavailability, slotGroups, slotGroupIds, allConflicts, draft.homerooms, teachers, subjects])

  const homeroomOptions: SmartOption[] = useMemo(
    () => scheduledHomerooms.map((h) => ({ value: h.id, label: h.name })),
    [scheduledHomerooms],
  )
  const teacherOptions: SmartOption[] = useMemo(
    () => scheduledTeachers.map((t) => ({ value: t.id, label: t.full_name, sublabel: t.email ?? undefined })),
    [scheduledTeachers],
  )

  // Homerooms split by the bell schedule they follow. With no slot groups this
  // is a single section and the master grid looks exactly as it did.
  const weekSections = useMemo(
    () =>
      weeks
        .map((w) => ({
          week: w,
          homerooms: scheduledHomerooms.filter((h) => (slotGroupIds[h.id] ?? null) === w.groupId),
        }))
        .filter((s) => s.homerooms.length > 0 && s.week.slots.length > 0),
    [weeks, scheduledHomerooms, slotGroupIds],
  )

  const flash = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(''), 3000)
  }

  const handleGenerate = () => {
    setGenerating(true)
    // Defer so the spinner paints before the (synchronous) solve runs.
    setTimeout(() => {
      const locked = entries.filter((e) => e.isLocked)
      const result = generateTimetable({
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
      })
      setEntries(result.entries)
      setUnplaced(result.unplacedCount)
      setGenerating(false)
      flash(
        result.unplacedCount === 0
          ? 'Generated a conflict-free timetable.'
          : `Generated with ${result.unplacedCount} period(s) that couldn't be placed.`,
      )
    }, 30)
  }

  const clearUnlocked = () => setEntries((prev) => prev.filter((e) => e.isLocked))

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

  const handleSave = async () => {
    setSaving(true)
    const tt = await ensureTimetable()
    if (!tt) {
      flash('Could not create timetable record — check console.')
      setSaving(false)
      return
    }
    const ok = await replaceEntries(tt.id, entries)
    flash(ok ? 'Draft saved.' : 'Could not save entries — check console.')
    setSaving(false)
  }

  const handlePublish = async () => {
    if (liveConflicts.length > 0 && !confirm('There are unresolved conflicts. Publish anyway?')) return
    setPublishing(true)
    const tt = await ensureTimetable()
    if (!tt) {
      flash('Could not create timetable record — check console.')
      setPublishing(false)
      return
    }
    const saved = await replaceEntries(tt.id, entries)
    if (!saved) {
      flash('Could not save entries — check console.')
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

  return (
    <div>
      {/* Action bar */}
      <div className="pb-3 border-b border-[#E4E4E7] space-y-2">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="inline-flex items-center justify-center gap-1.5 bg-[#27272A] hover:bg-[#18181B] text-[#F5F5F5] px-4 py-2.5 text-sm font-medium disabled:opacity-50 transition-colors w-full"
          >
            {generating ? <Loader2 className="animate-spin" size={15} /> : <Sparkles size={15} className="text-[#B8983C]" />}
            {entries.some((e) => e.isLocked) ? 'Regenerate' : 'Generate'}
          </button>
          <button onClick={handleSave} disabled={saving} className={`${BTN_NEUTRAL} w-full py-2.5`}>
            {saving ? <Loader2 className="animate-spin" size={15} /> : <Save size={15} />}
            Save draft
          </button>
          <button
            onClick={handlePublish}
            disabled={publishing}
            className="inline-flex items-center justify-center gap-1.5 bg-emerald-700 hover:bg-emerald-800 text-white px-3 py-2.5 text-sm font-medium disabled:opacity-50 transition-colors w-full"
          >
            {publishing ? <Loader2 className="animate-spin" size={15} /> : <Send size={15} />}
            Publish
          </button>
          <button
            onClick={clearUnlocked}
            className="inline-flex items-center justify-center gap-1.5 text-[#71717A] px-3 py-2.5 text-sm font-medium hover:bg-[#F5F5F5] hover:text-[#18181B] transition-colors border border-[#D4D4D8] w-full"
          >
            <Trash2 size={15} />
            Clear unlocked
          </button>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <span className={`${SECTION_LABEL} flex-shrink-0`}>Name</span>
          <input
            className={`${INPUT} flex-1 min-w-[12rem]`}
            placeholder={`e.g. ${config.name} — Term 1`}
            value={timetableName}
            onChange={(e) => setTimetableName(e.target.value)}
          />
          {isPublished ? (
            <span className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-widest text-emerald-700 px-2.5 py-1 bg-emerald-50 border border-emerald-200 flex-shrink-0">
              <CheckCircle2 size={13} /> Published &amp; Active
            </span>
          ) : (
            <span className="text-[11px] font-bold uppercase tracking-widest text-[#71717A] px-2.5 py-1 bg-[#F5F5F5] border border-[#E4E4E7] flex-shrink-0">
              Draft
            </span>
          )}
        </div>
      </div>

      {/* Status line */}
      <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
        {liveConflicts.length > 0 ? (
          <span className="inline-flex items-center gap-1 text-rose-600 font-medium">
            <AlertTriangle size={13} /> {liveConflicts.length} conflict(s) — see highlighted cells
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-emerald-600 font-medium">
            <CheckCircle2 size={13} /> No hard conflicts
          </span>
        )}
        {unplaced != null && unplaced > 0 && (
          <span className="inline-flex items-center gap-1 text-amber-600 font-medium">
            <AlertTriangle size={13} /> {unplaced} unplaced period(s)
          </span>
        )}
        {weeks.length > 1 && (
          <span className="inline-flex items-center gap-1 text-[#71717A]">
            <CalendarRange size={13} /> {weeks.length} period groups
          </span>
        )}
        {toast && <span className="text-[#71717A] italic">{toast}</span>}
      </div>

      {/* Health score */}
      <div className="mt-3">
        <HealthPanel report={health} />
      </div>

      {/* View switcher */}
      <div className="mt-5 pt-5 border-t border-[#E4E4E7]">
        <div className="flex items-center gap-2 sm:gap-3 mb-3">
          <div className="inline-flex border border-[#D4D4D8] flex-shrink-0">
            {VIEWS.map((v, i) => {
              const Icon = v.icon
              return (
                <button
                  key={v.key}
                  onClick={() => setView(v.key)}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-sm font-medium ${
                    i > 0 ? 'border-l border-[#D4D4D8]' : ''
                  } ${view === v.key ? 'bg-[#27272A] text-white' : 'text-[#52525B] hover:bg-[#F5F5F5]'}`}
                  title={v.label}
                >
                  <Icon size={14} /> <span className="hidden sm:inline">{v.label}</span>
                </button>
              )
            })}
          </div>
          {view === 'class' && (
            <>
              <div className="flex-1 min-w-0">
                <SmartSelect
                  options={homeroomOptions}
                  value={selectedHomeroomId}
                  onChange={setSelectedHomeroomId}
                  placeholder="Select class…"
                  searchPlaceholder="Search classes…"
                  leadingIcon={<GraduationCap size={15} className="text-[#71717A] flex-shrink-0" />}
                />
              </div>
              <button onClick={handleExport} className={`${BTN_NEUTRAL} py-1.5 flex-shrink-0`}>
                <Download size={14} /> <span className="hidden sm:inline">Export</span>
              </button>
            </>
          )}
          {view === 'teacher' && (
            <div className="flex-1 min-w-0">
              <SmartSelect
                options={teacherOptions}
                value={selectedTeacherId}
                onChange={setSelectedTeacherId}
                placeholder="Select teacher…"
                searchPlaceholder="Search staff…"
                leadingIcon={<UserCog size={15} className="text-[#71717A] flex-shrink-0" />}
              />
            </div>
          )}
          {view === 'master' && (
            <p className="text-xs text-[#71717A] flex-1">
              Drag a lesson to another period, click one for details or to pin it. Doubles, split &amp; combined lessons move as units; conflicts highlight in red.
            </p>
          )}
        </div>

        {view === 'class' ? (
          selectedHomeroomId && (
            <>
              {weeks.length > 1 && (
                <p className="text-[11px] text-[#71717A] mb-1.5">
                  Period group: <strong className="text-[#18181B]">{selectedWeek.name}</strong>
                </p>
              )}
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
                groupName={groupName}
                cellConflicts={cellConflicts}
                onSetCell={setCellEntry}
                onClearCell={clearCellEntry}
                onTogglePin={togglePin}
                onMove={moveEntry}
              />
            </>
          )
        ) : view === 'teacher' ? (
          <TeacherWeekView teacherId={selectedTeacherId} />
        ) : (
          <div className="space-y-5">
            {weeks
              .filter((w) => w.slots.length === 0 && scheduledHomerooms.some((h) => (slotGroupIds[h.id] ?? null) === w.groupId))
              .map((w) => (
                <p key={w.groupId ?? 'base'} className="flex items-start gap-2 px-3 py-2 bg-amber-50 border border-amber-200 text-[12px] text-amber-800">
                  <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
                  <span>
                    <strong>{w.name}</strong> has classes assigned to it but no period slots yet, so nothing can be
                    scheduled for them. Add its periods in Configuration.
                  </span>
                </p>
              ))}
            {weekSections.map(({ week, homerooms }) => (
              <div key={week.groupId ?? 'base'}>
                {weeks.length > 1 && (
                  <div className="flex items-baseline gap-2 mb-1.5">
                    <span className={SECTION_LABEL}>{week.name}</span>
                    <span className="text-[11px] text-[#A1A1AA]">
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
                  groupName={groupName}
                  cellConflicts={cellConflicts}
                  onSetCell={setCellEntry}
                  onClearCell={clearCellEntry}
                  onTogglePin={togglePin}
                  onMove={moveEntry}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
