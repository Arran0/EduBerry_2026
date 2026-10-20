'use client'

import React, { useRef, useState } from 'react'
import { SlidersHorizontal, ArrowUpDown } from 'lucide-react'
import {
  SearchField, MenuButton, MenuPanel, MenuGroup, MenuOption, useMenuDismiss,
} from '@/components/salary/ui'

export type RosterKind = 'staff' | 'driver' | 'support'
export type RosterKindFilter = 'all' | RosterKind

const KIND_OPTIONS: { key: RosterKindFilter; label: string }[] = [
  { key: 'all', label: 'Everyone' },
  { key: 'staff', label: 'Staff' },
  { key: 'driver', label: 'Drivers' },
  { key: 'support', label: 'Support staff' },
]

export interface RosterToggle {
  key: string
  label: string
  selected: boolean
  onClick: () => void
}

export interface RosterSortOption<SortKey extends string> {
  key: SortKey
  label: string
}

/**
 * Search + filter + sort, in the same shape on every roster sheet — Base
 * Salaries, Bank Accounts, and (eventually) anywhere else that lists staff,
 * drivers and support staff together. Mirrors CycleToolbar's filter/sort
 * popovers so the pattern reads the same whether the list is a pay cycle or
 * a settings sheet, without inheriting that component's cycle-specific
 * filters (pay status, teams, loss of pay).
 */
export default function RosterToolbar<SortKey extends string>({
  search, onSearchChange, searchPlaceholder,
  kind, onKindChange, kindCounts,
  toggles = [],
  sortOptions, sort, onSortChange, desc, onDescChange,
  shown, total, right,
}: {
  search: string
  onSearchChange: (v: string) => void
  searchPlaceholder?: string
  kind: RosterKindFilter
  onKindChange: (k: RosterKindFilter) => void
  kindCounts: { staff: number; driver: number; support: number }
  toggles?: RosterToggle[]
  sortOptions: RosterSortOption<SortKey>[]
  sort: SortKey
  onSortChange: (key: SortKey) => void
  desc: boolean
  onDescChange: (desc: boolean) => void
  shown: number
  total: number
  /** Trailing control sharing this row — e.g. a SaveBar. */
  right?: React.ReactNode
}) {
  const [openMenu, setOpenMenu] = useState<'filter' | 'sort' | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  useMenuDismiss(openMenu, setOpenMenu, wrapRef)

  const activeToggleCount = toggles.filter(t => t.selected).length
  const activeFilterCount = activeToggleCount + (kind !== 'all' ? 1 : 0)
  const narrowed = activeFilterCount > 0 || search.trim() !== ''
  const sortLabel = sortOptions.find(s => s.key === sort)?.label ?? sortOptions[0]?.label ?? 'Name'
  const defaultSortKey = sortOptions[0]?.key

  return (
    <div ref={wrapRef} className="relative flex flex-wrap items-center gap-2 mb-2.5">
      <SearchField
        value={search} onChange={onSearchChange} placeholder={searchPlaceholder ?? 'Search people'}
        className="basis-full sm:basis-auto sm:max-w-[16rem]"
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
        active={sort !== defaultSortKey || desc}
        open={openMenu === 'sort'}
        onClick={() => setOpenMenu(openMenu === 'sort' ? null : 'sort')}
      >
        {sortLabel}{desc ? ' ↓' : ' ↑'}
      </MenuButton>

      <span className="text-[12px] text-slate-500 tabular-nums whitespace-nowrap">
        {narrowed ? `${shown} of ${total}` : `${total} people`}
      </span>

      {right && <div className="ml-auto flex items-center">{right}</div>}

      {openMenu === 'filter' && (
        <MenuPanel onClear={activeFilterCount > 0 ? () => { onKindChange('all'); toggles.forEach(t => { if (t.selected) t.onClick() }) } : undefined}>
          <MenuGroup label="Who">
            {KIND_OPTIONS.map(o => (
              <MenuOption key={o.key} selected={kind === o.key} onClick={() => onKindChange(o.key)}>
                <span className="flex-1 min-w-0 break-words">{o.label}</span>
                {o.key !== 'all' && (
                  <span className="text-[12px] text-slate-400 tabular-nums">{kindCounts[o.key]}</span>
                )}
              </MenuOption>
            ))}
          </MenuGroup>
          {toggles.length > 0 && (
            <MenuGroup label="Needs attention">
              {toggles.map(t => (
                <MenuOption key={t.key} selected={t.selected} onClick={t.onClick}>{t.label}</MenuOption>
              ))}
            </MenuGroup>
          )}
        </MenuPanel>
      )}

      {openMenu === 'sort' && (
        <MenuPanel>
          <MenuGroup label="Sort by">
            {sortOptions.map(s => (
              <MenuOption key={s.key} selected={sort === s.key}
                onClick={() => { onSortChange(s.key); if (s.key === sort) onDescChange(!desc) }}>
                {s.label}
              </MenuOption>
            ))}
          </MenuGroup>
          <MenuGroup label="Order">
            <MenuOption selected={!desc} onClick={() => onDescChange(false)}>Ascending</MenuOption>
            <MenuOption selected={desc} onClick={() => onDescChange(true)}>Descending</MenuOption>
          </MenuGroup>
        </MenuPanel>
      )}
    </div>
  )
}
