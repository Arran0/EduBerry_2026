'use client'

import React from 'react'
import Link from 'next/link'
import { Search, X, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import ModalShell from '@/components/ui/ModalShell'

// ──────────────────────────────────────────────────────────────
// The Salary module's design system.
//
// The transport admin's glass, squared the way the fee module squares it:
//
//   Large surfaces — panels, sheets, tiles, popups — have square corners. A
//   payroll is a ledger, and dense rows and hairlines sit flush on straight
//   edges the way a printed register does.
//
//   Controls — buttons, segments, inputs, chips — are rounded capsules. They
//   are what a finger presses, and the round shape is how the page says so.
//
// Labels are sentence case and never smaller than 10.5px. Headings wrap
// instead of truncating, so a long name or month is never cut off.
// ──────────────────────────────────────────────────────────────

/** A field name, a column heading, a tile caption. Sentence case, quiet. */
export const LABEL = 'text-[11.5px] font-medium text-slate-500'

/** Cancels the page gutter (px-4) so a sheet reaches both edges of a phone. */
export const BLEED = '-mx-4 sm:mx-0'

/** The admin shell's width, shared with the transport and fee screens. */
export const SHELL = 'w-full mx-auto max-w-7xl 2xl:max-w-[1600px]'

/** The icon square in a salary popup's header: charcoal into bronze, white mark. */
export const SALARY_ICON = 'text-white [background:linear-gradient(135deg,#3D3B40,#8B6F47)]'

const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B8983C]/60'

/** Class names for the controls, for the places that cannot use a component. */
export const SX = {
  /** A form field: rounded, hairlined, 36px. */
  field: 'w-full h-9 rounded-[10px] bg-white border border-[#DDD8CC] px-3 text-[13.5px] text-slate-900 placeholder:text-slate-400 shadow-[inset_0_1px_2px_rgba(15,23,42,.04)] focus:outline-none focus:border-[#B8983C] focus:ring-2 focus:ring-[#B8983C]/20 transition disabled:bg-slate-50 disabled:text-slate-400',
  /** The same field one step tighter, for a cell inside a sheet row. */
  cell: 'w-full h-8 rounded-[8px] bg-white border border-[#DDD8CC] px-2 text-[12.5px] tabular-nums text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-[#B8983C] focus:ring-2 focus:ring-[#B8983C]/20 transition disabled:bg-slate-50',
  dark: `inline-flex items-center justify-center gap-1.5 h-8 px-3.5 rounded-full text-[12.5px] font-semibold text-white whitespace-nowrap bg-gradient-to-b from-[#3D3B40] to-[#27272A] shadow-[inset_0_1px_0_rgba(255,255,255,.16),0_6px_14px_-8px_rgba(15,23,42,.6)] hover:from-[#46444A] hover:to-[#2E2E31] active:scale-[0.97] transition disabled:opacity-45 disabled:pointer-events-none ${FOCUS}`,
  ghost: `inline-flex items-center justify-center gap-1.5 h-8 px-3.5 rounded-full text-[12.5px] font-semibold text-slate-700 whitespace-nowrap bg-white border border-[#E2DDD2] shadow-[0_1px_2px_rgba(15,23,42,.05)] hover:text-slate-900 hover:border-[#CFC8B8] active:scale-[0.97] transition disabled:opacity-45 disabled:pointer-events-none ${FOCUS}`,
  gold: `inline-flex items-center justify-center gap-1.5 h-8 px-3.5 rounded-full text-[12.5px] font-semibold text-white whitespace-nowrap bg-gradient-to-b from-[#C7A84C] to-[#A9892F] shadow-[inset_0_1px_0_rgba(255,255,255,.25),0_6px_14px_-8px_rgba(122,98,32,.7)] hover:from-[#CDAF55] hover:to-[#9E8029] active:scale-[0.97] transition disabled:opacity-45 disabled:pointer-events-none ${FOCUS}`,
  danger: `inline-flex items-center justify-center gap-1.5 h-8 px-3.5 rounded-full text-[12.5px] font-semibold text-white whitespace-nowrap bg-gradient-to-b from-[#B83A3A] to-[#962C2C] shadow-[inset_0_1px_0_rgba(255,255,255,.16),0_6px_14px_-8px_rgba(150,44,44,.7)] active:scale-[0.97] transition disabled:opacity-45 disabled:pointer-events-none ${FOCUS}`,
  /** An icon-only round button, the height of a capsule. */
  icon: `inline-flex items-center justify-center w-8 h-8 rounded-full flex-shrink-0 text-slate-500 hover:text-slate-900 hover:bg-slate-100 active:scale-95 transition disabled:opacity-35 disabled:pointer-events-none ${FOCUS}`,
  /** A choice chip that can be on or off — category and team pickers. */
  choice: (on: boolean) => `inline-flex items-center gap-1 h-8 px-3 rounded-full text-[12.5px] font-semibold whitespace-nowrap transition active:scale-[0.97] ${FOCUS} ${
    on
      ? 'text-white bg-gradient-to-b from-[#3D3B40] to-[#27272A] shadow-[inset_0_1px_0_rgba(255,255,255,.16)]'
      : 'text-slate-700 bg-white border border-[#E2DDD2] hover:border-[#CFC8B8]'}`,
  /** A heading inside a popup or panel body. */
  heading: 'text-[13.5px] font-semibold text-slate-900 leading-snug',
  /** A launcher tile in a document picker. */
  tile: `fx-tile w-full min-w-0 flex flex-col items-center justify-center gap-1.5 px-2 py-3.5 text-center transition hover:-translate-y-px hover:border-[#B8983C]/60 active:translate-y-0 disabled:opacity-45 disabled:pointer-events-none ${FOCUS}`,
  /** A plain checkbox in the module's ink. */
  check: 'w-4 h-4 rounded-[4px] accent-[#27272A] cursor-pointer disabled:cursor-default disabled:opacity-40',
} as const

