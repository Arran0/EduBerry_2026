'use client'

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { Bus, HardHat, Landmark } from 'lucide-react'
import Avatar from '@/components/Avatar'
import {
  Sheet, SheetHead, SheetRow, SheetSkeleton, Note, Column, Deck, Notice, Fact, SX,
} from '@/components/salary/ui'
import RosterToolbar, { RosterKindFilter } from '@/components/salary/RosterToolbar'
import SaveBar from '@/components/salary/SaveBar'
import { useAutosave } from '@/components/salary/useAutosave'
import { UserProfile, getDisplayRole } from '@/lib/supabase'
import { StaffBankAccount, fetchEligibleStaff, fetchBankAccounts, fetchHiddenSalaryMemberIds, bulkUpsertRoster } from '@/lib/salary'
import { DriverBankAccount, fetchDrivers, fetchDriverBankAccounts } from '@/lib/bus'
import {
  SupportStaff, SupportStaffBankAccount,
  fetchSupportStaff, fetchSupportStaffBankAccounts,
} from '@/lib/supportStaff'

/**
 * Shared column template for the header and every row. Applied as an inline
 * style: Tailwind only emits CSS for class names it finds literally in the
 * source, so a `grid-cols-[...]` built by joining strings never gets
 * generated and the grid silently collapses to one stacked column.
 */
const COLS = [
  'minmax(170px,1.5fr)',  // person
  'minmax(140px,1.3fr)',  // account holder
  'minmax(116px,1fr)',    // bank
  'minmax(140px,1.2fr)',  // account number
  'minmax(108px,0.85fr)', // IFSC
].join(' ')

const COLUMNS: Column[] = [
  { label: 'Person', className: 'pl-[26px]' },
  { label: 'Account holder' },
  { label: 'Bank' },
  { label: 'Account number' },
  { label: 'IFSC' },
]

const CELL = SX.cell

type Kind = 'staff' | 'driver' | 'support'
type Account = StaffBankAccount | DriverBankAccount | SupportStaffBankAccount

/** Just enough to display a row and open its profile card — support staff have no profile at all. */
type EntryPerson = UserProfile | (SupportStaff & { avatar_url?: undefined })

