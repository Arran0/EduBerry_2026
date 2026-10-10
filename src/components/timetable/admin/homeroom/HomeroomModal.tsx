'use client'

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import {
  Loader2, Plus, Trash2, X, Users, UserCog, ListChecks, CalendarOff, Layers,
  Upload, UserPlus, AlertTriangle, GraduationCap, Copy, ClipboardPaste, Pencil, Check,
} from 'lucide-react'
import * as XLSX from 'xlsx'
import {
  fetchSubjects, fetchRooms, fetchPeriodSlots, fetchRequirements, fetchConstraints, teacherIdsOf,
  createRequirement, deleteRequirement, createCombinedClass, fetchCombinedClasses, deleteCombinedClass,
  fetchGroupsForHomeroom, createGroup, deleteGroup, removeGroupMember,
  bulkAddGroupMembersByEmails, bulkAddGroupMembersByIds, fetchClassroomStudentsInHomeroom,
  requirementError, ROOM_TYPE_LABELS, createSubject,
  updateRequirement, updateCombinedClass, copyRequirementsTo, assignHomeroomToSlotGroup,
} from '@/lib/timetable'
import type {
  TimetableConfig, Subject, Room, PeriodSlot, Requirement, TimetableConstraint,
  HomeroomGroup, HomeroomGroupKind, RoomType, Weekday, CombinedClass,
} from '@/lib/timetable'
import { fetchAllHomerooms, fetchHomeroomWithMembers, updateHomeroomClassTeacher } from '@/lib/homerooms'
import type { Homeroom, HomeroomMember } from '@/lib/homerooms'
import { fetchAllClassrooms } from '@/lib/classrooms'
import type { Classroom } from '@/lib/classrooms'
import { fetchStaffProfiles } from '@/lib/admin'
import type { UserProfile } from '@/lib/supabase'
import useDebounce from '@/hooks/useDebounce'
import { INPUT, BTN_PRIMARY, BTN_NEUTRAL, SECTION_LABEL, SegmentedNav, SmartSelect, Section, Field } from '../../ui'
import type { SegItem, SmartOption } from '../../ui'
import SmartTypeahead from '@/components/SmartTypeahead'
import NameLink from '../../NameLink'
import { ColorPicker, SUBJECT_COLORS } from '../colorPicker'
import { searchSubjects } from '@/lib/cbseSubjects'
import MultiTeacherSelect from '../../MultiTeacherSelect'
import { useTimetableDraftOptional } from '../../draft/TimetableDraftContext'
import { OverloadedTeachersNotice } from '../../draft/TeacherLoad'
import { withExtraPeriods } from '@/lib/timetable/workload'
import DraftWeekGrid from '../../draft/DraftWeekGrid'
import {
  EntityShell, EntityList, EntityRow, DetailHeader, EmptyDetail,
} from '../EntityList'
import LessonStatsCard from '../../LessonStatsCard'

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
  // Copied requirements live on the hub, not on the panel, so they survive
  // switching to the class they are going to be pasted into.
  const [clipboard, setClipboard] = useState<{ fromHomeroomId: string; items: Requirement[] } | null>(null)

  const loadRefs = useCallback(async () => {
    setLoading(true)
    const [hr, profiles, subj, rms, cls] = await Promise.all([
      fetchAllHomerooms(), fetchStaffProfiles(), fetchSubjects(), fetchRooms(), fetchAllClassrooms(),
    ])
    setHomerooms(hr)
    setTeachers(profiles)
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
    <EntityShell
      list={
        <EntityList
          query={query}
          onQuery={setQuery}
          placeholder="Search homerooms…"
          count={filtered.length}
          total={active.length}
        >
          {filtered.length === 0 ? (
            <p className="text-xs text-[#A1A1AA] p-2">No active homerooms.</p>
          ) : (
            filtered.map((h) => (
              <EntityRow
                key={h.id}
                selected={h.id === selectedId}
                onClick={() => setSelectedId(h.id)}
                title={h.name}
                subtitle={
                  h.class_teacher_id
                    ? teachers.find((t) => t.id === h.class_teacher_id)?.full_name ?? 'Class teacher set'
                    : 'No class teacher'
                }
              />
            ))
          )}
        </EntityList>
      }
    >
      {!selected ? (
        <EmptyDetail>Select a homeroom.</EmptyDetail>
      ) : (
        <>
          <DetailHeader
            icon={GraduationCap}
            right={<PeriodGroupPicker homeroom={selected} />}
            below={<SegmentedNav items={PANELS} value={panel} onChange={setPanel} />}
          >
            <NameLink kind="homeroom" id={selected.id} name={selected.name} className="font-semibold text-[#18181B]" />
          </DetailHeader>
          <div className="flex-1 overflow-y-auto p-3 sm:p-4">
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
                  ? (
                    <RequirementsPanel
                      config={config} homeroom={selected} subjects={subjects} teachers={teachers}
                      rooms={rooms} homerooms={active}
                      clipboard={clipboard}
                      onCopy={(items, fromHomeroomId) => setClipboard({ fromHomeroomId, items })}
                      onSubjectsChanged={loadRefs}
                    />
                  )
                  : <NeedConfig />
              )}
            {panel === 'timeoff' && (
              config ? <TimeOffPanel homeroom={selected} /> : <NeedConfig />
            )}
          </div>
        </>
      )}
    </EntityShell>
  )
}

function NeedConfig() {
  return (
    <p className="text-sm text-[#71717A] py-6 text-center">
      Select or create a timetable configuration (Configuration button) to edit this.
    </p>
  )
}

/**
 * Which bell schedule this class rings to. Only shown once a config actually
 * has more than one period group — with a single schedule there is nothing to
 * choose and the control would be noise.
 */
