'use client'

import React, { useMemo, useState } from 'react'
import { Ban, Pin, Layers, Coffee, CalendarClock } from 'lucide-react'
import { WEEKDAY_LABELS, teacherIdsOf } from '@/lib/timetable'
import type {
  PlacedEntry, PeriodSlot, ScheduleWeek, Subject, Room, Weekday,
} from '@/lib/timetable'
import type { UserProfile } from '@/lib/supabase'
import { TIME_OFF_FILL } from '../EditableTimetableGrid'
import { TAP, FOCUS, DayTabs, useDay } from '../ui'
import DraftSlotModal from './DraftSlotModal'

// ============================================================
// The week calendar inside the Homeroom / Teacher / Subject panels.
//
// It is a time-off sheet AND a view of the draft, which used to mean clicking
// a cell did two unrelated things depending on what was in it: an empty cell
// toggled time off, a cell with a lesson in it silently pinned or unpinned.
// Same gesture, same-looking grid, three different outcomes across the app.
//
// Now there is one rule, the same one the master grid follows: clicking a cell
// opens the slot box, where pinning, editing, banning and date replacement all
// live. Marking a lot of time off stays fast through two deliberate shortcuts
// that look like shortcuts — a corner toggle on every cell, and the period
// label, which does the whole week at once.
// ============================================================

export interface DraftWeekGridProps {
  week: ScheduleWeek
  /** The lessons this calendar is about — already filtered to its scope. */
  lessons: PlacedEntry[]
  isOff: (day: Weekday, slotId: string) => boolean
  onToggleOff: (day: Weekday, slotId: string) => void | Promise<void>
  offLabel?: string
  offColor?: 'rose' | 'indigo'

  subjects: Subject[]
  teachers: UserProfile[]
  rooms: Room[]
  /** Printed under a lesson when the calendar spans classes (teacher/subject). */
  classLabel?: (homeroomId: string) => string
  /** homeroom__day__slot keys currently in conflict. */
  conflicts?: Set<string>

  /** Omit for a read-only calendar — cells still open the box, nothing drags. */
  onMove?: (entry: PlacedEntry, day: Weekday, slotId: string) => boolean
  /** Marks a cell that a date change amends, so an exception is visible here. */
  hasOverride?: (homeroomId: string, day: Weekday, slotId: string) => boolean
  /**
   * The class an empty cell belongs to. A homeroom calendar knows it; a
   * teacher's or subject's does not, so their empty cells stay pure toggles.
   */
  emptyCellHomeroomId?: string
}

const cellId = (day: Weekday, slotId: string) => `${day}__${slotId}`
const lessonId = (e: PlacedEntry) =>
  `${e.homeroomId}__${e.day}__${e.slotId}__${e.groupId ?? ''}__${e.combinedKey ?? ''}`

const BLOCK_WORD: Record<number, string> = { 2: 'Double', 3: 'Triple' }

