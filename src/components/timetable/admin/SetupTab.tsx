'use client'

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Plus, Trash2, CheckCircle2, Loader2, Clock, Coffee, Layers, Users, Pencil, X,
  Search, GraduationCap,
} from 'lucide-react'
import {
  createConfig, deleteConfig, setActiveConfig, deactivateConfig, updateConfig,
  fetchPeriodSlots, createPeriodSlot, deletePeriodSlot, clearPeriodSlotTimes,
  createSlotGroup, updateSlotGroup, deleteSlotGroup, assignHomeroomsToSlotGroup,
} from '@/lib/timetable'
import { WEEKDAYS, WEEKDAY_LABELS } from '@/lib/timetable'
import type { TimetableConfig, PeriodSlot, SlotGroup, Weekday } from '@/lib/timetable'
import { useTimetableDraftOptional } from '../draft/TimetableDraftContext'
import type { Homeroom } from '@/lib/homerooms'
import {
  INPUT, BTN_PRIMARY, BTN_NEUTRAL, BTN_QUIET, Section, Field, ICON_BTN, ICON_BTN_DANGER,
  CHECK, Switch, Notice, Chip, Loading, askConfirm, choice,
} from '../ui'

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
      <Section title="Timetables" hint="Each one has its own working days, periods and lessons. Switch one on to make it the timetable people see." first>
        {configs.length === 0 ? (
          <p className="text-[12.5px] text-slate-400 py-1">No timetables yet.</p>
        ) : (
          <div className="fx-card">
            {configs.map((c) => {
              const isSelected = selectedConfig?.id === c.id
              return (
                <div
                  key={c.id}
                  className={`relative flex items-center gap-2.5 pl-3.5 pr-1.5 py-2 border-b border-[#EEEAE1] last:border-b-0 transition-colors ${
                    isSelected ? 'bg-[#FAF7F0]' : 'hover:bg-[#FAF8F3]'
                  }`}
                >
                  {isSelected && <span aria-hidden className="absolute left-0 top-0 bottom-0 w-[3px] bg-[#B8983C]" />}
                  <button
                    onClick={() => onSelectConfig(c.id)}
                    aria-current={isSelected ? 'true' : undefined}
                    className="flex-1 min-w-0 text-left py-0.5 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B8983C]/60"
                  >
                    <span className="block text-[13.5px] font-semibold text-slate-900 leading-snug break-words">{c.name}</span>
                    <span className="block text-[12px] text-slate-500">
                      {c.academic_year || 'No academic year'} · {c.working_days.length} working days
                    </span>
                  </button>
                  {c.is_active && <Chip tone="good" className="hidden sm:inline-flex">Active</Chip>}
                  <Switch
                    checked={c.is_active}
                    label={c.is_active ? `Switch ${c.name} off` : `Make ${c.name} active`}
                    onChange={async () => {
                      if (c.is_active) await deactivateConfig(c.id)
                      else await setActiveConfig(c.id)
                      onChanged()
                    }}
                  />
                  <button
                    onClick={async () => {
                      const ok = await askConfirm({
                        title: `Delete ${c.name}?`,
                        body: 'Its periods, lessons and saved timetables are deleted with it. This cannot be undone.',
                        confirmLabel: 'Delete timetable',
                        tone: 'danger',
                      })
                      if (!ok) return
                      await deleteConfig(c.id)
                      onChanged()
                    }}
                    aria-label={`Delete ${c.name}`}
                    title="Delete"
                    className={ICON_BTN_DANGER}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              )
            })}
          </div>
        )}

        {/* The compose box only appears after "New timetable" is pressed. */}
        {showCreate ? (
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_11rem_auto_auto] gap-2 items-end">
            <Field label="Name">
              <input
                className={INPUT}
                placeholder="e.g. Main 2025–26"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleCreate() }}
                autoFocus
              />
            </Field>
            <Field label="Academic year">
              <select className={INPUT} value={newYear} onChange={(e) => setNewYear(e.target.value)}>
                <option value="">None</option>
                {ACADEMIC_YEARS.map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </Field>
            <button onClick={handleCreate} disabled={creating || !newName.trim()} className={BTN_PRIMARY}>
              {creating ? <Loader2 className="animate-spin" size={15} /> : <Plus size={15} />}
              Add
            </button>
            <button
              onClick={() => { setShowCreate(false); setNewName(''); setNewYear('') }}
              className={BTN_QUIET}
            >
              Cancel
            </button>
          </div>
        ) : (
          <button onClick={() => setShowCreate(true)} className={`${BTN_NEUTRAL} mt-3`}>
            <Plus size={15} />
            New timetable
          </button>
        )}
      </Section>

      {/* Class teachers live in the Homeroom hub (Homeroom → Class teacher),
          alongside that class's groups, requirements and time off. */}

      {/* Period groups — each its own week and its own bell times */}
      {selectedConfig ? (
        <PeriodGroupsSection config={selectedConfig} onChanged={onChanged} />
      ) : (
        <Section title="Working days and periods">
          <p className="text-[12.5px] text-slate-500">Create a timetable above to set its working days and periods.</p>
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
        className={`relative flex items-center gap-2.5 pl-3.5 pr-1.5 py-2 border-b border-[#EEEAE1] last:border-b-0 transition-colors ${
          active ? 'bg-[#FAF7F0]' : 'hover:bg-[#FAF8F3]'
        }`}
      >
        {active && <span aria-hidden className="absolute left-0 top-0 bottom-0 w-[3px] bg-[#B8983C]" />}
        {isBase
          ? <Clock size={14} className="text-slate-400 flex-shrink-0" />
          : <Layers size={14} className="text-indigo-500 flex-shrink-0" />}
        {group && renaming === group.id ? (
          <input
            autoFocus
            className={`${INPUT} flex-1`}
            value={renameTo}
            onChange={(e) => setRenameTo(e.target.value)}
            onBlur={() => handleRename(group)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleRename(group)
              if (e.key === 'Escape') { e.stopPropagation(); setRenaming(null) }
            }}
          />
        ) : (
          <button
            onClick={() => setSelected(group?.id ?? null)}
            aria-current={active ? 'true' : undefined}
            className="flex-1 min-w-0 text-left py-0.5 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B8983C]/60"
          >
            <span className="block text-[13.5px] font-semibold text-slate-900 leading-snug break-words">{name}</span>
            <span className="block text-[12px] text-slate-500">
              {days.length} working day{days.length === 1 ? '' : 's'}
              {isBase && ' · every class not in a group'}
            </span>
          </button>
        )}
        <span
          className="inline-flex items-center gap-1 text-[12px] text-slate-500 flex-shrink-0 tabular-nums"
          title="Classes following this schedule"
        >
          <Users size={12} /> {classCount(group?.id ?? null)}
        </span>
        {group && (
          <>
            <button
              onClick={() => { setRenaming(group.id); setRenameTo(group.name) }}
              className={ICON_BTN}
              aria-label={`Rename ${group.name}`}
              title="Rename"
            >
              <Pencil size={14} />
            </button>
            <button
              onClick={async () => {
                const ok = await askConfirm({
                  title: `Delete ${group.name}?`,
                  body: 'Its periods are deleted with it, and its classes go back to the base schedule.',
                  confirmLabel: 'Delete group',
                  tone: 'danger',
                })
                if (!ok) return
                await deleteSlotGroup(group.id)
                await reload()
              }}
              className={ICON_BTN_DANGER}
              aria-label={`Delete ${group.name}`}
              title="Delete"
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
        hint="Parts of the school can run different bells. Each group has its own working days and periods."
      >
        <div className="fx-card">
          {row('base', 'Base schedule', config.working_days, true, null)}
          {groups.map((g) =>
            row(g.id, g.name, g.working_days.length > 0 ? g.working_days : config.working_days, false, g),
          )}
        </div>

        {adding ? (
          <div className="mt-3 flex items-end gap-2">
            <div className="flex-1 min-w-0">
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
              className={ICON_BTN}
              aria-label="Cancel"
              title="Cancel"
            >
              <X size={15} />
            </button>
          </div>
        ) : (
          <button onClick={() => setAdding(true)} className={`${BTN_NEUTRAL} mt-3`}>
            <Plus size={15} /> New period group
          </button>
        )}
      </Section>

      <div className="border-t border-[#EEEAE1] mt-5 pt-4">
        <p className="mb-3 inline-flex flex-wrap items-center gap-1.5 text-[12.5px] text-slate-500">
          Editing
          <Chip tone="dark">{selectedGroup ? selectedGroup.name : 'Base schedule'}</Chip>
        </p>
        <WorkingDaysSection
          config={config}
          group={selectedGroup}
          onChanged={reload}
        />
        <PeriodSlotsSection
          config={config}
          group={selectedGroup}
          multiGroup={groups.length > 0}
          onChanged={reload}
        />
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
      <div className="flex flex-wrap gap-1.5">
        {WEEKDAYS.map((d) => {
          const on = days.includes(d)
          return (
            <button key={d} onClick={() => toggle(d)} aria-pressed={on} className={`${choice(on)} min-w-[3.25rem] justify-center`}>
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
  config, group, multiGroup, onChanged,
}: {
  config: TimetableConfig
  group: SlotGroup | null
  /**
   * True once the config has at least one period group beside the base
   * schedule, which is when clock times start costing more than they give.
   */
  multiGroup: boolean
  onChanged: () => void
}) {
  const [slots, setSlots] = useState<PeriodSlot[]>([])
  const [loading, setLoading] = useState(true)
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [label, setLabel] = useState('')
  const [isBreak, setIsBreak] = useState(false)
  const [adding, setAdding] = useState(false)
  const [clearing, setClearing] = useState(false)

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

  const timedSlots = slots.filter((s) => s.start_time || s.end_time)

  // A slot that ends before it starts, or overlaps the slot above it, would
  // quietly corrupt every grid built on it — refuse it at the form.
  const slotProblem = ((): string | null => {
    if (multiGroup || !start || !end) return null
    if (end <= start) return 'The end time has to be after the start time.'
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
      // Timings are optional always, and unavailable once a second period
      // group exists — see the note in the section below.
      start_time: multiGroup ? null : start || null,
      end_time: multiGroup ? null : end || null,
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
      title="Periods"
      hint={`The rows of the grid${
        group ? ` for ${group.name}` : ''
      }. Mark lunch or recess as a break and nothing is scheduled in it.`}
      right={
        multiGroup && timedSlots.length > 0 ? (
          <button
            onClick={async () => {
              const ok = await askConfirm({
                title: 'Remove the clock times?',
                body: `${timedSlots.length} period${timedSlots.length === 1 ? ' keeps its' : 's keep their'} place in the grid. Only the times go.`,
                confirmLabel: 'Remove times',
              })
              if (!ok) return
              setClearing(true)
              await clearPeriodSlotTimes(config.id, groupId)
              setClearing(false)
              load()
              onChanged()
            }}
            className={BTN_NEUTRAL}
          >
            {clearing ? <Loader2 className="animate-spin" size={14} /> : <Clock size={14} />}
            Remove times
          </button>
        ) : undefined
      }
    >
      {loading ? (
        <Loading className="py-6" />
      ) : slots.length === 0 ? (
        <p className="text-[12.5px] text-slate-400 py-1">No periods yet.</p>
      ) : (
        <div className="fx-card">
          {(() => {
            let teachingPosition = 0
            return slots.map((s) => {
              if (!s.is_break) teachingPosition += 1
              return (
                <div
                  key={s.id}
                  className={`flex items-center gap-2.5 pl-3 pr-1.5 py-1.5 border-b border-[#EEEAE1] last:border-b-0 ${
                    s.is_break ? 'bg-[#FBF6E9]' : ''
                  }`}
                >
                  <span className="text-[11.5px] font-mono text-slate-400 w-5 text-right flex-shrink-0">{s.is_break ? '–' : teachingPosition}</span>
                  {s.is_break ? (
                    <Coffee size={14} className="text-amber-500 flex-shrink-0" />
                  ) : (
                    <Clock size={14} className="text-slate-400 flex-shrink-0" />
                  )}
                  <span className="text-[13.5px] font-medium text-slate-900 flex-1 min-w-0 break-words">{s.label}</span>
                  {s.start_time && s.end_time && (
                    <span className="text-[12.5px] text-slate-500 tabular-nums flex-shrink-0">
                      {s.start_time.slice(0, 5)}–{s.end_time.slice(0, 5)}
                    </span>
                  )}
                  <button
                    onClick={async () => {
                      await deletePeriodSlot(s.id)
                      load()
                      onChanged()
                    }}
                    className={ICON_BTN_DANGER}
                    aria-label={`Delete ${s.label}`}
                    title="Delete"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              )
            })
          })()}
        </div>
      )}

      {/* Why the time fields are not here. This is a real trade, not a
          simplification: with two bells running different clocks, period 3 of
          one band overlaps periods 2 AND 3 of the other, so a teacher who
          works across both is marked busy twice over and becomes near
          impossible to place. Untimed periods collide position-for-position —
          a clean 1:1 — and staff can be shared freely. */}
      {multiGroup && (
        <Notice tone="info" icon={Clock} className="mt-3">
          Periods are numbered, not timed, while there is more than one period group. Bells on
          different clocks overlap, and a teacher who works across both cannot be placed.
          Numbered periods line up one for one, so staff can be shared.
        </Notice>
      )}

      {/* Add slot */}
      <div className={`mt-3 grid grid-cols-2 gap-2 items-end ${
        multiGroup ? 'sm:grid-cols-[minmax(0,1fr)_auto_auto]' : 'sm:grid-cols-[8rem_8rem_minmax(0,1fr)_auto_auto]'
      }`}>
        {!multiGroup && (
          <>
            <Field label="Starts">
              <input type="time" className={INPUT} value={start} onChange={(e) => setStart(e.target.value)} />
            </Field>
            <Field label="Ends">
              <input type="time" className={INPUT} value={end} onChange={(e) => setEnd(e.target.value)} />
            </Field>
          </>
        )}
        <div className="col-span-2 sm:col-span-1">
          <Field label="Name">
            <input className={INPUT} placeholder={isBreak ? 'Break' : 'Next period number'} value={label} onChange={(e) => setLabel(e.target.value)} />
          </Field>
        </div>
        <label className="flex items-center gap-2 h-10 sm:h-9 text-[13.5px] text-slate-700 cursor-pointer">
          <input type="checkbox" checked={isBreak} onChange={(e) => setIsBreak(e.target.checked)} className={CHECK} />
          Break
        </label>
        <button onClick={handleAdd} disabled={adding || slotProblem !== null} className={BTN_PRIMARY}>
          {adding ? <Loader2 className="animate-spin" size={15} /> : <Plus size={15} />}
          Add period
        </button>
      </div>
      {!multiGroup && <p className="mt-1.5 text-[11.5px] text-slate-400">Times are optional.</p>}
      {slotProblem && <Notice tone="error" className="mt-2">{slotProblem}</Notice>}
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
      setNote('Could not save. Nothing changed.')
    }
    setSaving(false)
  }

  if (!draft) return null

  return (
    <Section
      title={group ? `Classes on ${group.name}` : 'Classes on the base schedule'}
      hint={
        group
          ? 'Tick the classes that follow this schedule. A grade ticks the whole year at once. Unticking a class puts it back on the base schedule.'
          : 'Every class not in a period group follows this schedule. Tick one to move it back from a group.'
      }
      right={
        <span className="text-sm font-semibold tabular-nums text-slate-900">
          {picked.size}
          <span className="text-slate-400 font-normal">/{homerooms.length}</span>
        </span>
      }
    >
      {homerooms.length === 0 ? (
        <p className="text-[12.5px] text-slate-400 py-1">No active classes.</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5 mb-2.5">
            {grades.map(([label, members]) => {
              const allIn = members.every((h) => picked.has(h.id))
              const someIn = !allIn && members.some((h) => picked.has(h.id))
              return (
                <button
                  key={label}
                  onClick={() => toggleGrade(members)}
                  aria-pressed={allIn}
                  title={allIn ? `Remove all of ${label}` : `Add all ${members.length} classes in ${label}`}
                  className={`${choice(allIn)} ${someIn ? '!border-[#27272A]' : ''}`}
                >
                  <GraduationCap size={12} className={allIn ? 'text-[#E9DDBB]' : 'text-slate-400'} />
                  {label}
                  <span className={`tabular-nums ${allIn ? 'text-white/60' : 'text-slate-400'}`}>{members.length}</span>
                </button>
              )
            })}
          </div>

          <div className="relative mb-2">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search classes…"
              aria-label="Search classes"
              className={`${INPUT} pl-8`}
            />
          </div>

          <div className="fx-card max-h-64 overflow-y-auto overscroll-contain divide-y divide-[#F0ECE3]">
            {filtered.length === 0 ? (
              <p className="text-[12.5px] text-slate-400 p-3">No classes match.</p>
            ) : filtered.map((h) => {
              const on = picked.has(h.id)
              const current = assigned[h.id] ?? null
              // Where it sits now, when that isn't the schedule being edited.
              const elsewhere = current !== groupId ? groupNameOf(current) : null
              return (
                <label
                  key={h.id}
                  className={`flex items-center gap-2.5 px-3 py-2 text-[13.5px] cursor-pointer transition-colors ${
                    on ? 'bg-[#FAF7F0]' : 'hover:bg-[#FAF8F3]'
                  }`}
                >
                  <input type="checkbox" checked={on} onChange={() => toggle(h.id)} className={CHECK} />
                  <span className="flex-1 min-w-0 break-words text-slate-900">{h.name}</span>
                  {elsewhere && <Chip title={`Follows ${elsewhere} now`}>{elsewhere}</Chip>}
                </label>
              )
            })}
          </div>

          <div className="flex items-center gap-2 mt-3 flex-wrap">
            <button onClick={save} disabled={!dirty || saving} className={BTN_PRIMARY}>
              {saving ? <Loader2 className="animate-spin" size={15} /> : <CheckCircle2 size={15} />}
              Save
            </button>
            {dirty && (
              <button onClick={() => setPicked(new Set(stored))} className={BTN_QUIET}>
                Reset
              </button>
            )}
            {dirty && (
              <span className="text-[12px] text-slate-500 leading-snug min-w-0">
                {added.length > 0 && `${added.length} to add`}
                {added.length > 0 && removed.length > 0 && ' · '}
                {removed.length > 0 && `${removed.length} to remove`}
                {'. Their lessons are cleared and rebuilt on the next generate.'}
              </span>
            )}
            {!dirty && note && <span className="text-[12px] text-emerald-700">{note}</span>}
          </div>
        </>
      )}
    </Section>
  )
}