// ──────────────────────────────────────────────────────────────
// Surfaces
// ──────────────────────────────────────────────────────────────

/** A raised square sheet of content. Edge to edge on a phone when `bleed`. */
export function Panel({ bleed, className = '', children }: {
  bleed?: boolean
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={`fx-card min-w-0 ${bleed ? 'fx-bleed' : ''} ${className}`}>
      {children}
    </div>
  )
}

/** The row that names a panel, with room for a control or two. */
export function PanelHead({ title, right, children }: {
  title: React.ReactNode
  right?: React.ReactNode
  children?: React.ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 px-3.5 min-h-[44px] py-2 border-b border-[#EEEAE1]">
      <h3 className="min-w-0 flex-1 basis-[160px] text-[13.5px] font-semibold text-slate-900 leading-snug break-words">
        {title}
      </h3>
      {right && <div className="flex flex-wrap items-center gap-1.5">{right}</div>}
      {children}
    </div>
  )
}

/**
 * A glass deck: the surface a section is worked on. Square, edge to edge on a
 * phone. Its header sits straight on the glass; content goes on solid sheets.
 */
export function Deck({ title, icon: Icon, actions, children, className = '', bodyClassName = '' }: {
  title?: React.ReactNode
  icon?: LucideIcon
  actions?: React.ReactNode
  children: React.ReactNode
  className?: string
  bodyClassName?: string
}) {
  return (
    <section className={`fx-deck fx-bleed min-w-0 ${className}`}>
      {(title || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-3.5 sm:px-4 pt-3 pb-2.5">
          <div className="flex items-center gap-2.5 min-w-0 flex-1 basis-[200px]">
            {Icon && <IconChip icon={Icon} size="sm" />}
            {title && (
              <h2 className="font-display text-[15.5px] sm:text-[17px] font-bold leading-snug text-slate-900 headline break-words min-w-0">
                {title}
              </h2>
            )}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-1.5">{actions}</div>}
        </div>
      )}
      <div className={`px-2.5 sm:px-3 pb-2.5 sm:pb-3 ${title || actions ? '' : 'pt-2.5 sm:pt-3'} ${bodyClassName}`}>
        {children}
      </div>
    </section>
  )
}

/** The charcoal-to-bronze square an icon sits in. */
export function IconChip({ icon: Icon, size = 'md' }: { icon: LucideIcon; size?: 'sm' | 'md' }) {
  const box = size === 'sm' ? 'w-8 h-8' : 'w-10 h-10'
  return (
    <span className={`icon-chip ${box} flex-shrink-0`} style={{ background: 'linear-gradient(135deg, #3D3B40, #8B6F47)' }}>
      <Icon size={size === 'sm' ? 15 : 17} className="relative z-10 text-white" />
    </span>
  )
}

/** A section's title, one line of context under it, and its controls. */
export function SectionBar({ title, hint, actions }: {
  title: string
  hint?: React.ReactNode
  actions?: React.ReactNode
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-2 mb-2.5">
      <div className="min-w-0 flex-1 basis-[200px]">
        <h2 className="font-display text-[15px] sm:text-[16px] font-bold text-slate-900 leading-snug break-words">{title}</h2>
        {hint && <p className="text-[12px] text-slate-500 leading-snug mt-0.5 break-words">{hint}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-1.5">{actions}</div>}
    </div>
  )
}

/** A full-width notice. `tone` decides whether it reads as news or as a problem. */
export function Notice({ tone = 'info', className = '', children }: {
  tone?: 'info' | 'warn' | 'error' | 'good'
  className?: string
  children: React.ReactNode
}) {
  const tones = {
    info:  'bg-white/80 border-[#B9B2A2] text-slate-600',
    warn:  'bg-[#FBF4E2] border-[#B8983C] text-[#6E5513]',
    error: 'bg-[#FCEDED] border-[#C24141] text-[#962C2C]',
    good:  'bg-[#EAF5EE] border-[#2E8B57] text-[#1F6B42]',
  }
  return (
    <div className={`border-l-[3px] px-3.5 py-2.5 text-[12.5px] leading-relaxed ${tones[tone]} ${className}`}>
      {children}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
// Controls
// ──────────────────────────────────────────────────────────────

/** Search field. Grows to fill its row on a phone, capped once it shares one. */
export function SearchField({ value, onChange, placeholder = 'Search…', className = '' }: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  className?: string
}) {
  return (
    <div className={`relative flex-1 min-w-[150px] ${className}`}>
      <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className={`${SX.field} pl-8 ${value ? 'pr-8' : ''}`}
      />
      {value && (
        <button
          onClick={() => onChange('')}
          aria-label="Clear search"
          className="absolute right-1.5 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full inline-flex items-center justify-center text-slate-400 hover:text-slate-900 hover:bg-slate-100 transition"
        >
          <X size={13} />
        </button>
      )}
    </div>
  )
}

type BtnTone = 'dark' | 'ghost' | 'gold' | 'danger'

/** A capsule button in one of the module's tones. */
export function Btn({ tone = 'ghost', className = '', children, ...rest }: {
  tone?: BtnTone
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" {...rest} className={`${SX[tone]} ${className}`}>{children}</button>
}

type ChipTone = 'neutral' | 'gold' | 'dark' | 'good' | 'bad'

const CHIP_TONE: Record<ChipTone, string> = {
  neutral: 'bg-slate-100 text-slate-600',
  gold: 'bg-[#FBF1D6] text-[#7A5D12]',
  dark: 'bg-[#27272A] text-white',
  good: 'bg-[#E6F2EA] text-[#1F6B42]',
  bad: 'bg-[#FBE7E7] text-[#A93232]',
}

/** A status chip. */
export function Chip({ tone = 'neutral', className = '', children }: {
  tone?: ChipTone
  className?: string
  children: React.ReactNode
}) {
  return (
    <span className={`inline-flex items-center gap-1 h-5 px-2 rounded-full text-[10.5px] font-semibold leading-none whitespace-nowrap ${CHIP_TONE[tone]} ${className}`}>
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
  return (
    <div className={`flex flex-wrap items-center gap-2 select-none ${className}`}>
      <div className="lg-pill inline-flex items-center gap-0.5 p-1 min-w-0 max-w-full">
        <button type="button" onClick={onPrev} disabled={!canPrev} aria-label="Previous month" className={SX.icon}>
          <ChevronLeft size={16} />
        </button>
        <span className="px-1.5 min-w-[7.5rem] text-center text-[13.5px] font-semibold text-slate-900 leading-tight">
          {label}
        </span>
        <button type="button" onClick={onNext} disabled={!canNext} aria-label="Next month" className={SX.icon}>
          <ChevronRight size={16} />
        </button>
      </div>
      {sub && <span className="text-[12px] text-slate-500 leading-snug">{sub}</span>}
      {right && <div className="ml-auto flex items-center gap-1.5">{right}</div>}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
// Stat tiles
// ──────────────────────────────────────────────────────────────

/**
 * Month-on-month change.
 *
 * `goodWhenUp` says which direction is worth celebrating: payroll cost rising
 * is not the same news as net pay rising. Colour follows the news, never the
 * arrow.
 */
export function Delta({ percent, goodWhenUp, onDark }: { percent: number; goodWhenUp: boolean; onDark?: boolean }) {
  const flat = Math.abs(percent) < 0.05
  const up = percent > 0
  const good = up === goodWhenUp
  const tone = flat
    ? (onDark ? 'text-white/55' : 'text-slate-400')
    : good ? (onDark ? 'text-[#8FD3A8]' : 'text-[#1F6B42]') : (onDark ? 'text-[#F2A7A7]' : 'text-[#A93232]')
  return (
    <span className={`inline-flex items-center gap-0.5 text-[11px] font-semibold tabular-nums leading-none ${tone}`}>
      <span aria-hidden className="text-[9px]">{flat ? '–' : up ? '▲' : '▼'}</span>
      {flat ? '0%' : `${Math.abs(percent).toFixed(Math.abs(percent) < 10 ? 1 : 0)}%`}
    </span>
  )
}

/**
 * One headline figure. Square; shade 0 is the dark one — the figure the
 * screen is about. Pressable when it leads somewhere.
 */
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
  const dark = shade === 0
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={`${dark ? 'fx-tile-dark' : 'fx-tile'} relative min-w-0 text-left p-3 sm:p-3.5 flex flex-col gap-1.5 transition
                  ${onClick ? `cursor-pointer hover:-translate-y-px active:translate-y-0 ${FOCUS}` : ''}`}
    >
      <span className={`text-[12px] font-medium leading-snug break-words ${dark ? 'text-white/70' : 'text-slate-500'}`}>{label}</span>
      {loading ? (
        <span className={`block h-[24px] w-24 max-w-full animate-pulse ${dark ? 'bg-white/10' : 'bg-slate-100'}`} />
      ) : (
        <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className={`font-display text-[1.25rem] sm:text-[1.45rem] font-bold leading-none tabular-nums break-all ${dark ? 'text-white' : 'text-slate-900'}`}>
            {value}
          </span>
          {percent != null && <Delta percent={percent} goodWhenUp={goodWhenUp} onDark={dark} />}
        </span>
      )}
      {sub && (
        <span className={`block text-[11.5px] leading-snug break-words ${dark ? 'text-white/55' : 'text-slate-500'}`}>{sub}</span>
      )}
    </Tag>
  )
}

// ──────────────────────────────────────────────────────────────
// Data sheet — the table shape the roster tabs use
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
export function SheetHead({ cols, columns, className = '' }: { cols: string; columns: Column[]; className?: string }) {
  return (
    <div className={`flex items-stretch bg-[#F7F5F0] border-b border-[#EEEAE1] sticky top-0 z-10 ${className}`}>
      <div className="w-[3px] flex-shrink-0" />
      <div
        className="grid items-center gap-x-2 flex-1 min-w-0 px-3 py-2"
        style={{ gridTemplateColumns: cols }}
      >
        {columns.map((c, i) => (
          <span
            key={`${c.label}-${i}`}
            className={`${LABEL} leading-tight ${ALIGN[c.align ?? 'left']} ${c.className ?? ''}`}
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
  const shell = `flex items-stretch w-full text-left border-b border-[#F0ECE3] last:border-b-0 hover:bg-[#FAF7F0] transition-colors ${className}`
  const inner = (
    <>
      <div className="w-[3px] flex-shrink-0" style={{ background: accent }} />
      <div
        className="grid items-center gap-x-2 flex-1 min-w-0 px-3 py-1.5"
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
 * The square sheet a list sits on. Edge to edge on a phone. Without
 * `minWidth` it never scrolls sideways; with it, the floor applies from `lg`
 * up only, where the rows are a table — below that they are cards.
 */
export function Sheet({ minWidth, children, className = '' }: {
  minWidth?: number
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={`fx-card fx-bleed min-w-0 ${minWidth ? 'lg:overflow-x-auto' : ''} ${className}`}>
      <div
        className={minWidth ? 'lg:min-w-[var(--sheet-min)]' : undefined}
        style={minWidth ? ({ '--sheet-min': `${minWidth}px` } as React.CSSProperties) : undefined}
      >
        {children}
      </div>
    </div>
  )
}

/** Placeholder rows for a sheet's loading state. */
export function SheetSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="animate-pulse">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-2.5 px-3.5 py-3 border-b border-[#F0ECE3] last:border-b-0">
          <div className="w-7 h-7 rounded-full bg-slate-100 flex-shrink-0" />
          <div className="flex-1 min-w-0 space-y-1.5">
            <div className="h-2.5 w-32 max-w-full bg-slate-100" />
            <div className="h-2 w-20 max-w-full bg-slate-100" />
          </div>
          <div className="h-2.5 w-16 bg-slate-100" />
        </div>
      ))}
    </div>
  )
}

/** Centred message inside a sheet or panel — empty states and no-match notices. */
export function Note({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <p className={`px-4 py-8 text-center text-[13px] text-slate-500 leading-relaxed ${className}`}>{children}</p>
  )
}

/** Right-aligned number, in the one type size every figure in a row uses. */
export function Num({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <span className={`text-[12.5px] tabular-nums text-right ${className}`}>{children}</span>
}

/** The module's one spinner position, so every screen loads the same way. */
export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="py-14 text-center">
      <div className="spinner mx-auto mb-3" />
      <p className="text-[13px] text-slate-500">{label}</p>
    </div>
  )
}

/** A labelled figure or field in a phone card: caption over the value. */
export function Fact({ label, children, className = '' }: {
  label: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={`min-w-0 ${className}`}>
      <span className={`${LABEL} block mb-1`}>{label}</span>
      {children}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
// Filter and sort menus
//
// A capsule that turns dark while it narrows anything, and a rounded menu
// that opens under it. The menu is pinned to the toolbar's own width on a
// phone, so it can never push the page sideways.
// ──────────────────────────────────────────────────────────────

/** The capsule that opens a menu. */
export function MenuButton({ active, open, onClick, icon: Icon, children }: {
  active: boolean
  open: boolean
  onClick: () => void
  icon: LucideIcon
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-haspopup="true"
      aria-expanded={open}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 h-9 min-w-0 max-w-full px-3 rounded-full text-[12.5px] font-semibold whitespace-nowrap transition active:scale-[0.97] ${FOCUS} ${
        active
          ? 'text-white bg-gradient-to-b from-[#3D3B40] to-[#27272A] shadow-[inset_0_1px_0_rgba(255,255,255,.16),0_6px_14px_-8px_rgba(15,23,42,.6)]'
          : 'text-slate-700 bg-white border border-[#E2DDD2] shadow-[0_1px_2px_rgba(15,23,42,.05)] hover:border-[#CFC8B8]'}`}
    >
      <Icon size={14} className={`flex-shrink-0 ${active ? 'text-[#E9DDBB]' : 'text-slate-500'}`} />
      <span className="truncate">{children}</span>
    </button>
  )
}

export function MenuPanel({ children, onClear }: { children: React.ReactNode; onClear?: () => void }) {
  return (
    <div className="absolute top-full left-0 right-0 sm:right-auto sm:w-72 z-30 mt-1.5 flex flex-col max-h-[60vh] rounded-[14px] bg-white border border-black/[.07]
                    shadow-[0_24px_60px_-20px_rgba(15,23,42,.45),0_2px_8px_rgba(15,23,42,.08)] overflow-hidden">
      <div className="overflow-y-auto overscroll-contain">{children}</div>
      {onClear && (
        <button onClick={onClear}
          className="flex-shrink-0 w-full text-left px-3.5 py-2.5 text-[12.5px] font-semibold text-[#8B6F47] hover:bg-[#FAF7F0] border-t border-slate-100">
          Clear all filters
        </button>
      )}
    </div>
  )
}

export function MenuGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-slate-100 last:border-b-0 py-1">
      <p className="px-3.5 pt-1.5 pb-1 text-[11.5px] font-semibold text-slate-400">{label}</p>
      {children}
    </div>
  )
}

export function MenuOption({ selected, onClick, children }: {
  selected: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center gap-2.5 px-3.5 py-2 text-left hover:bg-[#FAF7F0] focus-visible:bg-[#FAF7F0] focus-visible:outline-none"
    >
      <span className={`flex-shrink-0 w-4 h-4 rounded-[5px] inline-flex items-center justify-center transition ${
        selected ? 'bg-[#27272A] text-white' : 'border border-slate-300 bg-white'}`}>
        {selected && <svg viewBox="0 0 12 12" className="w-2.5 h-2.5" aria-hidden><path d="M2.5 6.2l2.2 2.2 4.8-4.9" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>}
      </span>
      <span className="flex-1 min-w-0 flex items-center gap-2 text-[13.5px] text-slate-900 leading-snug">{children}</span>
    </button>
  )
}

/** Closes a toolbar's open menu on a click elsewhere or Escape. */
export function useMenuDismiss<T extends string>(
  open: T | null,
  setOpen: (v: T | null) => void,
  ref: React.RefObject<HTMLElement | null>,
) {
  React.useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(null)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(null) }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, setOpen, ref])
}

// ──────────────────────────────────────────────────────────────
// Forms
//
// The iOS Settings form on a square sheet: related fields in one group, one
// field per row — what it is on the left, its control on the right — and a
// note under the group for anything a row cannot say in a line. The control
// drops under its label when the row runs out of room, so nothing is ever
// squeezed into a clipped box.
// ──────────────────────────────────────────────────────────────

/** A titled group of form rows. */
export function FormGroup({ title, note, children, className = '' }: {
  title?: string
  note?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={className}>
      {title && <h3 className="px-0.5 pb-1.5 text-[13.5px] font-semibold text-slate-900 leading-snug">{title}</h3>}
      <div className="fx-card divide-y divide-[#EEEAE1]">{children}</div>
      {note && <p className="px-0.5 pt-1.5 text-[12px] leading-snug text-slate-500">{note}</p>}
    </section>
  )
}

/** One field. `stack` always puts the control under its label. */
export function FormRow({ label, hint, children, stack = false }: {
  label: React.ReactNode
  hint?: React.ReactNode
  children: React.ReactNode
  stack?: boolean
}) {
  return (
    <div className={`px-3.5 py-2.5 ${stack ? 'space-y-2' : 'flex flex-wrap items-center justify-between gap-x-4 gap-y-2'}`}>
      <div className={stack ? '' : 'min-w-0 flex-1 basis-[120px]'}>
        <p className="text-[13.5px] text-slate-900 leading-snug">{label}</p>
        {hint && <p className="text-[12px] text-slate-500 leading-snug mt-0.5">{hint}</p>}
      </div>
      <div className={stack ? 'min-w-0' : 'max-w-full'}>{children}</div>
    </div>
  )
}

/** The iOS switch. */
export function Switch({ checked, onChange, label, disabled }: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex w-[46px] h-[28px] flex-shrink-0 rounded-full transition-colors disabled:opacity-45 ${FOCUS} ${
        checked ? 'bg-[#34A853]' : 'bg-slate-200'}`}
    >
      <span className={`absolute top-[2px] left-[2px] w-6 h-6 rounded-full bg-white shadow-[0_2px_5px_rgba(15,23,42,.25)] transition-transform ${
        checked ? 'translate-x-[18px]' : ''}`} />
    </button>
  )
}

/** A number box with its unit inside it on the right. */
export function UnitInput({ value, onChange, unit, step = 1, width = 'w-28', integer = false, min = 0, placeholder, title }: {
  value: number | string
  onChange: (v: string) => void
  unit?: string
  step?: number
  width?: string
  integer?: boolean
  min?: number
  placeholder?: string
  title?: string
}) {
  return (
    <span className={`relative inline-flex ${width} max-w-full`} title={title}>
      <input
        type="number"
        inputMode={integer ? 'numeric' : 'decimal'}
        min={min}
        step={step}
        value={value}
        placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
        className={`${SX.field} text-right tabular-nums ${unit ? 'pr-11' : ''}`}
      />
      {unit && (
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[12px] text-slate-400 pointer-events-none">{unit}</span>
      )}
    </span>
  )
}

// ──────────────────────────────────────────────────────────────
// Popups
// ──────────────────────────────────────────────────────────────

/**
 * A yes-or-no popup: what is about to happen, why it matters, and the two
 * answers. Every confirmation in the module goes through this, so a lock and
 * a delete ask in the same voice and the same place.
 */
export function ConfirmModal({
  title, icon, children, confirmLabel, busyLabel = 'Working…', tone = 'dark', busy, error, onConfirm, onClose,
}: {
  title: string
  icon: React.ReactNode
  children: React.ReactNode
  confirmLabel: string
  busyLabel?: string
  tone?: 'dark' | 'danger'
  busy?: boolean
  error?: string | null
  onConfirm: () => void
  onClose: () => void
}) {
  return (
    <ModalShell
      onClose={onClose}
      size="md"
      sharp
      glass
      title={title}
      icon={icon}
      iconClassName={tone === 'danger' ? 'text-white [background:linear-gradient(135deg,#B83A3A,#7E2424)]' : SALARY_ICON}
      footer={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Btn tone="ghost" onClick={onClose} disabled={busy}>Cancel</Btn>
          <Btn tone={tone} onClick={onConfirm} disabled={busy}>
            {busy && <Loader2 size={13} className="animate-spin" />}
            {busy ? busyLabel : confirmLabel}
          </Btn>
        </div>
      }
    >
      <div className="text-[13.5px] text-slate-600 leading-relaxed space-y-2">{children}</div>
      {error && <Notice tone="error" className="mt-3">{error}</Notice>}
    </ModalShell>
  )
}
