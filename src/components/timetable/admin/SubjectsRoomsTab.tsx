'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { Plus, Trash2, Loader2 } from 'lucide-react'
import {
  fetchSubjects, createSubject, deleteSubject,
  fetchRooms, createRoom, deleteRoom,
  ROOM_TYPE_LABELS,
} from '@/lib/timetable'
import type { Subject, Room, RoomType } from '@/lib/timetable'
import { INPUT, BTN_PRIMARY, SECTION_LABEL } from '../ui'

const ROOM_TYPES: RoomType[] = ['classroom', 'science_lab', 'computer_lab', 'other']
const SUBJECT_COLORS = ['#27272A', '#0891b2', '#059669', '#B8983C', '#db2777', '#7c3aed', '#dc2626', '#0d9488']

export default function SubjectsRoomsTab() {
  return (
    <div className="grid lg:grid-cols-2 lg:divide-x lg:divide-[#E4E4E7]">
      <div className="lg:pr-6">
        <SubjectsCard />
      </div>
      <div className="border-t border-[#E4E4E7] pt-5 mt-5 lg:border-t-0 lg:pt-0 lg:mt-0 lg:pl-6">
        <RoomsCard />
      </div>
    </div>
  )
}

function SubjectsCard() {
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [color, setColor] = useState(SUBJECT_COLORS[0])
  const [adding, setAdding] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setSubjects(await fetchSubjects())
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const handleAdd = async () => {
    if (!name.trim()) return
    setAdding(true)
    const created = await createSubject({ name: name.trim(), code: code.trim() || null, color })
    setAdding(false)
    if (created) {
      setName('')
      setCode('')
      load()
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className={SECTION_LABEL}>Subjects</p>
        <span className="text-[11px] text-[#A1A1AA]">{subjects.length}</span>
      </div>

      {loading ? (
        <div className="flex justify-center py-6 text-[#A1A1AA]">
          <Loader2 className="animate-spin" size={18} />
        </div>
      ) : (
        <div className="space-y-px">
          {subjects.map((s) => (
            <div key={s.id} className="flex items-center gap-3 px-3 py-2 bg-[#F5F5F5] border border-[#E4E4E7]">
              <span className="w-3 h-3 flex-shrink-0" style={{ background: s.color || '#94a3b8' }} />
              <span className="text-sm font-medium text-[#18181B] flex-1 truncate">{s.name}</span>
              {s.code && <span className="text-[11px] text-[#A1A1AA] font-mono">{s.code}</span>}
              <button
                onClick={async () => {
                  if (confirm(`Delete subject "${s.name}"?`)) {
                    await deleteSubject(s.id)
                    load()
                  }
                }}
                className="text-[#D4D4D8] hover:text-rose-500 transition-colors flex-shrink-0"
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
          {subjects.length === 0 && <p className="text-xs text-[#A1A1AA] py-2">No subjects yet.</p>}
        </div>
      )}

      <div className="mt-3 space-y-2">
        <div className="flex gap-2">
          <input className={`${INPUT} flex-1`} placeholder="Subject name" value={name} onChange={(e) => setName(e.target.value)} />
          <input className={`${INPUT} w-20`} placeholder="Code" value={code} onChange={(e) => setCode(e.target.value)} />
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-1 flex-1 flex-wrap">
            {SUBJECT_COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setColor(c)}
                className={`w-6 h-6 transition-transform ${color === c ? 'ring-2 ring-offset-1 ring-[#27272A]' : ''}`}
                style={{ background: c }}
              />
            ))}
          </div>
          <button onClick={handleAdd} disabled={adding || !name.trim()} className={BTN_PRIMARY}>
            {adding ? <Loader2 className="animate-spin" size={15} /> : <Plus size={15} />}
            Add
          </button>
        </div>
      </div>
    </div>
  )
}

function RoomsCard() {
  const [rooms, setRooms] = useState<Room[]>([])
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('')
  const [roomType, setRoomType] = useState<RoomType>('classroom')
  const [capacity, setCapacity] = useState('')
  const [adding, setAdding] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setRooms(await fetchRooms())
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const handleAdd = async () => {
    if (!name.trim()) return
    setAdding(true)
    const created = await createRoom({
      name: name.trim(),
      room_type: roomType,
      capacity: capacity ? parseInt(capacity, 10) : null,
    })
    setAdding(false)
    if (created) {
      setName('')
      setCapacity('')
      load()
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className={SECTION_LABEL}>Rooms</p>
        <span className="text-[11px] text-[#A1A1AA]">{rooms.length}</span>
      </div>

      {loading ? (
        <div className="flex justify-center py-6 text-[#A1A1AA]">
          <Loader2 className="animate-spin" size={18} />
        </div>
      ) : (
        <div className="space-y-px">
          {rooms.map((r) => (
            <div key={r.id} className="flex items-center gap-3 px-3 py-2 bg-[#F5F5F5] border border-[#E4E4E7]">
              <span className="text-sm font-medium text-[#18181B] flex-1 truncate">{r.name}</span>
              <span className="text-[11px] px-2 py-0.5 bg-white border border-[#E4E4E7] text-[#71717A]">
                {ROOM_TYPE_LABELS[r.room_type]}
              </span>
              {r.capacity != null && <span className="text-[11px] text-[#A1A1AA]">{r.capacity} seats</span>}
              <button
                onClick={async () => {
                  if (confirm(`Delete room "${r.name}"?`)) {
                    await deleteRoom(r.id)
                    load()
                  }
                }}
                className="text-[#D4D4D8] hover:text-rose-500 transition-colors flex-shrink-0"
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
          {rooms.length === 0 && <p className="text-xs text-[#A1A1AA] py-2">No rooms yet.</p>}
        </div>
      )}

      <div className="mt-3 space-y-2">
        <div className="flex gap-2">
          <input className={`${INPUT} flex-1`} placeholder="Room name" value={name} onChange={(e) => setName(e.target.value)} />
          <input className={`${INPUT} w-20`} placeholder="Seats" type="number" value={capacity} onChange={(e) => setCapacity(e.target.value)} />
        </div>
        <div className="flex items-center gap-2">
          <select
            className={`${INPUT} flex-1`}
            value={roomType}
            onChange={(e) => setRoomType(e.target.value as RoomType)}
          >
            {ROOM_TYPES.map((t) => (
              <option key={t} value={t}>
                {ROOM_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
          <button onClick={handleAdd} disabled={adding || !name.trim()} className={BTN_PRIMARY}>
            {adding ? <Loader2 className="animate-spin" size={15} /> : <Plus size={15} />}
            Add
          </button>
        </div>
      </div>
    </div>
  )
}
