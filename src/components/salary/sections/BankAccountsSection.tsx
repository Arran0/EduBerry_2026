'use client'

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { Bus } from 'lucide-react'
import Avatar from '@/components/Avatar'
import {
  Sheet, SheetHead, SheetRow, SheetSkeleton, SearchField, SectionBar, Note, Column,
} from '@/components/salary/ui'
import SaveBar from '@/components/salary/SaveBar'
import { useAutosave } from '@/components/salary/useAutosave'
import { UserProfile, getDisplayRole } from '@/lib/supabase'
import { StaffBankAccount, fetchEligibleStaff, fetchBankAccounts, fetchHiddenSalaryMemberIds, upsertBankAccount } from '@/lib/salary'
import { DriverBankAccount, fetchDrivers, fetchDriverBankAccounts, upsertDriverBankAccount } from '@/lib/bus'

/**
 * Shared column template for the header and every row. Applied as an inline
 * style: Tailwind only emits CSS for class names it finds literally in the
 * source, so a `grid-cols-[...]` built by joining strings never gets
 * generated and the grid silently collapses to one stacked column.
 */
const COLS = [
  'minmax(150px,1.5fr)',  // person
  'minmax(128px,1.3fr)',  // account holder
  'minmax(104px,1fr)',    // bank
  'minmax(126px,1.2fr)',  // account number
  'minmax(92px,0.85fr)',  // IFSC
].join(' ')

const COLUMNS: Column[] = [
  { label: 'Person', className: 'pl-[26px]' },
  { label: 'Account holder' },
  { label: 'Bank' },
  { label: 'Account number' },
  { label: 'IFSC' },
]

const CELL = 'w-full bg-white border border-[#E3DFD3] px-1.5 py-[3px] text-[11px] leading-[1.4] text-[#27272A] placeholder:text-[#B5B0A1] focus:outline-none focus:border-[#27272A] transition-colors'

type Kind = 'staff' | 'driver'
type Account = StaffBankAccount | DriverBankAccount

interface Entry {
  key: string
  kind: Kind
  person: UserProfile
  existing?: Account
}

/** The editable shape of one row. */
interface Draft {
  holder: string
  bankName: string
  account: string
  ifsc: string
}

function draftOf(existing?: Account): Draft {
  return {
    holder: existing?.account_holder_name ?? '',
    bankName: existing?.bank_name ?? '',
    account: existing?.account_number ?? '',
    ifsc: existing?.ifsc ?? '',
  }
}

function sameDraft(a: Draft, b: Draft): boolean {
  return a.holder === b.holder && a.bankName === b.bankName && a.account === b.account && a.ifsc === b.ifsc
}

/** A row is only worth writing once the bank actually needs all three required fields. */
function isComplete(d: Draft): boolean {
  return d.holder.trim() !== '' && d.account.trim() !== '' && d.ifsc.trim() !== ''
}

