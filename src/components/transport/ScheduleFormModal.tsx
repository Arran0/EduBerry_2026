'use client'

import React, { useState } from 'react'
import { Clock } from 'lucide-react'
import ModalShell from '@/components/ui/ModalShell'
import { createSchedule, updateSchedule } from '@/lib/transport/schedules'
import { vehicleLabel } from '@/lib/transport/vehicles'
import type {
  ScheduleInput, TransportRoute, TransportSchedule, TransportStaff, TransportVehicle,
} from '@/lib/transport/types'
import { DIRECTION_LABELS, WEEKDAYS } from '@/lib/transport/types'
import { Field, FormError, ModalFooter, Select, TextInput } from './formUI'

export default function ScheduleFormModal({
  schedule, route, vehicles, crew, onClose, onSaved,
}: {
  schedule: TransportSchedule | null
  route: TransportRoute
  vehicles: TransportVehicle[]
  crew: TransportStaff[]
  onClose: () => void
  onSaved: () => void
}) {
  const [form, setForm] = useState<ScheduleInput>({
    route_id: route.id,
    direction: schedule?.direction ?? 'inbound',
    label: schedule?.label ?? '',
    days_of_week: schedule?.days_of_week ?? [1, 2, 3, 4, 5],
    start_time: schedule?.start_time?.slice(0, 5) ?? '07:15',
    end_time: schedule?.end_time?.slice(0, 5) ?? '',
    vehicle_id: schedule?.vehicle_id ?? '',
    driver_id: schedule?.driver_id ?? '',
    attendant_id: schedule?.attendant_id ?? '',
    auto_start: schedule?.auto_start ?? true,
    active: schedule?.active ?? true,
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const drivers = crew.filter(c => c.kind === 'driver' && c.active)
  const attendants = crew.filter(c => c.kind === 'attendant' && c.active)

  const set = <K extends keyof ScheduleInput>(k: K, v: ScheduleInput[K]) => setForm(f => ({ ...f, [k]: v }))

  const toggleDay = (day: number) => {
    const days = new Set(form.days_of_week ?? [])
    if (days.has(day)) days.delete(day)
    else days.add(day)
    set('days_of_week', [...days].sort((a, b) => a - b))
  }

  const submit = async () => {
    if (!form.start_time) { setError('Set a departure time'); return }
    if (!form.days_of_week?.length) { setError('Pick at least one day'); return }
    setSaving(true); setError(null)
    const payload: ScheduleInput = {
      ...form,
      label: form.label?.trim() || null,
      end_time: form.end_time || null,
      vehicle_id: form.vehicle_id || null,
      driver_id: form.driver_id || null,
      attendant_id: form.attendant_id || null,
    }
    const res = schedule
      ? await updateSchedule(schedule.id, payload)
      : await createSchedule(payload)
    setSaving(false)
    if (!res.success) { setError(res.error ?? 'Could not save the schedule'); return }
    onSaved()
  }

  return (
    <ModalShell
      onClose={onClose}
      size="lg"
      title={schedule ? 'Edit schedule' : 'New schedule'}
      subtitle={route.name}
      icon={<Clock size={18} />}
      iconClassName="bg-sky-100 text-sky-700"
      footer={<ModalFooter onCancel={onClose} onSubmit={submit} saving={saving} />}
    >
      <div className="space-y-4">
        <FormError message={error} />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Direction *">
            <Select
              value={form.direction}
              onChange={e => set('direction', e.target.value as ScheduleInput['direction'])}
            >
              {(Object.keys(DIRECTION_LABELS) as (keyof typeof DIRECTION_LABELS)[]).map(k => (
                <option key={k} value={k}>{DIRECTION_LABELS[k]}</option>
              ))}
            </Select>
          </Field>
          <Field label="Label" hint="Optional, e.g. “Morning pickup”.">
            <TextInput value={form.label ?? ''} onChange={e => set('label', e.target.value)} />
          </Field>
          <Field
            label="Departs *"
            hint="Stop times are offsets from this, so changing it shifts the whole run."
          >
            <TextInput type="time" value={form.start_time} onChange={e => set('start_time', e.target.value)} />
          </Field>
          <Field label="Scheduled arrival">
            <TextInput type="time" value={form.end_time ?? ''} onChange={e => set('end_time', e.target.value)} />
          </Field>
        </div>

        <Field label="Runs on *">
          <div className="flex flex-wrap gap-1.5">
            {WEEKDAYS.map(d => {
              const on = form.days_of_week?.includes(d.value)
              return (
                <button
                  key={d.value}
                  type="button"
                  onClick={() => toggleDay(d.value)}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                    on
                      ? 'bg-[#27272A] text-white border-[#27272A]'
                      : 'bg-white text-[#A1A1AA] border-[#E4E4E7] hover:border-[#D4D4D8]'
                  }`}
                >
                  {d.short}
                </button>
              )
            })}
          </div>
        </Field>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Bus" hint="Falls back to the route default.">
            <Select value={form.vehicle_id ?? ''} onChange={e => set('vehicle_id', e.target.value)}>
              <option value="">Route default</option>
              {vehicles.map(v => <option key={v.id} value={v.id}>{vehicleLabel(v)}</option>)}
            </Select>
          </Field>
          <Field label="Driver">
            <Select value={form.driver_id ?? ''} onChange={e => set('driver_id', e.target.value)}>
              <option value="">Route default</option>
              {drivers.map(d => (
                <option key={d.id} value={d.profile_id}>{d.profile?.full_name ?? 'Unknown'}</option>
              ))}
            </Select>
          </Field>
          <Field label="Attendant">
            <Select value={form.attendant_id ?? ''} onChange={e => set('attendant_id', e.target.value)}>
              <option value="">Route default</option>
              {attendants.map(a => (
                <option key={a.id} value={a.profile_id}>{a.profile?.full_name ?? 'Unknown'}</option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="space-y-2">
          <label className="flex items-start gap-2 text-sm text-[#52525B]">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={form.auto_start ?? true}
              onChange={e => set('auto_start', e.target.checked)}
            />
            <span>
              Start the trip automatically when the bus moves
              <span className="block text-[11px] text-[#A1A1AA]">
                Otherwise the driver taps Start. Automatic is kinder on a driver who is
                already running late — the one time they are most likely to forget.
              </span>
            </span>
          </label>
          <label className="flex items-center gap-2 text-sm text-[#52525B]">
            <input type="checkbox" checked={form.active ?? true} onChange={e => set('active', e.target.checked)} />
            Schedule is running
          </label>
        </div>
      </div>
    </ModalShell>
  )
}
