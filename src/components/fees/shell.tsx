'use client'

// ─────────────────────────────────────────────────────────────────────────────
// The Fee module's screen shell.
//
// One copy of the frame, the lists, the panels and the switches every fee
// screen is built from, so nine screens and a dozen sheets cannot drift apart.
//
// The language is the transport app's glass with the large surfaces squared
// (see ui.ts): panels and lists have straight edges, the controls on them are
// capsules. Desktop runs to the same 1600px edge as the bus and payroll
// screens, because a fee register is a table and wants the width.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useId } from 'react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { ArrowLeft } from 'lucide-react'
import { ADMIN, BLEED, LABEL } from '@/components/fees/ui'

export { LABEL, BLEED }

/** The admin shell's width, shared with the transport and payroll screens. */
export const SHELL = 'w-full mx-auto max-w-7xl 2xl:max-w-[1600px]'

/**
 * The frame for a fee page that is not the hub: the stone background, the
 * width, a way back, and a title row whose title wraps instead of clipping.
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
    <div data-page-theme="fees" className="overflow-x-clip" style={{ minHeight: '100vh' }}>
      <div className={`${SHELL} px-4 sm:px-6 lg:px-8 pt-3 sm:pt-6 pb-12`}>
        {back && (
          <Link href={back.href}
                className="lg-pill inline-flex items-center gap-1.5 h-8 pl-2.5 pr-3.5 mb-3 text-[12.5px] font-semibold
                           text-slate-700 hover:text-slate-900 transition-colors">
            <ArrowLeft size={14} /> {back.label}
          </Link>
        )}

        <div className="flex flex-wrap items-center gap-x-3 gap-y-2.5 mb-4 sm:mb-5">
          <div className="flex items-center gap-3 min-w-0 flex-1 basis-[220px]">
            <div className="icon-chip w-10 h-10 sm:w-11 sm:h-11 flex-shrink-0 text-white [&_svg]:!text-white"
                 style={{ background: 'linear-gradient(135deg, #3D3B40, #8B6F47)' }}>
              <span className="relative z-10 flex">{icon}</span>
            </div>
            <div className="min-w-0">
              <h1 className="font-display text-[1.3rem] sm:text-[1.6rem] font-bold leading-[1.15] text-slate-900 headline break-words">
                {title}
              </h1>
              {subtitle && (
                <p className="text-[12.5px] text-slate-500 mt-0.5 leading-snug break-words">{subtitle}</p>
              )}
            </div>
          </div>
          {actions && (
            <div className="flex items-center gap-1.5 flex-wrap">{actions}</div>
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

const STRIP_COLS: Record<number, string> = {
  1: 'grid-cols-1',
  2: 'grid-cols-2',
  3: 'grid-cols-3',
  4: 'grid-cols-2 sm:grid-cols-4',
  5: 'grid-cols-2 sm:grid-cols-5',
  6: 'grid-cols-3 sm:grid-cols-6',
}

/**
 * A row of figures: one square sheet split by hairlines, value over label.
 *
 * `loading` renders the same cells with placeholders, so the strip is exactly
 * as tall before the figures land as after.
 */
