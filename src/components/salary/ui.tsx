'use client'

import React from 'react'
import Link from 'next/link'
import { Search, X, ChevronLeft, ChevronRight } from 'lucide-react'

// ──────────────────────────────────────────────────────────────
// The Salary hub's design system.
//
// One vocabulary for every surface in /more/salary — the three admin tabs,
// the staff view, the modals — so they stop reading as three products that
// happen to share a route.
//
// Sharp: nothing here is rounded. Corners are square down to the chips and
// inputs, which is what lets dense rows sit flush against each other without
// a stack of radii fighting for attention.
//
// Off-white: surfaces are a four-step warm paper ramp rather than white cards
// floating on grey. Depth comes from the ramp and hairlines, not shadow.
// ──────────────────────────────────────────────────────────────

export const TONE = {
  paper: '#FDFCF9',   // the page itself
  surface: '#FFFFFF', // raised: sheets, panels
  raised: '#FAF8F2',  // a shade in: stat tiles, sub-heads
  sunken: '#F4F1E7',  // two shades in: totals, emphasis tiles
  deep: '#EDE9DC',    // deepest paper: the "headline" tile
  line: '#E3DFD3',    // structural hairline
  lineSoft: '#F0ECE2', // hairline between rows
  ink: '#18181B',
  inkSoft: '#52525B',
  muted: '#8C8878',   // warm grey for labels and units
  gold: '#B8983C',
  goldInk: '#7A6220',
} as const

/** Uppercase micro-label used for every field name, column and tile caption. */
export const LABEL = 'text-[9.5px] font-bold uppercase tracking-[0.12em] text-[#8C8878]'

/** Cancels the page gutter so a dense sheet reaches both screen edges on phones. */
export const BLEED = '-mx-3 sm:mx-0'

// ──────────────────────────────────────────────────────────────
// Surfaces
// ──────────────────────────────────────────────────────────────

export function Panel({ bleed, className = '', children }: {
  bleed?: boolean
  className?: string
  children: React.ReactNode
}) {
  return (
    <div
      className={`bg-white border-[#E3DFD3] ${bleed ? `${BLEED} border-y sm:border` : 'border'} ${className}`}
    >
      {children}
    </div>
  )
}

