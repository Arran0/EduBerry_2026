'use client'

import React from 'react'

/**
 * Shared container width for the whole exam app — a comfortable, readable
 * single-column canvas that stays centred rather than stretching across very
 * wide monitors.
 */
export const EXAM_MAX_W = 'max-w-5xl'

export interface MiniNavItem {
  id: string
  label: string
  icon?: React.ReactNode
  onClick?: () => void
  active?: boolean
  disabled?: boolean
  title?: string
}

/**
 * A compact segmented navigation bar. Items are spread evenly across the full
 * width of their container (each is `flex-1`), giving the Apple-style segmented
 * control used across the admin spaces. Works both as a tab switcher (pass
 * `active`) and as a cross-page navigation row.
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
      className={`flex gap-1 rounded-xl border border-[#E4E4E7] bg-white p-1 shadow-sm ${className}`}
    >
      {items.map(it => (
        <button
          key={it.id}
          onClick={it.onClick}
          disabled={it.disabled}
          title={it.title}
          className={`flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2.5 text-sm font-semibold transition-all active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 ${
            it.active
              ? 'bg-[var(--page-primary)] text-white shadow-sm'
              : 'text-[#71717A] hover:bg-[#F4F4F5] hover:text-[#27272A]'
          }`}
        >
          {it.icon}
          <span className="truncate">{it.label}</span>
        </button>
      ))}
    </div>
  )
}
