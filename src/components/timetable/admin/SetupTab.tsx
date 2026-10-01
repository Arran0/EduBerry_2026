'use client'

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Plus, Trash2, CheckCircle2, Loader2, Clock, Coffee, AlertTriangle, Layers, Users, Pencil, X,
  Search, GraduationCap,
} from 'lucide-react'
import {
  createConfig, deleteConfig, setActiveConfig, deactivateConfig, updateConfig,
  fetchPeriodSlots, createPeriodSlot, deletePeriodSlot,
  createSlotGroup, updateSlotGroup, deleteSlotGroup, assignHomeroomsToSlotGroup,
} from '@/lib/timetable'
import { WEEKDAYS, WEEKDAY_LABELS } from '@/lib/timetable'
import type { TimetableConfig, PeriodSlot, SlotGroup, Weekday } from '@/lib/timetable'
import { useTimetableDraftOptional } from '../draft/TimetableDraftContext'
import type { Homeroom } from '@/lib/homerooms'
import { INPUT, BTN_PRIMARY, BTN_NEUTRAL, Section, Field, SECTION_LABEL } from '../ui'

const _cy = new Date().getFullYear()
const ACADEMIC_YEARS = Array.from({ length: 8 }, (_, i) => {
  const y = _cy - 3 + i
  return `${y}-${y + 1}`
})

interface Props {
  configs: TimetableConfig[]
  selectedConfig: TimetableConfig | null
  onSelectConfig: (id: string) => void
  onChanged: () => void
}

