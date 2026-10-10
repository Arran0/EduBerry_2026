'use client'

import React, { useState, useRef, useEffect, useMemo } from 'react'
import { Search, ChevronDown, Check, X, ChevronLeft, ChevronRight, CalendarDays } from 'lucide-react'

// ── Admin design language ─────────────────────────────────────
// Sharp corners, flat surfaces, thin zinc borders, a restrained
// zinc / gold palette — matching the admin workspace. No rounded
// floating cards, no drop shadows.

/**
 * `INPUT` without the width, for callers that set their own (`w-16`, `flex-1`…).
 * Appending a width to `INPUT` does NOT work: both utilities end up in the
 * class list and Tailwind's stylesheet order decides the winner, not the order
 * you wrote them in — so `w-full` keeps winning and the field blows its row out.
 */
export const INPUT_SIZED =
  'border border-[#D4D4D8] bg-white px-3 py-2 sm:py-1.5 text-sm text-[#18181B] placeholder:text-[#A1A1AA] focus:outline-none focus:border-[#27272A] transition-colors'
export const INPUT = `w-full ${INPUT_SIZED}`

/**
 * The press. A button that only changes colour on `:hover` gives a mouse
 * nothing on the click itself and a touchscreen nothing at all — the finger is
 * already over the hover state. A sub-pixel sink plus a hair of scale reads as
 * a physical press at any input, costs no layout (transform only), and is
 * dropped entirely for anyone who has asked for less motion.
 */
export const TAP =
  'transition-[background-color,border-color,color,box-shadow,transform] duration-150 ease-out ' +
  'active:scale-[0.97] active:duration-75 ' +
  'motion-reduce:transition-colors motion-reduce:active:scale-100'

/** Keyboard focus, in the gold the rest of the workspace accents with. */
export const FOCUS =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B8983C] focus-visible:ring-offset-1 focus-visible:ring-offset-white'

/**
 * Buttons are a comfortable 44px tap target on a phone and noticeably tighter
 * from `sm` up, where the pointer is precise and the screen is full of grid.
 * A toolbar of eight 44px-tall buttons on a desktop is wasted canvas.
 */
export const BTN_BASE =
  `inline-flex items-center justify-center gap-1.5 whitespace-nowrap font-medium ` +
  `min-h-[2.75rem] px-3 text-sm sm:min-h-0 sm:py-1.5 sm:text-[13px] ` +
  `disabled:opacity-50 disabled:pointer-events-none ${TAP} ${FOCUS}`

export const BTN_PRIMARY =
  `${BTN_BASE} bg-[#27272A] hover:bg-[#18181B] text-[#F5F5F5]`
export const BTN_NEUTRAL =
  `${BTN_BASE} bg-[#F5F5F5] border border-[#D4D4D8] text-[#18181B] hover:bg-[#EBEBEB]`
/** Lowest-emphasis action — borderless until hovered. */
export const BTN_QUIET =
  `${BTN_BASE} text-[#71717A] hover:bg-[#F5F5F5] hover:text-[#18181B]`
export const BTN_GO =
  `${BTN_BASE} bg-emerald-700 hover:bg-emerald-800 text-white`
export const BTN_DANGER =
  `${BTN_BASE} text-rose-600 border border-rose-200 bg-white hover:bg-rose-50`
/** The small in-panel variant: a chip, not a button bar. */
export const BTN_SM =
  `inline-flex items-center justify-center gap-1.5 whitespace-nowrap font-medium ` +
  `min-h-[2.25rem] px-2.5 text-[13px] sm:min-h-0 sm:py-1 sm:text-xs ` +
  `disabled:opacity-50 disabled:pointer-events-none ${TAP} ${FOCUS}`

export const SECTION_LABEL = 'text-[10px] font-bold uppercase tracking-widest text-[#525252]'
export const ROW = 'flex items-center gap-3 px-3 py-2.5 bg-[#F5F5F5] border border-[#E4E4E7]'

// ── Section ───────────────────────────────────────────────────
// Sections live inside one shared content pane, separated by a hairline
// rule rather than each floating in its own card.

