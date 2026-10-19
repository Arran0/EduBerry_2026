'use client'

// ─────────────────────────────────────────────────────────────────────────────
// The fee module's glass parts.
//
// The transport app's two layers — a glass deck you work on, solid sheets you
// read off — with the deck and the sheets squared. On top of them sit the
// round things: the filter capsules and their menus.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

/** The bus palette, which the fee module shares. */
export const FX = {
  ink: '#27272A',
  charcoal: '#3D3B40',
  bronze: '#8B6F47',
  gold: '#B8983C',
  goldSoft: '#E9DDBB',
}

/** The charcoal-to-bronze square an icon sits in. */
export function IconChip({ icon: Icon, size = 'md' }: { icon: LucideIcon; size?: 'sm' | 'md' }) {
  const box = size === 'sm' ? 'w-8 h-8' : 'w-9 h-9'
  return (
    <span className={`icon-chip ${box} flex-shrink-0`} style={{ background: `linear-gradient(135deg, ${FX.charcoal}, ${FX.bronze})` }}>
      <Icon size={size === 'sm' ? 15 : 16} className="relative z-10 text-white" />
    </span>
  )
}

/**
 * A glass deck: the surface a section is worked on. Square, edge to edge on a
 * phone. A header (icon, title, controls) sits straight on the glass; content
 * goes on solid sheets inside it.
 */
export function FeeDeck({
  title, icon, actions, children, className = '', bodyClassName = '',
}: {
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
            {icon && <IconChip icon={icon} size="sm" />}
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

/**
 * One headline figure. Square; the dark one is the figure the screen is
 * about. Pressable when it narrows something, with a gold hairline while live.
 */
export function StatTile({
  label, value, sub, icon: Icon, dark, live, loading, onClick, title,
}: {
  label: string
  value: React.ReactNode
  sub?: React.ReactNode
  icon: LucideIcon
  dark?: boolean
  live?: boolean
  loading?: boolean
  onClick?: () => void
  title?: string
}) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      title={title}
      className={`${dark ? 'fx-tile-dark' : 'fx-tile'} relative min-w-0 text-left p-3 sm:p-3.5 flex flex-col gap-2 transition
                  ${onClick ? 'cursor-pointer hover:-translate-y-px active:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B8983C]/70' : ''}
                  ${live ? 'outline outline-2 -outline-offset-2 outline-[#B8983C]' : ''}`}
    >
      <span className="flex items-start justify-between gap-2">
        <span className={`text-[12px] font-medium leading-snug ${dark ? 'text-white/70' : 'text-slate-500'}`}>{label}</span>
        <Icon size={15} className={`flex-shrink-0 mt-px ${dark ? 'text-[#D9C27E]' : 'text-[#8B6F47]'}`} />
      </span>
      {loading ? (
        <span className={`block h-[26px] w-28 max-w-full animate-pulse ${dark ? 'bg-white/10' : 'bg-slate-100'}`} />
      ) : (
        <span className={`block font-display text-[1.3rem] sm:text-[1.5rem] font-bold leading-none tabular-nums break-words ${dark ? 'text-white' : 'text-slate-900'}`}>
          {value}
        </span>
      )}
      {sub && (
        <span className={`block text-[11.5px] leading-snug ${dark ? 'text-white/55' : 'text-slate-500'}`}>{sub}</span>
      )}
    </Tag>
  )
}

// ── The filter menu ───────────────────────────────────────────────────────

export interface MenuOption {
  key: string
  label: string
  hint?: string
  /** Options with the same group are listed under one heading. */
  group?: string
}

/**
 * A filter as a dropdown: a capsule naming the filter and what it is set to,
 * opening a menu of choices. Multiple choice by default; `single` for a
 * one-of-many choice. The capsule turns dark while it narrows anything, so a
 * glance along the row says which filters are in force.
 *
 * The menu is portalled and clamped to the viewport, so it never pushes the
 * page sideways on a narrow screen.
 */
