'use client'

import React, { useRef, useState } from 'react'
import { SlidersHorizontal, ArrowUpDown, Table2 } from 'lucide-react'
import {
  Btn, SearchField, MenuButton, MenuPanel, MenuGroup, MenuOption, useMenuDismiss,
} from '@/components/salary/ui'
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
  useMenuDismiss(openMenu, setOpenMenu, wrapRef)

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
    <div ref={wrapRef} className="relative flex flex-wrap items-center gap-2 mb-2.5">
      <SearchField
        value={filters.search}
        onChange={v => set({ search: v })}
        placeholder="Search people"
        className="basis-full sm:basis-auto sm:max-w-xs"
      />

      <MenuButton
        icon={SlidersHorizontal}
        active={activeFilterCount > 0}
        open={openMenu === 'filter'}
        onClick={() => setOpenMenu(openMenu === 'filter' ? null : 'filter')}
      >
        Filter{activeFilterCount > 0 ? ` · ${activeFilterCount}` : ''}
      </MenuButton>

      <MenuButton
        icon={ArrowUpDown}
        active={filters.sort !== 'name' || filters.desc}
        open={openMenu === 'sort'}
        onClick={() => setOpenMenu(openMenu === 'sort' ? null : 'sort')}
      >
        {sortLabel}{filters.desc ? ' ↓' : ' ↑'}
      </MenuButton>

      <Btn
        tone="ghost"
        onClick={onExportCsv}
        disabled={exportDisabled}
        title={narrowed
          ? `Download the ${shown} filtered row(s) as a bank upload file`
          : 'Download every row as a bank upload file'}
        className="!h-9"
      >
        <Table2 size={14} /> Bank file{narrowed ? ` (${shown})` : ''}
      </Btn>

      <span className="ml-auto text-[12px] text-slate-500 tabular-nums whitespace-nowrap">
        {narrowed ? `${shown} of ${total}` : `${total} people`}
      </span>

      {openMenu === 'filter' && (
        <MenuPanel onClear={activeFilterCount > 0
          ? () => set({ kind: 'all', teamIds: [], pay: 'all', noBank: false, withLop: false })
          : undefined}>
          <MenuGroup label="Who">
            {KIND_OPTIONS.map(o => (
              <MenuOption key={o.key} selected={filters.kind === o.key} onClick={() => set({ kind: o.key })}>
                {o.label}
              </MenuOption>
            ))}
          </MenuGroup>
          <MenuGroup label="Payment">
            {PAY_OPTIONS.map(o => (
              <MenuOption key={o.key} selected={filters.pay === o.key} onClick={() => set({ pay: o.key })}>
                {o.label}
              </MenuOption>
            ))}
          </MenuGroup>
          <MenuGroup label="Needs attention">
            <MenuOption selected={filters.noBank} onClick={() => set({ noBank: !filters.noBank })}>
              No bank details
            </MenuOption>
            <MenuOption selected={filters.withLop} onClick={() => set({ withLop: !filters.withLop })}>
              Has loss of pay
            </MenuOption>
          </MenuGroup>
          <MenuGroup label={`Teams${filters.teamIds.length ? ` · ${filters.teamIds.length}` : ''}`}>
            {teams.length === 0 ? (
              <p className="px-3.5 py-2 text-[12.5px] text-slate-500">No teams set up yet.</p>
            ) : teams.map(t => (
              <MenuOption key={t.id} selected={filters.teamIds.includes(t.id)} onClick={() => toggleTeam(t.id)}>
                <span className="flex-1 min-w-0 break-words">{t.name}</span>
                <span className="text-[12px] text-slate-400 tabular-nums">{t.memberIds.length}</span>
              </MenuOption>
            ))}
          </MenuGroup>
        </MenuPanel>
      )}

      {openMenu === 'sort' && (
        <MenuPanel>
          <MenuGroup label="Sort by">
            {SORTS.map(s => (
              <MenuOption key={s.key} selected={filters.sort === s.key}
                onClick={() => set({ sort: s.key, desc: s.key === filters.sort ? filters.desc : s.key !== 'name' })}>
                {s.label}
              </MenuOption>
            ))}
          </MenuGroup>
          <MenuGroup label="Order">
            <MenuOption selected={!filters.desc} onClick={() => set({ desc: false })}>Ascending</MenuOption>
            <MenuOption selected={filters.desc} onClick={() => set({ desc: true })}>Descending</MenuOption>
          </MenuGroup>
        </MenuPanel>
      )}
    </div>
  )
}
