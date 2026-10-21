'use client'

/**
 * Liquid-glass chrome for the transport admin.
 *
 * The same material system the admin home's School Overview uses (globals.css:
 * .lg-deck / .lg-content / .lg-pill / .lg-tooltip), in the bus page's own
 * palette — route navy and signal blue for the chrome, school-bus yellow for
 * the active state. The rule carried over from home: glass is the chrome (the sheet a
 * section sits on, the pill a control lives in); what people read sits on a
 * solid `.lg-content` card on top of it. Two layers, never more.
 */

import React, { useCallback } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import type { LucideIcon } from 'lucide-react'

export const EASE = [0.16, 1, 0.3, 1] as const

/**
 * The bus palette, in one place: school-bus yellow, route navy, asphalt grey.
 *
 * Yellow is the signal — what is moving, what is selected, what needs a tap —
 * so it is spent sparingly. Navy is the ink and the dark surfaces. Grey is
 * everything that should recede. Yellow is never used for text on white
 * (it fails contrast); `goldText` is its legible ink.
 *
 * The keys keep their old names so every caller keeps working.
 */
export const BUS = {
  ink: '#13306B',
  charcoal: '#1B3F8A',
  bronze: '#2E6BE6',
  taupe: '#5B6676',
  gold: '#FFC72C',
  goldSoft: '#FFE7A0',
  goldText: '#8A6100',
  /** Riders: dropped off / aboard / neither — shared by every rider bar. */
  dropped: '#10b981',
  aboard: '#FFC72C',
  pending: '#CBD3DD',
}

/**
 * A glass sheet with a header straight on the glass and content below.
 *
 * The pointer moves the specular highlight exactly as the home deck does, so
 * the two pages feel like one material.
 *
 * On a phone the sheet runs edge to edge (`.lg-bleed`, globals.css): a
 * floating card there gives up 32px of a 360px screen to two strips of page
 * background, which is room every list and chart on these screens wants.
 */
