'use client'

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Sparkles, Loader2, Save, Send, Trash2, AlertTriangle, CheckCircle2, Download, GraduationCap,
} from 'lucide-react'
import {
  fetchPeriodSlots, fetchRequirements, fetchUnavailability, fetchRooms, fetchSubjects,
  fetchTimetables, createTimetable, replaceEntries, publishTimetable, fetchEntries,
  updateTimetableMeta, fetchConstraints, fetchCombinedClasses,
} from '@/lib/timetable'
import type {
  TimetableConfig, PeriodSlot, Requirement, TeacherUnavailability, Room, Subject,
  Timetable, PlacedEntry, TimetableEntry, TimetableConstraint, HomeroomLite,
  CombinedClass, CombinedClassInput, Weekday, TimetableStatus,
} from '@/lib/timetable'
import { generateTimetable, detectConflicts } from '@/lib/timetable/generator'
import { computeHealth } from '@/lib/timetable/health'
import { exportTimetableToExcel } from '@/lib/timetable/export'
import HealthPanel from '../HealthPanel'
import { fetchAllHomerooms } from '@/lib/homerooms'
import type { Homeroom } from '@/lib/homerooms'
import { fetchAllProfiles } from '@/lib/admin'
import { isStaffRole } from '@/lib/supabase'
import type { UserProfile } from '@/lib/supabase'
import EditableTimetableGrid from '../EditableTimetableGrid'
import MasterTimetableEditor from '../MasterTimetableEditor'
import { BTN_NEUTRAL, SmartSelect, SECTION_LABEL, INPUT } from '../ui'
import type { SmartOption } from '../ui'
import { LayoutGrid, Rows3 } from 'lucide-react'

const toPlaced = (e: TimetableEntry): PlacedEntry => ({
  homeroomId: e.homeroom_id,
  day: e.day,
  slotId: e.slot_id,
  subjectId: e.subject_id ?? '',
  teacherId: e.teacher_id,
  roomId: e.room_id,
  isLocked: e.is_locked,
  groupId: e.group_id ?? null,
  splitKey: e.split_key ?? null,
  combinedKey: e.combined_key ?? null,
})

