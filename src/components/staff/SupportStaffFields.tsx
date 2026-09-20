'use client'

import React from 'react'
import type { SupportStaff, SupportStaffPatch } from '@/lib/supportStaff'

// ============================================
// The detail fields of a support staff member, shared by the "Add Staff"
// modal (when the Support Staff role is picked) and the edit modal, so the
// two can never drift apart.
//
// `full_name` is deliberately NOT here: both callers already own a name field
// of their own, above these sections.
// ============================================

type FieldDef = {
  key: SupportFieldKey
  label: string
  type?: 'text' | 'date' | 'select' | 'textarea' | 'number'
  placeholder?: string
  options?: string[]
  span?: boolean
}

export const SUPPORT_SECTIONS: { title: string; fields: FieldDef[] }[] = [
  {
    title: 'Employment',
    fields: [
      { key: 'employee_id', label: 'Employee ID', placeholder: 'SUP-001' },
      { key: 'designation', label: 'Designation', placeholder: 'Housekeeping / Gardener / Security…' },
      { key: 'department', label: 'Department / Area', placeholder: 'Block A / Grounds…' },
      {
        key: 'employment_type', label: 'Employment Type', type: 'select',
        options: ['', 'Permanent', 'Contractual', 'Daily Wage', 'Part Time', 'Outsourced'],
      },
      { key: 'date_of_joining', label: 'Date of Joining', type: 'date' },
      { key: 'monthly_wage', label: 'Monthly Wage (₹)', type: 'number', placeholder: '12000' },
    ],
  },
  {
    title: 'Contact',
    fields: [
      { key: 'phone', label: 'Phone', placeholder: 'Leave blank if none' },
      { key: 'alternate_phone', label: 'Alternate Phone', placeholder: 'Family / neighbour' },
      { key: 'emergency_contact_name', label: 'Emergency Contact Name', placeholder: 'Full name' },
      { key: 'emergency_contact', label: 'Emergency Contact Number', placeholder: '9876543210' },
      { key: 'address', label: 'Address', type: 'textarea', span: true, placeholder: 'Full address including city, state, PIN' },
    ],
  },
  {
    title: 'Personal',
    fields: [
      { key: 'date_of_birth', label: 'Date of Birth', type: 'date' },
      {
        key: 'gender', label: 'Gender', type: 'select',
        options: ['', 'Male', 'Female', 'Other', 'Prefer not to say'],
      },
      {
        key: 'blood_group', label: 'Blood Group', type: 'select',
        options: ['', 'A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-'],
      },
    ],
  },
  {
    title: 'Identity / Payout',
    fields: [
      { key: 'aadhaar_no', label: 'Aadhaar No.', placeholder: 'XXXX XXXX XXXX' },
      { key: 'pan_no', label: 'PAN No.', placeholder: 'ABCDE1234F' },
      { key: 'bank_account_no', label: 'Bank Account No.', placeholder: 'Account number' },
      { key: 'bank_name', label: 'Bank Name & Branch', placeholder: 'SBI – Gandhi Nagar Branch' },
      { key: 'ifsc_code', label: 'IFSC Code', placeholder: 'SBIN0001234' },
    ],
  },
  {
    title: 'Notes',
    fields: [
      { key: 'notes', label: 'Notes', type: 'textarea', span: true, placeholder: 'Shift timing, area of work, anything worth remembering' },
    ],
  },
]

export type SupportFieldKey =
  | 'employee_id' | 'designation' | 'department' | 'employment_type'
  | 'date_of_joining' | 'monthly_wage'
  | 'phone' | 'alternate_phone' | 'emergency_contact_name' | 'emergency_contact' | 'address'
  | 'date_of_birth' | 'gender' | 'blood_group'
  | 'aadhaar_no' | 'pan_no' | 'bank_account_no' | 'bank_name' | 'ifsc_code'
  | 'notes'

/** Every field is held as a string while editing; converted on save. */
export type SupportStaffForm = Record<SupportFieldKey, string>

export const SUPPORT_FIELD_KEYS: SupportFieldKey[] =
  SUPPORT_SECTIONS.flatMap(s => s.fields.map(f => f.key))

export function emptySupportStaffForm(): SupportStaffForm {
  return Object.fromEntries(SUPPORT_FIELD_KEYS.map(k => [k, ''])) as SupportStaffForm
}

export function supportStaffToForm(person: SupportStaff): SupportStaffForm {
  const form = emptySupportStaffForm()
  for (const key of SUPPORT_FIELD_KEYS) {
    const value = (person as unknown as Record<string, unknown>)[key]
    form[key] = value === null || value === undefined ? '' : String(value)
  }
  return form
}

/** Blanks become null; the wage becomes a number (or null if unparseable). */
export function formToSupportPatch(form: SupportStaffForm): SupportStaffPatch {
  const patch: Record<string, unknown> = {}
  for (const key of SUPPORT_FIELD_KEYS) {
    const raw = form[key]?.trim() ?? ''
    if (key === 'monthly_wage') {
      const parsed = raw === '' ? null : Number(raw)
      patch[key] = parsed === null || Number.isNaN(parsed) ? null : parsed
      continue
    }
    patch[key] = raw === '' ? null : raw
  }
  return patch as SupportStaffPatch
}

const INPUT = 'border border-[#D4D4D8] bg-white px-3 py-2 text-sm focus:outline-none focus:border-[#27272A] transition-colors w-full rounded-lg'
const LABEL = 'block text-[10px] font-bold uppercase tracking-widest text-[#525252] mb-1.5'
const SECTION_HEAD = 'text-[10px] font-bold uppercase tracking-widest text-[#B8983C] mb-3 pb-1 border-b border-[#E4E4E7]'

export default function SupportStaffFields({
  form, onChange, disabled = false,
}: {
  form: SupportStaffForm
  onChange: (key: SupportFieldKey, value: string) => void
  disabled?: boolean
}) {
  return (
    <>
      {SUPPORT_SECTIONS.map(section => (
        <div key={section.title} className="border border-[#E4E4E7] bg-white p-4 rounded-xl">
          <p className={SECTION_HEAD}>{section.title}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {section.fields.map(f => (
              <div key={f.key} className={f.span ? 'sm:col-span-2' : ''}>
                <label className={LABEL}>{f.label}</label>
                {f.type === 'select' ? (
                  <select
                    value={form[f.key] ?? ''}
                    onChange={e => onChange(f.key, e.target.value)}
                    className={INPUT}
                    disabled={disabled}
                  >
                    {f.options?.map(o => <option key={o} value={o}>{o || 'Select…'}</option>)}
                  </select>
                ) : f.type === 'textarea' ? (
                  <textarea
                    value={form[f.key] ?? ''}
                    onChange={e => onChange(f.key, e.target.value)}
                    rows={3}
                    placeholder={f.placeholder}
                    className={INPUT}
                    disabled={disabled}
                  />
                ) : (
                  <input
                    type={f.type === 'number' ? 'number' : f.type ?? 'text'}
                    value={form[f.key] ?? ''}
                    onChange={e => onChange(f.key, e.target.value)}
                    placeholder={f.placeholder}
                    className={INPUT}
                    disabled={disabled}
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </>
  )
}
