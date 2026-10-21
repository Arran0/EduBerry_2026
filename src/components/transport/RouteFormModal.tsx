'use client'

import React, { useState } from 'react'
import { Route as RouteIcon } from 'lucide-react'
import BusModal from './BusModal'
import { createRoute, updateRoute } from '@/lib/transport/routes'
import { vehicleLabel } from '@/lib/transport/vehicles'
import type { RouteInput, TransportDirection, TransportRoute, TransportStaff, TransportVehicle } from '@/lib/transport/types'
import { FormError, Group, Row, RowInput, RowSelect, RowTextArea, Segmented } from './formUI'

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
      size="lg"
      title={route ? 'Edit route' : 'New route'}
      subtitle="One direction — stops, riders and fees attach to it"
      icon={<RouteIcon size={18} />}
      confirm={{ label: route ? 'Save' : 'Create', onClick: submit, busy: saving }}
    >
      <div className="space-y-4">
        <FormError message={error} />

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
          <div className="space-y-4">
            <Group
              title="Route"
              note={route && route.direction !== form.direction
                ? 'Changing direction moves every rider and the schedule to the new direction; riders keep their stop.'
                : 'A route runs one way. A child who rides both ways goes on two routes.'}
            >
              <Row label="Name" required>
                <RowInput value={form.name} onChange={e => set('name', e.target.value)} placeholder="North — Vadakkanchery" autoFocus />
              </Row>
              <Row label="Code">
                <RowInput value={form.code ?? ''} onChange={e => set('code', e.target.value)} placeholder="R-07 · shown on the map" />
              </Row>
              <Row label="Direction" as="div">
                <Segmented<TransportDirection>
                  value={form.direction ?? 'inbound'}
                  onChange={v => set('direction', v)}
                  options={[{ value: 'inbound', label: 'To school' }, { value: 'outbound', label: 'From school' }]}
                />
              </Row>
            </Group>

            <Group title="Description">
              <Row label="Areas covered" stacked>
                <RowTextArea rows={2} value={form.description ?? ''} onChange={e => set('description', e.target.value)} placeholder="Optional" />
              </Row>
            </Group>
          </div>

          <div className="space-y-4">
            <Group
              title="Defaults for every trip"
              note={drivers.length === 0 ? 'No drivers yet — add them under Buses and drivers and they appear here.' : 'A schedule can still use a different bus or driver.'}
            >
              <Row label="Bus">
                <RowSelect value={form.default_vehicle_id ?? ''} onChange={e => set('default_vehicle_id', e.target.value)}>
                  <option value="">Not set</option>
                  {vehicles.map(v => <option key={v.id} value={v.id}>{vehicleLabel(v)}{v.capacity ? ` · ${v.capacity} seats` : ''}</option>)}
                </RowSelect>
              </Row>
              <Row label="Driver">
                <RowSelect value={form.default_driver_id ?? ''} onChange={e => set('default_driver_id', e.target.value)}>
                  <option value="">Not set</option>
                  {drivers.map(d => <option key={d.id} value={d.profile_id}>{d.profile?.full_name ?? 'Unknown'}</option>)}
                </RowSelect>
              </Row>
            </Group>

            <Group title="Map colour">
              <Row label="Colour" as="div">
                <span className="flex items-center justify-between gap-1 py-1">
                  {COLORS.map(c => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => set('color', c)}
                      aria-label={`Colour ${c}`}
                      aria-pressed={form.color === c}
                      className={`w-6 h-6 rounded-full transition-transform ${
                        form.color === c ? 'ring-2 ring-offset-2 ring-[#1B3F8A] scale-110' : 'hover:scale-110'
                      }`}
                      style={{ background: c }}
                    />
                  ))}
                </span>
              </Row>
            </Group>
          </div>
        </div>
      </div>
    </BusModal>
  )
}
