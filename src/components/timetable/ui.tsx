'use client'

import React, { useState, useRef, useEffect, useMemo, useId } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Search, ChevronDown, Check, X, AlertTriangle, Trash2 } from 'lucide-react'
import { ConfirmModal } from '@/components/salary/ui'
import { WEEKDAY_LABELS } from '@/lib/timetable/types'
import type { Weekday } from '@/lib/timetable/types'

// ──────────────────────────────────────────────────────────────
// The timetable's design kit.
//
// The transport admin's glass, squared the way Fees and Salary square it:
//
//   Large surfaces — the workspace deck, the grid, panels, popups — have
//   square corners. A timetable is a printed sheet, and a dense grid sits
//   flush on straight edges.
//
//   Controls — buttons, segments, fields, chips — are rounded. They are what
//   a finger presses, and the round shape says so.
//
// Labels are sentence case. Headings wrap instead of truncating.
//
// The names (INPUT, BTN_PRIMARY, Section, SmartSelect…) are the ones the
// timetable files have always imported from here, so every screen picks the
// language up from this one file.
// ──────────────────────────────────────────────────────────────

/** Keyboard focus, in the honey gold the bus and fee admins use. */
export const FOCUS =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B8983C]/60'

/**
 * The press: a hair of scale on the click itself, which a touchscreen never
 * gets from a hover state. Transform only, so it costs no layout.
 */
export const TAP =
  'transition-[background-color,border-color,color,box-shadow,transform] duration-150 ease-out ' +
  'active:scale-[0.97] active:duration-75 ' +
  'motion-reduce:transition-colors motion-reduce:active:scale-100'

/**
 * A field without a width, for callers that set their own. Appending a width
 * to INPUT does not work: both utilities land in the class list and the
 * stylesheet's order picks the winner, not the order they were written in.
 */
export const INPUT_SIZED =
  'h-10 sm:h-9 rounded-[10px] bg-white border border-[#DDD8CC] px-3 text-[13.5px] text-slate-900 ' +
  'placeholder:text-slate-400 shadow-[inset_0_1px_2px_rgba(15,23,42,.04)] ' +
  'focus:outline-none focus:border-[#B8983C] focus:ring-2 focus:ring-[#B8983C]/20 transition ' +
  'disabled:bg-slate-50 disabled:text-slate-400'
export const INPUT = `w-full min-w-0 ${INPUT_SIZED}`

/** 40px on a phone, 32px from sm up where the pointer is precise. */
export const BTN_BASE =
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-full font-semibold ' +
  'h-10 sm:h-8 px-3.5 text-[13px] sm:text-[12.5px] ' +
  `disabled:opacity-45 disabled:pointer-events-none ${TAP} ${FOCUS}`

export const BTN_PRIMARY =
  `${BTN_BASE} text-white bg-gradient-to-b from-[#3D3B40] to-[#27272A] ` +
  'shadow-[inset_0_1px_0_rgba(255,255,255,.16),0_6px_14px_-8px_rgba(15,23,42,.6)] hover:from-[#46444A] hover:to-[#2E2E31]'
export const BTN_NEUTRAL =
  `${BTN_BASE} text-slate-700 bg-white border border-[#E2DDD2] shadow-[0_1px_2px_rgba(15,23,42,.05)] ` +
  'hover:text-slate-900 hover:border-[#CFC8B8]'
/** Lowest emphasis — no edge until hovered. */
export const BTN_QUIET =
  `${BTN_BASE} text-slate-600 hover:bg-black/[.045] hover:text-slate-900`
/** The step that goes out to everyone: publishing. */
export const BTN_GO =
  `${BTN_BASE} text-white bg-gradient-to-b from-[#C7A84C] to-[#A9892F] ` +
  'shadow-[inset_0_1px_0_rgba(255,255,255,.25),0_6px_14px_-8px_rgba(122,98,32,.7)] hover:from-[#CDAF55] hover:to-[#9E8029]'
export const BTN_DANGER =
  `${BTN_BASE} text-rose-700 bg-white border border-rose-200 hover:bg-rose-50`

/** The small in-panel size: a chip-height capsule. Pair with a SM_* tone. */
export const BTN_SM =
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-full font-semibold ' +
  'h-9 sm:h-7 px-3 text-[12.5px] sm:text-[12px] ' +
  `disabled:opacity-45 disabled:pointer-events-none ${TAP} ${FOCUS}`
