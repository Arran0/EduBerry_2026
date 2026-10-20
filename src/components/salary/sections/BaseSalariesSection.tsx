'use client'

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { Bus, HardHat, Wallet } from 'lucide-react'
import Avatar from '@/components/Avatar'
import {
  Sheet, SheetHead, SheetRow, SheetSkeleton, Note, Column, Deck, Notice, Fact, Switch, SX,
} from '@/components/salary/ui'
import RosterToolbar, { RosterKindFilter } from '@/components/salary/RosterToolbar'
import SaveBar from '@/components/salary/SaveBar'
import { useAutosave } from '@/components/salary/useAutosave'
import { UserProfile, getDisplayRole } from '@/lib/supabase'
import { StaffSalaryBase, fetchEligibleStaff, fetchBaseSalaries, fetchHiddenSalaryMemberIds, bulkUpsertRoster } from '@/lib/salary'
import { DriverSalaryBase, fetchEligibleDrivers, fetchDriverBaseSalaries } from '@/lib/driverSalary'
import {
  SupportStaff, SupportStaffSalaryBase,
  fetchSupportStaff, fetchSupportStaffSalaryBases,
} from '@/lib/supportStaff'

/**
 * Shared column template for the header and every row. Applied as an inline
 * style: Tailwind only emits CSS for class names it finds literally in the
 * source, so a `grid-cols-[...]` built by joining strings never gets
 * generated and the grid silently collapses to one stacked column.
 */
const COLS = [
  'minmax(170px,1.8fr)',  // person (avatar + name + role)
  'minmax(96px,1fr)',     // monthly base
  'minmax(96px,1fr)',     // PF basic
  'minmax(34px,0.32fr)',  // PF applicable
  'minmax(38px,0.34fr)',  // EPS applicable
  'minmax(84px,0.8fr)',   // ESI mode
  'minmax(118px,1.1fr)',  // UAN
  'minmax(108px,1fr)',    // ESI IP number
  'minmax(46px,0.42fr)',  // active
].join(' ')

const COLUMNS: Column[] = [
  { label: 'Person', className: 'pl-[26px]' },
  { label: 'Base', align: 'right' },
  { label: 'PF basic', align: 'right' },
  { label: 'PF', align: 'center' },
  { label: 'EPS', align: 'center' },
  { label: 'ESI', align: 'left' },
  { label: 'UAN' },
  { label: 'ESI IP no.' },
  { label: 'Paid', align: 'center' },
]

const CELL = SX.cell
const FLAG = '!border-[#C0392B] ring-1 ring-[#C0392B]/30 placeholder:text-[#C0392B]'

type Kind = 'staff' | 'driver' | 'support'
type Base = StaffSalaryBase | DriverSalaryBase | SupportStaffSalaryBase
type EsiChoice = 'auto' | 'on' | 'off'

/** Just enough to display a row and open its profile card — support staff have no profile at all. */
type EntryPerson = UserProfile | (SupportStaff & { avatar_url?: undefined })

interface Entry {
  key: string
  kind: Kind
  person: EntryPerson
  existing?: Base
}

/** The editable shape of one row, kept as strings so partly-typed input survives. */
interface Draft {
  amount: string
  pfBasic: string
  pfApplicable: boolean
  epsApplicable: boolean
  esiChoice: EsiChoice
  uan: string
  ipNumber: string
  active: boolean
}

const ID_COLUMN = { staff: 'staff_id', driver: 'driver_id', support: 'support_staff_id' } as const

/** A draft as the columns the base-salary tables store. */
function inputOf(d: Draft) {
  return {
    base_amount: parseFloat(d.amount) || 0,
    pf_basic: d.pfBasic.trim() === '' ? null : parseFloat(d.pfBasic) || 0,
    pf_applicable: d.pfApplicable,
    eps_applicable: d.epsApplicable,
    esi_override: esiValueOf(d.esiChoice),
    uan: d.uan.trim() === '' ? null : d.uan.trim(),
    esi_ip_number: d.ipNumber.trim() === '' ? null : d.ipNumber.trim(),
    active: d.active,
  }
}

function esiChoiceOf(v: boolean | null | undefined): EsiChoice {
  return v === true ? 'on' : v === false ? 'off' : 'auto'
}
function esiValueOf(c: EsiChoice): boolean | null {
  return c === 'on' ? true : c === 'off' ? false : null
}