/** The dark strip that names a panel, and optionally carries one control. */
export function PanelHead({ title, right, children }: {
  title: string
  right?: React.ReactNode
  children?: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-2 bg-[#27272A] px-3 py-1.5">
      <span className="text-[9.5px] font-bold uppercase tracking-[0.12em] text-[#A1A1AA] truncate">
        {title}
      </span>
      {right}
      {children}
    </div>
  )
}

/**
 * A section's title row: what this is, one line of context, and its controls.
 * Stacks on phones so a long hint never squeezes the title into two words.
 */
export function SectionBar({ title, hint, actions }: {
  title: string
  hint?: React.ReactNode
  actions?: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-3 mb-2">
      <div className="min-w-0">
        <h2 className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#3F3F46] leading-tight">{title}</h2>
        {hint && <p className="text-[10.5px] text-[#8C8878] leading-tight mt-0.5 truncate">{hint}</p>}
      </div>
      {actions && <div className="flex items-center gap-1.5 flex-shrink-0">{actions}</div>}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
// Controls
// ──────────────────────────────────────────────────────────────

/**
 * Search field.
 *
 * Sized so the placeholder fits at 360px rather than being clipped: the
 * field grows to fill its row on phones and only caps its width once there
 * is a toolbar beside it to share with.
 */
export function SearchField({ value, onChange, placeholder = 'Search…', className = '' }: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  className?: string
}) {
  return (
    <div className={`relative flex-1 min-w-0 ${className}`}>
      <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#A8A395] pointer-events-none" />
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-white border border-[#E3DFD3] pl-[30px] pr-7 py-[7px] text-[12.5px] leading-none text-[#27272A] placeholder:text-[#A8A395] focus:outline-none focus:border-[#27272A] transition-colors"
      />
      {value && (
        <button
          onClick={() => onChange('')}
          aria-label="Clear search"
          className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 text-[#A8A395] hover:text-[#27272A] transition-colors"
        >
          <X size={12} />
        </button>
      )}
    </div>
  )
}

type BtnTone = 'dark' | 'ghost' | 'gold'

const BTN_TONE: Record<BtnTone, string> = {
  dark: 'bg-[#27272A] text-white hover:bg-[#18181B] border border-[#27272A]',
  ghost: 'bg-white text-[#52525B] hover:text-[#18181B] border border-[#E3DFD3] hover:border-[#C9C4B4]',
  gold: 'bg-[#B8983C] text-white hover:bg-[#A2842F] border border-[#B8983C]',
}

/** Compact, square-cornered button. One size, tuned to sit level with SearchField. */
export function Btn({ tone = 'ghost', className = '', children, ...rest }: {
  tone?: BtnTone
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      className={`inline-flex items-center justify-center gap-1.5 px-2.5 py-[7px] text-[10.5px] font-bold uppercase tracking-[0.08em] leading-none whitespace-nowrap transition-colors disabled:opacity-40 disabled:pointer-events-none ${BTN_TONE[tone]} ${className}`}
    >
      {children}
    </button>
  )
}

type ChipTone = 'neutral' | 'gold' | 'dark' | 'good' | 'bad'

const CHIP_TONE: Record<ChipTone, string> = {
  neutral: 'bg-[#F4F1E7] text-[#6B675A] border-[#E3DFD3]',
  gold: 'bg-[#FAF3DF] text-[#7A6220] border-[#E7D9AE]',
  dark: 'bg-[#27272A] text-white border-[#27272A]',
  good: 'bg-[#EAF5EE] text-[#1F6B42] border-[#C6E3D2]',
  bad: 'bg-[#FCECEC] text-[#A93232] border-[#EFCCCC]',
}

export function Chip({ tone = 'neutral', className = '', children }: {
  tone?: ChipTone
  className?: string
  children: React.ReactNode
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 border px-1.5 py-[2px] text-[9px] font-bold uppercase tracking-[0.08em] leading-none whitespace-nowrap ${CHIP_TONE[tone]} ${className}`}
    >
      {children}
    </span>
  )
}

// ──────────────────────────────────────────────────────────────
// Month stepper — the one control that says which month is on screen
// ──────────────────────────────────────────────────────────────

export function MonthStepper({ label, sub, onPrev, onNext, canPrev = true, canNext, right, className = '' }: {
  label: string
  sub?: React.ReactNode
  onPrev: () => void
  onNext: () => void
  canPrev?: boolean
  canNext: boolean
  right?: React.ReactNode
  className?: string
}) {
  const arrow = 'px-2.5 self-stretch flex items-center text-[#A8A395] hover:text-[#18181B] hover:bg-[#F4F1E7] transition-colors disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-[#A8A395]'
  return (
    <div className={`flex items-stretch bg-white border border-[#E3DFD3] select-none ${className}`}>
      <button type="button" onClick={onPrev} disabled={!canPrev} aria-label="Previous month" className={arrow}>
        <ChevronLeft size={15} />
      </button>
      <div className="flex-1 min-w-0 flex items-baseline justify-center gap-2 py-[7px] px-1">
        <span className="text-[12.5px] font-bold tracking-wide text-[#18181B] flex-shrink-0 leading-none">
          {label}
        </span>
        {sub && (
          <span className="text-[9.5px] font-semibold uppercase tracking-[0.1em] text-[#A8A395] truncate leading-none">
            {sub}
          </span>
        )}
      </div>
      {right && <div className="flex items-center gap-1 pr-1.5">{right}</div>}
      <button type="button" onClick={onNext} disabled={!canNext} aria-label="Next month" className={arrow}>
        <ChevronRight size={15} />
      </button>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
// Stat tiles
// ──────────────────────────────────────────────────────────────

/**
 * The paper ramp, darkest first. A tile's shade is its rank on the panel —
 * the headline figure sits deepest, the supporting ones step back towards
 * white — so the eye finds the important number without any colour at all.
 */
export const SHADE = ['#F5F2E9', '#F9F7F1', '#FCFBF7', '#FFFFFF'] as const

/**
 * Month-on-month change.
 *
 * `goodWhenUp` says which direction is worth celebrating: payroll cost rising
 * is not the same news as net pay rising, and deductions climbing is worse
 * news than either. Colour follows the news, never the arrow.
 */
export function Delta({ percent, goodWhenUp }: { percent: number; goodWhenUp: boolean }) {
  const flat = Math.abs(percent) < 0.05
  const up = percent > 0
  const tone = flat ? 'text-[#A8A395]' : up === goodWhenUp ? 'text-[#1F6B42]' : 'text-[#A93232]'
  return (
    <span className={`inline-flex items-center gap-[1px] text-[9.5px] font-bold tabular-nums leading-none ${tone}`}>
      <span aria-hidden>{flat ? '–' : up ? '▲' : '▼'}</span>
      {flat ? '0%' : `${Math.abs(percent).toFixed(Math.abs(percent) < 10 ? 1 : 0)}%`}
    </span>
  )
}

export function StatTile({ label, value, sub, percent, goodWhenUp = true, shade = 3, onClick, loading }: {
  label: string
  value: string
  sub?: React.ReactNode
  /** null or undefined hides the comparison — a progress figure has no trend. */
  percent?: number | null
  goodWhenUp?: boolean
  shade?: 0 | 1 | 2 | 3
  onClick?: () => void
  loading?: boolean
}) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag
      onClick={onClick}
      style={{ background: SHADE[shade] }}
      className={`text-left border border-[#E3DFD3] px-2.5 py-2 min-w-0 transition-colors ${
        onClick ? 'hover:border-[#B8983C]' : ''
      }`}
    >
      <span className={`block ${LABEL} truncate`}>{label}</span>
      <span className="flex items-baseline gap-1.5 mt-1 flex-wrap">
        <span className={`text-[17px] sm:text-[19px] font-bold tabular-nums leading-none text-[#18181B] ${loading ? 'opacity-25' : ''}`}>
          {value}
        </span>
        {!loading && percent != null && <Delta percent={percent} goodWhenUp={goodWhenUp} />}
      </span>
      {sub && <span className="block text-[10px] text-[#8C8878] leading-tight mt-1 truncate">{sub}</span>}
    </Tag>
  )
}

// ──────────────────────────────────────────────────────────────
// Data sheet — the one table shape every tab uses
// ──────────────────────────────────────────────────────────────

const ALIGN = { left: 'text-left', right: 'text-right', center: 'text-center' } as const
export type Align = keyof typeof ALIGN

export interface Column {
  label: string
  align?: Align
  /** Extra classes for this header cell only (e.g. an avatar's leading offset). */
  className?: string
}

/**
 * A column header row and the rows under it share one grid template, passed as
 * an inline style: Tailwind only emits CSS for class names it can find as
 * literal text, so a `grid-cols-[...]` assembled from string pieces never gets
 * generated and the grid silently collapses to one stacked column.
 */
export function SheetHead({ cols, columns }: { cols: string; columns: Column[] }) {
  return (
    <div className="flex items-stretch bg-[#27272A] sticky top-0 z-10">
      <div className="w-[3px] flex-shrink-0" />
      <div
        className="grid items-center gap-x-2 flex-1 min-w-0 px-2.5 py-[7px]"
        style={{ gridTemplateColumns: cols }}
      >
        {columns.map((c, i) => (
          <span
            key={`${c.label}-${i}`}
            className={`text-[9px] font-bold uppercase tracking-[0.1em] text-[#A1A1AA] leading-none truncate ${ALIGN[c.align ?? 'left']} ${c.className ?? ''}`}
          >
            {c.label}
          </span>
        ))}
      </div>
    </div>
  )
}

/**
 * One data row. `accent` colours the 3px status bar down its left edge.
 * Pass `href` for a row that navigates — a real link, so it can be opened in
 * a new tab the way a row in a list is expected to.
 */
export function SheetRow({ cols, accent = 'transparent', href, onClick, className = '', children }: {
  cols: string
  accent?: string
  href?: string
  onClick?: () => void
  className?: string
  children: React.ReactNode
}) {
  const shell = `flex items-stretch w-full text-left border-b border-[#F0ECE2] last:border-b-0 hover:bg-[#FAF8F2] transition-colors ${className}`
  const inner = (
    <>
      <div className="w-[3px] flex-shrink-0" style={{ background: accent }} />
      <div
        className="grid items-center gap-x-2 flex-1 min-w-0 px-2.5 py-[5px]"
        style={{ gridTemplateColumns: cols }}
      >
        {children}
      </div>
    </>
  )
  if (href) return <Link href={href} className={shell}>{inner}</Link>
  if (onClick) return <button onClick={onClick} className={shell}>{inner}</button>
  return <div className={shell}>{inner}</div>
}

/**
 * The scrolling frame around a sheet. Full-bleed on phones — a payroll table
 * cannot spare 24px of gutter — and a bordered panel from `sm:` up.
 */
export function Sheet({ minWidth, children, className = '' }: {
  minWidth?: number
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={`${BLEED} overflow-x-auto border-y sm:border border-[#E3DFD3] bg-white ${className}`}>
      <div style={minWidth ? { minWidth } : undefined}>{children}</div>
    </div>
  )
}

/** Placeholder row matching SheetRow's height, for a sheet's loading state. */
export function SheetSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="animate-pulse">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-stretch border-b border-[#F0ECE2] last:border-b-0">
          <div className="w-[3px] flex-shrink-0 bg-[#EDE9DC]" />
          <div className="flex items-center gap-2 flex-1 min-w-0 px-2.5 py-[9px]">
            <div className="w-5 h-5 bg-[#EDE9DC] flex-shrink-0" />
            <div className="h-2 w-28 bg-[#EDE9DC]" />
            <div className="h-2 w-16 bg-[#F0ECE2] ml-auto" />
          </div>
        </div>
      ))}
    </div>
  )
}

/** Centered message inside a sheet or panel — empty states and no-match notices. */
export function Note({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <p className={`px-4 py-7 text-center text-[12.5px] text-[#8C8878] ${className}`}>{children}</p>
  )
}

/** Right-aligned number, in the one type size every figure on the page uses. */
export function Num({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <span className={`text-[11.5px] tabular-nums text-right ${className}`}>{children}</span>
}
