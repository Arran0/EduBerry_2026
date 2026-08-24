'use client'

import React, { useMemo, useRef, useState } from 'react'
import { Lock, Layers } from 'lucide-react'
import { conflictCellKeys } from '@/lib/timetable/generator'
import { WEEKDAY_LABELS } from '@/lib/timetable'
import type {
  PlacedEntry, PeriodSlot, Subject, Room, TeacherUnavailability, TimetableConstraint, HomeroomLite, Weekday,
} from '@/lib/timetable'
import type { Homeroom } from '@/lib/homerooms'
import type { UserProfile } from '@/lib/supabase'

interface Props {
  days: Weekday[]
  slots: PeriodSlot[]
  homerooms: Homeroom[] // rows (scheduled homerooms)
  entries: PlacedEntry[]
  onChange: (next: PlacedEntry[]) => void
  subjects: Subject[]
  teachers: UserProfile[]
  rooms: Room[]
  unavailability: TeacherUnavailability[]
  constraints: TimetableConstraint[]
  homeroomsLite: HomeroomLite[]
}

const cellId = (hr: string, day: Weekday, slotId: string) => `${hr}__${day}__${slotId}`
// Identity of one entry within the in-memory array (no DB id yet).
const entryId = (e: PlacedEntry) =>
  `${e.homeroomId}__${e.day}__${e.slotId}__${e.groupId ?? ''}__${e.combinedKey ?? ''}`

