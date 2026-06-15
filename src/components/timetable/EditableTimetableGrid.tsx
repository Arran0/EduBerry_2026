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
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
      <table className="w-full border-collapse text-sm min-w-[40rem]">
        <thead>
          <tr className="bg-slate-50">
            <th className="p-2 text-left text-xs font-semibold text-slate-400 w-28 sticky left-0 bg-slate-50 z-10">Period</th>
            {days.map((d) => (
              <th key={d} className="p-2 text-center text-xs font-semibold text-slate-600">
                <span className="hidden sm:inline">{WEEKDAY_LABELS[d]}</span>
                <span className="sm:hidden">{WEEKDAY_LABELS[d].slice(0, 3)}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {slots.map((slot) => (
            <tr key={slot.id} className={slot.is_break ? 'bg-amber-50/40' : ''}>
              <td className={`p-2 align-top text-xs text-slate-500 whitespace-nowrap border-t border-slate-100 sticky left-0 z-10 ${slot.is_break ? 'bg-amber-50/40' : 'bg-white'}`}>
                <div className="font-medium text-slate-600">{slot.label}</div>
                <div className="tabular-nums text-slate-400">{slot.start_time.slice(0, 5)}–{slot.end_time.slice(0, 5)}</div>
              </td>
              {days.map((day) => {
                if (slot.is_break) {
                  return (
                    <td key={day} className="p-1 border-t border-slate-100">
                      <div className="h-14 rounded-lg bg-amber-50 flex items-center justify-center text-amber-500">
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
                  <td key={day} className="p-1 border-t border-slate-100">
                    <button
                      onClick={() => setEditing({ day, slotId: slot.id })}
                      className={`relative w-full h-14 rounded-lg px-2 py-1 text-left text-xs transition-all ${
                        inConflict
                          ? 'ring-2 ring-rose-400'
                          : entry
                            ? 'hover:brightness-95'
                            : 'border border-dashed border-slate-200 text-slate-300 hover:border-slate-300'
                      }`}
                      style={
                        entry
                          ? { background: (subj?.color ?? '#64748b') + '22', borderLeft: `3px solid ${subj?.color ?? '#64748b'}` }
                          : undefined
                      }
                    >
                      {entry ? (
                        <>
                          <div className="font-semibold text-slate-700 truncate">{subj?.name ?? 'Subject'}</div>
                          {teacher && <div className="text-slate-500 truncate">{teacher.full_name}</div>}
                          {room && <div className="text-slate-400 truncate">{room.name}</div>}
                          {entry.isLocked && (
                            <Lock size={11} className="absolute top-1 right-1 text-slate-500" />
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-sm p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-slate-800">Edit period</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <span className="text-xs text-slate-500 mb-1 block">Subject</span>
            <SmartSelect options={subjectOptions} value={subjectId} onChange={setSubjectId} placeholder="Select subject…" searchPlaceholder="Search subjects…" />
          </div>
          <div>
            <span className="text-xs text-slate-500 mb-1 block">Teacher</span>
            <SmartSelect options={teacherOptions} value={teacherId} onChange={setTeacherId} placeholder="Unassigned" searchPlaceholder="Search staff…" allowClear />
          </div>
          <div>
            <span className="text-xs text-slate-500 mb-1 block">Room</span>
            <SmartSelect options={roomOptions} value={roomId} onChange={setRoomId} placeholder="None" searchPlaceholder="Search rooms…" allowClear />
          </div>
        </div>

        <div className="flex items-center gap-2 mt-5">
          {entry && (
            <button
              onClick={onToggleLock}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-slate-100 text-slate-700 hover:bg-slate-200"
            >
              {entry.isLocked ? <Unlock size={14} /> : <Lock size={14} />}
              {entry.isLocked ? 'Unlock' : 'Lock'}
            </button>
          )}
          {entry && (
            <button
              onClick={onClear}
              className="px-3 py-2 rounded-lg text-sm font-medium text-rose-600 hover:bg-rose-50"
            >
              Clear
            </button>
          )}
          <div className="flex-1" />
          <button
            onClick={() => subjectId && onSave(subjectId, teacherId || null, roomId || null)}
            disabled={!subjectId}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-indigo-600 text-white disabled:opacity-50 hover:bg-indigo-700"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
