'use client'

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { Check, Bus } from 'lucide-react'
import Avatar from '@/components/Avatar'
import { ADMIN } from '@/components/salary/adminUi'
import { Sheet, SHEET } from '@/components/bus/adminUI'
import PersonSearch from '@/components/salary/PersonSearch'
import { UserProfile, getRoleDisplayName } from '@/lib/supabase'
import { StaffSalaryBase, fetchEligibleStaff, fetchBaseSalaries, upsertBaseSalary } from '@/lib/salary'
import { DriverSalaryBase, fetchEligibleDrivers, fetchDriverBaseSalaries, upsertDriverBaseSalary } from '@/lib/driverSalary'

/**
 * Shared column template for the header and every row. Applied as an inline
 * style: Tailwind only emits CSS for class names it finds literally in the
 * source, so a `grid-cols-[...]` built by joining strings never gets
 * generated and the grid silently collapses to one stacked column.
 */
const GRID = 'grid items-center gap-x-2'
const GRID_COLS = [
  'minmax(170px,2fr)',    // person (avatar + name + role)
  'minmax(96px,1fr)',     // monthly base
  'minmax(96px,1fr)',     // PF basic
  'minmax(56px,0.6fr)',   // PF applicable
  'minmax(76px,0.8fr)',   // ESI mode
  'minmax(70px,0.7fr)',   // active
  'minmax(64px,0.6fr)',   // save
].join(' ')

type Kind = 'staff' | 'driver'
type Base = StaffSalaryBase | DriverSalaryBase

interface Entry {
  kind: Kind
  person: UserProfile
  existing?: Base
}

export default function BaseSalariesSection() {
  const [loading, setLoading] = useState(true)
  const [entries, setEntries] = useState<Entry[]>([])
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const [staff, staffBases, drivers, driverBases] = await Promise.all([
      fetchEligibleStaff(), fetchBaseSalaries(), fetchEligibleDrivers(), fetchDriverBaseSalaries(),
    ])
    const staffMap: Record<string, StaffSalaryBase> = {}
    for (const b of staffBases) staffMap[b.staff_id] = b
    const driverMap: Record<string, DriverSalaryBase> = {}
    for (const b of driverBases) driverMap[b.driver_id] = b

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
      <div className="flex items-baseline gap-2 mb-3">
        <h2 className={ADMIN.label}>Base salaries</h2>
        <p className="text-xs text-[#A1A1AA]">Used when running a monthly cycle · staff &amp; drivers</p>
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
          <div className="min-w-[720px]">
            <Sheet>
              {/* Header shares GRID_COLS with every row, so labels sit above their own column. */}
              <div className="hidden sm:flex items-stretch bg-[#27272A]">
                <div className="w-1 flex-shrink-0" />
                <div className={`${GRID} flex-1 min-w-0 px-3 py-2.5`} style={{ gridTemplateColumns: GRID_COLS }}>
                  <span className={`${SHEET.headCell} pl-[34px]`}>Person</span>
                  <span className={`${SHEET.headCell} text-right`}>Monthly base</span>
                  <span className={`${SHEET.headCell} text-right`}>PF Basic</span>
                  <span className={`${SHEET.headCell} text-center`}>PF</span>
                  <span className={`${SHEET.headCell} text-center`}>ESI</span>
                  <span className={`${SHEET.headCell} text-center`}>Active</span>
                  <span className={SHEET.headCell} />
                </div>
              </div>

              {visible.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-[#A1A1AA]">No one matches &quot;{search}&quot;.</div>
              ) : visible.map(e => (
                <BaseRow key={`${e.kind}-${e.person.id}`} kind={e.kind} person={e.person} existing={e.existing} onSaved={load} />
              ))}
            </Sheet>
          </div>
        </div>
      )}
    </>
  )
}

type EsiChoice = 'auto' | 'on' | 'off'

function esiChoiceOf(v: boolean | null | undefined): EsiChoice {
  return v === true ? 'on' : v === false ? 'off' : 'auto'
}
function esiValueOf(c: EsiChoice): boolean | null {
  return c === 'on' ? true : c === 'off' ? false : null
}

