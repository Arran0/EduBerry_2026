'use client'

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { GraduationCap, UserCog, Gauge, CalendarRange } from 'lucide-react'
import { fetchAllHomerooms } from '@/lib/homerooms'
import type { Homeroom } from '@/lib/homerooms'
import { fetchStaffProfiles } from '@/lib/admin'
import type { UserProfile } from '@/lib/supabase'
import type { TimetableConfig, Weekday } from '@/lib/timetable'
import { SmartSelect, Section, Field, Loading, Notice, Chip, SECTION_LABEL } from '../../ui'
import type { SmartOption } from '../../ui'
import NameLink from '../../NameLink'
import { TimeOffGrid, ValueInput, valueOf, LoadLimitFields } from '../constraintAtoms'
import LessonStatsCard from '../../LessonStatsCard'
import { useConstraints } from '../useConstraints'
import { useTimetableDraftOptional } from '../../draft/TimetableDraftContext'
import { TeacherLoadBadge, TeacherLoadMeter } from '../../draft/TeacherLoad'
import DraftWeekGrid from '../../draft/DraftWeekGrid'
import PeriodGroupSwitch, { usePeriodGroupSwitch } from '../../PeriodGroupSwitch'
import {
  EntityShell, EntityList, EntityRow, DetailHeader, EmptyDetail,
} from '../EntityList'
import { teacherIdsOf } from '@/lib/timetable'

/**
 * The Teacher hub — a searchable list of staff, the homeroom(s) each is class
 * teacher of, and that teacher's constraints (time off, per-day/week load
 * limits, max periods in a row). Opened from the workspace toolbar.
 */
export default function TeacherModal({ config }: { config: TimetableConfig | null }) {
  const draft = useTimetableDraftOptional()
  // The draft has already read the staff list and every class; only without
  // one (no timetable yet) does the editor read them itself.
  const [own, setOwn] = useState<{ teachers: UserProfile[]; homerooms: Homeroom[] } | null>(null)
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState('')

  const load = useCallback(async () => {
    const [profiles, hr] = await Promise.all([fetchStaffProfiles(), fetchAllHomerooms()])
    setOwn({ teachers: profiles, homerooms: hr })
  }, [])

  const fromDraft = !!draft && !draft.loading
  useEffect(() => { if (!draft) load() }, [draft, load])

  const teachers = useMemo(() => (fromDraft ? draft!.teachers : own?.teachers ?? []), [fromDraft, draft, own])
  const homerooms = useMemo(() => (fromDraft ? draft!.homerooms : own?.homerooms ?? []), [fromDraft, draft, own])
  const loading = draft ? draft.loading : own === null

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

  if (loading) return <Loading />

  return (
    <EntityShell
      list={
        <EntityList
          query={query}
          onQuery={setQuery}
          placeholder="Search staff…"
          count={filtered.length}
          total={teachers.length}
        >
          {filtered.length === 0 ? (
            <p className="text-[12.5px] text-slate-400 p-3.5">No staff found.</p>
          ) : filtered.map((t) => {
            const owns = homerooms.filter((h) => h.class_teacher_id === t.id).length
            const w = draft?.workloadOf(t.id)
            return (
              <EntityRow
                key={t.id}
                selected={t.id === selectedId}
                onClick={() => setSelectedId(t.id)}
                title={t.full_name ?? 'Unnamed'}
                trailing={t.id !== selectedId ? <TeacherLoadBadge workload={w} /> : undefined}
                subtitle={
                  w && w.over > 0
                    ? `${w.over} period${w.over === 1 ? '' : 's'} over their week`
                    : owns > 0
                      ? `Class teacher · ${owns} homeroom${owns > 1 ? 's' : ''}`
                      : t.email
                }
              />
            )
          })}
        </EntityList>
      }
    >
      {!selected ? (
        <EmptyDetail>Select a teacher.</EmptyDetail>
      ) : (
        <>
          <DetailHeader
            icon={UserCog}
            meta={selected.email}
            right={<TeacherBands teacherId={selected.id} />}
          >
            <NameLink kind="teacher" id={selected.id} name={selected.full_name} />
          </DetailHeader>
          <div className="flex-1 sm:overflow-y-auto overscroll-contain p-3.5 sm:p-5">

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
                    <Notice tone="error" className="mt-2">
                      <p>
                        <strong>{w.over} period{w.over === 1 ? '' : 's'} cannot be scheduled.</strong>{' '}
                        Their week has room for {w.capacity}.
                      </p>
                      <p className="mt-0.5">
                        Heaviest classes: {worst.map(([hr, n]) => `${homerooms.find((h) => h.id === hr)?.name ?? 'Class'} ${n}`).join(' · ')}
                      </p>
                    </Notice>
                  )
                })()}
              </div>
            )}

            {/* Class-teacher homerooms */}
            <div className="mb-4">
              <p className={`${SECTION_LABEL} mb-1.5`}>Class teacher of</p>
              {ownedHomerooms.length === 0 ? (
                <p className="text-[12.5px] text-slate-400">No class yet.</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {ownedHomerooms.map((h) => (
                    <span key={h.id} className="inline-flex items-center gap-1.5 min-h-[28px] px-2.5 rounded-full bg-[#F1EEE7] text-[12.5px] text-slate-800">
                      <GraduationCap size={12} className="text-slate-400 flex-shrink-0" />
                      <NameLink kind="homeroom" id={h.id} name={h.name} />
                    </span>
                  ))}
                </div>
              )}
            </div>

            {config
              ? <TeacherConstraintsPanel config={config} teacher={selected} homerooms={homerooms} />
              : <p className="text-[13px] text-slate-500 py-4">Create a timetable in Configuration to set this teacher&rsquo;s limits.</p>}
          </div>
        </>
      )}
    </EntityShell>
  )
}

