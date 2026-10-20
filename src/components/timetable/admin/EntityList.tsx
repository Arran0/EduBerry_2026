'use client'

import React from 'react'
import { Search, X } from 'lucide-react'
import { FOCUS } from '../ui'

// ============================================================
// The left column of the Classes / Teachers / Subjects editors.
//
// All three are the same thing — a searchable list beside a detail pane — so
// they share one implementation, and a change to the pattern is a change to
// the pattern.
//
// Inside the popup's solid sheet: the list sits on a warm well with a hairline
// against the detail pane; the selected row is lifted to white with the gold
// bar the rest of the workspace accents with. Names wrap rather than clip.
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
  /** A control under the search box — "Rooms", say. */
  actions?: React.ReactNode
  listClassName?: string
}) {
  const filtering = total != null && total !== count

  return (
    <div className="border-b sm:border-b-0 sm:border-r border-[#EEEAE1] bg-[#FAF8F3] flex flex-col min-h-0 min-w-0">
      <div className="p-2.5 border-b border-[#EEEAE1] space-y-2 sticky top-0 bg-[#FAF8F3] z-10">
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" aria-hidden />
          <input
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder={placeholder}
            aria-label={placeholder}
            className={`w-full h-10 sm:h-9 rounded-[10px] bg-white border border-[#DDD8CC] pl-8 ${query ? 'pr-8' : 'pr-3'} text-[13.5px] text-slate-900 placeholder:text-slate-400 shadow-[inset_0_1px_2px_rgba(15,23,42,.04)] focus:outline-none focus:border-[#B8983C] focus:ring-2 focus:ring-[#B8983C]/20 transition`}
          />
          {query && (
            <button
              onClick={() => onQuery('')}
              aria-label="Clear search"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full inline-flex items-center justify-center text-slate-400 hover:text-slate-900 hover:bg-slate-100 transition"
            >
              <X size={13} />
            </button>
          )}
        </div>
        {actions}
        <p className="text-[11.5px] font-medium text-slate-400 px-0.5 tabular-nums">
          {filtering ? `${count} of ${total}` : count}
          {count === 1 ? ' result' : ' results'}
        </p>
      </div>
      <div className={`flex-1 overflow-y-auto overscroll-contain max-h-60 sm:max-h-none ${listClassName}`}>
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
      className={`relative w-full text-left pl-3.5 pr-3 py-2.5 sm:py-2 border-b border-[#EEEAE1]/70 transition-colors ${FOCUS} ${
        selected ? 'bg-white text-slate-900' : 'text-slate-700 hover:bg-white/70'
      }`}
    >
      {selected && <span aria-hidden className="absolute left-0 top-0 bottom-0 w-[3px] bg-[#B8983C]" />}
      <span className="flex items-start gap-2">
        {swatch !== undefined && (
          <span
            className="w-2.5 h-2.5 rounded-[3px] flex-shrink-0 mt-[5px]"
            style={{ background: swatch || '#94a3b8' }}
            aria-hidden
          />
        )}
        <span className={`text-[13.5px] leading-snug break-words flex-1 min-w-0 ${selected ? 'font-semibold' : 'font-medium'}`}>{title}</span>
        {trailing && <span className="flex-shrink-0 mt-px">{trailing}</span>}
      </span>
      {subtitle && (
        <span className="block text-[11.5px] leading-snug break-words mt-0.5 text-slate-400">
          {subtitle}
        </span>
      )}
    </button>
  )
}

/** The detail pane's heading — name, chips, and whatever the editor hangs on it. */
export function DetailHeader({
  icon: Icon, children, meta, right, below,
}: {
  icon: React.ElementType
  children: React.ReactNode
  /** A quiet second line: an email, a subject code. */
  meta?: React.ReactNode
  right?: React.ReactNode
  /** The tab strip, when the editor has one. */
  below?: React.ReactNode
}) {
  return (
    <div className="px-3.5 sm:px-5 pt-3.5 pb-3 border-b border-[#EEEAE1]">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex items-start gap-2 min-w-0 flex-1 basis-[200px]">
          <Icon size={16} className="text-slate-400 flex-shrink-0 mt-[3px]" aria-hidden />
          <div className="min-w-0">
            <div className="font-display text-[15.5px] font-bold text-slate-900 leading-snug break-words">{children}</div>
            {meta && <div className="text-[12px] text-slate-400 break-words">{meta}</div>}
          </div>
        </div>
        {right && <div className="flex flex-wrap items-center gap-2 min-w-0 max-w-full">{right}</div>}
      </div>
      {below && <div className="mt-3">{below}</div>}
    </div>
  )
}

/** Nothing selected yet. */
export function EmptyDetail({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex-1 flex items-center justify-center text-[13px] text-slate-400 p-8 text-center">
      {children}
    </div>
  )
}

/**
 * The two-column shell every editor sits in: the list stacked above the
 * detail on a phone, side by side from sm up.
 */
export function EntityShell({
  list, children, listWidth = '17rem',
}: {
  list: React.ReactNode
  children: React.ReactNode
  listWidth?: string
}) {
  return (
    <div
      className="flex flex-col sm:grid sm:h-full min-h-0 sm:[grid-template-columns:var(--list-w)_minmax(0,1fr)]"
      style={{ ['--list-w' as string]: listWidth }}
    >
      {list}
      <div className="min-w-0 min-h-0 flex flex-col">{children}</div>
    </div>
  )
}