function PeriodGroupPicker({ homeroom }: { homeroom: Homeroom }) {
  const draft = useTimetableDraftOptional()
  const [saving, setSaving] = useState(false)
  if (!draft || draft.slotGroups.length === 0) return null

  const current = draft.slotGroupIds[homeroom.id] ?? ''

  return (
    <label className="inline-flex items-center gap-1.5 ml-auto text-[11px] text-[#71717A]">
      <Layers size={13} className="text-indigo-500" />
      Period group
      <select
        className="border border-[#D4D4D8] bg-white text-[11px] px-1.5 py-0.5 focus:outline-none focus:border-[#27272A]"
        value={current}
        disabled={saving}
        onChange={async (e) => {
          setSaving(true)
          await assignHomeroomToSlotGroup(draft.config.id, homeroom.id, e.target.value || null)
          await draft.reload()
          // The class's existing lessons sit in the OLD group's periods, which
          // do not exist in its new week. Leaving them would show lessons the
          // class can't see and count them in clashes, so they are dropped and
          // the class is rebuilt on the next generate.
          draft.setEntries((prev) => prev.filter((x) => x.homeroomId !== homeroom.id))
          setSaving(false)
        }}
      >
        <option value="">Base schedule</option>
        {draft.slotGroups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
      </select>
      {saving && <Loader2 className="animate-spin" size={12} />}
    </label>
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
            <ColorPicker colors={GROUP_COLORS} value={color} onChange={setColor} ariaLabel="Group colour" />
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
  // `group.members ?? []` is a fresh array on every render when members is
  // undefined, which would defeat the memo below.
  const members = useMemo(() => group.members ?? [], [group.members])
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

  // Recomputed on every keystroke of the typeahead above without this — the
  // roster of a big homeroom is not a list to re-filter that often.
  const shownPool = useMemo(
    () => (classroomId ? pool : rosterPool).filter((s) => !memberIds.has(s.id)),
    [classroomId, pool, rosterPool, memberIds],
  )
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
      const { added, failed } = await bulkAddGroupMembersByEmails(group.id, emails)
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

// ── Weekly slot budget ───────────────────────────────────────
// How much of a class's week the requirements already claim. Parallel split
// groups share one period, so a group's periods count once for the class: the
// class-level cost of the groups is the busiest group's total.

interface WeeklyBudget {
  total: number // teaching periods in the week (days × teaching slots)
  timeOff: number // periods the class is kept free by a time-off constraint
  available: number // total − timeOff: what can actually be scheduled
  wholeClass: number // periods claimed by whole-class requirements + combined
  groupPeak: number // periods claimed by the busiest split group
  filled: number // wholeClass + groupPeak
  free: number // available − filled (never below 0)
  over: boolean // requirements ask for more than the week has
  perGroup: { id: string; name: string; color: string | null; periods: number }[]
}

function weeklyBudget({
  homeroom, slots, constraints, requirements, combined, groups, workingDays,
}: {
  homeroom: Homeroom
  slots: PeriodSlot[] // teaching slots only, from the class's period group
  constraints: TimetableConstraint[]
  requirements: Requirement[]
  combined: CombinedClass[]
  groups: HomeroomGroup[]
  // Days in THIS class's week — its period group's, not always the config's.
  workingDays: number
}): WeeklyBudget {
  const total = workingDays * slots.length
  const timeOff = constraints.filter(
    (c) => c.type === 'time_off' && c.scope === 'homeroom' && c.scope_id === homeroom.id,
  ).length

  const byGroup = new Map<string, number>()
  let wholeClass = 0
  for (const r of requirements) {
    if (r.group_id) byGroup.set(r.group_id, (byGroup.get(r.group_id) ?? 0) + r.periods_per_week)
    else wholeClass += r.periods_per_week
  }
  for (const c of combined) {
    const mine = (c.members ?? []).filter((m) => m.homeroom_id === homeroom.id)
    for (const m of mine) {
      if (m.group_id) byGroup.set(m.group_id, (byGroup.get(m.group_id) ?? 0) + c.periods_per_week)
      else wholeClass += c.periods_per_week
    }
  }

  const perGroup = groups
    .map((g) => ({ id: g.id, name: g.name, color: g.color, periods: byGroup.get(g.id) ?? 0 }))
    .filter((g) => g.periods > 0)
    .sort((a, b) => b.periods - a.periods)
  // Groups outside this homeroom's own list (deleted, or another class's) still count.
  const groupPeak = Math.max(0, ...[...byGroup.values()])

  const filled = wholeClass + groupPeak
  const available = Math.max(0, total - timeOff)
  return {
    total, timeOff, available, wholeClass, groupPeak, filled,
    free: Math.max(0, available - filled),
    over: filled > available,
    perGroup,
  }
}

function SlotMeter({ budget }: { budget: WeeklyBudget }) {
  if (budget.total === 0) return null
  // The denominator is what the class can actually be taught in: periods marked
  // as time off are taken out of the week, not counted as unfilled.
  const pct = budget.available === 0 ? 0 : Math.min(100, (budget.filled / budget.available) * 100)
  const tone = budget.over ? 'bg-rose-500' : pct >= 90 ? 'bg-amber-500' : 'bg-emerald-600'
  return (
    <div className="w-40 sm:w-52">
      <div className="flex items-baseline justify-between gap-2">
        <span className={SECTION_LABEL}>Slots filled</span>
        <span className={`text-sm font-semibold tabular-nums ${budget.over ? 'text-rose-600' : 'text-[#18181B]'}`}>
          {budget.filled}
          <span className="text-[#A1A1AA] font-normal">/{budget.available}</span>
        </span>
      </div>
      <div className="h-1.5 bg-[#E4E4E7] mt-1.5" title={`${budget.filled} of ${budget.available} teachable periods claimed`}>
        <div className={`h-full ${tone} transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <p className="text-[11px] text-[#71717A] mt-1 leading-snug">
        {budget.wholeClass} whole-class
        {budget.groupPeak > 0 && ` · ${budget.groupPeak} group`}
        {budget.timeOff > 0 && <span className="text-rose-500"> · {budget.timeOff} off</span>}
        {budget.over && <span className="text-rose-600 font-medium"> · over capacity</span>}
      </p>
      {budget.perGroup.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1.5">
          {budget.perGroup.map((g) => (
            <span key={g.id} className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 text-white" style={{ background: g.color ?? '#6366f1' }}>
              {g.name} {g.periods}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Requirement fields ───────────────────────────────────────
// Shared by "add a requirement" and by editing one in place, so a saved
// requirement is changed against exactly the rules it was created against
// rather than having to be deleted and retyped.

interface ReqDraft {
  subjectId: string
  teacherIds: string[]
  groupId: string
  perWeek: string
  maxPerDay: string
  blockSize: string
  roomType: RoomType
}

const emptyDraft = (): ReqDraft => ({
  subjectId: '', teacherIds: [], groupId: '', perWeek: '5',
  maxPerDay: '1', blockSize: '1', roomType: 'classroom',
})

const combinedDraftOf = (c: CombinedClass): ReqDraft => ({
  subjectId: c.subject_id ?? '',
  teacherIds: teacherIdsOf(c),
  groupId: '',
  perWeek: String(c.periods_per_week),
  maxPerDay: String(Math.max(1, c.max_per_day ?? 1)),
  blockSize: String(Math.max(1, c.min_block ?? 1)),
  roomType: c.room_type ?? 'classroom',
})

const draftOf = (r: Requirement): ReqDraft => ({
  subjectId: r.subject_id,
  teacherIds: teacherIdsOf(r),
  groupId: r.group_id ?? '',
  perWeek: String(r.periods_per_week),
  maxPerDay: String(r.max_per_day),
  blockSize: String(Math.max(1, r.min_block ?? 1)),
  roomType: r.room_type,
})

/**
 * Catches requirements the solver could never satisfy, so they are refused at
 * the form rather than silently generating an unplaceable lesson: a weekly
 * total that exceeds what the daily cap allows across the working week, or a
 * block longer than either that cap or the requirement itself.
 */
function requirementProblem(d: ReqDraft, workingDays: number): string | null {
  const days = Math.max(1, workingDays)
  const week = Math.max(1, parseInt(d.perWeek, 10) || 1)
  const perDay = Math.max(1, parseInt(d.maxPerDay, 10) || 1)
  const block = Math.max(1, parseInt(d.blockSize, 10) || 1)
  if (block > perDay) {
    return `A block of ${block} in a row needs max / day of at least ${block}, not ${perDay}.`
  }
  if (block > week) {
    return `A block of ${block} in a row needs at least ${block} periods a week, not ${week}.`
  }
  if (week > perDay * days) {
    return `${week} periods a week can't fit at ${perDay} a day across ${days} working day${days === 1 ? '' : 's'} (max ${perDay * days}).`
  }
  return null
}

/**
 * Picks a subject, or makes one on the spot.
 *
 * Writing a requirement is where a missing subject is noticed, and leaving to
 * the Subjects hub to add it means losing the half-filled form. The composer
 * carries the same CBSE name typeahead and the same colour strip as the hub,
 * so a subject created here is a normal subject, not a stub to tidy up later.
 */
function SubjectField({
  subjects, value, onChange, onCreated,
}: {
  subjects: Subject[]
  value: string
  onChange: (id: string) => void
  onCreated: () => Promise<void> | void
}) {
  const [composing, setComposing] = useState(false)
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [color, setColor] = useState(SUBJECT_COLORS[0])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)

  const options: SmartOption[] = useMemo(
    () => subjects.map((s) => ({ value: s.id, label: s.name, color: s.color ?? undefined, sublabel: s.code ?? undefined })),
    [subjects],
  )

  const duplicate = subjects.some((s) => s.name.trim().toLowerCase() === name.trim().toLowerCase())

  const reset = () => {
    setComposing(false)
    setName(''); setCode(''); setColor(SUBJECT_COLORS[0])
    setSuggestions([]); setShowSuggestions(false); setError('')
  }

  const create = async () => {
    if (!name.trim() || duplicate) return
    setSaving(true)
    const made = await createSubject({ name: name.trim(), code: code.trim() || null, color })
    setSaving(false)
    if (!made) { setError('Could not create the subject.'); return }
    await onCreated()
    onChange(made.id) // pick it straight away — it is what the form was missing
    reset()
  }

  return (
    <Field label="Subject" group>
      {composing ? (
        <div className="border border-[#27272A] p-2 space-y-2">
          <div className="relative">
            <input
              ref={nameRef}
              autoFocus
              className={INPUT}
              placeholder="Subject name…"
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                const results = searchSubjects(e.target.value)
                setSuggestions(results)
                setShowSuggestions(results.length > 0)
              }}
              onBlur={() => setTimeout(() => setShowSuggestions(false), 120)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); create() }
                if (e.key === 'Escape') reset()
              }}
              autoComplete="off"
            />
            {showSuggestions && (
              <div className="absolute z-20 top-full left-0 right-0 mt-0.5 bg-white border border-[#E4E4E7] shadow-md max-h-40 overflow-y-auto">
                {suggestions.map((sug) => (
                  <button
                    key={sug}
                    type="button"
                    onMouseDown={() => { setName(sug); setShowSuggestions(false); nameRef.current?.focus() }}
                    className="w-full text-left px-3 py-1.5 text-sm text-[#18181B] hover:bg-[#F5F5F5]"
                  >
                    {sug}
                  </button>
                ))}
              </div>
            )}
          </div>

          <ColorPicker colors={SUBJECT_COLORS} value={color} onChange={setColor} ariaLabel="Subject colour" />

          <div className="flex items-stretch gap-1.5">
            <input
              className={`${INPUT} w-24 flex-none`}
              placeholder="Code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); create() } }}
            />
            <button
              type="button"
              onClick={create}
              disabled={saving || !name.trim() || duplicate}
              className={`${BTN_PRIMARY} flex-1 min-w-0 disabled:opacity-40`}
            >
              {saving ? <Loader2 className="animate-spin" size={15} /> : <Plus size={15} />}
              Create &amp; use
            </button>
            <button
              type="button"
              onClick={reset}
              className="text-sm text-[#71717A] hover:text-[#18181B] px-2 transition-colors"
              title="Cancel"
            >
              <X size={15} />
            </button>
          </div>
          {duplicate && (
            <p className="text-[11px] text-amber-700">
              A subject called “{name.trim()}” already exists — pick it from the list instead.
            </p>
          )}
          {error && <p className="text-[11px] text-rose-600">{error}</p>}
        </div>
      ) : (
        <div className="flex items-stretch gap-1.5">
          <div className="flex-1 min-w-0">
            <SmartSelect
              options={options}
              value={value}
              onChange={onChange}
              placeholder="Select subject…"
              searchPlaceholder="Search subjects…"
            />
          </div>
          <button
            type="button"
            onClick={() => setComposing(true)}
            title="Create a new subject without leaving this form"
            className="inline-flex items-center gap-1 px-2 text-xs font-medium text-[#52525B] bg-white border border-[#D4D4D8] hover:bg-[#F5F5F5] hover:text-[#18181B] transition-colors flex-shrink-0"
          >
            <Plus size={14} /> New
          </button>
        </div>
      )}
    </Field>
  )
}

