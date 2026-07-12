'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { Check, Info } from 'lucide-react'
import Avatar from '@/components/Avatar'
import { ADMIN } from '@/components/salary/adminUi'
import { Sheet, SHEET } from '@/components/bus/adminUI'
import { UserProfile, getRoleDisplayName } from '@/lib/supabase'
import { StaffBankAccount, fetchEligibleStaff, fetchBankAccounts, upsertBankAccount } from '@/lib/salary'

export default function BankAccountsSection() {
  const [loading, setLoading] = useState(true)
  const [staff, setStaff] = useState<UserProfile[]>([])
  const [bankByStaff, setBankByStaff] = useState<Record<string, StaffBankAccount>>({})

  const load = useCallback(async () => {
    setLoading(true)
    const [people, accounts] = await Promise.all([fetchEligibleStaff(), fetchBankAccounts()])
    const map: Record<string, StaffBankAccount> = {}
    for (const a of accounts) map[a.staff_id] = a
    setStaff(people)
    setBankByStaff(map)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  return (
    <>
      <div className="flex items-center gap-2 mb-3">
        <h2 className={ADMIN.label}>Bank accounts</h2>
        <Info size={11} className="text-[#B8983C]" />
        <span className="text-[10px] text-[#A1A1AA]">admin-managed · staff view only</span>
      </div>

      {loading ? (
        <div className="text-center py-10"><div className="spinner mx-auto mb-3" /><p className="text-sm text-[#71717A]">Loading…</p></div>
      ) : staff.length === 0 ? (
        <div className={`${ADMIN.card} shadow-sm p-6 text-center text-sm text-[#71717A]`}>
          No teacher, coordinator, or principal accounts yet.
        </div>
      ) : (
        <Sheet>
          {staff.map(person => (
            <BankRow key={person.id} person={person} existing={bankByStaff[person.id]} onSaved={load} />
          ))}
        </Sheet>
      )}
    </>
  )
}

function BankRow({ person, existing, onSaved }: {
  person: UserProfile
  existing?: StaffBankAccount
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
    const res = await upsertBankAccount({
      staff_id: person.id,
      account_holder_name: holder.trim(),
      account_number: account.trim(),
      ifsc: ifsc.trim().toUpperCase(),
      bank_name: bankName.trim() || null,
    })
    setSaving(false)
    if (!res.success) { setError(res.error ?? 'Failed to save'); return }
    setSaved(true); setTimeout(() => setSaved(false), 1800); onSaved()
  }

  const inputCls = 'w-full bg-white border border-[#E4E4E7] rounded-lg px-3 py-1.5 text-xs text-[#27272A] placeholder:text-[#A1A1AA] focus:outline-none focus:border-[#27272A] transition-colors'

  return (
    <div className={`${SHEET.row} items-stretch`}>
      <div className={`${SHEET.bar} ${existing ? 'bg-[#B8983C]' : 'bg-transparent'}`} />
      <div className="flex-1 min-w-0 px-3 py-3">
        <div className="flex items-center gap-2.5 mb-2.5">
          <Avatar avatarUrl={person.avatar_url} name={person.full_name} size={30} userId={person.id} />
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-[#18181B] text-sm truncate">{person.full_name}</p>
            <p className="text-[11px] text-[#A1A1AA]">{getRoleDisplayName(person.role, person.is_non_teaching)}</p>
          </div>
          {existing && <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#27272A] text-white">On file</span>}
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-1.5">
          <input value={holder} onChange={e => setHolder(e.target.value)} placeholder="Account holder" className={inputCls} />
          <input value={bankName} onChange={e => setBankName(e.target.value)} placeholder="Bank name (optional)" className={inputCls} />
          <input value={account} onChange={e => setAccount(e.target.value)} placeholder="Account number" className={`${inputCls} tabular-nums`} />
          <input value={ifsc} onChange={e => setIfsc(e.target.value)} placeholder="IFSC" className={`${inputCls} uppercase`} />
        </div>

        {error && <p className="text-[11px] text-rose-600 mt-1.5">{error}</p>}

        <div className="flex justify-end mt-2">
          <button onClick={save} disabled={saving || !dirty}
            className={`${ADMIN.darkBtn} text-[11px] px-2.5 py-1.5 disabled:opacity-40`}>
            {saved ? <><Check size={11} /> Saved</> : saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
