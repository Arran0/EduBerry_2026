'use client'

import React, { useMemo, useState } from 'react'
import { Pin, Coffee, Ban } from 'lucide-react'
import { conflictCellKeys } from '@/lib/timetable/generator'
import { buildConstraintIndex, cellKey, timeOffBlocked } from '@/lib/timetable/constraints'
import { WEEKDAY_LABELS, teacherIdsOf } from '@/lib/timetable'
import type {
  PlacedEntry, PeriodSlot, Subject, Room, TeacherUnavailability, TimetableConstraint, HomeroomLite, Weekday,
} from '@/lib/timetable'
import type { UserProfile } from '@/lib/supabase'
import SlotDetailsModal from './SlotDetailsModal'

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
  groupName?: (groupId: string) => string | undefined
  cellConflicts?: (homeroomId: string, day: Weekday, slotId: string) => string[]
  onSetCell: (
    homeroomId: string, day: Weekday, slotId: string, groupId: string | null,
    subjectId: string, teacherIds: string[], roomId: string | null,
  ) => void
  onClearCell: (homeroomId: string, day: Weekday, slotId: string, groupId: string | null) => void
  onTogglePin: (entry: PlacedEntry) => void
}

const gridKey = (homeroomId: string, day: Weekday, slotId: string) => `${homeroomId}__${day}__${slotId}`

// Diagonal hatch marking a period the class is kept free.
export const TIME_OFF_FILL =
  'repeating-linear-gradient(45deg, #fff1f2, #fff1f2 4px, #ffe4e6 4px, #ffe4e6 8px)'

