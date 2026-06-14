'use client'

import React, { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { ArrowLeft, Landmark, Check, Info } from 'lucide-react'
import ProtectedLayout from '@/components/ProtectedLayout'
import Avatar from '@/components/Avatar'
import { UserProfile, getRoleDisplayName } from '@/lib/supabase'
import { DriverBankAccount, fetchDrivers, fetchDriverBankAccounts, upsertDriverBankAccount } from '@/lib/bus'

export default function DriverBankPage() {
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
    <ProtectedLayout adminOnly>
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6">
        <Link href="/more/bus/payroll" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-4">
          <ArrowLeft size={16} /> Driver Payroll
        </Link>

        <div className="flex items-center gap-3 mb-2">
          <div className="p-2 bg-gradient-to-br from-emerald-500 to-green-600 rounded-xl shadow">
            <Landmark className="text-white" size={20} />
          </div>
          <div>
            <h1 className="font-display text-2xl font-bold text-slate-800">Bank Accounts</h1>
            <p className="text-xs text-slate-500">Disbursement details per driver</p>
          </div>
        </div>

        <div className="flex items-start gap-2 mb-5 p-3 bg-amber-50 border border-amber-100 rounded-xl text-xs text-amber-700">
          <Info size={14} className="flex-shrink-0 mt-0.5" />
          <span>Bank details are entered and maintained by admins. Drivers can view their own on file but cannot edit them.</span>
        </div>

        {loading ? (
          <div className="text-center py-12"><div className="spinner mx-auto mb-3" /></div>
        ) : drivers.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-sm text-slate-500">
            No driver accounts yet.
          </div>
        ) : (
          <div className="space-y-3">
            {drivers.map(person => (
              <BankRow key={person.id} person={person} existing={bankByDriver[person.id]} onSaved={load} />
            ))}
          </div>
        )}
      </div>
    </ProtectedLayout>
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
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
      <div className="flex items-center gap-3 mb-3">
        <Avatar avatarUrl={person.avatar_url} name={person.full_name} size={38} userId={person.id} />
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-slate-800 truncate">{person.full_name}</p>
          <p className="text-xs text-slate-400">{getRoleDisplayName(person.role)}</p>
        </div>
        {existing && <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-600">On file</span>}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <input value={holder} onChange={e => setHolder(e.target.value)} placeholder="Account holder name" className={inputCls} />
        <input value={bankName} onChange={e => setBankName(e.target.value)} placeholder="Bank name (optional)" className={inputCls} />
        <input value={account} onChange={e => setAccount(e.target.value)} placeholder="Account number" className={`${inputCls} tabular-nums`} />
        <input value={ifsc} onChange={e => setIfsc(e.target.value)} placeholder="IFSC" className={`${inputCls} uppercase`} />
      </div>

      {error && <p className="text-xs text-rose-600 mt-2">{error}</p>}

      <div className="flex justify-end mt-3">
        <button onClick={save} disabled={saving || !dirty}
          className="btn-primary text-xs flex items-center gap-1 disabled:opacity-40">
          {saved ? <><Check size={13} /> Saved</> : saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}

const inputCls = 'w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400/40 bg-white'
