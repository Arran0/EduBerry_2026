'use client'

import React, { useMemo, useState } from 'react'
import { Lock, Unlock, X, Coffee } from 'lucide-react'
import { conflictCellKeys } from '@/lib/timetable/generator'
import { WEEKDAY_LABELS } from '@/lib/timetable'
import type {
  PlacedEntry, PeriodSlot, Subject, Room, TeacherUnavailability, Weekday,
} from '@/lib/timetable'
import type { UserProfile } from '@/lib/supabase'
import { SmartSelect } from './ui'
import type { SmartOption } from './ui'

interface Props {
  days: Weekday[]
  slots: PeriodSlot[] // all slots incl. breaks, ordered by position
  homeroomId: string
  entries: PlacedEntry[] // ALL entries across homerooms (for cross-class conflict detection)
  unavailability: TeacherUnavailability[]
  subjects: Subject[]
  teachers: UserProfile[]
  rooms: Room[]
  onSetCell: (day: Weekday, slotId: string, subjectId: string, teacherId: string | null, roomId: string | null) => void
  onClearCell: (day: Weekday, slotId: string) => void
  onToggleLock: (day: Weekday, slotId: string) => void
}

const gridKey = (homeroomId: string, day: Weekday, slotId: string) => `${homeroomId}__${day}__${slotId}`

