'use client'

import React from 'react'
import { Search, X } from 'lucide-react'

/**
 * The search + filter bar that every admin manager floats over the bottom of
 * its PageBanner.
 *
 * Each page used to lay its own controls half onto the banner directly: a
 * shadowed search input on one page, a hand-rolled `marginTop: -22px` row of
 * bare <select>s on another, and a "Clear filters" button with no background at
 * all — which, sitting on the banner's photograph, was invisible. Here the
 * whole bar is one opaque card with a single overlap, so the controls read as
 * one component of the page rather than as loose elements dropped on artwork,
 * and nothing depends on what the banner behind it happens to look like.
 */

/** A <select> inside the toolbar. `pl-7` leaves room for a leading icon. */
export const toolbarSelect =
  'h-9 w-full min-w-0 appearance-none cursor-pointer truncate rounded-lg border border-[#E4E4E7] bg-white ' +
  'pl-2.5 pr-6 text-[11px] font-medium text-[#3F3F46] transition-colors ' +
  'hover:border-[#A1A1AA] focus:outline-none focus:border-[#27272A]'

export const toolbarSelectWithIcon = toolbarSelect.replace('pl-2.5', 'pl-7')

/** Caret drawn by us — `appearance-none` removes the native one. */
export function ToolbarCaret() {
  return (
    <svg
      viewBox="0 0 8 5" aria-hidden
      className="pointer-events-none absolute right-2 top-1/2 h-[5px] w-2 -translate-y-1/2 fill-[#A1A1AA]"
    >
      <path d="M0 0h8L4 5z" />
    </svg>
  )
}

/** Wraps a toolbar control so it shares the row evenly and can carry an icon. */
export function ToolbarField({ icon, children, className = '' }: {
  icon?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={`relative min-w-0 flex-1 ${className}`}>
      {icon && (
        <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[#A1A1AA]">
          {icon}
        </span>
      )}
      {children}
      <ToolbarCaret />
    </div>
  )
}

interface PageToolbarProps {
  search: string
  onSearchChange: (value: string) => void
  searchPlaceholder: string
  /** Filter/sort controls — wrap each in <ToolbarField>. */
  controls?: React.ReactNode
  /** Buttons that sit at the end of the row (e.g. "Sync Students"). */
  actions?: React.ReactNode
  /** When set, a visible "Clear" chip is shown at the end of the controls. */
  onClearFilters?: () => void
  /** e.g. "30 of 325 shown" — rendered under the row on wide screens. */
  summary?: React.ReactNode
}

export default function PageToolbar({
  search, onSearchChange, searchPlaceholder,
  controls, actions, onClearFilters, summary,
}: PageToolbarProps) {
  return (
    <div className="relative z-20 -mt-7 mb-3">
      <div className="rounded-2xl border border-[#E4E4E7] bg-white p-2 shadow-[0_12px_32px_-14px_rgba(24,24,27,0.45)]">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
          {/* Search */}
          <div className="relative min-w-0 flex-1">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#A1A1AA]" />
            <input
              type="text"
              value={search}
              onChange={e => onSearchChange(e.target.value)}
              placeholder={searchPlaceholder}
              className="h-9 w-full rounded-lg border border-transparent bg-[#F4F4F5] pl-9 pr-8 text-sm text-[#18181B] transition-colors placeholder:text-[#A1A1AA] focus:border-[#27272A] focus:bg-white focus:outline-none"
            />
            {search && (
              <button
                onClick={() => onSearchChange('')}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-[#71717A] transition-colors hover:bg-[#E4E4E7] hover:text-[#18181B]"
              >
                <X size={12} />
              </button>
            )}
          </div>

          {(controls || onClearFilters || actions) && (
            <div className="flex min-w-0 items-center gap-1.5 lg:w-auto">
              {controls}
              {onClearFilters && (
                <button
                  onClick={onClearFilters}
                  className="flex h-9 flex-shrink-0 items-center gap-1 rounded-lg border border-[#D4D4D8] bg-[#F4F4F5] px-2.5 text-[11px] font-semibold text-[#52525B] transition-colors hover:border-[#71717A] hover:bg-[#E4E4E7] hover:text-[#18181B]"
                >
                  <X size={11} /> Clear
                </button>
              )}
              {actions && <div className="flex flex-shrink-0 items-center gap-1.5 lg:border-l lg:border-[#E4E4E7] lg:pl-1.5">{actions}</div>}
            </div>
          )}
        </div>

        {summary && (
          <p className="mt-1.5 px-1 text-[11px] text-[#A1A1AA]">{summary}</p>
        )}
      </div>
    </div>
  )
}

/**
 * Bottom of an infinitely-scrolled list: the element the observer watches,
 * plus a manual button for anyone who never triggers it (keyboard paging,
 * reduced-motion, a very tall viewport).
 */
export function ListSentinel({ sentinelRef, hasMore, shown, total, onLoadMore, noun }: {
  sentinelRef: (node: HTMLElement | null) => void
  hasMore: boolean
  shown: number
  total: number
  onLoadMore: () => void
  noun: string
}) {
  if (total === 0) return null
  return (
    <div ref={sentinelRef} className="flex items-center justify-center gap-3 border-t border-[#E4E4E7] bg-[#FAFAFA] px-4 py-3">
      <span className="text-[11px] text-[#A1A1AA]">
        {shown} of {total} {noun}
      </span>
      {hasMore && (
        <button
          onClick={onLoadMore}
          className="rounded-lg border border-[#D4D4D8] bg-white px-3 py-1 text-[11px] font-semibold text-[#3F3F46] transition-colors hover:border-[#71717A] hover:bg-[#F4F4F5]"
        >
          Show more
        </button>
      )}
    </div>
  )
}
