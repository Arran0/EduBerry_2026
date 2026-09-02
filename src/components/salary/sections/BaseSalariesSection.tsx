'use client'

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { Bus, HardHat } from 'lucide-react'
import Avatar from '@/components/Avatar'
import {
  Sheet, SheetHead, SheetRow, SheetSkeleton, SearchField, SectionBar, Note, Column,
} from '@/components/salary/ui'
import SaveBar from '@/components/salary/SaveBar'
import { useAutosave } from '@/components/salary/useAutosave'
import { UserProfile, getDisplayRole } from '@/lib/supabase'
import { StaffSalaryBase, fetchEligibleStaff, fetchBaseSalaries, fetchHiddenSalaryMemberIds, upsertBaseSalary } from '@/lib/salary'
import { DriverSalaryBase, fetchEligibleDrivers, fetchDriverBaseSalaries, upsertDriverBaseSalary } from '@/lib/driverSalary'
import {
  SupportStaff, SupportStaffSalaryBase,
  fetchSupportStaff, fetchSupportStaffSalaryBases, upsertSupportStaffSalaryBase,
} from '@/lib/supportStaff'

/**
 * Shared column template for the header and every row. Applied as an inline
 * style: Tailwind only emits CSS for class names it finds literally in the
 * source, so a `grid-cols-[...]` built by joining strings never gets
 * generated and the grid silently collapses to one stacked column.
 */
const COLS = [
  'minmax(150px,1.8fr)',  // person (avatar + name + role)
  'minmax(88px,1fr)',     // monthly base
  'minmax(88px,1fr)',     // PF basic
  'minmax(30px,0.32fr)',  // PF applicable
  'minmax(34px,0.34fr)',  // EPS applicable
  'minmax(72px,0.8fr)',   // ESI mode
  'minmax(104px,1.1fr)',  // UAN
  'minmax(96px,1fr)',     // ESI IP number
  'minmax(42px,0.42fr)',  // active
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
  { label: 'Live', align: 'center' },
]

const CELL = 'w-full bg-white border border-[#E3DFD3] px-1.5 py-[3px] text-[11px] leading-[1.4] tabular-nums text-[#27272A] placeholder:text-[#B5B0A1] focus:outline-none focus:border-[#27272A] transition-colors'
const FLAG = 'ring-1 ring-[#C0392B] border-[#C0392B] placeholder:text-[#C0392B]'

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

