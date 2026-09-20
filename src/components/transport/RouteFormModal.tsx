'use client'

import React, { useState } from 'react'
import { Route as RouteIcon } from 'lucide-react'
import ModalShell from '@/components/ui/ModalShell'
import { createRoute, updateRoute } from '@/lib/transport/routes'
import { vehicleLabel } from '@/lib/transport/vehicles'
import type { RouteInput, TransportRoute, TransportStaff, TransportVehicle } from '@/lib/transport/types'
import { Field, FormError, ModalFooter, Select, TextArea, TextInput } from './formUI'

const COLORS = ['#F97316', '#0EA5E9', '#8B5CF6', '#10B981', '#EF4444', '#EAB308', '#EC4899', '#64748B']

export default function RouteFormModal({
  route, vehicles, crew, onClose, onSaved,
}: {
  route: TransportRoute | null
  vehicles: TransportVehicle[]
  crew: TransportStaff[]
  onClose: () => void
  onSaved: (id?: string) => void
}) {
  const [form, setForm] = useState<RouteInput>({
    name: route?.name ?? '',
    code: route?.code ?? '',
    description: route?.description ?? '',
    color: route?.color ?? COLORS[0],
    default_vehicle_id: route?.default_vehicle_id ?? '',
    default_driver_id: route?.default_driver_id ?? '',
    default_attendant_id: route?.default_attendant_id ?? '',
    active: route?.active ?? true,
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const drivers = crew.filter(c => c.kind === 'driver' && c.active)
  const attendants = crew.filter(c => c.kind === 'attendant' && c.active)

  const set = <K extends keyof RouteInput>(k: K, v: RouteInput[K]) => setForm(f => ({ ...f, [k]: v }))

  const submit = async () => {
    if (!form.name.trim()) { setError('Give the route a name'); return }
    setSaving(true); setError(null)
    const payload: RouteInput = {
      ...form,
      name: form.name.trim(),
      code: form.code?.trim() || null,
      description: form.description?.trim() || null,
      // An empty <select> value is "", which is not a valid UUID.
      default_vehicle_id: form.default_vehicle_id || null,
      default_driver_id: form.default_driver_id || null,
      default_attendant_id: form.default_attendant_id || null,
    }
    if (route) {
      const res = await updateRoute(route.id, payload)
      setSaving(false)
      if (!res.success) { setError(res.error ?? 'Could not save the route'); return }
      onSaved(route.id)
      return
    }
    const res = await createRoute(payload)
    setSaving(false)
    if (!res.success) { setError(res.error ?? 'Could not save the route'); return }
    onSaved(res.id)
  }

  return (
    <ModalShell
      onClose={onClose}
      size="lg"
      title={route ? 'Edit route' : 'New route'}
      subtitle="Stops, schedules and students attach to a route"
      icon={<RouteIcon size={18} />}
      iconClassName="bg-orange-100 text-orange-700"
      footer={<ModalFooter onCancel={onClose} onSubmit={submit} saving={saving} />}
    >
      <div className="space-y-4">
        <FormError message={error} />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Route name *">
            <TextInput
              value={form.name}
              onChange={e => set('name', e.target.value)}
              placeholder="North — Vadakkanchery"
              autoFocus
            />
          </Field>
          <Field label="Code" hint="Short label used on the fleet map, e.g. R-07.">
            <TextInput value={form.code ?? ''} onChange={e => set('code', e.target.value)} placeholder="R-07" />
          </Field>
        </div>

        <Field label="Description">
          <TextArea
            rows={2}
            value={form.description ?? ''}
            onChange={e => set('description', e.target.value)}
            placeholder="Areas this route covers"
          />
        </Field>

        <Field label="Colour" hint="Distinguishes this route on the fleet map.">
          <div className="flex flex-wrap gap-2">
            {COLORS.map(c => (
              <button
                key={c}
                type="button"
                onClick={() => set('color', c)}
                aria-label={`Colour ${c}`}
                className={`w-7 h-7 rounded-full transition-transform ${
                  form.color === c ? 'ring-2 ring-offset-2 ring-[#27272A] scale-110' : 'hover:scale-105'
                }`}
                style={{ background: c }}
              />
            ))}
          </div>
        </Field>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Default bus">
            <Select
              value={form.default_vehicle_id ?? ''}
              onChange={e => set('default_vehicle_id', e.target.value)}
            >
              <option value="">Not set</option>
              {vehicles.map(v => <option key={v.id} value={v.id}>{vehicleLabel(v)}</option>)}
            </Select>
          </Field>
          <Field label="Default driver">
            <Select
              value={form.default_driver_id ?? ''}
              onChange={e => set('default_driver_id', e.target.value)}
            >
              <option value="">Not set</option>
              {drivers.map(d => (
                <option key={d.id} value={d.profile_id}>{d.profile?.full_name ?? 'Unknown'}</option>
              ))}
            </Select>
          </Field>
          <Field label="Default attendant">
            <Select
              value={form.default_attendant_id ?? ''}
              onChange={e => set('default_attendant_id', e.target.value)}
            >
              <option value="">Not set</option>
              {attendants.map(a => (
                <option key={a.id} value={a.profile_id}>{a.profile?.full_name ?? 'Unknown'}</option>
              ))}
            </Select>
          </Field>
        </div>

        {drivers.length === 0 && (
          <p className="text-[11px] text-[#A1A1AA]">
            No driver records yet — add them under Fleet &amp; Crew and they will appear here.
          </p>
        )}

        <label className="flex items-center gap-2 text-sm text-[#52525B]">
          <input type="checkbox" checked={form.active ?? true} onChange={e => set('active', e.target.checked)} />
          Route is running
        </label>
      </div>
    </ModalShell>
  )
}
