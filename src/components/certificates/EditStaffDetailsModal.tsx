'use client'

import React, { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { IdCard, X, Save, Loader2 } from 'lucide-react'
import {
  StaffDetails, StaffDetailsPatch, fetchStaffDetails, upsertStaffDetails,
} from '@/lib/staffDetails'

const input = 'border border-[#D4D4D8] bg-white px-3 py-2 text-sm focus:outline-none focus:border-[#27272A] transition-colors w-full'
const selectCls = 'border border-[#D4D4D8] bg-white px-3 py-2 text-sm focus:outline-none focus:border-[#27272A] transition-colors w-full'
const labelCls = 'block text-[10px] font-bold uppercase tracking-widest text-[#525252] mb-1.5'
const sectionHead = 'text-[10px] font-bold uppercase tracking-widest text-[#B8983C] mt-5 mb-3 pb-1 border-b border-[#E4E4E7]'

type FieldDef = {
  key: keyof StaffDetailsPatch
  label: string
  type?: 'text' | 'date' | 'select' | 'textarea'
  placeholder?: string
  options?: string[]
  span?: boolean
}

const SECTIONS: { title: string; fields: FieldDef[] }[] = [
  {
    title: 'Employment',
    fields: [
      { key: 'employee_id', label: 'Employee ID', placeholder: 'EMP-001' },
      { key: 'designation', label: 'Designation', placeholder: 'PGT / TGT / PRT / Librarian…' },
      { key: 'department', label: 'Department', placeholder: 'Mathematics' },
      { key: 'subjects_taught', label: 'Subjects Taught', placeholder: 'Mathematics, Science' },
      {
        key: 'employment_type', label: 'Employment Type', type: 'select',
        options: ['', 'Permanent', 'Contractual', 'Adhoc', 'Deputation', 'Guest'],
      },
      { key: 'cbse_reg_no', label: 'CBSE Reg. No.', placeholder: 'CBSE / Affiliation number' },
      { key: 'date_of_joining', label: 'Date of Joining', type: 'date' },
      { key: 'date_of_confirmation', label: 'Date of Confirmation', type: 'date' },
      { key: 'date_of_retirement', label: 'Date of Retirement', type: 'date' },
    ],
  },
  {
    title: 'Qualifications',
    fields: [
      { key: 'qualification', label: 'Highest Qualification', placeholder: 'M.Sc, B.Ed' },
      { key: 'teaching_diploma', label: 'Teaching Diploma', placeholder: 'B.Ed / D.El.Ed / B.P.Ed…' },
      {
        key: 'ugc_net_qualified', label: 'UGC / NET Qualified', type: 'select',
        options: ['', 'Yes', 'No', 'NA'],
      },
      { key: 'teaching_experience_years', label: 'Teaching Experience (Years)', placeholder: '5' },
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
      { key: 'nationality', label: 'Nationality', placeholder: 'Indian' },
      { key: 'religion', label: 'Religion', placeholder: 'Hindu / Christian / Muslim…' },
      {
        key: 'category', label: 'Category', type: 'select',
        options: ['', 'General', 'OBC', 'SC', 'ST', 'EWS'],
      },
      {
        key: 'marital_status', label: 'Marital Status', type: 'select',
        options: ['', 'Single', 'Married', 'Divorced', 'Widowed'],
      },
      {
        key: 'physically_challenged', label: 'Differently Abled', type: 'select',
        options: ['', 'No', 'Yes'],
      },
      {
        key: 'ex_serviceman', label: 'Ex-Serviceman', type: 'select',
        options: ['', 'No', 'Yes'],
      },
      { key: 'blood_group', label: 'Blood Group', placeholder: 'O+' },
    ],
  },
  {
    title: 'Contact',
    fields: [
      { key: 'phone', label: 'Phone', placeholder: '9876543210' },
      { key: 'alternate_phone', label: 'Alternate Phone', placeholder: '9876543211' },
      { key: 'emergency_contact_name', label: 'Emergency Contact Name', placeholder: 'Full name' },
      { key: 'emergency_contact', label: 'Emergency Contact Number', placeholder: '9876543212' },
      { key: 'emergency_contact_relation', label: 'Relation to Emergency Contact', placeholder: 'Spouse / Parent…' },
    ],
  },
  {
    title: 'Address',
    fields: [
      { key: 'address', label: 'Residential Address', type: 'textarea', span: true, placeholder: 'Full address including city, state, PIN' },
    ],
  },
  {
    title: 'Identity Documents',
    fields: [
      { key: 'aadhaar_no', label: 'Aadhaar No.', placeholder: 'XXXX XXXX XXXX' },
      { key: 'pan_no', label: 'PAN No.', placeholder: 'ABCDE1234F' },
    ],
  },
  {
    title: 'Financial / Payroll',
    fields: [
      { key: 'epf_no', label: 'EPF / PF No.', placeholder: 'PF account number' },
      { key: 'nps_no', label: 'NPS PRAN No.', placeholder: 'PRAN number' },
      { key: 'bank_account_no', label: 'Bank Account No.', placeholder: 'Account number' },
      { key: 'bank_name', label: 'Bank Name & Branch', placeholder: 'SBI – Gandhi Nagar Branch' },
      { key: 'ifsc_code', label: 'IFSC Code', placeholder: 'SBIN0001234' },
    ],
  },
]

export default function EditStaffDetailsModal({
  staffId, staffName, onClose, onSaved,
}: {
  staffId: string
  staffName: string
  onClose: () => void
  onSaved?: () => void
}) {
  const [form, setForm] = useState<StaffDetailsPatch>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    fetchStaffDetails(staffId).then((d: StaffDetails | null) => {
      if (!active) return
      if (d) {
        const { id: _id, staff_id: _sid, created_at: _c, updated_at: _u, ...rest } = d
        setForm(rest)
      }
      setLoading(false)
    })
    return () => { active = false }
  }, [staffId])

  function set(key: keyof StaffDetailsPatch, value: string) {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  async function handleSave() {
    setSaving(true); setError(null)
    const patch: StaffDetailsPatch = {}
    for (const section of SECTIONS) {
      for (const f of section.fields) {
        const v = (form[f.key] as string | null | undefined) ?? ''
        ;(patch as Record<string, unknown>)[f.key] = v === '' ? null : v
      }
    }
    const res = await upsertStaffDetails(staffId, patch)
    setSaving(false)
    if (!res.success) { setError(res.error ?? 'Failed to save'); return }
    onSaved?.()
    onClose()
  }

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose} className="fixed inset-0 bg-black/60 z-40"
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 16 }}
        transition={{ type: 'spring', stiffness: 380, damping: 30 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
      >
        <div className="bg-white shadow-2xl w-full max-w-2xl flex flex-col max-h-[90vh] overflow-hidden border border-[#D4D4D8]" onClick={e => e.stopPropagation()}>
          <div className="bg-[#27272A] px-6 py-4 flex items-center justify-between flex-shrink-0">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 bg-white/10 flex items-center justify-center"><IdCard size={18} className="text-[#B8983C]" /></div>
              <div>
                <h2 className="text-lg font-bold text-white">Staff Details</h2>
                <p className="text-xs text-white/60">{staffName}</p>
              </div>
            </div>
            <button onClick={onClose} className="p-1.5 bg-white/10 hover:bg-white/20 transition-colors">
              <X size={18} className="text-white" />
            </button>
          </div>

          <div className="p-6 overflow-y-auto flex-1" style={{ backgroundColor: '#FDFCF9' }}>
            {loading ? (
              <div className="flex items-center justify-center py-12 gap-2 text-sm text-[#71717A]">
                <Loader2 size={16} className="animate-spin" /> Loading details…
              </div>
            ) : (
              <>
                {error && (
                  <div className="bg-rose-50 border border-rose-200 text-rose-700 px-4 py-3 text-sm mb-4">{error}</div>
                )}

                {SECTIONS.map(section => (
                  <div key={section.title}>
                    <p className={sectionHead}>{section.title}</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {section.fields.map(f => (
                        <div key={f.key} className={f.span ? 'sm:col-span-2' : ''}>
                          <label className={labelCls}>{f.label}</label>
                          {f.type === 'select' ? (
                            <select
                              value={(form[f.key] as string | null) ?? ''}
                              onChange={e => set(f.key, e.target.value)}
                              className={selectCls}
                            >
                              {f.options?.map(o => (
                                <option key={o} value={o}>{o || '— Select —'}</option>
                              ))}
                            </select>
                          ) : f.type === 'textarea' ? (
                            <textarea
                              value={(form[f.key] as string | null) ?? ''}
                              onChange={e => set(f.key, e.target.value)}
                              rows={3}
                              placeholder={f.placeholder}
                              className={input}
                            />
                          ) : (
                            <input
                              type={f.type ?? 'text'}
                              value={(form[f.key] as string | null) ?? ''}
                              onChange={e => set(f.key, e.target.value)}
                              placeholder={f.placeholder}
                              className={input}
                            />
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>

          <div className="px-6 py-4 border-t border-[#E4E4E7] bg-white flex gap-3 flex-shrink-0">
            <button onClick={onClose} disabled={saving}
              className="flex-1 px-4 py-2.5 border border-[#D4D4D8] text-[#18181B] text-sm font-medium hover:bg-[#F4F4F5] transition-colors">
              Cancel
            </button>
            <button onClick={handleSave} disabled={saving || loading}
              className="flex-1 px-4 py-2.5 bg-[#27272A] hover:bg-[#18181B] text-[#F5F5F5] text-sm font-medium transition-colors flex items-center justify-center gap-2 disabled:opacity-60">
              {saving ? <><Loader2 size={16} className="animate-spin" /> Saving…</> : <><Save size={16} /> Save Details</>}
            </button>
          </div>
        </div>
      </motion.div>
    </>
  )
}
