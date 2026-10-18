'use client'

import React from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Search, X } from 'lucide-react'

/**
 * The pieces the staff attendance report is built from, shared by its School
 * staff and Support staff sides so the two can only ever look alike: the
 * summary, the Absent / Present / Irregular segmented control, the search
 * field, the row list, the quick-set capsule, and the loading and empty states.
 */

/** The Documents and Day setup popups share one fixed height. */
export const SETUP_SHEET_HEIGHT = 'h-[min(36rem,90dvh)]'

export type ReportTabKey = 'absent' | 'present' | 'irregular'

const TAB_META: Record<ReportTabKey, { label: string; tone: string }> = {
  absent: { label: 'Absent', tone: 'bg-red-500' },
  present: { label: 'Present', tone: 'bg-emerald-500' },
  irregular: { label: 'Irregular', tone: 'bg-amber-500' },
}

/** One list at a time — an iOS segmented control with a sliding white thumb. */
export function ReportTabs({ value, onChange, counts, layoutId }: {
  value: ReportTabKey
  onChange: (key: ReportTabKey) => void
  /** null while the day loads — the tabs stay put, their numbers wait. */
  counts: Record<ReportTabKey, number> | null
  /** Unique per control on the page so two thumbs never animate into each other. */
  layoutId: string
}) {
  return (
    <div className="relative grid grid-cols-3 p-1 rounded-full bg-[#F1EEE8]" role="tablist" aria-label="Attendance lists">
      {(Object.keys(TAB_META) as ReportTabKey[]).map(key => {
        const active = value === key
        return (
          <button
            key={key}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(key)}
            className={`relative h-8 rounded-full text-[12.5px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B8983C]/60 ${
              active ? 'text-slate-900' : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            {active && (
              <motion.span
                layoutId={layoutId}
                className="absolute inset-0 rounded-full bg-white shadow-[0_1px_2px_rgba(15,23,42,0.08),0_4px_12px_-4px_rgba(15,23,42,0.25)]"
                transition={{ type: 'spring', stiffness: 420, damping: 34 }}
              />
            )}
            <span className="relative z-10 inline-flex items-center justify-center gap-1.5">
              <span className={`w-1.5 h-1.5 rounded-full ${TAB_META[key].tone} ${active ? '' : 'opacity-50'}`} />
              {TAB_META[key].label}
              <span className={`tabular-nums text-[11px] ${active ? 'text-slate-500' : 'text-slate-400'}`}>{counts ? counts[key] : '–'}</span>
            </span>
          </button>
        )
      })}
    </div>
  )
}

export function ReportSearch({ value, onChange, placeholder }: {
  value: string
  onChange: (v: string) => void
  placeholder: string
}) {
  return (
    <div className="relative flex-1 min-w-0">
      <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full h-9 pl-9 pr-8 text-sm rounded-full bg-[#F4F2EE] border border-transparent placeholder:text-slate-400 focus:outline-none focus:bg-white focus:border-[#B8983C]/60 focus:ring-2 focus:ring-[#B8983C]/15 transition"
      />
      {value && (
        <button onClick={() => onChange('')} aria-label="Clear search" className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-800">
          <X size={14} />
        </button>
      )}
    </div>
  )
}

export function ReportRowList({ children }: { children: React.ReactNode }) {
  return (
    <div className="sa-list rounded-2xl border border-[#27272A]/[0.07] overflow-hidden bg-white">
      <AnimatePresence initial={false}>{children}</AnimatePresence>
    </div>
  )
}

export function ReportEmpty({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[13px] text-slate-500 bg-[#FAF9F6] border border-[#27272A]/[0.05] px-4 py-6 rounded-2xl text-center">
      {children}
    </p>
  )
}

/** A row's tap-to-mark capsule (P / A / Late / ½ / Exception). */
export const QUICK_GROUP = 'flex items-center gap-0.5 p-0.5 rounded-[11px] bg-[#F1EEE8] flex-shrink-0'
export function quickButtonClass(active: boolean, activeClass: string, wordLabel: boolean): string {
  return `relative h-6 sm:h-7 font-bold border rounded-[9px] transition-all disabled:opacity-40 active:scale-95 flex items-center justify-center ${
    wordLabel ? 'px-1.5 text-[7px] sm:text-[7.5px] uppercase tracking-tight' : 'w-6 sm:w-7 text-[10px] sm:text-xs'
  } ${
    active
      ? `${activeClass} shadow-[0_2px_6px_-2px_rgba(15,23,42,0.35)]`
      : 'border-transparent text-slate-400 hover:bg-white hover:text-slate-900'
  }`
}

export const ROW_CLASS = 'flex items-center gap-2.5 sm:gap-3 px-2.5 sm:px-3.5 py-2.5 bg-white hover:bg-[#FAF9F6] transition-colors'
export const ROW_NAME_CLASS = 'text-[13.5px] font-semibold text-slate-900 truncate leading-tight hover:text-[#8A6F22] text-left transition-colors'

/**
 * The present / total head of the report: a big count, a gold meter and a
 * line of detail. Drawn at the same height whether loading or not.
 */
export function ReportSummary({ present, total, pct, loading, detail, action }: {
  present: number
  total: number | null
  pct: number
  loading: boolean
  detail: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <>
      <div className="flex items-baseline gap-1">
        <span className="font-display text-[2rem] font-bold text-slate-900 leading-none tabular-nums headline">
          {loading ? '—' : present}
        </span>
        <span className="text-sm font-semibold text-slate-400 tabular-nums">/ {loading || total === null ? '…' : total}</span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="h-2 bg-[#EEEBE5] rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{ width: `${loading ? 0 : pct}%`, background: 'linear-gradient(90deg, #CBAB55, #B8983C)' }}
          />
        </div>
        <div className="text-[12px] text-slate-500 mt-1.5 flex items-center gap-1.5 flex-wrap min-h-[18px]">{detail}</div>
      </div>
      {action}
    </>
  )
}

/** Rows in grey while a day loads — the list keeps its shape instead of collapsing to a spinner. */
export function ReportListSkeleton({ rows = 7 }: { rows?: number }) {
  return (
    <div aria-busy="true" aria-label="Loading">
      <div className="sa-list rounded-2xl border border-[#27272A]/[0.07] overflow-hidden bg-white">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 px-3.5 py-2.5">
            <span className="w-8 h-8 rounded-full bg-[#EEEBE5] animate-pulse flex-shrink-0" />
            <span className="flex-1 min-w-0 space-y-1.5">
              <span className="block h-3 rounded bg-[#EEEBE5] animate-pulse" style={{ width: `${38 + ((i * 17) % 30)}%` }} />
              <span className="block h-2.5 w-20 rounded bg-[#F4F2EE] animate-pulse" />
            </span>
            <span className="h-7 w-36 rounded-[11px] bg-[#F4F2EE] animate-pulse hidden sm:block" />
          </div>
        ))}
      </div>
    </div>
  )
}
