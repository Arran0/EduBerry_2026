'use client'

import React, { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { IdCard, X, Save, Loader2 } from 'lucide-react'
import {
  StudentDetails, StudentDetailsPatch, fetchStudentDetails, upsertStudentDetails,
} from '@/lib/studentDetails'

const input = 'border border-[#D4D4D8] bg-white px-3 py-2 text-sm focus:outline-none focus:border-[#27272A] transition-colors w-full rounded-lg'
const labelCls = 'block text-[10px] font-bold uppercase tracking-widest text-[#525252] mb-1.5'

type FieldDef = { key: keyof StudentDetailsPatch; label: string; type?: 'text' | 'date'; placeholder?: string }

type Section = { title: string; fields: FieldDef[]; fullWidthLast?: boolean }

const SECTIONS: Section[] = [
  {
    title: 'Identification',
    fields: [
      { key: 'admission_no', label: 'Admission No.' },
      { key: 'roll_no', label: 'Roll No.' },
      { key: 'pen_no', label: 'PEN No.', placeholder: 'Permanent Education Number' },
      { key: 'cbse_reg_no', label: 'CBSE Reg. No.' },
      { key: 'udise_student_code', label: 'UDISE Student Code / SRN' },
    ],
  },
  {
    title: 'Personal Details',
    fields: [
      { key: 'date_of_birth', label: 'Date of Birth', type: 'date' },
      { key: 'gender', label: 'Gender', placeholder: 'Male / Female / Transgender' },
      { key: 'place_of_birth', label: 'Place of Birth' },
      { key: 'blood_group', label: 'Blood Group', placeholder: 'e.g. O+' },
      { key: 'differently_abled', label: 'Differently Abled', placeholder: 'No / Yes — Type' },
      { key: 'single_girl_child', label: 'Single Girl Child', placeholder: 'Yes / No' },
    ],
  },
  {
    title: 'Family Details',
    fields: [
      { key: 'father_name', label: "Father's Name" },
      { key: 'father_qualification', label: "Father's Qualification" },
      { key: 'father_occupation', label: "Father's Occupation" },
      { key: 'mother_name', label: "Mother's Name" },
      { key: 'mother_qualification', label: "Mother's Qualification" },
      { key: 'mother_occupation', label: "Mother's Occupation" },
      { key: 'guardian_name', label: "Guardian's Name" },
      { key: 'annual_income', label: 'Annual Family Income', placeholder: 'e.g. Below 1L / 1L–3L' },
    ],
  },
  {
    title: 'Socio-Economic Details',
    fields: [
      { key: 'nationality', label: 'Nationality' },
      { key: 'mother_tongue', label: 'Mother Tongue' },
      { key: 'religion', label: 'Religion' },
      { key: 'category', label: 'Category', placeholder: 'SC / ST / OBC / GEN' },
      { key: 'caste', label: 'Caste' },
      { key: 'minority', label: 'Minority', placeholder: 'Yes / No' },
      { key: 'bpl_card_no', label: 'BPL Card No.' },
      { key: 'ews_certificate_no', label: 'EWS Certificate No.' },
    ],
  },
  {
    title: 'Admission & Transfer',
    fields: [
      { key: 'date_of_admission', label: 'Date of Admission', type: 'date' },
      { key: 'admission_class', label: 'Admission Class', placeholder: 'e.g. Class I' },
      { key: 'previous_school', label: 'Previous School' },
      { key: 'tc_no', label: 'TC No.' },
      { key: 'tc_date', label: 'TC Date', type: 'date' },
    ],
  },
  {
    title: 'Contact & Identity',
    fields: [
      { key: 'phone', label: 'Phone' },
      { key: 'aadhaar_no', label: 'Aadhaar No.' },
    ],
    fullWidthLast: false,
  },
]

// Flat list used by save handler to enumerate all patchable keys.
const ALL_FIELDS: FieldDef[] = SECTIONS.flatMap(s => s.fields)

export default function EditStudentDetailsModal({
  studentId, studentName, onClose, onSaved,
}: {
  studentId: string
  studentName: string
  onClose: () => void
  onSaved?: () => void
}) {
  const [form, setForm] = useState<StudentDetailsPatch>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    fetchStudentDetails(studentId).then((d: StudentDetails | null) => {
      if (!active) return
      if (d) {
        const { id: _id, student_id: _sid, created_at: _c, updated_at: _u, ...rest } = d
        setForm(rest)
      }
      setLoading(false)
    })
    return () => { active = false }
  }, [studentId])

  function set(key: keyof StudentDetailsPatch, value: string) {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  async function handleSave() {
    setSaving(true); setError(null)
    // Trim empties to null so blank fields don't store "".
    const patch: StudentDetailsPatch = {}
    for (const f of ALL_FIELDS) {
      const v = (form[f.key] as string | null | undefined) ?? ''
      ;(patch as Record<string, unknown>)[f.key] = v === '' ? null : v
    }
    const res = await upsertStudentDetails(studentId, patch)
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
        <div className="bg-white shadow-2xl w-full max-w-2xl flex flex-col max-h-[90vh] rounded-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
          <div className="bg-[#27272A] px-6 py-4 flex items-center justify-between flex-shrink-0">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-white/10 rounded-lg"><IdCard size={18} className="text-white" /></div>
              <div>
                <h2 className="text-lg font-bold text-white">Edit Student Details</h2>
                <p className="text-xs text-white/60">{studentName}</p>
              </div>
            </div>
            <button onClick={onClose} className="p-1.5 bg-white/10 hover:bg-white/20 rounded-lg transition-colors">
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
                  <div className="bg-rose-50 border border-rose-200 text-rose-700 px-4 py-3 text-sm rounded-lg mb-4">{error}</div>
                )}
                <div className="space-y-6">
                  {SECTIONS.map(section => (
                    <div key={section.title}>
                      <h3 className="text-[10px] font-bold uppercase tracking-widest text-[#A1A1AA] mb-3 pb-1.5 border-b border-[#E4E4E7]">{section.title}</h3>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {section.fields.map(f => (
                          <div key={f.key}>
                            <label className={labelCls}>{f.label}</label>
                            <input
                              type={f.type ?? 'text'}
                              value={(form[f.key] as string | null) ?? ''}
                              onChange={e => set(f.key, e.target.value)}
                              placeholder={f.placeholder}
                              className={input}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                  <div>
                    <h3 className="text-[10px] font-bold uppercase tracking-widest text-[#A1A1AA] mb-3 pb-1.5 border-b border-[#E4E4E7]">Address</h3>
                    <textarea
                      value={(form.address as string | null) ?? ''}
                      onChange={e => set('address', e.target.value)}
                      rows={3}
                      className={input}
                      placeholder="Full residential address"
                    />
                  </div>
                </div>
              </>
            )}
          </div>

          <div className="px-6 py-4 border-t border-[#E4E4E7] bg-white flex gap-3 flex-shrink-0">
            <button onClick={onClose} disabled={saving}
              className="flex-1 px-4 py-2.5 border border-[#D4D4D8] text-[#18181B] text-sm font-medium rounded-lg hover:bg-[#F4F4F5] transition-colors">
              Cancel
            </button>
            <button onClick={handleSave} disabled={saving || loading}
              className="flex-1 px-4 py-2.5 bg-[#27272A] hover:bg-[#18181B] text-white text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-60">
              {saving ? <><Loader2 size={16} className="animate-spin" /> Saving…</> : <><Save size={16} /> Save Details</>}
            </button>
          </div>
        </div>
      </motion.div>
    </>
  )
}