interface Entry {
  key: string
  kind: Kind
  person: EntryPerson
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

const ID_COLUMN = { staff: 'staff_id', driver: 'driver_id', support: 'support_staff_id' } as const

/** A draft as the columns the bank-account tables store. */
function inputOf(d: Draft) {
  return {
    account_holder_name: d.holder.trim(),
    account_number: d.account.trim(),
    ifsc: d.ifsc.trim().toUpperCase(),
    bank_name: d.bankName.trim() || null,
  }
}

/** A row is only worth writing once the bank actually needs all three required fields. */
function isComplete(d: Draft): boolean {
  return d.holder.trim() !== '' && d.account.trim() !== '' && d.ifsc.trim() !== ''
}

type SortKey = 'name' | 'status'

export default function BankAccountsSection() {
  const [loading, setLoading] = useState(true)
  const [entries, setEntries] = useState<Entry[]>([])
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [search, setSearch] = useState('')
  const [kindFilter, setKindFilter] = useState<RosterKindFilter>('all')
  const [missingOnly, setMissingOnly] = useState(false)
  const [sort, setSort] = useState<SortKey>('name')
  const [desc, setDesc] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const [staff, staffAccounts, allDrivers, driverAccounts, allSupport, supportAccounts, hiddenIds] = await Promise.all([
      fetchEligibleStaff(), fetchBankAccounts(), fetchDrivers(), fetchDriverBankAccounts(),
      fetchSupportStaff(), fetchSupportStaffBankAccounts(), fetchHiddenSalaryMemberIds(),
    ])
    const hidden = new Set(hiddenIds)
    const drivers = allDrivers.filter(d => !hidden.has(d.id) && !d.is_banned)
    const support = allSupport.filter(s => !hidden.has(s.id) && s.is_active)
    const staffMap: Record<string, StaffBankAccount> = {}
    for (const a of staffAccounts) staffMap[a.staff_id] = a
    const driverMap: Record<string, DriverBankAccount> = {}
    for (const a of driverAccounts) driverMap[a.driver_id] = a
    const supportMap: Record<string, SupportStaffBankAccount> = {}
    for (const a of supportAccounts) supportMap[a.support_staff_id] = a

    const merged: Entry[] = [
      ...staff.map(person => ({ key: `staff-${person.id}`, kind: 'staff' as const, person, existing: staffMap[person.id] })),
      ...drivers.map(person => ({ key: `driver-${person.id}`, kind: 'driver' as const, person, existing: driverMap[person.id] })),
      ...support.map(person => ({ key: `support-${person.id}`, kind: 'support' as const, person, existing: supportMap[person.id] })),
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

  // One request per roster table for every complete edited row, then the
  // saved values become the rows' "existing" state in place.
  const flush = useCallback(async () => {
    const byKey = new Map(entries.map(e => [e.key, e]))
    const saved = new Map<string, ReturnType<typeof inputOf>>()
    const sent = new Map<string, Draft>()
    const rows: Record<Kind, Record<string, unknown>[]> = { staff: [], driver: [], support: [] }
    for (const key of savableKeys) {
      const entry = byKey.get(key)
      const d = drafts[key]
      if (!entry || !d) continue
      const input = inputOf(d)
      saved.set(key, input)
      sent.set(key, d)
      rows[entry.kind].push({ [ID_COLUMN[entry.kind]]: entry.person.id, ...input })
    }
    const results = await Promise.all([
      bulkUpsertRoster('staff_bank_accounts', 'staff_id', rows.staff),
      bulkUpsertRoster('driver_bank_accounts', 'driver_id', rows.driver),
      bulkUpsertRoster('support_staff_bank_accounts', 'support_staff_id', rows.support),
    ])
    const failed = results.find(r => !r.success)
    const ok: Record<Kind, boolean> = { staff: results[0].success, driver: results[1].success, support: results[2].success }
    const next = entries.map(e => {
      const input = saved.get(e.key)
      return input && ok[e.kind] ? { ...e, existing: { ...(e.existing ?? {}), ...input } as Account } : e
    })
    setEntries(next)
    setDrafts(prev => {
      const out = { ...prev }
      // A row typed into again while it saved keeps the newer typing.
      for (const e of next) {
        const was = sent.get(e.key)
        if (was && ok[e.kind] && out[e.key] && sameDraft(out[e.key], was)) out[e.key] = draftOf(e.existing)
      }
      return out
    })
    return failed ?? { success: true }
  }, [entries, drafts, savableKeys])

  const { state, error, saveNow } = useAutosave(savableKeys.length > 0, flush)

  const setDraft = (key: string, patch: Partial<Draft>) =>
    setDrafts(prev => ({ ...prev, [key]: { ...prev[key], ...patch } }))

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    const filtered = entries.filter(e => {
      if (q && !e.person.full_name.toLowerCase().includes(q)) return false
      if (kindFilter !== 'all' && e.kind !== kindFilter) return false
      if (missingOnly && e.existing) return false
      return true
    })
    const sorted = [...filtered].sort((a, b) => {
      if (sort === 'status') {
        const diff = (a.existing ? 0 : 1) - (b.existing ? 0 : 1)
        if (diff !== 0) return diff
      }
      return a.person.full_name.localeCompare(b.person.full_name)
    })
    return desc ? sorted.reverse() : sorted
  }, [entries, search, kindFilter, missingOnly, sort, desc])

  const kindCounts = useMemo(() => ({
    staff: entries.filter(e => e.kind === 'staff').length,
    driver: entries.filter(e => e.kind === 'driver').length,
    support: entries.filter(e => e.kind === 'support').length,
  }), [entries])

  const incomplete = dirtyKeys.length - savableKeys.length
  const onFile = entries.filter(e => e.existing).length