export const SM_GHOST = 'text-slate-700 bg-white border border-[#E2DDD2] hover:border-[#CFC8B8] hover:text-slate-900'
export const SM_DARK = 'text-white bg-gradient-to-b from-[#3D3B40] to-[#27272A] shadow-[inset_0_1px_0_rgba(255,255,255,.16)]'
export const SM_QUIET = 'text-slate-600 hover:bg-black/[.045] hover:text-slate-900'
export const SM_DANGER = 'text-rose-700 hover:bg-rose-50'

/** An icon-only round button. */
export const ICON_BTN =
  'inline-flex items-center justify-center w-9 h-9 sm:w-8 sm:h-8 rounded-full flex-shrink-0 text-slate-400 ' +
  `hover:text-slate-900 hover:bg-black/[.05] disabled:opacity-35 disabled:pointer-events-none ${TAP} ${FOCUS}`
export const ICON_BTN_DANGER =
  'inline-flex items-center justify-center w-9 h-9 sm:w-8 sm:h-8 rounded-full flex-shrink-0 text-slate-400 ' +
  `hover:text-rose-600 hover:bg-rose-50 disabled:opacity-35 disabled:pointer-events-none ${TAP} ${FOCUS}`

/** A choice that is on or off: weekdays, grades, modes. */
export const choice = (on: boolean) =>
  `inline-flex items-center gap-1.5 h-9 sm:h-8 px-3 rounded-full text-[12.5px] font-semibold whitespace-nowrap ${TAP} ${FOCUS} ${
    on
      ? 'text-white bg-gradient-to-b from-[#3D3B40] to-[#27272A] shadow-[inset_0_1px_0_rgba(255,255,255,.16)]'
      : 'text-slate-700 bg-white border border-[#E2DDD2] hover:border-[#CFC8B8]'
  }`

/** A field name, a group caption. Sentence case, quiet. */
export const SECTION_LABEL = 'text-[12px] font-semibold text-slate-500 leading-snug'

/** One row of a hairlined list on a solid sheet. */
export const ROW = 'flex items-center gap-3 px-3 py-2.5 bg-white border-b border-[#EEEAE1] last:border-b-0'

/** The square solid sheet a list sits on. */
export const LIST = 'fx-card min-w-0'

/** The shared SmartTypeahead, dressed as a field and a rounded menu. */
export const TYPEAHEAD = {
  field:
    'flex items-center gap-2 h-10 sm:h-9 rounded-[10px] border border-[#DDD8CC] bg-white px-3 ' +
    'shadow-[inset_0_1px_2px_rgba(15,23,42,.04)] focus-within:border-[#B8983C] focus-within:ring-2 focus-within:ring-[#B8983C]/20 transition',
  menu:
    'rounded-[14px] bg-white border border-black/[.07] overflow-hidden py-1 ' +
    'shadow-[0_24px_60px_-20px_rgba(15,23,42,.45),0_2px_8px_rgba(15,23,42,.08)]',
  row: (active: boolean) => `px-3.5 py-2 ${active ? 'bg-[#FAF7F0]' : 'bg-white'}`,
}

/** Square checkbox in the module's ink. */
export const CHECK = 'w-4 h-4 rounded-[4px] accent-[#27272A] cursor-pointer flex-shrink-0'

// ── Section ───────────────────────────────────────────────────
// Sections share one content sheet, divided by a hairline rather than each
// floating in its own card.

export function Section({
  title, hint, right, first = false, children,
}: {
  title?: string
  hint?: React.ReactNode
  right?: React.ReactNode
  first?: boolean
  children: React.ReactNode
}) {
  return (
    <section className={first ? '' : 'border-t border-[#EEEAE1] pt-5 mt-5'}>
      {(title || right) && (
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2 mb-3">
          <div className="min-w-0 flex-1 basis-[200px]">
            {title && <h3 className="text-[14px] font-semibold text-slate-900 leading-snug break-words">{title}</h3>}
            {hint && <p className="text-[12px] text-slate-500 mt-1 leading-snug max-w-prose break-words">{hint}</p>}
          </div>
          {right && <div className="min-w-0 max-w-full">{right}</div>}
        </div>
      )}
      {children}
    </section>
  )
}

