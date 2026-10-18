'use client'

import React, { useState } from 'react'
import { Bus } from 'lucide-react'
import BusModal from './BusModal'
import { createVehicle, updateVehicle } from '@/lib/transport/vehicles'
import type { TransportVehicle, VehicleInput } from '@/lib/transport/types'
import { VEHICLE_COMPLIANCE_FIELDS, VEHICLE_STATUS_LABELS } from '@/lib/transport/types'
import { FormError, Group, Row, RowInput, RowSelect, RowTextArea } from './formUI'

export default function VehicleFormModal({
  vehicle, onClose, onSaved,
}: {
  vehicle: TransportVehicle | null
  onClose: () => void
  onSaved: () => void
}) {
  const [form, setForm] = useState<VehicleInput>({
    registration_no: vehicle?.registration_no ?? '',
    display_name: vehicle?.display_name ?? '',
    make_model: vehicle?.make_model ?? '',
    capacity: vehicle?.capacity ?? 0,
    status: vehicle?.status ?? 'active',
    insurance_expiry: vehicle?.insurance_expiry ?? '',
    fitness_expiry: vehicle?.fitness_expiry ?? '',
    permit_expiry: vehicle?.permit_expiry ?? '',
    puc_expiry: vehicle?.puc_expiry ?? '',
    notes: vehicle?.notes ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const set = <K extends keyof VehicleInput>(k: K, v: VehicleInput[K]) =>
    setForm(f => ({ ...f, [k]: v }))

  const submit = async () => {
    if (!form.registration_no.trim()) { setError('Enter the registration number'); return }
    setSaving(true); setError(null)
    // Blank date inputs must go to the database as NULL, not "".
    const payload: VehicleInput = {
      ...form,
      registration_no: form.registration_no.trim().toUpperCase(),
      display_name: form.display_name?.trim() || null,
      make_model: form.make_model?.trim() || null,
      notes: form.notes?.trim() || null,
      insurance_expiry: form.insurance_expiry || null,
      fitness_expiry: form.fitness_expiry || null,
      permit_expiry: form.permit_expiry || null,
      puc_expiry: form.puc_expiry || null,
    }
    const res = vehicle
      ? await updateVehicle(vehicle.id, payload)
      : await createVehicle(payload)
    setSaving(false)
    if (!res.success) { setError(res.error ?? 'Could not save the vehicle'); return }
    onSaved()
  }

  return (
    <BusModal
      onClose={onClose}
      size="lg"
      title={vehicle ? 'Edit bus' : 'New bus'}
      subtitle="Routes and schedules attach to it"
      icon={<Bus size={18} />}
      confirm={{ label: vehicle ? 'Save' : 'Add', onClick: submit, busy: saving }}
    >
      <div className="space-y-4">
        <FormError message={error} />

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
          <Group title="Bus" note="Registration spacing and case don’t matter. Parents see the display name.">
            <Row label="Registration" required>
              <RowInput value={form.registration_no} onChange={e => set('registration_no', e.target.value)} placeholder="KL 07 AB 1234" autoFocus className="uppercase placeholder:normal-case" />
            </Row>
            <Row label="Display name">
              <RowInput value={form.display_name ?? ''} onChange={e => set('display_name', e.target.value)} placeholder="Bus 12" />
            </Row>
            <Row label="Make & model">
              <RowInput value={form.make_model ?? ''} onChange={e => set('make_model', e.target.value)} placeholder="Tata Starbus" />
            </Row>
            <Row label="Seats">
              <RowInput type="number" inputMode="numeric" min={0} value={form.capacity ? String(form.capacity) : ''} placeholder="0"
                onChange={e => set('capacity', Number(e.target.value) || 0)} />
            </Row>
            <Row label="Status">
              <RowSelect value={form.status} onChange={e => set('status', e.target.value as VehicleInput['status'])}>
                {(Object.keys(VEHICLE_STATUS_LABELS) as (keyof typeof VEHICLE_STATUS_LABELS)[]).map(k => (
                  <option key={k} value={k}>{VEHICLE_STATUS_LABELS[k]}</option>
                ))}
              </RowSelect>
            </Row>
          </Group>

          <div className="space-y-4">
            <Group title="Papers" note="Warnings appear on the bus list 30 days before any of these expire.">
              {VEHICLE_COMPLIANCE_FIELDS.map(({ key, label }) => (
                <Row key={key} label={label}>
                  <RowInput type="date" value={(form[key] as string | null) ?? ''} onChange={e => set(key, e.target.value)} />
                </Row>
              ))}
            </Group>

            <Group title="Notes">
              <Row label="Notes" stacked>
                <RowTextArea rows={2} value={form.notes ?? ''} onChange={e => set('notes', e.target.value)} placeholder="Optional" />
              </Row>
            </Group>
          </div>
        </div>
      </div>
    </BusModal>
  )
}
