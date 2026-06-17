'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { Check } from 'lucide-react'
import Avatar from '@/components/Avatar'
import { ADMIN } from '@/components/salary/adminUi'
import { UserProfile, getRoleDisplayName } from '@/lib/supabase'
import {
  StaffSalaryBase, fetchEligibleStaff, fetchBaseSalaries, upsertBaseSalary,
} from '@/lib/salary'

export default function BaseSalariesSection() {
  const [loading, setLoading] = useState(true)
  const [staff, setStaff] = useState<UserProfile[]>([])
  const [baseByStaff, setBaseByStaff] = useState<Record<string, StaffSalaryBase>>({})

  const load = useCallback(async () => {
    setLoading(true)
    const [people, bases] = await Promise.all([fetchEligibleStaff(), fetchBaseSalaries()])
    const map: Record<string, StaffSalaryBase> = {}
    for (const b of bases) map[b.staff_id] = b
    setStaff(people)
    setBaseByStaff(map)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  return (
    <>
      <div className="flex items-baseline gap-2 mb-3">
        <h2 className={ADMIN.label}>Base salaries</h2>
        <p className="text-xs text-[#A1A1AA]">Used when running a monthly cycle</p>
      </div>

      {loading ? (
        <div className="text-center py-10"><div className="spinner mx-auto mb-3" /><p className="text-sm text-[#71717A]">Loading…</p></div>
      ) : staff.length === 0 ? (
        <div className={`${ADMIN.card} shadow-sm p-6 text-center text-sm text-[#71717A]`}>
          No teacher, coordinator, or principal accounts yet.
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
          {staff.map(person => (
            <BaseRow key={person.id} person={person} existing={baseByStaff[person.id]} onSaved={load} />
          ))}
        </div>
      )}
    </>
  )
}

function BaseRow({ person, existing, onSaved }: {
  person: UserProfile
  existing?: StaffSalaryBase
  onSaved: () => void
}) {
  const [amount, setAmount] = useState(existing ? String(existing.base_amount) : '')
  const [active, setActive] = useState(existing?.active ?? true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const dirty = amount !== (existing ? String(existing.base_amount) : '') || active !== (existing?.active ?? true)

  const save = async () => {
    setSaving(true)
    const res = await upsertBaseSalary({
      staff_id: person.id,
      base_amount: parseFloat(amount) || 0,
      active,
    })
    setSaving(false)
    if (res.success) { setSaved(true); setTimeout(() => setSaved(false), 1800); onSaved() }
  }

  return (
    <div className={`${ADMIN.card} shadow-sm p-3`}>
      {/* Header row: avatar + name + active toggle */}
      <div className="flex items-center gap-2.5 mb-2">
        <Avatar avatarUrl={person.avatar_url} name={person.full_name} size={30} userId={person.id} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-[#18181B] truncate leading-tight">{person.full_name}</p>
          <p className="text-[10px] text-[#71717A]">{getRoleDisplayName(person.role)}</p>
        </div>
        <label className="flex items-center gap-1 text-[10px] text-[#71717A] cursor-pointer select-none flex-shrink-0">
          <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)}
            className="w-3.5 h-3.5 accent-[#27272A]" />
          Active
        </label>
      </div>
      {/* Amount + save */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#A1A1AA] text-sm">₹</span>
          <input type="number" min="0" step="0.01" value={amount} onChange={e => setAmount(e.target.value)}
            placeholder="0.00"
            className="w-full bg-white border border-[#E4E4E7] rounded-lg pl-5 pr-2 py-1.5 text-sm tabular-nums text-[#27272A] focus:outline-none focus:border-[#27272A] transition-colors" />
        </div>
        <button onClick={save} disabled={saving || !dirty} className={ADMIN.darkBtn}>
          {saved ? <><Check size={13} /> Saved</> : saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}
