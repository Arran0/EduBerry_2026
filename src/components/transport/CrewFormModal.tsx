'use client'

import React, { useState } from 'react'
import { IdCard } from 'lucide-react'
import BusModal from './BusModal'
import { upsertTransportStaff, updateTransportStaff } from '@/lib/transport/staff'
import type { StaffInput, TransportStaff } from '@/lib/transport/types'
import { FormError, Group, Row, RowInput, RowSelect, RowTextArea, SwitchRow } from './formUI'

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
    // Crew are drivers. Attendants are not part of the bus app.
    kind: 'driver',
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
    <BusModal
      onClose={onClose}
      size="lg"
      title={staff ? 'Edit driver' : 'New driver'}
      subtitle="Someone who drives the routes"
      icon={<IdCard size={18} />}
      confirm={{ label: staff ? 'Save' : 'Add', onClick: submit, busy: saving }}
    >
      <div className="space-y-4">
        <FormError message={error} />

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
          <div className="space-y-4">
            <Group title="Driver" note={staff ? 'Parents see the name and phone on the crew card.' : 'Any account with the driver role. Create one in User Management first.'}>
              <Row label="Account" required>
                <RowSelect value={form.profile_id} onChange={e => set('profile_id', e.target.value)} disabled={!!staff}>
                  {candidates.length === 0 && <option value="">No driver accounts yet</option>}
                  {candidates.map(c => <option key={c.id} value={c.id}>{c.full_name}</option>)}
                </RowSelect>
              </Row>
              <Row label="Phone">
                <RowInput type="tel" inputMode="tel" value={form.phone ?? ''} onChange={e => set('phone', e.target.value)} placeholder="+91 98765 43210" />
              </Row>
              <Row label="Employee code">
                <RowInput value={form.employee_code ?? ''} onChange={e => set('employee_code', e.target.value)} placeholder="Optional" />
              </Row>
              <Row label="Badge">
                <RowInput value={form.badge_no ?? ''} onChange={e => set('badge_no', e.target.value)} placeholder="Optional" />
              </Row>
            </Group>

            <Group title="Licence" note="The driver list flags a licence 30 days before it expires.">
              <Row label="Number">
                <RowInput value={form.licence_no ?? ''} onChange={e => set('licence_no', e.target.value)} placeholder="KL07 20190012345" />
              </Row>
              <Row label="Expires">
                <RowInput type="date" value={form.licence_expiry ?? ''} onChange={e => set('licence_expiry', e.target.value)} />
              </Row>
            </Group>
          </div>

          <div className="space-y-4">
            <Group title="Status">
              <SwitchRow label="Currently working" hint="Off keeps the record but hides the driver from pickers." checked={form.active ?? true} onChange={v => set('active', v)} />
              <SwitchRow label="Background check on file" checked={verified} onChange={setVerified} />
            </Group>

            <Group title="In an emergency">
              <Row label="Blood group">
                <RowInput value={form.blood_group ?? ''} onChange={e => set('blood_group', e.target.value)} placeholder="O+" />
              </Row>
              <Row label="Contact">
                <RowInput value={form.emergency_contact ?? ''} onChange={e => set('emergency_contact', e.target.value)} placeholder="Name and phone" />
              </Row>
              <Row label="Address" stacked>
                <RowTextArea rows={2} value={form.address ?? ''} onChange={e => set('address', e.target.value)} placeholder="Optional" />
              </Row>
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