export default function SetupTab({ configs, selectedConfig, onSelectConfig, onChanged }: Props) {
  const [newName, setNewName] = useState('')
  const [newYear, setNewYear] = useState('')
  const [creating, setCreating] = useState(false)
  // The name compose box stays hidden until "New configuration" is clicked.
  const [showCreate, setShowCreate] = useState(false)

  const handleCreate = async () => {
    if (!newName.trim()) return
    setCreating(true)
    const cfg = await createConfig({
      name: newName.trim(),
      academic_year: newYear.trim() || null,
      working_days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
      is_active: configs.length === 0, // first config becomes active
    })
    setCreating(false)
    if (cfg) {
      setNewName('')
      setNewYear('')
      setShowCreate(false)
      onChanged()
      onSelectConfig(cfg.id)
    }
  }

  return (
    <div>
      {/* Configurations */}
      <Section title="Timetable configurations" first>
        <div className="space-y-px">
          {configs.map((c) => {
            const isSelected = selectedConfig?.id === c.id
            return (
              <div
                key={c.id}
                onClick={() => onSelectConfig(c.id)}
                className={`flex items-center gap-3 px-3 py-2.5 border cursor-pointer transition-colors ${
                  isSelected
                    ? 'border-[#27272A] bg-white'
                    : 'border-[#E4E4E7] bg-[#F5F5F5] hover:bg-[#EBEBEB]'
                }`}
              >
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-[#18181B] text-sm truncate">{c.name}</div>
                  <div className="text-[11px] text-[#71717A]">
                    {c.academic_year || 'No academic year'} · {c.working_days.length} working days
                  </div>
                </div>
                <button
                  onClick={async (e) => {
                    e.stopPropagation()
                    if (c.is_active) {
                      await deactivateConfig(c.id)
                    } else {
                      await setActiveConfig(c.id)
                    }
                    onChanged()
                  }}
                  role="switch"
                  aria-checked={c.is_active}
                  title={c.is_active ? 'Active — click to deactivate' : 'Inactive — click to activate'}
                  className={`relative flex-shrink-0 w-8 h-[1.15rem] rounded-full transition-colors ${
                    c.is_active ? 'bg-emerald-500' : 'bg-[#D4D4D8]'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 w-3.5 h-3.5 rounded-full bg-white shadow transition-transform ${
                      c.is_active ? 'translate-x-[0.75rem]' : ''
                    }`}
                  />
                </button>
                <button
                  onClick={async (e) => {
                    e.stopPropagation()
                    if (confirm(`Delete "${c.name}" and all its periods, requirements and timetables?`)) {
                      await deleteConfig(c.id)
                      onChanged()
                    }
                  }}
                  className="text-[#D4D4D8] hover:text-rose-500 transition-colors flex-shrink-0"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            )
          })}
          {configs.length === 0 && (
            <p className="text-xs text-[#A1A1AA] py-2">No configurations yet. Create one below.</p>
          )}
        </div>

        {/* Create — the compose box only appears after clicking "New configuration". */}
        {showCreate ? (
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-[1fr_auto_auto_auto] gap-2 items-end">
            <Field label="Name">
              <input
                className={INPUT}
                placeholder="e.g. Main 2025–26"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                autoFocus
              />
            </Field>
            <Field label="Academic year">
              <select className={`${INPUT} w-full sm:w-40`} value={newYear} onChange={(e) => setNewYear(e.target.value)}>
                <option value="">Select year</option>
                {ACADEMIC_YEARS.map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </Field>
            <button onClick={handleCreate} disabled={creating || !newName.trim()} className={`${BTN_PRIMARY} w-full sm:w-auto`}>
              {creating ? <Loader2 className="animate-spin" size={15} /> : <Plus size={15} />}
              Add
            </button>
            <button
              onClick={() => { setShowCreate(false); setNewName(''); setNewYear('') }}
              className="text-sm text-[#71717A] hover:text-[#18181B] px-3 py-2 transition-colors"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button onClick={() => setShowCreate(true)} className={`${BTN_PRIMARY} mt-3`}>
            <Plus size={15} />
            New configuration
          </button>
        )}
      </Section>

      {/* Class teachers live in the Homeroom hub (Homeroom → Class teacher),
          alongside that class's groups, requirements and time off. */}

      {/* Period groups — each its own week and its own bell times */}
      {selectedConfig ? (
        <PeriodGroupsSection config={selectedConfig} onChanged={onChanged} />
      ) : (
        <Section title="Working days & periods">
          <p className="text-xs text-[#71717A]">Select or create a configuration to set its working days and period slots.</p>
        </Section>
      )}
    </div>
  )
}

// ── Period groups ────────────────────────────────────────────

/**
 * A school rarely rings one bell for everyone: Primary can finish at 14:00 on a
 * five-day week while Secondary runs eight periods across six days. Each period
 * group carries its own working days and its own period slots, and homerooms
 * are pointed at one from the Homeroom editor.
 *
 * The base schedule is always present and is what a class follows until it is
 * assigned to a group — a config that never adds a group behaves exactly as it
 * always has.
 */
function PeriodGroupsSection({ config, onChanged }: { config: TimetableConfig; onChanged: () => void }) {
  const draft = useTimetableDraftOptional()
  // Stable identities: both feed effect dependencies below, and a fresh literal
  // each render would re-run them forever.
  const groups = useMemo(() => draft?.slotGroups ?? [], [draft?.slotGroups])
  const slotGroupIds = useMemo(() => draft?.slotGroupIds ?? {}, [draft?.slotGroupIds])
  // `null` selects the base schedule.
  const [selected, setSelected] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameTo, setRenameTo] = useState('')

  const reload = async () => {
    await draft?.reload()
    onChanged()
  }

  useEffect(() => {
    if (selected && !groups.some((g) => g.id === selected)) setSelected(null)
  }, [groups, selected])

  const classCount = (groupId: string | null) =>
    Object.values(slotGroupIds).filter((g) => (g ?? null) === groupId).length

  const handleAdd = async () => {
    if (!newName.trim()) return
    setBusy(true)
    const created = await createSlotGroup({
      config_id: config.id,
      name: newName.trim(),
      working_days: config.working_days,
      position: groups.length + 1,
    })
    setBusy(false)
    if (created) {
      setNewName('')
      setAdding(false)
      await reload()
      setSelected(created.id)
    }
  }

  const handleRename = async (g: SlotGroup) => {
    if (!renameTo.trim() || renameTo.trim() === g.name) { setRenaming(null); return }
    await updateSlotGroup(g.id, { name: renameTo.trim() })
    setRenaming(null)
    await reload()
  }

  const selectedGroup = selected ? groups.find((g) => g.id === selected) ?? null : null

  const row = (
    key: string, name: string, days: Weekday[], isBase: boolean, group: SlotGroup | null,
  ) => {
    const active = (group?.id ?? null) === selected
    return (
      <div
        key={key}
        onClick={() => setSelected(group?.id ?? null)}
        className={`flex items-center gap-3 px-3 py-2.5 border cursor-pointer transition-colors ${
          active ? 'border-[#27272A] bg-white' : 'border-[#E4E4E7] bg-[#F5F5F5] hover:bg-[#EBEBEB]'
        }`}
      >
        {isBase
          ? <Clock size={14} className="text-[#71717A] flex-shrink-0" />
          : <Layers size={14} className="text-indigo-500 flex-shrink-0" />}
        <div className="flex-1 min-w-0">
          {group && renaming === group.id ? (
            <input
              autoFocus
              className={`${INPUT} py-0.5`}
              value={renameTo}
              onChange={(e) => setRenameTo(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onBlur={() => handleRename(group)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleRename(group)
                if (e.key === 'Escape') setRenaming(null)
              }}
            />
          ) : (
            <div className="font-medium text-[#18181B] text-sm truncate">{name}</div>
          )}
          <div className="text-[11px] text-[#71717A]">
            {days.length} working day{days.length === 1 ? '' : 's'}
            {isBase && ' · every class not in a group'}
          </div>
        </div>
        <span
          className="inline-flex items-center gap-1 text-[11px] text-[#71717A] flex-shrink-0"
          title="Classes following this schedule"
        >
          <Users size={12} /> {classCount(group?.id ?? null)}
        </span>
        {group && (
          <>
            <button
              onClick={(e) => { e.stopPropagation(); setRenaming(group.id); setRenameTo(group.name) }}
              className="text-[#D4D4D8] hover:text-[#52525B] transition-colors flex-shrink-0"
              title="Rename"
            >
              <Pencil size={14} />
            </button>
            <button
              onClick={async (e) => {
                e.stopPropagation()
                if (!confirm(`Delete "${group.name}"? Its periods go with it and its classes fall back to the base schedule.`)) return
                await deleteSlotGroup(group.id)
                await reload()
              }}
              className="text-[#D4D4D8] hover:text-rose-500 transition-colors flex-shrink-0"
            >
              <Trash2 size={15} />
            </button>
          </>
        )}
      </div>
    )
  }

  return (
    <>
      <Section
        title="Period groups"
        hint="Different parts of the school can run different bells. Each group has its own working days and periods; assign classes to one from the Homeroom editor."
      >
        <div className="space-y-px">
          {row('base', 'Base schedule', config.working_days, true, null)}
          {groups.map((g) =>
            row(g.id, g.name, g.working_days.length > 0 ? g.working_days : config.working_days, false, g),
          )}
        </div>

        {adding ? (
          <div className="mt-3 flex items-end gap-2">
            <div className="flex-1">
              <Field label="Group name">
                <input
                  className={INPUT}
                  autoFocus
                  placeholder="e.g. Primary, Secondary, Kindergarten"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleAdd() }}
                />
              </Field>
            </div>
            <button onClick={handleAdd} disabled={busy || !newName.trim()} className={BTN_PRIMARY}>
              {busy ? <Loader2 className="animate-spin" size={15} /> : <Plus size={15} />} Add
            </button>
            <button
              onClick={() => { setAdding(false); setNewName('') }}
              className="text-sm text-[#71717A] hover:text-[#18181B] px-2 py-2 transition-colors"
            >
              <X size={15} />
            </button>
          </div>
        ) : (
          <button onClick={() => setAdding(true)} className={`${BTN_PRIMARY} mt-3`}>
            <Plus size={15} /> New period group
          </button>
        )}
      </Section>

      <div className="border-l-2 border-[#E4E4E7] pl-3 mt-4">
        <div className={`${SECTION_LABEL} mb-1`}>
          Editing {selectedGroup ? selectedGroup.name : 'the base schedule'}
        </div>
        <WorkingDaysSection
          config={config}
          group={selectedGroup}
          onChanged={reload}
        />
        <PeriodSlotsSection config={config} group={selectedGroup} onChanged={reload} />
        <GroupClassesSection config={config} group={selectedGroup} onChanged={reload} />
      </div>
    </>
  )
}

