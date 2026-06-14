'use client'

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Sparkles, Loader2, Save, Send, Trash2, AlertTriangle, CheckCircle2, ChevronDown, Download,
} from 'lucide-react'
import {
  fetchPeriodSlots, fetchRequirements, fetchUnavailability, fetchRooms, fetchSubjects,
  fetchTimetables, createTimetable, replaceEntries, publishTimetable, fetchEntries,
} from '@/lib/timetable'
import type {
  TimetableConfig, PeriodSlot, Requirement, TeacherUnavailability, Room, Subject,
  Timetable, PlacedEntry, TimetableEntry, Weekday,
} from '@/lib/timetable'
import { generateTimetable, detectConflicts } from '@/lib/timetable/generator'
import { exportTimetableToExcel } from '@/lib/timetable/export'
import { fetchAllHomerooms } from '@/lib/homerooms'
import type { Homeroom } from '@/lib/homerooms'
import { fetchAllProfiles } from '@/lib/admin'
import { isStaffRole } from '@/lib/supabase'
import type { UserProfile } from '@/lib/supabase'
import EditableTimetableGrid from '../EditableTimetableGrid'

const toPlaced = (e: TimetableEntry): PlacedEntry => ({
  homeroomId: e.homeroom_id,
  day: e.day,
  slotId: e.slot_id,
  subjectId: e.subject_id ?? '',
  teacherId: e.teacher_id,
  roomId: e.room_id,
  isLocked: e.is_locked,
})

