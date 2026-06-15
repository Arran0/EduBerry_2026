'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { Plus, Trash2, Loader2 } from 'lucide-react'
import {
  fetchSubjects, createSubject, deleteSubject,
  fetchRooms, createRoom, deleteRoom,
  ROOM_TYPE_LABELS,
} from '@/lib/timetable'
import type { Subject, Room, RoomType } from '@/lib/timetable'
import { PANEL, PANEL_PAD, INPUT, BTN_PRIMARY, PanelHeading } from '../ui'

const ROOM_TYPES: RoomType[] = ['classroom', 'science_lab', 'computer_lab', 'other']
const SUBJECT_COLORS = ['#4f46e5', '#0891b2', '#059669', '#d97706', '#db2777', '#7c3aed', '#dc2626', '#0d9488']

export default function SubjectsRoomsTab() {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <SubjectsCard />
      <RoomsCard />
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
    <section className={`${PANEL} ${PANEL_PAD}`}>
      <PanelHeading title="Subjects" right={<span className="text-xs text-slate-400">{subjects.length}</span>} />

      {loading ? (
        <div className="flex justify-center py-6 text-slate-400">
          <Loader2 className="animate-spin" size={18} />
        </div>
      ) : (
        <div className="space-y-1.5">
          {subjects.map((s) => (
            <div key={s.id} className="flex items-center gap-3 rounded-lg border border-slate-200 px-3 py-2">
              <span
                className="w-3 h-3 rounded-full flex-shrink-0"
                style={{ background: s.color || '#94a3b8' }}
              />
              <span className="text-sm font-medium text-slate-700 flex-1 truncate">{s.name}</span>
              {s.code && <span className="text-xs text-slate-400 font-mono">{s.code}</span>}
              <button
                onClick={async () => {
                  if (confirm(`Delete subject "${s.name}"?`)) {
                    await deleteSubject(s.id)
                    load()
                  }
                }}
                className="text-slate-400 hover:text-rose-600 transition-colors"
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
          {subjects.length === 0 && <p className="text-sm text-slate-500 py-2">No subjects yet.</p>}
        </div>
      )}

      <div className="mt-4 pt-4 border-t border-slate-100 space-y-2.5">
        <div className="flex gap-2">
          <input className={`${INPUT} flex-1`} placeholder="Subject name" value={name} onChange={(e) => setName(e.target.value)} />
          <input className={`${INPUT} w-20`} placeholder="Code" value={code} onChange={(e) => setCode(e.target.value)} />
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-1.5 flex-1 flex-wrap">
            {SUBJECT_COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setColor(c)}
                className={`w-6 h-6 rounded-full transition-transform ${color === c ? 'ring-2 ring-offset-1 ring-slate-400 scale-110' : ''}`}
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
    </section>
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
    <section className={`${PANEL} ${PANEL_PAD}`}>
      <PanelHeading title="Rooms" right={<span className="text-xs text-slate-400">{rooms.length}</span>} />

      {loading ? (
        <div className="flex justify-center py-6 text-slate-400">
          <Loader2 className="animate-spin" size={18} />
        </div>
      ) : (
        <div className="space-y-1.5">
          {rooms.map((r) => (
            <div key={r.id} className="flex items-center gap-3 rounded-lg border border-slate-200 px-3 py-2">
              <span className="text-sm font-medium text-slate-700 flex-1 truncate">{r.name}</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                {ROOM_TYPE_LABELS[r.room_type]}
              </span>
              {r.capacity != null && <span className="text-xs text-slate-400">{r.capacity} seats</span>}
              <button
                onClick={async () => {
                  if (confirm(`Delete room "${r.name}"?`)) {
                    await deleteRoom(r.id)
                    load()
                  }
                }}
                className="text-slate-400 hover:text-rose-600 transition-colors"
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
          {rooms.length === 0 && <p className="text-sm text-slate-500 py-2">No rooms yet.</p>}
        </div>
      )}

      <div className="mt-4 pt-4 border-t border-slate-100 space-y-2.5">
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
    </section>
  )
}