// ── Working days ─────────────────────────────────────────────

function WorkingDaysSection({
  config, group, onChanged,
}: {
  config: TimetableConfig
  // null = the config's base schedule.
  group: SlotGroup | null
  onChanged: () => void
}) {
  const saved = group
    ? (group.working_days.length > 0 ? group.working_days : config.working_days)
    : config.working_days
  const [days, setDays] = useState<Weekday[]>(saved)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setDays(saved)
    // `saved` is derived from these two, so they are what the reset tracks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.id, config.working_days, group?.id, group?.working_days])

  const toggle = (d: Weekday) =>
    setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]))

  const dirty = days.length !== saved.length || days.some((d) => !saved.includes(d))

  const save = async () => {
    setSaving(true)
    const ordered = WEEKDAYS.filter((d) => days.includes(d))
    if (group) await updateSlotGroup(group.id, { working_days: ordered })
    else await updateConfig(config.id, { working_days: ordered })
    setSaving(false)
    onChanged()
  }

  return (
    <Section title="Working days" first>
      <div className="flex flex-wrap gap-px">
        {WEEKDAYS.map((d) => {
          const on = days.includes(d)
          return (
            <button
              key={d}
              onClick={() => toggle(d)}
              className={`px-3.5 py-2 text-sm font-medium border transition-colors ${
                on
                  ? 'bg-[#27272A] text-[#F5F5F5] border-[#27272A]'
                  : 'bg-[#F5F5F5] text-[#52525B] border-[#E4E4E7] hover:bg-[#EBEBEB]'
              }`}
            >
              {WEEKDAY_LABELS[d].slice(0, 3)}
            </button>
          )
        })}
      </div>
      {dirty && (
        <button
          onClick={save}
          disabled={saving || days.length === 0}
          className={`${BTN_PRIMARY} mt-3`}
        >
          {saving ? <Loader2 className="animate-spin" size={14} /> : <CheckCircle2 size={14} />}
          Save working days
        </button>
      )}
    </Section>
  )
}