function RequirementFields({
  draft, onChange, subjects, teachers, groups, showGroup, roomTypeHint, onSubjectCreated,
}: {
  draft: ReqDraft
  onChange: (next: ReqDraft) => void
  subjects: Subject[]
  teachers: UserProfile[]
  groups: HomeroomGroup[]
  showGroup: boolean
  /** Explains what the room type means when a specific room can also be set. */
  roomTypeHint?: string
  /** Re-reads the subject list after one is made from inside the form. */
  onSubjectCreated: () => Promise<void> | void
}) {
  const set = <K extends keyof ReqDraft>(k: K, v: ReqDraft[K]) => onChange({ ...draft, [k]: v })

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <SubjectField
        subjects={subjects}
        value={draft.subjectId}
        onChange={(v) => set('subjectId', v)}
        onCreated={onSubjectCreated}
      />
      <Field label="Teachers">
        <MultiTeacherSelect
          teachers={teachers}
          value={draft.teacherIds}
          onChange={(v) => set('teacherIds', v)}
          placeholder="Add a teacher…"
          emptyLabel="Unassigned — add one or more teachers."
        />
      </Field>
      {showGroup && groups.length > 0 && (
        <Field label="Group (split class)">
          <select className={INPUT} value={draft.groupId} onChange={(e) => set('groupId', e.target.value)}>
            <option value="">Whole class</option>
            {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </Field>
      )}
      <Field label="Periods / week">
        <input className={INPUT} type="number" min={1} value={draft.perWeek} onChange={(e) => set('perWeek', e.target.value)} />
      </Field>
      <Field label="Max / day">
        <input className={INPUT} type="number" min={1} value={draft.maxPerDay} onChange={(e) => set('maxPerDay', e.target.value)} />
      </Field>
      <Field label="Block size">
        <select className={INPUT} value={draft.blockSize} onChange={(e) => set('blockSize', e.target.value)}>
          <option value="1">Single</option>
          <option value="2">Double (2 in a row)</option>
          <option value="3">Triple (3 in a row)</option>
        </select>
      </Field>
      <Field label="Room type" hint={roomTypeHint}>
        <select className={INPUT} value={draft.roomType} onChange={(e) => set('roomType', e.target.value as RoomType)}>
          {ROOM_TYPES.map((t) => <option key={t} value={t}>{ROOM_TYPE_LABELS[t]}</option>)}
        </select>
      </Field>
    </div>
  )
}