function draftOf(existing?: Base): Draft {
  return {
    amount: existing ? String(existing.base_amount) : '',
    pfBasic: existing?.pf_basic != null ? String(existing.pf_basic) : '',
    pfApplicable: existing?.pf_applicable ?? false,
    epsApplicable: existing?.eps_applicable ?? true,
    esiChoice: esiChoiceOf(existing?.esi_override),
    uan: existing?.uan ?? '',
    ipNumber: existing?.esi_ip_number ?? '',
    active: existing?.active ?? true,
  }
}

function sameDraft(a: Draft, b: Draft): boolean {
  return a.amount === b.amount && a.pfBasic === b.pfBasic
    && a.pfApplicable === b.pfApplicable && a.epsApplicable === b.epsApplicable
    && a.esiChoice === b.esiChoice && a.uan === b.uan && a.ipNumber === b.ipNumber
    && a.active === b.active
}

/** Portal identifiers are typed off a printout — keep the digits, drop the rest. */
function digits(v: string): string {
  return v.replace(/\D+/g, '')
}

type SortKey = 'name' | 'base'

export default function BaseSalariesSection() {
  const [loading, setLoading] = useState(true)
  const [entries, setEntries] = useState<Entry[]>([])
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [search, setSearch] = useState('')
  const [kindFilter, setKindFilter] = useState<RosterKindFilter>('all')
  const [offPayrollOnly, setOffPayrollOnly] = useState(false)
  const [missingPfBasicOnly, setMissingPfBasicOnly] = useState(false)
  const [missingUanOnly, setMissingUanOnly] = useState(false)
  const [sort, setSort] = useState<SortKey>('name')
  const [desc, setDesc] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const [staff, staffBases, allDrivers, driverBases, allSupport, supportBases, hiddenIds] = await Promise.all([
      fetchEligibleStaff(), fetchBaseSalaries(), fetchEligibleDrivers(), fetchDriverBaseSalaries(),
      fetchSupportStaff(), fetchSupportStaffSalaryBases(), fetchHiddenSalaryMemberIds(),
    ])
    const hidden = new Set(hiddenIds)
    const drivers = allDrivers.filter(d => !hidden.has(d.id) && !d.is_banned)
    const support = allSupport.filter(s => !hidden.has(s.id) && s.is_active)
    const staffMap: Record<string, StaffSalaryBase> = {}
    for (const b of staffBases) staffMap[b.staff_id] = b
    const driverMap: Record<string, DriverSalaryBase> = {}
    for (const b of driverBases) driverMap[b.driver_id] = b
    const supportMap: Record<string, SupportStaffSalaryBase> = {}
    for (const b of supportBases) supportMap[b.support_staff_id] = b

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

  // One request per roster table for everything edited, then the saved values
  // become the rows' "existing" state in place — no reload of the whole sheet.
  const flush = useCallback(async () => {
    const byKey = new Map(entries.map(e => [e.key, e]))
    const saved = new Map<string, ReturnType<typeof inputOf>>()
    const sent = new Map<string, Draft>()
    const rows: Record<Kind, Record<string, unknown>[]> = { staff: [], driver: [], support: [] }
    for (const key of dirtyKeys) {
      const entry = byKey.get(key)
      const d = drafts[key]
      if (!entry || !d) continue
      const input = inputOf(d)
      saved.set(key, input)
      sent.set(key, d)
      rows[entry.kind].push({ [ID_COLUMN[entry.kind]]: entry.person.id, ...input })
    }
    const results = await Promise.all([
      bulkUpsertRoster('staff_salary_base', 'staff_id', rows.staff),
      bulkUpsertRoster('driver_payroll_base', 'driver_id', rows.driver),
      bulkUpsertRoster('support_staff_salary_base', 'support_staff_id', rows.support),
    ])
    const failed = results.find(r => !r.success)
    // A failed table keeps its rows dirty (the drafts are untouched), so the
    // next save retries them; the tables that did save are folded in now.
    const ok: Record<Kind, boolean> = { staff: results[0].success, driver: results[1].success, support: results[2].success }
    const next = entries.map(e => {
      const input = saved.get(e.key)
      return input && ok[e.kind] ? { ...e, existing: { ...(e.existing ?? {}), ...input } as Base } : e
    })
    setEntries(next)
    setDrafts(prev => {
      const out = { ...prev }
      // A row typed into again while it saved keeps the newer typing, and
      // stays dirty for the next save.
      for (const e of next) {
        const was = sent.get(e.key)
        if (was && ok[e.kind] && out[e.key] && sameDraft(out[e.key], was)) out[e.key] = draftOf(e.existing)
      }
      return out
    })
    return failed ?? { success: true }
  }, [entries, drafts, dirtyKeys])

  const { state, error, saveNow } = useAutosave(dirtyKeys.length > 0, flush)

  const setDraft = (key: string, patch: Partial<Draft>) =>
    setDrafts(prev => ({ ...prev, [key]: { ...prev[key], ...patch } }))

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    const filtered = entries.filter(e => {
      if (q && !e.person.full_name.toLowerCase().includes(q)) return false
      if (kindFilter !== 'all' && e.kind !== kindFilter) return false
      const d = drafts[e.key]
      if (!d) return true
      const onPayroll = d.active && (parseFloat(d.amount) || 0) > 0
      if (offPayrollOnly && onPayroll) return false
      if (missingPfBasicOnly && !(d.pfApplicable && !((parseFloat(d.pfBasic) || 0) > 0))) return false
      if (missingUanOnly && !(d.pfApplicable && d.uan.length !== 12)) return false
      return true
    })
    const sorted = [...filtered].sort((a, b) => {
      if (sort === 'base') {
        const diff = (parseFloat(drafts[a.key]?.amount ?? '') || 0) - (parseFloat(drafts[b.key]?.amount ?? '') || 0)
        if (diff !== 0) return diff
      }
      return a.person.full_name.localeCompare(b.person.full_name)
    })
    return desc ? sorted.reverse() : sorted
  }, [entries, drafts, search, kindFilter, offPayrollOnly, missingPfBasicOnly, missingUanOnly, sort, desc])

  const kindCounts = useMemo(() => ({
    staff: entries.filter(e => e.kind === 'staff').length,
    driver: entries.filter(e => e.kind === 'driver').length,
    support: entries.filter(e => e.kind === 'support').length,
  }), [entries])

  // Ticking PF on without a PF Basic wage computes a silent ₹0; a PF member
  // with no UAN drops out of the monthly EPF return without the return itself
  // looking wrong. Both are flagged per row below, and counted here too since
  // they are easy to miss on a long sheet.
  const warnings = useMemo(() => {
    let pfBasicMissing = 0, uanMissing = 0, onPayroll = 0
    for (const e of entries) {
      const d = drafts[e.key]
      if (!d) continue
      if (d.active && (parseFloat(d.amount) || 0) > 0) onPayroll += 1
      if (d.pfApplicable && !((parseFloat(d.pfBasic) || 0) > 0)) pfBasicMissing += 1
      if (d.pfApplicable && d.uan.length !== 12) uanMissing += 1
    }
    return { pfBasicMissing, uanMissing, onPayroll }
  }, [entries, drafts])

  return (
    <Deck title="Base salaries" icon={Wallet}>
      <p className="px-1 pb-2 text-[12px] text-slate-500 leading-snug">
        {loading
          ? 'What each person is paid a month. A new cycle starts from these.'
          : `${warnings.onPayroll} of ${entries.length} on payroll · a new cycle starts from these`}
      </p>

      {!loading && entries.length > 0 && (
        <RosterToolbar
          search={search} onSearchChange={setSearch}
          kind={kindFilter} onKindChange={setKindFilter} kindCounts={kindCounts}
          toggles={[
            { key: 'offPayroll', label: 'Off payroll', selected: offPayrollOnly, onClick: () => setOffPayrollOnly(v => !v) },
            { key: 'pfBasic', label: 'No PF Basic wage', selected: missingPfBasicOnly, onClick: () => setMissingPfBasicOnly(v => !v) },
            { key: 'uan', label: 'No UAN', selected: missingUanOnly, onClick: () => setMissingUanOnly(v => !v) },
          ]}
          sortOptions={[{ key: 'name', label: 'Name' }, { key: 'base', label: 'Base salary' }]}
          sort={sort} onSortChange={setSort} desc={desc} onDescChange={setDesc}
          shown={visible.length} total={entries.length}
          right={<SaveBar dirtyCount={dirtyKeys.length} state={state} error={error} onSave={saveNow} />}
        />
      )}

      {!loading && (warnings.pfBasicMissing > 0 || warnings.uanMissing > 0) && (
        <Notice tone="error" className="mb-2.5">
          {warnings.pfBasicMissing > 0 && (
            <p>{warnings.pfBasicMissing} with PF on have no PF Basic wage, so their PF comes to ₹0.</p>
          )}
          {warnings.uanMissing > 0 && (
            <p>{warnings.uanMissing} PF members have no 12-digit UAN and will be left out of the EPF return.</p>
          )}
        </Notice>
      )}

      <Sheet minWidth={940}>
        <SheetHead cols={COLS} columns={COLUMNS} className="hidden lg:flex" />
        {loading ? (
          <SheetSkeleton />
        ) : entries.length === 0 ? (
          <Note>No staff, driver or support staff accounts yet.</Note>
        ) : visible.length === 0 ? (
          <Note>No one matches the search and filters.</Note>
        ) : visible.map(e => (
          <BaseRow
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

function BaseRow({ entry, draft, dirty, onChange }: {
  entry: Entry
  draft: Draft
  dirty: boolean
  onChange: (patch: Partial<Draft>) => void
}) {
  const { kind, person, existing } = entry
  // PF needs both a PF Basic wage and the tick — either one without the other
  // quietly computes to zero, which is easy to do and hard to spot on a dense
  // sheet. Both halves of that mismatch get flagged, right on the field that's
  // missing, since a mismatch found only on hover past the checkbox is a
  // mismatch most people never see.
  const pfBasicSet = (parseFloat(draft.pfBasic) || 0) > 0
  const pfUnticked = !draft.pfApplicable && pfBasicSet
  const pfBasicMissing = draft.pfApplicable && !pfBasicSet

  // A scheme someone is enrolled in but has no identifier for is a member the
  // monthly return will silently leave out, so it gets flagged here rather
  // than at filing time. Only an explicit enrolment is nagged about: "Auto"
  // ESI is decided per cycle by the wage ceiling, and reddening every such row
  // on a sheet where nobody is under ESI would be noise. A half-typed number
  // is always flagged, whatever the scheme says.
  const uanMissing = draft.pfApplicable && draft.uan === ''
  const uanBad = (draft.pfApplicable || draft.uan !== '') && draft.uan.length !== 12
  const ipMissing = draft.esiChoice === 'on' && draft.ipNumber === ''
  const ipBad = (draft.esiChoice === 'on' || draft.ipNumber !== '') && draft.ipNumber.length !== 10

  const accent = dirty ? '#8A6D1F' : draft.active && existing ? '#B8983C' : 'transparent'
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

  const pfTitle = pfUnticked
    ? 'PF Basic is set but PF is off, so no PF will be deducted. Tick to apply it.'
    : 'PF applicable'
  const epsTitle = draft.pfApplicable
    ? 'In the Employees Pension Scheme: 8.33% of the employer share is filed under EPS. Untick for members outside the pension scheme.'
    : 'Only applies once PF is on'
  const pfBasicTitle = pfBasicMissing
    ? 'PF is on but no PF Basic wage is set, so PF comes to ₹0. Enter the wage PF is worked out on.'
    : 'PF Basic wage (PF is worked out on this, not gross pay)'
  const uanTitle = uanMissing
    ? 'PF is on but there is no UAN. This person cannot go in the EPF return until one is entered.'
    : 'EPFO Universal Account Number (12 digits)'
  const ipTitle = ipMissing
    ? 'ESI applies but there is no IP number. This person cannot go in the ESI return until one is entered.'
    : 'ESIC Insured Person number (10 digits)'

  const esiSelect = (
    <select value={draft.esiChoice} onChange={e => onChange({ esiChoice: e.target.value as EsiChoice })}
      title="ESI applicability" className={`${CELL} cursor-pointer`}>
      <option value="auto">Auto</option>
      <option value="on">Always</option>
      <option value="off">Never</option>
    </select>
  )
  const uanInput = (
    <input
      inputMode="numeric" maxLength={12} value={draft.uan}
      onChange={e => onChange({ uan: digits(e.target.value).slice(0, 12) })}
      placeholder={uanMissing ? 'Needed' : '12 digits'} title={uanTitle}
      className={`${CELL} ${uanBad ? FLAG : ''}`} />
  )
  const ipInput = (
    <input
      inputMode="numeric" maxLength={10} value={draft.ipNumber}
      onChange={e => onChange({ ipNumber: digits(e.target.value).slice(0, 10) })}
      placeholder={ipMissing ? 'Needed' : '10 digits'} title={ipTitle}
      className={`${CELL} ${ipBad ? FLAG : ''}`} />
  )

  return (
    <>
      {/* Phone and tablet: one card per person, every field labelled. */}
      <div className="lg:hidden relative px-3.5 py-3 border-b border-[#F0ECE3] last:border-b-0">
        <span className="absolute left-0 top-0 bottom-0 w-[3px]" style={{ background: accent }} />
        <div className="flex items-start justify-between gap-3">
          {who(30)}
          <label className="flex items-center gap-2 flex-shrink-0 pt-0.5">
            <span className="text-[12px] text-slate-500">Paid</span>
            <Switch checked={draft.active} onChange={v => onChange({ active: v })} label={`Include ${person.full_name} in pay cycles`} />
          </label>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-3 gap-y-2.5 mt-3">
          <Fact label="Monthly base">
            <Money value={draft.amount} onChange={v => onChange({ amount: v })} title="Monthly base salary" />
          </Fact>
          <Fact label="PF Basic wage">
            <Money value={draft.pfBasic} onChange={v => onChange({ pfBasic: v })}
              placeholder={pfBasicMissing ? 'Needed' : '0'} flagged={pfBasicMissing} title={pfBasicTitle} />
          </Fact>
          <Fact label="ESI">{esiSelect}</Fact>
          <Fact label="UAN">{uanInput}</Fact>
          <Fact label="ESI IP number">{ipInput}</Fact>
          <Fact label="Schemes">
            <div className="flex flex-wrap gap-1.5">
              <ToggleChip on={draft.pfApplicable} flagged={pfUnticked} title={pfTitle}
                onClick={() => onChange({ pfApplicable: !draft.pfApplicable })}>PF</ToggleChip>
              <ToggleChip on={draft.epsApplicable} disabled={!draft.pfApplicable} title={epsTitle}
                onClick={() => onChange({ epsApplicable: !draft.epsApplicable })}>EPS</ToggleChip>
            </div>
          </Fact>
        </div>
      </div>

      {/* Desktop: the sheet. */}
      <SheetRow cols={COLS} accent={accent} className="hidden lg:flex">
        {who(24)}

        <Money value={draft.amount} onChange={v => onChange({ amount: v })} title="Monthly base salary" />

        <Money
          value={draft.pfBasic}
          onChange={v => onChange({ pfBasic: v })}
          placeholder={pfBasicMissing ? 'Needed' : '0'}
          flagged={pfBasicMissing}
          title={pfBasicTitle}
        />

        <label
          className={`flex items-center justify-center cursor-pointer select-none h-8 rounded-[8px] ${pfUnticked ? 'ring-1 ring-[#B8983C]' : ''}`}
          title={pfTitle}
        >
          <input type="checkbox" checked={draft.pfApplicable} onChange={e => onChange({ pfApplicable: e.target.checked })}
            aria-label={`PF for ${person.full_name}`} className={SX.check} />
        </label>

        <label className="flex items-center justify-center cursor-pointer select-none" title={epsTitle}>
          <input type="checkbox" checked={draft.epsApplicable} disabled={!draft.pfApplicable}
            onChange={e => onChange({ epsApplicable: e.target.checked })}
            aria-label={`EPS for ${person.full_name}`} className={SX.check} />
        </label>

        {esiSelect}

        {/* The two portal identifiers. Without them the member simply cannot be
            filed for, so the field is flagged as soon as the scheme is on. */}
        {uanInput}
        {ipInput}

        <label className="flex items-center justify-center cursor-pointer select-none" title="Include in pay cycles">
          <input type="checkbox" checked={draft.active} onChange={e => onChange({ active: e.target.checked })}
            aria-label={`Include ${person.full_name} in pay cycles`} className={SX.check} />
        </label>
      </SheetRow>
    </>
  )
}

/** An on/off capsule for a scheme in the phone card. */
function ToggleChip({ on, onClick, disabled, flagged, title, children }: {
  on: boolean
  onClick: () => void
  disabled?: boolean
  flagged?: boolean
  title?: string
  children: React.ReactNode
}) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={onClick} disabled={disabled} title={title}
      className={`${SX.choice(on)} !h-8 disabled:opacity-40 ${flagged ? 'ring-2 ring-[#B8983C]' : ''}`}>
      {children}
    </button>
  )
}

/** A rupee field: the symbol sits inside the box so the digits stay right-aligned. */
function Money({ value, onChange, placeholder = '0', title, flagged }: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  title?: string
  flagged?: boolean
}) {
  return (
    <div className="relative min-w-0">
      <span className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 text-[12px] pointer-events-none">₹</span>
      <input
        type="number" inputMode="decimal" min="0" step="0.01" value={value} onChange={e => onChange(e.target.value)}
        placeholder={placeholder} title={title}
        className={`${CELL} pl-5 text-right ${flagged ? FLAG : ''}`} />
    </div>
  )
}
