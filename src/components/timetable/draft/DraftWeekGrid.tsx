'use client'

import React, { useMemo, useState } from 'react'
import { Ban, Check, Pin, Layers, Coffee } from 'lucide-react'
import { WEEKDAY_LABELS, teacherIdsOf } from '@/lib/timetable'
import type {
  PlacedEntry, PeriodSlot, ScheduleWeek, Subject, Room, Weekday,
} from '@/lib/timetable'
import type { UserProfile } from '@/lib/supabase'
import { TIME_OFF_FILL } from '../EditableTimetableGrid'

// ============================================================
// The week calendar shown inside the Homeroom / Teacher / Subject time-off
// panels. It is the old day × period toggle grid with the current draft drawn
// into it, so marking a period free is done while looking at what is actually
// scheduled there — and a lesson in the way can be dragged or pinned without
// leaving for the master grid.
//
// An empty cell is the time-off toggle, exactly as before. A cell holding a
// lesson shows the lesson and moves the toggle to a corner button, so a drag
// never doubles as a toggle.
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

  /** Omit the draft callbacks for a read-only calendar. */
  onMove?: (entry: PlacedEntry, day: Weekday, slotId: string) => boolean
  onTogglePin?: (entry: PlacedEntry) => void
  onOpen?: (entry: PlacedEntry, day: Weekday, slot: PeriodSlot) => void
}

const cellId = (day: Weekday, slotId: string) => `${day}__${slotId}`
const lessonId = (e: PlacedEntry) =>
  `${e.homeroomId}__${e.day}__${e.slotId}__${e.groupId ?? ''}__${e.combinedKey ?? ''}`

const BLOCK_WORD: Record<number, string> = { 2: 'Double', 3: 'Triple' }