export function Section({
  title,
  hint,
  right,
  first = false,
  children,
}: {
  title?: string
  hint?: string
  right?: React.ReactNode
  first?: boolean
  children: React.ReactNode
}) {
  return (
    <section className={first ? '' : 'border-t border-[#E4E4E7] pt-5 mt-5'}>
      {(title || right) && (
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="min-w-0">
            {title && <p className={SECTION_LABEL}>{title}</p>}
            {hint && <p className="text-xs text-[#71717A] mt-1.5 max-w-prose">{hint}</p>}
          </div>
          {right && <div className="flex-shrink-0">{right}</div>}
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
  /** One line under the control, for a field whose meaning isn't obvious. */
  hint?: string
  /**
   * Renders a plain container instead of a <label>. A label forwards its
   * clicks to the first control inside it, which is right for one input and
   * wrong for a cluster of them — a colour swatch should not also focus a
   * text box. Set this whenever the field holds more than one control.
   */
  group?: boolean
}) {
  const Tag = group ? 'div' : 'label'
  return (
    <Tag className="block">
      <span className="block text-[10px] font-bold uppercase tracking-widest text-[#525252] mb-1.5">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-[#A1A1AA] mt-1 leading-snug">{hint}</span>}
    </Tag>
  )
}

// ── Segmented nav ─────────────────────────────────────────────
// Full-width, single-line tab strip. Each item gets an equal share of the
// bar on desktop. On narrow screens inactive items collapse to their icon and
// the active item keeps its label, so the bar never wraps.

export interface SegItem<K extends string> {
  key: K
  label: string
  icon?: React.ElementType
}

export function SegmentedNav<K extends string>({
  items,
  value,
  onChange,
}: {
  items: SegItem<K>[]
  value: K
  onChange: (key: K) => void
}) {
  return (
    <div className="flex w-full items-stretch border border-[#D4D4D8] bg-white divide-x divide-[#E4E4E7]">
      {items.map(({ key, label, icon: Icon }) => {
        const active = value === key
        return (
          <button
            key={key}
            onClick={() => onChange(key)}
            aria-pressed={active}
            title={label}
            className={`min-w-0 inline-flex items-center justify-center gap-1.5 px-2.5 sm:px-3 min-h-[2.75rem] sm:min-h-0 sm:py-1.5 text-sm sm:text-[13px] font-medium ${TAP} ${FOCUS} ${
              active ? 'flex-1' : 'flex-none lg:flex-1'
            } ${
              active
                ? 'bg-[#27272A] text-[#F5F5F5]'
                : 'text-[#52525B] hover:bg-[#F5F5F5] hover:text-[#18181B]'
            }`}
          >
            {Icon && <Icon size={15} className="flex-shrink-0" />}
            <span className={`truncate ${active ? 'inline' : 'hidden lg:inline'}`}>{label}</span>
          </button>
        )
      })}
    </div>
  )
}

// ── Mini tabs ─────────────────────────────────────────────────
// A compact segmented switch for picking one of a handful of views — period
// groups, grid modes. Unlike SegmentedNav it does not claim the full width, so
// it can sit inside a toolbar row next to other controls, and it scrolls
// sideways rather than wrapping when there are more options than room.

export interface MiniTab<K extends string> {
  key: K
  label: string
  /** Second line / trailing count — the thing that makes the choice obvious. */
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
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={`inline-flex max-w-full overflow-x-auto border border-[#D4D4D8] bg-white divide-x divide-[#E4E4E7] ${className}`}
    >
      {tabs.map(({ key, label, meta, icon: Icon }) => {
        const active = value === key
        return (
          <button
            key={key}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(key)}
            className={`flex-shrink-0 inline-flex items-center gap-1.5 px-2.5 min-h-[2.25rem] sm:min-h-0 sm:py-1 text-[13px] sm:text-xs font-medium ${TAP} ${FOCUS} ${
              active
                ? 'bg-[#27272A] text-white'
                : 'text-[#52525B] hover:bg-[#F5F5F5] hover:text-[#18181B]'
            }`}
          >
            {Icon && <Icon size={13} className={active ? 'text-[#B8983C]' : 'text-[#A1A1AA]'} />}
            <span className="truncate max-w-[9rem]">{label}</span>
            {meta && (
              <span className={`tabular-nums ${active ? 'text-white/55' : 'text-[#A1A1AA]'}`}>{meta}</span>
            )}
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
  options,
  value,
  onChange,
  placeholder = 'Select…',
  searchPlaceholder = 'Search…',
  allowClear = false,
  emptyText = 'No matches',
  className = '',
  buttonClassName = '',
  leadingIcon,
  disabled = false,
  align = 'left',
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
  /** Which edge the dropdown panel hangs from. Use 'right' when the trigger sits at the
   *  right edge of a narrow container — the panel is often wider than the trigger, and
   *  left-anchoring lets it spill past the container edge and get clipped. */
  align?: 'left' | 'right'
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const wrapRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const selected = options.find((o) => o.value === value) ?? null

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
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    const t = setTimeout(() => searchRef.current?.focus(), 0)
    return () => {
      document.removeEventListener('mousedown', onDown)
      clearTimeout(t)
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
    <div ref={wrapRef} className={`relative ${className}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={`w-full inline-flex items-center gap-2 border border-[#D4D4D8] bg-white px-3 min-h-[2.75rem] sm:min-h-0 sm:py-1.5 text-sm text-left transition-colors hover:border-[#A1A1AA] focus-visible:outline-none focus-visible:border-[#27272A] focus-visible:ring-1 focus-visible:ring-[#B8983C] disabled:opacity-50 disabled:cursor-not-allowed rounded-lg ${buttonClassName}`}
      >
        {leadingIcon}
        {selected?.color && (
          <span className="w-2.5 h-2.5 flex-shrink-0" style={{ background: selected.color }} />
        )}
        <span className={`flex-1 min-w-0 truncate ${selected ? 'text-[#18181B]' : 'text-[#A1A1AA]'}`}>
          {selected?.label ?? placeholder}
        </span>
        {selected?.badge && (
          <span className="text-[10px] px-1.5 py-0.5 bg-[#F5F5F5] border border-[#E4E4E7] text-[#71717A] flex-shrink-0 capitalize">
            {selected.badge}
          </span>
        )}
        {allowClear && selected && !disabled ? (
          <span
            role="button"
            tabIndex={-1}
            onClick={(e) => {
              e.stopPropagation()
              onChange('')
            }}
            className="text-[#A1A1AA] hover:text-[#18181B] flex-shrink-0"
          >
            <X size={14} />
          </span>
        ) : (
          <ChevronDown size={15} className="text-[#A1A1AA] flex-shrink-0" />
        )}
      </button>

      {open && (
        <div className={`absolute z-50 mt-1 w-full min-w-[13rem] max-w-[calc(100vw-2rem)] bg-white border border-[#D4D4D8] shadow-md overflow-hidden rounded-lg ${align === 'right' ? 'right-0' : 'left-0'}`}>
          <div className="p-2 border-b border-[#E4E4E7]">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#A1A1AA] pointer-events-none" />
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={searchPlaceholder}
                className="w-full pl-8 pr-2 py-1.5 text-sm border border-[#D4D4D8] bg-white focus:outline-none focus:border-[#27272A] rounded-md"
              />
            </div>
          </div>
          <div className="max-h-60 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <p className="px-3 py-3 text-sm text-[#A1A1AA] text-center">{emptyText}</p>
            ) : (
              filtered.map((o) => {
                const active = o.value === value
                return (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => pick(o.value)}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 min-h-[2.75rem] sm:min-h-0 text-left transition-colors ${
                      active ? 'bg-[#F5F5F5]' : 'hover:bg-[#F5F5F5]'
                    }`}
                  >
                    {o.color && (
                      <span className="w-2.5 h-2.5 flex-shrink-0" style={{ background: o.color }} />
                    )}
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm text-[#18181B] truncate">{o.label}</span>
                      {o.sublabel && <span className="block text-xs text-[#A1A1AA] truncate">{o.sublabel}</span>}
                    </span>
                    {o.badge && (
                      <span className="text-[10px] px-1.5 py-0.5 bg-white border border-[#E4E4E7] text-[#71717A] flex-shrink-0 capitalize">
                        {o.badge}
                      </span>
                    )}
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

// ── Async smart select (server-backed search combobox) ────────
// Same look as SmartSelect, but options are fetched on demand. Use for large
// directories (e.g. "view any staff member") where loading the full list up
// front would be wasteful. Debounced, so it never stutters while typing.

// ── Date toggler ──────────────────────────────────────────────
// A flat prev / native-picker / next control. Shows a friendly relative label
// (Today / Yesterday) but always allows jumping to any date via the picker.

function shiftISODate(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T12:00:00')
  d.setDate(d.getDate() + days)
  return d.toISOString().split('T')[0]
}

function relativeDateLabel(dateStr: string, todayStr: string): string {
  if (dateStr === todayStr) return 'Today'
  if (dateStr === shiftISODate(todayStr, -1)) return 'Yesterday'
  if (dateStr === shiftISODate(todayStr, 1)) return 'Tomorrow'
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  })
}

export function DateToggler({
  value,
  onChange,
  max,
  todayStr = new Date().toISOString().split('T')[0],
  className,
  size = 'md',
}: {
  value: string
  onChange: (date: string) => void
  /** Latest selectable date (disables the next button past it). */
  max?: string
  todayStr?: string
  /** Override the outer container class — defaults to inline-flex. Pass e.g. "flex w-full" to stretch. */
  className?: string
  /** 'sm' is a slimmer variant for tight toolbars — smaller padding/type/icons, narrower min-width. */
  size?: 'md' | 'sm'
}) {
  const dateRef = useRef<HTMLInputElement>(null)
  const canGoNext = !max || value < max
  const sm = size === 'sm'

  const openPicker = () => {
    const el = dateRef.current
    if (!el) return
    // showPicker is supported in modern browsers; fall back to focus().
    if (typeof (el as HTMLInputElement & { showPicker?: () => void }).showPicker === 'function') {
      ;(el as HTMLInputElement & { showPicker?: () => void }).showPicker!()
    } else {
      el.focus()
    }
  }

  return (
    <div className={`${className ?? 'inline-flex'} items-stretch border border-[#D4D4D8] bg-white rounded-lg overflow-hidden`}>
      <button
        type="button"
        onClick={() => onChange(shiftISODate(value, -1))}
        className={`${sm ? 'px-1.5' : 'px-2'} flex items-center justify-center text-[#71717A] hover:bg-[#F5F5F5] hover:text-[#18181B] transition-colors border-r border-[#E4E4E7]`}
        aria-label="Previous day"
      >
        <ChevronLeft size={sm ? 13 : 16} />
      </button>

      <button
        type="button"
        onClick={openPicker}
        className={`relative inline-flex flex-1 items-center hover:bg-[#F5F5F5] transition-colors justify-center ${
          sm ? 'gap-1 px-2 py-1 text-xs font-medium text-[#18181B] min-w-[6rem]' : 'gap-2 px-3 py-2 text-sm font-medium text-[#18181B] min-w-[8.5rem]'
        }`}
      >
        <CalendarDays size={sm ? 12 : 14} className="text-[#71717A] flex-shrink-0" />
        <span className="truncate">{relativeDateLabel(value, todayStr)}</span>
        <input
          ref={dateRef}
          type="date"
          value={value}
          max={max}
          onChange={(e) => e.target.value && onChange(e.target.value)}
          className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
          tabIndex={-1}
          aria-label="Pick a date"
        />
      </button>

      <button
        type="button"
        onClick={() => canGoNext && onChange(shiftISODate(value, 1))}
        disabled={!canGoNext}
        className={`${sm ? 'px-1.5' : 'px-2'} flex items-center justify-center text-[#71717A] hover:bg-[#F5F5F5] hover:text-[#18181B] transition-colors border-l border-[#E4E4E7] disabled:opacity-30 disabled:pointer-events-none`}
        aria-label="Next day"
      >
        <ChevronRight size={sm ? 13 : 16} />
      </button>
    </div>
  )
}