export default function BankAccountsSection() {
  const [loading, setLoading] = useState(true)
  const [entries, setEntries] = useState<Entry[]>([])
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const [staff, staffAccounts, allDrivers, driverAccounts, hiddenIds] = await Promise.all([
      fetchEligibleStaff(), fetchBankAccounts(), fetchDrivers(), fetchDriverBankAccounts(), fetchHiddenSalaryMemberIds(),
    ])
    const hidden = new Set(hiddenIds)
    const drivers = allDrivers.filter(d => !hidden.has(d.id) && !d.is_banned)
    const staffMap: Record<string, StaffBankAccount> = {}
    for (const a of staffAccounts) staffMap[a.staff_id] = a
    const driverMap: Record<string, DriverBankAccount> = {}
    for (const a of driverAccounts) driverMap[a.driver_id] = a

    const merged: Entry[] = [
      ...staff.map(person => ({ key: `staff-${person.id}`, kind: 'staff' as const, person, existing: staffMap[person.id] })),
      ...drivers.map(person => ({ key: `driver-${person.id}`, kind: 'driver' as const, person, existing: driverMap[person.id] })),
    ].sort((a, b) => a.person.full_name.localeCompare(b.person.full_name))

    setEntries(merged)
    setDrafts(Object.fromEntries(merged.map(e => [e.key, draftOf(e.existing)])))
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const dirtyKeys = useMemo(
    () => entries.filter(e => drafts[e.key] && !sameDraft(drafts[e.key], draftOf(e.existing))).map(e => e.key),
    [entries, drafts],
  )

  // Half-typed rows are held back rather than rejected, so autosave never
  // fires an error at someone who is simply mid-way through a row.
  const savableKeys = useMemo(
    () => dirtyKeys.filter(k => drafts[k] && isComplete(drafts[k])),
    [dirtyKeys, drafts],
  )

  const flush = useCallback(async () => {
    const byKey = new Map(entries.map(e => [e.key, e]))
    for (const key of savableKeys) {
      const entry = byKey.get(key)
      const d = drafts[key]
      if (!entry || !d) continue
      const input = {
        account_holder_name: d.holder.trim(),
        account_number: d.account.trim(),
        ifsc: d.ifsc.trim().toUpperCase(),
        bank_name: d.bankName.trim() || null,
      }
      const res = entry.kind === 'staff'
        ? await upsertBankAccount({ staff_id: entry.person.id, ...input })
        : await upsertDriverBankAccount({ driver_id: entry.person.id, ...input })
      if (!res.success) return res
    }
    await load()
    return { success: true }
  }, [entries, drafts, savableKeys, load])

  const { state, error, saveNow } = useAutosave(savableKeys.length > 0, flush)

  const setDraft = (key: string, patch: Partial<Draft>) =>
    setDrafts(prev => ({ ...prev, [key]: { ...prev[key], ...patch } }))

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return entries
    return entries.filter(e => e.person.full_name.toLowerCase().includes(q))
  }, [entries, search])

  const incomplete = dirtyKeys.length - savableKeys.length
  const onFile = entries.filter(e => e.existing).length

  return (
    <>
      <SectionBar
        title="Bank accounts"
        hint={loading
          ? 'Admin-managed · staff & drivers'
          : `${onFile} of ${entries.length} on file · admin-managed`}
      />

      {!loading && entries.length > 0 && (
        <div className="flex items-center gap-2 mb-2">
          <SearchField value={search} onChange={setSearch} placeholder="Search people…" className="sm:max-w-[16rem]" />
          <SaveBar dirtyCount={savableKeys.length} state={state} error={error} onSave={saveNow} />
        </div>
      )}

      {incomplete > 0 && (
        <p className="text-[10.5px] text-[#7A6220] mb-2">
          {incomplete} row{incomplete === 1 ? '' : 's'} still need a holder, account number and IFSC before they can save.
        </p>
      )}

      <Sheet minWidth={700}>
        {/* The header scrolls sideways with the rows it labels, so it stays on
            phones too — five unlabelled bank fields are read by guesswork. */}
        <SheetHead cols={COLS} columns={COLUMNS} />
        {loading ? (
          <SheetSkeleton />
        ) : entries.length === 0 ? (
          <Note>No staff or driver accounts yet.</Note>
        ) : visible.length === 0 ? (
          <Note>No one matches &quot;{search}&quot;.</Note>
        ) : visible.map(e => (
          <BankRow
            key={e.key}
            entry={e}
            draft={drafts[e.key] ?? draftOf(e.existing)}
            dirty={dirtyKeys.includes(e.key)}
            onChange={patch => setDraft(e.key, patch)}
          />
        ))}
      </Sheet>
    </>
  )
}

function BankRow({ entry, draft, dirty, onChange }: {
  entry: Entry
  draft: Draft
  dirty: boolean
  onChange: (patch: Partial<Draft>) => void
}) {
  const { kind, person, existing } = entry
  // The edge bar doubles as the unsaved marker, so a pending row is obvious
  // without a per-row control taking up a column.
  const accent = dirty ? '#8A6D1F' : existing ? '#B8983C' : 'transparent'
  return (
    <SheetRow cols={COLS} accent={accent}>
      <div className="flex items-center gap-1.5 min-w-0">
        <Avatar avatarUrl={person.avatar_url} name={person.full_name} size={20} userId={person.id} />
        <div className="min-w-0 flex-1 leading-tight">
          <p className="font-semibold text-[#18181B] text-[11.5px] truncate">{person.full_name}</p>
          <p className="text-[9.5px] text-[#A8A395] truncate flex items-center gap-1">
            {kind === 'driver' && <Bus size={8} className="flex-shrink-0" />}
            {getDisplayRole(person)}
          </p>
        </div>
      </div>
      <input value={draft.holder} onChange={e => onChange({ holder: e.target.value })} placeholder="Account holder" className={CELL} />
      <input value={draft.bankName} onChange={e => onChange({ bankName: e.target.value })} placeholder="Bank" className={CELL} />
      <input value={draft.account} onChange={e => onChange({ account: e.target.value })} placeholder="Account no." className={`${CELL} tabular-nums`} />
      <input value={draft.ifsc} onChange={e => onChange({ ifsc: e.target.value })} placeholder="IFSC" className={`${CELL} uppercase`} />
    </SheetRow>
  )
}