// aSc-style master grid: homeroom rows × (day → slot sub-columns). Drag a
// lesson to another period; live-validated against clashes and constraints.
export default function MasterTimetableEditor({
  days, slots, homerooms, entries, onChange, subjects, teachers, rooms,
  unavailability, constraints, homeroomsLite,
}: Props) {
  const teachingSlots = useMemo(() => slots.filter((s) => !s.is_break), [slots])
  const dragRef = useRef<PlacedEntry | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [overCell, setOverCell] = useState<string | null>(null)

  const subjectById = useMemo(() => new Map(subjects.map((s) => [s.id, s])), [subjects])
  const teacherById = useMemo(() => new Map(teachers.map((t) => [t.id, t])), [teachers])
  const roomById = useMemo(() => new Map(rooms.map((r) => [r.id, r])), [rooms])

  const conflicts = useMemo(
    () => conflictCellKeys(entries, unavailability, constraints, homeroomsLite),
    [entries, unavailability, constraints, homeroomsLite],
  )

  const byCell = useMemo(() => {
    const m = new Map<string, PlacedEntry[]>()
    for (const e of entries) {
      const k = cellId(e.homeroomId, e.day, e.slotId)
      const arr = m.get(k) ?? []
      arr.push(e)
      m.set(k, arr)
    }
    return m
  }, [entries])

  // ── Move logic ───────────────────────────────────────────────
  const handleDrop = (targetHr: string, day: Weekday, slotId: string) => {
    const dragged = dragRef.current
    dragRef.current = null
    setDragId(null)
    setOverCell(null)
    if (!dragged) return

    // Combined lesson → move every member entry to the new day+slot together.
    if (dragged.combinedKey) {
      const combinedId = dragged.combinedKey.split('__')[0]
      const newKey = `${combinedId}__${day}__${slotId}`
      onChange(
        entries.map((e) =>
          e.combinedKey === dragged.combinedKey ? { ...e, day, slotId, combinedKey: newKey } : e,
        ),
      )
      return
    }

    // A class's lesson only moves within its own row.
    if (targetHr !== dragged.homeroomId) return
    if (dragged.day === day && dragged.slotId === slotId) return

    const token = dragged.groupId ?? '__whole__'
    const draggedKey = entryId(dragged)
    // An occupant of the target cell with the same token gets swapped back.
    const occupant = entries.find(
      (e) =>
        e.homeroomId === targetHr && e.day === day && e.slotId === slotId &&
        (e.groupId ?? '__whole__') === token && !e.combinedKey,
    )

    onChange(
      entries.map((e) => {
        if (entryId(e) === draggedKey) return { ...e, day, slotId }
        if (occupant && entryId(e) === entryId(occupant)) {
          return { ...e, day: dragged.day, slotId: dragged.slotId }
        }
        return e
      }),
    )
  }

  const toggleLock = (target: PlacedEntry) => {
    const key = entryId(target)
    onChange(entries.map((e) => (entryId(e) === key ? { ...e, isLocked: !e.isLocked } : e)))
  }

  return (
    <div className="overflow-auto border border-[#D4D4D8] bg-white max-h-[72vh]">
      <table className="border-collapse text-xs">
        <thead>
          <tr className="bg-[#FAFAF9]">
            <th
              rowSpan={2}
              className="sticky left-0 top-0 z-30 bg-[#FAFAF9] border-b border-r border-[#E4E4E7] px-2 py-1.5 text-left text-[10px] font-bold uppercase tracking-widest text-[#525252] min-w-[7rem]"
            >
              Class
            </th>
            {days.map((d) => (
              <th
                key={d}
                colSpan={teachingSlots.length}
                className="sticky top-0 z-20 bg-[#FAFAF9] border-b border-l border-[#E4E4E7] px-2 py-1 text-center text-[11px] font-semibold text-[#52525B]"
              >
                <span className="hidden sm:inline">{WEEKDAY_LABELS[d]}</span>
                <span className="sm:hidden">{WEEKDAY_LABELS[d].slice(0, 3)}</span>
              </th>
            ))}
          </tr>
          <tr className="bg-[#FAFAF9]">
            {days.map((d) =>
              teachingSlots.map((s, i) => (
                <th
                  key={`${d}-${s.id}`}
                  className="sticky top-[26px] z-20 bg-[#FAFAF9] border-b border-l border-[#E4E4E7] px-1 py-1 text-center text-[10px] font-medium text-[#71717A] min-w-[3.25rem]"
                  title={s.label ?? undefined}
                >
                  {i + 1}
                </th>
              )),
            )}
          </tr>
        </thead>
        <tbody>
          {homerooms.map((hr) => (
            <tr key={hr.id}>
              <td className="sticky left-0 z-10 bg-white border-b border-r border-[#E4E4E7] px-2 py-1 font-medium text-[#18181B] whitespace-nowrap">
                {hr.name}
              </td>
              {days.map((day) =>
                teachingSlots.map((slot) => {
                  const key = cellId(hr.id, day, slot.id)
                  const cellEntries = byCell.get(key) ?? []
                  const inConflict = conflicts.has(key)
                  const isOver = overCell === key
                  return (
                    <td
                      key={key}
                      onDragOver={(e) => {
                        e.preventDefault()
                        setOverCell(key)
                      }}
                      onDragLeave={() => setOverCell((c) => (c === key ? null : c))}
                      onDrop={() => handleDrop(hr.id, day, slot.id)}
                      className={`border-b border-l border-[#E4E4E7] p-0.5 align-top ${
                        isOver ? 'bg-indigo-50 ring-1 ring-inset ring-indigo-300' : inConflict ? 'bg-rose-50' : ''
                      }`}
                    >
                      <div className="space-y-0.5 min-h-[2.25rem] w-[3.25rem]">
                        {cellEntries.map((entry) => {
                          const subj = entry.subjectId ? subjectById.get(entry.subjectId) : null
                          const teacher = entry.teacherId ? teacherById.get(entry.teacherId) : null
                          const room = entry.roomId ? roomById.get(entry.roomId) : null
                          const eid = entryId(entry)
                          return (
                            <div
                              key={eid}
                              draggable
                              onDragStart={() => {
                                dragRef.current = entry
                                setDragId(eid)
                              }}
                              onDragEnd={() => {
                                dragRef.current = null
                                setDragId(null)
                                setOverCell(null)
                              }}
                              title={`${subj?.name ?? 'Lesson'}${teacher ? ' · ' + teacher.full_name : ''}${room ? ' · ' + room.name : ''}`}
                              className={`relative px-1 py-0.5 cursor-grab active:cursor-grabbing leading-tight ${
                                dragId === eid ? 'opacity-40' : ''
                              } ${inConflict ? 'ring-1 ring-inset ring-rose-400' : ''}`}
                              style={{
                                background: (subj?.color ?? '#52525B') + '26',
                                borderLeft: `2px solid ${subj?.color ?? '#52525B'}`,
                              }}
                            >
                              <div className="font-semibold text-[#18181B] truncate">
                                {subj?.code || subj?.name?.slice(0, 4) || '—'}
                              </div>
                              {(entry.groupId || entry.combinedKey || entry.isLocked) && (
                                <div className="flex items-center gap-0.5">
                                  {entry.groupId && <span className="w-1.5 h-1.5 rounded-full bg-indigo-400" title="Split group" />}
                                  {entry.combinedKey && <Layers size={9} className="text-indigo-500" />}
                                  <button
                                    onClick={() => toggleLock(entry)}
                                    className={entry.isLocked ? 'text-[#52525B]' : 'text-[#C4C4C8] hover:text-[#52525B]'}
                                    title={entry.isLocked ? 'Locked' : 'Lock'}
                                  >
                                    <Lock size={9} />
                                  </button>
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    </td>
                  )
                }),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
