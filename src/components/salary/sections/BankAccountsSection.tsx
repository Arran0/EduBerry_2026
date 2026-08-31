'use client'

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { Info, Bus } from 'lucide-react'
import Avatar from '@/components/Avatar'
import { ADMIN } from '@/components/salary/adminUi'
import { Sheet, SHEET, SheetRowSkeleton } from '@/components/bus/adminUI'
import PersonSearch from '@/components/salary/PersonSearch'
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
const GRID = 'grid items-center gap-x-2'
const GRID_COLS = [
  'minmax(180px,1.6fr)',  // person
  'minmax(150px,1.3fr)',  // account holder
  'minmax(130px,1.1fr)',  // bank
  'minmax(150px,1.3fr)',  // account number
  'minmax(104px,0.9fr)',  // IFSC
].join(' ')

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
    const drivers = allDrivers.filter(d => !hidden.has(d.id))
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

  return (
    <>
      <div className="flex items-center gap-2 mb-3">
        <h2 className={ADMIN.label}>Bank accounts</h2>
        <Info size={11} className="text-[#B8983C]" />
        <span className="text-[10px] text-[#A1A1AA]">admin-managed · staff &amp; drivers</span>
      </div>

      {!loading && entries.length > 0 && (
        <div className="flex items-start justify-between gap-3">
          <PersonSearch value={search} onChange={setSearch} placeholder="Search staff or drivers…" />
          <div className="flex flex-col items-end">
            <SaveBar dirtyCount={savableKeys.length} state={state} error={error} onSave={saveNow} />
            {incomplete > 0 && (
              <span className="text-[10px] text-[#A1A1AA] mt-0.5">
                {incomplete} row{incomplete === 1 ? '' : 's'} need holder, account no. &amp; IFSC
              </span>
            )}
          </div>
        </div>
      )}

      {loading ? (
        <Sheet>
          {Array.from({ length: 5 }, (_, i) => <SheetRowSkeleton key={i} />)}
        </Sheet>
      ) : entries.length === 0 ? (
        <div className={`${ADMIN.card} shadow-sm p-6 text-center text-sm text-[#71717A]`}>
          No staff or driver accounts yet.
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
                </div>
              </div>

              {visible.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-[#A1A1AA]">No one matches &quot;{search}&quot;.</div>
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
          </div>
        </div>
      )}
    </>
  )
}

const cellCls = 'bg-white border border-[#E4E4E7] rounded-md px-2 py-1 text-[11px] text-[#27272A] placeholder:text-[#A1A1AA] focus:outline-none focus:border-[#27272A] transition-colors'

function BankRow({ entry, draft, dirty, onChange }: {
  entry: Entry
  draft: Draft
  dirty: boolean
  onChange: (patch: Partial<Draft>) => void
}) {
  const { kind, person, existing } = entry
  return (
    <div className={SHEET.row}>
      {/* The bar doubles as the unsaved marker, so a pending row is obvious without a per-row control. */}
      <div className={`${SHEET.bar} ${dirty ? 'bg-[#8A6D1F]' : existing ? 'bg-[#B8983C]' : 'bg-transparent'}`} />
      <div className="flex-1 min-w-0 px-3 py-1.5">
        <div className={GRID} style={{ gridTemplateColumns: GRID_COLS }}>
          <div className="flex items-center gap-2 min-w-0">
            <Avatar avatarUrl={person.avatar_url} name={person.full_name} size={22} userId={person.id} />
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-[#18181B] text-xs truncate">{person.full_name}</p>
              <p className="text-[10px] text-[#A1A1AA] truncate flex items-center gap-1">
                {kind === 'driver' && <Bus size={9} className="flex-shrink-0" />}
                {getDisplayRole(person)}
              </p>
            </div>
          </div>
          <input value={draft.holder} onChange={e => onChange({ holder: e.target.value })} placeholder="Account holder" className={`${cellCls} w-full`} />
          <input value={draft.bankName} onChange={e => onChange({ bankName: e.target.value })} placeholder="Bank" className={`${cellCls} w-full`} />
          <input value={draft.account} onChange={e => onChange({ account: e.target.value })} placeholder="Account number" className={`${cellCls} w-full tabular-nums`} />
          <input value={draft.ifsc} onChange={e => onChange({ ifsc: e.target.value })} placeholder="IFSC" className={`${cellCls} w-full uppercase`} />
        </div>
      </div>
    </div>
  )
}
