'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { Check, Info, Bus } from 'lucide-react'
import Avatar from '@/components/Avatar'
import { ADMIN } from '@/components/salary/adminUi'
import { Sheet, SHEET } from '@/components/bus/adminUI'
import { UserProfile, getRoleDisplayName } from '@/lib/supabase'
import { StaffBankAccount, fetchEligibleStaff, fetchBankAccounts, upsertBankAccount } from '@/lib/salary'
import { DriverBankAccount, fetchDrivers, fetchDriverBankAccounts, upsertDriverBankAccount } from '@/lib/bus'

type Kind = 'staff' | 'driver'
type Account = StaffBankAccount | DriverBankAccount

interface Entry {
  kind: Kind
  person: UserProfile
  existing?: Account
}

export default function BankAccountsSection() {
  const [loading, setLoading] = useState(true)
  const [entries, setEntries] = useState<Entry[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    const [staff, staffAccounts, drivers, driverAccounts] = await Promise.all([
      fetchEligibleStaff(), fetchBankAccounts(), fetchDrivers(), fetchDriverBankAccounts(),
    ])
    const staffMap: Record<string, StaffBankAccount> = {}
    for (const a of staffAccounts) staffMap[a.staff_id] = a
    const driverMap: Record<string, DriverBankAccount> = {}
    for (const a of driverAccounts) driverMap[a.driver_id] = a

    const merged: Entry[] = [
      ...staff.map(person => ({ kind: 'staff' as const, person, existing: staffMap[person.id] })),
      ...drivers.map(person => ({ kind: 'driver' as const, person, existing: driverMap[person.id] })),
    ].sort((a, b) => a.person.full_name.localeCompare(b.person.full_name))

    setEntries(merged)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  return (
    <>
      <div className="flex items-center gap-2 mb-3">
        <h2 className={ADMIN.label}>Bank accounts</h2>
        <Info size={11} className="text-[#B8983C]" />
        <span className="text-[10px] text-[#A1A1AA]">admin-managed · staff &amp; drivers</span>
      </div>

      {loading ? (
        <div className="text-center py-10"><div className="spinner mx-auto mb-3" /><p className="text-sm text-[#71717A]">Loading…</p></div>
      ) : entries.length === 0 ? (
        <div className={`${ADMIN.card} shadow-sm p-6 text-center text-sm text-[#71717A]`}>
          No teacher, coordinator, principal, or driver accounts yet.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-[880px]">
            <Sheet
              columns={
                <>
                  <span className={`${SHEET.headCell} w-52 flex-shrink-0 ml-8`}>Person</span>
                  <span className={`${SHEET.headCell} w-40 flex-shrink-0`}>Account holder</span>
                  <span className={`${SHEET.headCell} w-32 flex-shrink-0`}>Bank</span>
                  <span className={`${SHEET.headCell} w-36 flex-shrink-0`}>Account number</span>
                  <span className={`${SHEET.headCell} w-24 flex-shrink-0`}>IFSC</span>
                  <span className={`${SHEET.headCell} w-16 flex-shrink-0`} />
                </>
              }
            >
              {entries.map(e => (
                <BankRow key={`${e.kind}-${e.person.id}`} kind={e.kind} person={e.person} existing={e.existing} onSaved={load} />
              ))}
            </Sheet>
          </div>
        </div>
      )}
    </>
  )
}

function BankRow({ kind, person, existing, onSaved }: {
  kind: Kind
  person: UserProfile
  existing?: Account
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
    const res = kind === 'staff'
      ? await upsertBankAccount({
          staff_id: person.id,
          account_holder_name: holder.trim(),
          account_number: account.trim(),
          ifsc: ifsc.trim().toUpperCase(),
          bank_name: bankName.trim() || null,
        })
      : await upsertDriverBankAccount({
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

  const cellCls = 'bg-white border border-[#E4E4E7] rounded-md px-2 py-1 text-[11px] text-[#27272A] placeholder:text-[#A1A1AA] focus:outline-none focus:border-[#27272A] transition-colors'

  return (
    <div className={SHEET.row}>
      <div className={`${SHEET.bar} ${existing ? 'bg-[#B8983C]' : 'bg-transparent'}`} />
      <div className="flex-1 min-w-0 px-3 py-1.5">
        <div className="flex items-center gap-2">
          <Avatar avatarUrl={person.avatar_url} name={person.full_name} size={22} userId={person.id} />
          <div className="w-52 flex-shrink-0 min-w-0">
            <p className="font-semibold text-[#18181B] text-xs truncate">{person.full_name}</p>
            <p className="text-[10px] text-[#A1A1AA] truncate flex items-center gap-1">
              {kind === 'driver' && <Bus size={9} className="flex-shrink-0" />}
              {getRoleDisplayName(person.role, person.is_non_teaching)}
            </p>
          </div>
          <input value={holder} onChange={e => setHolder(e.target.value)} placeholder="Account holder" className={`${cellCls} w-40 flex-shrink-0`} />
          <input value={bankName} onChange={e => setBankName(e.target.value)} placeholder="Bank" className={`${cellCls} w-32 flex-shrink-0`} />
          <input value={account} onChange={e => setAccount(e.target.value)} placeholder="Account number" className={`${cellCls} w-36 flex-shrink-0 tabular-nums`} />
          <input value={ifsc} onChange={e => setIfsc(e.target.value)} placeholder="IFSC" className={`${cellCls} w-24 flex-shrink-0 uppercase`} />
          <button onClick={save} disabled={saving || !dirty}
            className={`${ADMIN.darkBtn} w-16 flex-shrink-0 text-[10px] px-1.5 py-1 disabled:opacity-40`}>
            {saved ? <Check size={11} /> : saving ? '…' : 'Save'}
          </button>
        </div>
        {error && <p className="text-[10px] text-rose-600 mt-1 ml-[120px]">{error}</p>}
      </div>
    </div>
  )
}