  return (
    <Deck title="Bank accounts" icon={Landmark}>
      <p className="px-1 pb-2 text-[12px] text-slate-500 leading-snug">
        {loading
          ? 'Where each salary is paid. Only admins can change these.'
          : `${onFile} of ${entries.length} on file · only admins can change these`}
      </p>

      {!loading && entries.length > 0 && (
        <RosterToolbar
          search={search} onSearchChange={setSearch}
          kind={kindFilter} onKindChange={setKindFilter} kindCounts={kindCounts}
          toggles={[
            { key: 'missing', label: 'No bank details', selected: missingOnly, onClick: () => setMissingOnly(v => !v) },
          ]}
          sortOptions={[{ key: 'name', label: 'Name' }, { key: 'status', label: 'On file' }]}
          sort={sort} onSortChange={setSort} desc={desc} onDescChange={setDesc}
          shown={visible.length} total={entries.length}
          right={<SaveBar dirtyCount={savableKeys.length} state={state} error={error} onSave={saveNow} />}
        />
      )}

      {incomplete > 0 && (
        <Notice tone="warn" className="mb-2.5">
          {incomplete} {incomplete === 1 ? 'row needs' : 'rows need'} a holder, account number and IFSC before {incomplete === 1 ? 'it saves' : 'they save'}.
        </Notice>
      )}

      <Sheet minWidth={780}>
        <SheetHead cols={COLS} columns={COLUMNS} className="hidden lg:flex" />
        {loading ? (
          <SheetSkeleton />
        ) : entries.length === 0 ? (
          <Note>No staff, driver or support staff accounts yet.</Note>
        ) : visible.length === 0 ? (
          <Note>No one matches the search and filters.</Note>
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
    </Deck>
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
  const role = kind === 'support' ? ((person as SupportStaff).designation || 'Support staff') : getDisplayRole(person as UserProfile)

  const who = (size: number) => (
    <div className="flex items-center gap-2 min-w-0">
      <Avatar avatarUrl={person.avatar_url} name={person.full_name} size={size} userId={kind === 'support' ? undefined : person.id} />
      <div className="min-w-0 flex-1 leading-tight">
        <p className="font-semibold text-slate-900 text-[13px] break-words">{person.full_name}</p>
        <p className="text-[11.5px] text-slate-500 break-words flex items-center gap-1">
          {kind === 'driver' && <Bus size={11} className="flex-shrink-0" />}
          {kind === 'support' && <HardHat size={11} className="flex-shrink-0" />}
          {role}
        </p>
      </div>
    </div>
  )

  const holder = <input value={draft.holder} onChange={e => onChange({ holder: e.target.value })} placeholder="Name on the account" aria-label="Account holder" className={CELL} />
  const bankName = <input value={draft.bankName} onChange={e => onChange({ bankName: e.target.value })} placeholder="Bank" aria-label="Bank" className={CELL} />
  const account = <input value={draft.account} inputMode="numeric" onChange={e => onChange({ account: e.target.value })} placeholder="Account number" aria-label="Account number" className={`${CELL} tabular-nums`} />
  const ifsc = <input value={draft.ifsc} onChange={e => onChange({ ifsc: e.target.value })} placeholder="IFSC" aria-label="IFSC" className={`${CELL} uppercase`} />

  return (
    <>
      {/* Phone and tablet: one card per person, every field labelled. */}
      <div className="lg:hidden relative px-3.5 py-3 border-b border-[#F0ECE3] last:border-b-0">
        <span className="absolute left-0 top-0 bottom-0 w-[3px]" style={{ background: accent }} />
        {who(30)}
        <div className="grid grid-cols-1 min-[420px]:grid-cols-2 gap-x-3 gap-y-2.5 mt-3">
          <Fact label="Account holder">{holder}</Fact>
          <Fact label="Bank">{bankName}</Fact>
          <Fact label="Account number">{account}</Fact>
          <Fact label="IFSC">{ifsc}</Fact>
        </div>
      </div>

      {/* Desktop: the sheet. The edge bar doubles as the unsaved marker. */}
      <SheetRow cols={COLS} accent={accent} className="hidden lg:flex">
        {who(24)}
        {holder}
        {bankName}
        {account}
        {ifsc}
      </SheetRow>
    </>
  )
}
