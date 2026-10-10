'use client'

import React from 'react'
import { Search, X } from 'lucide-react'
import { TAP, FOCUS, SECTION_LABEL } from '../ui'

// ============================================================
// The left column of the Homeroom / Teacher / Subject hubs.
//
// All three are the same thing — a searchable list beside a detail pane — and
// all three had their own copy of it, which is why they had drifted: three
// search boxes with three different paddings, rows too short to hit on a
// phone, no count, no way to clear the query, and a selected row that was a
// solid black block with no relation to the gold the rest of the workspace
// accents with.
//
// One implementation, so a change to the pattern is a change to the pattern.
// ============================================================

export function EntityList({
  query, onQuery, placeholder, count, total, children, actions, listClassName = '',
}: {
  query: string
  onQuery: (q: string) => void
  placeholder: string
  /** Rows currently shown. */
  count: number
  /** Rows before the query filtered them, when that differs. */
  total?: number
  children: React.ReactNode
  /** A control under the search box — "Manage rooms", say. */
  actions?: React.ReactNode
  listClassName?: string
}) {
  const filtering = total != null && total !== count

  return (
    <div className="border-b sm:border-b-0 sm:border-r border-[#E4E4E7] bg-[#FAFAF9] flex flex-col min-h-0">
      <div className="p-2 border-b border-[#E4E4E7] space-y-1.5 sticky top-0 bg-[#FAFAF9] z-10">
        <div className={`flex items-center gap-2 border border-[#D4D4D8] bg-white px-2.5 ${FOCUS} focus-within:border-[#27272A]`}>
          <Search size={13} className="text-[#A1A1AA] flex-shrink-0" aria-hidden />
          <input
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder={placeholder}
            aria-label={placeholder}
            className="flex-1 min-w-0 bg-transparent text-sm py-2 sm:py-1.5 focus:outline-none"
          />
          {query && (
            <button
              onClick={() => onQuery('')}
              aria-label="Clear search"
              className={`text-[#A1A1AA] hover:text-[#18181B] flex-shrink-0 ${TAP}`}
            >
              <X size={13} />
            </button>
          )}
        </div>
        {actions}
        <p className={`${SECTION_LABEL} px-0.5 tabular-nums`}>
          {filtering ? `${count} of ${total}` : count}
          {count === 1 ? ' result' : ' results'}
        </p>
      </div>
      <div className={`flex-1 overflow-y-auto max-h-56 sm:max-h-none p-1 space-y-px ${listClassName}`}>
        {children}
      </div>
    </div>
  )
}

export function EntityRow({
  selected, onClick, title, subtitle, swatch, trailing,
}: {
  selected: boolean
  onClick: () => void
  title: string
  /** One line of the thing that decides which row you want. */
  subtitle?: React.ReactNode
  /** A colour chip — a subject's colour, say. */
  swatch?: string | null
  /** A badge pinned to the right of the title. */
  trailing?: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      aria-current={selected ? 'true' : undefined}
      className={`relative w-full text-left pl-3 pr-2.5 py-2 min-h-[2.75rem] sm:min-h-0 text-sm ${TAP} ${FOCUS} ${
        selected ? 'bg-[#27272A] text-white' : 'text-[#3F3F46] hover:bg-[#EBEBEB]'
      }`}
    >
      {/* The gold bar is what ties the selection to the rest of the workspace;
          a black block on its own read as a different design. */}
      {selected && <span aria-hidden className="absolute left-0 top-0 bottom-0 w-[3px] bg-[#B8983C]" />}
      <span className="flex items-center gap-2">
        {swatch !== undefined && (
          <span
            className="w-2.5 h-2.5 flex-shrink-0"
            style={{ background: swatch || '#94a3b8' }}
            aria-hidden
          />
        )}
        <span className="font-medium truncate flex-1 min-w-0">{title}</span>
        {trailing}
      </span>
      {subtitle && (
        <span className={`block text-[11px] truncate mt-px ${selected ? 'text-white/60' : 'text-[#A1A1AA]'}`}>
          {subtitle}
        </span>
      )}
    </button>
  )
}

/** The detail pane's heading — name, chips, and whatever the hub hangs on it. */
export function DetailHeader({
  icon: Icon, children, meta, right, below,
}: {
  icon: React.ElementType
  children: React.ReactNode
  /** A quiet second line: an email, a subject code. */
  meta?: React.ReactNode
  right?: React.ReactNode
  /** The tab strip, when the hub has one. */
  below?: React.ReactNode
}) {
  return (
    <div className="px-3 sm:px-4 pt-3 pb-2 border-b border-[#E4E4E7]">
      <div className="flex items-center gap-2 flex-wrap">
        <Icon size={16} className="text-[#71717A] flex-shrink-0" aria-hidden />
        <span className="font-semibold text-[#18181B] min-w-0">{children}</span>
        {meta && <span className="text-xs text-[#A1A1AA] truncate">{meta}</span>}
        {right && <span className="ml-auto flex items-center gap-2">{right}</span>}
      </div>
      {below && <div className="mt-2">{below}</div>}
    </div>
  )
}

/** Nothing selected yet. */
export function EmptyDetail({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex-1 flex items-center justify-center text-sm text-[#A1A1AA] p-6">
      {children}
    </div>
  )
}

/**
 * The two-column shell every hub sits in: the list stacked above the detail on
 * a phone, side by side from `sm` up.
 */
export function EntityShell({
  list, children, listWidth = '16rem',
}: {
  list: React.ReactNode
  children: React.ReactNode
  listWidth?: string
}) {
  return (
    <div
      className="flex flex-col sm:grid sm:h-full border border-[#E4E4E7]"
      style={{ ['--list-w' as string]: listWidth, gridTemplateColumns: `var(--list-w) 1fr` }}
    >
      {list}
      <div className="min-w-0 min-h-0 flex flex-col">{children}</div>
    </div>
  )
}