export default function GenerateTab({ config }: { config: TimetableConfig }) {
  const [loading, setLoading] = useState(true)
  const [slots, setSlots] = useState<PeriodSlot[]>([])
  const [requirements, setRequirements] = useState<Requirement[]>([])
  const [unavailability, setUnavailability] = useState<TeacherUnavailability[]>([])
  const [constraints, setConstraints] = useState<TimetableConstraint[]>([])
  const [combinedClasses, setCombinedClasses] = useState<CombinedClass[]>([])
  const [rooms, setRooms] = useState<Room[]>([])
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [homerooms, setHomerooms] = useState<Homeroom[]>([])
  const [teachers, setTeachers] = useState<UserProfile[]>([])

  const [timetable, setTimetable] = useState<Timetable | null>(null)
  const [entries, setEntries] = useState<PlacedEntry[]>([])
  const [selectedHomeroomId, setSelectedHomeroomId] = useState<string>('')

  const [timetableName, setTimetableName] = useState<string>('')
  const [view, setView] = useState<'class' | 'master'>('class')

  const [generating, setGenerating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [unplaced, setUnplaced] = useState<number | null>(null)
  const [toast, setToast] = useState<string>('')

  const load = useCallback(async () => {
    setLoading(true)
    const [sl, reqs, unavail, cons, cmb, rms, subs, hrs, profiles, timetables] = await Promise.all([
      fetchPeriodSlots(config.id),
      fetchRequirements(config.id),
      fetchUnavailability(config.id),
      fetchConstraints(config.id),
      fetchCombinedClasses(config.id),
      fetchRooms(),
      fetchSubjects(),
      fetchAllHomerooms(),
      fetchAllProfiles(),
      fetchTimetables(config.id),
    ])
    setSlots(sl)
    setRequirements(reqs)
    setUnavailability(unavail)
    setConstraints(cons)
    setCombinedClasses(cmb)
    setRooms(rms)
    setSubjects(subs)
    setHomerooms(hrs)
    setTeachers(profiles.filter((p) => isStaffRole(p.role)))

    // Adopt the most recent timetable version (draft preferred) and its entries.
    const existing = timetables[0] ?? null
    setTimetable(existing)
    setTimetableName(existing?.name ?? config.name)
    if (existing) {
      const e = await fetchEntries(existing.id)
      setEntries(e.map(toPlaced))
    } else {
      setEntries([])
    }
    setLoading(false)
  }, [config.id])

  useEffect(() => {
    load()
  }, [load])

  // Homerooms that have requirements OR belong to a combined class are scheduled.
  const scheduledHomerooms = useMemo(() => {
    const ids = new Set(requirements.map((r) => r.homeroom_id))
    for (const c of combinedClasses) for (const m of c.members ?? []) ids.add(m.homeroom_id)
    return homerooms.filter((h) => ids.has(h.id))
  }, [requirements, combinedClasses, homerooms])

  useEffect(() => {
    if (scheduledHomerooms.length > 0 && !scheduledHomerooms.some((h) => h.id === selectedHomeroomId)) {
      setSelectedHomeroomId(scheduledHomerooms[0].id)
    }
  }, [scheduledHomerooms, selectedHomeroomId])

  // Minimal homeroom shape the solver needs for pin-class-teacher.
  const homeroomsLite: HomeroomLite[] = useMemo(
    () => homerooms.map((h) => ({ id: h.id, class_teacher_id: h.class_teacher_id })),
    [homerooms],
  )

  // Combined classes flattened for the solver.
  const combinedInput: CombinedClassInput[] = useMemo(
    () =>
      combinedClasses
        .filter((c) => c.subject_id)
        .map((c) => ({
          id: c.id,
          subjectId: c.subject_id as string,
          teacherId: c.teacher_id,
          roomId: c.room_id,
          periodsPerWeek: c.periods_per_week,
          homeroomIds: (c.members ?? []).map((m) => m.homeroom_id),
        })),
    [combinedClasses],
  )

  const liveConflicts = useMemo(
    () =>
      detectConflicts(entries, unavailability, constraints, homeroomsLite).filter(
        (c) => c.kind !== 'unplaced_lesson' && c.kind !== 'block_unplaceable' && c.kind !== 'pin_unfilled',
      ),
    [entries, unavailability, constraints, homeroomsLite],
  )

  const health = useMemo(() => {
    const hrName = new Map(homerooms.map((h) => [h.id, h.name]))
    const tName = new Map(teachers.map((t) => [t.id, t.full_name]))
    const sName = new Map(subjects.map((s) => [s.id, s.name]))
    return computeHealth({
      entries, requirements, constraints, slots, config, homerooms: homeroomsLite, unavailability,
      homeroomName: (id) => hrName.get(id) ?? 'Class',
      teacherName: (id) => tName.get(id) ?? 'Teacher',
      subjectName: (id) => sName.get(id) ?? 'Subject',
    })
  }, [entries, requirements, constraints, slots, config, homeroomsLite, unavailability, homerooms, teachers, subjects])

  const homeroomOptions: SmartOption[] = useMemo(
    () => scheduledHomerooms.map((h) => ({ value: h.id, label: h.name })),
    [scheduledHomerooms],
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

  // ── Cell editing for the selected homeroom ────────────────
  const setCell = (
    day: Weekday, slotId: string, subjectId: string, teacherId: string | null, roomId: string | null,
  ) => {
    // The single-class editor edits only the whole-class layer (group_id null),
    // leaving any parallel split-group lessons in the cell untouched.
    const isWhole = (e: PlacedEntry) => !e.groupId
    setEntries((prev) => {
      const existing = prev.find(
        (e) => isWhole(e) && e.homeroomId === selectedHomeroomId && e.day === day && e.slotId === slotId,
      )
      const rest = prev.filter(
        (e) => !(isWhole(e) && e.homeroomId === selectedHomeroomId && e.day === day && e.slotId === slotId),
      )
      return [
        ...rest,
        { homeroomId: selectedHomeroomId, day, slotId, subjectId, teacherId, roomId, isLocked: existing?.isLocked ?? false, groupId: null, splitKey: null, combinedKey: null },
      ]
    })
  }

  const clearCell = (day: Weekday, slotId: string) =>
    setEntries((prev) =>
      prev.filter((e) => !(!e.groupId && e.homeroomId === selectedHomeroomId && e.day === day && e.slotId === slotId)),
    )

  const toggleLock = (day: Weekday, slotId: string) =>
    setEntries((prev) =>
      prev.map((e) =>
        !e.groupId && e.homeroomId === selectedHomeroomId && e.day === day && e.slotId === slotId
          ? { ...e, isLocked: !e.isLocked }
          : e,
      ),
    )

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
    const exportEntries = entries
      .filter((e) => e.homeroomId === selectedHomeroomId)
      .map((e) => ({
        id: '', timetable_id: '', homeroom_id: e.homeroomId, day: e.day, slot_id: e.slotId,
        subject_id: e.subjectId, teacher_id: e.teacherId, room_id: e.roomId, is_locked: e.isLocked,
        teacher_name: e.teacherId ? teacherById.get(e.teacherId)?.full_name ?? null : null,
        created_at: '', updated_at: '',
        subject: e.subjectId ? subjectById.get(e.subjectId) : undefined,
        teacher: e.teacherId ? teacherById.get(e.teacherId) ?? undefined : undefined,
        room: e.roomId ? roomById.get(e.roomId) : undefined,
      })) as TimetableEntry[]
    const className = scheduledHomerooms.find((h) => h.id === selectedHomeroomId)?.name ?? 'class'
    exportTimetableToExcel({
      fileName: `${className.replace(/\s+/g, '-').toLowerCase()}-timetable.xlsx`,
      sheetName: className,
      days: config.working_days,
      slots,
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

  if (requirements.length === 0 || slots.filter((s) => !s.is_break).length === 0) {
    return (
      <div className="py-12 text-center text-[#71717A] text-sm">
        Add teaching <strong>period slots</strong> (Setup) and <strong>requirements</strong> before generating.
      </div>
    )
  }

  const isPublished = timetable?.status === 'published'

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
            <button
              onClick={() => setView('class')}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-sm font-medium ${view === 'class' ? 'bg-[#27272A] text-white' : 'text-[#52525B] hover:bg-[#F5F5F5]'}`}
            >
              <Rows3 size={14} /> <span className="hidden sm:inline">By class</span>
            </button>
            <button
              onClick={() => setView('master')}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-sm font-medium border-l border-[#D4D4D8] ${view === 'master' ? 'bg-[#27272A] text-white' : 'text-[#52525B] hover:bg-[#F5F5F5]'}`}
            >
              <LayoutGrid size={14} /> <span className="hidden sm:inline">Master grid</span>
            </button>
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
          {view === 'master' && (
            <p className="text-xs text-[#71717A] flex-1">Drag a lesson to another period. Split &amp; combined lessons move as units; conflicts highlight in red.</p>
          )}
        </div>

        {view === 'class' ? (
          selectedHomeroomId && (
            <EditableTimetableGrid
              days={config.working_days}
              slots={slots}
              homeroomId={selectedHomeroomId}
              entries={entries}
              unavailability={unavailability}
              subjects={subjects}
              teachers={teachers}
              rooms={rooms}
              constraints={constraints}
              homerooms={homeroomsLite}
              onSetCell={setCell}
              onClearCell={clearCell}
              onToggleLock={toggleLock}
            />
          )
        ) : (
          <MasterTimetableEditor
            days={config.working_days}
            slots={slots}
            homerooms={scheduledHomerooms}
            entries={entries}
            onChange={setEntries}
            subjects={subjects}
            teachers={teachers}
            rooms={rooms}
            unavailability={unavailability}
            constraints={constraints}
            homeroomsLite={homeroomsLite}
          />
        )}
      </div>
    </div>
  )
}