/**
 * Whether the teachers on a requirement can absorb the periods it is asking
 * for. Answered from saved requirements plus what is in the form, so an
 * impossible assignment is refused as it is typed instead of surfacing as
 * unplaced periods after a generate.
 *
 * `alreadyCounted` is what this requirement currently contributes — zero when
 * adding, its saved periods when editing — so an edit is measured against the
 * change rather than counted twice.
 */
function useTeacherOverload(
  teacherIds: string[],
  perWeek: string,
  alreadyCounted: number,
  teachers: UserProfile[],
) {
  const draft = useTimetableDraftOptional()
  return useMemo(() => {
    if (!draft || teacherIds.length === 0) return []
    const delta = Math.max(1, parseInt(perWeek, 10) || 1) - alreadyCounted
    const name = (id: string) => teachers.find((t) => t.id === id)?.full_name ?? 'This teacher'
    return teacherIds
      .map((id) => ({ id, after: withExtraPeriods(draft.workloadOf(id), delta) }))
      .filter((x) => x.after && x.after.over > 0)
      .map((x) => `${name(x.id)} would be ${x.after!.assigned}/${x.after!.capacity} — ${x.after!.over} over`)
  }, [draft, teacherIds, perWeek, alreadyCounted, teachers])
}

function RequirementsPanel({
  config, homeroom, subjects, teachers, rooms, homerooms, clipboard, onCopy, onSubjectsChanged,
}: {
  config: TimetableConfig
  homeroom: Homeroom
  subjects: Subject[]
  teachers: UserProfile[]
  rooms: Room[]
  homerooms: Homeroom[]
  /** Requirements copied from some homeroom, waiting to be pasted. */
  clipboard: { fromHomeroomId: string; items: Requirement[] } | null
  onCopy: (items: Requirement[], fromHomeroomId: string) => void
  /** Re-reads the hub's subject list after one is created from the form. */
  onSubjectsChanged: () => Promise<void> | void
}) {
  const draftCtx = useTimetableDraftOptional()
  const [requirements, setRequirements] = useState<Requirement[]>([])
  const [combined, setCombined] = useState<CombinedClass[]>([])
  const [groups, setGroups] = useState<HomeroomGroup[]>([])
  const [slots, setSlots] = useState<PeriodSlot[]>([])
  const [constraints, setConstraints] = useState<TimetableConstraint[]>([])
  const [loading, setLoading] = useState(true)

  // Add form
  const [form, setForm] = useState<ReqDraft>(emptyDraft())
  const [isCombined, setIsCombined] = useState(false)
  const [combinedName, setCombinedName] = useState('')
  const [roomId, setRoomId] = useState('')
  const [extraMembers, setExtraMembers] = useState<{ homeroomId: string; groupId: string | null }[]>([])
  const [extraGroups, setExtraGroups] = useState<Record<string, HomeroomGroup[]>>({})
  const [pickExtra, setPickExtra] = useState('')
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState('')

  // Editing an existing row in place. `editingKind` says which list the id is
  // in — a requirement and a combined lesson share the same field set but not
  // the same table.
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingKind, setEditingKind] = useState<'requirement' | 'combined'>('requirement')
  const [editDraft, setEditDraft] = useState<ReqDraft>(emptyDraft())
  const [editName, setEditName] = useState('')
  const [editRoomId, setEditRoomId] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)
  const [editError, setEditError] = useState('')
  const [pasting, setPasting] = useState(false)
  const [note, setNote] = useState('')

  // The week this class is actually scheduled against — its period group's, or
  // the config's. Both the capacity meter and the "can this ever fit" checks
  // have to use it, or a Saturday class is told it has five days.
  const week = draftCtx?.weekFor(homeroom.id) ?? null
  const workingDays = week?.days.length ?? config.working_days.length

  // A combined lesson is one period that every member class sits in at once,
  // so every member has to follow the same bell. Two classes on different
  // period groups have no period in common, and the solver drops the lesson
  // silently — it simply never appears, with nothing to say why. So the
  // mismatch is named in the picker and refused at the form.
  const bandOf = (homeroomId: string) => draftCtx?.slotGroupIds[homeroomId] ?? null
  const bandName = (groupId: string | null) =>
    draftCtx?.weeks.find((w) => w.groupId === groupId)?.name ?? 'Base schedule'
  const multiBand = (draftCtx?.weeks.length ?? 1) > 1
  const myBand = bandOf(homeroom.id)
  const strandedMembers = multiBand
    ? extraMembers.filter((m) => bandOf(m.homeroomId) !== myBand)
    : []

  const load = useCallback(async () => {
    setLoading(true)
    const [reqs, cmb, g, sl, cons] = await Promise.all([
      fetchRequirements(config.id, homeroom.id),
      fetchCombinedClasses(config.id),
      fetchGroupsForHomeroom(homeroom.id),
      fetchPeriodSlots(config.id),
      fetchConstraints(config.id),
    ])
    setRequirements(reqs)
    setCombined(cmb.filter((c) => (c.members ?? []).some((m) => m.homeroom_id === homeroom.id)))
    setGroups(g)
    setSlots(sl.filter((s) => !s.is_break))
    setConstraints(cons)
    setLoading(false)
  }, [config.id, homeroom.id])

  /**
   * Requirements drive the master grid's class list, the teacher workload
   * warnings and the next generate — all of which read the shared draft, not
   * this panel. Every change here has to reach it, and reload() would discard
   * an unsaved generated week, so only the reference data is re-read.
   */
  const loadAll = useCallback(async () => {
    await Promise.all([load(), draftCtx?.refreshReference() ?? Promise.resolve()])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, draftCtx?.refreshReference])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    setForm((f) => ({ ...f, groupId: '' }))
    setExtraMembers([])
    setEditingId(null)
    setNote('')
  }, [homeroom.id])

  const flash = (msg: string) => {
    setNote(msg)
    setTimeout(() => setNote(''), 4000)
  }

  const subjectName = (id: string | null) => (id ? subjects.find((s) => s.id === id)?.name ?? '—' : '—')
  const subjectColor = (id: string) => subjects.find((s) => s.id === id)?.color ?? '#94a3b8'
  const teacherName = (id: string | null) => (id ? teachers.find((t) => t.id === id)?.full_name ?? 'Unknown' : 'Unassigned')
  // Every teacher of a requirement / combined lesson, primary first.
  const teacherLabel = (ids: string[]) =>
    ids.length === 0 ? 'Unassigned' : ids.map((id) => teacherName(id)).join(', ')
  const homeroomName = (id: string) => homerooms.find((h) => h.id === id)?.name ?? '—'

  const roomOptions: SmartOption[] = useMemo(() => rooms.map((r) => ({ value: r.id, label: r.name })), [rooms])
  const extraOptions: SmartOption[] = useMemo(
    () => homerooms
      .filter((h) => h.id !== homeroom.id && !extraMembers.some((m) => m.homeroomId === h.id))
      .map((h) => {
        const band = draftCtx?.slotGroupIds[h.id] ?? null
        const mine = draftCtx?.slotGroupIds[homeroom.id] ?? null
        const show = (draftCtx?.weeks.length ?? 1) > 1
        return {
          value: h.id,
          label: h.name,
          sublabel: show
            ? draftCtx?.weeks.find((w) => w.groupId === band)?.name ?? 'Base schedule'
            : undefined,
          badge: show && band !== mine ? 'other bell' : undefined,
        }
      }),
    [homerooms, homeroom.id, extraMembers, draftCtx],
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
    if (!form.subjectId) { setError('Pick a subject.'); return }
    const problem = requirementProblem(form, workingDays)
    if (problem) { setError(problem); return }
    setAdding(true)
    if (isCombined) {
      const members = [{ homeroomId: homeroom.id, groupId: form.groupId || null }, ...extraMembers]
      if (members.length < 2) { setError('Add at least one more class for a combined lesson.'); setAdding(false); return }
      if (strandedMembers.length > 0) {
        setError(
          `${strandedMembers.map((m) => homeroomName(m.homeroomId)).join(', ')} ` +
          `follow${strandedMembers.length === 1 ? 's' : ''} a different period group to ` +
          `${homeroomName(homeroom.id)} (${bandName(myBand)}), so there is no period they all share. ` +
          'Move them to the same period group, or leave them out.',
        )
        setAdding(false)
        return
      }
      const block = Math.max(1, parseInt(form.blockSize, 10) || 1)
      const created = await createCombinedClass({
        config_id: config.id,
        name: combinedName.trim() || `${homeroomName(homeroom.id)} ${subjectName(form.subjectId)}`,
        subject_id: form.subjectId,
        teacher_id: form.teacherIds[0] ?? null,
        teacher_ids: form.teacherIds,
        room_id: roomId || null,
        periods_per_week: Math.max(1, parseInt(form.perWeek, 10) || 1),
        room_type: form.roomType,
        max_per_day: Math.max(1, parseInt(form.maxPerDay, 10) || 1),
        min_block: block,
        max_block: block,
        members,
      })
      setAdding(false)
      if (created) { resetForm(); loadAll() } else setError('Could not create the combined lesson.')
    } else {
      const block = Math.max(1, parseInt(form.blockSize, 10) || 1)
      const created = await createRequirement({
        config_id: config.id,
        homeroom_id: homeroom.id,
        subject_id: form.subjectId,
        teacher_id: form.teacherIds[0] ?? null,
        teacher_ids: form.teacherIds,
        periods_per_week: Math.max(1, parseInt(form.perWeek, 10) || 1),
        room_type: form.roomType,
        max_per_day: Math.max(1, parseInt(form.maxPerDay, 10) || 1),
        min_block: block,
        max_block: block,
        group_id: form.groupId || null,
      })
      setAdding(false)
      if (created) { resetForm(); loadAll() }
      else setError(requirementError() ?? 'Could not add this requirement.')
    }
  }

  const resetForm = () => {
    setForm(emptyDraft())
    setIsCombined(false); setCombinedName(''); setRoomId(''); setExtraMembers([])
  }

  // ── Editing ──────────────────────────────────────────────
  const startEdit = (r: Requirement) => {
    setEditingId(r.id)
    setEditingKind('requirement')
    setEditDraft(draftOf(r))
    setEditError('')
  }

  const startEditCombined = (c: CombinedClass) => {
    setEditingId(c.id)
    setEditingKind('combined')
    setEditDraft(combinedDraftOf(c))
    setEditName(c.name)
    setEditRoomId(c.room_id ?? '')
    setEditError('')
  }

  const saveEditCombined = async (c: CombinedClass) => {
    setEditError('')
    if (!editDraft.subjectId) { setEditError('Pick a subject.'); return }
    const problem = requirementProblem(editDraft, workingDays)
    if (problem) { setEditError(problem); return }
    setSavingEdit(true)
    const block = Math.max(1, parseInt(editDraft.blockSize, 10) || 1)
    const updated = await updateCombinedClass(c.id, {
      name: editName.trim() || c.name,
      subject_id: editDraft.subjectId,
      teacher_id: editDraft.teacherIds[0] ?? null,
      teacher_ids: editDraft.teacherIds,
      room_id: editRoomId || null,
      periods_per_week: Math.max(1, parseInt(editDraft.perWeek, 10) || 1),
      room_type: editDraft.roomType,
      max_per_day: Math.max(1, parseInt(editDraft.maxPerDay, 10) || 1),
      min_block: block,
      max_block: block,
    })
    setSavingEdit(false)
    if (!updated) { setEditError('Could not save this combined lesson.'); return }
    setEditingId(null)
    loadAll()
    flash('Combined lesson updated — regenerate to apply it to the timetable.')
  }

  const saveEdit = async (r: Requirement) => {
    setEditError('')
    if (!editDraft.subjectId) { setEditError('Pick a subject.'); return }
    const problem = requirementProblem(editDraft, workingDays)
    if (problem) { setEditError(problem); return }
    setSavingEdit(true)
    const block = Math.max(1, parseInt(editDraft.blockSize, 10) || 1)
    const updated = await updateRequirement(r.id, {
      subject_id: editDraft.subjectId,
      teacher_id: editDraft.teacherIds[0] ?? null,
      teacher_ids: editDraft.teacherIds,
      periods_per_week: Math.max(1, parseInt(editDraft.perWeek, 10) || 1),
      room_type: editDraft.roomType,
      max_per_day: Math.max(1, parseInt(editDraft.maxPerDay, 10) || 1),
      min_block: block,
      max_block: block,
      group_id: editDraft.groupId || null,
    })
    setSavingEdit(false)
    if (!updated) { setEditError(requirementError() ?? 'Could not save this requirement.'); return }
    setEditingId(null)
    loadAll()
    flash('Requirement updated — regenerate to apply it to the timetable.')
  }

  // ── Copy / paste ─────────────────────────────────────────
  const handlePaste = async () => {
    if (!clipboard || clipboard.items.length === 0) return
    setPasting(true)
    const res = await copyRequirementsTo(clipboard.items, homeroom.id)
    setPasting(false)
    loadAll()
    const parts = [`${res.copied} copied`]
    if (res.skipped > 0) parts.push(`${res.skipped} already here`)
    if (res.failed > 0) parts.push(`${res.failed} failed`)
    flash(parts.join(' · '))
  }

  const pasteCount = clipboard && clipboard.fromHomeroomId !== homeroom.id ? clipboard.items.length : 0
  const liveProblem = requirementProblem(form, workingDays)
  // Adding, so nothing of this requirement is counted yet.
  const addOverload = useTeacherOverload(form.teacherIds, form.perWeek, 0, teachers)
  const editing = requirements.find((r) => r.id === editingId) ?? null
  const editOverload = useTeacherOverload(
    editDraft.teacherIds,
    editDraft.perWeek,
    // Only what the SAME teacher already contributes should be discounted; a
    // teacher newly added to the requirement contributes nothing yet.
    editing ? editing.periods_per_week : 0,
    teachers,
  )
  const budget = useMemo(
    () => weeklyBudget({
      homeroom, slots: week?.slots ?? slots, constraints, requirements, combined, groups, workingDays,
    }),
    [homeroom, week, slots, constraints, requirements, combined, groups, workingDays],
  )

  return (
    <div>
      <Section title="Add a requirement" hint="What this class studies, how often, and who teaches it." first>
        {groups.length > 0 && !isCombined && (
          <div className="flex items-start gap-2 mb-3 px-3 py-2 bg-amber-50 border border-amber-200 text-[12px] text-amber-800">
            <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
            <span>
              This homeroom is split into groups. For split subjects, add one requirement <strong>per group</strong> with
              matching periods/week so the parallel groups schedule into the same slots — each group can have its own set of
              teachers. A whole-class requirement ignores the split.
            </span>
          </div>
        )}
        <RequirementFields
          draft={form}
          onChange={setForm}
          subjects={subjects}
          teachers={teachers}
          groups={groups}
          showGroup={!isCombined}
          roomTypeHint={isCombined ? 'Used when no specific room is pinned below.' : undefined}
          onSubjectCreated={async () => {
            await Promise.all([onSubjectsChanged(), draftCtx?.refreshReference() ?? Promise.resolve()])
          }}
        />

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
                Each class attends as a whole unless you pick one of its groups. The lesson shows on every
                class listed here{multiBand ? ', and they must all follow the same period group' : ''}.
              </p>
              <div className="flex flex-wrap gap-1.5 mt-2">
                <span className="inline-flex items-center gap-1 text-xs pl-2 pr-1 py-1 bg-indigo-50 border border-indigo-200 text-indigo-800">
                  {homeroom.name} (this)
                  {groups.length > 0 && (
                    <select
                      value={form.groupId}
                      onChange={(e) => setForm((f) => ({ ...f, groupId: e.target.value }))}
                      className="bg-white/60 border border-indigo-200 text-[11px] px-1 py-0.5 focus:outline-none"
                    >
                      <option value="">Whole class</option>
                      {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                    </select>
                  )}
                </span>
                {extraMembers.map((m) => (
                  <span
                    key={m.homeroomId}
                    className={`inline-flex items-center gap-1 text-xs pl-2 pr-1 py-1 border ${
                      multiBand && bandOf(m.homeroomId) !== myBand
                        ? 'bg-rose-50 border-rose-200 text-rose-800'
                        : 'bg-[#F5F5F5] border-[#E4E4E7]'
                    }`}
                    title={multiBand && bandOf(m.homeroomId) !== myBand
                      ? `${homeroomName(m.homeroomId)} follows ${bandName(bandOf(m.homeroomId))} — no period in common with this class`
                      : undefined}
                  >
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

        {/* Flag an impossible combination as it is typed, not on submit. */}
        {liveProblem && (
          <div className="flex items-start gap-2 mt-3 px-3 py-2 bg-rose-50 border border-rose-200 text-[12px] text-rose-800">
            <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
            <span>{liveProblem}</span>
          </div>
        )}
        {/* Over-booking is arithmetic, not a solver outcome — say so before the
            requirement is saved. It does not block saving: an admin may be
            about to free the teacher's time off or split the subject. */}
        {addOverload.length > 0 && (
          <div className="flex items-start gap-2 mt-3 px-3 py-2 bg-rose-50 border border-rose-200 text-[12px] text-rose-800">
            <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
            <div>
              <p><strong>This would over-book a teacher.</strong> {addOverload.join('; ')}.</p>
              <p className="text-rose-600/80 mt-0.5">
                Those periods cannot be scheduled by any timetable — share the subject with another
                teacher, or reduce the periods a week.
              </p>
            </div>
          </div>
        )}
        {error && error !== liveProblem && <p className="text-sm text-rose-600 mt-2">{error}</p>}
        <button onClick={handleAdd} disabled={adding || liveProblem !== null} className={`${BTN_PRIMARY} mt-3`}>
          {adding ? <Loader2 className="animate-spin" size={15} /> : <Plus size={15} />}
          {isCombined ? 'Add combined lesson' : 'Add requirement'}
        </button>
      </Section>

      <Section
        title="This homeroom's schedule"
        hint={
          budget.total === 0
            ? 'Add teaching period slots (Configuration) to see how much of the week is filled.'
            : `${budget.free} of the week's ${budget.available} teachable periods still free${
                budget.timeOff > 0 ? ` (${budget.total} in the week, ${budget.timeOff} marked time off)` : ''
              }. Parallel group lessons share a period, so groups count once.`
        }
        right={<SlotMeter budget={budget} />}
      >
        {/* Copy / paste — a year group is usually one class's list repeated. */}
        <div className="flex flex-wrap items-center gap-1.5 mb-2">
          <button
            onClick={() => {
              onCopy(requirements, homeroom.id)
              flash(`Copied ${requirements.length} requirement${requirements.length === 1 ? '' : 's'} — open another class to paste.`)
            }}
            disabled={requirements.length === 0}
            className={`${BTN_NEUTRAL} py-1 text-xs disabled:opacity-40`}
            title="Copy every requirement of this class"
          >
            <Copy size={13} /> Copy all
          </button>
          <button
            onClick={handlePaste}
            disabled={pasteCount === 0 || pasting}
            className={`${BTN_NEUTRAL} py-1 text-xs disabled:opacity-40`}
            title={
              pasteCount > 0
                ? `Paste ${pasteCount} requirement(s) copied from ${homeroomName(clipboard!.fromHomeroomId)}`
                : 'Nothing copied yet'
            }
          >
            {pasting ? <Loader2 className="animate-spin" size={13} /> : <ClipboardPaste size={13} />}
            Paste{pasteCount > 0 ? ` (${pasteCount})` : ''}
          </button>
          {clipboard && clipboard.items.length > 0 && (
            <span className="text-[11px] text-[#A1A1AA]">
              clipboard: {clipboard.items.length} from {homeroomName(clipboard.fromHomeroomId)}
            </span>
          )}
          {note && <span className="text-[11px] text-emerald-700">{note}</span>}
        </div>

        {draftCtx && draftCtx.overloaded.length > 0 && (
          <OverloadedTeachersNotice
            overloaded={draftCtx.overloaded}
            teacherName={(id) => teacherName(id)}
            className="mb-2"
          />
        )}

        {loading ? (
          <div className="flex justify-center py-8 text-[#A1A1AA]"><Loader2 className="animate-spin" size={20} /></div>
        ) : requirements.length === 0 && combined.length === 0 ? (
          <p className="text-xs text-[#A1A1AA] py-2">Nothing yet for {homeroom.name}.</p>
        ) : (
          <div className="space-y-px">
            {requirements.map((r) => {
              const block = Math.max(1, r.min_block ?? 1)
              if (editingId === r.id && editingKind === 'requirement') {
                return (
                  <div key={r.id} className="px-3 py-3 bg-white border border-[#27272A]">
                    <RequirementFields
                      draft={editDraft}
                      onChange={setEditDraft}
                      subjects={subjects}
                      teachers={teachers}
                      groups={groups}
                      showGroup
                      onSubjectCreated={async () => {
                        await Promise.all([onSubjectsChanged(), draftCtx?.refreshReference() ?? Promise.resolve()])
                      }}
                    />
                    {editOverload.length > 0 && (
                      <div className="flex items-start gap-2 mt-2 px-3 py-2 bg-rose-50 border border-rose-200 text-[12px] text-rose-800">
                        <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
                        <span><strong>This would over-book a teacher.</strong> {editOverload.join('; ')}.</span>
                      </div>
                    )}
                    {editError && (
                      <div className="flex items-start gap-2 mt-2 px-3 py-2 bg-rose-50 border border-rose-200 text-[12px] text-rose-800">
                        <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
                        <span>{editError}</span>
                      </div>
                    )}
                    <div className="flex items-center gap-2 mt-3">
                      <button onClick={() => saveEdit(r)} disabled={savingEdit} className={BTN_PRIMARY}>
                        {savingEdit ? <Loader2 className="animate-spin" size={15} /> : <Check size={15} />} Save
                      </button>
                      <button
                        onClick={() => setEditingId(null)}
                        className="text-sm text-[#71717A] hover:text-[#18181B] px-3 py-2 transition-colors"
                      >
                        Cancel
                      </button>
                      <span className="text-[11px] text-[#A1A1AA] ml-auto">
                        Changes apply on the next generate.
                      </span>
                    </div>
                  </div>
                )
              }
              return (
                <div key={r.id} className="flex items-center gap-2.5 px-3 py-2 bg-[#F5F5F5] border border-[#E4E4E7] text-sm">
                  <span className="w-2.5 h-2.5 flex-shrink-0" style={{ background: subjectColor(r.subject_id) }} />
                  <span className="font-medium text-[#18181B] flex-1 min-w-0 truncate">{subjectName(r.subject_id)}</span>
                  {r.group && (
                    <span className="text-[10px] px-1.5 py-0.5 flex-shrink-0 text-white" style={{ background: r.group.color ?? '#6366f1' }}>{r.group.name}</span>
                  )}
                  {block > 1 && (
                    <span
                      className="text-[10px] px-1.5 py-0.5 flex-shrink-0 bg-[#27272A] text-white"
                      title={`Scheduled as ${block} consecutive periods`}
                    >
                      {block === 2 ? 'Double' : block === 3 ? 'Triple' : `${block} in a row`}
                    </span>
                  )}
                  <span className="text-[#71717A] hidden sm:inline truncate max-w-[10rem]" title={teacherLabel(teacherIdsOf(r))}>
                    {teacherLabel(teacherIdsOf(r))}
                  </span>
                  <span className="text-[11px] px-1.5 py-0.5 bg-white border border-[#E4E4E7] text-[#71717A] flex-shrink-0">{r.periods_per_week}/wk</span>
                  <button
                    onClick={() => { onCopy([r], homeroom.id); flash(`Copied ${subjectName(r.subject_id)} — open another class to paste.`) }}
                    className="text-[#D4D4D8] hover:text-[#52525B] transition-colors flex-shrink-0"
                    title="Copy just this requirement"
                  ><Copy size={14} /></button>
                  <button
                    onClick={() => startEdit(r)}
                    className="text-[#D4D4D8] hover:text-[#52525B] transition-colors flex-shrink-0"
                    title="Edit"
                  ><Pencil size={14} /></button>
                  <button onClick={async () => { await deleteRequirement(r.id); loadAll() }} className="text-[#D4D4D8] hover:text-rose-500 transition-colors flex-shrink-0" title="Delete"><Trash2 size={15} /></button>
                </div>
              )
            })}
            {combined.map((c) => {
              const block = Math.max(1, c.min_block ?? 1)
              if (editingId === c.id && editingKind === 'combined') {
                return (
                  <div key={c.id} className="px-3 py-3 bg-white border border-indigo-400">
                    <div className="flex items-center gap-1.5 mb-3 text-sm font-medium text-indigo-800">
                      <Layers size={15} className="text-indigo-500" /> Combined lesson
                      <span className="text-[11px] font-normal text-[#A1A1AA] ml-auto">
                        {(c.members ?? []).length} classes — add or remove them by recreating the lesson
                      </span>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2 mb-3">
                      <Field label="Name">
                        <input className={INPUT} value={editName} onChange={(e) => setEditName(e.target.value)} />
                      </Field>
                      <Field label="Room" hint="Leave empty to let the room type above decide.">
                        <SmartSelect options={roomOptions} value={editRoomId} onChange={setEditRoomId} placeholder="Any room" searchPlaceholder="Search rooms…" allowClear />
                      </Field>
                    </div>
                    <RequirementFields
                      draft={editDraft}
                      onChange={setEditDraft}
                      subjects={subjects}
                      teachers={teachers}
                      groups={groups}
                      showGroup={false}
                      roomTypeHint="Used when no specific room is set."
                      onSubjectCreated={async () => {
                        await Promise.all([onSubjectsChanged(), draftCtx?.refreshReference() ?? Promise.resolve()])
                      }}
                    />
                    {editError && (
                      <div className="flex items-start gap-2 mt-2 px-3 py-2 bg-rose-50 border border-rose-200 text-[12px] text-rose-800">
                        <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
                        <span>{editError}</span>
                      </div>
                    )}
                    <div className="flex items-center gap-2 mt-3">
                      <button onClick={() => saveEditCombined(c)} disabled={savingEdit} className={BTN_PRIMARY}>
                        {savingEdit ? <Loader2 className="animate-spin" size={15} /> : <Check size={15} />} Save
                      </button>
                      <button
                        onClick={() => setEditingId(null)}
                        className="text-sm text-[#71717A] hover:text-[#18181B] px-3 py-2 transition-colors"
                      >
                        Cancel
                      </button>
                      <span className="text-[11px] text-[#A1A1AA] ml-auto">
                        Changes apply on the next generate.
                      </span>
                    </div>
                  </div>
                )
              }
              return (
                <div key={c.id} className="flex items-center gap-2.5 px-3 py-2 bg-indigo-50/50 border border-indigo-100 text-sm">
                  <Layers size={15} className="text-indigo-500 flex-shrink-0" />
                  <span className="font-medium text-[#18181B] flex-shrink-0">{c.name}</span>
                  <span className="text-[#A1A1AA] flex-1 min-w-0 truncate">
                    {(c.members ?? []).map((m) => homeroomName(m.homeroom_id) + (m.group ? ` (${m.group.name})` : '')).join(', ')}
                  </span>
                  {block > 1 && (
                    <span
                      className="text-[10px] px-1.5 py-0.5 flex-shrink-0 bg-[#27272A] text-white"
                      title={`Scheduled as ${block} consecutive periods`}
                    >
                      {block === 2 ? 'Double' : block === 3 ? 'Triple' : `${block} in a row`}
                    </span>
                  )}
                  <span className="text-[#71717A] hidden sm:inline truncate max-w-[10rem]" title={teacherLabel(teacherIdsOf(c))}>
                    {teacherLabel(teacherIdsOf(c))}
                  </span>
                  <span className="text-[11px] px-1.5 py-0.5 bg-white border border-[#E4E4E7] text-[#71717A] flex-shrink-0">{c.periods_per_week}/wk</span>
                  <button
                    onClick={() => startEditCombined(c)}
                    className="text-[#D4D4D8] hover:text-[#52525B] transition-colors flex-shrink-0"
                    title="Edit"
                  ><Pencil size={14} /></button>
                  <button onClick={async () => { if (confirm(`Delete combined lesson "${c.name}"?`)) { await deleteCombinedClass(c.id); loadAll() } }} className="text-[#D4D4D8] hover:text-rose-500 transition-colors flex-shrink-0" title="Delete"><Trash2 size={15} /></button>
                </div>
              )
            })}
          </div>
        )}
      </Section>
    </div>
  )
}

// ── Time off ─────────────────────────────────────────────────

/**
 * The class's week with the current draft drawn into it. Marking a period free
 * is done while looking at what is scheduled there, and a lesson in the way can
 * be dragged elsewhere or pinned without leaving for the master grid.
 */
function TimeOffPanel({ homeroom }: { homeroom: Homeroom }) {
  const draft = useTimetableDraftOptional()

  const lessons = useMemo(
    () => (draft?.entries ?? []).filter((e) => e.homeroomId === homeroom.id),
    [draft?.entries, homeroom.id],
  )

  const conflictCells = useMemo(() => {
    const keys = new Set<string>()
    for (const c of draft?.liveConflicts ?? []) {
      if (c.homeroomId === homeroom.id && c.day && c.slotId) {
        keys.add(`${homeroom.id}__${c.day}__${c.slotId}`)
      }
    }
    return keys
  }, [draft?.liveConflicts, homeroom.id])

  if (!draft) {
    return <p className="text-sm text-[#71717A] py-6 text-center">Select a timetable configuration first.</p>
  }
  if (draft.loading) {
    return <div className="flex justify-center py-8 text-[#A1A1AA]"><Loader2 className="animate-spin" size={20} /></div>
  }

  const week = draft.weekFor(homeroom.id)
  if (week.slots.length === 0) {
    return <p className="text-sm text-[#71717A] py-6 text-center">Add teaching period slots first (Configuration).</p>
  }

  const hasOverride = (hr: string, day: Weekday, slotId: string) =>
    draft.overrideToday(hr, day, slotId, null) !== null

  return (
    <div>
      {/* A homeroom follows exactly one bell schedule, so there is nothing to
          switch between here — which band it is gets named instead. */}
      <Section
        title="Time off"
        hint={`Tap a free period to keep this class out of it. Click a lesson to open it.${
          draft.weeks.length > 1 ? ` This class follows the ${week.name}.` : ''
        }`}
        first
      >
        <DraftWeekGrid
          week={week}
          lessons={lessons}
          isOff={(day, slotId) => draft.isConstraintOn('homeroom', homeroom.id, 'time_off', day, slotId)}
          onToggleOff={(day, slotId) => draft.toggleConstraintCell('homeroom', homeroom.id, 'time_off', day, slotId)}
          subjects={draft.subjects}
          teachers={draft.teachers}
          rooms={draft.rooms}
          conflicts={conflictCells}
          hasOverride={hasOverride}
          emptyCellHomeroomId={homeroom.id}
          onMove={draft.moveEntry}
        />
        {/* The subjects this class is taught, and whether they all fit. */}
        <LessonStatsCard dimension="class" id={homeroom.id} className="mt-2.5" />
      </Section>

      <Section
        title="Pin class teacher"
        hint={homeroom.class_teacher_id
          ? 'Tap a period to require this homeroom’s class teacher to be with them then.'
          : 'Assign a class teacher (Class teacher tab) to pin them to periods.'}
      >
        {homeroom.class_teacher_id ? (
          <DraftWeekGrid
            week={week}
            lessons={lessons}
            isOff={(day, slotId) => draft.isConstraintOn('class_teacher', homeroom.id, 'pin_class_teacher', day, slotId)}
            onToggleOff={(day, slotId) => draft.toggleConstraintCell('class_teacher', homeroom.id, 'pin_class_teacher', day, slotId)}
            offLabel="Pinned"
            offColor="indigo"
            subjects={draft.subjects}
            teachers={draft.teachers}
            rooms={draft.rooms}
            conflicts={conflictCells}
            hasOverride={hasOverride}
            onMove={draft.moveEntry}
          />
        ) : (
          <p className="text-xs text-[#A1A1AA]">No class teacher assigned yet.</p>
        )}
      </Section>
    </div>
  )
}
