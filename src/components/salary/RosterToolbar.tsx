'use client'

import React, { useEffect, useRef, useState } from 'react'
import { SlidersHorizontal, ArrowUpDown, Check } from 'lucide-react'
import { SearchField } from '@/components/salary/ui'

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

  const activeToggleCount = toggles.filter(t => t.selected).length
  const activeFilterCount = activeToggleCount + (kind !== 'all' ? 1 : 0)
  const narrowed = activeFilterCount > 0 || search.trim() !== ''
  const sortLabel = sortOptions.find(s => s.key === sort)?.label ?? sortOptions[0]?.label ?? 'Name'
  const defaultSortKey = sortOptions[0]?.key

  return (
    <div ref={wrapRef} className="relative flex flex-wrap items-center gap-1.5 mb-2">
      <SearchField
        value={search} onChange={onSearchChange} placeholder={searchPlaceholder ?? 'Search people…'}
        className="sm:max-w-[14rem]"
      />

      <button
        onClick={() => setOpenMenu(openMenu === 'filter' ? null : 'filter')}
        className={activeFilterCount > 0 ? ACTIVE_BTN : GHOST_BTN}
      >
        <SlidersHorizontal size={12} /> Filter
        {activeFilterCount > 0 && <span className="tabular-nums bg-white/20 px-1">{activeFilterCount}</span>}
      </button>

      <button
        onClick={() => setOpenMenu(openMenu === 'sort' ? null : 'sort')}
        className={(sort !== defaultSortKey || desc) ? ACTIVE_BTN : GHOST_BTN}
      >
        <ArrowUpDown size={12} /> {sortLabel}{desc ? ' ↓' : ' ↑'}
      </button>

      <span className="ml-auto text-[10px] text-[#A8A395] tabular-nums">
        {narrowed ? `${shown} of ${total}` : `${total} people`}
      </span>

      {right}

      {openMenu === 'filter' && (
        <Popover onClear={activeFilterCount > 0 ? () => { onKindChange('all'); toggles.forEach(t => { if (t.selected) t.onClick() }) } : undefined}>
          <Group label="Type">
            {KIND_OPTIONS.map(o => (
              <Option key={o.key} selected={kind === o.key} onClick={() => onKindChange(o.key)}>
                <span className="truncate">{o.label}</span>
                {o.key !== 'all' && (
                  <span className="ml-auto pl-2 text-[10px] text-[#A8A395] tabular-nums">{kindCounts[o.key]}</span>
                )}
              </Option>
            ))}
          </Group>
          {toggles.length > 0 && (
            <Group label="Attention">
              {toggles.map(t => (
                <Option key={t.key} selected={t.selected} onClick={t.onClick}>{t.label}</Option>
              ))}
            </Group>
          )}
        </Popover>
      )}

      {openMenu === 'sort' && (
        <Popover>
          <Group label="Sort by">
            {sortOptions.map(s => (
              <Option key={s.key} selected={sort === s.key}
                onClick={() => { onSortChange(s.key); if (s.key === sort) onDescChange(!desc) }}>
                {s.label}
              </Option>
            ))}
          </Group>
          <Group label="Direction">
            <Option selected={!desc} onClick={() => onDescChange(false)}>Ascending</Option>
            <Option selected={desc} onClick={() => onDescChange(true)}>Descending</Option>
          </Group>
        </Popover>
      )}
    </div>
  )
}

const GHOST_BTN = 'inline-flex items-center justify-center gap-1.5 bg-white border border-[#E3DFD3] text-[#6B675A] hover:text-[#27272A] hover:border-[#C9C4B4] text-[10.5px] font-bold uppercase tracking-[0.06em] px-2.5 py-[7px] leading-none transition-colors'
const ACTIVE_BTN = 'inline-flex items-center justify-center gap-1.5 bg-[#27272A] border border-[#27272A] text-white text-[10.5px] font-bold uppercase tracking-[0.06em] px-2.5 py-[7px] leading-none transition-colors'

function Popover({ children, onClear }: { children: React.ReactNode; onClear?: () => void }) {
  return (
    <div className="absolute top-full left-0 right-0 sm:right-auto sm:w-64 z-30 mt-1 bg-white border border-[#27272A] shadow-lg max-h-[60vh] overflow-y-auto">
      {children}
      {onClear && (
        <button onClick={onClear}
          className="w-full text-left px-2.5 py-2 text-[11px] font-semibold text-[#A93232] hover:bg-[#FAF8F2] border-t border-[#F0ECE2]">
          Clear all filters
        </button>
      )}
    </div>
  )
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-[#F0ECE2] last:border-b-0 py-1">
      <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-[#A8A395] px-2.5 py-1">{label}</p>
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
        selected ? 'bg-[#FAF8F2] font-semibold text-[#18181B]' : 'text-[#6B675A] hover:bg-[#FAF8F2]'
      }`}
    >
      <Check size={11} className={selected ? 'text-[#B8983C] flex-shrink-0' : 'opacity-0 flex-shrink-0'} />
      {children}
    </button>
  )
}
