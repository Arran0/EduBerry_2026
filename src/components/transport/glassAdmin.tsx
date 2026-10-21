'use client'

/**
 * The bus app's admin tokens, in glass.
 *
 * Same names and shapes as components/bus/adminUI (ADMIN, SHEET, Sheet,
 * SheetRowSkeleton, SegTabs, EmptyRow), so every transport panel and popup —
 * WhatsApp, GPS, scanning, replay, incidents, reports, the forms — moved to
 * the glass language by changing one import. adminUI itself stays as it was:
 * the salary pages share it.
 */

import React from 'react'
import { motion } from 'framer-motion'
import type { TabDef } from '@/components/bus/adminUI'

export const ADMIN = {
  pageBg: '#EEF1F5',
  shell: 'w-full mx-auto max-w-7xl 2xl:max-w-[1600px]',
  shellWidth: 'max-w-7xl 2xl:max-w-[1600px]',
  card: 'bg-white/90 border border-slate-200/70 rounded-2xl shadow-[0_1px_2px_rgba(15,23,42,.04)]',
  cardHover: 'bg-white/90 border border-slate-200/70 rounded-2xl shadow-[0_1px_2px_rgba(15,23,42,.04)] hover:shadow-[0_12px_26px_-16px_rgba(15,23,42,.4)] transition-shadow',
  input:
    'w-full h-10 bg-white/90 border border-slate-200/80 rounded-xl pl-9 pr-9 text-sm text-slate-900 placeholder:text-slate-400 shadow-[inset_0_1px_2px_rgba(15,23,42,.05)] focus:outline-none focus:border-[#F5B800] focus:ring-2 focus:ring-[#F5B800]/20 transition',
  inputPlain:
    'w-full h-10 bg-white/90 border border-slate-200/80 rounded-xl px-3 text-sm text-slate-900 placeholder:text-slate-400 shadow-[inset_0_1px_2px_rgba(15,23,42,.05)] focus:outline-none focus:border-[#F5B800] focus:ring-2 focus:ring-[#F5B800]/20 transition',
  label: 'text-[10px] font-bold uppercase tracking-wider text-slate-500',
  darkBtn:
    'inline-flex items-center justify-center gap-1.5 h-9 px-3.5 rounded-full text-[12.5px] font-semibold text-white bg-gradient-to-b from-[#1B3F8A] to-[#13306B] shadow-[inset_0_1px_0_rgba(255,255,255,.16),0_6px_14px_-8px_rgba(15,23,42,.6)] hover:from-[#24509F] hover:to-[#16387A] active:scale-[0.97] transition disabled:opacity-50 disabled:pointer-events-none',
  ghostBtn:
    'inline-flex items-center justify-center gap-1.5 h-9 px-3.5 rounded-full text-[12.5px] font-semibold text-slate-700 bg-white/85 border border-white shadow-[0_1px_2px_rgba(15,23,42,.06),0_6px_14px_-10px_rgba(15,23,42,.35)] hover:bg-white hover:text-slate-900 active:scale-[0.97] transition disabled:opacity-50 disabled:pointer-events-none',
}

export const SHEET = {
  wrap: 'rounded-2xl border border-slate-200/70 bg-white/80 overflow-hidden',
  header: 'hidden sm:flex items-center gap-3 bg-slate-50/90 border-b border-slate-200/70 px-4 py-2',
  headCell: 'text-[10px] font-bold uppercase tracking-wider text-slate-500',
  row: 'flex items-stretch border-b border-slate-200/60 last:border-b-0 hover:bg-white transition-colors',
  bar: 'w-1 flex-shrink-0',
}

export function Sheet({ columns, children, className = '' }: {
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

export function SheetRowSkeleton() {
  return (
    <div className={`${SHEET.row} animate-pulse`}>
      <div className={`${SHEET.bar} bg-slate-200`} />
      <div className="flex items-center gap-2.5 flex-1 min-w-0 px-3 py-2.5">
        <div className="w-7 h-7 rounded-lg bg-slate-200 flex-shrink-0" />
        <div className="flex-1 min-w-0 space-y-1.5 py-0.5">
          <div className="h-2.5 w-32 rounded-full bg-slate-200" />
          <div className="h-2 w-20 rounded-full bg-slate-200" />
        </div>
        <div className="hidden sm:block h-4 w-24 rounded-full bg-slate-200 flex-shrink-0" />
      </div>
    </div>
  )
}

/** Sub-section tabs as a glass segmented control with a sliding thumb. */
export function SegTabs<T extends string>({ tabs, value, onChange, className = '' }: {
  tabs: TabDef<T>[]
  value: T
  onChange: (key: T) => void
  className?: string
}) {
  const id = React.useId()
  return (
    <div className={`lg-pill flex w-full items-center gap-0.5 p-1 overflow-x-auto scrollbar-none ${className}`} role="tablist">
      {tabs.map(t => {
        const active = value === t.key
        return (
          <button
            key={t.key}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.key)}
            className={`relative flex-1 inline-flex items-center justify-center gap-1.5 h-8 px-3 rounded-full text-[12.5px] font-semibold whitespace-nowrap transition-colors ${
              active ? 'text-white' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {active && (
              <motion.span
                layoutId={`seg-${id}`}
                className="absolute inset-0 rounded-full bg-gradient-to-b from-[#1B3F8A] to-[#13306B] shadow-[inset_0_1px_0_rgba(255,255,255,.16)]"
                transition={{ type: 'spring', stiffness: 420, damping: 34 }}
              />
            )}
            <span className="relative z-10 inline-flex items-center gap-1.5">{t.icon}<span className="truncate">{t.label}</span></span>
          </button>
        )
      })}
    </div>
  )
}

export function EmptyRow({ icon, title, detail }: { icon: React.ReactNode; title: string; detail: string }) {
  return (
    <div className="px-4 py-10 text-center">
      <div className="mx-auto w-11 h-11 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center mb-2.5">
        {icon}
      </div>
      <p className="text-sm font-semibold text-slate-700">{title}</p>
      <p className="text-[11.5px] text-slate-500 mt-0.5 max-w-sm mx-auto">{detail}</p>
    </div>
  )
}
