'use client'

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { Plus, Trash2, Loader2, Users, X, Layers } from 'lucide-react'
import {
  fetchCombinedClasses, createCombinedClass, deleteCombinedClass, fetchRooms,
} from '@/lib/timetable'
import type { CombinedClass, Subject, Room, TimetableConfig } from '@/lib/timetable'
import type { Homeroom } from '@/lib/homerooms'
import type { UserProfile } from '@/lib/supabase'
import { INPUT, BTN_PRIMARY, Section, Field, SmartSelect } from '../ui'
import type { SmartOption } from '../ui'
import NameLink from '../NameLink'

// Several homerooms attend one lesson together — one teacher, one room.
export default function CombinedClassesSection({
  config, subjects, homerooms, teachers,
}: {
  config: TimetableConfig
  subjects: Subject[]
  homerooms: Homeroom[]
  teachers: UserProfile[]
}) {
  const [combined, setCombined] = useState<CombinedClass[]>([])
  const [rooms, setRooms] = useState<Room[]>([])
  const [loading, setLoading] = useState(true)

  // Form
  const [name, setName] = useState('')
  const [subjectId, setSubjectId] = useState('')
  const [teacherId, setTeacherId] = useState('')
  const [roomId, setRoomId] = useState('')
  const [perWeek, setPerWeek] = useState('1')
  const [memberIds, setMemberIds] = useState<string[]>([])
  const [pickHomeroom, setPickHomeroom] = useState('')
  const [adding, setAdding] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const [cc, rms] = await Promise.all([fetchCombinedClasses(config.id), fetchRooms()])
    setCombined(cc)
    setRooms(rms)
    setLoading(false)
  }, [config.id])

  useEffect(() => {
    load()
  }, [load])

  const subjectOptions: SmartOption[] = useMemo(
    () => subjects.map((s) => ({ value: s.id, label: s.name, color: s.color ?? undefined })),
    [subjects],
  )
  const teacherOptions: SmartOption[] = useMemo(
    () => teachers.map((t) => ({ value: t.id, label: t.full_name, sublabel: t.email })),
    [teachers],
  )
  const roomOptions: SmartOption[] = useMemo(
    () => rooms.map((r) => ({ value: r.id, label: r.name })),
    [rooms],
  )
  const homeroomOptions: SmartOption[] = useMemo(
    () => homerooms.filter((h) => !memberIds.includes(h.id)).map((h) => ({ value: h.id, label: h.name })),
    [homerooms, memberIds],
  )
  const homeroomName = (id: string) => homerooms.find((h) => h.id === id)?.name ?? '—'
  const subjectName = (id: string | null) => (id ? subjects.find((s) => s.id === id)?.name ?? '—' : '—')

  const addMember = (id: string) => {
    if (id && !memberIds.includes(id)) setMemberIds((prev) => [...prev, id])
    setPickHomeroom('')
  }

  const handleAdd = async () => {
    if (!name.trim() || !subjectId || memberIds.length < 2) return
    setAdding(true)
    const created = await createCombinedClass({
      config_id: config.id,
      name: name.trim(),
      subject_id: subjectId,
      teacher_id: teacherId || null,
      room_id: roomId || null,
      periods_per_week: Math.max(1, parseInt(perWeek, 10) || 1),
      homeroomIds: memberIds,
    })
    setAdding(false)
    if (created) {
      setName(''); setSubjectId(''); setTeacherId(''); setRoomId(''); setPerWeek('1'); setMemberIds([])
      load()
    }
  }

  return (
    <Section title="Combined classes" hint="Merge several homerooms into one lesson with a single teacher and room (e.g. Music in the Hall). Add at least two classes.">
      {/* Form */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Name">
          <input className={INPUT} placeholder="e.g. Grade 10 Music" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Subject">
          <SmartSelect options={subjectOptions} value={subjectId} onChange={setSubjectId} placeholder="Select subject…" searchPlaceholder="Search subjects…" />
        </Field>
        <Field label="Teacher">
          <SmartSelect options={teacherOptions} value={teacherId} onChange={setTeacherId} placeholder="Unassigned" searchPlaceholder="Search staff…" allowClear />
        </Field>
        <Field label="Room">
          <SmartSelect options={roomOptions} value={roomId} onChange={setRoomId} placeholder="Any room" searchPlaceholder="Search rooms…" allowClear />
        </Field>
        <Field label="Periods / week">
          <input className={INPUT} type="number" min={1} value={perWeek} onChange={(e) => setPerWeek(e.target.value)} />
        </Field>
        <Field label="Add class">
          <SmartSelect options={homeroomOptions} value={pickHomeroom} onChange={addMember} placeholder="Add a homeroom…" searchPlaceholder="Search classes…" />
        </Field>
      </div>

      {memberIds.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-3">
          {memberIds.map((id) => (
            <span key={id} className="inline-flex items-center gap-1 text-xs px-2 py-1 bg-[#F5F5F5] border border-[#E4E4E7]">
              {homeroomName(id)}
              <button onClick={() => setMemberIds((prev) => prev.filter((x) => x !== id))} className="text-[#A1A1AA] hover:text-rose-500">
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}

      <button onClick={handleAdd} disabled={adding || !name.trim() || !subjectId || memberIds.length < 2} className={`${BTN_PRIMARY} mt-3`}>
        {adding ? <Loader2 className="animate-spin" size={15} /> : <Plus size={15} />}
        Add combined class
      </button>

      {/* Existing */}
      <div className="mt-5">
        {loading ? (
          <div className="flex justify-center py-6 text-[#A1A1AA]"><Loader2 className="animate-spin" size={18} /></div>
        ) : combined.length === 0 ? (
          <p className="text-xs text-[#A1A1AA]">No combined classes yet.</p>
        ) : (
          <div className="space-y-px">
            {combined.map((c) => (
              <div key={c.id} className="flex items-center gap-2.5 px-3 py-2 bg-[#F5F5F5] border border-[#E4E4E7] text-sm">
                <Layers size={15} className="text-indigo-500 flex-shrink-0" />
                <span className="font-medium text-[#18181B] flex-shrink-0">{c.name}</span>
                <span className="text-[#71717A] hidden sm:inline">{subjectName(c.subject_id)}</span>
                {c.teacher_id && (
                  <NameLink kind="teacher" id={c.teacher_id} name={c.teacher?.full_name ?? 'Teacher'} className="text-[#71717A] hidden md:inline" />
                )}
                <span className="text-[#A1A1AA] flex items-center gap-1 flex-1 min-w-0 truncate">
                  <Users size={12} className="flex-shrink-0" />
                  {(c.members ?? []).map((m) => homeroomName(m.homeroom_id)).join(', ')}
                </span>
                <span className="text-[11px] px-1.5 py-0.5 bg-white border border-[#E4E4E7] text-[#71717A] flex-shrink-0">{c.periods_per_week}/wk</span>
                <button
                  onClick={async () => {
                    if (confirm(`Delete combined class "${c.name}"?`)) { await deleteCombinedClass(c.id); load() }
                  }}
                  className="text-[#D4D4D8] hover:text-rose-500 transition-colors flex-shrink-0"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </Section>
  )
}
