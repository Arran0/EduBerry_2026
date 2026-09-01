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
 * A square segmented control: one hairline-bordered track, tabs divided by
 * hairlines rather than gaps, and the active tab filled with ink and railed
 * in gold along its bottom edge. Works both as a tab switcher (pass `active`)
 * and as a cross-page navigation row.
 */
export default function MiniNav({
  items,
  className = '',
}: {
  items: MiniNavItem[]
  className?: string
}) {
  return (
    <div className={`flex border border-[#E4E1D8] bg-[#FAF9F6] ${className}`}>
      {items.map((it, i) => (
        <button
          key={it.id}
          onClick={it.onClick}
          disabled={it.disabled}
          title={it.title}
          className={`flex min-w-0 flex-1 items-center justify-center gap-1.5 h-10 px-3 text-xs font-semibold uppercase tracking-[0.08em] transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40 ${
            i > 0 ? 'border-l border-[#E4E1D8]' : ''
          } ${
            it.active
              ? 'bg-[#18181B] text-white shadow-[inset_0_-2px_0_#B8983C]'
              : 'text-[#71717A] hover:bg-white hover:text-[#18181B]'
          }`}
        >
          {it.icon}
          <span className="truncate">{it.label}</span>
          {it.badge !== undefined && it.badge !== '' && (
            <span
              className={`ml-0.5 px-1.5 py-px text-[10px] font-bold tabular-nums leading-[1.4] ${
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
