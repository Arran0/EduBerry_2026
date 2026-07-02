'use client'

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { Loader2, Ban, Check, Pin, User, Users, BookOpen } from 'lucide-react'
import {
  fetchPeriodSlots, fetchConstraints, addConstraint, deleteConstraint, setValueConstraint,
  fetchSubjects, WEEKDAY_LABELS,
} from '@/lib/timetable'
import type {
  PeriodSlot, TimetableConfig, TimetableConstraint, ConstraintScope, ConstraintType, Subject, Weekday,
} from '@/lib/timetable'
import { fetchAllHomerooms } from '@/lib/homerooms'
import type { Homeroom } from '@/lib/homerooms'
import { fetchAllProfiles } from '@/lib/admin'
import { isStaffRole } from '@/lib/supabase'
import type { UserProfile } from '@/lib/supabase'
import { SegmentedNav, SmartSelect, SECTION_LABEL, INPUT, Section, Field } from '../ui'
import type { SegItem, SmartOption } from '../ui'

type SubTab = 'teachers' | 'homerooms' | 'subjects'

const SUBTABS: SegItem<SubTab>[] = [
  { key: 'teachers', label: 'Teachers', icon: User },
  { key: 'homerooms', label: 'Homerooms', icon: Users },
  { key: 'subjects', label: 'Subjects', icon: BookOpen },
]

export default function ConstraintsTab({ config }: { config: TimetableConfig }) {
  const [tab, setTab] = useState<SubTab>('teachers')
  const [slots, setSlots] = useState<PeriodSlot[]>([])
  const [constraints, setConstraints] = useState<TimetableConstraint[]>([])
  const [teachers, setTeachers] = useState<UserProfile[]>([])
  const [homerooms, setHomerooms] = useState<Homeroom[]>([])
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const [sl, cons, profiles, hrs, subs] = await Promise.all([
      fetchPeriodSlots(config.id),
      fetchConstraints(config.id),
      fetchAllProfiles(),
      fetchAllHomerooms(),
      fetchSubjects(),
    ])
    setSlots(sl.filter((s) => !s.is_break))
    setConstraints(cons)
    setTeachers(profiles.filter((p) => isStaffRole(p.role)))
    setHomerooms(hrs)
    setSubjects(subs)
    setLoading(false)
  }, [config.id])

  useEffect(() => {
    load()
  }, [load])

  const refetch = useCallback(async () => {
    setConstraints(await fetchConstraints(config.id))
  }, [config.id])

  // ── Shared mutation helpers ─────────────────────────────────
  const toggleSlotConstraint = useCallback(
    async (scope: ConstraintScope, scopeId: string | null, type: ConstraintType, day: Weekday, slotId: string) => {
      const existing = constraints.find(
        (c) => c.type === type && c.scope === scope && (c.scope_id ?? null) === scopeId && c.day === day && c.slot_id === slotId,
      )
      if (existing) {
        await deleteConstraint(existing.id)
        setConstraints((prev) => prev.filter((c) => c.id !== existing.id))
      } else {
        const created = await addConstraint({ config_id: config.id, scope, scope_id: scopeId, type, day, slot_id: slotId })
        if (created) setConstraints((prev) => [...prev, created])
      }
    },
    [constraints, config.id],
  )

  const commitValue = useCallback(
    async (scope: ConstraintScope, scopeId: string | null, homeroomId: string | null, type: ConstraintType, value: number) => {
      await setValueConstraint({ config_id: config.id, scope, scope_id: scopeId, homeroom_id: homeroomId, type, value, existing: constraints })
      await refetch()
    },
    [constraints, config.id, refetch],
  )

  const homeroomTargetOptions: SmartOption[] = useMemo(
    () => [{ value: '', label: 'Any homeroom' }, ...homerooms.map((h) => ({ value: h.id, label: h.name }))],
    [homerooms],
  )

  if (loading) {
    return (
      <div className="flex justify-center py-16 text-[#A1A1AA]">
        <Loader2 className="animate-spin" size={22} />
      </div>
    )
  }

  if (slots.length === 0) {
    return (
      <div className="py-12 text-center text-[#71717A] text-sm">
        Add teaching <strong>period slots</strong> in the Setup tab before setting constraints.
      </div>
    )
  }

  return (
    <div>
      <div className="mb-4">
        <SegmentedNav items={SUBTABS} value={tab} onChange={setTab} />
      </div>

      {tab === 'teachers' && (
        <TeacherConstraints
          slots={slots} constraints={constraints} teachers={teachers}
          days={config.working_days} homeroomTargetOptions={homeroomTargetOptions}
          onToggle={toggleSlotConstraint} onCommitValue={commitValue}
        />
      )}
      {tab === 'homerooms' && (
        <HomeroomConstraints
          slots={slots} constraints={constraints} homerooms={homerooms}
          days={config.working_days} onToggle={toggleSlotConstraint}
        />
      )}
      {tab === 'subjects' && (
        <SubjectConstraints
          slots={slots} constraints={constraints} subjects={subjects}
          days={config.working_days} homeroomTargetOptions={homeroomTargetOptions}
          onToggle={toggleSlotConstraint} onCommitValue={commitValue}
        />
      )}
    </div>
  )
}

