'use client'

import React, { useState, useRef, useEffect, useMemo } from 'react'
import { Search, ChevronDown, Check, X } from 'lucide-react'

// ── Admin design language ─────────────────────────────────────
// Sharp corners, flat surfaces, thin zinc borders, a restrained
// zinc / gold palette — matching the admin workspace. No rounded
// floating cards, no drop shadows.

export const COLORS = {
  ink: '#18181B',
  inkSoft: '#27272A',
  muted: '#71717A',
  faint: '#A1A1AA',
  label: '#525252',
  border: '#D4D4D8',
  borderSoft: '#E4E4E7',
  fill: '#F5F5F5',
  fillHover: '#EBEBEB',
  surface: '#FAFAF9',
  gold: '#B8983C',
}

export const INPUT =
  'w-full border border-[#D4D4D8] bg-white px-3 py-2 text-sm text-[#18181B] placeholder:text-[#A1A1AA] focus:outline-none focus:border-[#27272A] transition-colors'
export const BTN_PRIMARY =
  'inline-flex items-center justify-center gap-1.5 bg-[#27272A] hover:bg-[#18181B] text-[#F5F5F5] px-3.5 py-2 text-sm font-medium disabled:opacity-50 transition-colors'
export const BTN_NEUTRAL =
  'inline-flex items-center justify-center gap-1.5 bg-[#F5F5F5] border border-[#D4D4D8] text-[#18181B] hover:bg-[#EBEBEB] px-3 py-2 text-sm font-medium disabled:opacity-50 transition-colors'
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

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[10px] font-bold uppercase tracking-widest text-[#525252] mb-1.5">{label}</span>
      {children}
    </label>
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
            className={`min-w-0 inline-flex items-center justify-center gap-1.5 px-2.5 sm:px-3 py-2.5 text-sm font-medium transition-colors ${
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
        className={`w-full inline-flex items-center gap-2 border border-[#D4D4D8] bg-white px-3 py-2 text-sm text-left transition-colors hover:border-[#A1A1AA] focus:outline-none focus:border-[#27272A] disabled:opacity-50 disabled:cursor-not-allowed ${buttonClassName}`}
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
        <div className="absolute z-50 mt-1 w-full min-w-[13rem] bg-white border border-[#D4D4D8] shadow-md overflow-hidden">
          <div className="p-2 border-b border-[#E4E4E7]">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#A1A1AA] pointer-events-none" />
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={searchPlaceholder}
                className="w-full pl-8 pr-2 py-1.5 text-sm border border-[#D4D4D8] bg-white focus:outline-none focus:border-[#27272A]"
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
                    className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors ${
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
