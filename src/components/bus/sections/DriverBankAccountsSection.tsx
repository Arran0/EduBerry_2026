'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { Check, Info } from 'lucide-react'
import Avatar from '@/components/Avatar'
import { ADMIN } from '@/components/bus/adminUI'
import { UserProfile, getRoleDisplayName } from '@/lib/supabase'
import { DriverBankAccount, fetchDrivers, fetchDriverBankAccounts, upsertDriverBankAccount } from '@/lib/bus'

export default function DriverBankAccountsSection() {
  const [loading, setLoading] = useState(true)
  const [drivers, setDrivers] = useState<UserProfile[]>([])
  const [bankByDriver, setBankByDriver] = useState<Record<string, DriverBankAccount>>({})

  const load = useCallback(async () => {
    setLoading(true)
    const [people, accounts] = await Promise.all([fetchDrivers(), fetchDriverBankAccounts()])
    const map: Record<string, DriverBankAccount> = {}
    for (const a of accounts) map[a.driver_id] = a
    setDrivers(people)
    setBankByDriver(map)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  return (
    <>
      <h2 className={`${ADMIN.label} mb-2`}>Bank accounts</h2>

      <div className="flex items-start gap-2 mb-4 p-3 bg-[#F4F2EC] border border-[#E7E2D8] rounded-xl text-xs text-[#71717A]">
        <Info size={14} className="flex-shrink-0 mt-0.5 text-[#B8983C]" />
        <span>Bank details are entered and maintained by admins. Drivers can view their own on file but cannot edit them.</span>
      </div>

      {loading ? (
        <div className="text-center py-12"><div className="spinner mx-auto mb-3" /></div>
      ) : drivers.length === 0 ? (
        <div className={`${ADMIN.card} p-8 text-center text-sm text-[#71717A]`}>
          No driver accounts yet.
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5">
          {drivers.map(person => (
            <BankRow key={person.id} person={person} existing={bankByDriver[person.id]} onSaved={load} />
          ))}
        </div>
      )}
    </>
  )
}

function BankRow({ person, existing, onSaved }: {
  person: UserProfile
  existing?: DriverBankAccount
  onSaved: () => void
}) {
  const [holder, setHolder] = useState(existing?.account_holder_name ?? '')
  const [account, setAccount] = useState(existing?.account_number ?? '')
  const [ifsc, setIfsc] = useState(existing?.ifsc ?? '')
  const [bankName, setBankName] = useState(existing?.bank_name ?? '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const dirty =
    holder !== (existing?.account_holder_name ?? '') ||
    account !== (existing?.account_number ?? '') ||
    ifsc !== (existing?.ifsc ?? '') ||
    bankName !== (existing?.bank_name ?? '')

  const save = async () => {
    if (!holder.trim() || !account.trim() || !ifsc.trim()) {
      setError('Account holder, account number, and IFSC are required.')
      return
    }
    setSaving(true); setError(null)
    const res = await upsertDriverBankAccount({
      driver_id: person.id,
      account_holder_name: holder.trim(),
      account_number: account.trim(),
      ifsc: ifsc.trim().toUpperCase(),
      bank_name: bankName.trim() || null,
    })
    setSaving(false)
    if (!res.success) { setError(res.error ?? 'Failed to save'); return }
    setSaved(true); setTimeout(() => setSaved(false), 1800); onSaved()
  }

  return (
    <div className={`${ADMIN.card} shadow-sm p-4`}>
      <div className="flex items-center gap-3 mb-3">
        <Avatar avatarUrl={person.avatar_url} name={person.full_name} size={38} userId={person.id} />
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-[#18181B] truncate">{person.full_name}</p>
          <p className="text-xs text-[#A1A1AA]">{getRoleDisplayName(person.role)}</p>
        </div>
        {existing && <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-[#27272A] text-white">On file</span>}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <input value={holder} onChange={e => setHolder(e.target.value)} placeholder="Account holder name" className={ADMIN.inputPlain} />
        <input value={bankName} onChange={e => setBankName(e.target.value)} placeholder="Bank name (optional)" className={ADMIN.inputPlain} />
        <input value={account} onChange={e => setAccount(e.target.value)} placeholder="Account number" className={`${ADMIN.inputPlain} tabular-nums`} />
        <input value={ifsc} onChange={e => setIfsc(e.target.value)} placeholder="IFSC" className={`${ADMIN.inputPlain} uppercase`} />
      </div>

      {error && <p className="text-xs text-rose-600 mt-2">{error}</p>}

      <div className="flex justify-end mt-3">
        <button onClick={save} disabled={saving || !dirty}
          className={`${ADMIN.darkBtn} disabled:opacity-40`}>
          {saved ? <><Check size={13} /> Saved</> : saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}
