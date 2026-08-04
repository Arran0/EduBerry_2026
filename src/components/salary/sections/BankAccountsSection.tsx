'use client'

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { Check, Info, Bus } from 'lucide-react'
import Avatar from '@/components/Avatar'
import { ADMIN } from '@/components/salary/adminUi'
import { Sheet, SHEET } from '@/components/bus/adminUI'
import PersonSearch from '@/components/salary/PersonSearch'
import { UserProfile, getRoleDisplayName } from '@/lib/supabase'
import { StaffBankAccount, fetchEligibleStaff, fetchBankAccounts, upsertBankAccount } from '@/lib/salary'
import { DriverBankAccount, fetchDrivers, fetchDriverBankAccounts, upsertDriverBankAccount } from '@/lib/bus'

/**
 * Shared column template for the header and every row. Applied as an inline
 * style: Tailwind only emits CSS for class names it finds literally in the
 * source, so a `grid-cols-[...]` built by joining strings never gets
 * generated and the grid silently collapses to one stacked column.
 */
const GRID = 'grid items-center gap-x-2'
const GRID_COLS = [
  'minmax(170px,1.6fr)',  // person
  'minmax(140px,1.3fr)',  // account holder
  'minmax(120px,1.1fr)',  // bank
  'minmax(140px,1.3fr)',  // account number
  'minmax(96px,0.9fr)',   // IFSC
  'minmax(56px,0.5fr)',   // save
].join(' ')

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
  const [search, setSearch] = useState('')

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

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return entries
    return entries.filter(e => e.person.full_name.toLowerCase().includes(q))
  }, [entries, search])

  return (
    <>
      <div className="flex items-center gap-2 mb-3">
        <h2 className={ADMIN.label}>Bank accounts</h2>
        <Info size={11} className="text-[#B8983C]" />
        <span className="text-[10px] text-[#A1A1AA]">admin-managed · staff &amp; drivers</span>
      </div>

      {!loading && entries.length > 0 && (
        <PersonSearch value={search} onChange={setSearch} placeholder="Search staff or drivers…" />
      )}

      {loading ? (
        <div className="text-center py-10"><div className="spinner mx-auto mb-3" /><p className="text-sm text-[#71717A]">Loading…</p></div>
      ) : entries.length === 0 ? (
        <div className={`${ADMIN.card} shadow-sm p-6 text-center text-sm text-[#71717A]`}>
          No teacher, coordinator, principal, or driver accounts yet.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-[820px]">
            <Sheet>
              {/* Header shares GRID_COLS with every row, so labels sit above their own column. */}
              <div className="hidden sm:flex items-stretch bg-[#27272A]">
                <div className="w-1 flex-shrink-0" />
                <div className={`${GRID} flex-1 min-w-0 px-3 py-2.5`} style={{ gridTemplateColumns: GRID_COLS }}>
                  <span className={`${SHEET.headCell} pl-[30px]`}>Person</span>
                  <span className={SHEET.headCell}>Account holder</span>
                  <span className={SHEET.headCell}>Bank</span>
                  <span className={SHEET.headCell}>Account number</span>
                  <span className={SHEET.headCell}>IFSC</span>
                  <span className={SHEET.headCell} />
                </div>
              </div>

              {visible.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-[#A1A1AA]">No one matches &quot;{search}&quot;.</div>
              ) : visible.map(e => (
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
        <div className={GRID} style={{ gridTemplateColumns: GRID_COLS }}>
          <div className="flex items-center gap-2 min-w-0">
            <Avatar avatarUrl={person.avatar_url} name={person.full_name} size={22} userId={person.id} />
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-[#18181B] text-xs truncate">{person.full_name}</p>
              <p className="text-[10px] text-[#A1A1AA] truncate flex items-center gap-1">
                {kind === 'driver' && <Bus size={9} className="flex-shrink-0" />}
                {getRoleDisplayName(person.role, person.is_non_teaching)}
              </p>
            </div>
          </div>
          <input value={holder} onChange={e => setHolder(e.target.value)} placeholder="Account holder" className={`${cellCls} w-full`} />
          <input value={bankName} onChange={e => setBankName(e.target.value)} placeholder="Bank" className={`${cellCls} w-full`} />
          <input value={account} onChange={e => setAccount(e.target.value)} placeholder="Account number" className={`${cellCls} w-full tabular-nums`} />
          <input value={ifsc} onChange={e => setIfsc(e.target.value)} placeholder="IFSC" className={`${cellCls} w-full uppercase`} />
          <button onClick={save} disabled={saving || !dirty}
            className={`${ADMIN.darkBtn} w-full text-[10px] px-1.5 py-1 disabled:opacity-40`}>
            {saved ? <Check size={11} /> : saving ? '…' : 'Save'}
          </button>
        </div>
        {error && <p className="text-[10px] text-rose-600 mt-1">{error}</p>}
      </div>
    </div>
  )
}
