'use client'

import React from 'react'

/**
 * Shared container width for the whole exam app. Matches the home page
 * (`max-w-7xl`) so the exam space uses the full desktop width rather than
 * leaving wide gutters, while staying centred on very large monitors.
 */
export const EXAM_MAX_W = 'max-w-7xl'

export interface MiniNavItem {
  id: string
  label: string
  icon?: React.ReactNode
  onClick?: () => void
  active?: boolean
  disabled?: boolean
  title?: string
  /** Optional count rendered as a trailing pill — lets a tab carry its own
   *  size without a second line of chrome. */
  badge?: number | string
}

/**
 * A compact segmented navigation bar. Items are spread evenly across the full
 * width of their container (each is `flex-1`), giving the Apple-style segmented
 * control used across the admin spaces: a recessed track with a single raised
 * pill riding over it. Works both as a tab switcher (pass `active`) and as a
 * cross-page navigation row.
 */
export default function MiniNav({
  items,
  className = '',
}: {
  items: MiniNavItem[]
  className?: string
}) {
  return (
    <div
      className={`flex gap-1 rounded-2xl border border-[#E4E1D8] bg-[#F2F0EA] p-1 shadow-[inset_0_1px_2px_rgba(28,28,31,0.05)] ${className}`}
    >
      {items.map(it => (
        <button
          key={it.id}
          onClick={it.onClick}
          disabled={it.disabled}
          title={it.title}
          className={`flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-sm font-semibold transition-all duration-200 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 ${
            it.active
              ? 'bg-gradient-to-b from-[#3A3A3E] to-[#1C1C1F] text-white shadow-[0_2px_8px_-2px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.12)] ring-1 ring-inset ring-[#B8983C]/40'
              : 'text-[#71717A] hover:bg-white/70 hover:text-[#27272A]'
          }`}
        >
          {it.icon}
          <span className="truncate">{it.label}</span>
          {it.badge !== undefined && it.badge !== '' && (
            <span
              className={`ml-0.5 rounded-full px-1.5 py-px text-[10px] font-bold tabular-nums leading-[1.4] ${
                it.active ? 'bg-white/15 text-[#E8DCB4]' : 'bg-[#E4E1D8] text-[#8A8578]'
              }`}
            >
              {it.badge}
            </span>
          )}
        </button>
      ))}
    </div>
  )
}
