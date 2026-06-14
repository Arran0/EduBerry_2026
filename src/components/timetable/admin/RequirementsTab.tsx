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

const input =
  'border border-slate-300 rounded-lg bg-white px-3 py-2 text-sm focus:outline-none focus:border-slate-800 transition-colors'

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
  const teacherName = (id: string | null) =>
    id ? teachers.find((t) => t.id === id)?.full_name ?? 'Unknown' : 'Unassigned'
  const homeroomName = (id: string) => homerooms.find((h) => h.id === id)?.name ?? '—'

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
      <section className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
        <h3 className="font-semibold text-slate-800 mb-1">Add a requirement</h3>
        <p className="text-xs text-slate-500 mb-3">
          Define what each class must study, how many periods per week, and who teaches it.
        </p>

        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <select className={input} value={homeroomId} onChange={(e) => setHomeroomId(e.target.value)}>
            <option value="">Class…</option>
            {homerooms.map((h) => (
              <option key={h.id} value={h.id}>{h.name}</option>
            ))}
          </select>
          <select className={input} value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
            <option value="">Subject…</option>
            {subjects.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          <select className={input} value={teacherId} onChange={(e) => setTeacherId(e.target.value)}>
            <option value="">Teacher (optional)…</option>
            {teachers.map((t) => (
              <option key={t.id} value={t.id}>{t.full_name}</option>
            ))}
          </select>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <span className="w-28">Periods / week</span>
            <input className={`${input} w-20`} type="number" min={1} value={perWeek} onChange={(e) => setPerWeek(e.target.value)} />
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <span className="w-28">Max / day</span>
            <input className={`${input} w-20`} type="number" min={1} value={maxPerDay} onChange={(e) => setMaxPerDay(e.target.value)} />
          </label>
          <select className={input} value={roomType} onChange={(e) => setRoomType(e.target.value as RoomType)}>
            {ROOM_TYPES.map((t) => (
              <option key={t} value={t}>{ROOM_TYPE_LABELS[t]}</option>
            ))}
          </select>
        </div>

        {error && <p className="text-sm text-rose-600 mt-2">{error}</p>}

        <button
          onClick={handleAdd}
          disabled={adding}
          className="mt-3 inline-flex items-center gap-1.5 bg-indigo-600 text-white px-3 py-2 rounded-lg text-sm font-medium disabled:opacity-50 hover:bg-indigo-700 transition-colors"
        >
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
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-8 text-center text-slate-500 text-sm">
          No requirements yet for <strong>{config.name}</strong>.
        </div>
      ) : (
        [...grouped.entries()].map(([hrId, rs]) => (
          <section key={hrId} className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
            <div className="flex items-center justify-between mb-2">
              <h4 className="font-semibold text-slate-800">{homeroomName(hrId)}</h4>
              <span className="text-xs text-slate-500">{weeklyTotal(rs)} periods / week</span>
            </div>
            <div className="space-y-1.5">
              {rs.map((r) => (
                <div key={r.id} className="flex items-center gap-3 rounded-lg border border-slate-200 px-3 py-2 text-sm">
                  <span className="font-medium text-slate-700 flex-1">{subjectName(r.subject_id)}</span>
                  <span className="text-slate-500">{teacherName(r.teacher_id)}</span>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                    {r.periods_per_week}/wk
                  </span>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                    {ROOM_TYPE_LABELS[r.room_type]}
                  </span>
                  <button
                    onClick={async () => {
                      await deleteRequirement(r.id)
                      loadRequirements()
                    }}
                    className="text-slate-400 hover:text-rose-600 transition-colors"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  )
}