export default function EditableTimetableGrid({
  days, slots, homeroomId, entries, unavailability, subjects, teachers, rooms,
  onSetCell, onClearCell, onToggleLock,
}: Props) {
  const [editing, setEditing] = useState<{ day: Weekday; slotId: string } | null>(null)

  const conflicts = useMemo(
    () => conflictCellKeys(entries, unavailability),
    [entries, unavailability],
  )

  // Fast lookup of this homeroom's entry per cell.
  const byCell = useMemo(() => {
    const m = new Map<string, PlacedEntry>()
    for (const e of entries) {
      if (e.homeroomId === homeroomId) m.set(`${e.day}__${e.slotId}`, e)
    }
    return m
  }, [entries, homeroomId])

  const subjectById = useMemo(() => new Map(subjects.map((s) => [s.id, s])), [subjects])
  const teacherById = useMemo(() => new Map(teachers.map((t) => [t.id, t])), [teachers])
  const roomById = useMemo(() => new Map(rooms.map((r) => [r.id, r])), [rooms])

  const editingEntry = editing ? byCell.get(`${editing.day}__${editing.slotId}`) ?? null : null

  return (
    <div className="overflow-x-auto border border-[#D4D4D8] bg-white">
      <table className="w-full border-collapse text-sm min-w-[40rem]">
        <thead>
          <tr className="bg-[#FAFAF9]">
            <th className="p-2 text-left text-[10px] font-bold uppercase tracking-widest text-[#525252] w-28 sticky left-0 bg-[#FAFAF9] z-10">Period</th>
            {days.map((d) => (
              <th key={d} className="p-2 text-center text-[11px] font-semibold text-[#52525B] border-l border-[#E4E4E7]">
                <span className="hidden sm:inline">{WEEKDAY_LABELS[d]}</span>
                <span className="sm:hidden">{WEEKDAY_LABELS[d].slice(0, 3)}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {slots.map((slot) => (
            <tr key={slot.id} className={slot.is_break ? 'bg-amber-50/40' : ''}>
              <td className={`p-2 align-top text-[11px] text-[#71717A] whitespace-nowrap border-t border-[#E4E4E7] sticky left-0 z-10 ${slot.is_break ? 'bg-amber-50/40' : 'bg-white'}`}>
                <div className="font-medium text-[#52525B]">{slot.label}</div>
                {slot.start_time && slot.end_time && (
                  <div className="tabular-nums text-[#A1A1AA]">{slot.start_time.slice(0, 5)}–{slot.end_time.slice(0, 5)}</div>
                )}
              </td>
              {days.map((day) => {
                if (slot.is_break) {
                  return (
                    <td key={day} className="p-1 border-t border-l border-[#E4E4E7]">
                      <div className="h-14 bg-amber-50 flex items-center justify-center text-amber-500">
                        <Coffee size={14} />
                      </div>
                    </td>
                  )
                }
                const entry = byCell.get(`${day}__${slot.id}`)
                const inConflict = conflicts.has(gridKey(homeroomId, day, slot.id))
                const subj = entry?.subjectId ? subjectById.get(entry.subjectId) : null
                const teacher = entry?.teacherId ? teacherById.get(entry.teacherId) : null
                const room = entry?.roomId ? roomById.get(entry.roomId) : null
                return (
                  <td key={day} className="p-1 border-t border-l border-[#E4E4E7]">
                    <button
                      onClick={() => setEditing({ day, slotId: slot.id })}
                      className={`relative w-full h-14 px-2 py-1 text-left text-xs transition-all ${
                        inConflict
                          ? 'ring-2 ring-inset ring-rose-400'
                          : entry
                            ? 'hover:brightness-95'
                            : 'border border-dashed border-[#D4D4D8] text-[#C4C4C8] hover:border-[#A1A1AA] hover:text-[#71717A]'
                      }`}
                      style={
                        entry
                          ? { background: (subj?.color ?? '#52525B') + '1f', borderLeft: `3px solid ${subj?.color ?? '#52525B'}` }
                          : undefined
                      }
                    >
                      {entry ? (
                        <>
                          <div className="font-semibold text-[#18181B] truncate">{subj?.name ?? 'Subject'}</div>
                          {teacher && <div className="text-[#52525B] truncate">{teacher.full_name}</div>}
                          {room && <div className="text-[#A1A1AA] truncate">{room.name}</div>}
                          {entry.isLocked && (
                            <Lock size={11} className="absolute top-1 right-1 text-[#52525B]" />
                          )}
                        </>
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

      {editing && (
        <CellEditor
          entry={editingEntry}
          subjects={subjects}
          teachers={teachers}
          rooms={rooms}
          onClose={() => setEditing(null)}
          onSave={(subjectId, teacherId, roomId) => {
            onSetCell(editing.day, editing.slotId, subjectId, teacherId, roomId)
            setEditing(null)
          }}
          onClear={() => {
            onClearCell(editing.day, editing.slotId)
            setEditing(null)
          }}
          onToggleLock={() => onToggleLock(editing.day, editing.slotId)}
        />
      )}
    </div>
  )
}

// ── Cell editor modal ────────────────────────────────────────

function CellEditor({
  entry, subjects, teachers, rooms, onClose, onSave, onClear, onToggleLock,
}: {
  entry: PlacedEntry | null
  subjects: Subject[]
  teachers: UserProfile[]
  rooms: Room[]
  onClose: () => void
  onSave: (subjectId: string, teacherId: string | null, roomId: string | null) => void
  onClear: () => void
  onToggleLock: () => void
}) {
  const [subjectId, setSubjectId] = useState(entry?.subjectId ?? '')
  const [teacherId, setTeacherId] = useState(entry?.teacherId ?? '')
  const [roomId, setRoomId] = useState(entry?.roomId ?? '')

  const subjectOptions: SmartOption[] = subjects.map((s) => ({
    value: s.id, label: s.name, color: s.color ?? undefined, sublabel: s.code ?? undefined,
  }))
  const teacherOptions: SmartOption[] = teachers.map((t) => ({
    value: t.id, label: t.full_name, sublabel: t.email,
  }))
  const roomOptions: SmartOption[] = rooms.map((r) => ({ value: r.id, label: r.name }))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="bg-white border border-[#D4D4D8] shadow-xl w-full max-w-sm p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-[#18181B]">Edit period</h3>
          <button onClick={onClose} className="text-[#A1A1AA] hover:text-[#18181B]">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <span className="block text-[10px] font-bold uppercase tracking-widest text-[#525252] mb-1.5">Subject</span>
            <SmartSelect options={subjectOptions} value={subjectId} onChange={setSubjectId} placeholder="Select subject…" searchPlaceholder="Search subjects…" />
          </div>
          <div>
            <span className="block text-[10px] font-bold uppercase tracking-widest text-[#525252] mb-1.5">Teacher</span>
            <SmartSelect options={teacherOptions} value={teacherId} onChange={setTeacherId} placeholder="Unassigned" searchPlaceholder="Search staff…" allowClear />
          </div>
          <div>
            <span className="block text-[10px] font-bold uppercase tracking-widest text-[#525252] mb-1.5">Room</span>
            <SmartSelect options={roomOptions} value={roomId} onChange={setRoomId} placeholder="None" searchPlaceholder="Search rooms…" allowClear />
          </div>
        </div>

        <div className="flex items-center gap-2 mt-5">
          {entry && (
            <button
              onClick={onToggleLock}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium bg-[#F5F5F5] border border-[#D4D4D8] text-[#18181B] hover:bg-[#EBEBEB] transition-colors"
            >
              {entry.isLocked ? <Unlock size={14} /> : <Lock size={14} />}
              {entry.isLocked ? 'Unlock' : 'Lock'}
            </button>
          )}
          {entry && (
            <button
              onClick={onClear}
              className="px-3 py-2 text-sm font-medium text-rose-600 hover:bg-rose-50 transition-colors"
            >
              Clear
            </button>
          )}
          <div className="flex-1" />
          <button
            onClick={() => subjectId && onSave(subjectId, teacherId || null, roomId || null)}
            disabled={!subjectId}
            className="px-4 py-2 text-sm font-medium bg-[#27272A] text-[#F5F5F5] disabled:opacity-50 hover:bg-[#18181B] transition-colors"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