export function FilterMenu({
  label, icon: Icon, options, value, onChange, single = false, allLabel = 'All',
  summary, active, footer, width = 280,
}: {
  label: string
  icon?: LucideIcon
  options: MenuOption[]
  value: string[]
  onChange: (next: string[]) => void
  single?: boolean
  /** What the capsule says when nothing is picked. */
  allLabel?: string
  /** Overrides what the capsule says after the label. */
  summary?: string
  /** Overrides whether the capsule reads as narrowing something. */
  active?: boolean
  /** Extra controls at the foot of the menu — a date range, say. */
  footer?: React.ReactNode
  width?: number
}) {
  const [open, setOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number; maxH: number; w: number } | null>(null)

  const place = useCallback(() => {
    const el = btnRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    const w = Math.min(width, vw - 16)
    const left = Math.min(Math.max(8, r.left), vw - w - 8)
    const below = vh - r.bottom - 12
    const above = r.top - 12
    if (below >= 260 || below >= above) {
      setPos({ left, top: r.bottom + 6, maxH: Math.max(160, below - 6), w })
    } else {
      setPos({ left, bottom: vh - r.top + 6, maxH: Math.max(160, above - 6), w })
    }
  }, [width])

  useLayoutEffect(() => { if (open) place() }, [open, place])

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node
      if (menuRef.current?.contains(t) || btnRef.current?.contains(t)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); btnRef.current?.focus() } }
    const onMove = () => place()
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', onMove)
    window.addEventListener('scroll', onMove, true)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onMove)
      window.removeEventListener('scroll', onMove, true)
    }
  }, [open, place])

  const picked = new Set(value)
  const isActive = active ?? value.length > 0
  const text = summary
    ?? (value.length === 0 ? allLabel
      : value.length === 1 ? options.find(o => o.key === value[0])?.label ?? '1 picked'
      : `${value.length} picked`)

  const toggle = (key: string) => {
    if (single) { onChange([key]); setOpen(false); return }
    const next = new Set(picked)
    if (next.has(key)) next.delete(key); else next.add(key)
    onChange(options.filter(o => next.has(o.key)).map(o => o.key))
  }

  // Options keep their order; a heading is printed where the group changes.
  let lastGroup: string | undefined

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        className={`inline-flex items-center gap-1.5 h-9 max-w-full min-w-0 pl-3 pr-2.5 rounded-full text-[12.5px] font-semibold
                    whitespace-nowrap transition active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B8983C]/60 ${
          isActive
            ? 'text-white bg-gradient-to-b from-[#3D3B40] to-[#27272A] shadow-[inset_0_1px_0_rgba(255,255,255,.16),0_6px_14px_-8px_rgba(15,23,42,.6)]'
            : 'text-slate-700 bg-white border border-[#E2DDD2] shadow-[0_1px_2px_rgba(15,23,42,.05)] hover:border-[#CFC8B8]'}`}
      >
        {Icon && <Icon size={14} className={`flex-shrink-0 ${isActive ? 'text-[#E9DDBB]' : 'text-slate-500'}`} />}
        <span className={isActive ? 'text-white/70' : 'text-slate-500'}>{label}</span>
        <span className="truncate min-w-0">{text}</span>
        <ChevronDown size={14} className={`flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''} ${isActive ? 'text-white/70' : 'text-slate-400'}`} />
      </button>

      {open && pos && typeof document !== 'undefined' && createPortal(
        <div
          ref={menuRef}
          role="listbox"
          aria-multiselectable={!single}
          className="fixed z-[1100] flex flex-col rounded-[14px] bg-white border border-black/[.07]
                     shadow-[0_24px_60px_-20px_rgba(15,23,42,.45),0_2px_8px_rgba(15,23,42,.08)] overflow-hidden"
          style={{ left: pos.left, top: pos.top, bottom: pos.bottom, width: pos.w, maxHeight: pos.maxH }}
        >
          <div className="flex items-center justify-between gap-2 px-3.5 pt-2.5 pb-1.5 border-b border-slate-100">
            <span className="text-[12.5px] font-semibold text-slate-900">{label}</span>
            {!single && value.length > 0 && (
              <button type="button" onClick={() => onChange([])}
                      className="text-[12px] font-semibold text-[#8B6F47] hover:text-[#5E4A2F] px-1.5 py-0.5 rounded-md">
                Clear
              </button>
            )}
          </div>
          <div className="overflow-y-auto overscroll-contain py-1">
            {options.map(o => {
              const head = o.group && o.group !== lastGroup ? o.group : null
              lastGroup = o.group
              const on = picked.has(o.key)
              return (
                <React.Fragment key={o.key}>
                  {head && (
                    <p className="px-3.5 pt-2.5 pb-1 text-[11px] font-semibold text-slate-400">{head}</p>
                  )}
                  <button
                    type="button"
                    role="option"
                    aria-selected={on}
                    onClick={() => toggle(o.key)}
                    className="w-full flex items-start gap-2.5 px-3.5 py-2 text-left hover:bg-[#FAF7F0] focus-visible:bg-[#FAF7F0] focus-visible:outline-none"
                  >
                    <span className={`mt-[2px] flex-shrink-0 w-4 h-4 inline-flex items-center justify-center transition ${
                      single ? 'rounded-full' : 'rounded-[5px]'} ${
                      on ? 'bg-[#27272A] text-white' : 'border border-slate-300 bg-white'}`}>
                      {on && (single ? <span className="w-1.5 h-1.5 rounded-full bg-white" /> : <Check size={11} strokeWidth={3} />)}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[13.5px] text-slate-900 leading-snug break-words">{o.label}</span>
                      {o.hint && <span className="block text-[11.5px] text-slate-500 leading-snug break-words">{o.hint}</span>}
                    </span>
                  </button>
                </React.Fragment>
              )
            })}
          </div>
          {footer && <div className="border-t border-slate-100 px-3.5 py-2.5">{footer}</div>}
        </div>,
        document.body,
      )}
    </>
  )
}

/**
 * A bill or receipt number that may wrap only at its slashes —
 * "MPS/INV/" over "26-27/0081" rather than "MPS/INV/26-" over "27/0081".
 */
export function DocNo({ value }: { value: string }) {
  const parts = value.split('/')
  return (
    <>
      {parts.map((part, i) => (
        <React.Fragment key={i}>{part}{i < parts.length - 1 && <>/<wbr /></>}</React.Fragment>
      ))}
    </>
  )
}

/** A capsule that sits in the filter row and resets it. */
export function ResetChip({ onClick, label = 'Reset' }: { onClick: () => void; label?: string }) {
  return (
    <button type="button" onClick={onClick}
            className="inline-flex items-center h-9 px-3 rounded-full text-[12.5px] font-semibold text-[#8B6F47] hover:text-[#5E4A2F] hover:bg-white/70 transition">
      {label}
    </button>
  )
}