export default function DraftWeekGrid({
  week, lessons, isOff, onToggleOff, offLabel = 'Time off', offColor = 'rose',
  subjects, teachers, rooms, classLabel, conflicts,
  onMove, onTogglePin, onOpen,
}: DraftWeekGridProps) {
  const [dragId, setDragId] = useState<string | null>(null)
  const [overCell, setOverCell] = useState<string | null>(null)
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

  // How many periods each block runs for, and where in it each period sits, so
  // the tiles of one double/triple can be drawn as a single slab.
  const blockSpan = useMemo(() => {
    const counts = new Map<string, number>()
    for (const e of lessons) if (e.blockKey) counts.set(e.blockKey, (counts.get(e.blockKey) ?? 0) + 1)
    return counts
  }, [lessons])

  const slotIndex = useMemo(
    () => new Map(week.slots.map((s, i) => [s.id, i])),
    [week.slots],
  )

  // Is the period directly above/below part of the same block? Decides which
  // edges of the tile are drawn, so a block reads as one shape.
  const blockNeighbour = (e: PlacedEntry, delta: -1 | 1): boolean => {
    if (!e.blockKey) return false
    const i = slotIndex.get(e.slotId)
    if (i == null) return false
    const neighbourSlot = week.slots[i + delta]
    if (!neighbourSlot) return false
    return lessons.some(
      (o) => o.blockKey === e.blockKey && o.day === e.day && o.slotId === neighbourSlot.id,
    )
  }

  // Clicking a period label applies time off to the whole week: if every day is
  // already on it clears the row, otherwise it fills the gaps. Each day is its
  // own constraint row, so the writes go out together rather than one round
  // trip per working day.
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
    <div className="overflow-x-auto border border-[#D4D4D8]">
      <table className="w-full border-collapse text-sm min-w-[24rem] sm:min-w-[38rem] table-fixed">
        <colgroup>
          <col className="w-16 sm:w-28" />
          {week.days.map((d) => <col key={d} />)}
        </colgroup>
        <thead>
          <tr className="bg-[#FAFAF9]">
            <th className="p-1 sm:p-2 text-left text-[9px] sm:text-[10px] font-bold uppercase tracking-widest text-[#525252] sticky left-0 bg-[#FAFAF9] z-10">
              Period
              <span className="block font-normal normal-case tracking-normal text-[9px] text-[#A1A1AA]">tap = whole week</span>
            </th>
            {week.days.map((d) => (
              <th key={d} className="p-1.5 sm:p-3 text-center text-[10px] sm:text-[11px] font-semibold text-[#52525B] border-l border-[#E4E4E7]">
                <span className="hidden sm:inline">{WEEKDAY_LABELS[d]}</span>
                <span className="sm:hidden">{WEEKDAY_LABELS[d].slice(0, 3)}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {week.slots.map((slot) => (
            <tr key={slot.id}>
              <td className="p-0 text-[10px] sm:text-[11px] text-[#71717A] whitespace-nowrap sticky left-0 bg-white z-10 border-t border-[#E4E4E7]">
                <button
                  onClick={() => toggleWeek(slot.id)}
                  title={week.days.every((d) => isOff(d, slot.id))
                    ? `Clear ${offLabel.toLowerCase()} for this period all week`
                    : `Mark ${offLabel.toLowerCase()} for this period all week`}
                  className={`w-full text-left p-1 sm:p-2 transition-colors hover:bg-[#F5F5F5] ${
                    week.days.length > 0 && week.days.every((d) => isOff(d, slot.id))
                      ? offColor === 'rose' ? 'bg-rose-50' : 'bg-indigo-50'
                      : ''
                  }`}
                >
                  <div className="font-medium text-[#52525B] truncate">{slot.label}</div>
                  {slot.start_time && <div className="tabular-nums text-[#A1A1AA] hidden sm:block">{slot.start_time.slice(0, 5)}</div>}
                </button>
              </td>
              {week.days.map((day) => {
                const key = cellId(day, slot.id)
                const here = byCell.get(key) ?? []
                const active = isOff(day, slot.id)
                const isOver = overCell === key

                return (
                  <td
                    key={day}
                    onDragOver={draggable ? (ev) => { ev.preventDefault(); setOverCell(key) } : undefined}
                    onDragLeave={draggable ? () => setOverCell((c) => (c === key ? null : c)) : undefined}
                    onDrop={draggable ? () => handleDrop(day, slot.id) : undefined}
                    className={`p-1 sm:p-1.5 border-t border-l border-[#E4E4E7] align-top ${
                      isOver ? 'bg-indigo-50' : ''
                    }`}
                  >
                    {here.length === 0 ? (
                      // Nothing scheduled — the whole cell stays the toggle.
                      <button
                        onClick={() => onToggleOff(day, slot.id)}
                        className={`w-full h-9 sm:h-12 text-[10px] sm:text-xs font-medium transition-colors flex items-center justify-center gap-1 sm:gap-1.5 ${
                          active ? onTone : 'bg-emerald-50 text-emerald-600/70 hover:bg-emerald-100'
                        }`}
                        style={active ? { backgroundImage: TIME_OFF_FILL } : undefined}
                        title={active ? `Clear ${offLabel.toLowerCase()}` : `Mark ${offLabel.toLowerCase()}`}
                      >
                        {active ? <><Ban size={12} /><span className="hidden sm:inline">{offLabel}</span></> : <Check size={13} />}
                      </button>
                    ) : (
                      <div className="relative space-y-px">
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
                          return (
                            <div
                              key={id}
                              draggable={draggable}
                              onDragStart={draggable ? () => setDragId(id) : undefined}
                              onDragEnd={draggable ? () => { setDragId(null); setOverCell(null) } : undefined}
                              onClick={() => (onOpen ? onOpen(entry, day, slot) : onTogglePin?.(entry))}
                              title={`${subj?.name ?? 'Lesson'}${names.length ? ' · ' + names.join(', ') : ''}${
                                room ? ' · ' + room.name : ''
                              }${span > 1 ? ` · ${BLOCK_WORD[span] ?? `${span}-period`} block` : ''}${
                                entry.isLocked ? ' · pinned' : ''
                              }${active ? ' · marked time off' : ''}`}
                              className={`relative px-1.5 py-1 leading-tight min-h-[2.25rem] sm:min-h-[3rem] ${
                                draggable ? 'cursor-grab active:cursor-grabbing' : ''
                              } ${dragId === id ? 'opacity-40' : ''} ${
                                clash ? 'ring-1 ring-inset ring-rose-400' : ''
                              }`}
                              style={{
                                background: accent + (active ? '14' : '26'),
                                borderLeft: `3px solid ${accent}`,
                                // A double/triple is drawn as one slab: the
                                // edges between its periods are left open.
                                borderTop: linkedAbove ? 'none' : undefined,
                                marginTop: linkedAbove ? -1 : undefined,
                              }}
                            >
                              <div className="font-semibold text-[#18181B] text-[10px] sm:text-[11px] truncate pr-4">
                                {subj?.code || subj?.name || 'Lesson'}
                              </div>
                              {classLabel && (
                                <div className="text-[9px] sm:text-[10px] text-[#3F3F46] truncate">
                                  {classLabel(entry.homeroomId)}
                                </div>
                              )}
                              {!classLabel && names.length > 0 && (
                                <div className="text-[9px] sm:text-[10px] text-[#52525B] truncate">
                                  {names.join(', ')}
                                </div>
                              )}
                              {span > 1 && !linkedAbove && (
                                <span className="text-[8px] sm:text-[9px] font-medium uppercase tracking-wide text-[#71717A]">
                                  {BLOCK_WORD[span] ?? `${span} in a row`}
                                </span>
                              )}
                              <div className="absolute bottom-0.5 right-0.5 flex items-center gap-px">
                                {entry.combinedKey && <Layers size={10} className="text-indigo-500" />}
                                {entry.isLocked && <Pin size={10} className="text-[#27272A]" />}
                              </div>
                              {linkedBelow && (
                                <span
                                  className="absolute left-[-3px] right-0 bottom-[-1px] h-px"
                                  style={{ background: accent + '26' }}
                                />
                              )}
                            </div>
                          )
                        })}
                        {/* With a lesson in the way the cell's own controls move
                            to corner buttons, so dragging the lesson never
                            toggles anything by accident. */}
                        <div className="absolute -top-0.5 -right-0.5 flex">
                          {onTogglePin && (
                            <button
                              onClick={(ev) => { ev.stopPropagation(); onTogglePin(here[0]) }}
                              title={here[0].isLocked
                                ? 'Pinned here — the generator builds around it. Click to release.'
                                : 'Pin this lesson to this period'}
                              className={`w-4 h-4 flex items-center justify-center transition-colors ${
                                here[0].isLocked
                                  ? 'bg-[#27272A] text-white'
                                  : 'bg-white/70 text-[#A1A1AA] hover:bg-white hover:text-[#52525B]'
                              }`}
                            >
                              <Pin size={9} />
                            </button>
                          )}
                          <button
                            onClick={(ev) => { ev.stopPropagation(); onToggleOff(day, slot.id) }}
                            title={active ? `Clear ${offLabel.toLowerCase()}` : `Mark ${offLabel.toLowerCase()} — the lesson here would have to move`}
                            className={`w-4 h-4 flex items-center justify-center transition-colors ${
                              active
                                ? offColor === 'rose' ? 'bg-rose-500 text-white' : 'bg-indigo-500 text-white'
                                : 'bg-white/70 text-[#A1A1AA] hover:bg-white hover:text-[#52525B]'
                            }`}
                          >
                            <Ban size={9} />
                          </button>
                        </div>
                      </div>
                    )}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {week.slots.length === 0 && (
        <p className="text-xs text-[#A1A1AA] p-3 flex items-center gap-1.5">
          <Coffee size={13} /> This schedule has no teaching periods yet.
        </p>
      )}
    </div>
  )
}
