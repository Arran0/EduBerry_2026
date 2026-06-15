'use client'

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { Plus, Trash2, Loader2 } from 'lucide-react'
import {
  fetchRequirements, createRequirement, deleteRequirement,
  fetchSubjects, ROOM_TYPE_LABELS,
} from '@/lib/timetable'
import type { Requirement, Subject, RoomType, TimetableConfig } from '@/lib/timetable'
import { fetchAllHomerooms } from '@/lib/homerooms'
import type { Homeroom } from '@/lib/homerooms'
import { fetchAllProfiles } from '@/lib/admin'
import { isStaffRole } from '@/lib/supabase'
import type { UserProfile } from '@/lib/supabase'
import { PANEL, PANEL_PAD, INPUT, BTN_PRIMARY, PanelHeading, SmartSelect } from '../ui'
import type { SmartOption } from '../ui'

const ROOM_TYPES: RoomType[] = ['classroom', 'science_lab', 'computer_lab', 'other']

export default function RequirementsTab({ config }: { config: TimetableConfig }) {
  const [requirements, setRequirements] = useState<Requirement[]>([])
  const [homerooms, setHomerooms] = useState<Homeroom[]>([])
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [teachers, setTeachers] = useState<UserProfile[]>([])
  const [loading, setLoading] = useState(true)

  // New-requirement form
  const [homeroomId, setHomeroomId] = useState('')
  const [subjectId, setSubjectId] = useState('')
  const [teacherId, setTeacherId] = useState('')
  const [perWeek, setPerWeek] = useState('5')
  const [roomType, setRoomType] = useState<RoomType>('classroom')
  const [maxPerDay, setMaxPerDay] = useState('1')
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState('')

  const loadRefs = useCallback(async () => {
    const [hr, subj, profiles] = await Promise.all([
      fetchAllHomerooms(),
      fetchSubjects(),
      fetchAllProfiles(),
    ])
    setHomerooms(hr)
    setSubjects(subj)
    setTeachers(profiles.filter((p) => isStaffRole(p.role)))
  }, [])

  const loadRequirements = useCallback(async () => {
    setLoading(true)
    setRequirements(await fetchRequirements(config.id))
    setLoading(false)
  }, [config.id])

  useEffect(() => {
    loadRefs()
  }, [loadRefs])

  useEffect(() => {
    loadRequirements()
  }, [loadRequirements])

  const subjectName = (id: string) => subjects.find((s) => s.id === id)?.name ?? '—'
  const subjectColor = (id: string) => subjects.find((s) => s.id === id)?.color ?? '#94a3b8'
  const teacherName = (id: string | null) =>
    id ? teachers.find((t) => t.id === id)?.full_name ?? 'Unknown' : 'Unassigned'
  const homeroomName = (id: string) => homerooms.find((h) => h.id === id)?.name ?? '—'

  const homeroomOptions: SmartOption[] = useMemo(
    () => homerooms.map((h) => ({ value: h.id, label: h.name })),
    [homerooms],
  )
  const subjectOptions: SmartOption[] = useMemo(
    () => subjects.map((s) => ({ value: s.id, label: s.name, color: s.color ?? undefined, sublabel: s.code ?? undefined })),
    [subjects],
  )
  const teacherOptions: SmartOption[] = useMemo(
    () => teachers.map((t) => ({ value: t.id, label: t.full_name, sublabel: t.email })),
    [teachers],
  )

  // Group requirements by homeroom for a readable layout.
  const grouped = useMemo(() => {
    const map = new Map<string, Requirement[]>()
    for (const r of requirements) {
      if (!map.has(r.homeroom_id)) map.set(r.homeroom_id, [])
      map.get(r.homeroom_id)!.push(r)
    }
    return map
  }, [requirements])

  const handleAdd = async () => {
    setError('')
    if (!homeroomId || !subjectId) {
      setError('Pick a class and a subject.')
      return
    }
    setAdding(true)
    const created = await createRequirement({
      config_id: config.id,
      homeroom_id: homeroomId,
      subject_id: subjectId,
      teacher_id: teacherId || null,
      periods_per_week: Math.max(1, parseInt(perWeek, 10) || 1),
      room_type: roomType,
      max_per_day: Math.max(1, parseInt(maxPerDay, 10) || 1),
    })
    setAdding(false)
    if (created) {
      setSubjectId('')
      setTeacherId('')
      loadRequirements()
    } else {
      setError('Could not add — this class may already have that subject.')
    }
  }

  const weeklyTotal = (rs: Requirement[]) => rs.reduce((n, r) => n + r.periods_per_week, 0)

  return (
    <div className="space-y-4">
      {/* Add requirement */}
      <section className={`${PANEL} ${PANEL_PAD}`}>
        <PanelHeading
          title="Add a requirement"
          hint="Define what each class must study, how many periods per week, and who teaches it."
        />

        <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500">Class</label>
            <SmartSelect
              options={homeroomOptions}
              value={homeroomId}
              onChange={setHomeroomId}
              placeholder="Select class…"
              searchPlaceholder="Search classes…"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500">Subject</label>
            <SmartSelect
              options={subjectOptions}
              value={subjectId}
              onChange={setSubjectId}
              placeholder="Select subject…"
              searchPlaceholder="Search subjects…"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500">Teacher</label>
            <SmartSelect
              options={teacherOptions}
              value={teacherId}
              onChange={setTeacherId}
              placeholder="Unassigned"
              searchPlaceholder="Search staff…"
              allowClear
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500">Periods / week</label>
            <input className={INPUT} type="number" min={1} value={perWeek} onChange={(e) => setPerWeek(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500">Max / day</label>
            <input className={INPUT} type="number" min={1} value={maxPerDay} onChange={(e) => setMaxPerDay(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500">Room type</label>
            <select className={INPUT} value={roomType} onChange={(e) => setRoomType(e.target.value as RoomType)}>
              {ROOM_TYPES.map((t) => (
                <option key={t} value={t}>{ROOM_TYPE_LABELS[t]}</option>
              ))}
            </select>
          </div>
        </div>

        {error && <p className="text-sm text-rose-600 mt-2">{error}</p>}

        <button onClick={handleAdd} disabled={adding} className={`${BTN_PRIMARY} mt-3`}>
          {adding ? <Loader2 className="animate-spin" size={15} /> : <Plus size={15} />}
          Add requirement
        </button>
      </section>

      {/* Existing requirements grouped by class */}
      {loading ? (
        <div className="flex justify-center py-10 text-slate-400">
          <Loader2 className="animate-spin" size={20} />
        </div>
      ) : grouped.size === 0 ? (
        <div className={`${PANEL} p-8 text-center text-slate-500 text-sm`}>
          No requirements yet for <strong>{config.name}</strong>.
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {[...grouped.entries()].map(([hrId, rs]) => (
            <section key={hrId} className={`${PANEL} ${PANEL_PAD}`}>
              <div className="flex items-center justify-between mb-3">
                <h4 className="font-semibold text-slate-800 truncate">{homeroomName(hrId)}</h4>
                <span className="text-xs font-medium text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full flex-shrink-0">
                  {weeklyTotal(rs)} / week
                </span>
              </div>
              <div className="space-y-1.5">
                {rs.map((r) => (
                  <div key={r.id} className="flex items-center gap-2.5 rounded-lg border border-slate-200 px-3 py-2 text-sm">
                    <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: subjectColor(r.subject_id) }} />
                    <span className="font-medium text-slate-700 flex-1 min-w-0 truncate">{subjectName(r.subject_id)}</span>
                    <span className="text-slate-500 hidden sm:inline truncate max-w-[8rem]">{teacherName(r.teacher_id)}</span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 flex-shrink-0">
                      {r.periods_per_week}/wk
                    </span>
                    <button
                      onClick={async () => {
                        await deleteRequirement(r.id)
                        loadRequirements()
                      }}
                      className="text-slate-400 hover:text-rose-600 transition-colors flex-shrink-0"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
