'use client'

/**
 * Liquid-glass chrome for the transport admin.
 *
 * The same material system the admin home's School Overview uses (globals.css:
 * .lg-deck / .lg-content / .lg-pill / .lg-tooltip), in the bus page's own
 * palette — charcoal and bronze from the banner, honey gold for the active
 * state. The rule carried over from home: glass is the chrome (the sheet a
 * section sits on, the pill a control lives in); what people read sits on a
 * solid `.lg-content` card on top of it. Two layers, never more.
 */

import React, { useCallback } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import type { LucideIcon } from 'lucide-react'

export const EASE = [0.16, 1, 0.3, 1] as const

/** The bus palette, in one place. */
export const BUS = {
  ink: '#27272A',
  charcoal: '#3D3B40',
  bronze: '#8B6F47',
  taupe: '#A8896B',
  gold: '#B8983C',
  goldSoft: '#E9DDBB',
  /** Riders: dropped off / aboard / neither — shared by every rider bar. */
  dropped: '#10b981',
  aboard: '#B8983C',
  pending: '#D4D4D8',
}

/** Ambient light for a panel, in the bus palette unless told otherwise. */
const DEFAULT_AMBIENT = [BUS.gold, BUS.taupe, '#0ea5e9']

/**
 * A glass sheet with a header straight on the glass and content below.
 *
 * The pointer moves the specular highlight exactly as the home deck does, so
 * the two pages feel like one material.
 */
