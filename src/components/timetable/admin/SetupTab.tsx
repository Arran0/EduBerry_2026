'use client'

import React, { useState, useEffect, useCallback } from 'react'
import {
  Plus, Trash2, CheckCircle2, Circle, Loader2, Clock, Coffee,
} from 'lucide-react'
import {
  createConfig, deleteConfig, setActiveConfig, updateConfig,
  fetchPeriodSlots, createPeriodSlot, deletePeriodSlot,
} from '@/lib/timetable'
import { WEEKDAYS, WEEKDAY_LABELS } from '@/lib/timetable'
import type { TimetableConfig, PeriodSlot, Weekday } from '@/lib/timetable'
import { INPUT, BTN_PRIMARY, ROW, Section, Field } from '../ui'

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
                <button
                  onClick={async (e) => {
                    e.stopPropagation()
                    if (!c.is_active) {
                      await setActiveConfig(c.id)
                      onChanged()
                    }
                  }}
                  title={c.is_active ? 'Active timetable' : 'Set as active'}
                  className="flex-shrink-0"
                >
                  {c.is_active ? (
                    <CheckCircle2 className="text-emerald-600" size={18} />
                  ) : (
                    <Circle className="text-[#D4D4D8]" size={18} />
                  )}
                </button>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-[#18181B] text-sm truncate">{c.name}</div>
                  <div className="text-[11px] text-[#71717A]">
                    {c.academic_year || 'No academic year'} · {c.working_days.length} working days
                  </div>
                </div>
                {c.is_active && (
                  <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-700 flex-shrink-0">
                    Active
                  </span>
                )}
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

        {/* Create */}
        <div className="flex items-end gap-2 flex-wrap mt-3">
          <Field label="Name">
            <input className={`${INPUT} sm:w-52`} placeholder="e.g. Main 2025–26" value={newName} onChange={(e) => setNewName(e.target.value)} />
          </Field>
          <Field label="Academic year">
            <input className={`${INPUT} sm:w-40`} placeholder="2025-2026" value={newYear} onChange={(e) => setNewYear(e.target.value)} />
          </Field>
          <button onClick={handleCreate} disabled={creating || !newName.trim()} className={BTN_PRIMARY}>
            {creating ? <Loader2 className="animate-spin" size={15} /> : <Plus size={15} />}
            Add
          </button>
        </div>
      </Section>

      {/* Working days + period slots for selected config */}
      {selectedConfig ? (
        <>
          <WorkingDaysSection config={selectedConfig} onChanged={onChanged} />
          <PeriodSlotsSection config={selectedConfig} />
        </>
      ) : (
        <Section title="Working days & periods">
          <p className="text-xs text-[#71717A]">Select or create a configuration to set its working days and period slots.</p>
        </Section>
      )}
    </div>
  )
}

// ── Working days ─────────────────────────────────────────────

function WorkingDaysSection({ config, onChanged }: { config: TimetableConfig; onChanged: () => void }) {
  const [days, setDays] = useState<Weekday[]>(config.working_days)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setDays(config.working_days)
  }, [config.id, config.working_days])

  const toggle = (d: Weekday) =>
    setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]))

  const dirty =
    days.length !== config.working_days.length ||
    days.some((d) => !config.working_days.includes(d))

  const save = async () => {
    setSaving(true)
    const ordered = WEEKDAYS.filter((d) => days.includes(d))
    await updateConfig(config.id, { working_days: ordered })
    setSaving(false)
    onChanged()
  }

  return (
    <Section title="Working days">
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

function PeriodSlotsSection({ config }: { config: TimetableConfig }) {
  const [slots, setSlots] = useState<PeriodSlot[]>([])
  const [loading, setLoading] = useState(true)
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [label, setLabel] = useState('')
  const [isBreak, setIsBreak] = useState(false)
  const [adding, setAdding] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setSlots(await fetchPeriodSlots(config.id))
    setLoading(false)
  }, [config.id])

  useEffect(() => {
    load()
  }, [load])

  const handleAdd = async () => {
    if (!start || !end) return
    setAdding(true)
    const position = slots.length > 0 ? Math.max(...slots.map((s) => s.position)) + 1 : 1
    const created = await createPeriodSlot({
      config_id: config.id,
      position,
      start_time: start,
      end_time: end,
      label: label.trim() || (isBreak ? 'Break' : `Period ${position}`),
      is_break: isBreak,
    })
    setAdding(false)
    if (created) {
      setStart('')
      setEnd('')
      setLabel('')
      setIsBreak(false)
      load()
    }
  }

  return (
    <Section title="Period slots" hint="These are the rows of the grid. Mark lunch/recess as a break — the generator skips break slots.">
      {loading ? (
        <div className="flex justify-center py-6 text-[#A1A1AA]">
          <Loader2 className="animate-spin" size={18} />
        </div>
      ) : (
        <div className="space-y-px">
          {slots.map((s) => (
            <div
              key={s.id}
              className={`flex items-center gap-3 px-3 py-2 border ${
                s.is_break ? 'border-amber-200 bg-amber-50/70' : 'border-[#E4E4E7] bg-[#F5F5F5]'
              }`}
            >
              <span className="text-[11px] font-mono text-[#A1A1AA] w-5">{s.position}</span>
              {s.is_break ? (
                <Coffee size={14} className="text-amber-500 flex-shrink-0" />
              ) : (
                <Clock size={14} className="text-[#71717A] flex-shrink-0" />
              )}
              <span className="text-sm font-medium text-[#18181B] flex-1 truncate">{s.label}</span>
              <span className="text-sm text-[#71717A] tabular-nums">
                {s.start_time.slice(0, 5)} – {s.end_time.slice(0, 5)}
              </span>
              <button
                onClick={async () => {
                  await deletePeriodSlot(s.id)
                  load()
                }}
                className="text-[#D4D4D8] hover:text-rose-500 transition-colors flex-shrink-0"
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
          {slots.length === 0 && (
            <p className="text-xs text-[#A1A1AA] py-2">No period slots yet.</p>
          )}
        </div>
      )}

      {/* Add slot */}
      <div className="flex items-end gap-2 flex-wrap mt-3">
        <Field label="Start">
          <input type="time" className={`${INPUT} w-32`} value={start} onChange={(e) => setStart(e.target.value)} />
        </Field>
        <Field label="End">
          <input type="time" className={`${INPUT} w-32`} value={end} onChange={(e) => setEnd(e.target.value)} />
        </Field>
        <Field label="Label (optional)">
          <input className={`${INPUT} sm:w-44`} placeholder="Period 1 / Lunch" value={label} onChange={(e) => setLabel(e.target.value)} />
        </Field>
        <label className="flex items-center gap-1.5 text-sm text-[#52525B] pb-2">
          <input type="checkbox" checked={isBreak} onChange={(e) => setIsBreak(e.target.checked)} className="accent-[#27272A]" />
          Break
        </label>
        <button onClick={handleAdd} disabled={adding || !start || !end} className={`${BTN_PRIMARY} ml-auto`}>
          {adding ? <Loader2 className="animate-spin" size={15} /> : <Plus size={15} />}
          Add slot
        </button>
      </div>
    </Section>
  )
}