function BaseRow({ kind, person, existing, onSaved }: {
  kind: Kind
  person: UserProfile
  existing?: Base
  onSaved: () => void
}) {
  const [amount, setAmount] = useState(existing ? String(existing.base_amount) : '')
  const [pfBasic, setPfBasic] = useState(existing?.pf_basic != null ? String(existing.pf_basic) : '')
  const [pfApplicable, setPfApplicable] = useState(existing?.pf_applicable ?? false)
  const [esiChoice, setEsiChoice] = useState<EsiChoice>(esiChoiceOf(existing?.esi_override))
  const [active, setActive] = useState(existing?.active ?? true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const dirty =
    amount !== (existing ? String(existing.base_amount) : '') ||
    pfBasic !== (existing?.pf_basic != null ? String(existing.pf_basic) : '') ||
    pfApplicable !== (existing?.pf_applicable ?? false) ||
    esiChoice !== esiChoiceOf(existing?.esi_override) ||
    active !== (existing?.active ?? true)

  const save = async () => {
    setSaving(true)
    const input = {
      base_amount: parseFloat(amount) || 0,
      pf_basic: pfBasic.trim() === '' ? null : parseFloat(pfBasic) || 0,
      pf_applicable: pfApplicable,
      esi_override: esiValueOf(esiChoice),
      active,
    }
    const res = kind === 'staff'
      ? await upsertBaseSalary({ staff_id: person.id, ...input })
      : await upsertDriverBaseSalary({ driver_id: person.id, ...input })
    setSaving(false)
    if (res.success) { setSaved(true); setTimeout(() => setSaved(false), 1800); onSaved() }
  }

  const cellCls = 'bg-white border border-[#E4E4E7] rounded-md px-2 py-1 text-[11px] tabular-nums text-[#27272A] focus:outline-none focus:border-[#27272A] transition-colors'

  return (
    <div className={SHEET.row}>
      <div className={`${SHEET.bar} ${active && existing ? 'bg-[#B8983C]' : 'bg-transparent'}`} />
      <div className={`${GRID} flex-1 min-w-0 px-3 py-1.5`} style={{ gridTemplateColumns: GRID_COLS }}>
        <div className="flex items-center gap-2 min-w-0">
          <Avatar avatarUrl={person.avatar_url} name={person.full_name} size={26} userId={person.id} />
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-[#18181B] text-xs truncate">{person.full_name}</p>
            <p className="text-[10px] text-[#A1A1AA] truncate flex items-center gap-1">
              {kind === 'driver' && <Bus size={9} className="flex-shrink-0" />}
              {getRoleDisplayName(person.role, person.is_non_teaching)}
            </p>
          </div>
        </div>

        <div className="relative min-w-0">
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[#A1A1AA] text-[11px]">₹</span>
          <input type="number" min="0" step="0.01" value={amount} onChange={e => setAmount(e.target.value)}
            placeholder="0.00" title="Monthly base salary"
            className={`${cellCls} w-full pl-5 pr-2 text-right`} />
        </div>

        <div className="relative min-w-0">
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[#A1A1AA] text-[11px]">₹</span>
          <input type="number" min="0" step="0.01" value={pfBasic} onChange={e => setPfBasic(e.target.value)}
            placeholder="0.00" title="PF Basic wage (used for PF, not gross salary)"
            className={`${cellCls} w-full pl-5 pr-2 text-right`} />
        </div>

        <label className="flex items-center justify-center cursor-pointer select-none" title="PF applicable">
          <input type="checkbox" checked={pfApplicable} onChange={e => setPfApplicable(e.target.checked)}
            className="w-3.5 h-3.5 accent-[#27272A]" />
        </label>

        <select value={esiChoice} onChange={e => setEsiChoice(e.target.value as EsiChoice)}
          title="ESI applicability"
          className={`${cellCls} w-full`}>
          <option value="auto">Auto</option>
          <option value="on">Always</option>
          <option value="off">Never</option>
        </select>

        <label className="flex items-center justify-center cursor-pointer select-none" title="Include in pay cycles">
          <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)}
            className="w-3.5 h-3.5 accent-[#27272A]" />
        </label>

        <button onClick={save} disabled={saving || !dirty}
          className={`${ADMIN.darkBtn} text-[11px] px-2 py-1 disabled:opacity-40`}>
          {saved ? <Check size={11} /> : saving ? '…' : 'Save'}
        </button>
      </div>
    </div>
  )
}
