'use client'

import React, { useState } from 'react'
import { motion } from 'framer-motion'
import { HardHat, X, Save, Loader2 } from 'lucide-react'
import { SupportStaff, updateSupportStaff } from '@/lib/supportStaff'
import SupportStaffFields, {
  SupportStaffForm, SupportFieldKey, supportStaffToForm, formToSupportPatch,
} from '@/components/staff/SupportStaffFields'

/**
 * Edits one support staff member. There is no account behind these people, so
 * unlike EditStaffDetailsModal there is no role, no email and no password —
 * just a name and the details attendance and salary need.
 */
export default function EditSupportStaffModal({
  person, onClose, onSaved,
}: {
  person: SupportStaff
  onClose: () => void
  onSaved?: () => void
}) {
  const [fullName, setFullName] = useState(person.full_name)
  const [form, setForm] = useState<SupportStaffForm>(() => supportStaffToForm(person))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const set = (key: SupportFieldKey, value: string) =>
    setForm(prev => ({ ...prev, [key]: value }))

  async function handleSave() {
    const trimmed = fullName.trim()
    if (!trimmed) { setError('Full name is required'); return }
    setSaving(true); setError(null)
    const res = await updateSupportStaff(person.id, {
      ...formToSupportPatch(form),
      full_name: trimmed,
    })
    setSaving(false)
    if (!res.success) { setError(res.error ?? 'Failed to save'); return }
    onSaved?.()
    onClose()
  }

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 bg-black/60 backdrop-blur-sm"
    >
      <motion.div
        initial={{ y: 40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 40, opacity: 0 }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        className="bg-white shadow-2xl w-full sm:max-w-2xl flex flex-col max-h-[92dvh] sm:max-h-[88vh] rounded-t-3xl sm:rounded-3xl overflow-hidden border border-[#D4D4D8]"
        onClick={e => e.stopPropagation()}
      >
        <div className="bg-[#27272A] px-6 pt-3 pb-4 flex-shrink-0">
          <div className="w-10 h-1 bg-white/30 rounded-full mx-auto mb-3 sm:hidden" />
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 bg-white/10 rounded-lg flex items-center justify-center">
                <HardHat size={18} className="text-[#B8983C]" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-white">Support Staff</h2>
                <p className="text-xs text-white/60">{person.full_name}</p>
              </div>
            </div>
            <button onClick={onClose} className="p-1.5 bg-white/10 hover:bg-white/20 rounded-lg transition-colors">
              <X size={18} className="text-white" />
            </button>
          </div>
        </div>

        <div className="p-6 overflow-y-auto flex-1 space-y-4" style={{ backgroundColor: '#FDFCF9' }}>
          {error && (
            <div className="bg-rose-50 border border-rose-200 text-rose-700 px-4 py-3 text-sm rounded-lg">{error}</div>
          )}

          <div className="border border-[#E4E4E7] bg-white p-4 rounded-xl">
            <p className="text-[10px] font-bold uppercase tracking-widest text-[#B8983C] mb-3 pb-1 border-b border-[#E4E4E7]">Identity</p>
            <label className="block text-[10px] font-bold uppercase tracking-widest text-[#525252] mb-1.5">Full Name *</label>
            <input
              type="text"
              value={fullName}
              onChange={e => setFullName(e.target.value)}
              placeholder="Full name"
              className="border border-[#D4D4D8] bg-white px-3 py-2 text-sm focus:outline-none focus:border-[#27272A] transition-colors w-full rounded-lg"
              disabled={saving}
            />
            <p className="text-[11px] text-[#A1A1AA] mt-1.5">
              Support staff have no login — this name is what appears in attendance and salary.
            </p>
          </div>

          <SupportStaffFields form={form} onChange={set} disabled={saving} />
        </div>

        <div className="px-6 py-4 border-t border-[#E4E4E7] bg-white flex gap-3 flex-shrink-0">
          <button
            onClick={onClose} disabled={saving}
            className="flex-1 px-4 py-2.5 border border-[#D4D4D8] text-[#18181B] text-sm font-medium rounded-lg hover:bg-[#F4F4F5] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave} disabled={saving}
            className="flex-1 px-4 py-2.5 bg-[#27272A] hover:bg-[#18181B] text-white text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-60"
          >
            {saving ? <><Loader2 size={16} className="animate-spin" /> Saving…</> : <><Save size={16} /> Save Details</>}
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}