export default function DraftWeekGrid({
  week, lessons, isOff, onToggleOff, offLabel = 'Time off', offColor = 'rose',
  subjects, teachers, rooms, classLabel, conflicts,
  onMove, hasOverride, emptyCellHomeroomId,
}: DraftWeekGridProps) {
  const [dragId, setDragId] = useState<string | null>(null)
  const [overCell, setOverCell] = useState<string | null>(null)
  const [open, setOpen] = useState<{ homeroomId: string; day: Weekday; slot: PeriodSlot } | null>(null)
  const [phoneDay, setPhoneDay] = useDay(week.days)
  const draggable = typeof onMove === 'function'

  const onTone = offColor === 'rose'
    ? 'bg-rose-100 text-rose-700 hover:bg-rose-200'
    : 'bg-indigo-100 text-indigo-700 hover:bg-indigo-200'

  const subjectById = useMemo(() => new Map(subjects.map((s) => [s.id, s])), [subjects])
  const teacherById = useMemo(() => new Map(teachers.map((t) => [t.id, t])), [teachers])
  const roomById = useMemo(() => new Map(rooms.map((r) => [r.id, r])), [rooms])

  const byCell = useMemo(() => {
    const m = new Map<string, PlacedEntry[]>()
    for (const e of lessons) {
      const k = cellId(e.day, e.slotId)
      const arr = m.get(k)
      if (arr) arr.push(e)
      else m.set(k, [e])
    }
    return m
  }, [lessons])

  // How many periods each block runs for, so one double/triple draws as a slab.
  const blockSpan = useMemo(() => {
    const counts = new Map<string, number>()
    for (const e of lessons) if (e.blockKey) counts.set(e.blockKey, (counts.get(e.blockKey) ?? 0) + 1)
    return counts
  }, [lessons])

  const slotIndex = useMemo(
    () => new Map(week.slots.map((s, i) => [s.id, i])),
    [week.slots],
  )

  const blockCells = useMemo(() => {
    const set = new Set<string>()
    for (const e of lessons) if (e.blockKey) set.add(`${e.blockKey}|${e.day}|${e.slotId}`)
    return set
  }, [lessons])

  const blockNeighbour = (e: PlacedEntry, delta: -1 | 1): boolean => {
    if (!e.blockKey) return false
    const i = slotIndex.get(e.slotId)
    if (i == null) return false
    const neighbourSlot = week.slots[i + delta]
    return !!neighbourSlot && blockCells.has(`${e.blockKey}|${e.day}|${neighbourSlot.id}`)
  }

  // The period label applies time off to the whole week: if every day already
  // has it the row clears, otherwise the gaps fill. Each day is its own
  // constraint row, so the writes go out together.
  const toggleWeek = async (slotId: string) => {
    const allOn = week.days.every((d) => isOff(d, slotId))
    const changing = week.days.filter((d) => isOff(d, slotId) !== !allOn)
    await Promise.all(changing.map((d) => onToggleOff(d, slotId)))
  }

  const handleDrop = (day: Weekday, slotId: string) => {
    const id = dragId
    setDragId(null)
    setOverCell(null)
    if (!id || !onMove) return
    const entry = lessons.find((e) => lessonId(e) === id)
    if (entry) onMove(entry, day, slotId)
  }

  return (
    <div className="min-w-0">
      {/* ── Phone: one day as a list ──────────────────────────
          Each period names what is in it; the round button on the right is
          the same time-off shortcut the corner toggle is on the week grid. */}
      <div className="sm:hidden space-y-2">
        <DayTabs days={week.days} value={phoneDay} onChange={setPhoneDay} />
        <div className="fx-card divide-y divide-[#F0ECE3]">
          {week.slots.length === 0 && (
            <p className="text-[12.5px] text-slate-400 p-3 flex items-center gap-1.5">
              <Coffee size={13} /> No teaching periods in this schedule yet.
            </p>
          )}
          {week.slots.map((slot) => {
            const day = phoneDay
            const here = byCell.get(cellId(day, slot.id)) ?? []
            const active = isOff(day, slot.id)
            const openTarget = here[0]?.homeroomId ?? emptyCellHomeroomId ?? null
            const time = slot.start_time && slot.end_time ? `${slot.start_time.slice(0, 5)}–${slot.end_time.slice(0, 5)}` : null
            return (
              <div key={slot.id} className={`flex items-start gap-2.5 pl-3 pr-1.5 py-2 ${active ? 'bg-rose-50/60' : ''}`}>
                <span className="w-[4.25rem] flex-shrink-0 pt-0.5">
                  <span className="block text-[13px] font-semibold text-slate-700 leading-snug break-words">{slot.label}</span>
                  {time && <span className="block text-[11.5px] text-slate-400 tabular-nums">{time}</span>}
                </span>
                <div className="flex-1 min-w-0 space-y-1.5">
                  {here.length === 0 ? (
                    <button
                      onClick={() =>
                        openTarget ? setOpen({ homeroomId: openTarget, day, slot }) : onToggleOff(day, slot.id)}
                      className={`block w-full text-left text-[13px] py-1 rounded-md ${FOCUS} ${active ? 'text-rose-600' : 'text-slate-300'}`}
                    >
                      {active ? offLabel : 'Free'}
                    </button>
                  ) : here.map((entry) => {
                    const subj = entry.subjectId ? subjectById.get(entry.subjectId) : null
                    const names = teacherIdsOf(entry)
                      .map((id) => teacherById.get(id)?.full_name)
                      .filter((n): n is string => !!n)
                    const clash = conflicts?.has(`${entry.homeroomId}__${day}__${slot.id}`)
                    return (
                      <button
                        key={lessonId(entry)}
                        onClick={() => setOpen({ homeroomId: entry.homeroomId, day, slot })}
                        className={`relative block w-full pl-3 text-left rounded-md ${FOCUS} ${clash ? 'ring-1 ring-rose-400' : ''}`}
                      >
                        <span aria-hidden className="absolute left-0 top-0.5 bottom-0.5 w-[3px] rounded-full" style={{ background: subj?.color ?? '#52525B' }} />
                        <span className="block text-[13.5px] font-semibold text-slate-900 leading-snug break-words">
                          {subj?.name ?? 'Lesson'}
                          {entry.isLocked && <Pin size={11} className="inline ml-1 -mt-0.5 text-slate-500" />}
                        </span>
                        <span className="block text-[12px] text-slate-500 leading-snug break-words">
                          {classLabel ? classLabel(entry.homeroomId) : names.join(', ')}
                        </span>
                      </button>
                    )
                  })}
                </div>
                <button
                  onClick={() => onToggleOff(day, slot.id)}
                  aria-pressed={active}
                  aria-label={active ? `Clear ${offLabel.toLowerCase()}` : `Mark ${offLabel.toLowerCase()}`}
                  title={active ? `Clear ${offLabel.toLowerCase()}` : `Mark ${offLabel.toLowerCase()}`}
                  className={`w-9 h-9 rounded-full inline-flex items-center justify-center flex-shrink-0 ${TAP} ${FOCUS} ${
                    active
                      ? offColor === 'rose' ? 'bg-rose-500 text-white' : 'bg-indigo-500 text-white'
                      : 'text-slate-400 bg-[#F4F1EA]'
                  }`}
                >
                  <Ban size={14} />
                </button>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── sm up: the week ─────────────────────────────────── */}
      <div className="hidden sm:block fx-card overflow-x-auto">
        <table className="w-full border-collapse text-sm table-fixed">
          <colgroup>
            <col className="w-24 lg:w-28" />
            {week.days.map((d) => <col key={d} />)}
          </colgroup>
          <thead>
            <tr className="bg-[#F7F5F0]">
              <th className="p-2 text-left text-[12px] font-semibold text-slate-600 leading-tight">
                Period
                <span className="block font-normal text-[11px] text-slate-400">tap: all week</span>
              </th>
              {week.days.map((d) => (
                <th key={d} className="p-2 text-center text-[12px] font-semibold text-slate-600 border-l border-[#EEEAE1]">
                  <span className="lg:hidden">{WEEKDAY_LABELS[d].slice(0, 3)}</span>
                  <span className="hidden lg:inline">{WEEKDAY_LABELS[d]}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {week.slots.map((slot) => (
              <tr key={slot.id}>
                <td className="p-0 text-[11.5px] text-slate-500 bg-white border-t border-[#EEEAE1]">
                  <button
                    onClick={() => toggleWeek(slot.id)}
                    title={week.days.every((d) => isOff(d, slot.id))
                      ? `Clear ${offLabel.toLowerCase()} for this period all week`
                      : `Mark ${offLabel.toLowerCase()} for this period all week`}
                    className={`w-full text-left p-2 ${TAP} ${FOCUS} hover:bg-[#F4F1EA] ${
                      week.days.length > 0 && week.days.every((d) => isOff(d, slot.id))
                        ? offColor === 'rose' ? 'bg-rose-50' : 'bg-indigo-50'
                        : ''
                    }`}
                  >
                    <div className="font-semibold text-slate-700 leading-snug break-words">{slot.label}</div>
                    {slot.start_time && (
                      <div className="tabular-nums text-slate-400">{slot.start_time.slice(0, 5)}</div>
                    )}
                  </button>
                </td>
                {week.days.map((day) => {
                  const key = cellId(day, slot.id)
                  const here = byCell.get(key) ?? []
                  const active = isOff(day, slot.id)
                  const isOver = overCell === key
                  // An empty cell can only open the box when the calendar knows
                  // whose cell it is; a teacher's blank Tuesday belongs to no class.
                  const openTarget = here[0]?.homeroomId ?? emptyCellHomeroomId ?? null

                  return (
                    <td
                      key={day}
                      onDragOver={draggable ? (ev) => { ev.preventDefault(); setOverCell(key) } : undefined}
                      onDragLeave={draggable ? () => setOverCell((c) => (c === key ? null : c)) : undefined}
                      onDrop={draggable ? () => handleDrop(day, slot.id) : undefined}
                      className={`p-1 border-t border-l border-[#EEEAE1] align-top ${isOver ? 'bg-indigo-50' : ''}`}
                    >
                      <div className="relative">
                        {here.length === 0 ? (
                          <button
                            onClick={() =>
                              openTarget
                                ? setOpen({ homeroomId: openTarget, day, slot })
                                : onToggleOff(day, slot.id)}
                            className={`w-full h-12 rounded-[6px] text-[12px] font-medium flex items-center justify-center gap-1.5 ${TAP} ${FOCUS} ${
                              active ? onTone : 'bg-emerald-50/70 text-emerald-700/60 hover:bg-emerald-100'
                            }`}
                            style={active ? { backgroundImage: TIME_OFF_FILL } : undefined}
                            title={active
                              ? `${offLabel}. Open this period`
                              : openTarget ? 'Free. Open this period' : `Mark ${offLabel.toLowerCase()}`}
                          >
                            {active
                              ? <><Ban size={12} /><span className="hidden lg:inline">{offLabel}</span></>
                              : <span className="text-base leading-none opacity-60">+</span>}
                          </button>
                        ) : (
                          <div className="space-y-px">
                            {here.map((entry) => {
                              const subj = entry.subjectId ? subjectById.get(entry.subjectId) : null
                              const names = teacherIdsOf(entry)
                                .map((id) => teacherById.get(id)?.full_name)
                                .filter((n): n is string => !!n)
                              const room = entry.roomId ? roomById.get(entry.roomId) : null
                              const id = lessonId(entry)
                              const span = entry.blockKey ? blockSpan.get(entry.blockKey) ?? 1 : 1
                              const linkedAbove = blockNeighbour(entry, -1)
                              const linkedBelow = blockNeighbour(entry, 1)
                              const clash = conflicts?.has(`${entry.homeroomId}__${day}__${slot.id}`)
                              const accent = subj?.color ?? '#52525B'
                              const amended = hasOverride?.(entry.homeroomId, day, slot.id) ?? false
                              return (
                                <div
                                  key={id}
                                  role="button"
                                  tabIndex={0}
                                  draggable={draggable}
                                  onDragStart={draggable ? () => setDragId(id) : undefined}
                                  onDragEnd={draggable ? () => { setDragId(null); setOverCell(null) } : undefined}
                                  onClick={() => setOpen({ homeroomId: entry.homeroomId, day, slot })}
                                  onKeyDown={(ev) => {
                                    if (ev.key === 'Enter' || ev.key === ' ') {
                                      ev.preventDefault()
                                      setOpen({ homeroomId: entry.homeroomId, day, slot })
                                    }
                                  }}
                                  title={`${subj?.name ?? 'Lesson'}${names.length ? ' · ' + names.join(', ') : ''}${
                                    room ? ' · ' + room.name : ''
                                  }${span > 1 ? ` · ${BLOCK_WORD[span] ?? `${span}-period`}` : ''}${
                                    entry.isLocked ? ' · pinned' : ''
                                  }${active ? ` · marked ${offLabel.toLowerCase()}` : ''}`}
                                  className={`relative px-2 py-1 leading-tight min-h-[3rem] rounded-[6px] ${FOCUS} ${
                                    draggable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'
                                  } ${dragId === id ? 'opacity-40' : ''} ${
                                    clash ? 'ring-1 ring-inset ring-rose-400' : ''
                                  } hover:brightness-[0.97] transition-[filter] duration-150`}
                                  style={{
                                    background: accent + (active ? '14' : '26'),
                                    boxShadow: `inset 3px 0 0 ${accent}`,
                                    // A double/triple is one slab: the corners
                                    // between its periods are squared off.
                                    borderTopLeftRadius: linkedAbove ? 0 : undefined,
                                    borderTopRightRadius: linkedAbove ? 0 : undefined,
                                    borderBottomLeftRadius: linkedBelow ? 0 : undefined,
                                    borderBottomRightRadius: linkedBelow ? 0 : undefined,
                                  }}
                                >
                                  <div className="font-semibold text-slate-900 text-[12px] break-words pr-4">
                                    {subj?.code || subj?.name || 'Lesson'}
                                  </div>
                                  {classLabel && (
                                    <div className="text-[11px] text-slate-700 break-words">
                                      {classLabel(entry.homeroomId)}
                                    </div>
                                  )}
                                  {!classLabel && names.length > 0 && (
                                    <div className="text-[11px] text-slate-600 break-words">
                                      {names.join(', ')}
                                    </div>
                                  )}
                                  {span > 1 && !linkedAbove && (
                                    <span className="text-[10.5px] font-medium text-slate-500">
                                      {BLOCK_WORD[span] ?? `${span} in a row`}
                                    </span>
                                  )}
                                  <div className="absolute bottom-1 right-1 flex items-center gap-px">
                                    {amended && <CalendarClock size={10} className="text-[#B8983C]" />}
                                    {entry.combinedKey && <Layers size={10} className="text-indigo-500" />}
                                    {entry.isLocked && <Pin size={10} className="text-[#27272A]" />}
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        )}

                        {/* The one-tap shortcut. On every occupied cell, so the
                            grid offers the same corner control wherever a lesson is. */}
                        {here.length > 0 && (
                          <button
                            onClick={(ev) => { ev.stopPropagation(); onToggleOff(day, slot.id) }}
                            aria-label={active ? `Clear ${offLabel.toLowerCase()}` : `Mark ${offLabel.toLowerCase()}`}
                            title={active
                              ? `Clear ${offLabel.toLowerCase()}`
                              : `Mark ${offLabel.toLowerCase()}. The lesson here would have to move.`}
                            className={`absolute top-0.5 right-0.5 w-5 h-5 rounded-full flex items-center justify-center ${TAP} ${
                              active
                                ? offColor === 'rose' ? 'bg-rose-500 text-white' : 'bg-indigo-500 text-white'
                                : 'bg-white/80 text-slate-400 hover:bg-white hover:text-slate-600'
                            }`}
                          >
                            <Ban size={10} />
                          </button>
                        )}
                      </div>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {week.slots.length === 0 && (
          <p className="text-[12.5px] text-slate-400 p-3 flex items-center gap-1.5">
            <Coffee size={13} /> No teaching periods in this schedule yet.
          </p>
        )}
      </div>

      {open && (
        <DraftSlotModal
          homeroomId={open.homeroomId}
          day={open.day}
          slot={open.slot}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  )
}
