'use client'

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import {
  Loader2, Plus, Trash2, X, Users, UserCog, ListChecks, CalendarOff, Layers,
  Upload, UserPlus, AlertTriangle, Search, GraduationCap,
} from 'lucide-react'
import * as XLSX from 'xlsx'
import {
  fetchSubjects, fetchRooms, fetchPeriodSlots, fetchRequirements, fetchConstraints,
  createRequirement, deleteRequirement, createCombinedClass, fetchCombinedClasses, deleteCombinedClass,
  fetchGroupsForHomeroom, createGroup, deleteGroup, removeGroupMember,
  addGroupMemberByEmail, bulkAddGroupMembersByIds, fetchClassroomStudentsInHomeroom,
  addConstraint, deleteConstraint, ROOM_TYPE_LABELS,
} from '@/lib/timetable'
import type {
  TimetableConfig, Subject, Room, PeriodSlot, Requirement, TimetableConstraint,
  HomeroomGroup, HomeroomGroupKind, RoomType, Weekday, CombinedClass,
} from '@/lib/timetable'
import { fetchAllHomerooms, fetchHomeroomWithMembers, updateHomeroomClassTeacher } from '@/lib/homerooms'
import type { Homeroom, HomeroomMember } from '@/lib/homerooms'
import { fetchAllClassrooms } from '@/lib/classrooms'
import type { Classroom } from '@/lib/classrooms'
import { fetchAllProfiles } from '@/lib/admin'
import { isStaffRole } from '@/lib/supabase'
import type { UserProfile } from '@/lib/supabase'
import useDebounce from '@/hooks/useDebounce'
import { INPUT, BTN_PRIMARY, SegmentedNav, SmartSelect, Section, Field } from '../../ui'
import type { SegItem, SmartOption } from '../../ui'
import SmartTypeahead from '@/components/SmartTypeahead'
import NameLink from '../../NameLink'
import { TimeOffGrid } from '../constraintAtoms'

const GROUP_COLORS = ['#2563eb', '#059669', '#d97706', '#7c3aed', '#db2777', '#0891b2', '#dc2626', '#65a30d']

type Panel = 'teacher' | 'groups' | 'requirements' | 'timeoff'
const PANELS: SegItem<Panel>[] = [
  { key: 'teacher', label: 'Class teacher', icon: UserCog },
  { key: 'groups', label: 'Groups', icon: Users },
  { key: 'requirements', label: 'Requirements', icon: ListChecks },
  { key: 'timeoff', label: 'Time off', icon: CalendarOff },
]

// A homeroom is "active" while it hasn't expired.
const isActiveHomeroom = (h: Homeroom) => !h.expiry_date || h.expiry_date >= new Date().toISOString().slice(0, 10)

/**
 * The Homeroom hub — one place to manage a class's teacher, groups (with CSV /
 * typeahead / bulk-add), subject requirements (whole-class, per-group, or
 * combined with other homerooms), and time off. Opened from the workspace
 * toolbar's Homeroom button.
 */
