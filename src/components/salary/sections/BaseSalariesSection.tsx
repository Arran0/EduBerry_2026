'use client'

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { Bus } from 'lucide-react'
import Avatar from '@/components/Avatar'
import { ADMIN } from '@/components/salary/adminUi'
import { Sheet, SHEET } from '@/components/bus/adminUI'
import PersonSearch from '@/components/salary/PersonSearch'
import SaveBar from '@/components/salary/SaveBar'
import { useAutosave } from '@/components/salary/useAutosave'
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
  'minmax(180px,2fr)',    // person (avatar + name + role)
  'minmax(104px,1fr)',    // monthly base
  'minmax(104px,1fr)',    // PF basic
  'minmax(56px,0.6fr)',   // PF applicable
  'minmax(84px,0.9fr)',   // ESI mode
  'minmax(70px,0.7fr)',   // active
].join(' ')

type Kind = 'staff' | 'driver'
type Base = StaffSalaryBase | DriverSalaryBase
type EsiChoice = 'auto' | 'on' | 'off'

interface Entry {
  key: string
  kind: Kind
  person: UserProfile
  existing?: Base
}

/** The editable shape of one row, kept as strings so partly-typed input survives. */
interface Draft {
  amount: string
  pfBasic: string
  pfApplicable: boolean
  esiChoice: EsiChoice
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
    esiChoice: esiChoiceOf(existing?.esi_override),
    active: existing?.active ?? true,
  }
}

function sameDraft(a: Draft, b: Draft): boolean {
  return a.amount === b.amount && a.pfBasic === b.pfBasic
    && a.pfApplicable === b.pfApplicable && a.esiChoice === b.esiChoice && a.active === b.active
}

export default function BaseSalariesSection() {
  const [loading, setLoading] = useState(true)
  const [entries, setEntries] = useState<Entry[]>([])
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
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
        esi_override: esiValueOf(d.esiChoice),
        active: d.active,
      }
      const res = entry.kind === 'staff'
        ? await upsertBaseSalary({ staff_id: entry.person.id, ...input })
        : await upsertDriverBaseSalary({ driver_id: entry.person.id, ...input })
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

  return (
    <>
      <div className="flex items-baseline gap-2 mb-3">
        <h2 className={ADMIN.label}>Base salaries</h2>
        <p className="text-xs text-[#A1A1AA]">Used when running a monthly cycle · staff &amp; drivers</p>
      </div>

      {!loading && entries.length > 0 && (
        <div className="flex items-start justify-between gap-3">
          <PersonSearch value={search} onChange={setSearch} placeholder="Search staff or drivers…" />
          <SaveBar dirtyCount={dirtyKeys.length} state={state} error={error} onSave={saveNow} />
        </div>
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
                </div>
              </div>

              {visible.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-[#A1A1AA]">No one matches &quot;{search}&quot;.</div>
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
          </div>
        </div>
      )}
    </>
  )
}

const cellCls = 'bg-white border border-[#E4E4E7] rounded-md px-2 py-1 text-[11px] tabular-nums text-[#27272A] focus:outline-none focus:border-[#27272A] transition-colors'

function BaseRow({ entry, draft, dirty, onChange }: {
  entry: Entry
  draft: Draft
  dirty: boolean
  onChange: (patch: Partial<Draft>) => void
}) {
  const { kind, person, existing } = entry
  // PF needs both a PF Basic wage and the tick — a wage on its own quietly
  // computes to zero, which is easy to do and hard to spot on a dense sheet.
  const pfUnticked = !draft.pfApplicable && (parseFloat(draft.pfBasic) || 0) > 0
  return (
    <div className={SHEET.row}>
      {/* The bar doubles as the unsaved marker, so a pending row is obvious without a per-row control. */}
      <div className={`${SHEET.bar} ${dirty ? 'bg-[#8A6D1F]' : draft.active && existing ? 'bg-[#B8983C]' : 'bg-transparent'}`} />
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
          <input type="number" min="0" step="0.01" value={draft.amount} onChange={e => onChange({ amount: e.target.value })}
            placeholder="0.00" title="Monthly base salary"
            className={`${cellCls} w-full pl-5 pr-2 text-right`} />
        </div>

        <div className="relative min-w-0">
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[#A1A1AA] text-[11px]">₹</span>
          <input type="number" min="0" step="0.01" value={draft.pfBasic} onChange={e => onChange({ pfBasic: e.target.value })}
            placeholder="0.00" title="PF Basic wage (used for PF, not gross salary)"
            className={`${cellCls} w-full pl-5 pr-2 text-right`} />
        </div>

        <label
          className={`flex items-center justify-center cursor-pointer select-none rounded ${
            pfUnticked ? 'ring-2 ring-[#B8983C] ring-offset-1' : ''
          }`}
          title={pfUnticked
            ? 'PF Basic is set but PF is off, so no PF will be deducted — tick to apply it'
            : 'PF applicable'}
        >
          <input type="checkbox" checked={draft.pfApplicable} onChange={e => onChange({ pfApplicable: e.target.checked })}
            className="w-3.5 h-3.5 accent-[#27272A]" />
        </label>

        <select value={draft.esiChoice} onChange={e => onChange({ esiChoice: e.target.value as EsiChoice })}
          title="ESI applicability"
          className={`${cellCls} w-full`}>
          <option value="auto">Auto</option>
          <option value="on">Always</option>
          <option value="off">Never</option>
        </select>

        <label className="flex items-center justify-center cursor-pointer select-none" title="Include in pay cycles">
          <input type="checkbox" checked={draft.active} onChange={e => onChange({ active: e.target.checked })}
            className="w-3.5 h-3.5 accent-[#27272A]" />
        </label>
      </div>
    </div>
  )
}