export function GlassPanel({
  eyebrow, title, icon: Icon, actions, ambient = DEFAULT_AMBIENT, children, className = '', bodyClassName = '', delay = 0,
}: {
  eyebrow?: string
  title?: React.ReactNode
  icon?: LucideIcon
  actions?: React.ReactNode
  ambient?: string[]
  children: React.ReactNode
  className?: string
  bodyClassName?: string
  delay?: number
}) {
  const reduceMotion = useReducedMotion()
  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== 'mouse') return
    const el = e.currentTarget
    const r = el.getBoundingClientRect()
    el.style.setProperty('--lg-x', `${e.clientX - r.left}px`)
    el.style.setProperty('--lg-y', `${e.clientY - r.top}px`)
  }, [])

  return (
    <div className={`relative ${className}`}>
      <div aria-hidden className="lg-ambient lg-ambient-overview">
        {ambient.slice(0, 3).map((c, i) => <span key={i} style={{ background: c }} />)}
      </div>
      <motion.div
        className="lg-deck lg-panel"
        onPointerMove={onPointerMove}
        initial={reduceMotion ? false : { opacity: 0, y: 14, scale: 0.99 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={reduceMotion ? { duration: 0 } : { duration: 0.6, ease: EASE, delay }}
      >
        {(title || actions) && (
          <div className="relative z-[3] flex flex-wrap items-center justify-between gap-3 px-4 sm:px-5 pt-4 pb-3">
            <div className="flex items-center gap-3 min-w-0">
              {Icon && (
                <div className="icon-chip w-9 h-9 flex-shrink-0" style={{ background: `linear-gradient(135deg, ${BUS.charcoal}, ${BUS.bronze})` }}>
                  <Icon size={16} className="relative z-10 text-white drop-shadow-sm" />
                </div>
              )}
              <div className="min-w-0">
                {eyebrow && <p className="eyebrow text-slate-500 mb-1">{eyebrow}</p>}
                {title && (
                  <h2 className="font-display text-[1.15rem] sm:text-[1.3rem] font-bold leading-none headline text-slate-900 truncate">
                    {title}
                  </h2>
                )}
              </div>
            </div>
            {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
          </div>
        )}
        <div className={`relative z-[3] px-2.5 sm:px-3 pb-3 ${!(title || actions) ? 'pt-3' : ''} ${bodyClassName}`}>
          {children}
        </div>
      </motion.div>
    </div>
  )
}

/** A solid card riding on the glass — where text is actually read. */
export function Content({ children, className = '', as: Tag = 'div', ...rest }: {
  children: React.ReactNode
  className?: string
  as?: 'div' | 'section'
} & React.HTMLAttributes<HTMLElement>) {
  return <Tag className={`lg-content min-w-0 ${className}`} {...rest}>{children}</Tag>
}

/** The small uppercase label at the top of a content card, with an optional action. */
export function CardHead({ icon: Icon, label, right, className = '' }: {
  icon?: LucideIcon
  label: React.ReactNode
  right?: React.ReactNode
  className?: string
}) {
  return (
    <div className={`flex items-center justify-between gap-2 ${className}`}>
      <span className="flex items-center gap-1.5 min-w-0">
        {Icon && <Icon size={13} className="text-slate-500 flex-shrink-0" />}
        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 truncate">{label}</span>
      </span>
      {right}
    </div>
  )
}

/**
 * A glass capsule of buttons — the toolbar idiom. Each entry is a plain
 * button; the capsule is the material.
 */
export function GlassButtonGroup({ items, className = '' }: {
  items: { key: string; label: string; icon?: LucideIcon; onClick: () => void; badge?: number | null; hideLabelOnMobile?: boolean }[]
  className?: string
}) {
  return (
    <div className={`lg-pill inline-flex items-center gap-0.5 p-1 ${className}`} role="toolbar">
      {items.map(it => {
        const Icon = it.icon
        return (
          <button
            key={it.key}
            onClick={it.onClick}
            className="relative inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-[12.5px] font-semibold text-slate-700 hover:bg-white hover:text-slate-900 active:scale-[0.97] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B8983C]/60"
          >
            {Icon && <Icon size={14} />}
            <span className={it.hideLabelOnMobile ? 'hidden sm:inline' : ''}>{it.label}</span>
            {it.badge ? (
              <span className="ml-0.5 min-w-[1.1rem] h-[1.1rem] px-1 rounded-full bg-rose-500 text-white text-[10px] font-bold leading-[1.1rem] text-center tabular-nums">
                {it.badge > 99 ? '99+' : it.badge}
              </span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}

/**
 * Segmented control in glass, with a sliding honey-gold thumb — the iOS
 * segmented control, in the bus palette.
 */
export function GlassSegments<T extends string>({ items, value, onChange, className = '', size = 'md', layoutId }: {
  items: { key: T; label: string; icon?: LucideIcon; count?: number | null }[]
  value: T
  onChange: (key: T) => void
  className?: string
  size?: 'sm' | 'md'
  /** Unique per control on a page so two thumbs never animate into each other. */
  layoutId: string
}) {
  const h = size === 'sm' ? 'h-7 text-[12px] px-2.5' : 'h-9 text-[13px] px-3.5'
  return (
    <div className={`lg-pill inline-flex items-center gap-0.5 p-1 max-w-full overflow-x-auto scrollbar-none ${className}`} role="tablist">
      {items.map(it => {
        const active = it.key === value
        const Icon = it.icon
        return (
          <button
            key={it.key}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(it.key)}
            className={`relative inline-flex flex-shrink-0 items-center justify-center gap-1.5 rounded-full font-semibold whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B8983C]/60 ${h} ${
              active ? 'text-white' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {active && (
              <motion.span
                layoutId={layoutId}
                className="absolute inset-0 rounded-full"
                style={{ background: `linear-gradient(150deg, ${BUS.charcoal}, ${BUS.ink})`, boxShadow: 'inset 0 1px 0 rgba(255,255,255,.18), 0 4px 10px -4px rgba(15,23,42,.45)' }}
                transition={{ type: 'spring', stiffness: 420, damping: 34 }}
              />
            )}
            <span className="relative z-10 inline-flex items-center gap-1.5">
              {Icon && <Icon size={size === 'sm' ? 13 : 14} className={active ? 'text-[#E9DDBB]' : ''} />}
              {it.label}
              {it.count != null && (
                <span className={`tabular-nums text-[10.5px] font-bold ${active ? 'text-white/70' : 'text-slate-400'}`}>{it.count}</span>
              )}
            </span>
          </button>
        )
      })}
    </div>
  )
}

/** A quiet glass-tile button with an icon chip — for launchers. */
export function GlassTileButton({ icon: Icon, label, detail, onClick, status }: {
  icon: LucideIcon
  label: string
  detail?: string
  onClick: () => void
  status?: { tone: 'good' | 'warn' | 'idle'; text: string }
}) {
  const dot = status?.tone === 'good' ? 'bg-emerald-500' : status?.tone === 'warn' ? 'bg-amber-500' : 'bg-slate-300'
  return (
    <button
      onClick={onClick}
      className="group lg-content w-full flex items-center gap-3 p-3.5 text-left transition hover:-translate-y-0.5 hover:shadow-lg active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B8983C]/60"
    >
      <span className="icon-chip w-10 h-10 flex-shrink-0" style={{ background: `linear-gradient(135deg, ${BUS.charcoal}, ${BUS.bronze})` }}>
        <Icon size={17} className="relative z-10 text-white" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-slate-900">{label}</span>
        {detail && <span className="block text-[11.5px] leading-snug text-slate-500 truncate">{detail}</span>}
        {status && (
          <span className="mt-1 inline-flex items-center gap-1.5 text-[10.5px] font-semibold text-slate-600">
            <span className={`w-1.5 h-1.5 rounded-full ${dot}`} /> {status.text}
          </span>
        )}
      </span>
    </button>
  )
}

/** The Live indicator capsule from the home overview. */
export function LiveDot({ label = 'Live', tone = 'live' }: { label?: string; tone?: 'live' | 'idle' }) {
  const live = tone === 'live'
  return (
    <span className="flex items-center gap-1.5">
      <span className="relative flex w-1.5 h-1.5">
        {live && <span className="absolute inset-0 rounded-full bg-emerald-500 animate-ping opacity-60" />}
        <span className={`relative w-1.5 h-1.5 rounded-full ${live ? 'bg-emerald-500' : 'bg-slate-400'}`} />
      </span>
      <span className={`text-[10.5px] font-bold ${live ? 'text-emerald-700' : 'text-slate-500'}`}>{label}</span>
    </span>
  )
}

/** Primary / secondary buttons in the glass language. */
export const GBTN = {
  primary:
    'inline-flex items-center justify-center gap-1.5 h-9 px-3.5 rounded-full text-[12.5px] font-semibold text-white transition active:scale-[0.97] disabled:opacity-50 disabled:pointer-events-none bg-gradient-to-b from-[#3D3B40] to-[#27272A] shadow-[inset_0_1px_0_rgba(255,255,255,.16),0_6px_14px_-8px_rgba(15,23,42,.6)] hover:from-[#46444A] hover:to-[#2E2E31] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B8983C]/60',
  secondary:
    'inline-flex items-center justify-center gap-1.5 h-9 px-3.5 rounded-full text-[12.5px] font-semibold text-slate-700 bg-white/80 border border-white shadow-[0_1px_2px_rgba(15,23,42,.06),0_6px_14px_-10px_rgba(15,23,42,.35)] hover:bg-white hover:text-slate-900 transition active:scale-[0.97] disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B8983C]/60',
  icon:
    'inline-flex items-center justify-center w-8 h-8 rounded-full text-slate-500 hover:text-slate-900 hover:bg-white transition active:scale-95 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B8983C]/60',
}

/** A soft, rounded input to match the glass controls. */
export const GINPUT =
  'w-full h-9 rounded-xl bg-white/90 border border-slate-200/80 px-3 text-sm text-slate-900 placeholder:text-slate-400 shadow-[inset_0_1px_2px_rgba(15,23,42,.05)] focus:outline-none focus:border-[#B8983C] focus:ring-2 focus:ring-[#B8983C]/20 transition'

/** An empty state on a content card. */
export function EmptyNote({ icon: Icon, title, detail, action }: {
  icon: LucideIcon
  title: string
  detail?: string
  action?: React.ReactNode
}) {
  return (
    <div className="px-4 py-10 text-center">
      <div className="mx-auto mb-2.5 w-11 h-11 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center">
        <Icon size={20} />
      </div>
      <p className="text-sm font-semibold text-slate-700">{title}</p>
      {detail && <p className="mx-auto mt-0.5 max-w-sm text-[11.5px] leading-snug text-slate-500">{detail}</p>}
      {action && <div className="mt-3 flex justify-center">{action}</div>}
    </div>
  )
}
