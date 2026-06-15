'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { Check } from 'lucide-react'
import Avatar from '@/components/Avatar'
import { ADMIN } from '@/components/bus/adminUI'
import { UserProfile, getRoleDisplayName } from '@/lib/supabase'
import {
  DriverSalaryBase, fetchEligibleDrivers, fetchDriverBaseSalaries, upsertDriverBaseSalary,
} from '@/lib/driverSalary'

export default function DriverBaseSalariesSection() {
  const [loading, setLoading] = useState(true)
  const [drivers, setDrivers] = useState<UserProfile[]>([])
  const [baseByDriver, setBaseByDriver] = useState<Record<string, DriverSalaryBase>>({})

  const load = useCallback(async () => {
    setLoading(true)
    const [people, bases] = await Promise.all([fetchEligibleDrivers(), fetchDriverBaseSalaries()])
    const map: Record<string, DriverSalaryBase> = {}
    for (const b of bases) map[b.driver_id] = b
    setDrivers(people)
    setBaseByDriver(map)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  return (
    <>
      <h2 className={`${ADMIN.label} mb-1`}>Base salaries</h2>
      <p className="text-sm text-[#71717A] mb-4">
        Active drivers are included when you run a monthly cycle, using the base set here.
      </p>

      {loading ? (
        <div className="text-center py-12"><div className="spinner mx-auto mb-3" /></div>
      ) : drivers.length === 0 ? (
        <div className={`${ADMIN.card} p-8 text-center text-sm text-[#71717A]`}>
          No driver accounts yet.
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5">
          {drivers.map(person => (
            <BaseRow key={person.id} person={person} existing={baseByDriver[person.id]} onSaved={load} />
          ))}
        </div>
      )}
    </>
  )
}

function BaseRow({ person, existing, onSaved }: {
  person: UserProfile
  existing?: DriverSalaryBase
  onSaved: () => void
}) {
  const [amount, setAmount] = useState(existing ? String(existing.base_amount) : '')
  const [active, setActive] = useState(existing?.active ?? true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const dirty = amount !== (existing ? String(existing.base_amount) : '') || active !== (existing?.active ?? true)

  const save = async () => {
    setSaving(true)
    const res = await upsertDriverBaseSalary({
      driver_id: person.id,
      base_amount: parseFloat(amount) || 0,
      active,
    })
    setSaving(false)
    if (res.success) { setSaved(true); setTimeout(() => setSaved(false), 1800); onSaved() }
  }

  return (
    <div className={`${ADMIN.card} shadow-sm p-4 flex flex-col sm:flex-row sm:items-center gap-3`}>
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <Avatar avatarUrl={person.avatar_url} name={person.full_name} size={38} userId={person.id} />
        <div className="min-w-0">
          <p className="font-semibold text-[#18181B] truncate">{person.full_name}</p>
          <p className="text-xs text-[#A1A1AA]">{getRoleDisplayName(person.role)}</p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#A1A1AA] text-sm">₹</span>
          <input type="number" min="0" step="0.01" value={amount} onChange={e => setAmount(e.target.value)}
            placeholder="0.00"
            className="w-28 sm:w-32 bg-white border border-[#E4E4E7] rounded-lg pl-6 pr-3 py-2 text-sm tabular-nums text-[#27272A] focus:outline-none focus:border-[#27272A] transition-colors" />
        </div>
        <label className="flex items-center gap-1.5 text-xs text-[#52525B] cursor-pointer select-none">
          <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)}
            className="w-4 h-4 accent-[#27272A]" />
          Active
        </label>
        <button onClick={save} disabled={saving || !dirty}
          className={`${ADMIN.darkBtn} disabled:opacity-40`}>
          {saved ? <><Check size={13} /> Saved</> : saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}
