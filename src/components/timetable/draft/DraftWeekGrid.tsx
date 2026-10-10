'use client'

import React, { useMemo, useState } from 'react'
import { Ban, Pin, Layers, Coffee, CalendarClock } from 'lucide-react'
import { WEEKDAY_LABELS, teacherIdsOf } from '@/lib/timetable'
import type {
  PlacedEntry, PeriodSlot, ScheduleWeek, Subject, Room, Weekday,
} from '@/lib/timetable'
import type { UserProfile } from '@/lib/supabase'
import { TIME_OFF_FILL } from '../EditableTimetableGrid'
import { TAP, FOCUS } from '../ui'
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
              <span className="block font-normal normal-case tracking-normal text-[9px] text-[#A1A1AA]">
                tap = all week
              </span>
            </th>
            {week.days.map((d) => (
              <th key={d} className="p-1.5 sm:p-2 text-center text-[10px] sm:text-[11px] font-semibold text-[#52525B] border-l border-[#E4E4E7]">
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
                  className={`w-full text-left p-1 sm:p-2 ${TAP} ${FOCUS} hover:bg-[#F5F5F5] ${
                    week.days.length > 0 && week.days.every((d) => isOff(d, slot.id))
                      ? offColor === 'rose' ? 'bg-rose-50' : 'bg-indigo-50'
                      : ''
                  }`}
                >
                  <div className="font-medium text-[#52525B] truncate">{slot.label}</div>
                  {slot.start_time && (
                    <div className="tabular-nums text-[#A1A1AA] hidden sm:block">
                      {slot.start_time.slice(0, 5)}
                    </div>
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
                    className={`p-1 sm:p-1.5 border-t border-l border-[#E4E4E7] align-top ${
                      isOver ? 'bg-indigo-50' : ''
                    }`}
                  >
                    <div className="relative">
                      {here.length === 0 ? (
                        <button
                          onClick={() =>
                            openTarget
                              ? setOpen({ homeroomId: openTarget, day, slot })
                              : onToggleOff(day, slot.id)}
                          className={`w-full h-10 sm:h-12 text-[10px] sm:text-xs font-medium flex items-center justify-center gap-1 sm:gap-1.5 ${TAP} ${FOCUS} ${
                            active ? onTone : 'bg-emerald-50/70 text-emerald-700/60 hover:bg-emerald-100'
                          }`}
                          style={active ? { backgroundImage: TIME_OFF_FILL } : undefined}
                          title={active
                            ? `${offLabel} — open this period`
                            : openTarget ? 'Free — open this period' : `Mark ${offLabel.toLowerCase()}`}
                        >
                          {active
                            ? <><Ban size={12} /><span className="hidden sm:inline">{offLabel}</span></>
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
                                }${span > 1 ? ` · ${BLOCK_WORD[span] ?? `${span}-period`} block` : ''}${
                                  entry.isLocked ? ' · pinned' : ''
                                }${active ? ` · marked ${offLabel.toLowerCase()}` : ''}`}
                                className={`relative px-1.5 py-1 leading-tight min-h-[2.5rem] sm:min-h-[3rem] ${FOCUS} ${
                                  draggable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'
                                } ${dragId === id ? 'opacity-40' : ''} ${
                                  clash ? 'ring-1 ring-inset ring-rose-400' : ''
                                } hover:brightness-[0.97] transition-[filter] duration-150`}
                                style={{
                                  background: accent + (active ? '14' : '26'),
                                  borderLeft: `3px solid ${accent}`,
                                  // A double/triple is one slab: the edges
                                  // between its periods are left open.
                                  borderTop: linkedAbove ? 'none' : undefined,
                                  marginTop: linkedAbove ? -1 : undefined,
                                }}
                              >
                                <div className="font-semibold text-[#18181B] text-[10px] sm:text-[11px] truncate pr-5">
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
                                  {amended && <CalendarClock size={10} className="text-[#B8983C]" />}
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
                        </div>
                      )}

                      {/* The one-tap shortcut. On every cell, occupied or not,
                          so the grid never offers a different set of corner
                          controls depending on what happens to be in a cell. */}
                      {here.length > 0 && (
                        <button
                          onClick={(ev) => { ev.stopPropagation(); onToggleOff(day, slot.id) }}
                          aria-label={active ? `Clear ${offLabel.toLowerCase()}` : `Mark ${offLabel.toLowerCase()}`}
                          title={active
                            ? `Clear ${offLabel.toLowerCase()}`
                            : `Mark ${offLabel.toLowerCase()} — the lesson here would have to move`}
                          className={`absolute -top-0.5 -right-0.5 w-4 h-4 flex items-center justify-center ${TAP} ${
                            active
                              ? offColor === 'rose' ? 'bg-rose-500 text-white' : 'bg-indigo-500 text-white'
                              : 'bg-white/70 text-[#A1A1AA] hover:bg-white hover:text-[#52525B]'
                          }`}
                        >
                          <Ban size={9} />
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
        <p className="text-xs text-[#A1A1AA] p-3 flex items-center gap-1.5">
          <Coffee size={13} /> No teaching periods in this schedule yet.
        </p>
      )}

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
