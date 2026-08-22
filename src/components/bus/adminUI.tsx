'use client'

import React from 'react'

// ──────────────────────────────────────────────────────────────
// Shared "professional admin" design tokens for the Bus Manager.
// Zinc neutrals + honey-gold accent, sharp cards (no floating
// rounded-2xl white cards). Mirrors the Fee Manager aesthetic so
// the two admin surfaces feel like one product.
// ──────────────────────────────────────────────────────────────

export const ADMIN = {
  pageBg: '#FDFCF9',
  card: 'bg-white border border-[#E4E4E7] rounded-xl',
  cardHover: 'bg-white border border-[#E4E4E7] rounded-xl shadow-sm hover:shadow-md transition-shadow',
  input:
    'w-full bg-white border border-[#E4E4E7] rounded-lg pl-9 pr-9 py-2.5 text-sm text-[#27272A] placeholder:text-[#A1A1AA] focus:outline-none focus:border-[#27272A] transition-colors',
  inputPlain:
    'w-full bg-white border border-[#E4E4E7] rounded-lg px-3 py-2.5 text-sm text-[#27272A] placeholder:text-[#A1A1AA] focus:outline-none focus:border-[#27272A] transition-colors',
  label: 'text-[10px] font-bold uppercase tracking-widest text-[#71717A]',
  darkBtn:
    'flex items-center justify-center gap-1.5 bg-[#27272A] hover:bg-[#18181B] text-white text-xs font-semibold px-3 py-2 rounded-lg transition-colors disabled:opacity-50',
  ghostBtn:
    'flex items-center justify-center gap-1.5 bg-white border border-[#E4E4E7] text-[#71717A] hover:text-[#27272A] hover:border-[#D4D4D8] text-xs font-semibold px-3 py-2 rounded-lg transition-colors disabled:opacity-50',
}

// ──────────────────────────────────────────────────────────────
// Excel-style line list (mirrors the Profile Manager table).
// Replaces floating rounded white cards with dense bordered rows
// under a dark column header. Each row carries a thin colour bar.
// ──────────────────────────────────────────────────────────────

export const SHEET = {
  wrap: 'border border-[#E4E4E7] rounded-xl overflow-hidden bg-white',
  header: 'hidden sm:flex items-center gap-3 bg-[#27272A] px-4 py-2.5',
  headCell: 'text-[10px] font-bold uppercase tracking-widest text-[#A1A1AA]',
  row: 'flex items-stretch border-b border-[#F4F4F5] last:border-b-0 hover:bg-[#FAFAFA] transition-colors',
  bar: 'w-1 flex-shrink-0',
}

/** A bordered sheet container with an optional dark column header. */
export function Sheet({
  columns, children, className = '',
}: {
  columns?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={`${SHEET.wrap} ${className}`}>
      {columns && <div className={SHEET.header}>{columns}</div>}
      {children}
    </div>
  )
}

/**
 * Placeholder row matching SHEET.row's shape — the colour bar, a leading
 * avatar/icon circle, two text lines, and a couple of trailing pill-shaped
 * placeholders — for a Sheet table's loading state. Approximates rather
 * than pixel-matches any one table's exact columns, since Sheet is reused
 * across several differently-shaped admin tables; it reads correctly as
 * "a row of this table is loading" in all of them.
 */
export function SheetRowSkeleton() {
  return (
    <div className={`${SHEET.row} animate-pulse`}>
      <div className={`${SHEET.bar} bg-[#E4E4E7]`} />
      <div className="flex items-center gap-2.5 flex-1 min-w-0 px-3 py-2.5">
        <div className="w-7 h-7 rounded-md bg-[#E4E4E7] flex-shrink-0" />
        <div className="flex-1 min-w-0 space-y-1.5 py-0.5">
          <div className="h-2.5 w-32 rounded-full bg-[#E4E4E7]" />
          <div className="h-2 w-20 rounded-full bg-[#E4E4E7]" />
        </div>
        <div className="hidden sm:block h-4 w-24 rounded-full bg-[#E4E4E7] flex-shrink-0" />
        <div className="h-4 w-10 rounded-full bg-[#E4E4E7] flex-shrink-0" />
      </div>
    </div>
  )
}

export interface TabDef<T extends string> {
  key: T
  label: string
  icon?: React.ReactNode
}

// ──────────────────────────────────────────────────────────────
// Style A — top-level hub tabs (Trips / Bus Fees / Driver Payroll)
// Underline indicator with a honey-gold active rule. Deliberately
// distinct from the filled segmented control used for sub-sections.
// ──────────────────────────────────────────────────────────────

export function HubTabs<T extends string>({
  tabs, value, onChange, className = '',
}: {
  tabs: TabDef<T>[]
  value: T
  onChange: (key: T) => void
  className?: string
}) {
  return (
    <div className={`flex items-stretch bg-white rounded-xl border border-[#E4E4E7] shadow-sm overflow-hidden ${className}`}>
      {tabs.map((t, i) => {
        const active = value === t.key
        return (
          <button
            key={t.key}
            onClick={() => onChange(t.key)}
            className={`relative flex flex-1 items-center justify-center gap-1.5 px-2 sm:px-5 py-3.5 text-sm font-semibold whitespace-nowrap transition-colors ${
              i > 0 ? 'border-l border-[#F0F0F0]' : ''
            } ${active ? 'text-[#27272A]' : 'text-[#A1A1AA] hover:text-[#52525B] hover:bg-[#FAFAFA]'}`}
          >
            {t.icon}
            <span>{t.label}</span>
            <span
              className={`absolute left-4 right-4 sm:left-6 sm:right-6 bottom-0 h-[3px] rounded-t-full transition-colors ${
                active ? 'bg-[#B8983C]' : 'bg-transparent'
              }`}
            />
          </button>
        )
      })}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
// Style B — underline tab bar for sub-sections
// (Fee Heads / Issued Fees) and (Pay Cycles / Base / Bank).
// ──────────────────────────────────────────────────────────────

export function SegTabs<T extends string>({
  tabs, value, onChange, className = '',
}: {
  tabs: TabDef<T>[]
  value: T
  onChange: (key: T) => void
  className?: string
}) {
  return (
    <div className={`flex border-b border-[#E4E4E7] ${className}`}>
      {tabs.map(t => {
        const active = value === t.key
        return (
          <button
            key={t.key}
            onClick={() => onChange(t.key)}
            className={`flex-1 flex items-center justify-center gap-1 sm:gap-1.5 pb-2 text-xs sm:text-sm font-semibold border-b-2 -mb-px transition-colors ${
              active ? 'border-[#27272A] text-[#18181B]' : 'border-transparent text-[#A1A1AA] hover:text-[#71717A]'
            }`}
          >
            {t.icon}
            <span className="truncate">{t.label}</span>
          </button>
        )
      })}
    </div>
  )
}
