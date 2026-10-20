'use client'

import React, { useMemo, useState } from 'react'
import { Pin, Coffee, Ban, CalendarClock, Layers } from 'lucide-react'
import { conflictCellKeys } from '@/lib/timetable/generator'
import { buildConstraintIndex, cellKey, timeOffBlocked } from '@/lib/timetable/constraints'
import { WEEKDAY_LABELS, teacherIdsOf } from '@/lib/timetable'
import type {
  PlacedEntry, PeriodSlot, Subject, Room, TeacherUnavailability, TimetableConstraint, HomeroomLite, Weekday,
} from '@/lib/timetable'
import type { UserProfile } from '@/lib/supabase'
import DraftSlotModal from './draft/DraftSlotModal'
import { TAP, FOCUS, DayTabs, useDay, Chip } from './ui'

interface Props {
  days: Weekday[]
  slots: PeriodSlot[] // all slots incl. breaks, ordered by position
  homeroomId: string
  homeroomName: string
  entries: PlacedEntry[] // ALL entries across homerooms (for cross-class conflict detection)
  unavailability: TeacherUnavailability[]
  subjects: Subject[]
  teachers: UserProfile[]
  rooms: Room[]
  constraints?: TimetableConstraint[]
  homerooms?: HomeroomLite[]
  // Periods of other bell schedules sharing a wall-clock hour (Round 9).
  slotClash?: Map<string, string[]>
  /** Marks a cell a date change amends. */
  hasOverride?: (homeroomId: string, day: Weekday, slotId: string) => boolean
  // Dropping a lesson on another period. Returns false when refused.
  onMove?: (entry: PlacedEntry, day: Weekday, slotId: string) => boolean
}

const gridKey = (homeroomId: string, day: Weekday, slotId: string) => `${homeroomId}__${day}__${slotId}`

// Diagonal hatch marking a period the class is kept free.
export const TIME_OFF_FILL =
  'repeating-linear-gradient(45deg, #fff1f2, #fff1f2 4px, #ffe4e6 4px, #ffe4e6 8px)'

const BLOCK_WORD: Record<number, string> = { 2: 'Double', 3: 'Triple' }