export function Field({
  label, children, hint, group = false,
}: {
  label: string
  children: React.ReactNode
  hint?: string
  /**
   * A plain container instead of a <label>. A label forwards its clicks to the
   * first control inside it — right for one input, wrong for a cluster.
   */
  group?: boolean
}) {
  const Tag = group ? 'div' : 'label'
  return (
    <Tag className="block min-w-0">
      <span className={`block ${SECTION_LABEL} mb-1.5`}>{label}</span>
      {children}
      {hint && <span className="block text-[11.5px] text-slate-400 mt-1 leading-snug">{hint}</span>}
    </Tag>
  )
}

/** A full-width notice. `tone` decides whether it reads as news or as a problem. */
export function Notice({ tone = 'info', icon: Icon, className = '', children }: {
  tone?: 'info' | 'warn' | 'error' | 'good'
  icon?: React.ElementType
  className?: string
  children: React.ReactNode
}) {
  const tones = {
    info: 'bg-white/80 border-[#B9B2A2] text-slate-600',
    warn: 'bg-[#FBF4E2] border-[#B8983C] text-[#6E5513]',
    error: 'bg-[#FCEDED] border-[#C24141] text-[#962C2C]',
    good: 'bg-[#EAF5EE] border-[#2E8B57] text-[#1F6B42]',
  }
  const I = Icon ?? AlertTriangle
  return (
    <div className={`flex items-start gap-2 border-l-[3px] px-3 py-2.5 text-[12.5px] leading-relaxed ${tones[tone]} ${className}`}>
      <I size={14} className="flex-shrink-0 mt-[3px]" aria-hidden />
      <div className="min-w-0 break-words">{children}</div>
    </div>
  )
}

type ChipTone = 'neutral' | 'gold' | 'dark' | 'good' | 'bad' | 'indigo'
const CHIP_TONE: Record<ChipTone, string> = {
  neutral: 'bg-[#F1EEE7] text-slate-600',
  gold: 'bg-[#FBF1D6] text-[#7A5D12]',
  dark: 'bg-[#27272A] text-white',
  good: 'bg-[#E6F2EA] text-[#1F6B42]',
  bad: 'bg-[#FBE7E7] text-[#A93232]',
  indigo: 'bg-indigo-50 text-indigo-700',
}

/** A status chip. */
export function Chip({ tone = 'neutral', className = '', style, title, children }: {
  tone?: ChipTone
  className?: string
  style?: React.CSSProperties
  title?: string
  children: React.ReactNode
}) {
  return (
    <span
      title={title}
      style={style}
      className={`inline-flex items-center gap-1 h-5 px-2 rounded-full text-[11px] font-semibold leading-none whitespace-nowrap flex-shrink-0 ${CHIP_TONE[tone]} ${className}`}
    >
      {children}
    </span>
  )
}

/** The module's one spinner position. */
export function Loading({ className = 'py-16' }: { className?: string }) {
  return (
    <div className={`flex justify-center ${className}`} role="status" aria-label="Loading">
      <div className="spinner" />
    </div>
  )
}

/** Centred note for an empty list or panel. */
export function Empty({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <p className={`px-4 py-6 text-center text-[13px] text-slate-500 leading-relaxed ${className}`}>{children}</p>
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
      title={label}
      disabled={disabled}
      onClick={(e) => { e.stopPropagation(); onChange(!checked) }}
      className={`relative inline-flex w-[42px] h-[26px] flex-shrink-0 rounded-full transition-colors disabled:opacity-45 ${FOCUS} ${
        checked ? 'bg-[#34A853]' : 'bg-slate-200'}`}
    >
      <span className={`absolute top-[2px] left-[2px] w-[22px] h-[22px] rounded-full bg-white shadow-[0_2px_5px_rgba(15,23,42,.25)] transition-transform ${
        checked ? 'translate-x-[16px]' : ''}`} />
    </button>
  )
}

// ── Segmented nav ─────────────────────────────────────────────
// A capsule with a sliding dark thumb, filling its row. Below sm the inactive
// items keep only their icon so the bar never wraps or clips; the active one
// always names itself.

export interface SegItem<K extends string> {
  key: K
  label: string
  icon?: React.ElementType
}

