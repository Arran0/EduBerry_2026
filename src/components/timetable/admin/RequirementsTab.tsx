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
import { INPUT, BTN_PRIMARY, Section, Field, SmartSelect } from '../ui'
import type { SmartOption } from '../ui'
import NameLink from '../NameLink'

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
  const [blockSize, setBlockSize] = useState('1')
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
    const block = Math.max(1, parseInt(blockSize, 10) || 1)
    const created = await createRequirement({
      config_id: config.id,
      homeroom_id: homeroomId,
      subject_id: subjectId,
      teacher_id: teacherId || null,
      periods_per_week: Math.max(1, parseInt(perWeek, 10) || 1),
      room_type: roomType,
      max_per_day: Math.max(1, parseInt(maxPerDay, 10) || 1),
      // A block size > 1 schedules the subject as contiguous double/triple periods.
      min_block: block,
      max_block: block,
    })
    setAdding(false)
    if (created) {
      setSubjectId('')
      setTeacherId('')
      setBlockSize('1')
      loadRequirements()
    } else {
      setError('Could not add — this class may already have that subject.')
    }
  }

  const weeklyTotal = (rs: Requirement[]) => rs.reduce((n, r) => n + r.periods_per_week, 0)

  return (
    <div>
      {/* Add requirement */}
      <Section title="Add a requirement" hint="Define what each class must study, how many periods per week, and who teaches it." first>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Class">
            <SmartSelect options={homeroomOptions} value={homeroomId} onChange={setHomeroomId} placeholder="Select class…" searchPlaceholder="Search classes…" />
          </Field>
          <Field label="Subject">
            <SmartSelect options={subjectOptions} value={subjectId} onChange={setSubjectId} placeholder="Select subject…" searchPlaceholder="Search subjects…" />
          </Field>
          <Field label="Teacher">
            <SmartSelect options={teacherOptions} value={teacherId} onChange={setTeacherId} placeholder="Unassigned" searchPlaceholder="Search staff…" allowClear />
          </Field>
          <Field label="Periods / week">
            <input className={INPUT} type="number" min={1} value={perWeek} onChange={(e) => setPerWeek(e.target.value)} />
          </Field>
          <Field label="Max / day">
            <input className={INPUT} type="number" min={1} value={maxPerDay} onChange={(e) => setMaxPerDay(e.target.value)} />
          </Field>
          <Field label="Block size">
            <select className={INPUT} value={blockSize} onChange={(e) => setBlockSize(e.target.value)}>
              <option value="1">Single</option>
              <option value="2">Double (2 in a row)</option>
              <option value="3">Triple (3 in a row)</option>
            </select>
          </Field>
          <Field label="Room type">
            <select className={INPUT} value={roomType} onChange={(e) => setRoomType(e.target.value as RoomType)}>
              {ROOM_TYPES.map((t) => (
                <option key={t} value={t}>{ROOM_TYPE_LABELS[t]}</option>
              ))}
            </select>
          </Field>
        </div>

        {error && <p className="text-sm text-rose-600 mt-2">{error}</p>}

        <button onClick={handleAdd} disabled={adding} className={`${BTN_PRIMARY} mt-3`}>
          {adding ? <Loader2 className="animate-spin" size={15} /> : <Plus size={15} />}
          Add requirement
        </button>
      </Section>

      {/* Existing requirements grouped by class */}
      <Section title="Requirements by class">
        {loading ? (
          <div className="flex justify-center py-8 text-[#A1A1AA]">
            <Loader2 className="animate-spin" size={20} />
          </div>
        ) : grouped.size === 0 ? (
          <p className="text-xs text-[#A1A1AA] py-2">
            No requirements yet for <strong>{config.name}</strong>.
          </p>
        ) : (
          <div className="grid gap-x-6 gap-y-5 lg:grid-cols-2">
            {[...grouped.entries()].map(([hrId, rs]) => (
              <div key={hrId}>
                <div className="flex items-center justify-between mb-2 pb-1.5 border-b border-[#E4E4E7]">
                  <NameLink
                    kind="homeroom"
                    id={hrId}
                    name={homeroomName(hrId)}
                    className="font-semibold text-sm text-[#18181B] truncate"
                  />
                  <span className="text-[11px] font-medium text-[#71717A] flex-shrink-0">
                    {weeklyTotal(rs)} / week
                  </span>
                </div>
                <div className="space-y-px">
                  {rs.map((r) => (
                    <div key={r.id} className="flex items-center gap-2.5 px-3 py-2 bg-[#F5F5F5] border border-[#E4E4E7] text-sm">
                      <span className="w-2.5 h-2.5 flex-shrink-0" style={{ background: subjectColor(r.subject_id) }} />
                      <span className="font-medium text-[#18181B] flex-1 min-w-0 truncate">{subjectName(r.subject_id)}</span>
                      <NameLink
                        kind="teacher"
                        id={r.teacher_id}
                        name={teacherName(r.teacher_id)}
                        className="text-[#71717A] hidden sm:inline truncate max-w-[7rem]"
                      />
                      <span className="text-[11px] px-1.5 py-0.5 bg-white border border-[#E4E4E7] text-[#71717A] flex-shrink-0">
                        {r.periods_per_week}/wk
                      </span>
                      {r.min_block > 1 && (
                        <span className="text-[11px] px-1.5 py-0.5 bg-indigo-50 border border-indigo-200 text-indigo-700 flex-shrink-0" title={`Scheduled as blocks of ${r.min_block}`}>
                          ×{r.min_block}
                        </span>
                      )}
                      <button
                        onClick={async () => {
                          await deleteRequirement(r.id)
                          loadRequirements()
                        }}
                        className="text-[#D4D4D8] hover:text-rose-500 transition-colors flex-shrink-0"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  )
}
