'use client'

import React, { useMemo, useState } from 'react'
import {
  X, Pin, PinOff, Layers, Users, DoorOpen, Clock, GraduationCap, AlertTriangle, Trash2, Pencil, Ban,
} from 'lucide-react'
import { WEEKDAY_LABELS, teacherIdsOf } from '@/lib/timetable'
import type { PlacedEntry, PeriodSlot, Subject, Room, Weekday } from '@/lib/timetable'
import type { UserProfile } from '@/lib/supabase'
import { SmartSelect } from './ui'
import type { SmartOption } from './ui'
import MultiTeacherSelect from './MultiTeacherSelect'

export interface SlotTarget {
  homeroomId: string
  homeroomName: string
  day: Weekday
  slot: PeriodSlot
}

interface Props {
  target: SlotTarget
  /** Every entry sitting in this class's cell (whole-class + parallel groups). */
  entries: PlacedEntry[]
  subjects: Subject[]
  teachers: UserProfile[]
  rooms: Room[]
  /** Human name for a split group id, when known. */
  groupName?: (groupId: string) => string | undefined
  /** Human-readable reasons this cell is flagged, if any. */
  conflicts?: string[]
  /** This class is marked time off in this period (Homeroom → Time off). */
  timeOff?: boolean
  onClose: () => void
  onTogglePin: (entry: PlacedEntry) => void
  onSave: (groupId: string | null, subjectId: string, teacherIds: string[], roomId: string | null) => void
  onClear: (entry: PlacedEntry) => void
}

const entryKey = (e: PlacedEntry) =>
  `${e.homeroomId}__${e.day}__${e.slotId}__${e.groupId ?? ''}__${e.combinedKey ?? ''}`

/**
 * Everything about one period of one class: what is scheduled there, who
 * teaches it (a lesson can be co-taught), where, whether it is pinned, and why
 * it is flagged — plus inline editing of the lesson. Opened by clicking a cell
 * in the master grid or the class-wise timetable.
 */