export default function BaseSalariesSection() {
  const [loading, setLoading] = useState(true)
  const [entries, setEntries] = useState<Entry[]>([])
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [search, setSearch] = useState('')

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

  const flush = useCallback(async () => {
    const byKey = new Map(entries.map(e => [e.key, e]))
    for (const key of dirtyKeys) {
      const entry = byKey.get(key)
      const d = drafts[key]
      if (!entry || !d) continue
      const input = {
        base_amount: parseFloat(d.amount) || 0,
        pf_basic: d.pfBasic.trim() === '' ? null : parseFloat(d.pfBasic) || 0,
        pf_applicable: d.pfApplicable,
        eps_applicable: d.epsApplicable,
        esi_override: esiValueOf(d.esiChoice),
        uan: d.uan.trim() === '' ? null : d.uan.trim(),
        esi_ip_number: d.ipNumber.trim() === '' ? null : d.ipNumber.trim(),
        active: d.active,
      }
      const res = entry.kind === 'staff'
        ? await upsertBaseSalary({ staff_id: entry.person.id, ...input })
        : entry.kind === 'driver'
          ? await upsertDriverBaseSalary({ driver_id: entry.person.id, ...input })
          : await upsertSupportStaffSalaryBase({ support_staff_id: entry.person.id, ...input })
      if (!res.success) return res
    }
    await load()
    return { success: true }
  }, [entries, drafts, dirtyKeys, load])

  const { state, error, saveNow } = useAutosave(dirtyKeys.length > 0, flush)

  const setDraft = (key: string, patch: Partial<Draft>) =>
    setDrafts(prev => ({ ...prev, [key]: { ...prev[key], ...patch } }))

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return entries
    return entries.filter(e => e.person.full_name.toLowerCase().includes(q))
  }, [entries, search])

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
    <>
      <SectionBar
        title="Base salaries"
        hint={loading
          ? 'Used when running a monthly cycle · staff, drivers & support staff'
          : `${warnings.onPayroll} of ${entries.length} on payroll · used when running a cycle`}
      />

      {!loading && entries.length > 0 && (
        <div className="flex items-center gap-2 mb-2">
          <SearchField value={search} onChange={setSearch} placeholder="Search people…" className="sm:max-w-[16rem]" />
          <SaveBar dirtyCount={dirtyKeys.length} state={state} error={error} onSave={saveNow} />
        </div>
      )}

      {!loading && (warnings.pfBasicMissing > 0 || warnings.uanMissing > 0) && (
        <ul className="text-[10.5px] text-[#A93232] mb-2 space-y-0.5">
          {warnings.pfBasicMissing > 0 && (
            <li>{warnings.pfBasicMissing} with PF on have no PF Basic wage — their PF computes to ₹0.</li>
          )}
          {warnings.uanMissing > 0 && (
            <li>{warnings.uanMissing} PF members have no valid 12-digit UAN — the EPF return leaves them out.</li>
          )}
        </ul>
      )}

      <Sheet minWidth={880}>
        {/* The header scrolls sideways with the rows it labels, so it stays on
            phones too — nine unlabelled PF/ESI columns are unreadable without it. */}
        <SheetHead cols={COLS} columns={COLUMNS} />
        {loading ? (
          <SheetSkeleton />
        ) : entries.length === 0 ? (
          <Note>No staff, driver or support staff accounts yet.</Note>
        ) : visible.length === 0 ? (
          <Note>No one matches &quot;{search}&quot;.</Note>
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
    </>
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

  return (
    <SheetRow cols={COLS} accent={accent}>
      <div className="flex items-center gap-1.5 min-w-0">
        <Avatar avatarUrl={person.avatar_url} name={person.full_name} size={20} userId={kind === 'support' ? undefined : person.id} />
        <div className="min-w-0 flex-1 leading-tight">
          <p className="font-semibold text-[#18181B] text-[11.5px] truncate">{person.full_name}</p>
          <p className="text-[9.5px] text-[#A8A395] truncate flex items-center gap-1">
            {kind === 'driver' && <Bus size={8} className="flex-shrink-0" />}
            {kind === 'support' && <HardHat size={8} className="flex-shrink-0" />}
            {kind === 'support' ? ((person as SupportStaff).designation || 'Support Staff') : getDisplayRole(person as UserProfile)}
          </p>
        </div>
      </div>

      <Money value={draft.amount} onChange={v => onChange({ amount: v })} title="Monthly base salary" />

      <Money
        value={draft.pfBasic}
        onChange={v => onChange({ pfBasic: v })}
        placeholder={pfBasicMissing ? 'Needed' : '0.00'}
        flagged={pfBasicMissing}
        title={pfBasicMissing
          ? 'PF is on but no PF Basic wage is set, so PF will compute to ₹0 — enter the wage PF is calculated on'
          : 'PF Basic wage (used for PF, not gross salary)'}
      />

      <label
        className={`flex items-center justify-center cursor-pointer select-none h-full ${pfUnticked ? 'ring-1 ring-[#B8983C]' : ''}`}
        title={pfUnticked
          ? 'PF Basic is set but PF is off, so no PF will be deducted — tick to apply it'
          : 'PF applicable'}
      >
        <input type="checkbox" checked={draft.pfApplicable} onChange={e => onChange({ pfApplicable: e.target.checked })}
          className="w-3 h-3 accent-[#27272A]" />
      </label>

      <label
        className="flex items-center justify-center cursor-pointer select-none"
        title={draft.pfApplicable
          ? 'In the Employees Pension Scheme — 8.33% of the employer share is filed under EPS. Untick for members excluded from the pension scheme, whose whole employer share goes to EPF.'
          : 'Only applies once PF is switched on'}
      >
        <input type="checkbox" checked={draft.epsApplicable} disabled={!draft.pfApplicable}
          onChange={e => onChange({ epsApplicable: e.target.checked })}
          className="w-3 h-3 accent-[#27272A] disabled:opacity-30" />
      </label>

      <select value={draft.esiChoice} onChange={e => onChange({ esiChoice: e.target.value as EsiChoice })}
        title="ESI applicability" className={CELL}>
        <option value="auto">Auto</option>
        <option value="on">Always</option>
        <option value="off">Never</option>
      </select>

      {/* The two portal identifiers. Without them the member simply cannot be
          filed for, so the field is flagged as soon as the scheme is on. */}
      <input
        inputMode="numeric" maxLength={12} value={draft.uan}
        onChange={e => onChange({ uan: digits(e.target.value).slice(0, 12) })}
        placeholder={uanMissing ? 'Needed' : '12 digits'}
        title={uanMissing
          ? 'PF is on but no UAN is set — this member cannot be included in the EPF return until one is entered'
          : 'EPFO Universal Account Number (12 digits)'}
        className={`${CELL} ${uanBad ? FLAG : ''}`} />

      <input
        inputMode="numeric" maxLength={10} value={draft.ipNumber}
        onChange={e => onChange({ ipNumber: digits(e.target.value).slice(0, 10) })}
        placeholder={ipMissing ? 'Needed' : '10 digits'}
        title={ipMissing
          ? 'ESI applies to this person but no IP number is set — they cannot be included in the ESI return until one is entered'
          : 'ESIC Insured Person number (10 digits)'}
        className={`${CELL} ${ipBad ? FLAG : ''}`} />

      <label className="flex items-center justify-center cursor-pointer select-none" title="Include in pay cycles">
        <input type="checkbox" checked={draft.active} onChange={e => onChange({ active: e.target.checked })}
          className="w-3 h-3 accent-[#27272A]" />
      </label>
    </SheetRow>
  )
}

/** A rupee field: the symbol sits inside the box so the digits stay right-aligned. */
function Money({ value, onChange, placeholder = '0.00', title, flagged }: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  title?: string
  flagged?: boolean
}) {
  return (
    <div className="relative min-w-0">
      <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-[#B5B0A1] text-[10px] pointer-events-none">₹</span>
      <input
        type="number" min="0" step="0.01" value={value} onChange={e => onChange(e.target.value)}
        placeholder={placeholder} title={title}
        className={`${CELL} pl-4 text-right ${flagged ? FLAG : ''}`} />
    </div>
  )
}