// ── Reusable: day × slot toggle grid ─────────────────────────

function TimeOffGrid({
  days, slots, isOn, onToggle, label = 'Time off', onColor = 'rose',
}: {
  days: Weekday[]
  slots: PeriodSlot[]
  isOn: (day: Weekday, slotId: string) => boolean
  onToggle: (day: Weekday, slotId: string) => void
  label?: string
  onColor?: 'rose' | 'indigo'
}) {
  const on = onColor === 'rose'
    ? 'bg-rose-100 text-rose-700 hover:bg-rose-200'
    : 'bg-indigo-100 text-indigo-700 hover:bg-indigo-200'
  return (
    <div className="overflow-x-auto border border-[#D4D4D8]">
      <table className="w-full border-collapse text-sm min-w-[34rem] table-fixed">
        <colgroup>
          <col className="w-28" />
          {days.map((d) => <col key={d} />)}
        </colgroup>
        <thead>
          <tr className="bg-[#FAFAF9]">
            <th className="p-2 text-left text-[10px] font-bold uppercase tracking-widest text-[#525252] sticky left-0 bg-[#FAFAF9] z-10">Period</th>
            {days.map((d) => (
              <th key={d} className="p-3 text-center text-[11px] font-semibold text-[#52525B] border-l border-[#E4E4E7]">
                <span className="hidden sm:inline">{WEEKDAY_LABELS[d]}</span>
                <span className="sm:hidden">{WEEKDAY_LABELS[d].slice(0, 3)}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {slots.map((s) => (
            <tr key={s.id}>
              <td className="p-2 text-[11px] text-[#71717A] whitespace-nowrap sticky left-0 bg-white z-10 border-t border-[#E4E4E7]">
                <div className="font-medium text-[#52525B]">{s.label}</div>
                {s.start_time && <div className="tabular-nums text-[#A1A1AA]">{s.start_time.slice(0, 5)}</div>}
              </td>
              {days.map((d) => {
                const active = isOn(d, s.id)
                return (
                  <td key={d} className="p-1.5 border-t border-l border-[#E4E4E7]">
                    <button
                      onClick={() => onToggle(d, s.id)}
                      className={`w-full h-11 text-xs font-medium transition-colors flex items-center justify-center gap-1.5 ${
                        active ? on : 'bg-emerald-50 text-emerald-600/70 hover:bg-emerald-100'
                      }`}
                    >
                      {active ? <><Ban size={12} /> {label}</> : <Check size={13} />}
                    </button>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Reusable: numeric value input that commits on blur ───────

function ValueInput({
  seed, onCommit, placeholder = '—',
}: {
  seed: number
  onCommit: (value: number) => void
  placeholder?: string
}) {
  const [val, setVal] = useState(seed > 0 ? String(seed) : '')
  useEffect(() => { setVal(seed > 0 ? String(seed) : '') }, [seed])
  return (
    <input
      className={`${INPUT} w-full`}
      type="number"
      min={0}
      placeholder={placeholder}
      value={val}
      onChange={(e) => setVal(e.target.value)}
      onBlur={() => onCommit(Math.max(0, parseInt(val, 10) || 0))}
    />
  )
}

// Reads the current value of a value-constraint from the array.
function valueOf(
  constraints: TimetableConstraint[],
  scope: ConstraintScope, scopeId: string | null, homeroomId: string | null, type: ConstraintType,
): number {
  const c = constraints.find(
    (x) => x.scope === scope && (x.scope_id ?? null) === scopeId && (x.homeroom_id ?? null) === homeroomId && x.type === type,
  )
  return c?.value ?? 0
}

// ── Teachers ─────────────────────────────────────────────────

function TeacherConstraints({
  slots, constraints, teachers, days, homeroomTargetOptions, onToggle, onCommitValue,
}: {
  slots: PeriodSlot[]
  constraints: TimetableConstraint[]
  teachers: UserProfile[]
  days: Weekday[]
  homeroomTargetOptions: SmartOption[]
  onToggle: (scope: ConstraintScope, scopeId: string | null, type: ConstraintType, day: Weekday, slotId: string) => void
  onCommitValue: (scope: ConstraintScope, scopeId: string | null, homeroomId: string | null, type: ConstraintType, value: number) => void
}) {
  const [teacherId, setTeacherId] = useState('')
  const [homeroomTarget, setHomeroomTarget] = useState('')
  const scopeId = teacherId || null
  const hrTarget = homeroomTarget || null

  const options: SmartOption[] = useMemo(
    () => [{ value: '', label: 'All teachers' }, ...teachers.map((t) => ({ value: t.id, label: t.full_name, sublabel: t.email }))],
    [teachers],
  )

  const isOn = (day: Weekday, slotId: string) =>
    constraints.some((c) => c.type === 'time_off' && c.scope === 'teacher' && (c.scope_id ?? null) === scopeId && c.day === day && c.slot_id === slotId)

  return (
    <div>
      <Field label="Teacher">
        <SmartSelect options={options} value={teacherId} onChange={setTeacherId} placeholder="All teachers" searchPlaceholder="Search staff…" />
      </Field>

      <Section title="Time off" hint="Tap a period to block it. The generator never schedules this teacher there." first>
        <TimeOffGrid days={days} slots={slots} isOn={isOn} onToggle={(d, s) => onToggle('teacher', scopeId, 'time_off', d, s)} />
      </Section>

      <Section title="Load limits" hint="Leave blank for no limit. Optionally restrict per-day / per-week caps to one homeroom.">
        <div className="mb-3 max-w-xs">
          <Field label="Applies to homeroom">
            <SmartSelect options={homeroomTargetOptions} value={homeroomTarget} onChange={setHomeroomTarget} placeholder="Any homeroom" searchPlaceholder="Search classes…" />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Min / day">
            <ValueInput seed={valueOf(constraints, 'teacher', scopeId, hrTarget, 'min_per_day')} onCommit={(v) => onCommitValue('teacher', scopeId, hrTarget, 'min_per_day', v)} />
          </Field>
          <Field label="Max / day">
            <ValueInput seed={valueOf(constraints, 'teacher', scopeId, hrTarget, 'max_per_day')} onCommit={(v) => onCommitValue('teacher', scopeId, hrTarget, 'max_per_day', v)} />
          </Field>
          <Field label="Min / week">
            <ValueInput seed={valueOf(constraints, 'teacher', scopeId, hrTarget, 'min_per_week')} onCommit={(v) => onCommitValue('teacher', scopeId, hrTarget, 'min_per_week', v)} />
          </Field>
          <Field label="Max / week">
            <ValueInput seed={valueOf(constraints, 'teacher', scopeId, hrTarget, 'max_per_week')} onCommit={(v) => onCommitValue('teacher', scopeId, hrTarget, 'max_per_week', v)} />
          </Field>
        </div>
      </Section>

      <Section title="Max periods in a row" hint="The most consecutive periods this teacher can teach without a gap.">
        <div className="max-w-[10rem]">
          <ValueInput
            seed={valueOf(constraints, 'teacher', scopeId, null, 'max_in_a_row')}
            onCommit={(v) => onCommitValue('teacher', scopeId, null, 'max_in_a_row', v)}
            placeholder="No limit"
          />
        </div>
      </Section>
    </div>
  )
}

// ── Homerooms ────────────────────────────────────────────────

function HomeroomConstraints({
  slots, constraints, homerooms, days, onToggle,
}: {
  slots: PeriodSlot[]
  constraints: TimetableConstraint[]
  homerooms: Homeroom[]
  days: Weekday[]
  onToggle: (scope: ConstraintScope, scopeId: string | null, type: ConstraintType, day: Weekday, slotId: string) => void
}) {
  const [homeroomId, setHomeroomId] = useState('')
  const scopeId = homeroomId || null

  const options: SmartOption[] = useMemo(
    () => [{ value: '', label: 'All homerooms' }, ...homerooms.map((h) => ({ value: h.id, label: h.name }))],
    [homerooms],
  )

  const isTimeOff = (day: Weekday, slotId: string) =>
    constraints.some((c) => c.type === 'time_off' && c.scope === 'homeroom' && (c.scope_id ?? null) === scopeId && c.day === day && c.slot_id === slotId)

  const isPinned = (day: Weekday, slotId: string) =>
    constraints.some((c) => c.type === 'pin_class_teacher' && c.scope === 'class_teacher' && c.scope_id === homeroomId && c.day === day && c.slot_id === slotId)

  const selected = homerooms.find((h) => h.id === homeroomId)

  return (
    <div>
      <Field label="Homeroom">
        <SmartSelect options={options} value={homeroomId} onChange={setHomeroomId} placeholder="All homerooms" searchPlaceholder="Search classes…" />
      </Field>

      <Section title="Time off" hint="Tap a period to keep this class free (assembly, etc.)." first>
        <TimeOffGrid days={days} slots={slots} isOn={isTimeOff} onToggle={(d, s) => onToggle('homeroom', scopeId, 'time_off', d, s)} />
      </Section>

      <Section
        title="Pin class teacher"
        hint={
          homeroomId
            ? selected?.class_teacher_id
              ? 'Tap a period to require the class teacher to be with this homeroom then.'
              : 'This homeroom has no class teacher yet — set one in the Setup tab first.'
            : 'Select a specific homeroom to pin its class teacher to periods.'
        }
      >
        {homeroomId ? (
          <TimeOffGrid
            days={days} slots={slots} isOn={isPinned} label="Pinned" onColor="indigo"
            onToggle={(d, s) => onToggle('class_teacher', homeroomId, 'pin_class_teacher', d, s)}
          />
        ) : (
          <p className="text-xs text-[#A1A1AA] flex items-center gap-1.5"><Pin size={13} /> Choose a homeroom above.</p>
        )}
      </Section>
    </div>
  )
}

// ── Subjects ─────────────────────────────────────────────────

function SubjectConstraints({
  slots, constraints, subjects, days, homeroomTargetOptions, onToggle, onCommitValue,
}: {
  slots: PeriodSlot[]
  constraints: TimetableConstraint[]
  subjects: Subject[]
  days: Weekday[]
  homeroomTargetOptions: SmartOption[]
  onToggle: (scope: ConstraintScope, scopeId: string | null, type: ConstraintType, day: Weekday, slotId: string) => void
  onCommitValue: (scope: ConstraintScope, scopeId: string | null, homeroomId: string | null, type: ConstraintType, value: number) => void
}) {
  const [subjectId, setSubjectId] = useState('')
  const [homeroomTarget, setHomeroomTarget] = useState('')
  const scopeId = subjectId || null
  const hrTarget = homeroomTarget || null

  const options: SmartOption[] = useMemo(
    () => [{ value: '', label: 'All subjects' }, ...subjects.map((s) => ({ value: s.id, label: s.name, color: s.color ?? undefined }))],
    [subjects],
  )

  const isOn = (day: Weekday, slotId: string) =>
    constraints.some((c) => c.type === 'time_off' && c.scope === 'subject' && (c.scope_id ?? null) === scopeId && c.day === day && c.slot_id === slotId)

  return (
    <div>
      <Field label="Subject">
        <SmartSelect options={options} value={subjectId} onChange={setSubjectId} placeholder="All subjects" searchPlaceholder="Search subjects…" />
      </Field>

      <Section title="Time off" hint="Tap a period this subject must never be taught in." first>
        <TimeOffGrid days={days} slots={slots} isOn={isOn} onToggle={(d, s) => onToggle('subject', scopeId, 'time_off', d, s)} />
      </Section>

      <Section title="Load limits" hint="Leave blank for no limit. Optionally restrict caps to one homeroom.">
        <div className="mb-3 max-w-xs">
          <Field label="Applies to homeroom">
            <SmartSelect options={homeroomTargetOptions} value={homeroomTarget} onChange={setHomeroomTarget} placeholder="Any homeroom" searchPlaceholder="Search classes…" />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Min / day">
            <ValueInput seed={valueOf(constraints, 'subject', scopeId, hrTarget, 'min_per_day')} onCommit={(v) => onCommitValue('subject', scopeId, hrTarget, 'min_per_day', v)} />
          </Field>
          <Field label="Max / day">
            <ValueInput seed={valueOf(constraints, 'subject', scopeId, hrTarget, 'max_per_day')} onCommit={(v) => onCommitValue('subject', scopeId, hrTarget, 'max_per_day', v)} />
          </Field>
          <Field label="Min / week">
            <ValueInput seed={valueOf(constraints, 'subject', scopeId, hrTarget, 'min_per_week')} onCommit={(v) => onCommitValue('subject', scopeId, hrTarget, 'min_per_week', v)} />
          </Field>
          <Field label="Max / week">
            <ValueInput seed={valueOf(constraints, 'subject', scopeId, hrTarget, 'max_per_week')} onCommit={(v) => onCommitValue('subject', scopeId, hrTarget, 'max_per_week', v)} />
          </Field>
        </div>
      </Section>
    </div>
  )
}
