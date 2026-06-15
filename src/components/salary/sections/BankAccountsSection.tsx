'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { Check, Info } from 'lucide-react'
import Avatar from '@/components/Avatar'
import { ADMIN } from '@/components/salary/adminUi'
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
      <h2 className={`${ADMIN.label} mb-2`}>Bank accounts</h2>

      <div className="flex items-start gap-2 mb-4 p-3 bg-[#FBF6E9] border border-[#EFE3C4] rounded-xl text-xs text-[#8A6D1F]">
        <Info size={14} className="flex-shrink-0 mt-0.5" />
        <span>Bank details are entered and maintained by admins. Staff can view their own on file but cannot edit them.</span>
      </div>

      {loading ? (
        <div className="text-center py-12"><div className="spinner mx-auto mb-3" /><p className="text-sm text-[#71717A]">Loading…</p></div>
      ) : staff.length === 0 ? (
        <div className={`${ADMIN.card} shadow-sm p-8 text-center text-sm text-[#71717A]`}>
          No teacher, coordinator, or principal accounts yet.
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5">
          {staff.map(person => (
            <BankRow key={person.id} person={person} existing={bankByStaff[person.id]} onSaved={load} />
          ))}
        </div>
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

  return (
    <div className={`${ADMIN.card} shadow-sm p-4`}>
      <div className="flex items-center gap-3 mb-3">
        <Avatar avatarUrl={person.avatar_url} name={person.full_name} size={38} userId={person.id} />
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-[#18181B] truncate">{person.full_name}</p>
          <p className="text-xs text-[#71717A]">{getRoleDisplayName(person.role)}</p>
        </div>
        {existing && <span className="text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full bg-[#27272A] text-white">On file</span>}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <input value={holder} onChange={e => setHolder(e.target.value)} placeholder="Account holder name" className={ADMIN.inputPlain} />
        <input value={bankName} onChange={e => setBankName(e.target.value)} placeholder="Bank name (optional)" className={ADMIN.inputPlain} />
        <input value={account} onChange={e => setAccount(e.target.value)} placeholder="Account number" className={`${ADMIN.inputPlain} tabular-nums`} />
        <input value={ifsc} onChange={e => setIfsc(e.target.value)} placeholder="IFSC" className={`${ADMIN.inputPlain} uppercase`} />
      </div>

      {error && <p className="text-xs text-rose-600 mt-2">{error}</p>}

      <div className="flex justify-end mt-3">
        <button onClick={save} disabled={saving || !dirty} className={ADMIN.darkBtn}>
          {saved ? <><Check size={13} /> Saved</> : saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}