// ── Period slots ─────────────────────────────────────────────

function PeriodSlotsSection({
  config, group, onChanged,
}: {
  config: TimetableConfig
  group: SlotGroup | null
  onChanged: () => void
}) {
  const [slots, setSlots] = useState<PeriodSlot[]>([])
  const [loading, setLoading] = useState(true)
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [label, setLabel] = useState('')
  const [isBreak, setIsBreak] = useState(false)
  const [adding, setAdding] = useState(false)

  const groupId = group?.id ?? null

  const load = useCallback(async () => {
    setLoading(true)
    const all = await fetchPeriodSlots(config.id)
    // Each period group numbers its own periods from 1, so only this group's
    // slots are listed — and only they are renumbered when one is removed.
    setSlots(all.filter((s) => (s.group_id ?? null) === groupId))
    setLoading(false)
  }, [config.id, groupId])

  useEffect(() => {
    load()
  }, [load])

  // A slot that ends before it starts, or overlaps the slot above it, would
  // quietly corrupt every grid built on it — refuse it at the form.
  const slotProblem = ((): string | null => {
    if (!start || !end) return null
    if (end <= start) return 'The end time must be after the start time.'
    const prev = [...slots].reverse().find((s) => s.end_time)
    if (prev?.end_time && start < prev.end_time.slice(0, 5)) {
      return `This overlaps “${prev.label}”, which runs until ${prev.end_time.slice(0, 5)}.`
    }
    return null
  })()

  const handleAdd = async () => {
    if (slotProblem) return
    setAdding(true)
    const position = slots.length > 0 ? Math.max(...slots.map((s) => s.position)) + 1 : 1
    // The default "Period N" label should count teaching slots only — a
    // break never gets a period number, and the slot after it isn't
    // skipped to make room for one.
    const teachingCount = slots.filter((s) => !s.is_break).length
    const created = await createPeriodSlot({
      config_id: config.id,
      group_id: groupId,
      position,
      // Timings are optional — a slot can be just "Period N".
      start_time: start || null,
      end_time: end || null,
      label: label.trim() || (isBreak ? 'Break' : `Period ${teachingCount + 1}`),
      is_break: isBreak,
    })
    setAdding(false)
    if (created) {
      setStart('')
      setEnd('')
      setLabel('')
      setIsBreak(false)
      load()
      onChanged()
    }
  }

  return (
    <Section
      title="Period slots"
      hint={`These are the rows of the grid${
        group ? ` for ${group.name}` : ''
      }. Mark lunch/recess as a break — the generator skips break slots.`}
    >
      {loading ? (
        <div className="flex justify-center py-6 text-[#A1A1AA]">
          <Loader2 className="animate-spin" size={18} />
        </div>
      ) : (
        <div className="space-y-px">
          {(() => {
            let teachingPosition = 0
            return slots.map((s) => {
              if (!s.is_break) teachingPosition += 1
              return (
            <div
              key={s.id}
              className={`flex items-center gap-3 px-3 py-2 border ${
                s.is_break ? 'border-amber-200 bg-amber-50/70' : 'border-[#E4E4E7] bg-[#F5F5F5]'
              }`}
            >
              <span className="text-[11px] font-mono text-[#A1A1AA] w-5">{s.is_break ? '—' : teachingPosition}</span>
              {s.is_break ? (
                <Coffee size={14} className="text-amber-500 flex-shrink-0" />
              ) : (
                <Clock size={14} className="text-[#71717A] flex-shrink-0" />
              )}
              <span className="text-sm font-medium text-[#18181B] flex-1 truncate">{s.label}</span>
              <span className="text-sm text-[#71717A] tabular-nums">
                {s.start_time && s.end_time
                  ? `${s.start_time.slice(0, 5)} – ${s.end_time.slice(0, 5)}`
                  : 'No time'}
              </span>
              <button
                onClick={async () => {
                  await deletePeriodSlot(s.id)
                  load()
                  onChanged()
                }}
                className="text-[#D4D4D8] hover:text-rose-500 transition-colors flex-shrink-0"
              >
                <Trash2 size={15} />
              </button>
            </div>
              )
            })
          })()}
          {slots.length === 0 && (
            <p className="text-xs text-[#A1A1AA] py-2">No period slots yet.</p>
          )}
        </div>
      )}

      {/* Add slot — timings are optional */}
      <div className="mt-3 grid grid-cols-2 sm:grid-cols-[auto_auto_1fr_auto_auto] gap-2 items-end">
        <Field label="Start (optional)">
          <input type="time" className={INPUT} value={start} onChange={(e) => setStart(e.target.value)} />
        </Field>
        <Field label="End (optional)">
          <input type="time" className={INPUT} value={end} onChange={(e) => setEnd(e.target.value)} />
        </Field>
        <div className="col-span-2 sm:col-span-1">
          <Field label="Label (optional)">
            <input className={INPUT} placeholder="Period 1 / Lunch" value={label} onChange={(e) => setLabel(e.target.value)} />
          </Field>
        </div>
        <label className="flex items-center gap-1.5 text-sm text-[#52525B] pb-2">
          <input type="checkbox" checked={isBreak} onChange={(e) => setIsBreak(e.target.checked)} className="accent-[#27272A]" />
          Break
        </label>
        <button onClick={handleAdd} disabled={adding || slotProblem !== null} className={`${BTN_PRIMARY} col-span-1 sm:col-span-1`}>
          {adding ? <Loader2 className="animate-spin" size={15} /> : <Plus size={15} />}
          Add slot
        </button>
      </div>
      {slotProblem && (
        <div className="mt-2 flex items-start gap-2 px-3 py-2 bg-rose-50 border border-rose-200 text-[12px] text-rose-800">
          <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
          <span>{slotProblem}</span>
        </div>
      )}
    </Section>
  )
}

