'use client'

import React, { useEffect, useRef, useState } from 'react'
import { Search, X, SlidersHorizontal, ArrowUpDown, Check, Table2 } from 'lucide-react'
import { SHARP } from '@/components/salary/adminUi'
import type { TeamMembership } from '@/lib/teams'
import type { RosterKindFilter } from '@/components/salary/RosterToolbar'

export type CycleSortKey = 'name' | 'net' | 'base' | 'lop' | 'statutory' | 'leave'
export type CyclePayFilter = 'all' | 'unpaid' | 'paid'

export interface CycleFilters {
  search: string
  /** Staff / drivers / support staff, or every kind. */
  kind: RosterKindFilter
  /** Team ids to keep. Empty = every team, and staff on no team at all. */
  teamIds: string[]
  pay: CyclePayFilter
  /** Keep only rows missing a bank account — the ones that block a disbursement. */
  noBank: boolean
  /** Keep only rows carrying some loss of pay. */
  withLop: boolean
  sort: CycleSortKey
  desc: boolean
}

export const DEFAULT_CYCLE_FILTERS: CycleFilters = {
  search: '', kind: 'all', teamIds: [], pay: 'all', noBank: false, withLop: false, sort: 'name', desc: false,
}

const KIND_OPTIONS: { key: RosterKindFilter; label: string }[] = [
  { key: 'all', label: 'Everyone' },
  { key: 'staff', label: 'Staff' },
  { key: 'driver', label: 'Drivers' },
  { key: 'support', label: 'Support staff' },
]

const SORTS: { key: CycleSortKey; label: string }[] = [
  { key: 'name', label: 'Name' },
  { key: 'net', label: 'Net pay' },
  { key: 'base', label: 'Base salary' },
  { key: 'lop', label: 'Loss of pay' },
  { key: 'statutory', label: 'Statutory' },
  { key: 'leave', label: 'Leave days' },
]

const PAY_OPTIONS: { key: CyclePayFilter; label: string }[] = [
  { key: 'all', label: 'Everyone' },
  { key: 'unpaid', label: 'Not yet paid' },
  { key: 'paid', label: 'Paid' },
]

/**
 * The one control row above the pay cycle sheet: search, filter, sort, and the
 * bank export.
 *
 * The export sits here rather than with the disbursement buttons on purpose —
 * it exports exactly the rows the filters have left on screen, and a school
 * regularly releases one team at a time rather than the whole payroll in a
 * single upload. Keeping it beside the filters is what makes that connection
 * legible; its label carries the live count so it can't be mistaken for a
 * whole-cycle export.
 */