/**
 * The bells this teacher works to.
 *
 * With several period groups running, "28 of 30 periods" is ambiguous until
 * you know which weeks those 30 periods came from — and a teacher who spans
 * two bands has a capacity that is the UNION of them, not the sum, because an
 * overlapping period is one slot they can only stand in once. Naming the bands
 * here is what makes the meter below readable.
 */
function TeacherBands({ teacherId }: { teacherId: string }) {
  const draft = useTimetableDraftOptional()
  const bands = useMemo(() => {
    if (!draft || draft.weeks.length < 2) return []
    const ids = new Set<string | null>()
    for (const r of draft.requirements) {
      if (teacherIdsOf(r).includes(teacherId)) ids.add(draft.slotGroupIds[r.homeroom_id] ?? null)
    }
    for (const e of draft.entries) {
      if (teacherIdsOf(e).includes(teacherId)) ids.add(draft.slotGroupIds[e.homeroomId] ?? null)
    }
    return draft.weeks.filter((w) => ids.has(w.groupId))
  }, [draft, teacherId])

  if (bands.length === 0) return null
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <CalendarRange size={12} className="text-slate-400" aria-hidden />
      {bands.map((b) => <Chip key={b.groupId ?? 'base'}>{b.name}</Chip>)}
    </span>
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
    () => [{ value: '', label: 'Any class' }, ...homerooms.map((h) => ({ value: h.id, label: h.name }))],
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

  // The bell schedules this teacher actually works in become a switch above
  // the calendar, rather than one calendar per band stacked down the panel.
  const bandsWeeks = useMemo(() => draft?.weeks ?? [], [draft?.weeks])
  const bands = usePeriodGroupSwitch(
    bandsWeeks,
    useMemo(
      () => lessons.map((e) => draft?.slotGroupIds[e.homeroomId] ?? null),
      [lessons, draft?.slotGroupIds],
    ),
  )

  if (loading) return <Loading className="py-8" />
  if (slots.length === 0) return <p className="text-[13px] text-slate-500 py-4">Add the periods of the day in Configuration first.</p>

  return (
    <div>
      <Section
        title="Time off"
        hint="Tap a free period to block it. Tap a lesson to open it."
        first
        right={
          <PeriodGroupSwitch
            weeks={bandsWeeks}
            present={bands.present}
            counts={bands.counts}
            value={bands.groupId}
            onChange={bands.setGroupId}
          />
        }
      >
        {draft && bands.week ? (
          <DraftWeekGrid
            week={bands.week}
            lessons={lessons.filter((e) => (draft.slotGroupIds[e.homeroomId] ?? null) === bands.week!.groupId)}
            isOff={(d, s) => draft.isConstraintOn('teacher', scopeId, 'time_off', d, s)}
            onToggleOff={(d, s) => draft.toggleConstraintCell('teacher', scopeId, 'time_off', d, s)}
            subjects={draft.subjects}
            teachers={draft.teachers}
            rooms={draft.rooms}
            classLabel={homeroomName}
            hasOverride={(hr, d, sl) => draft.overrideToday(hr, d, sl, null) !== null}
            onMove={draft.moveEntry}
          />
        ) : (
          <TimeOffGrid days={config.working_days} slots={slots} isOn={isOff} onToggle={(d, s) => toggleSlot('teacher', scopeId, 'time_off', d, s)} />
        )}
        {/* What blocking a period is being weighed against. */}
        <LessonStatsCard dimension="teacher" id={scopeId} className="mt-2.5" />
      </Section>

      <Section title="Load limits" hint="Leave a box empty for no limit. Pick a class to set limits for that class only.">
        <div className="mb-3 max-w-xs">
          <Field label="Applies to" group>
            <SmartSelect options={homeroomOptions} value={homeroomTarget} onChange={setHomeroomTarget} placeholder="Any class" searchPlaceholder="Search classes…" />
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

      <Section title="Most periods in a row" hint="How many periods this teacher can teach back to back.">
        <div className="max-w-[11rem] flex items-center gap-2">
          <Gauge size={15} className="text-slate-400 flex-shrink-0" />
          <ValueInput seed={valueOf(constraints, 'teacher', scopeId, null, 'max_in_a_row')} onCommit={(v) => commitValue('teacher', scopeId, null, 'max_in_a_row', v)} placeholder="No limit" />
        </div>
      </Section>
    </div>
  )
}
