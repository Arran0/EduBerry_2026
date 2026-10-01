'use client'

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { Loader2, Search, GraduationCap, UserCog, Gauge } from 'lucide-react'
import { fetchAllHomerooms } from '@/lib/homerooms'
import type { Homeroom } from '@/lib/homerooms'
import { fetchStaffProfiles } from '@/lib/admin'
import type { UserProfile } from '@/lib/supabase'
import type { TimetableConfig, Weekday } from '@/lib/timetable'
import { SmartSelect, Section, Field, SECTION_LABEL } from '../../ui'
import type { SmartOption } from '../../ui'
import NameLink from '../../NameLink'
import { TimeOffGrid, ValueInput, valueOf, LoadLimitFields } from '../constraintAtoms'
import { useConstraints } from '../useConstraints'
import { useTimetableDraftOptional } from '../../draft/TimetableDraftContext'
import { TeacherLoadBadge, TeacherLoadMeter } from '../../draft/TeacherLoad'
import DraftWeekGrid from '../../draft/DraftWeekGrid'
import { teacherIdsOf } from '@/lib/timetable'

/**
 * The Teacher hub — a searchable list of staff, the homeroom(s) each is class
 * teacher of, and that teacher's constraints (time off, per-day/week load
 * limits, max periods in a row). Opened from the workspace toolbar.
 */
