'use client'

import React, { useState } from 'react'
import { Route as RouteIcon } from 'lucide-react'
import BusModal from './BusModal'
import { createRoute, updateRoute } from '@/lib/transport/routes'
import { vehicleLabel } from '@/lib/transport/vehicles'
import type { RouteInput, TransportDirection, TransportRoute, TransportStaff, TransportVehicle } from '@/lib/transport/types'
import { Field, FormError, FormGrid, ModalFooter, Select, TextArea, TextInput } from './formUI'

const COLORS = ['#F97316', '#0EA5E9', '#8B5CF6', '#10B981', '#EF4444', '#EAB308', '#EC4899', '#64748B']

export default function RouteFormModal({
  route, vehicles, crew, onClose, onSaved, yearId,
}: {
  route: TransportRoute | null
  /** The session a new route is created in — the one chosen on the banner. */
  yearId?: string | null
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
    direction: route?.direction ?? 'inbound',
    default_vehicle_id: route?.default_vehicle_id ?? '',
    default_driver_id: route?.default_driver_id ?? '',
    active: route?.active ?? true,
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const drivers = crew.filter(c => c.kind === 'driver' && c.active)

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
      // Routes have no attendants; the column stays for history only.
      default_attendant_id: null,
    }
    if (route) {
      const res = await updateRoute(route.id, payload)
      setSaving(false)
      if (!res.success) { setError(res.error ?? 'Could not save the route'); return }
      onSaved(route.id)
      return
    }
    const res = await createRoute(yearId ? { ...payload, academic_year_id: yearId } : payload)
    setSaving(false)
    if (!res.success) { setError(res.error ?? 'Could not save the route'); return }
    onSaved(res.id)
  }

  return (
    <BusModal
      onClose={onClose}
      size="md"
      title={route ? 'Edit route' : 'New route'}
      subtitle="One direction, one schedule — stops, riders and fees attach to it"
      icon={<RouteIcon size={18} />}
      iconClassName="bg-orange-100 text-orange-700"
      footer={<ModalFooter onCancel={onClose} onSubmit={submit} saving={saving} />}
    >
      <div className="space-y-3">
        <FormError message={error} />

        <FormGrid>
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
        </FormGrid>

        <Field
          label="Direction *"
          hint={route && route.direction !== form.direction
            ? 'Changing direction moves every rider and the schedule over to the new direction; riders keep their stop.'
            : 'A route runs one way. A child who rides both ways is put on two routes.'}
        >
          <div className="grid grid-cols-2 gap-2">
            {([
              ['inbound', 'To school', 'Riders are picked up at their stop'],
              ['outbound', 'From school', 'Riders are dropped at their stop'],
            ] as [TransportDirection, string, string][]).map(([key, title, sub]) => (
              <button
                key={key}
                type="button"
                onClick={() => set('direction', key)}
                aria-pressed={form.direction === key}
                className={`rounded-2xl border px-3 py-2.5 text-left transition ${
                  form.direction === key
                    ? 'border-transparent bg-gradient-to-b from-[#3D3B40] to-[#27272A] text-white shadow-[inset_0_1px_0_rgba(255,255,255,.16),0_8px_18px_-10px_rgba(15,23,42,.6)]'
                    : 'border-slate-200/80 bg-white/90 text-slate-600 hover:bg-white'
                }`}
              >
                <span className="block text-sm font-semibold">{title}</span>
                <span className={`block text-[11px] ${form.direction === key ? 'text-white/70' : 'text-slate-400'}`}>{sub}</span>
              </button>
            ))}
          </div>
        </Field>

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
                  form.color === c ? 'ring-2 ring-offset-2 ring-[#3D3B40] scale-110' : 'hover:scale-105'
                }`}
                style={{ background: c }}
              />
            ))}
          </div>
        </Field>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
        </div>

        {drivers.length === 0 && (
          <p className="text-[11px] text-[#A1A1AA]">
            No driver records yet — add them under Fleet &amp; Crew and they will appear here.
          </p>
        )}

      </div>
    </BusModal>
  )
}