export default function GenerateTab({ config }: { config: TimetableConfig }) {
  const [loading, setLoading] = useState(true)
  const [slots, setSlots] = useState<PeriodSlot[]>([])
  const [requirements, setRequirements] = useState<Requirement[]>([])
  const [unavailability, setUnavailability] = useState<TeacherUnavailability[]>([])
  const [rooms, setRooms] = useState<Room[]>([])
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [homerooms, setHomerooms] = useState<Homeroom[]>([])
  const [teachers, setTeachers] = useState<UserProfile[]>([])

  const [timetable, setTimetable] = useState<Timetable | null>(null)
  const [entries, setEntries] = useState<PlacedEntry[]>([])
  const [selectedHomeroomId, setSelectedHomeroomId] = useState<string>('')

  const [generating, setGenerating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [unplaced, setUnplaced] = useState<number | null>(null)
  const [toast, setToast] = useState<string>('')

  const load = useCallback(async () => {
    setLoading(true)
    const [sl, reqs, unavail, rms, subs, hrs, profiles, timetables] = await Promise.all([
      fetchPeriodSlots(config.id),
      fetchRequirements(config.id),
      fetchUnavailability(config.id),
      fetchRooms(),
      fetchSubjects(),
      fetchAllHomerooms(),
      fetchAllProfiles(),
      fetchTimetables(config.id),
    ])
    setSlots(sl)
    setRequirements(reqs)
    setUnavailability(unavail)
    setRooms(rms)
    setSubjects(subs)
    setHomerooms(hrs)
    setTeachers(profiles.filter((p) => isStaffRole(p.role)))

    // Adopt the most recent timetable version (draft preferred) and its entries.
    const existing = timetables[0] ?? null
    setTimetable(existing)
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

  // Homerooms that actually have requirements are the ones we schedule.
  const scheduledHomerooms = useMemo(() => {
    const ids = new Set(requirements.map((r) => r.homeroom_id))
    return homerooms.filter((h) => ids.has(h.id))
  }, [requirements, homerooms])

  useEffect(() => {
    if (scheduledHomerooms.length > 0 && !scheduledHomerooms.some((h) => h.id === selectedHomeroomId)) {
      setSelectedHomeroomId(scheduledHomerooms[0].id)
    }
  }, [scheduledHomerooms, selectedHomeroomId])

  const liveConflicts = useMemo(
    () => detectConflicts(entries, unavailability).filter((c) => c.kind !== 'unplaced_lesson'),
    [entries, unavailability],
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
    setEntries((prev) => {
      const rest = prev.filter(
        (e) => !(e.homeroomId === selectedHomeroomId && e.day === day && e.slotId === slotId),
      )
      const existing = prev.find(
        (e) => e.homeroomId === selectedHomeroomId && e.day === day && e.slotId === slotId,
      )
      return [
        ...rest,
        { homeroomId: selectedHomeroomId, day, slotId, subjectId, teacherId, roomId, isLocked: existing?.isLocked ?? false },
      ]
    })
  }

  const clearCell = (day: Weekday, slotId: string) =>
    setEntries((prev) =>
      prev.filter((e) => !(e.homeroomId === selectedHomeroomId && e.day === day && e.slotId === slotId)),
    )

  const toggleLock = (day: Weekday, slotId: string) =>
    setEntries((prev) =>
      prev.map((e) =>
        e.homeroomId === selectedHomeroomId && e.day === day && e.slotId === slotId
          ? { ...e, isLocked: !e.isLocked }
          : e,
      ),
    )

  // ── Persistence ───────────────────────────────────────────
  const ensureTimetable = async (): Promise<Timetable | null> => {
    if (timetable) return timetable
    const created = await createTimetable({
      config_id: config.id,
      name: `${config.name} — timetable`,
      status: 'draft',
    })
    if (created) setTimetable(created)
    return created
  }

  const handleSave = async () => {
    setSaving(true)
    const tt = await ensureTimetable()
    if (tt) {
      const ok = await replaceEntries(tt.id, entries)
      flash(ok ? 'Draft saved.' : 'Could not save draft.')
    }
    setSaving(false)
  }

  const handlePublish = async () => {
    if (liveConflicts.length > 0 && !confirm('There are unresolved conflicts. Publish anyway?')) return
    setPublishing(true)
    const tt = await ensureTimetable()
    if (tt) {
      await replaceEntries(tt.id, entries)
      const ok = await publishTimetable(tt)
      if (ok) {
        await load()
        flash('Timetable published — students and staff can now see it.')
      } else {
        flash('Could not publish.')
      }
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
      <div className="flex justify-center py-16 text-slate-400">
        <Loader2 className="animate-spin" size={22} />
      </div>
    )
  }

  if (requirements.length === 0 || slots.filter((s) => !s.is_break).length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-8 text-center text-slate-500 text-sm">
        Add teaching <strong>period slots</strong> (Setup) and <strong>requirements</strong> before generating.
      </div>
    )
  }

  const isPublished = timetable?.status === 'published'

  return (
    <div className="space-y-4">
      {/* Action bar */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="inline-flex items-center gap-1.5 bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50 hover:bg-indigo-700 transition-colors"
          >
            {generating ? <Loader2 className="animate-spin" size={15} /> : <Sparkles size={15} />}
            {entries.some((e) => e.isLocked) ? 'Regenerate (keep locked)' : 'Generate'}
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center gap-1.5 bg-slate-100 text-slate-700 px-3 py-2 rounded-lg text-sm font-medium disabled:opacity-50 hover:bg-slate-200 transition-colors"
          >
            {saving ? <Loader2 className="animate-spin" size={15} /> : <Save size={15} />}
            Save draft
          </button>
          <button
            onClick={handlePublish}
            disabled={publishing}
            className="inline-flex items-center gap-1.5 bg-emerald-600 text-white px-3 py-2 rounded-lg text-sm font-medium disabled:opacity-50 hover:bg-emerald-700 transition-colors"
          >
            {publishing ? <Loader2 className="animate-spin" size={15} /> : <Send size={15} />}
            Publish
          </button>
          <button
            onClick={clearUnlocked}
            className="inline-flex items-center gap-1.5 text-slate-500 px-3 py-2 rounded-lg text-sm font-medium hover:bg-slate-100 transition-colors"
          >
            <Trash2 size={15} />
            Clear unlocked
          </button>

          <div className="flex-1" />
          {isPublished ? (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full">
              <CheckCircle2 size={13} /> Published
            </span>
          ) : (
            <span className="text-xs font-medium text-slate-500 bg-slate-100 px-2.5 py-1 rounded-full">
              Draft
            </span>
          )}
        </div>

        {/* Status line */}
        <div className="mt-3 flex flex-wrap gap-3 text-xs">
          {liveConflicts.length > 0 ? (
            <span className="inline-flex items-center gap-1 text-rose-600">
              <AlertTriangle size={13} /> {liveConflicts.length} conflict(s) — see highlighted cells
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-emerald-600">
              <CheckCircle2 size={13} /> No hard conflicts
            </span>
          )}
          {unplaced != null && unplaced > 0 && (
            <span className="inline-flex items-center gap-1 text-amber-600">
              <AlertTriangle size={13} /> {unplaced} unplaced period(s)
            </span>
          )}
          {toast && <span className="text-slate-500">{toast}</span>}
        </div>
      </div>

      {/* Homeroom selector + grid */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-3 sm:p-4">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">Class</span>
          <div className="relative">
            <select
              value={selectedHomeroomId}
              onChange={(e) => setSelectedHomeroomId(e.target.value)}
              className="appearance-none border border-slate-300 rounded-lg bg-white px-3 py-1.5 pr-8 text-sm focus:outline-none focus:border-slate-800"
            >
              {scheduledHomerooms.map((h) => (
                <option key={h.id} value={h.id}>{h.name}</option>
              ))}
            </select>
            <ChevronDown size={15} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          </div>
          <div className="flex-1" />
          <button
            onClick={handleExport}
            className="inline-flex items-center gap-1.5 text-slate-600 bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
          >
            <Download size={14} /> Export
          </button>
        </div>

        {selectedHomeroomId && (
          <EditableTimetableGrid
            days={config.working_days}
            slots={slots}
            homeroomId={selectedHomeroomId}
            entries={entries}
            unavailability={unavailability}
            subjects={subjects}
            teachers={teachers}
            rooms={rooms}
            onSetCell={setCell}
            onClearCell={clearCell}
            onToggleLock={toggleLock}
          />
        )}
      </div>
    </div>
  )
}
