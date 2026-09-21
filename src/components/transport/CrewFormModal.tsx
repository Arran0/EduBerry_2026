'use client'

import React, { useState } from 'react'
import { IdCard } from 'lucide-react'
import ModalShell from '@/components/ui/ModalShell'
import { upsertTransportStaff, updateTransportStaff } from '@/lib/transport/staff'
import type { StaffInput, TransportStaff } from '@/lib/transport/types'
import { STAFF_KIND_LABELS } from '@/lib/transport/types'
import { Field, FormError, FormGrid, ModalFooter, Select, TextArea, TextInput } from './formUI'

interface Candidate { id: string; full_name: string; avatar_url?: string | null }

export default function CrewFormModal({
  staff, candidates, onClose, onSaved,
}: {
  staff: TransportStaff | null
  candidates: Candidate[]
  onClose: () => void
  onSaved: () => void
}) {
  const [form, setForm] = useState<StaffInput>({
    profile_id: staff?.profile_id ?? candidates[0]?.id ?? '',
    kind: staff?.kind ?? 'driver',
    employee_code: staff?.employee_code ?? '',
    phone: staff?.phone ?? '',
    licence_no: staff?.licence_no ?? '',
    licence_expiry: staff?.licence_expiry ?? '',
    badge_no: staff?.badge_no ?? '',
    blood_group: staff?.blood_group ?? '',
    emergency_contact: staff?.emergency_contact ?? '',
    address: staff?.address ?? '',
    active: staff?.active ?? true,
    notes: staff?.notes ?? '',
  })
  const [verified, setVerified] = useState(!!staff?.verified_at)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const set = <K extends keyof StaffInput>(k: K, v: StaffInput[K]) => setForm(f => ({ ...f, [k]: v }))

  const submit = async () => {
    if (!form.profile_id) { setError('Pick the person this record belongs to'); return }
    setSaving(true); setError(null)
    const payload: StaffInput = {
      ...form,
      employee_code: form.employee_code?.trim() || null,
      phone: form.phone?.trim() || null,
      licence_no: form.licence_no?.trim() || null,
      licence_expiry: form.licence_expiry || null,
      badge_no: form.badge_no?.trim() || null,
      blood_group: form.blood_group?.trim() || null,
      emergency_contact: form.emergency_contact?.trim() || null,
      address: form.address?.trim() || null,
      notes: form.notes?.trim() || null,
      // Keep the original timestamp when it was already set, so re-saving the
      // record doesn't rewrite the date the verification actually happened.
      verified_at: verified ? (staff?.verified_at ?? new Date().toISOString()) : null,
    }
    const res = staff
      ? await updateTransportStaff(staff.id, payload)
      : await upsertTransportStaff(payload)
    setSaving(false)
    if (!res.success) { setError(res.error ?? 'Could not save the record'); return }
    onSaved()
  }

  return (
    <ModalShell
      onClose={onClose}
      size="lg"
      title={staff ? 'Edit crew record' : 'New crew record'}
      subtitle="Drivers and attendants who work the routes"
      icon={<IdCard size={18} />}
      iconClassName="bg-sky-100 text-sky-700"
      footer={<ModalFooter onCancel={onClose} onSubmit={submit} saving={saving} />}
    >
      <div className="space-y-3">
        <FormError message={error} />

        <FormGrid>
          <Field
            label="Person *"
            hint="Attendants use a driver account too — the role below is what distinguishes them."
          >
            <Select
              value={form.profile_id}
              onChange={e => set('profile_id', e.target.value)}
              disabled={!!staff}
            >
              {candidates.length === 0 && <option value="">No driver accounts yet</option>}
              {candidates.map(c => <option key={c.id} value={c.id}>{c.full_name}</option>)}
            </Select>
          </Field>
          <Field label="Role *">
            <Select value={form.kind} onChange={e => set('kind', e.target.value as StaffInput['kind'])} disabled={!!staff}>
              {(Object.keys(STAFF_KIND_LABELS) as (keyof typeof STAFF_KIND_LABELS)[]).map(k => (
                <option key={k} value={k}>{STAFF_KIND_LABELS[k]}</option>
              ))}
            </Select>
          </Field>
          <Field label="Phone" hint="Shown to parents on the crew card.">
            <TextInput value={form.phone ?? ''} onChange={e => set('phone', e.target.value)} placeholder="+91 98765 43210" />
          </Field>
          <Field label="Employee code">
            <TextInput value={form.employee_code ?? ''} onChange={e => set('employee_code', e.target.value)} />
          </Field>
          <Field label="Licence number">
            <TextInput value={form.licence_no ?? ''} onChange={e => set('licence_no', e.target.value)} />
          </Field>
          <Field label="Licence expiry">
            <TextInput type="date" value={form.licence_expiry ?? ''} onChange={e => set('licence_expiry', e.target.value)} />
          </Field>
          <Field label="Badge number">
            <TextInput value={form.badge_no ?? ''} onChange={e => set('badge_no', e.target.value)} />
          </Field>
          <Field label="Blood group">
            <TextInput value={form.blood_group ?? ''} onChange={e => set('blood_group', e.target.value)} placeholder="O+" />
          </Field>
          <Field label="Emergency contact">
            <TextInput value={form.emergency_contact ?? ''} onChange={e => set('emergency_contact', e.target.value)} />
          </Field>
        </FormGrid>

        <Field label="Address">
          <TextArea rows={2} value={form.address ?? ''} onChange={e => set('address', e.target.value)} />
        </Field>

        <div className="flex flex-col gap-2">
          <label className="flex items-center gap-2 text-sm text-[#52525B]">
            <input type="checkbox" checked={verified} onChange={e => setVerified(e.target.checked)} />
            Background verification on file
          </label>
          <label className="flex items-center gap-2 text-sm text-[#52525B]">
            <input type="checkbox" checked={form.active ?? true} onChange={e => set('active', e.target.checked)} />
            Currently working
          </label>
        </div>

        <Field label="Notes">
          <TextArea rows={2} value={form.notes ?? ''} onChange={e => set('notes', e.target.value)} />
        </Field>
      </div>
    </ModalShell>
  )
}