export default function SlotDetailsModal({
  target, entries, subjects, teachers, rooms, groupName, conflicts = [], timeOff = false,
  onClose, onTogglePin, onSave, onClear,
}: Props) {
  const { homeroomName, day, slot } = target

  const subjectById = useMemo(() => new Map(subjects.map((s) => [s.id, s])), [subjects])
  const teacherById = useMemo(() => new Map(teachers.map((t) => [t.id, t])), [teachers])
  const roomById = useMemo(() => new Map(rooms.map((r) => [r.id, r])), [rooms])

  // Which lesson the edit form targets: an existing entry, or a new whole-class
  // lesson when the cell is empty. Combined lessons are edited on the combined
  // class itself, not here.
  const editableEntries = entries.filter((e) => !e.combinedKey)
  const [editing, setEditing] = useState<PlacedEntry | null>(editableEntries[0] ?? null)
  const [formOpen, setFormOpen] = useState(entries.length === 0)

  const [subjectId, setSubjectId] = useState(editing?.subjectId ?? '')
  const [teacherIds, setTeacherIds] = useState<string[]>(editing ? teacherIdsOf(editing) : [])
  const [roomId, setRoomId] = useState(editing?.roomId ?? '')

  const startEdit = (entry: PlacedEntry | null) => {
    setEditing(entry)
    setSubjectId(entry?.subjectId ?? '')
    setTeacherIds(entry ? teacherIdsOf(entry) : [])
    setRoomId(entry?.roomId ?? '')
    setFormOpen(true)
  }

  const subjectOptions: SmartOption[] = subjects.map((s) => ({
    value: s.id, label: s.name, color: s.color ?? undefined, sublabel: s.code ?? undefined,
  }))
  const roomOptions: SmartOption[] = rooms.map((r) => ({ value: r.id, label: r.name }))

  const timeLabel = slot.start_time && slot.end_time
    ? `${slot.start_time.slice(0, 5)}–${slot.end_time.slice(0, 5)}`
    : null

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="bg-white border border-[#D4D4D8] shadow-xl w-full max-w-md max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header — where in the week this cell sits */}
        <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-3 border-b border-[#E4E4E7] sticky top-0 bg-white">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-sm font-semibold text-[#18181B]">
              <GraduationCap size={15} className="text-[#71717A] flex-shrink-0" />
              <span className="truncate">{homeroomName}</span>
            </div>
            <div className="flex items-center gap-1.5 text-[11px] text-[#71717A] mt-1">
              <Clock size={12} />
              {WEEKDAY_LABELS[day]} · {slot.label ?? 'Period'}
              {timeLabel && <span className="tabular-nums">· {timeLabel}</span>}
            </div>
          </div>
          <button onClick={onClose} className="text-[#A1A1AA] hover:text-[#18181B] flex-shrink-0">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {timeOff && (
            <div className="flex items-start gap-2 px-3 py-2 bg-rose-50 border border-rose-200 text-[12px] text-rose-800">
              <Ban size={13} className="flex-shrink-0 mt-0.5" />
              <span>
                This class is marked <strong>time off</strong> in this period — the generator keeps it free.
                Change it under Homeroom → Time off.
              </span>
            </div>
          )}
          {conflicts.length > 0 && (
            <div className="px-3 py-2 bg-rose-50 border border-rose-200 text-[12px] text-rose-800 space-y-1">
              {conflicts.map((c, i) => (
                <div key={i} className="flex items-start gap-2">
                  <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />
                  <span>{c}</span>
                </div>
              ))}
            </div>
          )}

          {/* What is scheduled here */}
          {entries.length === 0 ? (
            <p className="text-sm text-[#A1A1AA]">{timeOff ? 'Kept free as time off.' : 'This period is free.'}</p>
          ) : (
            <div className="space-y-2">
              {entries.map((entry) => {
                const subj = entry.subjectId ? subjectById.get(entry.subjectId) : null
                const room = entry.roomId ? roomById.get(entry.roomId) : null
                const ids = teacherIdsOf(entry)
                return (
                  <div
                    key={entryKey(entry)}
                    className="border border-[#E4E4E7] bg-[#FAFAF9] p-3"
                    style={{ borderLeft: `3px solid ${subj?.color ?? '#52525B'}` }}
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm text-[#18181B] flex-1 min-w-0 truncate">
                        {subj?.name ?? 'Lesson'}
                      </span>
                      {entry.groupId && (
                        <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 bg-indigo-50 border border-indigo-200 text-indigo-700">
                          <Users size={10} /> {groupName?.(entry.groupId) ?? 'Group'}
                        </span>
                      )}
                      {entry.combinedKey && (
                        <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 bg-indigo-50 border border-indigo-200 text-indigo-700">
                          <Layers size={10} /> Combined
                        </span>
                      )}
                    </div>

                    <div className="mt-2 space-y-1 text-[12px] text-[#52525B]">
                      <div className="flex items-start gap-1.5">
                        <Users size={12} className="flex-shrink-0 mt-0.5 text-[#A1A1AA]" />
                        <span>
                          {ids.length === 0
                            ? 'No teacher assigned'
                            : ids.map((id, i) => (
                                <span key={id}>
                                  {i > 0 && ', '}
                                  {teacherById.get(id)?.full_name ?? 'Teacher'}
                                  {i === 0 && ids.length > 1 && (
                                    <span className="text-[#A1A1AA]"> (primary)</span>
                                  )}
                                </span>
                              ))}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <DoorOpen size={12} className="flex-shrink-0 text-[#A1A1AA]" />
                        <span>{room?.name ?? 'No room'}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 mt-2.5">
                      <button
                        onClick={() => onTogglePin(entry)}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium border transition-colors ${
                          entry.isLocked
                            ? 'bg-[#27272A] text-white border-[#27272A] hover:bg-[#18181B]'
                            : 'bg-white text-[#52525B] border-[#D4D4D8] hover:bg-[#F5F5F5]'
                        }`}
                        title={entry.isLocked ? 'Unpin — the generator may move it' : 'Pin to this period — regenerating keeps it here'}
                      >
                        {entry.isLocked ? <PinOff size={12} /> : <Pin size={12} />}
                        {entry.isLocked ? 'Unpin' : 'Pin here'}
                      </button>
                      {!entry.combinedKey && (
                        <>
                          <button
                            onClick={() => startEdit(entry)}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium bg-white border border-[#D4D4D8] text-[#52525B] hover:bg-[#F5F5F5] transition-colors"
                          >
                            <Pencil size={12} /> Edit
                          </button>
                          <button
                            onClick={() => onClear(entry)}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-50 transition-colors ml-auto"
                          >
                            <Trash2 size={12} /> Remove
                          </button>
                        </>
                      )}
                    </div>
                    {entry.combinedKey && (
                      <p className="text-[11px] text-[#A1A1AA] mt-2">
                        Part of a combined lesson — edit it from the Homeroom hub. Pinning moves every class of it together.
                      </p>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {/* Edit / add */}
          {formOpen ? (
            <div className="border-t border-[#E4E4E7] pt-4 space-y-3">
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#525252]">
                {editing ? 'Edit lesson' : 'Add a lesson'}
                {editing?.groupId && ` · ${groupName?.(editing.groupId) ?? 'Group'}`}
              </p>
              <div>
                <span className="block text-[10px] font-bold uppercase tracking-widest text-[#525252] mb-1.5">Subject</span>
                <SmartSelect options={subjectOptions} value={subjectId} onChange={setSubjectId} placeholder="Select subject…" searchPlaceholder="Search subjects…" />
              </div>
              <div>
                <span className="block text-[10px] font-bold uppercase tracking-widest text-[#525252] mb-1.5">Teachers</span>
                <MultiTeacherSelect teachers={teachers} value={teacherIds} onChange={setTeacherIds} compact />
              </div>
              <div>
                <span className="block text-[10px] font-bold uppercase tracking-widest text-[#525252] mb-1.5">Room</span>
                <SmartSelect options={roomOptions} value={roomId} onChange={setRoomId} placeholder="None" searchPlaceholder="Search rooms…" allowClear />
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setFormOpen(false)}
                  className="px-3 py-2 text-sm font-medium text-[#71717A] hover:text-[#18181B]"
                >
                  Cancel
                </button>
                <div className="flex-1" />
                <button
                  onClick={() => subjectId && onSave(editing?.groupId ?? null, subjectId, teacherIds, roomId || null)}
                  disabled={!subjectId}
                  className="px-4 py-2 text-sm font-medium bg-[#27272A] text-[#F5F5F5] disabled:opacity-50 hover:bg-[#18181B] transition-colors"
                >
                  Save
                </button>
              </div>
            </div>
          ) : editableEntries.length === 0 ? (
            <button
              onClick={() => startEdit(null)}
              className="w-full px-3 py-2 text-sm font-medium bg-[#F5F5F5] border border-[#D4D4D8] text-[#18181B] hover:bg-[#EBEBEB] transition-colors"
            >
              Add a lesson to this period
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
