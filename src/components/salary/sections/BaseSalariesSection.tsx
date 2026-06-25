'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { Check } from 'lucide-react'
import Avatar from '@/components/Avatar'
import { ADMIN } from '@/components/salary/adminUi'
import { Sheet, SHEET } from '@/components/bus/adminUI'
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
        <Sheet
          columns={
            <>
              <span className={`${SHEET.headCell} flex-1 ml-11`}>Staff</span>
              <span className={`${SHEET.headCell} text-right pr-2`}>Monthly base / Active</span>
            </>
          }
        >
          {staff.map(person => (
            <BaseRow key={person.id} person={person} existing={baseByStaff[person.id]} onSaved={load} />
          ))}
        </Sheet>
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
    <div className={SHEET.row}>
      <div className={`${SHEET.bar} ${active && existing ? 'bg-[#B8983C]' : 'bg-transparent'}`} />
      <div className="flex items-center gap-3 flex-1 min-w-0 px-3 py-2.5">
        <Avatar avatarUrl={person.avatar_url} name={person.full_name} size={32} userId={person.id} />
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-[#18181B] text-sm truncate">{person.full_name}</p>
          <p className="text-[11px] text-[#A1A1AA]">{getRoleDisplayName(person.role)}</p>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="relative">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#A1A1AA] text-xs">₹</span>
            <input type="number" min="0" step="0.01" value={amount} onChange={e => setAmount(e.target.value)}
              placeholder="0.00"
              className="w-24 bg-white border border-[#E4E4E7] rounded-lg pl-5 pr-2 py-1.5 text-xs tabular-nums text-[#27272A] focus:outline-none focus:border-[#27272A] transition-colors" />
          </div>
          <label className="hidden sm:flex items-center gap-1 cursor-pointer select-none" title="Include in pay cycles">
            <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)}
              className="w-3.5 h-3.5 accent-[#27272A]" />
            <span className="text-[11px] text-[#71717A]">Active</span>
          </label>
          <button onClick={save} disabled={saving || !dirty}
            className={`${ADMIN.darkBtn} text-[11px] px-2.5 py-1.5 disabled:opacity-40`}>
            {saved ? <><Check size={11} /> Saved</> : saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
