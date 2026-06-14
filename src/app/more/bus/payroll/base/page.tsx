'use client'

import React, { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { ArrowLeft, Wallet, Check } from 'lucide-react'
import ProtectedLayout from '@/components/ProtectedLayout'
import Avatar from '@/components/Avatar'
import { UserProfile, getRoleDisplayName } from '@/lib/supabase'
import {
  DriverSalaryBase, fetchEligibleDrivers, fetchDriverBaseSalaries, upsertDriverBaseSalary,
} from '@/lib/driverSalary'

export default function DriverBasePage() {
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
    <ProtectedLayout adminOnly>
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6">
        <Link href="/more/bus/payroll" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-4">
          <ArrowLeft size={16} /> Driver Payroll
        </Link>

        <div className="flex items-center gap-3 mb-2">
          <div className="p-2 bg-gradient-to-br from-emerald-500 to-green-600 rounded-xl shadow">
            <Wallet className="text-white" size={20} />
          </div>
          <div>
            <h1 className="font-display text-2xl font-bold text-slate-800">Base Salaries</h1>
            <p className="text-xs text-slate-500">Standing monthly pay per driver</p>
          </div>
        </div>
        <p className="text-sm text-slate-500 mb-5">
          Active drivers are included when you run a monthly cycle, using the base set here.
        </p>

        {loading ? (
          <div className="text-center py-12"><div className="spinner mx-auto mb-3" /></div>
        ) : drivers.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-sm text-slate-500">
            No driver accounts yet.
          </div>
        ) : (
          <div className="space-y-3">
            {drivers.map(person => (
              <BaseRow key={person.id} person={person} existing={baseByDriver[person.id]} onSaved={load} />
            ))}
          </div>
        )}
      </div>
    </ProtectedLayout>
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
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 flex flex-col sm:flex-row sm:items-center gap-3">
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <Avatar avatarUrl={person.avatar_url} name={person.full_name} size={38} userId={person.id} />
        <div className="min-w-0">
          <p className="font-semibold text-slate-800 truncate">{person.full_name}</p>
          <p className="text-xs text-slate-400">{getRoleDisplayName(person.role)}</p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">₹</span>
          <input type="number" min="0" step="0.01" value={amount} onChange={e => setAmount(e.target.value)}
            placeholder="0.00"
            className="w-32 border border-slate-200 rounded-lg pl-6 pr-3 py-1.5 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-emerald-400/40" />
        </div>
        <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer select-none">
          <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)}
            className="w-4 h-4 accent-emerald-600" />
          Active
        </label>
        <button onClick={save} disabled={saving || !dirty}
          className="btn-primary text-xs flex items-center gap-1 disabled:opacity-40">
          {saved ? <><Check size={13} /> Saved</> : saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}
