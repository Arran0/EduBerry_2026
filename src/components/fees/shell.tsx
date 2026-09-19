'use client'

// ─────────────────────────────────────────────────────────────────────────────
// The Fee module's screen shell.
//
// Every fee screen was drawing its own header bar, its own stat cards and its
// own tab strip. Eight copies drift, and they had: three container widths, two
// card radii and two tab styles across nine pages.
//
// This is one copy, and it speaks the Salary Manager's vocabulary rather than
// a second one of its own — `salary/ui.tsx` is imported, not re-implemented.
// Sharp corners, the warm paper ramp, hairlines instead of shadow. The two
// modules are one product and should read like it.
//
// Desktop gets `max-w-[1600px]`, the same as the payroll sheet: a fee ledger
// is a table, and a 1,152px column on a 2,560px monitor wastes half the screen
// and then makes the reader scroll horizontally inside what is left.
// ─────────────────────────────────────────────────────────────────────────────

import React from 'react'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { TONE, LABEL, BLEED } from '@/components/salary/ui'

export { TONE, LABEL, BLEED, Panel, PanelHead, SectionBar, SearchField, Btn, Chip }
  from '@/components/salary/ui'

/**
 * The page frame: paper background, the wide container, a back link, and a
 * title row that wraps rather than squeezes.
 */