export function SegmentedNav<K extends string>({
  items, value, onChange,
}: {
  items: SegItem<K>[]
  value: K
  onChange: (key: K) => void
}) {
  const id = useId()
  return (
    <div className="flex w-full items-center gap-0.5 p-1 rounded-full bg-[#EFEBE3] border border-black/[.04]" role="tablist">
      {items.map(({ key, label, icon: Icon }) => {
        const active = value === key
        return (
          <button
            key={key}
            role="tab"
            aria-selected={active}
            aria-label={label}
            title={label}
            onClick={() => onChange(key)}
            className={`relative min-w-0 inline-flex items-center justify-center gap-1.5 h-9 sm:h-8 px-3 rounded-full text-[12.5px] font-semibold whitespace-nowrap transition-colors ${FOCUS} ${
              active ? 'flex-1 text-white' : 'flex-none sm:flex-1 text-slate-600 hover:text-slate-900'
            }`}
          >
            {active && (
              <motion.span
                layoutId={`seg-${id}`}
                className="absolute inset-0 rounded-full bg-gradient-to-b from-[#3D3B40] to-[#27272A] shadow-[inset_0_1px_0_rgba(255,255,255,.16)]"
                transition={{ type: 'spring', stiffness: 420, damping: 34 }}
              />
            )}
            <span className="relative z-10 inline-flex items-center gap-1.5 min-w-0">
              {Icon && <Icon size={14} className={`flex-shrink-0 ${active ? 'text-[#E9DDBB]' : ''}`} />}
              <span className={active ? 'inline' : 'hidden sm:inline'}>{label}</span>
            </span>
          </button>
        )
      })}
    </div>
  )
}

// ── Day switch ────────────────────────────────────────────────
// A phone shows one day of the week at a time rather than a table that would
// have to scroll sideways. The days share the row evenly, so six of them fit
// a 320px screen.

const JS_DAYS: Weekday[] = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

/** Today, when it is one of these days; otherwise the first of them. */
export function defaultDay(days: Weekday[]): Weekday {
  const today = JS_DAYS[new Date().getDay()]
  return days.includes(today) ? today : days[0]
}

/** Keeps a chosen day valid as the week it belongs to changes. */
export function useDay(days: Weekday[]) {
  const [day, setDay] = useState<Weekday>(() => defaultDay(days))
  const current = days.includes(day) ? day : defaultDay(days)
  return [current, setDay] as const
}

export function DayTabs({ days, value, onChange, className = '' }: {
  days: Weekday[]
  value: Weekday
  onChange: (d: Weekday) => void
  className?: string
}) {
  const id = useId()
  const today = JS_DAYS[new Date().getDay()]
  return (
    <div role="tablist" aria-label="Day" className={`flex w-full gap-0.5 p-1 rounded-full bg-[#EFEBE3] ${className}`}>
      {days.map((d) => {
        const active = d === value
        return (
          <button
            key={d}
            role="tab"
            aria-selected={active}
            aria-label={WEEKDAY_LABELS[d]}
            onClick={() => onChange(d)}
            className={`relative flex-1 min-w-0 h-9 rounded-full text-[12.5px] font-semibold transition-colors ${FOCUS} ${
              active ? 'text-white' : 'text-slate-600'}`}
          >
            {active && (
              <motion.span
                layoutId={`day-${id}`}
                className="absolute inset-0 rounded-full bg-gradient-to-b from-[#3D3B40] to-[#27272A] shadow-[inset_0_1px_0_rgba(255,255,255,.16)]"
                transition={{ type: 'spring', stiffness: 420, damping: 34 }}
              />
            )}
            <span className="relative z-10">{WEEKDAY_LABELS[d].slice(0, 3)}</span>
            {d === today && !active && (
              <span aria-hidden className="absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-[#B8983C]" />
            )}
          </button>
        )
      })}
    </div>
  )
}

// ── Mini tabs ─────────────────────────────────────────────────
// A compact switch that sits inside a toolbar row. Wraps rather than scrolls,
// so every option stays on screen.

export interface MiniTab<K extends string> {
  key: K
  label: string
  meta?: string
  icon?: React.ElementType
}

