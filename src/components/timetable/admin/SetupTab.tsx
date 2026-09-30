'use client'

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Plus, Trash2, CheckCircle2, Loader2, Clock, Coffee, AlertTriangle, Layers, Users, Pencil, X,
} from 'lucide-react'
import {
  createConfig, deleteConfig, setActiveConfig, deactivateConfig, updateConfig,
  fetchPeriodSlots, createPeriodSlot, deletePeriodSlot,
  createSlotGroup, updateSlotGroup, deleteSlotGroup,
} from '@/lib/timetable'
import { WEEKDAYS, WEEKDAY_LABELS } from '@/lib/timetable'
import type { TimetableConfig, PeriodSlot, SlotGroup, Weekday } from '@/lib/timetable'
import { useTimetableDraftOptional } from '../draft/TimetableDraftContext'
import { INPUT, BTN_PRIMARY, Section, Field, SECTION_LABEL } from '../ui'

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