// ── Which classes follow a schedule ──────────────────────────

// A homeroom counts while it hasn't expired.
const isActiveHomeroom = (h: Homeroom) =>
  !h.expiry_date || h.expiry_date >= new Date().toISOString().slice(0, 10)

const gradeLabel = (h: Homeroom) =>
  h.grade != null ? `Grade ${h.grade}` : 'No grade'

/**
 * Assigns classes to a period group in bulk.
 *
 * A year group almost always rings to the same bell, so the useful unit is the
 * grade, not the class: the grade chips tick every homeroom in a grade at once
 * and untick them the same way. Classes already following another group are
 * shown with that group's name, so moving a grade across never silently
 * overwrites an assignment the admin can't see.
 *
 * Ticking for the base schedule means "no group row", which is how an
 * unassigned class is stored.
 */
function GroupClassesSection({
  config, group, onChanged,
}: {
  config: TimetableConfig
  group: SlotGroup | null
  onChanged: () => void
}) {
  const draft = useTimetableDraftOptional()
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [note, setNote] = useState('')

  const groupId = group?.id ?? null
  const homerooms = useMemo(
    () => (draft?.homerooms ?? []).filter(isActiveHomeroom),
    [draft?.homerooms],
  )
  // Stable identity: `stored` below is memoised on this and drives an effect
  // that resets the tick boxes. A fresh object each render would reset them on
  // every render instead of only when the saved assignment changes.
  const assigned = useMemo(() => draft?.slotGroupIds ?? {}, [draft?.slotGroupIds])
  const groupNameOf = useCallback(
    (id: string | null) => (id === null ? 'Base schedule' : draft?.slotGroups.find((g) => g.id === id)?.name ?? '—'),
    [draft?.slotGroups],
  )

  // Reset the tick boxes to what is stored whenever the saved state or the
  // selected group changes, so the control never shows a stale diff.
  const stored = useMemo(
    () => new Set(homerooms.filter((h) => (assigned[h.id] ?? null) === groupId).map((h) => h.id)),
    [homerooms, assigned, groupId],
  )
  useEffect(() => { setPicked(new Set(stored)); setNote('') }, [stored])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q
      ? homerooms.filter((h) => h.name.toLowerCase().includes(q) || gradeLabel(h).toLowerCase().includes(q))
      : homerooms
  }, [homerooms, query])

  // Grades in ascending order, ungraded classes last.
  const grades = useMemo(() => {
    const m = new Map<string, Homeroom[]>()
    for (const h of homerooms) {
      const k = gradeLabel(h)
      const arr = m.get(k)
      if (arr) arr.push(h)
      else m.set(k, [h])
    }
    return [...m.entries()].sort((a, b) => {
      const na = parseInt(a[0].replace(/\D/g, ''), 10)
      const nb = parseInt(b[0].replace(/\D/g, ''), 10)
      if (Number.isNaN(na)) return 1
      if (Number.isNaN(nb)) return -1
      return na - nb
    })
  }, [homerooms])

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  // One tap for a whole grade: adds every class in it, or clears them when the
  // grade is already fully ticked.
  const toggleGrade = (members: Homeroom[]) =>
    setPicked((prev) => {
      const next = new Set(prev)
      const allIn = members.every((h) => next.has(h.id))
      for (const h of members) {
        if (allIn) next.delete(h.id)
        else next.add(h.id)
      }
      return next
    })

  const added = [...picked].filter((id) => !stored.has(id))
  const removed = [...stored].filter((id) => !picked.has(id))
  const dirty = added.length > 0 || removed.length > 0

  const save = async () => {
    setSaving(true)
    // Unticking here puts a class back on the base schedule; that is the only
    // place it can go without choosing another group for it.
    const ok =
      (added.length === 0 || (await assignHomeroomsToSlotGroup(config.id, added, groupId))) &&
      (removed.length === 0 || (await assignHomeroomsToSlotGroup(config.id, removed, null)))
    if (ok) {
      await draft?.reload()
      // These classes' lessons sit in their old schedule's periods, which do
      // not exist in the new week — they would render nowhere while still
      // counting in clash detection, so they go and are rebuilt on generate.
      const touched = new Set([...added, ...removed])
      draft?.setEntries((prev) => prev.filter((e) => !touched.has(e.homeroomId)))
      onChanged()
      setNote(
        [
          added.length > 0 ? `${added.length} moved in` : '',
          removed.length > 0 ? `${removed.length} back on the base schedule` : '',
        ].filter(Boolean).join(' · '),
      )
    } else {
      setNote('Could not save the assignment — check console.')
    }
    setSaving(false)
  }

  if (!draft) return null

  return (
    <Section
      title={group ? `Classes on ${group.name}` : 'Classes on the base schedule'}
      hint={
        group
          ? 'Tick the classes that ring to this schedule. A grade chip ticks the whole year group at once. Unticking puts a class back on the base schedule.'
          : 'Every class not assigned to a period group follows this schedule. Tick one here to move it back off a group.'
      }
      right={
        <span className="text-sm font-semibold tabular-nums text-[#18181B]">
          {picked.size}
          <span className="text-[#A1A1AA] font-normal">/{homerooms.length}</span>
        </span>
      }
    >
      {homerooms.length === 0 ? (
        <p className="text-xs text-[#A1A1AA] py-2">No active homerooms.</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-1 mb-2.5">
            {grades.map(([label, members]) => {
              const allIn = members.every((h) => picked.has(h.id))
              const someIn = !allIn && members.some((h) => picked.has(h.id))
              return (
                <button
                  key={label}
                  onClick={() => toggleGrade(members)}
                  title={allIn ? `Remove all of ${label}` : `Add all ${members.length} classes in ${label}`}
                  className={`inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium border transition-colors ${
                    allIn
                      ? 'bg-[#27272A] text-white border-[#27272A]'
                      : someIn
                        ? 'bg-white text-[#18181B] border-[#27272A]'
                        : 'bg-[#F5F5F5] text-[#52525B] border-[#E4E4E7] hover:bg-[#EBEBEB]'
                  }`}
                >
                  <GraduationCap size={12} className={allIn ? 'text-[#B8983C]' : 'text-[#71717A]'} />
                  {label}
                  <span className={allIn ? 'text-white/60' : 'text-[#A1A1AA]'}>{members.length}</span>
                </button>
              )
            })}
          </div>

          <div className="flex items-center gap-2 border border-[#D4D4D8] bg-white px-2.5 py-1.5 mb-1.5">
            <Search size={13} className="text-[#A1A1AA] flex-shrink-0" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search classes…"
              className="flex-1 min-w-0 bg-transparent text-sm focus:outline-none"
            />
          </div>

          <div className="max-h-56 overflow-y-auto border border-[#E4E4E7] divide-y divide-[#F5F5F5]">
            {filtered.length === 0 ? (
              <p className="text-xs text-[#A1A1AA] p-2.5">No classes match.</p>
            ) : filtered.map((h) => {
              const on = picked.has(h.id)
              const current = assigned[h.id] ?? null
              // Where it sits now, when that isn't the schedule being edited.
              const elsewhere = current !== groupId ? groupNameOf(current) : null
              return (
                <label
                  key={h.id}
                  className={`flex items-center gap-2.5 px-2.5 py-1.5 text-sm cursor-pointer transition-colors ${
                    on ? 'bg-[#FAFAF9]' : 'hover:bg-[#FAFAF9]'
                  }`}
                >
                  <input type="checkbox" checked={on} onChange={() => toggle(h.id)} className="accent-[#27272A]" />
                  <span className="flex-1 min-w-0 truncate text-[#18181B]">{h.name}</span>
                  {elsewhere && (
                    <span
                      className="text-[10px] px-1.5 py-0.5 bg-[#F5F5F5] border border-[#E4E4E7] text-[#71717A] flex-shrink-0"
                      title={`Currently follows ${elsewhere}`}
                    >
                      {elsewhere}
                    </span>
                  )}
                </label>
              )
            })}
          </div>

          <div className="flex items-center gap-2 mt-2.5 flex-wrap">
            <button onClick={save} disabled={!dirty || saving} className={`${BTN_PRIMARY} disabled:opacity-40`}>
              {saving ? <Loader2 className="animate-spin" size={15} /> : <CheckCircle2 size={15} />}
              Save assignment
            </button>
            {dirty && (
              <button
                onClick={() => setPicked(new Set(stored))}
                className={`${BTN_NEUTRAL} py-2`}
              >
                Reset
              </button>
            )}
            {dirty && (
              <span className="text-[11px] text-[#71717A]">
                {added.length > 0 && `${added.length} to add`}
                {added.length > 0 && removed.length > 0 && ' · '}
                {removed.length > 0 && `${removed.length} to remove`}
                {' — their current lessons are cleared and rebuilt on the next generate.'}
              </span>
            )}
            {!dirty && note && <span className="text-[11px] text-emerald-700">{note}</span>}
          </div>
        </>
      )}
    </Section>
  )
}
