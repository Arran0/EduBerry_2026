'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { Check, Bus } from 'lucide-react'
import Avatar from '@/components/Avatar'
import { ADMIN } from '@/components/salary/adminUi'
import { Sheet, SHEET } from '@/components/bus/adminUI'
import { UserProfile, getRoleDisplayName } from '@/lib/supabase'
import { StaffSalaryBase, fetchEligibleStaff, fetchBaseSalaries, upsertBaseSalary } from '@/lib/salary'
import { DriverSalaryBase, fetchEligibleDrivers, fetchDriverBaseSalaries, upsertDriverBaseSalary } from '@/lib/driverSalary'

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

  return (
    <>
      <div className="flex items-baseline gap-2 mb-3">
        <h2 className={ADMIN.label}>Base salaries</h2>
        <p className="text-xs text-[#A1A1AA]">Used when running a monthly cycle · staff &amp; drivers</p>
      </div>

      {loading ? (
        <div className="text-center py-10"><div className="spinner mx-auto mb-3" /><p className="text-sm text-[#71717A]">Loading…</p></div>
      ) : entries.length === 0 ? (
        <div className={`${ADMIN.card} shadow-sm p-6 text-center text-sm text-[#71717A]`}>
          No teacher, coordinator, principal, or driver accounts yet.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-[760px]">
            <Sheet
              columns={
                <>
                  <span className={`${SHEET.headCell} w-52 flex-shrink-0 ml-9`}>Person</span>
                  <span className={`${SHEET.headCell} w-24 flex-shrink-0`}>Monthly base</span>
                  <span className={`${SHEET.headCell} w-24 flex-shrink-0`}>PF Basic</span>
                  <span className={`${SHEET.headCell} w-16 flex-shrink-0 text-center`}>PF</span>
                  <span className={`${SHEET.headCell} w-20 flex-shrink-0 text-center`}>ESI</span>
                  <span className={`${SHEET.headCell} flex-1 text-right`}>Active</span>
                </>
              }
            >
              {entries.map(e => (
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
      <div className="flex items-center gap-2 flex-1 min-w-0 px-3 py-1.5">
        <Avatar avatarUrl={person.avatar_url} name={person.full_name} size={26} userId={person.id} />
        <div className="w-40 flex-shrink-0 min-w-0">
          <p className="font-semibold text-[#18181B] text-xs truncate">{person.full_name}</p>
          <p className="text-[10px] text-[#A1A1AA] truncate flex items-center gap-1">
            {kind === 'driver' && <Bus size={9} className="flex-shrink-0" />}
            {getRoleDisplayName(person.role, person.is_non_teaching)}
          </p>
        </div>

        <div className="relative w-24 flex-shrink-0">
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[#A1A1AA] text-[11px]">₹</span>
          <input type="number" min="0" step="0.01" value={amount} onChange={e => setAmount(e.target.value)}
            placeholder="0.00" title="Monthly base salary"
            className={`${cellCls} w-24 pl-5 pr-2`} />
        </div>

        <div className="relative w-24 flex-shrink-0">
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[#A1A1AA] text-[11px]">₹</span>
          <input type="number" min="0" step="0.01" value={pfBasic} onChange={e => setPfBasic(e.target.value)}
            placeholder="0.00" title="PF Basic wage (used for PF, not gross salary)"
            className={`${cellCls} w-24 pl-5 pr-2`} />
        </div>

        <label className="w-16 flex-shrink-0 flex items-center justify-center gap-1 cursor-pointer select-none" title="PF applicable">
          <input type="checkbox" checked={pfApplicable} onChange={e => setPfApplicable(e.target.checked)}
            className="w-3.5 h-3.5 accent-[#27272A]" />
          <span className="text-[10px] text-[#71717A]">PF</span>
        </label>

        <select value={esiChoice} onChange={e => setEsiChoice(e.target.value as EsiChoice)}
          title="ESI applicability"
          className={`${cellCls} w-20 flex-shrink-0`}>
          <option value="auto">Auto</option>
          <option value="on">Always</option>
          <option value="off">Never</option>
        </select>

        <div className="flex items-center gap-2 flex-1 justify-end flex-shrink-0">
          <label className="hidden sm:flex items-center gap-1 cursor-pointer select-none" title="Include in pay cycles">
            <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)}
              className="w-3.5 h-3.5 accent-[#27272A]" />
            <span className="text-[11px] text-[#71717A]">Active</span>
          </label>
          <button onClick={save} disabled={saving || !dirty}
            className={`${ADMIN.darkBtn} text-[11px] px-2.5 py-1 disabled:opacity-40`}>
            {saved ? <><Check size={11} /> Saved</> : saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
