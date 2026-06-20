'use client'

import React from 'react'

/**
 * Shared container width for the whole exam app. The exam screens are
 * data-dense (question sheets, grading queues, result grids) so they get a
 * generous, near-full-width canvas while staying centred on very large monitors.
 */
export const EXAM_MAX_W = 'max-w-[1600px]'

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
      className={`flex gap-1 rounded-2xl border border-slate-200 bg-white/80 p-1.5 shadow-sm backdrop-blur ${className}`}
    >
      {items.map(it => (
        <button
          key={it.id}
          onClick={it.onClick}
          disabled={it.disabled}
          title={it.title}
          className={`flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium transition-all active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 ${
            it.active
              ? 'bg-amber-50 text-amber-600 shadow-sm'
              : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'
          }`}
        >
          {it.icon}
          <span className="truncate">{it.label}</span>
        </button>
      ))}
    </div>
  )
}
