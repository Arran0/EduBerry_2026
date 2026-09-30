'use client'

import React from 'react'
import { Loader2, Search, X } from 'lucide-react'

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

/**
 * A <select> inside the toolbar. `pl-7` leaves room for a leading icon.
 *
 * `text-ellipsis` rather than `truncate`: a <select> is not a text box, and
 * `overflow: hidden` on one clips the label instead of shortening it — which
 * is how "All Grades (120)" ended up cut off mid-word on a phone. The real
 * fix is the width the controls get (see the grid below); this is the
 * backstop.
 */
export const toolbarSelect =
  'h-9 w-full min-w-0 appearance-none cursor-pointer text-ellipsis rounded-lg border border-[#E4E4E7] bg-white ' +
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
    // An explicit width rather than flex-1. A <select> sized by flex-basis
    // ends up as narrow as the row wants it, which is what clipped these
    // labels; 9.5rem is measured against the longest label any of them
    // carries ("Non-Teaching (12)") at this font size.
    <div className={`relative w-full min-w-0 lg:w-[9.5rem] ${className}`}>
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
    // A shallower overlap on a phone: the banner is proportionally taller
    // there and the card is two rows deep, so the wide-screen -mt-7 pulled it
    // up into the title.
    <div className="relative z-20 -mt-4 mb-3 sm:-mt-7">
      <div className="rounded-2xl border border-[#E4E4E7] bg-white p-2 shadow-[0_12px_32px_-14px_rgba(24,24,27,0.45)] sm:p-2.5">
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

          {/* Four controls sharing one phone-width row left each about 80px —
              not enough for "All Sections", let alone the count after it, so
              the labels were cut off mid-word. Two per row below `lg` gives
              every one of them room to be read in full; they only flow into a
              single row once the viewport can actually hold one. */}
          {(controls || onClearFilters || actions) && (
            <div className="grid min-w-0 grid-cols-2 items-center gap-1.5 lg:flex lg:w-auto">
              {controls}
              {onClearFilters && (
                <button
                  onClick={onClearFilters}
                  className="col-span-2 flex h-9 flex-shrink-0 items-center justify-center gap-1 rounded-lg border border-[#D4D4D8] bg-[#F4F4F5] px-2.5 text-[11px] font-semibold text-[#52525B] transition-colors hover:border-[#71717A] hover:bg-[#E4E4E7] hover:text-[#18181B] lg:col-auto"
                >
                  <X size={11} /> Clear filters
                </button>
              )}
              {actions && (
                <div className="col-span-2 flex flex-shrink-0 items-center gap-1.5 lg:col-auto lg:border-l lg:border-[#E4E4E7] lg:pl-1.5 [&>*]:flex-1 lg:[&>*]:flex-none">
                  {actions}
                </div>
              )}
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
export function ListSentinel({ sentinelRef, hasMore, shown, total, onLoadMore, noun, loadingMore = false }: {
  sentinelRef: (node: HTMLElement | null) => void
  hasMore: boolean
  shown: number
  total: number
  onLoadMore: () => void
  noun: string
  /** Server-paged lists show that the next page is actually in flight. */
  loadingMore?: boolean
}) {
  if (total === 0) return null
  return (
    <div ref={sentinelRef} className="flex items-center justify-center gap-3 border-t border-[#E4E4E7] bg-[#FAFAFA] px-4 py-2.5">
      <span className="text-[11px] text-[#A1A1AA]">
        {shown} of {total} {noun}
      </span>
      {loadingMore ? (
        <span className="flex items-center gap-1.5 text-[11px] text-[#A1A1AA]">
          <Loader2 size={11} className="animate-spin" /> Loading…
        </span>
      ) : hasMore ? (
        <button
          onClick={onLoadMore}
          className="rounded-lg border border-[#D4D4D8] bg-white px-3 py-1 text-[11px] font-semibold text-[#3F3F46] transition-colors hover:border-[#71717A] hover:bg-[#F4F4F5]"
        >
          Show more
        </button>
      ) : null}
    </div>
  )
}