export function FeeScreen({
  title, subtitle, icon, back, actions, children,
}: {
  title: React.ReactNode
  subtitle?: React.ReactNode
  icon: React.ReactNode
  /** Omitted on the hub, which is itself the top of the module. */
  back?: { href: string; label: string }
  actions?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="bg-[#FDFCF9]" style={{ minHeight: '100vh' }}>
      {/* Phones give a dense sheet the whole viewport; the gutter returns at
          the `sm` breakpoint where there is room to spare. */}
      <div className="max-w-[1600px] mx-auto px-0 sm:px-6 lg:px-8 py-3 sm:py-6">
        {back && (
          <div className="px-3 sm:px-0">
            <Link href={back.href}
                  className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase
                             tracking-[0.08em] text-[#8C8878] hover:text-[#18181B] mb-2.5 transition-colors">
              <ArrowLeft size={13} /> {back.label}
            </Link>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 mb-2.5 px-3 sm:px-0">
          <div className="w-9 h-9 bg-[#27272A] flex items-center justify-center flex-shrink-0">
            {icon}
          </div>
          <div className="flex-1 min-w-[150px]">
            <h1 className="font-display text-lg sm:text-xl font-bold text-[#18181B] leading-none truncate">
              {title}
            </h1>
            {subtitle && (
              <p className="text-[10.5px] text-[#8C8878] mt-1 leading-tight">{subtitle}</p>
            )}
          </div>
          {actions && (
            <div className="flex items-center gap-1.5 flex-wrap flex-shrink-0">{actions}</div>
          )}
        </div>

        {children}
      </div>
    </div>
  )
}

export interface Stat {
  label: string
  /** Pre-formatted — the strip never decides how money is written. */
  value: string
  /** Colours the figure. Used sparingly: an amount that needs chasing. */
  tone?: string
  /** Renders larger, for the one figure a row is really about. */
  strong?: boolean
}

/**
 * The summary strip: figures in a hairline grid, value over label.
 *
 * Not cards. Six floating rounded tiles cost a row of vertical space each and
 * push the actual list off the screen — this is the payroll strip's shape,
 * where the gaps are the grid's background showing through a 1px gutter.
 *
 * `loading` renders the same cells with pulsing placeholders, so the strip is
 * exactly as tall before the figures land as after. The old cards used a
 * fixed-height skeleton that did not match the loaded card, and the whole page
 * jumped when a query returned.
 */
/**
 * Tailwind needs the finished class name in the source, so the shapes are
 * spelled out rather than interpolated.
 *
 * Past the `sm` breakpoint a cell is capped at 240px and a filler column takes
 * the rest. Four figures stretched across a 1,600px container put 380px of
 * empty paper between a number and its label, which reads as four unrelated
 * panels rather than one strip.
 */
const STRIP_COLS: Record<number, string> = {
  1: 'grid-cols-1 sm:grid-cols-[minmax(0,240px)_1fr]',
  2: 'grid-cols-2 sm:grid-cols-[repeat(2,minmax(0,240px))_1fr]',
  3: 'grid-cols-3 sm:grid-cols-[repeat(3,minmax(0,240px))_1fr]',
  4: 'grid-cols-2 sm:grid-cols-[repeat(4,minmax(0,240px))_1fr]',
  5: 'grid-cols-2 sm:grid-cols-[repeat(5,minmax(0,220px))_1fr]',
  6: 'grid-cols-3 sm:grid-cols-[repeat(6,minmax(0,200px))_1fr]',
  7: 'grid-cols-3 sm:grid-cols-[repeat(7,minmax(0,180px))_1fr]',
  8: 'grid-cols-3 sm:grid-cols-[repeat(8,minmax(0,170px))_1fr]',
}

export function StatStrip({ stats, loading }: { stats: Stat[]; loading?: boolean }) {
  const cols = STRIP_COLS[stats.length] ?? 'grid-cols-2 sm:grid-cols-[repeat(4,minmax(0,240px))_1fr]'
  return (
    <div className={`bg-white border-[#E3DFD3] ${BLEED} border-y sm:border mb-2.5`}>
      {/* 1px hairlines in both directions: the grid's own background shows
          through a one-pixel gap between the white cells. */}
      <div className={`grid ${cols} gap-px bg-[#F0ECE2]`}>
        {stats.map(s => (
          <div key={s.label} className="px-2.5 py-2 min-w-0 bg-white">
            {loading ? (
              // Same box, same height. The old skeleton was a fixed 74px card
              // that did not match the loaded one, so the page jumped every
              // time a query returned.
              <>
                <div className="h-[19px] w-20 max-w-full bg-[#F4F1E7] animate-pulse" />
                <div className="h-[11px] w-14 max-w-full bg-[#F4F1E7] animate-pulse mt-[3px]" />
              </>
            ) : (
              <>
                <p className={`${s.strong ? 'text-[15px]' : 'text-[13px]'} font-bold tabular-nums truncate leading-[19px] text-[#18181B]`}
                   style={s.tone ? { color: s.tone } : undefined}>
                  {s.value}
                </p>
                <p className={`${LABEL} mt-[3px] leading-[11px] truncate`}>{s.label}</p>
              </>
            )}
          </div>
        ))}
        {/* Fills the rest of the row so the grid's hairline colour does not
            show as a stripe where the cells stop. */}
        <div className="hidden sm:block bg-white" />
      </div>
    </div>
  )
}

export interface TabDef<K extends string> {
  key: K
  label: string
  icon?: React.ElementType
  /** Shown beside the label — a count of what is waiting. */
  badge?: number
}

/**
 * Underline tabs with a gold rule under the live one, the same control the
 * Salary hub uses to switch sections. Scrolls sideways rather than wrapping:
 * six tabs wrapping to a second line moves everything below them down, which
 * is a layout shift every time the window is narrowed.
 */
export function TabBar<K extends string>({
  tabs, active, onChange,
}: {
  tabs: TabDef<K>[]
  active: K
  onChange: (key: K) => void
}) {
  return (
    <div className={`flex border-b border-[#E3DFD3] mb-3 overflow-x-auto no-scrollbar ${BLEED} sm:mx-0 px-3 sm:px-0`}>
      {tabs.map(t => {
        const on = t.key === active
        const Icon = t.icon
        return (
          <button
            key={t.key}
            onClick={() => onChange(t.key)}
            className={`flex-1 min-w-max flex items-center justify-center gap-1.5 px-3 pb-1.5 text-[11px]
                        sm:text-[12px] font-bold uppercase tracking-[0.06em] border-b-2 -mb-px
                        transition-colors whitespace-nowrap ${
              on ? 'border-[#B8983C] text-[#18181B]' : 'border-transparent text-[#A8A395] hover:text-[#6B675A]'
            }`}
          >
            {Icon && <Icon size={13} />}
            <span>{t.label}</span>
            {t.badge !== undefined && t.badge > 0 && (
              <span className={`px-1 py-px text-[9px] leading-none tabular-nums ${
                on ? 'bg-[#B8983C] text-white' : 'bg-[#F4F1E7] text-[#8C8878]'}`}>
                {t.badge}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

/** A full-width notice. `tone` decides whether it reads as news or as a problem. */
export function Notice({
  tone = 'info', children,
}: {
  tone?: 'info' | 'warn' | 'error' | 'good'
  children: React.ReactNode
}) {
  const tones = {
    info:  'bg-[#FAF8F2] border-[#E3DFD3] text-[#52525B]',
    warn:  'bg-[#FAF3DF] border-[#E7D9AE] text-[#7A6220]',
    error: 'bg-[#FCECEC] border-[#EFCCCC] text-[#A93232]',
    good:  'bg-[#EAF5EE] border-[#C6E3D2] text-[#1F6B42]',
  }
  return (
    <div className={`border px-3 py-2 text-[11.5px] leading-relaxed mb-2.5 ${BLEED} sm:mx-0 ${tones[tone]}`}>
      {children}
    </div>
  )
}

/** Centred placeholder for an empty list, sized so a panel does not collapse. */
export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-3 py-10 text-[12.5px] text-[#8C8878] text-center">{children}</p>
}

/** The module's one spinner position, so every screen loads the same way. */
export function Loading() {
  return (
    <div className="py-16 text-center">
      <div className="spinner mx-auto mb-3" />
      <p className="text-[12px] text-[#8C8878]">Loading…</p>
    </div>
  )
}