export default function CycleToolbar({
  filters, onChange, teams, shown, total, onExportCsv, exportDisabled,
}: {
  filters: CycleFilters
  onChange: (f: CycleFilters) => void
  teams: TeamMembership[]
  shown: number
  total: number
  onExportCsv: () => void
  exportDisabled?: boolean
}) {
  const [openMenu, setOpenMenu] = useState<'filter' | 'sort' | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  // Click-away — the menus are plain popovers, not modals, so they must not
  // trap the page or stack another scroll lock on it.
  useEffect(() => {
    if (!openMenu) return
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpenMenu(null)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpenMenu(null) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [openMenu])

  const set = (patch: Partial<CycleFilters>) => onChange({ ...filters, ...patch })

  const toggleTeam = (id: string) => {
    set({ teamIds: filters.teamIds.includes(id)
      ? filters.teamIds.filter(t => t !== id)
      : [...filters.teamIds, id] })
  }

  const activeFilterCount =
    filters.teamIds.length + (filters.kind !== 'all' ? 1 : 0)
    + (filters.pay !== 'all' ? 1 : 0) + (filters.noBank ? 1 : 0) + (filters.withLop ? 1 : 0)
  const narrowed = activeFilterCount > 0 || filters.search.trim() !== ''
  const sortLabel = SORTS.find(s => s.key === filters.sort)?.label ?? 'Name'

  return (
    <div ref={wrapRef} className="relative flex flex-wrap items-center gap-1.5 mb-2">
      <div className="relative flex-1 min-w-[140px] sm:max-w-xs">
        <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-[#A1A1AA] pointer-events-none" />
        <input
          value={filters.search}
          onChange={e => set({ search: e.target.value })}
          placeholder="Search staff…"
          className={`${SHARP.input} !pl-7 ${filters.search ? '!pr-7' : ''}`}
        />
        {filters.search && (
          <button
            onClick={() => set({ search: '' })}
            aria-label="Clear search"
            className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[#A1A1AA] hover:text-[#27272A]"
          >
            <X size={13} />
          </button>
        )}
      </div>

      <button
        onClick={() => setOpenMenu(openMenu === 'filter' ? null : 'filter')}
        className={activeFilterCount > 0 ? SHARP.activeBtn : SHARP.ghostBtn}
      >
        <SlidersHorizontal size={12} /> Filter
        {activeFilterCount > 0 && (
          <span className="tabular-nums bg-white/20 px-1">{activeFilterCount}</span>
        )}
      </button>

      <button
        onClick={() => setOpenMenu(openMenu === 'sort' ? null : 'sort')}
        className={filters.sort !== 'name' || filters.desc ? SHARP.activeBtn : SHARP.ghostBtn}
      >
        <ArrowUpDown size={12} /> {sortLabel}{filters.desc ? ' ↓' : ' ↑'}
      </button>

      <button
        onClick={onExportCsv}
        disabled={exportDisabled}
        title={narrowed
          ? `Export the ${shown} filtered row(s) as a bank upload file`
          : 'Export every row as a bank upload file'}
        className={SHARP.ghostBtn}
      >
        <Table2 size={12} /> Bank CSV{narrowed ? ` (${shown})` : ''}
      </button>

      <span className="ml-auto text-[10px] text-[#A1A1AA] tabular-nums">
        {narrowed ? `${shown} of ${total}` : `${total} staff`}
      </span>

      {openMenu === 'filter' && (
        <Popover onClear={activeFilterCount > 0
          ? () => set({ kind: 'all', teamIds: [], pay: 'all', noBank: false, withLop: false })
          : undefined}>
          <Group label="Type">
            {KIND_OPTIONS.map(o => (
              <Option key={o.key} selected={filters.kind === o.key} onClick={() => set({ kind: o.key })}>
                {o.label}
              </Option>
            ))}
          </Group>
          <Group label="Payment">
            {PAY_OPTIONS.map(o => (
              <Option key={o.key} selected={filters.pay === o.key} onClick={() => set({ pay: o.key })}>
                {o.label}
              </Option>
            ))}
          </Group>
          <Group label="Attention">
            <Option selected={filters.noBank} onClick={() => set({ noBank: !filters.noBank })}>
              Missing bank details
            </Option>
            <Option selected={filters.withLop} onClick={() => set({ withLop: !filters.withLop })}>
              Has loss of pay
            </Option>
          </Group>
          <Group label={`Teams${filters.teamIds.length ? ` · ${filters.teamIds.length}` : ''}`}>
            {teams.length === 0 ? (
              <p className="px-2 py-1.5 text-[11px] text-[#A1A1AA]">No teams set up yet.</p>
            ) : teams.map(t => (
              <Option key={t.id} selected={filters.teamIds.includes(t.id)} onClick={() => toggleTeam(t.id)}>
                <span className="truncate">{t.name}</span>
                <span className="ml-auto pl-2 text-[10px] text-[#A1A1AA] tabular-nums">{t.memberIds.length}</span>
              </Option>
            ))}
          </Group>
        </Popover>
      )}

      {openMenu === 'sort' && (
        <Popover>
          <Group label="Sort by">
            {SORTS.map(s => (
              <Option key={s.key} selected={filters.sort === s.key}
                onClick={() => set({ sort: s.key, desc: s.key === filters.sort ? filters.desc : s.key !== 'name' })}>
                {s.label}
              </Option>
            ))}
          </Group>
          <Group label="Direction">
            <Option selected={!filters.desc} onClick={() => set({ desc: false })}>Ascending</Option>
            <Option selected={filters.desc} onClick={() => set({ desc: true })}>Descending</Option>
          </Group>
        </Popover>
      )}
    </div>
  )
}

function Popover({ children, onClear }: { children: React.ReactNode; onClear?: () => void }) {
  return (
    <div className="absolute top-full left-0 right-0 sm:right-auto sm:w-64 z-30 mt-1 bg-white border border-[#27272A] shadow-lg max-h-[60vh] overflow-y-auto">
      {children}
      {onClear && (
        <button onClick={onClear}
          className="w-full text-left px-2.5 py-2 text-[11px] font-semibold text-[#BE123C] hover:bg-[#FAFAFA] border-t border-[#F4F4F5]">
          Clear all filters
        </button>
      )}
    </div>
  )
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-[#F4F4F5] last:border-b-0 py-1">
      <p className={`${SHARP.label} px-2.5 py-1`}>{label}</p>
      {children}
    </div>
  )
}

function Option({ selected, onClick, children }: {
  selected: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] text-left transition-colors ${
        selected ? 'bg-[#FAFAFA] font-semibold text-[#18181B]' : 'text-[#71717A] hover:bg-[#FAFAFA]'
      }`}
    >
      <Check size={11} className={selected ? 'text-[#B8983C] flex-shrink-0' : 'opacity-0 flex-shrink-0'} />
      {children}
    </button>
  )
}
