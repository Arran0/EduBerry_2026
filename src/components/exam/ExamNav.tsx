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
      className={`flex gap-1 rounded-2xl border border-[#EAE7DF] bg-white p-1.5 shadow-[0_1px_2px_rgba(28,28,31,0.04)] ${className}`}
    >
      {items.map(it => (
        <button
          key={it.id}
          onClick={it.onClick}
          disabled={it.disabled}
          title={it.title}
          className={`flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 text-sm font-semibold transition-all active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 ${
            it.active
              ? 'bg-gradient-to-br from-[#27272A] to-[#18181B] text-white shadow-[0_4px_12px_-4px_rgba(0,0,0,0.45)] ring-1 ring-inset ring-[#B8983C]/40'
              : 'text-[#71717A] hover:bg-[#F6F5F1] hover:text-[#27272A]'
          }`}
        >
          {it.icon}
          <span className="truncate">{it.label}</span>
        </button>
      ))}
    </div>
  )
}