export function GlassPanel({
  eyebrow, title, icon: Icon, actions, children, className = '', bodyClassName = '', delay = 0,
}: {
  eyebrow?: string
  title?: React.ReactNode
  icon?: LucideIcon
  actions?: React.ReactNode
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
      <motion.div
        className="lg-deck lg-panel lg-bleed"
        onPointerMove={onPointerMove}
        // Slides, never fades: fading an element that carries backdrop-filter
        // is what makes Chrome flash black frames.
        initial={reduceMotion ? false : { y: 14 }}
        animate={{ y: 0 }}
        transition={reduceMotion ? { duration: 0 } : { duration: 0.6, ease: EASE, delay }}
      >
        {(title || actions) && (
          <div className="relative z-[3] flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-3.5 sm:px-5 pt-3 sm:pt-4 pb-2.5 sm:pb-3">
            <div className="flex items-center gap-3 min-w-0">
              {Icon && (
                <div className="icon-chip w-8 h-8 sm:w-9 sm:h-9 flex-shrink-0" style={{ background: `linear-gradient(135deg, ${BUS.charcoal}, ${BUS.bronze})` }}>
                  <Icon size={16} className="relative z-10 text-white drop-shadow-sm" />
                </div>
              )}
              <div className="min-w-0">
                {eyebrow && <p className="eyebrow text-slate-500 mb-0.5 sm:mb-1">{eyebrow}</p>}
                {/* Line height and a little bottom padding hold the descenders
                    (g, p, y) inside the box `truncate` clips to. */}
                {title && (
                  <h2 className="font-display text-[1.1rem] sm:text-[1.3rem] font-bold leading-[1.2] pb-[0.12em] headline text-slate-900 truncate">
                    {title}
                  </h2>
                )}
              </div>
            </div>
            {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
          </div>
        )}
        <div className={`relative z-[3] px-2 sm:px-3 pb-2 sm:pb-3 ${!(title || actions) ? 'pt-2 sm:pt-3' : ''} ${bodyClassName}`}>
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
export function GlassButtonGroup({ items, className = '', compact = false }: {
  items: { key: string; label: string; icon?: LucideIcon; onClick: () => void; badge?: number | null; hideLabelOnMobile?: boolean }[]
  className?: string
  /** On a phone: labels only, no icons, tighter — so the capsule shares its row. */
  compact?: boolean
}) {
  return (
    <div className={`lg-pill inline-flex items-center gap-0.5 p-1 ${className}`} role="toolbar">
      {items.map(it => {
        const Icon = it.icon
        return (
          <button
            key={it.key}
            onClick={it.onClick}
            className={`relative inline-flex items-center gap-1.5 h-8 rounded-full font-semibold whitespace-nowrap ${compact ? 'px-2 sm:px-3 text-[11.5px] sm:text-[12.5px]' : 'px-3 text-[12.5px]'} text-slate-700 hover:bg-white hover:text-slate-900 active:scale-[0.97] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--bus-ring,rgba(184,152,60,0.6))]`}
          >
            {Icon && <Icon size={14} className={compact ? 'hidden sm:block' : ''} />}
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
 * Segmented control in glass, with a sliding thumb — the iOS segmented
 * control. Its colours come from CSS variables (`--seg-*`, globals.css) so the
 * fee and salary apps that borrow it keep their own palette.
 */
export function GlassSegments<T extends string>({ items, value, onChange, className = '', size = 'md', layoutId, stretch = false }: {
  items: { key: T; label: string; icon?: LucideIcon; count?: number | null }[]
  value: T
  onChange: (key: T) => void
  className?: string
  size?: 'sm' | 'md'
  /** Unique per control on a page so two thumbs never animate into each other. */
  layoutId: string
  /** Fill the width on a phone, splitting it evenly and dropping the icons. */
  stretch?: boolean
}) {
  const h = size === 'sm' ? 'h-7 text-[12px] px-2.5' : 'h-9 text-[13px] px-3.5'
  return (
    <div className={`lg-pill ${stretch ? 'flex w-full sm:inline-flex sm:w-auto' : 'inline-flex'} items-center gap-0.5 p-1 max-w-full overflow-x-auto scrollbar-none ${className}`} role="tablist">
      {items.map(it => {
        const active = it.key === value
        const Icon = it.icon
        return (
          <button
            key={it.key}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(it.key)}
            className={`relative inline-flex ${stretch ? 'flex-1 sm:flex-none !px-2 sm:!px-3.5' : 'flex-shrink-0'} items-center justify-center gap-1.5 rounded-full font-semibold whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--bus-ring,rgba(184,152,60,0.6))] ${h} ${
              active ? 'text-white' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {active && (
              <motion.span
                layoutId={layoutId}
                className="absolute inset-0 rounded-full"
                style={{ background: 'linear-gradient(150deg, var(--seg-from, #3D3B40), var(--seg-to, #27272A))', boxShadow: 'inset 0 1px 0 rgba(255,255,255,.18), 0 4px 10px -4px rgba(15,23,42,.45)' }}
                transition={{ type: 'spring', stiffness: 420, damping: 34 }}
              />
            )}
            <span className="relative z-10 inline-flex items-center gap-1.5">
              {Icon && <Icon size={size === 'sm' ? 13 : 14} className={`${active ? 'text-[color:var(--seg-icon,#E9DDBB)]' : ''} ${stretch ? 'hidden sm:block' : ''}`} />}
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

/**
 * A launcher tile: icon chip and name. On a phone it stands upright — chip
 * over name, the status as a dot — so three fit across; from sm up it lies
 * flat with its one-line description.
 */
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
      title={detail}
      className="group lg-content relative w-full flex flex-col sm:flex-row items-center sm:items-center gap-1.5 sm:gap-3 px-1.5 py-2.5 sm:p-3 text-center sm:text-left transition hover:-translate-y-0.5 hover:shadow-lg active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--bus-ring,rgba(184,152,60,0.6))]"
    >
      <span className="icon-chip w-8 h-8 sm:w-9 sm:h-9 flex-shrink-0" style={{ background: `linear-gradient(135deg, ${BUS.charcoal}, ${BUS.bronze})` }}>
        <Icon size={15} className="relative z-10 text-white" />
      </span>
      <span className="min-w-0 flex-1 w-full">
        <span className="block text-[12px] sm:text-[13px] font-semibold leading-tight text-slate-900 truncate">{label}</span>
        {detail && <span className="hidden sm:block text-[11px] leading-snug text-slate-500 truncate">{detail}</span>}
        {status && (
          <span className="hidden sm:inline-flex mt-0.5 items-center gap-1.5 text-[10.5px] font-semibold text-slate-600 max-w-full">
            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dot}`} /> <span className="truncate">{status.text}</span>
          </span>
        )}
      </span>
      {status && <span className={`sm:hidden absolute top-2 right-2 w-1.5 h-1.5 rounded-full ${dot}`} aria-label={status.text} />}
    </button>
  )
}

/** The Live indicator capsule from the home overview. */
export function LiveDot({ label = 'Live', tone = 'live', hideLabelOnMobile = false }: {
  label?: string
  tone?: 'live' | 'idle'
  /** On a phone the dot alone carries it; the colour already says live or idle. */
  hideLabelOnMobile?: boolean
}) {
  const live = tone === 'live'
  return (
    <span className="flex items-center gap-1.5">
      <span className="relative flex w-1.5 h-1.5">
        {live && <span className="absolute inset-0 rounded-full bg-emerald-500 animate-ping opacity-60" />}
        <span className={`relative w-1.5 h-1.5 rounded-full ${live ? 'bg-emerald-500' : 'bg-slate-400'}`} />
      </span>
      <span className={`text-[10.5px] font-bold ${live ? 'text-emerald-700' : 'text-slate-500'} ${hideLabelOnMobile ? 'hidden sm:inline' : ''}`}>{label}</span>
    </span>
  )
}

/** Primary / secondary buttons in the glass language. */
export const GBTN = {
  primary:
    'inline-flex items-center justify-center gap-1.5 h-9 px-3.5 rounded-full text-[12.5px] font-semibold text-white transition active:scale-[0.97] disabled:opacity-50 disabled:pointer-events-none bg-gradient-to-b from-[color:var(--gbtn-from,#3D3B40)] to-[color:var(--gbtn-to,#27272A)] shadow-[inset_0_1px_0_rgba(255,255,255,.16),0_6px_14px_-8px_rgba(15,23,42,.6)] hover:from-[color:var(--gbtn-hover-from,#46444A)] hover:to-[color:var(--gbtn-hover-to,#2E2E31)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--bus-ring,rgba(184,152,60,0.6))]',
  secondary:
    'inline-flex items-center justify-center gap-1.5 h-9 px-3.5 rounded-full text-[12.5px] font-semibold text-slate-700 bg-white/80 border border-white shadow-[0_1px_2px_rgba(15,23,42,.06),0_6px_14px_-10px_rgba(15,23,42,.35)] hover:bg-white hover:text-slate-900 transition active:scale-[0.97] disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--bus-ring,rgba(184,152,60,0.6))]',
  icon:
    'inline-flex items-center justify-center w-8 h-8 rounded-full text-slate-500 hover:text-slate-900 hover:bg-white transition active:scale-95 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--bus-ring,rgba(184,152,60,0.6))]',
}

/** A soft, rounded input to match the glass controls. */
export const GINPUT =
  'w-full h-9 rounded-xl bg-white/90 border border-slate-200/80 px-3 text-sm text-slate-900 placeholder:text-slate-400 shadow-[inset_0_1px_2px_rgba(15,23,42,.05)] focus:outline-none focus:border-[color:var(--bus-accent,#B8983C)] focus:ring-2 focus:ring-[color:var(--bus-ring-soft,rgba(184,152,60,0.2))] transition'

/** An empty state on a content card. */
export function EmptyNote({ icon: Icon, title, detail, action }: {
  icon: LucideIcon
  title: string
  detail?: string
  action?: React.ReactNode
}) {
  return (
    <div className="px-4 py-6 sm:py-10 text-center">
      <div className="mx-auto mb-2 sm:mb-2.5 w-10 h-10 sm:w-11 sm:h-11 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center">
        <Icon size={20} />
      </div>
      <p className="text-sm font-semibold text-slate-700">{title}</p>
      {detail && <p className="mx-auto mt-0.5 max-w-sm text-[11.5px] leading-snug text-slate-500">{detail}</p>}
      {action && <div className="mt-3 flex justify-center">{action}</div>}
    </div>
  )
}