export default function HomeroomModal({ config }: { config: TimetableConfig | null }) {
  const [homerooms, setHomerooms] = useState<Homeroom[]>([])
  const [teachers, setTeachers] = useState<UserProfile[]>([])
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [rooms, setRooms] = useState<Room[]>([])
  const [classrooms, setClassrooms] = useState<Classroom[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [panel, setPanel] = useState<Panel>('teacher')

  const loadRefs = useCallback(async () => {
    setLoading(true)
    const [hr, profiles, subj, rms, cls] = await Promise.all([
      fetchAllHomerooms(), fetchAllProfiles(), fetchSubjects(), fetchRooms(), fetchAllClassrooms(),
    ])
    setHomerooms(hr)
    setTeachers(profiles.filter((p) => isStaffRole(p.role)))
    setSubjects(subj)
    setRooms(rms)
    setClassrooms(cls)
    setLoading(false)
  }, [])

  useEffect(() => { loadRefs() }, [loadRefs])

  const active = useMemo(() => homerooms.filter(isActiveHomeroom), [homerooms])
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? active.filter((h) => h.name.toLowerCase().includes(q)) : active
  }, [active, query])

  useEffect(() => {
    if (filtered.length > 0 && !filtered.some((h) => h.id === selectedId)) setSelectedId(filtered[0].id)
  }, [filtered, selectedId])

  const selected = homerooms.find((h) => h.id === selectedId) ?? null

  const patchHomeroom = (id: string, patch: Partial<Homeroom>) =>
    setHomerooms((prev) => prev.map((h) => (h.id === id ? { ...h, ...patch } : h)))

  if (loading) {
    return <div className="flex justify-center py-16 text-[#A1A1AA]"><Loader2 className="animate-spin" size={22} /></div>
  }

  return (
    <div className="grid gap-0 sm:grid-cols-[16rem_1fr] sm:h-[28rem] border border-[#E4E4E7]">
      {/* Column 1 — active homerooms */}
      <div className="border-b sm:border-b-0 sm:border-r border-[#E4E4E7] bg-[#FAFAF9] flex flex-col min-h-0">
        <div className="p-2.5 border-b border-[#E4E4E7]">
          <div className="flex items-center gap-2 border border-[#D4D4D8] bg-white px-2.5 py-1.5">
            <Search size={13} className="text-[#A1A1AA] flex-shrink-0" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search homerooms…"
              className="flex-1 min-w-0 bg-transparent text-sm focus:outline-none"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto max-h-64 sm:max-h-none p-1.5 space-y-px">
          {filtered.length === 0 ? (
            <p className="text-xs text-[#A1A1AA] p-2">No active homerooms.</p>
          ) : (
            filtered.map((h) => (
              <button
                key={h.id}
                onClick={() => setSelectedId(h.id)}
                className={`w-full text-left px-2.5 py-2 text-sm transition-colors ${
                  h.id === selectedId ? 'bg-[#27272A] text-white' : 'text-[#3F3F46] hover:bg-[#EBEBEB]'
                }`}
              >
                <div className="font-medium truncate">{h.name}</div>
                <div className={`text-[11px] truncate ${h.id === selectedId ? 'text-white/60' : 'text-[#A1A1AA]'}`}>
                  {h.class_teacher_id
                    ? teachers.find((t) => t.id === h.class_teacher_id)?.full_name ?? 'Class teacher set'
                    : 'No class teacher'}
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Column 2 — detail for the selected homeroom */}
      <div className="min-w-0 min-h-0 flex flex-col">
        {!selected ? (
          <div className="flex-1 flex items-center justify-center text-sm text-[#A1A1AA] p-6">
            Select a homeroom.
          </div>
        ) : (
          <>
            <div className="px-4 pt-3.5 pb-2 border-b border-[#E4E4E7]">
              <div className="flex items-center gap-2 mb-2.5">
                <GraduationCap size={16} className="text-[#71717A]" />
                <NameLink kind="homeroom" id={selected.id} name={selected.name} className="font-semibold text-[#18181B]" />
              </div>
              <SegmentedNav items={PANELS} value={panel} onChange={setPanel} />
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              {panel === 'teacher' && (
                <ClassTeacherPanel
                  homeroom={selected} teachers={teachers}
                  onSaved={(tid) => patchHomeroom(selected.id, { class_teacher_id: tid })}
                />
              )}
              {panel === 'groups' && (
                <GroupsPanel homeroom={selected} subjects={subjects} classrooms={classrooms} />
              )}
              {panel === 'requirements' && (
                config
                  ? <RequirementsPanel config={config} homeroom={selected} subjects={subjects} teachers={teachers} rooms={rooms} homerooms={active} />
                  : <NeedConfig />
              )}
              {panel === 'timeoff' && (
                config ? <TimeOffPanel config={config} homeroom={selected} /> : <NeedConfig />
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function NeedConfig() {
  return (
    <p className="text-sm text-[#71717A] py-6 text-center">
      Select or create a timetable configuration (Configuration button) to edit this.
    </p>
  )
}

// ── Class teacher — smart typeahead with a 500ms debounce ─────

function ClassTeacherPanel({
  homeroom, teachers, onSaved,
}: {
  homeroom: Homeroom
  teachers: UserProfile[]
  onSaved: (teacherId: string | null) => void
}) {
  const [query, setQuery] = useState('')
  const debounced = useDebounce(query, 500)
  const [saving, setSaving] = useState(false)

  const current = teachers.find((t) => t.id === homeroom.class_teacher_id) ?? null

  const suggestions = useMemo(() => {
    const q = debounced.trim().toLowerCase()
    if (!q) return []
    return teachers.filter(
      (t) => t.full_name?.toLowerCase().includes(q) || t.email?.toLowerCase().includes(q),
    )
  }, [debounced, teachers])

  const assign = async (teacherId: string | null) => {
    setSaving(true)
    const ok = await updateHomeroomClassTeacher(homeroom.id, teacherId)
    setSaving(false)
    if (ok) { onSaved(teacherId); setQuery('') }
  }

  return (
    <Section title="Class teacher" hint="Type a staff name — suggestions appear 500ms after you stop typing." first>
      {current ? (
        <div className="flex items-center gap-3 px-3 py-2 bg-[#F5F5F5] border border-[#E4E4E7] mb-3">
          <UserCog size={15} className="text-[#71717A] flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <NameLink kind="teacher" id={current.id} name={current.full_name} className="text-sm font-medium text-[#18181B]" />
            <div className="text-[11px] text-[#71717A] truncate">{current.email}</div>
          </div>
          <button onClick={() => assign(null)} disabled={saving} className="text-[#A1A1AA] hover:text-rose-500 transition-colors" title="Remove class teacher">
            {saving ? <Loader2 className="animate-spin" size={15} /> : <X size={16} />}
          </button>
        </div>
      ) : (
        <p className="text-xs text-[#A1A1AA] mb-3">No class teacher assigned yet.</p>
      )}

      <SmartTypeahead<UserProfile>
        query={query}
        onQueryChange={setQuery}
        suggestions={suggestions}
        onSelect={(t) => assign(t.id)}
        getKey={(t) => t.id}
        placeholder="Search staff…"
        renderSuggestion={(t, active) => (
          <div className={`px-3 py-2 text-sm ${active ? 'bg-[#F5F5F5]' : 'bg-white'}`}>
            <div className="font-medium text-[#18181B]">{t.full_name}</div>
            <div className="text-[11px] text-[#71717A]">{t.email}</div>
          </div>
        )}
      />
    </Section>
  )
}

// ── Groups — create + CSV / typeahead / bulk-add ─────────────

function GroupsPanel({
  homeroom, subjects, classrooms,
}: {
  homeroom: Homeroom
  subjects: Subject[]
  classrooms: Classroom[]
}) {
  const [groups, setGroups] = useState<HomeroomGroup[]>([])
  const [roster, setRoster] = useState<HomeroomMember[]>([])
  const [loading, setLoading] = useState(true)

  // New-group form
  const [name, setName] = useState('')
  const [kind, setKind] = useState<HomeroomGroupKind>('custom')
  const [subjectId, setSubjectId] = useState('')
  const [color, setColor] = useState(GROUP_COLORS[0])
  const [adding, setAdding] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const [g, hr] = await Promise.all([
      fetchGroupsForHomeroom(homeroom.id),
      fetchHomeroomWithMembers(homeroom.id),
    ])
    setGroups(g)
    setRoster(hr?.members ?? [])
    setLoading(false)
  }, [homeroom.id])

  useEffect(() => { load() }, [load])

  const subjectOptions: SmartOption[] = useMemo(
    () => subjects.map((s) => ({ value: s.id, label: s.name, color: s.color ?? undefined })),
    [subjects],
  )

  const handleAdd = async () => {
    if (!name.trim()) return
    setAdding(true)
    const created = await createGroup({
      homeroom_id: homeroom.id,
      name: name.trim(),
      kind,
      subject_id: kind === 'subject' ? subjectId || null : null,
      color,
    })
    setAdding(false)
    if (created) {
      setName(''); setSubjectId(''); setKind('custom')
      setColor(GROUP_COLORS[(groups.length + 1) % GROUP_COLORS.length])
      load()
    }
  }

  return (
    <div>
      <Section
        title="Add a group"
        hint="Subject-based (Biology vs Computer) or custom. Then fill it by CSV, typeahead, or by pulling a subject classroom's students in bulk."
        first
      >
        <div className="grid gap-3 sm:grid-cols-2 items-end">
          <Field label="Group name">
            <input className={INPUT} placeholder="e.g. Biology / Group A" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Type">
            <select className={INPUT} value={kind} onChange={(e) => setKind(e.target.value as HomeroomGroupKind)}>
              <option value="custom">Custom</option>
              <option value="subject">Subject-based</option>
            </select>
          </Field>
          {kind === 'subject' && (
            <Field label="Subject">
              <SmartSelect options={subjectOptions} value={subjectId} onChange={setSubjectId} placeholder="Select subject…" searchPlaceholder="Search subjects…" allowClear />
            </Field>
          )}
          <Field label="Colour">
            <div className="flex gap-1 flex-wrap pt-1">
              {GROUP_COLORS.map((c) => (
                <button key={c} type="button" onClick={() => setColor(c)} className={`w-6 h-6 border-2 ${color === c ? 'border-[#18181B]' : 'border-transparent'}`} style={{ background: c }} />
              ))}
            </div>
          </Field>
        </div>
        <button onClick={handleAdd} disabled={adding || !name.trim()} className={`${BTN_PRIMARY} mt-3`}>
          {adding ? <Loader2 className="animate-spin" size={15} /> : <Plus size={15} />}
          Add group
        </button>
      </Section>

      <Section title="Groups">
        {loading ? (
          <div className="flex justify-center py-8 text-[#A1A1AA]"><Loader2 className="animate-spin" size={20} /></div>
        ) : groups.length === 0 ? (
          <p className="text-xs text-[#A1A1AA] py-2">No groups yet for this class.</p>
        ) : (
          <div className="space-y-4">
            {groups.map((g) => (
              <GroupCard key={g.id} group={g} homeroom={homeroom} roster={roster} classrooms={classrooms} onChanged={load} />
            ))}
          </div>
        )}
      </Section>
    </div>
  )
}

function GroupCard({
  group, homeroom, roster, classrooms, onChanged,
}: {
  group: HomeroomGroup
  homeroom: Homeroom
  roster: HomeroomMember[]
  classrooms: Classroom[]
  onChanged: () => void
}) {
  const members = group.members ?? []
  const memberIds = useMemo(() => new Set(members.map((m) => m.student_id)), [members])

  const [mode, setMode] = useState<'type' | 'bulk' | 'csv'>('type')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  // Typeahead — searches the homeroom roster (not yet in this group).
  const [query, setQuery] = useState('')
  const debounced = useDebounce(query, 500)
  const suggestions = useMemo(() => {
    const q = debounced.trim().toLowerCase()
    if (!q) return []
    return roster
      .filter((m) => !memberIds.has(m.student_id))
      .filter((m) => (m.student?.full_name?.toLowerCase().includes(q) || m.student?.email?.toLowerCase().includes(q)))
  }, [debounced, roster, memberIds])

  const addOne = async (studentId: string) => {
    setBusy(true)
    const { added } = await bulkAddGroupMembersByIds(group.id, [studentId])
    setBusy(false)
    setQuery('')
    if (added) onChanged()
  }

  // Bulk-add — classroom filter (subject) + roster checkbox list.
  const [classroomId, setClassroomId] = useState('')
  const [pool, setPool] = useState<UserProfile[]>([])  // classroom-filtered pool
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [loadingPool, setLoadingPool] = useState(false)

  const rosterPool: UserProfile[] = useMemo(
    () => roster.map((m) => m.student).filter((s): s is UserProfile => !!s),
    [roster],
  )

  const classroomOptions: SmartOption[] = useMemo(
    () => classrooms.map((c) => ({ value: c.id, label: c.title, sublabel: c.subject ?? undefined })),
    [classrooms],
  )

  useEffect(() => {
    setChecked(new Set())
    if (!classroomId) { setPool([]); return }
    setLoadingPool(true)
    fetchClassroomStudentsInHomeroom(classroomId, homeroom.id).then((s) => {
      setPool(s); setLoadingPool(false)
    })
  }, [classroomId, homeroom.id])

  const shownPool = (classroomId ? pool : rosterPool).filter((s) => !memberIds.has(s.id))
  const toggleCheck = (id: string) =>
    setChecked((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })

  const commitBulk = async () => {
    if (checked.size === 0) return
    setBusy(true)
    const { added } = await bulkAddGroupMembersByIds(group.id, [...checked])
    setBusy(false)
    setChecked(new Set())
    setMsg(`Added ${added} student${added === 1 ? '' : 's'}.`)
    onChanged()
  }

  // CSV upload — emails column, resolved against the parent homeroom.
  const fileRef = useRef<HTMLInputElement>(null)
  const onCsv = async (file: File) => {
    setBusy(true); setMsg('')
    try {
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(buf, { type: 'array' })
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: '' })
      const emails: string[] = []
      for (const r of rows) {
        for (const [k, v] of Object.entries(r)) {
          if (/e-?mail/i.test(k) && String(v).trim()) emails.push(String(v).trim())
        }
      }
      let added = 0
      const failed: string[] = []
      for (const email of emails) {
        const res = await addGroupMemberByEmail(group.id, email)
        if (res.success) added++
        else failed.push(email)
      }
      setMsg(`Added ${added} from CSV${failed.length ? `, ${failed.length} skipped` : ''}.`)
      onChanged()
    } catch {
      setMsg('Could not read that file.')
    }
    setBusy(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  const modeTab = (m: typeof mode, label: string) => (
    <button
      onClick={() => { setMode(m); setMsg('') }}
      className={`px-2.5 py-1 text-xs font-medium border ${mode === m ? 'bg-[#27272A] text-white border-[#27272A]' : 'bg-white text-[#52525B] border-[#D4D4D8] hover:bg-[#F5F5F5]'}`}
    >
      {label}
    </button>
  )

  return (
    <div className="border border-[#E4E4E7] bg-white">
      <div className="flex items-center gap-2.5 px-3 py-2 border-b border-[#E4E4E7] bg-[#FAFAF9]">
        <span className="w-3 h-3 flex-shrink-0" style={{ background: group.color ?? '#94a3b8' }} />
        <span className="font-semibold text-sm text-[#18181B] flex-1 truncate">{group.name}</span>
        {group.kind === 'subject' && group.subject && (
          <span className="text-[10px] px-1.5 py-0.5 bg-white border border-[#E4E4E7] text-[#71717A]">{group.subject.name}</span>
        )}
        <span className="text-[11px] text-[#71717A] flex items-center gap-1"><Users size={12} /> {members.length}</span>
        <button
          onClick={async () => { if (confirm(`Delete group "${group.name}"?`)) { await deleteGroup(group.id); onChanged() } }}
          className="text-[#D4D4D8] hover:text-rose-500 transition-colors flex-shrink-0"
        >
          <Trash2 size={14} />
        </button>
      </div>

      {/* Members */}
      <div className="p-3 space-y-px max-h-40 overflow-y-auto">
        {members.length === 0 ? (
          <p className="text-xs text-[#A1A1AA] py-1">No students yet.</p>
        ) : members.map((m) => (
          <div key={m.id} className="flex items-center gap-2 px-2 py-1.5 bg-[#F5F5F5] border border-[#E4E4E7] text-sm">
            <NameLink kind="student" id={m.student_id} name={m.student?.full_name ?? m.student?.email ?? 'Student'} className="flex-1 min-w-0 truncate text-[#18181B]" />
            <button onClick={async () => { await removeGroupMember(group.id, m.student_id); onChanged() }} className="text-[#D4D4D8] hover:text-rose-500 transition-colors flex-shrink-0">
              <X size={14} />
            </button>
          </div>
        ))}
      </div>

      {/* Add students */}
      <div className="p-3 pt-0">
        <div className="flex gap-1 mb-2">
          {modeTab('type', 'Typeahead')}
          {modeTab('bulk', 'Bulk select')}
          {modeTab('csv', 'CSV')}
        </div>

        {mode === 'type' && (
          <SmartTypeahead<HomeroomMember>
            query={query}
            onQueryChange={setQuery}
            suggestions={suggestions}
            onSelect={(m) => addOne(m.student_id)}
            getKey={(m) => m.student_id}
            placeholder="Search this homeroom's students…"
            renderSuggestion={(m, active) => (
              <div className={`px-3 py-2 text-sm ${active ? 'bg-[#F5F5F5]' : 'bg-white'}`}>
                <div className="font-medium text-[#18181B]">{m.student?.full_name ?? m.student?.email}</div>
                {m.student?.email && <div className="text-[11px] text-[#71717A]">{m.student.email}</div>}
              </div>
            )}
          />
        )}

        {mode === 'bulk' && (
          <div>
            <div className="mb-2">
              <SmartSelect
                options={classroomOptions}
                value={classroomId}
                onChange={setClassroomId}
                placeholder="Whole homeroom roster"
                searchPlaceholder="Filter by classroom…"
                allowClear
              />
            </div>
            {loadingPool ? (
              <div className="flex justify-center py-4 text-[#A1A1AA]"><Loader2 className="animate-spin" size={16} /></div>
            ) : shownPool.length === 0 ? (
              <p className="text-xs text-[#A1A1AA] py-1">{classroomId ? 'No matching students in this homeroom.' : 'No students to add.'}</p>
            ) : (
              <>
                <div className="flex items-center justify-between mb-1.5">
                  <button
                    onClick={() => setChecked(checked.size === shownPool.length ? new Set() : new Set(shownPool.map((s) => s.id)))}
                    className="text-xs font-medium text-[#3F3F46] hover:text-[#18181B] underline underline-offset-2"
                  >
                    {checked.size === shownPool.length ? 'Clear all' : 'Select all'}
                  </button>
                  <span className="text-[11px] text-[#A1A1AA]">{checked.size} selected</span>
                </div>
                <div className="max-h-96 overflow-y-auto border border-[#E4E4E7] divide-y divide-[#F1F1F1]">
                  {shownPool.map((s) => (
                    <label key={s.id} className="flex items-center gap-2 px-2.5 py-1.5 text-sm hover:bg-[#F5F5F5] cursor-pointer">
                      <input type="checkbox" checked={checked.has(s.id)} onChange={() => toggleCheck(s.id)} className="accent-[#27272A]" />
                      <span className="flex-1 min-w-0 truncate text-[#18181B]">{s.full_name ?? s.email}</span>
                    </label>
                  ))}
                </div>
                <button onClick={commitBulk} disabled={busy || checked.size === 0} className={`${BTN_PRIMARY} mt-2`}>
                  {busy ? <Loader2 className="animate-spin" size={14} /> : <UserPlus size={14} />}
                  Add {checked.size > 0 ? checked.size : ''} selected
                </button>
              </>
            )}
          </div>
        )}

        {mode === 'csv' && (
          <div>
            <input
              ref={fileRef} type="file" accept=".csv,.xlsx,.xls"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) onCsv(f) }}
              className="hidden"
            />
            <button onClick={() => fileRef.current?.click()} disabled={busy} className={`${BTN_PRIMARY}`}>
              {busy ? <Loader2 className="animate-spin" size={14} /> : <Upload size={14} />}
              Upload CSV of emails
            </button>
            <p className="text-[11px] text-[#A1A1AA] mt-1.5">A column named “email”. Only students already in this homeroom are added.</p>
          </div>
        )}

        {msg && <p className="mt-1.5 text-xs text-emerald-600">{msg}</p>}
      </div>
    </div>
  )
}

// ── Requirements + combined ──────────────────────────────────

const ROOM_TYPES: RoomType[] = ['classroom', 'science_lab', 'computer_lab', 'other']

function RequirementsPanel({
  config, homeroom, subjects, teachers, rooms, homerooms,
}: {
  config: TimetableConfig
  homeroom: Homeroom
  subjects: Subject[]
  teachers: UserProfile[]
  rooms: Room[]
  homerooms: Homeroom[]
}) {
  const [requirements, setRequirements] = useState<Requirement[]>([])
  const [combined, setCombined] = useState<CombinedClass[]>([])
  const [groups, setGroups] = useState<HomeroomGroup[]>([])
  const [loading, setLoading] = useState(true)

  // Form
  const [subjectId, setSubjectId] = useState('')
  const [teacherId, setTeacherId] = useState('')
  const [groupId, setGroupId] = useState('')
  const [perWeek, setPerWeek] = useState('5')
  const [maxPerDay, setMaxPerDay] = useState('1')
  const [blockSize, setBlockSize] = useState('1')
  const [roomType, setRoomType] = useState<RoomType>('classroom')
  const [isCombined, setIsCombined] = useState(false)
  const [combinedName, setCombinedName] = useState('')
  const [roomId, setRoomId] = useState('')
  const [extraMembers, setExtraMembers] = useState<{ homeroomId: string; groupId: string | null }[]>([])
  const [extraGroups, setExtraGroups] = useState<Record<string, HomeroomGroup[]>>({})
  const [pickExtra, setPickExtra] = useState('')
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const [reqs, cmb, g] = await Promise.all([
      fetchRequirements(config.id),
      fetchCombinedClasses(config.id),
      fetchGroupsForHomeroom(homeroom.id),
    ])
    setRequirements(reqs.filter((r) => r.homeroom_id === homeroom.id))
    setCombined(cmb.filter((c) => (c.members ?? []).some((m) => m.homeroom_id === homeroom.id)))
    setGroups(g)
    setLoading(false)
  }, [config.id, homeroom.id])

  useEffect(() => { load() }, [load])
  useEffect(() => { setGroupId(''); setExtraMembers([]) }, [homeroom.id])

  const subjectName = (id: string | null) => (id ? subjects.find((s) => s.id === id)?.name ?? '—' : '—')
  const subjectColor = (id: string) => subjects.find((s) => s.id === id)?.color ?? '#94a3b8'
  const teacherName = (id: string | null) => (id ? teachers.find((t) => t.id === id)?.full_name ?? 'Unknown' : 'Unassigned')
  const homeroomName = (id: string) => homerooms.find((h) => h.id === id)?.name ?? '—'

  const subjectOptions: SmartOption[] = useMemo(() => subjects.map((s) => ({ value: s.id, label: s.name, color: s.color ?? undefined, sublabel: s.code ?? undefined })), [subjects])
  const teacherOptions: SmartOption[] = useMemo(() => teachers.map((t) => ({ value: t.id, label: t.full_name, sublabel: t.email })), [teachers])
  const roomOptions: SmartOption[] = useMemo(() => rooms.map((r) => ({ value: r.id, label: r.name })), [rooms])
  const extraOptions: SmartOption[] = useMemo(
    () => homerooms.filter((h) => h.id !== homeroom.id && !extraMembers.some((m) => m.homeroomId === h.id)).map((h) => ({ value: h.id, label: h.name })),
    [homerooms, homeroom.id, extraMembers],
  )

  const addExtraMember = (id: string) => {
    if (!id || extraMembers.some((m) => m.homeroomId === id)) return
    setExtraMembers((p) => [...p, { homeroomId: id, groupId: null }])
    if (!extraGroups[id]) {
      fetchGroupsForHomeroom(id).then((g) => setExtraGroups((prev) => ({ ...prev, [id]: g })))
    }
  }

  const setExtraGroupId = (homeroomId: string, gid: string) =>
    setExtraMembers((p) => p.map((m) => (m.homeroomId === homeroomId ? { ...m, groupId: gid || null } : m)))

  const handleAdd = async () => {
    setError('')
    if (!subjectId) { setError('Pick a subject.'); return }
    setAdding(true)
    if (isCombined) {
      const members = [{ homeroomId: homeroom.id, groupId: groupId || null }, ...extraMembers]
      if (members.length < 2) { setError('Add at least one more class for a combined lesson.'); setAdding(false); return }
      const created = await createCombinedClass({
        config_id: config.id,
        name: combinedName.trim() || `${homeroomName(homeroom.id)} ${subjectName(subjectId)}`,
        subject_id: subjectId,
        teacher_id: teacherId || null,
        room_id: roomId || null,
        periods_per_week: Math.max(1, parseInt(perWeek, 10) || 1),
        members,
      })
      setAdding(false)
      if (created) { resetForm(); load() } else setError('Could not create the combined lesson.')
    } else {
      const block = Math.max(1, parseInt(blockSize, 10) || 1)
      const created = await createRequirement({
        config_id: config.id,
        homeroom_id: homeroom.id,
        subject_id: subjectId,
        teacher_id: teacherId || null,
        periods_per_week: Math.max(1, parseInt(perWeek, 10) || 1),
        room_type: roomType,
        max_per_day: Math.max(1, parseInt(maxPerDay, 10) || 1),
        min_block: block,
        max_block: block,
        group_id: groupId || null,
      })
      setAdding(false)
      if (created) { resetForm(); load() } else setError('Could not add — this class may already have that subject.')
    }
  }

  const resetForm = () => {
    setSubjectId(''); setTeacherId(''); setGroupId(''); setBlockSize('1')
    setIsCombined(false); setCombinedName(''); setRoomId(''); setExtraMembers([])
  }

  return (
    <div>
      <Section title="Add a requirement" hint="What this class studies, how often, and who teaches it." first>
        {groups.length > 0 && !isCombined && (
          <div className="flex items-start gap-2 mb-3 px-3 py-2 bg-amber-50 border border-amber-200 text-[12px] text-amber-800">
            <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
            <span>
              This homeroom is split into groups. For split subjects, add one requirement <strong>per group</strong> with
              matching periods/week so the parallel groups schedule into the same slots. A whole-class requirement ignores the split.
            </span>
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Subject">
            <SmartSelect options={subjectOptions} value={subjectId} onChange={setSubjectId} placeholder="Select subject…" searchPlaceholder="Search subjects…" />
          </Field>
          <Field label="Teacher">
            <SmartSelect options={teacherOptions} value={teacherId} onChange={setTeacherId} placeholder="Unassigned" searchPlaceholder="Search staff…" allowClear />
          </Field>
          {!isCombined && groups.length > 0 && (
            <Field label="Group (split class)">
              <select className={INPUT} value={groupId} onChange={(e) => setGroupId(e.target.value)}>
                <option value="">Whole class</option>
                {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </Field>
          )}
          <Field label="Periods / week">
            <input className={INPUT} type="number" min={1} value={perWeek} onChange={(e) => setPerWeek(e.target.value)} />
          </Field>
          {!isCombined && (
            <>
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
                  {ROOM_TYPES.map((t) => <option key={t} value={t}>{ROOM_TYPE_LABELS[t]}</option>)}
                </select>
              </Field>
            </>
          )}
        </div>

        {/* Combined toggle */}
        <label className="flex items-center gap-2 mt-3 text-sm text-[#3F3F46]">
          <input type="checkbox" checked={isCombined} onChange={(e) => setIsCombined(e.target.checked)} className="accent-[#27272A]" />
          <Layers size={14} className="text-indigo-500" />
          Combined lesson — several homerooms attend together (one teacher, one room)
        </label>

        {isCombined && (
          <div className="mt-3 grid gap-3 sm:grid-cols-2 border-l-2 border-indigo-200 pl-3">
            <Field label="Combined name">
              <input className={INPUT} placeholder="e.g. Grade 10 Music" value={combinedName} onChange={(e) => setCombinedName(e.target.value)} />
            </Field>
            <Field label="Room">
              <SmartSelect options={roomOptions} value={roomId} onChange={setRoomId} placeholder="Any room" searchPlaceholder="Search rooms…" allowClear />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Add classes (with this homeroom)">
                <SmartSelect
                  options={extraOptions}
                  value={pickExtra}
                  onChange={(id) => { addExtraMember(id); setPickExtra('') }}
                  placeholder="Add another homeroom…"
                  searchPlaceholder="Search classes…"
                />
              </Field>
              <p className="text-[11px] text-[#A1A1AA] mt-1.5">
                Each class defaults to attending as a whole — pick a group instead if only part of a class joins.
                The combined lesson still shows up on every homeroom listed here.
              </p>
              <div className="flex flex-wrap gap-1.5 mt-2">
                <span className="inline-flex items-center gap-1 text-xs pl-2 pr-1 py-1 bg-indigo-50 border border-indigo-200 text-indigo-800">
                  {homeroom.name} (this)
                  {groups.length > 0 && (
                    <select
                      value={groupId}
                      onChange={(e) => setGroupId(e.target.value)}
                      className="bg-white/60 border border-indigo-200 text-[11px] px-1 py-0.5 focus:outline-none"
                    >
                      <option value="">Whole class</option>
                      {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                    </select>
                  )}
                </span>
                {extraMembers.map((m) => (
                  <span key={m.homeroomId} className="inline-flex items-center gap-1 text-xs pl-2 pr-1 py-1 bg-[#F5F5F5] border border-[#E4E4E7]">
                    {homeroomName(m.homeroomId)}
                    {(extraGroups[m.homeroomId]?.length ?? 0) > 0 && (
                      <select
                        value={m.groupId ?? ''}
                        onChange={(e) => setExtraGroupId(m.homeroomId, e.target.value)}
                        className="bg-white border border-[#E4E4E7] text-[11px] px-1 py-0.5 focus:outline-none"
                      >
                        <option value="">Whole class</option>
                        {extraGroups[m.homeroomId].map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                      </select>
                    )}
                    <button onClick={() => setExtraMembers((p) => p.filter((x) => x.homeroomId !== m.homeroomId))} className="text-[#A1A1AA] hover:text-rose-500"><X size={12} /></button>
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}

        {error && <p className="text-sm text-rose-600 mt-2">{error}</p>}
        <button onClick={handleAdd} disabled={adding} className={`${BTN_PRIMARY} mt-3`}>
          {adding ? <Loader2 className="animate-spin" size={15} /> : <Plus size={15} />}
          {isCombined ? 'Add combined lesson' : 'Add requirement'}
        </button>
      </Section>

      <Section title="This homeroom's schedule">
        {loading ? (
          <div className="flex justify-center py-8 text-[#A1A1AA]"><Loader2 className="animate-spin" size={20} /></div>
        ) : requirements.length === 0 && combined.length === 0 ? (
          <p className="text-xs text-[#A1A1AA] py-2">Nothing yet for {homeroom.name}.</p>
        ) : (
          <div className="space-y-px">
            {requirements.map((r) => (
              <div key={r.id} className="flex items-center gap-2.5 px-3 py-2 bg-[#F5F5F5] border border-[#E4E4E7] text-sm">
                <span className="w-2.5 h-2.5 flex-shrink-0" style={{ background: subjectColor(r.subject_id) }} />
                <span className="font-medium text-[#18181B] flex-1 min-w-0 truncate">{subjectName(r.subject_id)}</span>
                {r.group && (
                  <span className="text-[10px] px-1.5 py-0.5 flex-shrink-0 text-white" style={{ background: r.group.color ?? '#6366f1' }}>{r.group.name}</span>
                )}
                <span className="text-[#71717A] hidden sm:inline truncate max-w-[7rem]">{teacherName(r.teacher_id)}</span>
                <span className="text-[11px] px-1.5 py-0.5 bg-white border border-[#E4E4E7] text-[#71717A] flex-shrink-0">{r.periods_per_week}/wk</span>
                <button onClick={async () => { await deleteRequirement(r.id); load() }} className="text-[#D4D4D8] hover:text-rose-500 transition-colors flex-shrink-0"><Trash2 size={15} /></button>
              </div>
            ))}
            {combined.map((c) => (
              <div key={c.id} className="flex items-center gap-2.5 px-3 py-2 bg-indigo-50/50 border border-indigo-100 text-sm">
                <Layers size={15} className="text-indigo-500 flex-shrink-0" />
                <span className="font-medium text-[#18181B] flex-shrink-0">{c.name}</span>
                <span className="text-[#A1A1AA] flex-1 min-w-0 truncate">
                  {(c.members ?? []).map((m) => homeroomName(m.homeroom_id) + (m.group ? ` (${m.group.name})` : '')).join(', ')}
                </span>
                <span className="text-[11px] px-1.5 py-0.5 bg-white border border-[#E4E4E7] text-[#71717A] flex-shrink-0">{c.periods_per_week}/wk</span>
                <button onClick={async () => { if (confirm(`Delete combined lesson "${c.name}"?`)) { await deleteCombinedClass(c.id); load() } }} className="text-[#D4D4D8] hover:text-rose-500 transition-colors flex-shrink-0"><Trash2 size={15} /></button>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  )
}

// ── Time off ─────────────────────────────────────────────────

function TimeOffPanel({ config, homeroom }: { config: TimetableConfig; homeroom: Homeroom }) {
  const [slots, setSlots] = useState<PeriodSlot[]>([])
  const [constraints, setConstraints] = useState<TimetableConstraint[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const [sl, cons] = await Promise.all([fetchPeriodSlots(config.id), fetchConstraints(config.id)])
    setSlots(sl.filter((s) => !s.is_break))
    setConstraints(cons)
    setLoading(false)
  }, [config.id])

  useEffect(() => { load() }, [load])

  const isOff = (day: Weekday, slotId: string) =>
    constraints.some((c) => c.type === 'time_off' && c.scope === 'homeroom' && c.scope_id === homeroom.id && c.day === day && c.slot_id === slotId)
  const isPinned = (day: Weekday, slotId: string) =>
    constraints.some((c) => c.type === 'pin_class_teacher' && c.scope === 'class_teacher' && c.scope_id === homeroom.id && c.day === day && c.slot_id === slotId)

  const toggle = (type: 'time_off' | 'pin_class_teacher') => async (day: Weekday, slotId: string) => {
    const scope = type === 'time_off' ? 'homeroom' : 'class_teacher'
    const existing = constraints.find((c) => c.type === type && c.scope_id === homeroom.id && c.day === day && c.slot_id === slotId)
    if (existing) {
      await deleteConstraint(existing.id)
      setConstraints((prev) => prev.filter((c) => c.id !== existing.id))
    } else {
      const created = await addConstraint({ config_id: config.id, scope, scope_id: homeroom.id, type, day, slot_id: slotId })
      if (created) setConstraints((prev) => [...prev, created])
    }
  }

  if (loading) return <div className="flex justify-center py-8 text-[#A1A1AA]"><Loader2 className="animate-spin" size={20} /></div>
  if (slots.length === 0) return <p className="text-sm text-[#71717A] py-6 text-center">Add teaching period slots first (Configuration).</p>

  return (
    <div>
      <Section title="Time off" hint="Tap a period to keep this class free (assembly, etc.). The generator never schedules it there." first>
        <TimeOffGrid days={config.working_days} slots={slots} isOn={isOff} onToggle={toggle('time_off')} />
      </Section>
      <Section
        title="Pin class teacher"
        hint={homeroom.class_teacher_id
          ? 'Tap a period to require this homeroom’s class teacher to be with them then.'
          : 'Assign a class teacher (Class teacher tab) to pin them to periods.'}
      >
        {homeroom.class_teacher_id ? (
          <TimeOffGrid days={config.working_days} slots={slots} isOn={isPinned} label="Pinned" onColor="indigo" onToggle={toggle('pin_class_teacher')} />
        ) : (
          <p className="text-xs text-[#A1A1AA]">No class teacher assigned yet.</p>
        )}
      </Section>
    </div>
  )
}