export function MiniTabs<K extends string>({
  tabs, value, onChange, className = '', ariaLabel,
}: {
  tabs: MiniTab<K>[]
  value: K
  onChange: (key: K) => void
  className?: string
  ariaLabel?: string
}) {
  if (tabs.length < 2) return null
  return (
    <div role="tablist" aria-label={ariaLabel} className={`inline-flex flex-wrap max-w-full gap-0.5 p-0.5 rounded-[14px] bg-[#EFEBE3] ${className}`}>
      {tabs.map(({ key, label, meta, icon: Icon }) => {
        const active = value === key
        return (
          <button
            key={key}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(key)}
            className={`min-w-0 inline-flex items-center gap-1.5 h-8 sm:h-7 px-2.5 rounded-full text-[12px] font-semibold ${TAP} ${FOCUS} ${
              active ? 'bg-white text-slate-900 shadow-[0_1px_3px_rgba(15,23,42,.18)]' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {Icon && <Icon size={13} className={active ? 'text-[#B8983C]' : 'text-slate-400'} />}
            <span className="break-words text-left leading-tight">{label}</span>
            {meta && <span className="tabular-nums text-slate-400">{meta}</span>}
          </button>
        )
      })}
    </div>
  )
}

// ── Smart select (searchable combobox) ────────────────────────

export interface SmartOption {
  value: string
  label: string
  sublabel?: string
  color?: string
  badge?: string
}

export function SmartSelect({
  options, value, onChange, placeholder = 'Select…', searchPlaceholder = 'Search…',
  allowClear = false, emptyText = 'No matches', className = '', buttonClassName = '',
  leadingIcon, disabled = false, align = 'left',
}: {
  options: SmartOption[]
  value: string
  onChange: (value: string) => void
  placeholder?: string
  searchPlaceholder?: string
  allowClear?: boolean
  emptyText?: string
  className?: string
  buttonClassName?: string
  leadingIcon?: React.ReactNode
  disabled?: boolean
  /** Which edge the menu hangs from once it is wider than the trigger (sm up). */
  align?: 'left' | 'right'
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const wrapRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const selected = options.find((o) => o.value === value) ?? null
  // The search box only earns its place once the list is long enough to need it.
  const searchable = options.length > 7

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(q) ||
        (o.sublabel ?? '').toLowerCase().includes(q) ||
        (o.badge ?? '').toLowerCase().includes(q),
    )
  }, [options, query])

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // Closes the menu, not the popup it sits in.
      e.stopPropagation()
      setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey, true)
    // No autofocus on touch: it raises the keyboard over the list being picked from.
    const fine = typeof window !== 'undefined' && window.matchMedia?.('(pointer: fine)').matches
    const t = fine ? setTimeout(() => searchRef.current?.focus(), 0) : undefined
    return () => {
      document.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey, true)
      if (t) clearTimeout(t)
    }
  }, [open])

  useEffect(() => {
    if (!open) setQuery('')
  }, [open])

  const pick = (v: string) => {
    onChange(v)
    setOpen(false)
  }

  return (
    <div ref={wrapRef} className={`relative min-w-0 ${className}`}>
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`w-full inline-flex items-center gap-2 h-10 sm:h-9 rounded-[10px] bg-white border border-[#DDD8CC] px-3 text-[13.5px] text-left shadow-[inset_0_1px_2px_rgba(15,23,42,.04)] transition hover:border-[#CFC8B8] ${FOCUS} disabled:opacity-50 disabled:cursor-not-allowed ${
          open ? 'border-[#B8983C] ring-2 ring-[#B8983C]/20' : ''} ${buttonClassName}`}
      >
        {leadingIcon}
        {selected?.color && <span className="w-2.5 h-2.5 rounded-[3px] flex-shrink-0" style={{ background: selected.color }} />}
        <span className={`flex-1 min-w-0 truncate ${selected ? 'text-slate-900' : 'text-slate-400'}`}>
          {selected?.label ?? placeholder}
        </span>
        {selected?.badge && <Chip tone="neutral">{selected.badge}</Chip>}
        {allowClear && selected && !disabled ? (
          <span
            role="button"
            tabIndex={-1}
            aria-label="Clear"
            onClick={(e) => { e.stopPropagation(); onChange('') }}
            className="text-slate-400 hover:text-slate-900 flex-shrink-0"
          >
            <X size={14} />
          </span>
        ) : (
          <ChevronDown size={15} className={`text-slate-400 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
        )}
      </button>

      {open && (
        // As wide as its trigger on a phone, so it can never push the page
        // sideways; allowed a little wider from sm up.
        <div
          className={`absolute z-50 mt-1.5 w-full sm:min-w-[15rem] max-w-[calc(100vw-2rem)] flex flex-col rounded-[14px] bg-white border border-black/[.07] shadow-[0_24px_60px_-20px_rgba(15,23,42,.45),0_2px_8px_rgba(15,23,42,.08)] overflow-hidden ${
            align === 'right' ? 'right-0' : 'left-0'}`}
          role="listbox"
        >
          {searchable && (
            <div className="p-2 border-b border-slate-100">
              <div className="relative">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                <input
                  ref={searchRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={searchPlaceholder}
                  className={`${INPUT} pl-8`}
                />
              </div>
            </div>
          )}
          <div className="max-h-64 overflow-y-auto overscroll-contain py-1">
            {filtered.length === 0 ? (
              <p className="px-3.5 py-3 text-[13px] text-slate-400 text-center">{emptyText}</p>
            ) : (
              filtered.map((o) => {
                const active = o.value === value
                return (
                  <button
                    key={o.value}
                    type="button"
                    role="option"
                    aria-selected={active}
                    onClick={() => pick(o.value)}
                    className={`w-full flex items-center gap-2.5 px-3.5 py-2.5 sm:py-2 text-left transition-colors hover:bg-[#FAF7F0] focus-visible:bg-[#FAF7F0] focus-visible:outline-none ${
                      active ? 'bg-[#FAF7F0]' : ''}`}
                  >
                    {o.color && <span className="w-2.5 h-2.5 rounded-[3px] flex-shrink-0" style={{ background: o.color }} />}
                    <span className="flex-1 min-w-0">
                      <span className="block text-[13.5px] text-slate-900 leading-snug break-words">{o.label}</span>
                      {o.sublabel && <span className="block text-[11.5px] text-slate-400 leading-snug break-words">{o.sublabel}</span>}
                    </span>
                    {o.badge && <Chip tone="neutral">{o.badge}</Chip>}
                    {active && <Check size={15} className="text-[#B8983C] flex-shrink-0" />}
                  </button>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Confirmations ─────────────────────────────────────────────
// Every "are you sure" in the timetable goes through one popup, the same one
// Salary asks with, instead of the browser's own grey box. `askConfirm` is a
// promise so a handler reads exactly as it did with window.confirm.

interface ConfirmRequest {
  title: string
  body: React.ReactNode
  confirmLabel: string
  tone?: 'dark' | 'danger'
  resolve: (ok: boolean) => void
}

let raise: ((r: ConfirmRequest) => void) | null = null

export function askConfirm(opts: Omit<ConfirmRequest, 'resolve'>): Promise<boolean> {
  if (!raise) {
    // Outside the admin workspace there is no host mounted; fall back rather than hang.
    return Promise.resolve(typeof window !== 'undefined' && window.confirm(typeof opts.body === 'string' ? opts.body : opts.title))
  }
  return new Promise((resolve) => raise!({ ...opts, resolve }))
}

/** Mount once, at the top of the workspace. */
export function ConfirmHost() {
  const [req, setReq] = useState<ConfirmRequest | null>(null)
  useEffect(() => {
    raise = (r) => setReq((prev) => {
      // A second question while one is open answers the first with "no".
      prev?.resolve(false)
      return r
    })
    return () => { raise = null }
  }, [])

  const answer = (ok: boolean) => {
    req?.resolve(ok)
    setReq(null)
  }

  return (
    <AnimatePresence>
      {req && (
        <ConfirmModal
          key="tt-confirm"
          title={req.title}
          icon={req.tone === 'danger' ? <Trash2 size={17} /> : <AlertTriangle size={17} />}
          confirmLabel={req.confirmLabel}
          tone={req.tone ?? 'dark'}
          onConfirm={() => answer(true)}
          onClose={() => answer(false)}
        >
          {typeof req.body === 'string' ? <p>{req.body}</p> : req.body}
        </ConfirmModal>
      )}
    </AnimatePresence>
  )
}