export function StatStrip({ stats, loading }: { stats: Stat[]; loading?: boolean }) {
  const cols = STRIP_COLS[stats.length] ?? 'grid-cols-2 sm:grid-cols-4'
  return (
    <div className="fx-card mb-3 overflow-hidden">
      <div className={`grid ${cols} gap-px bg-[#EEEAE1]`}>
        {stats.map(s => (
          <div key={s.label} className="px-3 py-2.5 min-w-0 bg-white">
            {loading ? (
              <>
                <div className="h-[20px] w-20 max-w-full bg-slate-100 animate-pulse" />
                <div className="h-[12px] w-14 max-w-full bg-slate-100 animate-pulse mt-1" />
              </>
            ) : (
              <>
                <p className={`${s.strong ? 'text-[17px]' : 'text-[15px]'} font-bold tabular-nums leading-[20px] text-slate-900 break-words`}
                   style={s.tone ? { color: s.tone } : undefined}>
                  {s.value}
                </p>
                <p className={`${LABEL} mt-0.5 leading-snug`}>{s.label}</p>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

export interface SegmentDef<K extends string> {
  key: K
  label: string
  short?: string
  icon?: React.ElementType
  /** A count shown after the label — how many rows the choice would show. */
  count?: number
}

/**
 * The module's switch between views of the same thing: an iOS segmented
 * control — a capsule track and a dark thumb that slides to the live choice.
 *
 * `fill` stretches the segments to the track's width (`'phone'` only below
 * `sm`); without it each segment is as wide as its words.
 */
export function Segmented<K extends string>({
  options, value, onChange, fill, size = 'md', className = '',
}: {
  options: SegmentDef<K>[]
  value: K
  onChange: (key: K) => void
  /** `true` always stretches; `'phone'` stretches only below `sm`. */
  fill?: boolean | 'phone'
  size?: 'sm' | 'md'
  className?: string
}) {
  const id = useId()
  const frame = fill === true ? 'flex w-full' : fill === 'phone' ? 'flex max-sm:w-full sm:inline-flex' : 'inline-flex'
  const item = fill === true ? 'flex-1' : fill === 'phone' ? 'max-sm:flex-1' : ''
  // A filled switch shares its width between the choices, so each gets
  // only a little side padding and the words keep the room.
  const pad = size === 'sm' ? 'px-2.5' : 'px-3'
  const h = `${size === 'sm' ? 'h-7 text-[12px]' : 'h-8 text-[12.5px]'} ${fill === true ? 'px-1.5' : fill === 'phone' ? `max-sm:px-1.5 sm:${pad}` : pad}`
  return (
    <div role="tablist" className={`lg-pill ${frame} max-w-full items-center gap-0.5 p-1 ${className}`}>
      {options.map(o => {
        const on = o.key === value
        const Icon = o.icon
        return (
          <button
            key={o.key}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(o.key)}
            className={`${item} relative min-w-0 inline-flex items-center justify-center gap-1.5 rounded-full
                        font-semibold whitespace-nowrap transition-colors ${h}
                        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B8983C]/60 ${
              on ? 'text-white' : 'text-slate-600 hover:text-slate-900'}`}
          >
            {on && (
              <motion.span
                layoutId={`seg-${id}`}
                className="absolute inset-0 rounded-full bg-gradient-to-b from-[#3D3B40] to-[#27272A] shadow-[inset_0_1px_0_rgba(255,255,255,.16),0_4px_10px_-4px_rgba(15,23,42,.45)]"
                transition={{ type: 'spring', stiffness: 420, damping: 34 }}
              />
            )}
            <span className="relative z-10 inline-flex items-center gap-1.5 min-w-0">
              {Icon && <Icon size={13} className={`flex-shrink-0 ${fill === 'phone' ? 'max-sm:hidden' : ''} ${on ? 'text-[#E9DDBB]' : ''}`} />}
              <span className="truncate">
                {o.short ? <><span className="sm:hidden">{o.short}</span><span className="max-sm:hidden">{o.label}</span></> : o.label}
              </span>
              {o.count !== undefined && (
                <span className={`tabular-nums text-[10.5px] font-bold ${on ? 'text-white/70' : 'text-slate-400'}`}>{o.count}</span>
              )}
            </span>
          </button>
        )
      })}
    </div>
  )
}

/**
 * A screen's control row: what narrows the list on the left, what acts on it
 * on the right. On a phone the two halves stack.
 */
export function Toolbar({ left, right, className = '' }: {
  left?: React.ReactNode
  right?: React.ReactNode
  className?: string
}) {
  return (
    <div className={`flex flex-wrap items-center gap-2 mb-3 ${className}`}>
      {left && <div className="flex flex-wrap items-center gap-2 flex-1 min-w-0">{left}</div>}
      {right && <div className="flex flex-wrap items-center gap-1.5 max-sm:w-full sm:ml-auto">{right}</div>}
    </div>
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
      <div className="min-w-0 flex-1 basis-[220px]">
        <h2 className="font-display text-[15px] sm:text-[16px] font-bold text-slate-900 leading-snug">{title}</h2>
        {hint && <p className="text-[12px] text-slate-500 leading-snug mt-0.5">{hint}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-1.5">{actions}</div>}
    </div>
  )
}

type BtnTone = 'dark' | 'ghost' | 'gold'

/** A capsule button in one of the module's three tones. */
export function Btn({ tone = 'ghost', className = '', children, ...rest }: {
  tone?: BtnTone
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const cls = tone === 'dark' ? ADMIN.darkBtn : tone === 'gold' ? ADMIN.goldBtn : ADMIN.ghostBtn
  return <button {...rest} className={`${cls} ${className}`}>{children}</button>
}

/**
 * A titled panel: a square sheet with its name, an optional count and room for
 * a control or two in the heading row.
 */
export function TitledPanel({ title, count, right, className = '', children }: {
  title: string
  count?: number
  right?: React.ReactNode
  className?: string
  children: React.ReactNode
}) {
  return (
    <section className={`fx-card fx-bleed min-w-0 ${className}`}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 px-3.5 min-h-[44px] py-2 border-b border-[#EEEAE1]">
        <h3 className="text-[13.5px] font-semibold text-slate-900 leading-snug">{title}</h3>
        {count !== undefined && (
          <span className="h-5 min-w-5 px-1.5 rounded-full bg-[#F3ECD9] text-[#7A6220] text-[10.5px] font-bold tabular-nums inline-flex items-center justify-center">
            {count}
          </span>
        )}
        {right && <div className="ml-auto flex flex-wrap items-center justify-end gap-1.5">{right}</div>}
      </div>
      {children}
    </section>
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
    info:  'bg-white/80 border-[#B9B2A2] text-slate-600',
    warn:  'bg-[#FBF4E2] border-[#B8983C] text-[#6E5513]',
    error: 'bg-[#FCEDED] border-[#C24141] text-[#962C2C]',
    good:  'bg-[#EAF5EE] border-[#2E8B57] text-[#1F6B42]',
  }
  return (
    <div className={`border-l-[3px] px-3.5 py-2.5 text-[13px] leading-relaxed mb-3 ${tones[tone]}`}>
      {children}
    </div>
  )
}

// ── Settings forms ──────────────────────────────────────────────────────
//
// The iOS Settings form on a square sheet: related settings in one group, one
// setting per row — what it is on the left, its control on the right — and a
// note under the group for anything the rows cannot say in a line.

/** A titled group of settings rows. */
export function FormGroup({ title, note, children, className = '' }: {
  title?: string
  note?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={className}>
      {title && <h3 className="px-0.5 pb-1.5 text-[13.5px] font-semibold text-slate-900">{title}</h3>}
      <div className="fx-card divide-y divide-[#EEEAE1]">{children}</div>
      {note && <p className="px-0.5 pt-1.5 text-[12px] leading-snug text-slate-500">{note}</p>}
    </section>
  )
}

/**
 * One setting. The control sits beside the statement while there is room and
 * drops under it when there is not; `stack` always puts it underneath.
 */
export function FormRow({ label, hint, children, stack = false }: {
  label: React.ReactNode
  hint?: React.ReactNode
  children: React.ReactNode
  stack?: boolean
}) {
  return (
    <div className={`px-3.5 py-3 ${stack ? 'space-y-2' : 'flex flex-wrap items-center justify-between gap-x-4 gap-y-2'}`}>
      <div className={stack ? '' : 'min-w-0 flex-1 basis-[160px]'}>
        <p className="text-[13.5px] text-slate-900 leading-snug">{label}</p>
        {hint && <p className="text-[12px] text-slate-500 leading-snug mt-0.5">{hint}</p>}
      </div>
      <div className={stack ? 'min-w-0' : 'max-w-full'}>{children}</div>
    </div>
  )
}

/** The iOS switch. */
export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex w-[46px] h-[28px] flex-shrink-0 rounded-full transition-colors
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B8983C]/60 ${
        checked ? 'bg-[#34A853]' : 'bg-slate-200'}`}
    >
      <span className={`absolute top-[2px] left-[2px] w-6 h-6 rounded-full bg-white shadow-[0_2px_5px_rgba(15,23,42,.25)] transition-transform ${
        checked ? 'translate-x-[18px]' : ''}`} />
    </button>
  )
}

/** Centred placeholder for an empty list, sized so a panel does not collapse. */
export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-4 py-10 text-[13px] text-slate-500 text-center leading-relaxed">{children}</p>
}

/** The module's one spinner position, so every screen loads the same way. */
export function Loading() {
  return (
    <div className="py-16 text-center">
      <div className="spinner mx-auto mb-3" />
      <p className="text-[13px] text-slate-500">Loading…</p>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Row lists — a table on a laptop, a card on a phone
//
// The same cells are laid out twice from one piece of markup: a 2-column card
// on phones, the real column template from `sm` up, so the two layouts cannot
// drift apart. On a phone the name and the amount sit on one line instead of
// at opposite ends of a sideways scroll.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Where a cell sits while the row is a card.
 *
 * `A1`–`A3` are the left column, top to bottom: who or what this row is.
 * `B1`–`B3` are the right, right-aligned: the money and the state.
 * `END` pins a cell to a third column beside the first two lines.
 */
export const CELL = {
  A1: 'max-sm:col-start-1 max-sm:row-start-1 min-w-0',
  A2: 'max-sm:col-start-1 max-sm:row-start-2 min-w-0',
  A3: 'max-sm:col-start-1 max-sm:row-start-3 min-w-0',
  B1: 'max-sm:col-start-2 max-sm:row-start-1 max-sm:justify-self-end min-w-0',
  B2: 'max-sm:col-start-2 max-sm:row-start-2 max-sm:justify-self-end min-w-0',
  B3: 'max-sm:col-start-2 max-sm:row-start-3 max-sm:justify-self-end min-w-0',
  END: 'max-sm:col-start-3 max-sm:row-start-1 max-sm:row-span-2 max-sm:self-center max-sm:justify-self-end',
  /** A fact worth a column on a laptop and not worth a line on a phone. */
  DESKTOP: 'max-sm:hidden',
} as const

/** The same slots, shifted one column right, for a list that leads with a checkbox. */
export const CELL_LEAD = {
  PICK: 'max-sm:col-start-1 max-sm:row-start-1 max-sm:row-span-2 max-sm:self-center',
  A1: 'max-sm:col-start-2 max-sm:row-start-1 min-w-0',
  A2: 'max-sm:col-start-2 max-sm:row-start-2 min-w-0',
  A3: 'max-sm:col-start-2 max-sm:row-start-3 min-w-0',
  B1: 'max-sm:col-start-3 max-sm:row-start-1 max-sm:justify-self-end min-w-0',
  B2: 'max-sm:col-start-3 max-sm:row-start-2 max-sm:justify-self-end min-w-0',
  B3: 'max-sm:col-start-3 max-sm:row-start-3 max-sm:justify-self-end min-w-0',
} as const

/** The square sheet a row list sits on. Edge to edge on a phone. */
export function List({ className = '', children }: {
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={`fx-card fx-bleed min-w-0 overflow-hidden ${className}`}>
      {children}
    </div>
  )
}

/** The heading row. Phones do not get one: the rows there are cards. */
export function ListHead({ cols, children }: {
  /** The `sm:grid-cols-[…]` literal this list's rows use. */
  cols: string
  children: React.ReactNode
}) {
  return (
    <div className={`hidden sm:grid ${cols} items-center gap-x-3 px-3.5 py-2
                     bg-[#F7F5F0] border-b border-[#EEEAE1]`}>
      {children}
    </div>
  )
}

/** A column heading. */
export function Col({ right, className = '', children }: {
  right?: boolean
  className?: string
  children: React.ReactNode
}) {
  return (
    <span className={`${LABEL} truncate ${right ? 'text-right' : ''} ${className}`}>{children}</span>
  )
}

/**
 * Fixed widths for a trailing action column on a phone: one, two or three
 * `TAP` buttons, so the amounts down a list keep a straight edge.
 */
const TRAIL = {
  1: 'grid-cols-[minmax(0,1fr)_auto_32px]',
  2: 'grid-cols-[minmax(0,1fr)_auto_68px]',
  3: 'grid-cols-[minmax(0,1fr)_auto_104px]',
} as const

/**
 * One row. Two columns and as many lines as its cells ask for on a phone; from
 * `sm` up, whatever `cols` says. `onClick` makes the whole row the button.
 */
export function Row({ cols, trailing, lead, below, onClick, className = '', children }: {
  cols: string
  trailing?: 1 | 2 | 3
  lead?: boolean
  /** Full-width content under the cells — a bill's lines, a reason, a note. */
  below?: React.ReactNode
  onClick?: () => void
  className?: string
  children: React.ReactNode
}) {
  const grid = `grid ${lead
    ? 'grid-cols-[auto_minmax(0,1fr)_auto]'
    : trailing
    ? TRAIL[trailing]
    : 'grid-cols-[minmax(0,1fr)_auto]'} ${cols}
    items-center gap-x-3 gap-y-1 sm:gap-y-0 px-3.5 py-2.5`
  return (
    <div className={`border-b border-[#F0ECE3] last:border-b-0 transition-colors ${
      onClick ? 'cursor-pointer hover:bg-[#FAF7F0] active:bg-[#F5F1E6]' : 'hover:bg-[#FBFAF6]'} ${className}`}
         onClick={onClick}
         role={onClick ? 'button' : undefined}
         tabIndex={onClick ? 0 : undefined}
         onKeyDown={onClick ? e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() } } : undefined}>
      <div className={grid}>
        {children}
      </div>
      {below && <div className="px-3.5 pb-2.5 -mt-0.5">{below}</div>}
    </div>
  )
}

/** An icon-only round button, 32px, the size of a capsule button's height. */
export const TAP = 'inline-flex items-center justify-center w-8 h-8 rounded-full flex-shrink-0 transition-colors hover:bg-slate-100 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B8983C]/60'
