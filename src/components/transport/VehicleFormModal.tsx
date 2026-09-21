'use client'

import React, { useState } from 'react'
import { Bus } from 'lucide-react'
import ModalShell from '@/components/ui/ModalShell'
import { createVehicle, updateVehicle } from '@/lib/transport/vehicles'
import type { TransportVehicle, VehicleInput } from '@/lib/transport/types'
import { VEHICLE_COMPLIANCE_FIELDS, VEHICLE_STATUS_LABELS } from '@/lib/transport/types'
import { Field, FormError, FormGrid, FormSection, ModalFooter, Select, TextArea, TextInput } from './formUI'

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
    <ModalShell
      onClose={onClose}
      size="lg"
      title={vehicle ? 'Edit vehicle' : 'New vehicle'}
      subtitle="Buses that routes and schedules attach to"
      icon={<Bus size={18} />}
      iconClassName="bg-amber-100 text-amber-700"
      footer={<ModalFooter onCancel={onClose} onSubmit={submit} saving={saving} />}
    >
      <div className="space-y-3">
        <FormError message={error} />

        <FormSection title="The bus">
        <FormGrid>
          <Field label="Registration number *" hint="Spacing and case don't matter — they're normalised.">
            <TextInput
              value={form.registration_no}
              onChange={e => set('registration_no', e.target.value)}
              placeholder="KL 07 AB 1234"
              autoFocus
            />
          </Field>
          <Field label="Display name" hint="What parents see, e.g. “Bus 12”.">
            <TextInput
              value={form.display_name ?? ''}
              onChange={e => set('display_name', e.target.value)}
              placeholder="Bus 12"
            />
          </Field>
          <Field label="Make & model">
            <TextInput
              value={form.make_model ?? ''}
              onChange={e => set('make_model', e.target.value)}
              placeholder="Tata Starbus"
            />
          </Field>
          <Field label="Seats">
            <TextInput
              type="number"
              min={0}
              value={String(form.capacity ?? 0)}
              onChange={e => set('capacity', Number(e.target.value) || 0)}
            />
          </Field>
          <Field label="Status">
            <Select value={form.status} onChange={e => set('status', e.target.value as VehicleInput['status'])}>
              {(Object.keys(VEHICLE_STATUS_LABELS) as (keyof typeof VEHICLE_STATUS_LABELS)[]).map(k => (
                <option key={k} value={k}>{VEHICLE_STATUS_LABELS[k]}</option>
              ))}
            </Select>
          </Field>
        </FormGrid>
        </FormSection>

        <FormSection
          title="Compliance"
          hint="A lapsed certificate means the bus cannot legally carry children, so these are surfaced as warnings on the fleet list as they approach expiry."
        >
          <div className="grid grid-cols-2 gap-x-3 gap-y-2.5 sm:grid-cols-4">
            {VEHICLE_COMPLIANCE_FIELDS.map(({ key, label }) => (
              <Field key={key} label={label}>
                <TextInput
                  type="date"
                  value={(form[key] as string | null) ?? ''}
                  onChange={e => set(key, e.target.value)}
                />
              </Field>
            ))}
          </div>
        </FormSection>

        <FormSection title="Notes">
          <TextArea rows={2} value={form.notes ?? ''} onChange={e => set('notes', e.target.value)} />
        </FormSection>
      </div>
    </ModalShell>
  )
}