export default function EditableTimetableGrid({
  days, slots, homeroomId, homeroomName, entries, unavailability, subjects, teachers, rooms,
  constraints = [], homerooms = [], slotClash, hasOverride, onMove,
}: Props) {
  const [openCell, setOpenCell] = useState<{ day: Weekday; slot: PeriodSlot } | null>(null)
  const [phoneDay, setPhoneDay] = useDay(days)
  const [dragCell, setDragCell] = useState<string | null>(null)
  const [overCell, setOverCell] = useState<string | null>(null)
  const draggable = typeof onMove === 'function'

  const conflicts = useMemo(
    () => conflictCellKeys(entries, unavailability, constraints, homerooms, slotClash),
    [entries, unavailability, constraints, homerooms, slotClash],
  )

  // Periods this class is kept free (Homeroom → Time off). The generator never
  // schedules them, so the grid shows them as closed rather than empty.
  const constraintIndex = useMemo(() => buildConstraintIndex(constraints, homerooms), [constraints, homerooms])
  const isTimeOff = (day: Weekday, slotId: string) =>
    timeOffBlocked(constraintIndex.homeroomTimeOff, homeroomId, cellKey(day, slotId))

  // The whole-class entry per cell (the editable layer). Parallel split-group
  // lessons are counted separately and shown as a badge.
  const byCell = useMemo(() => {
    const m = new Map<string, PlacedEntry>()
    for (const e of entries) {
      if (e.homeroomId === homeroomId && !e.groupId) m.set(`${e.day}__${e.slotId}`, e)
    }
    return m
  }, [entries, homeroomId])

  const splitCount = useMemo(() => {
    const m = new Map<string, number>()
    for (const e of entries) {
      if (e.homeroomId === homeroomId && e.groupId) {
        const k = `${e.day}__${e.slotId}`
        m.set(k, (m.get(k) ?? 0) + 1)
      }
    }
    return m
  }, [entries, homeroomId])

  const subjectById = useMemo(() => new Map(subjects.map((s) => [s.id, s])), [subjects])
  const teacherById = useMemo(() => new Map(teachers.map((t) => [t.id, t])), [teachers])
  const roomById = useMemo(() => new Map(rooms.map((r) => [r.id, r])), [rooms])

  // How long each double/triple runs, so its periods can be drawn as one slab
  // rather than as separate lessons that happen to sit next to each other.
  const blockSpan = useMemo(() => {
    const m = new Map<string, number>()
    for (const e of entries) {
      if (e.homeroomId === homeroomId && e.blockKey) m.set(e.blockKey, (m.get(e.blockKey) ?? 0) + 1)
    }
    return m
  }, [entries, homeroomId])

  const teachingOrder = useMemo(() => slots.filter((s) => !s.is_break).map((s) => s.id), [slots])

  // Is the period above/below this one part of the same block? A set of the
  // periods each block occupies makes it a lookup rather than a scan of every
  // entry per cell.
  const blockCells = useMemo(() => {
    const set = new Set<string>()
    for (const e of entries) if (e.homeroomId === homeroomId && e.blockKey) set.add(`${e.blockKey}|${e.day}|${e.slotId}`)
    return set
  }, [entries, homeroomId])
  const linkedTo = (entry: PlacedEntry, day: Weekday, delta: -1 | 1): boolean => {
    if (!entry.blockKey) return false
    const i = teachingOrder.indexOf(entry.slotId)
    const neighbour = teachingOrder[i + delta]
    if (i < 0 || !neighbour) return false
    return blockCells.has(`${entry.blockKey}|${day}|${neighbour}`)
  }

  // Names of every teacher on a lesson — co-taught periods list them all.
  const teacherLine = (entry: PlacedEntry) =>
    teacherIdsOf(entry)
      .map((id) => teacherById.get(id)?.full_name)
      .filter((n): n is string => !!n)
      .join(', ')

  const timeOf = (slot: PeriodSlot) =>
    slot.start_time && slot.end_time ? `${slot.start_time.slice(0, 5)}–${slot.end_time.slice(0, 5)}` : null

  return (
    <div className="min-w-0">
      {/* ── Phone: one day as a list ──────────────────────────
          Dragging needs a mouse, so a phone moves a lesson from the slot box. */}
      <div className="sm:hidden space-y-2">
        <DayTabs days={days} value={phoneDay} onChange={setPhoneDay} />
        <div className="border border-[#DDD8CC] bg-white divide-y divide-[#F0ECE3]">
          {slots.map((slot) => {
            const time = timeOf(slot)
            if (slot.is_break) {
              return (
                <div key={slot.id} className="flex items-center gap-3 px-3 py-2 bg-[#FBF6E9]">
                  <span className="w-[4.25rem] flex-shrink-0 text-[12px] text-amber-700 tabular-nums">{time ?? ''}</span>
                  <span className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-amber-700">
                    <Coffee size={13} /> {slot.label || 'Break'}
                  </span>
                </div>
              )
            }
            const day = phoneDay
            const cellK = `${day}__${slot.id}`
            const entry = byCell.get(cellK)
            const splits = splitCount.get(cellK) ?? 0
            const off = isTimeOff(day, slot.id)
            const inConflict = conflicts.has(gridKey(homeroomId, day, slot.id))
            const subj = entry?.subjectId ? subjectById.get(entry.subjectId) : null
            const room = entry?.roomId ? roomById.get(entry.roomId) : null
            const names = entry ? teacherLine(entry) : ''
            const span = entry?.blockKey ? blockSpan.get(entry.blockKey) ?? 1 : 1
            const amended = hasOverride?.(homeroomId, day, slot.id) ?? false
            return (
              <button
                key={slot.id}
                onClick={() => setOpenCell({ day, slot })}
                className={`relative w-full flex items-start gap-3 px-3 py-2.5 text-left transition-colors active:bg-[#FAF7F0] ${FOCUS} ${
                  inConflict ? 'bg-rose-50' : ''}`}
              >
                <span className="w-[4.25rem] flex-shrink-0">
                  <span className="block text-[13px] font-semibold text-slate-700 leading-snug break-words">{slot.label}</span>
                  {time && <span className="block text-[11.5px] text-slate-400 tabular-nums">{time}</span>}
                </span>
                <span className="flex-1 min-w-0">
                  {entry ? (
                    <span className="relative block pl-3">
                      <span aria-hidden className="absolute left-0 top-0.5 bottom-0.5 w-[3px] rounded-full" style={{ background: subj?.color ?? '#52525B' }} />
                      <span className="block text-[14px] font-semibold text-slate-900 leading-snug break-words">{subj?.name ?? 'Subject'}</span>
                      {(names || room) && (
                        <span className="block text-[12.5px] text-slate-500 leading-snug break-words">
                          {[names, room?.name].filter(Boolean).join(' · ')}
                        </span>
                      )}
                      {(span > 1 || entry.isLocked || entry.combinedKey || amended || off) && (
                        <span className="flex flex-wrap gap-1 mt-1">
                          {span > 1 && <Chip>{BLOCK_WORD[span] ?? `${span} in a row`}</Chip>}
                          {entry.isLocked && <Chip tone="dark"><Pin size={10} /> Pinned</Chip>}
                          {entry.combinedKey && <Chip tone="indigo"><Layers size={10} /> Combined</Chip>}
                          {amended && <Chip tone="gold"><CalendarClock size={10} /> Date change</Chip>}
                          {off && <Chip tone="bad"><Ban size={10} /> Kept free</Chip>}
                        </span>
                      )}
                    </span>
                  ) : splits > 0 ? (
                    <span className="block text-[13px] font-semibold text-indigo-600 py-0.5">{splits} groups</span>
                  ) : off ? (
                    <span className="inline-flex items-center gap-1 text-[13px] text-rose-500 py-0.5"><Ban size={12} /> Kept free</span>
                  ) : (
                    <span className="block text-[13px] text-slate-300 py-0.5">Free</span>
                  )}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* ── sm up: the week ─────────────────────────────────── */}
      <div className="hidden sm:block overflow-x-auto border border-[#DDD8CC] bg-white">
        <table className="w-full border-collapse text-sm table-fixed">
          <colgroup>
            <col className="w-24 lg:w-28" />
            {days.map((d) => <col key={d} />)}
          </colgroup>
          <thead>
            <tr className="bg-[#27272A]">
              <th className="p-2 text-left text-[12px] font-semibold text-slate-300">Period</th>
              {days.map((d) => (
                <th key={d} className="p-2 text-center text-[12px] font-semibold text-white border-l border-white/10">
                  <span className="lg:hidden">{WEEKDAY_LABELS[d].slice(0, 3)}</span>
                  <span className="hidden lg:inline">{WEEKDAY_LABELS[d]}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {slots.map((slot) => (
              <tr key={slot.id} className={slot.is_break ? 'bg-[#FBF6E9]' : ''}>
                <td className="p-2 align-top text-[11.5px] text-slate-500 border-t border-[#EEEAE1]">
                  <div className="font-semibold text-slate-700 leading-snug break-words">{slot.label}</div>
                  {timeOf(slot) && <div className="tabular-nums text-slate-400">{timeOf(slot)}</div>}
                </td>
                {days.map((day) => {
                  if (slot.is_break) {
                    return (
                      <td key={day} className="p-1 border-t border-l border-[#EEEAE1]">
                        <div className="h-12 flex items-center justify-center text-amber-500">
                          <Coffee size={14} />
                        </div>
                      </td>
                    )
                  }
                  const cellK = `${day}__${slot.id}`
                  const entry = byCell.get(cellK)
                  const splits = splitCount.get(cellK) ?? 0
                  const off = isTimeOff(day, slot.id)
                  const inConflict = conflicts.has(gridKey(homeroomId, day, slot.id))
                  const subj = entry?.subjectId ? subjectById.get(entry.subjectId) : null
                  const room = entry?.roomId ? roomById.get(entry.roomId) : null
                  const names = entry ? teacherLine(entry) : ''
                  const span = entry?.blockKey ? blockSpan.get(entry.blockKey) ?? 1 : 1
                  const linkedAbove = entry ? linkedTo(entry, day, -1) : false
                  const linkedBelow = entry ? linkedTo(entry, day, 1) : false
                  const isOver = overCell === cellK
                  const amended = hasOverride?.(homeroomId, day, slot.id) ?? false
                  return (
                    <td
                      key={day}
                      className={`p-1 border-t border-l border-[#EEEAE1] align-top ${isOver ? 'bg-indigo-50' : ''}`}
                      onDragOver={draggable ? (ev) => { ev.preventDefault(); setOverCell(cellK) } : undefined}
                      onDragLeave={draggable ? () => setOverCell((c) => (c === cellK ? null : c)) : undefined}
                      onDrop={draggable ? () => {
                        const from = dragCell
                        setDragCell(null)
                        setOverCell(null)
                        const dragged = from ? byCell.get(from) : null
                        if (dragged) onMove?.(dragged, day, slot.id)
                      } : undefined}
                    >
                      <button
                        draggable={draggable && !!entry}
                        onDragStart={entry ? () => setDragCell(cellK) : undefined}
                        onDragEnd={() => { setDragCell(null); setOverCell(null) }}
                        onClick={() => setOpenCell({ day, slot })}
                        title={
                          entry
                            ? `${subj?.name ?? 'Lesson'}${names ? ' · ' + names : ''}${room ? ' · ' + room.name : ''}${
                                span > 1 ? ` · ${BLOCK_WORD[span] ?? `${span}-period`}` : ''
                              }${off ? ' · kept free' : ''}`
                            : off ? 'Kept free for this class' : 'Free period'
                        }
                        className={`relative w-full min-h-[3.5rem] rounded-[6px] px-2 py-1 text-left text-[12px] leading-tight ${FOCUS} ${
                          dragCell === cellK ? 'opacity-40' : ''
                        } ${
                          inConflict
                            ? 'ring-2 ring-inset ring-rose-400'
                            : entry
                              ? `hover:brightness-95 transition-[filter] duration-150 ${draggable ? 'cursor-grab active:cursor-grabbing' : ''}`
                              : off
                                ? `border border-rose-200 text-rose-400 hover:border-rose-300 ${TAP}`
                                : `border border-dashed border-[#DDD8CC] text-slate-300 hover:border-[#B8983C] hover:text-slate-500 ${TAP}`
                        }`}
                        style={
                          entry
                            ? {
                                background: (subj?.color ?? '#52525B') + '2b',
                                boxShadow: `inset 3px 0 0 ${subj?.color ?? '#52525B'}`,
                                // A block is one lesson across several rows, so the
                                // corners between its periods are squared off and it
                                // reads as a single slab.
                                borderTopLeftRadius: linkedAbove ? 0 : undefined,
                                borderTopRightRadius: linkedAbove ? 0 : undefined,
                                borderBottomLeftRadius: linkedBelow ? 0 : undefined,
                                borderBottomRightRadius: linkedBelow ? 0 : undefined,
                              }
                            : off
                              ? { background: TIME_OFF_FILL }
                              : undefined
                        }
                      >
                        {entry ? (
                          <>
                            {!linkedAbove && (
                              <div className="font-semibold text-slate-900 break-words pr-4">{subj?.name ?? 'Subject'}</div>
                            )}
                            {!linkedAbove && names && <div className="text-slate-700 break-words">{names}</div>}
                            {!linkedAbove && room && <div className="text-slate-500 break-words">{room.name}</div>}
                            {span > 1 && !linkedAbove && (
                              <div className="text-[11px] font-medium text-slate-600">
                                {BLOCK_WORD[span] ?? `${span} in a row`}
                              </div>
                            )}
                            {linkedAbove && (
                              <span className="block text-center text-slate-400 leading-[3rem]">⌄</span>
                            )}
                            <span className="absolute top-1 right-1 flex items-center gap-px">
                              {amended && <CalendarClock size={10} className="text-[#B8983C]" />}
                              {entry.combinedKey && <Layers size={10} className="text-indigo-600" />}
                              {entry.isLocked && !linkedAbove && <Pin size={10} className="text-slate-700" />}
                            </span>
                            {off && <Ban size={10} className="absolute bottom-1 right-1 text-rose-500" />}
                          </>
                        ) : splits > 0 ? (
                          <span className="block text-center leading-[3rem] text-indigo-600 font-semibold">
                            {splits} groups
                          </span>
                        ) : off ? (
                          <span className="flex items-center justify-center gap-1 min-h-[3rem] text-rose-400">
                            <Ban size={11} /> Off
                          </span>
                        ) : (
                          <span className="block text-center leading-[3rem]">+</span>
                        )}
                      </button>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {openCell && (
        <DraftSlotModal
          homeroomId={homeroomId}
          homeroomName={homeroomName}
          day={openCell.day}
          slot={openCell.slot}
          onClose={() => setOpenCell(null)}
        />
      )}
    </div>
  )
}