export default function TeacherModal({ config }: { config: TimetableConfig | null }) {
  const draft = useTimetableDraftOptional()
  const [teachers, setTeachers] = useState<UserProfile[]>([])
  const [homerooms, setHomerooms] = useState<Homeroom[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const [profiles, hr] = await Promise.all([fetchStaffProfiles(), fetchAllHomerooms()])
    setTeachers(profiles)
    setHomerooms(hr)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q
      ? teachers.filter((t) => t.full_name?.toLowerCase().includes(q) || t.email?.toLowerCase().includes(q))
      : teachers
  }, [teachers, query])

  useEffect(() => {
    if (filtered.length > 0 && !filtered.some((t) => t.id === selectedId)) setSelectedId(filtered[0].id)
  }, [filtered, selectedId])

  const selected = teachers.find((t) => t.id === selectedId) ?? null
  const ownedHomerooms = useMemo(
    () => homerooms.filter((h) => h.class_teacher_id === selectedId),
    [homerooms, selectedId],
  )

  if (loading) {
    return <div className="flex justify-center py-16 text-[#A1A1AA]"><Loader2 className="animate-spin" size={22} /></div>
  }

  return (
    <div className="grid gap-0 sm:grid-cols-[16rem_1fr] sm:h-full border border-[#E4E4E7]">
      {/* Column 1 — teachers */}
      <div className="border-b sm:border-b-0 sm:border-r border-[#E4E4E7] bg-[#FAFAF9] flex flex-col min-h-0">
        <div className="p-2.5 border-b border-[#E4E4E7]">
          <div className="flex items-center gap-2 border border-[#D4D4D8] bg-white px-2.5 py-1.5">
            <Search size={13} className="text-[#A1A1AA] flex-shrink-0" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search staff…" className="flex-1 min-w-0 bg-transparent text-sm focus:outline-none" />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto max-h-64 sm:max-h-none p-1.5 space-y-px">
          {filtered.length === 0 ? (
            <p className="text-xs text-[#A1A1AA] p-2">No staff found.</p>
          ) : filtered.map((t) => {
            const owns = homerooms.filter((h) => h.class_teacher_id === t.id).length
            const w = draft?.workloadOf(t.id)
            return (
              <button
                key={t.id}
                onClick={() => setSelectedId(t.id)}
                className={`w-full text-left px-2.5 py-2 text-sm transition-colors ${t.id === selectedId ? 'bg-[#27272A] text-white' : 'text-[#3F3F46] hover:bg-[#EBEBEB]'}`}
              >
                <div className="flex items-center gap-1.5">
                  <span className="font-medium truncate flex-1 min-w-0">{t.full_name}</span>
                  {t.id !== selectedId && <TeacherLoadBadge workload={w} />}
                </div>
                <div className={`text-[11px] truncate ${t.id === selectedId ? 'text-white/60' : 'text-[#A1A1AA]'}`}>
                  {w && w.over > 0
                    ? `${w.over} period${w.over === 1 ? '' : 's'} over their week`
                    : owns > 0
                      ? `Class teacher · ${owns} homeroom${owns > 1 ? 's' : ''}`
                      : t.email}
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* Column 2 — detail */}
      <div className="min-w-0 min-h-0 flex flex-col">
        {!selected ? (
          <div className="flex-1 flex items-center justify-center text-sm text-[#A1A1AA] p-6">Select a teacher.</div>
        ) : (
          <div className="flex-1 overflow-y-auto p-4">
            <div className="flex items-center gap-2 mb-1">
              <UserCog size={16} className="text-[#71717A]" />
              <NameLink kind="teacher" id={selected.id} name={selected.full_name} className="font-semibold text-[#18181B]" />
            </div>
            <p className="text-xs text-[#71717A] mb-3">{selected.email}</p>

            {/* What they are asked for against what their week holds — the
                arithmetic that decides whether a timetable can exist at all. */}
            {draft && (
              <div className="mb-4">
                <TeacherLoadMeter workload={draft.workloadOf(selected.id)} />
                {(() => {
                  const w = draft.workloadOf(selected.id)
                  if (!w || w.over === 0) return null
                  const byClass = new Map<string, number>()
                  for (const i of w.items) {
                    byClass.set(i.homeroomId, (byClass.get(i.homeroomId) ?? 0) + i.periods)
                  }
                  const worst = [...byClass.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4)
                  return (
                    <div className="mt-2 px-3 py-2 bg-rose-50 border border-rose-200 text-[12px] text-rose-800">
                      <p>
                        <strong>{w.over} period{w.over === 1 ? '' : 's'} cannot be scheduled.</strong>{' '}
                        No timetable can give them more than {w.capacity} periods a week.
                      </p>
                      <p className="mt-0.5 text-rose-700">
                        Heaviest classes: {worst.map(([hr, n]) => `${homerooms.find((h) => h.id === hr)?.name ?? 'Class'} ${n}`).join(' · ')}
                      </p>
                    </div>
                  )
                })()}
              </div>
            )}

            {/* Class-teacher homerooms */}
            <div className="mb-4">
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#525252] mb-1.5">Class teacher of</p>
              {ownedHomerooms.length === 0 ? (
                <p className="text-xs text-[#A1A1AA]">Not a class teacher of any homeroom.</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {ownedHomerooms.map((h) => (
                    <span key={h.id} className="inline-flex items-center gap-1 text-xs px-2 py-1 bg-[#F5F5F5] border border-[#E4E4E7]">
                      <GraduationCap size={12} className="text-[#71717A]" />
                      <NameLink kind="homeroom" id={h.id} name={h.name} className="text-[#18181B]" />
                    </span>
                  ))}
                </div>
              )}
            </div>

            {config
              ? <TeacherConstraintsPanel config={config} teacher={selected} homerooms={homerooms} />
              : <p className="text-sm text-[#71717A] py-4">Select or create a timetable configuration to edit this teacher&rsquo;s constraints.</p>}
          </div>
        )}
      </div>
    </div>
  )
}

function TeacherConstraintsPanel({
  config, teacher, homerooms,
}: {
  config: TimetableConfig
  teacher: UserProfile
  homerooms: Homeroom[]
}) {
  const { slots, constraints, loading, toggleSlot, commitValue } = useConstraints(config)
  const draft = useTimetableDraftOptional()
  const [homeroomTarget, setHomeroomTarget] = useState('')
  const scopeId = teacher.id
  const hrTarget = homeroomTarget || null

  const homeroomOptions: SmartOption[] = useMemo(
    () => [{ value: '', label: 'Any homeroom' }, ...homerooms.map((h) => ({ value: h.id, label: h.name }))],
    [homerooms],
  )

  const isOff = (day: Weekday, slotId: string) =>
    constraints.some((c) => c.type === 'time_off' && c.scope === 'teacher' && c.scope_id === scopeId && c.day === day && c.slot_id === slotId)

  // The lessons this teacher already has in the draft, so a period is blocked
  // while looking at what is actually scheduled in it rather than blind.
  const lessons = useMemo(
    () => (draft?.entries ?? []).filter((e) => teacherIdsOf(e).includes(scopeId)),
    [draft?.entries, scopeId],
  )
  const homeroomName = useMemo(() => {
    const m = new Map(homerooms.map((h) => [h.id, h.name]))
    return (id: string) => m.get(id) ?? 'Class'
  }, [homerooms])

  if (loading) return <div className="flex justify-center py-8 text-[#A1A1AA]"><Loader2 className="animate-spin" size={20} /></div>
  if (slots.length === 0) return <p className="text-sm text-[#71717A] py-4">Add teaching period slots first (Configuration).</p>

  return (
    <div>
      <Section
        title="Time off"
        hint="Tap a free period to block it — the generator never schedules this teacher there. The draft is drawn in, so a lesson in the way can be dragged to another period or pinned in place."
        first
      >
        {draft ? (
          <div className="space-y-4">
            {draft.weeks.map((week) => (
              <div key={week.groupId ?? 'base'}>
                {draft.weeks.length > 1 && <div className={`${SECTION_LABEL} mb-1.5`}>{week.name}</div>}
                <DraftWeekGrid
                  week={week}
                  lessons={lessons.filter((e) => (draft.slotGroupIds[e.homeroomId] ?? null) === week.groupId)}
                  isOff={(d, s) => draft.isConstraintOn('teacher', scopeId, 'time_off', d, s)}
                  onToggleOff={(d, s) => draft.toggleConstraintCell('teacher', scopeId, 'time_off', d, s)}
                  subjects={draft.subjects}
                  teachers={draft.teachers}
                  rooms={draft.rooms}
                  classLabel={homeroomName}
                  onMove={draft.moveEntry}
                  onTogglePin={draft.togglePin}
                />
              </div>
            ))}
          </div>
        ) : (
          <TimeOffGrid days={config.working_days} slots={slots} isOn={isOff} onToggle={(d, s) => toggleSlot('teacher', scopeId, 'time_off', d, s)} />
        )}
      </Section>

      <Section title="Load limits" hint="Leave blank for no limit. Optionally restrict per-day / per-week caps to one homeroom.">
        <div className="mb-3 max-w-xs">
          <Field label="Applies to homeroom">
            <SmartSelect options={homeroomOptions} value={homeroomTarget} onChange={setHomeroomTarget} placeholder="Any homeroom" searchPlaceholder="Search classes…" />
          </Field>
        </div>
        <LoadLimitFields
          constraints={constraints}
          scope="teacher"
          scopeId={scopeId}
          homeroomId={hrTarget}
          workingDays={config.working_days.length}
          onCommit={(type, v) => commitValue('teacher', scopeId, hrTarget, type, v)}
        />
      </Section>

      <Section title="Max periods in a row" hint="The most consecutive periods this teacher can teach without a gap.">
        <div className="max-w-[10rem] flex items-center gap-2">
          <Gauge size={15} className="text-[#71717A] flex-shrink-0" />
          <ValueInput seed={valueOf(constraints, 'teacher', scopeId, null, 'max_in_a_row')} onCommit={(v) => commitValue('teacher', scopeId, null, 'max_in_a_row', v)} placeholder="No limit" />
        </div>
      </Section>
    </div>
  )
}