export default function EditableTimetableGrid({
  days, slots, homeroomId, homeroomName, entries, unavailability, subjects, teachers, rooms,
  constraints = [], homerooms = [], groupName, cellConflicts,
  onSetCell, onClearCell, onTogglePin,
}: Props) {
  const [openCell, setOpenCell] = useState<{ day: Weekday; slot: PeriodSlot } | null>(null)

  const conflicts = useMemo(
    () => conflictCellKeys(entries, unavailability, constraints, homerooms),
    [entries, unavailability, constraints, homerooms],
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

  // Everything in a cell, whole-class layer and split groups alike — what the
  // details modal shows.
  const allByCell = useMemo(() => {
    const m = new Map<string, PlacedEntry[]>()
    for (const e of entries) {
      if (e.homeroomId !== homeroomId) continue
      const k = `${e.day}__${e.slotId}`
      m.set(k, [...(m.get(k) ?? []), e])
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

  // Names of every teacher on a lesson — co-taught periods list them all.
  const teacherLine = (entry: PlacedEntry) =>
    teacherIdsOf(entry)
      .map((id) => teacherById.get(id)?.full_name)
      .filter((n): n is string => !!n)
      .join(', ')

  const openEntries = openCell ? allByCell.get(`${openCell.day}__${openCell.slot.id}`) ?? [] : []

  return (
    <div className="overflow-x-auto border border-[#D4D4D8] bg-white">
      <table className="w-full border-collapse text-sm min-w-[26rem] sm:min-w-[40rem]">
        <thead>
          <tr className="bg-[#FAFAF9]">
            <th className="p-1 sm:p-2 text-left text-[9px] sm:text-[10px] font-bold uppercase tracking-widest text-[#525252] w-14 sm:w-28 sticky left-0 bg-[#FAFAF9] z-10">Period</th>
            {days.map((d) => (
              <th key={d} className="p-1 sm:p-2 text-center text-[10px] sm:text-[11px] font-semibold text-[#52525B] border-l border-[#E4E4E7]">
                <span className="hidden sm:inline">{WEEKDAY_LABELS[d]}</span>
                <span className="sm:hidden">{WEEKDAY_LABELS[d].slice(0, 3)}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {slots.map((slot) => (
            <tr key={slot.id} className={slot.is_break ? 'bg-amber-50/40' : ''}>
              <td className={`p-1 sm:p-2 align-top text-[10px] sm:text-[11px] text-[#71717A] whitespace-nowrap border-t border-[#E4E4E7] sticky left-0 z-10 ${slot.is_break ? 'bg-amber-50/40' : 'bg-white'}`}>
                <div className="font-medium text-[#52525B]">{slot.label}</div>
                {slot.start_time && slot.end_time && (
                  <div className="tabular-nums text-[#A1A1AA]">{slot.start_time.slice(0, 5)}–{slot.end_time.slice(0, 5)}</div>
                )}
              </td>
              {days.map((day) => {
                if (slot.is_break) {
                  return (
                    <td key={day} className="p-0.5 sm:p-1 border-t border-l border-[#E4E4E7]">
                      <div className="h-10 sm:h-14 bg-amber-50 flex items-center justify-center text-amber-500">
                        <Coffee size={12} className="sm:hidden" />
                        <Coffee size={14} className="hidden sm:block" />
                      </div>
                    </td>
                  )
                }
                const entry = byCell.get(`${day}__${slot.id}`)
                const splits = splitCount.get(`${day}__${slot.id}`) ?? 0
                const off = isTimeOff(day, slot.id)
                const inConflict = conflicts.has(gridKey(homeroomId, day, slot.id))
                const subj = entry?.subjectId ? subjectById.get(entry.subjectId) : null
                const room = entry?.roomId ? roomById.get(entry.roomId) : null
                const names = entry ? teacherLine(entry) : ''
                return (
                  <td key={day} className="p-0.5 sm:p-1 border-t border-l border-[#E4E4E7]">
                    <button
                      onClick={() => setOpenCell({ day, slot })}
                      title={
                        entry
                          ? `${subj?.name ?? 'Lesson'}${names ? ' · ' + names : ''}${room ? ' · ' + room.name : ''}${off ? ' · marked time off' : ''}`
                          : off ? 'Time off — this class is kept free' : 'Free period'
                      }
                      className={`relative w-full h-10 sm:h-14 px-1.5 sm:px-2 py-0.5 sm:py-1 text-left text-[10px] sm:text-xs leading-tight transition-all ${
                        inConflict
                          ? 'ring-2 ring-inset ring-rose-400'
                          : entry
                            ? 'hover:brightness-95'
                            : off
                              ? 'border border-rose-200 text-rose-400 hover:border-rose-300'
                              : 'border border-dashed border-[#D4D4D8] text-[#C4C4C8] hover:border-[#A1A1AA] hover:text-[#71717A]'
                      }`}
                      style={
                        entry
                          ? { background: (subj?.color ?? '#52525B') + '1f', borderLeft: `3px solid ${subj?.color ?? '#52525B'}` }
                          : off
                            ? { background: TIME_OFF_FILL }
                            : undefined
                      }
                    >
                      {entry ? (
                        <>
                          <div className="font-semibold text-[#18181B] truncate">{subj?.name ?? 'Subject'}</div>
                          {names && <div className="text-[#52525B] truncate">{names}</div>}
                          {room && <div className="text-[#A1A1AA] truncate hidden sm:block">{room.name}</div>}
                          {entry.isLocked && (
                            <Pin size={10} className="absolute top-0.5 right-0.5 text-[#52525B]" />
                          )}
                          {off && <Ban size={10} className="absolute bottom-0.5 right-0.5 text-rose-500" />}
                        </>
                      ) : splits > 0 ? (
                        <span className="block text-center leading-[2.25rem] sm:leading-[3rem] text-indigo-500 font-medium">{splits} groups</span>
                      ) : off ? (
                        <span className="flex items-center justify-center gap-1 h-full text-rose-400">
                          <Ban size={11} /> <span className="hidden sm:inline">Off</span>
                        </span>
                      ) : (
                        <span className="block text-center leading-[2.25rem] sm:leading-[3rem]">+</span>
                      )}
                    </button>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>

      {openCell && (
        <SlotDetailsModal
          target={{ homeroomId, homeroomName, day: openCell.day, slot: openCell.slot }}
          entries={openEntries}
          subjects={subjects}
          teachers={teachers}
          rooms={rooms}
          groupName={groupName}
          conflicts={cellConflicts?.(homeroomId, openCell.day, openCell.slot.id) ?? []}
          timeOff={isTimeOff(openCell.day, openCell.slot.id)}
          onClose={() => setOpenCell(null)}
          onTogglePin={onTogglePin}
          onSave={(groupId, subjectId, teacherIds, roomId) => {
            onSetCell(homeroomId, openCell.day, openCell.slot.id, groupId, subjectId, teacherIds, roomId)
            setOpenCell(null)
          }}
          onClear={(entry) => {
            onClearCell(homeroomId, openCell.day, openCell.slot.id, entry.groupId ?? null)
            setOpenCell(null)
          }}
        />
      )}
    </div>
  )
}
