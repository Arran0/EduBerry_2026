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

const input =
  'border border-slate-300 rounded-lg bg-white px-3 py-2 text-sm focus:outline-none focus:border-slate-800 transition-colors'

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
    <div className="space-y-4">
      {/* Configs list */}
      <section className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
        <h3 className="font-semibold text-slate-800 mb-3">Timetable configurations</h3>

        <div className="space-y-2">
          {configs.map((c) => {
            const isSelected = selectedConfig?.id === c.id
            return (
              <div
                key={c.id}
                className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 cursor-pointer transition-colors ${
                  isSelected ? 'border-indigo-300 bg-indigo-50/50' : 'border-slate-200 hover:bg-slate-50'
                }`}
                onClick={() => onSelectConfig(c.id)}
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
                >
                  {c.is_active ? (
                    <CheckCircle2 className="text-emerald-600" size={20} />
                  ) : (
                    <Circle className="text-slate-300" size={20} />
                  )}
                </button>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-slate-800 text-sm">{c.name}</div>
                  <div className="text-xs text-slate-500">
                    {c.academic_year || 'No academic year'} · {c.working_days.length} working days
                  </div>
                </div>
                <button
                  onClick={async (e) => {
                    e.stopPropagation()
                    if (confirm(`Delete "${c.name}" and all its periods, requirements and timetables?`)) {
                      await deleteConfig(c.id)
                      onChanged()
                    }
                  }}
                  className="text-slate-400 hover:text-rose-600 transition-colors"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            )
          })}
          {configs.length === 0 && (
            <p className="text-sm text-slate-500 py-2">No configurations yet. Create one below.</p>
          )}
        </div>

        {/* Create */}
        <div className="flex flex-wrap items-end gap-2 mt-4 pt-4 border-t border-slate-100">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500">Name</label>
            <input
              className={input}
              placeholder="e.g. Main 2025–26"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500">Academic year</label>
            <input
              className={input}
              placeholder="2025-2026"
              value={newYear}
              onChange={(e) => setNewYear(e.target.value)}
            />
          </div>
          <button
            onClick={handleCreate}
            disabled={creating || !newName.trim()}
            className="inline-flex items-center gap-1.5 bg-indigo-600 text-white px-3 py-2 rounded-lg text-sm font-medium disabled:opacity-50 hover:bg-indigo-700 transition-colors"
          >
            {creating ? <Loader2 className="animate-spin" size={15} /> : <Plus size={15} />}
            Add config
          </button>
        </div>
      </section>

      {/* Working days + period slots for selected config */}
      {selectedConfig && (
        <>
          <WorkingDaysSection config={selectedConfig} onChanged={onChanged} />
          <PeriodSlotsSection config={selectedConfig} />
        </>
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
    // Persist in canonical weekday order.
    const ordered = WEEKDAYS.filter((d) => days.includes(d))
    await updateConfig(config.id, { working_days: ordered })
    setSaving(false)
    onChanged()
  }

  return (
    <section className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
      <h3 className="font-semibold text-slate-800 mb-3">Working days</h3>
      <div className="flex flex-wrap gap-2">
        {WEEKDAYS.map((d) => {
          const on = days.includes(d)
          return (
            <button
              key={d}
              onClick={() => toggle(d)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                on
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
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
          className="mt-3 inline-flex items-center gap-1.5 bg-slate-800 text-white px-3 py-1.5 rounded-lg text-sm font-medium disabled:opacity-50"
        >
          {saving ? <Loader2 className="animate-spin" size={14} /> : <CheckCircle2 size={14} />}
          Save working days
        </button>
      )}
    </section>
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
    <section className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
      <h3 className="font-semibold text-slate-800 mb-1">Period slots</h3>
      <p className="text-xs text-slate-500 mb-3">
        These are the rows of the grid. Mark lunch/recess as a break — the generator skips break slots.
      </p>

      {loading ? (
        <div className="flex justify-center py-6 text-slate-400">
          <Loader2 className="animate-spin" size={18} />
        </div>
      ) : (
        <div className="space-y-1.5">
          {slots.map((s) => (
            <div
              key={s.id}
              className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${
                s.is_break ? 'border-amber-200 bg-amber-50/60' : 'border-slate-200'
              }`}
            >
              <span className="text-xs font-mono text-slate-400 w-6">{s.position}</span>
              {s.is_break ? (
                <Coffee size={15} className="text-amber-500" />
              ) : (
                <Clock size={15} className="text-slate-400" />
              )}
              <span className="text-sm font-medium text-slate-700 flex-1">{s.label}</span>
              <span className="text-sm text-slate-500 tabular-nums">
                {s.start_time.slice(0, 5)} – {s.end_time.slice(0, 5)}
              </span>
              <button
                onClick={async () => {
                  await deletePeriodSlot(s.id)
                  load()
                }}
                className="text-slate-400 hover:text-rose-600 transition-colors"
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
          {slots.length === 0 && (
            <p className="text-sm text-slate-500 py-2">No period slots yet.</p>
          )}
        </div>
      )}

      {/* Add slot */}
      <div className="flex flex-wrap items-end gap-2 mt-4 pt-4 border-t border-slate-100">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-slate-500">Start</label>
          <input type="time" className={input} value={start} onChange={(e) => setStart(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-slate-500">End</label>
          <input type="time" className={input} value={end} onChange={(e) => setEnd(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-slate-500">Label (optional)</label>
          <input
            className={input}
            placeholder="Period 1 / Lunch"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </div>
        <label className="flex items-center gap-1.5 text-sm text-slate-600 px-1 py-2">
          <input type="checkbox" checked={isBreak} onChange={(e) => setIsBreak(e.target.checked)} />
          Break
        </label>
        <button
          onClick={handleAdd}
          disabled={adding || !start || !end}
          className="inline-flex items-center gap-1.5 bg-indigo-600 text-white px-3 py-2 rounded-lg text-sm font-medium disabled:opacity-50 hover:bg-indigo-700 transition-colors"
        >
          {adding ? <Loader2 className="animate-spin" size={15} /> : <Plus size={15} />}
          Add slot
        </button>
      </div>
    </section>
  )
}
