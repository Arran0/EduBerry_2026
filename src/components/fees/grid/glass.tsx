'use client'

// ─────────────────────────────────────────────────────────────────────────────
// The fee grid's visual vocabulary: Apple's system palette and type, with
// Liquid Glass reserved for the chrome that floats over content — the issue
// bar, the toolbars and the popups. The grid itself is content, so it stays
// solid: glass over a spreadsheet would make numbers harder to read, which is
// the one thing a price list must not do.
// ─────────────────────────────────────────────────────────────────────────────

import React from 'react'
import { AnimatePresence } from 'framer-motion'
import { X } from 'lucide-react'
import ModalShell from '@/components/ui/ModalShell'

export const SF = {
  fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Helvetica Neue", Inter, system-ui, sans-serif',
} as const

/** Apple system colours (light appearance). */
export const SYS = {
  blue: '#007AFF',
  indigo: '#5856D6',
  red: '#FF3B30',
  green: '#34C759',
  orange: '#FF9500',
  teal: '#30B0C7',
  label: '#1C1C1E',
  secondary: 'rgba(60,60,67,0.6)',
  tertiary: 'rgba(60,60,67,0.3)',
  separator: 'rgba(60,60,67,0.12)',
  fill: 'rgba(118,118,128,0.12)',
  grouped: '#F2F2F7',
} as const

/** Translucent chrome: a lens over whatever scrolls beneath it. */
export const GLASS =
  'bg-white/60 backdrop-blur-2xl backdrop-saturate-[1.8] border border-white/70 ' +
  'shadow-[0_10px_40px_-16px_rgba(15,23,42,0.35),inset_0_1px_0_rgba(255,255,255,0.9)]'

export const BTN = {
  primary:
    'inline-flex items-center justify-center gap-1.5 rounded-full bg-[#007AFF] hover:bg-[#0A6FE6] active:scale-[0.97] ' +
    'text-white text-[13px] font-semibold px-4 h-9 transition-all disabled:opacity-40 disabled:pointer-events-none ' +
    'shadow-[0_6px_16px_-8px_rgba(0,122,255,0.8)]',
  glass:
    'inline-flex items-center justify-center gap-1.5 rounded-full bg-white/70 hover:bg-white backdrop-blur-xl ' +
    'ring-1 ring-black/[0.06] text-[#1C1C1E] text-[13px] font-medium px-3.5 h-9 transition-all active:scale-[0.97] ' +
    'disabled:opacity-40 disabled:pointer-events-none shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]',
  plain:
    'inline-flex items-center justify-center gap-1 rounded-full text-[#007AFF] hover:bg-[#007AFF]/[0.08] ' +
    'text-[13px] font-medium px-2.5 h-8 transition-colors disabled:opacity-40 disabled:pointer-events-none',
  destructive:
    'inline-flex items-center justify-center gap-1.5 rounded-full bg-[#FF3B30]/10 hover:bg-[#FF3B30]/15 ' +
    'text-[#FF3B30] text-[13px] font-semibold px-4 h-9 transition-all active:scale-[0.97] disabled:opacity-40 disabled:pointer-events-none',
} as const

export const FIELD =
  'w-full rounded-[10px] bg-[rgba(118,118,128,0.12)] px-3 h-10 text-[15px] text-[#1C1C1E] ' +
  'placeholder:text-[rgba(60,60,67,0.3)] focus:outline-none focus:ring-2 focus:ring-[#007AFF]/50 transition-shadow'

/** iOS segmented control. */
export function Segmented<T extends string>({
  value, onChange, options, size = 'md',
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: React.ReactNode }[]
  size?: 'sm' | 'md'
}) {
  return (
    <div role="radiogroup" className="inline-flex rounded-[9px] bg-[rgba(118,118,128,0.12)] p-[2px]">
      {options.map(o => {
        const on = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={`${size === 'sm' ? 'h-7 px-2.5 text-[12px]' : 'h-8 px-3.5 text-[13px]'} rounded-[7px] font-medium transition-all ${
              on ? 'bg-white text-[#1C1C1E] shadow-[0_3px_8px_rgba(0,0,0,0.12),0_3px_1px_rgba(0,0,0,0.04)]'
                 : 'text-[#1C1C1E]/70 hover:text-[#1C1C1E]'}`}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

/** A selectable capsule — filters, sections, heads. */
export function Chip({
  on, onClick, children, tone = SYS.blue, disabled,
}: {
  on: boolean; onClick?: () => void; children: React.ReactNode; tone?: string; disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={on}
      className="inline-flex items-center gap-1 rounded-full h-7 px-3 text-[12.5px] font-medium transition-all disabled:opacity-40 active:scale-[0.97]"
      style={on
        ? { background: tone, color: '#fff', boxShadow: `0 4px 12px -6px ${tone}` }
        : { background: 'rgba(118,118,128,0.12)', color: SYS.label }}
    >
      {children}
    </button>
  )
}

/**
 * The popup surface used by every fee-grid sheet: a frosted panel with a large
 * title, so creating a thing and opening it later look like the same object.
 */
export function GlassSheet({
  open, onClose, title, subtitle, accent = SYS.blue, icon, footer, children, size = 'lg',
}: {
  open: boolean
  onClose: () => void
  title: React.ReactNode
  subtitle?: React.ReactNode
  accent?: string
  icon?: React.ReactNode
  footer?: React.ReactNode
  children: React.ReactNode
  size?: 'md' | 'lg' | 'xl' | '2xl'
}) {
  return (
    <AnimatePresence>
      {open && (
        <ModalShell onClose={onClose} bare size={size}>
          <div
            style={SF}
            className={`flex flex-col max-h-[92dvh] ${size === '2xl' ? 'sm:max-h-[min(92dvh,60rem)]' : 'sm:max-h-[min(88dvh,46rem)]'} bg-[#F2F2F7]/90 backdrop-blur-2xl
                       sm:rounded-[28px] rounded-t-[28px] ring-1 ring-white/60
                       shadow-[0_40px_100px_-30px_rgba(15,23,42,0.55),inset_0_1px_0_rgba(255,255,255,0.8)]`}
          >
            <div className="flex items-start gap-3 px-5 pt-6 sm:pt-5 pb-3">
              {icon && (
                <div
                  className="w-10 h-10 rounded-[12px] flex items-center justify-center flex-shrink-0 text-white"
                  style={{ background: accent, boxShadow: `0 8px 20px -10px ${accent}` }}
                >
                  {icon}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <h2 className="text-[20px] leading-[1.15] font-bold tracking-[-0.01em] text-[#1C1C1E]">{title}</h2>
                {subtitle && <p className="text-[13px] text-[rgba(60,60,67,0.6)] mt-0.5">{subtitle}</p>}
              </div>
              <button
                onClick={onClose}
                aria-label="Close"
                className="w-8 h-8 rounded-full bg-[rgba(118,118,128,0.12)] hover:bg-[rgba(118,118,128,0.2)] flex items-center justify-center text-[rgba(60,60,67,0.6)] flex-shrink-0"
              >
                <X size={15} strokeWidth={2.6} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto overscroll-contain px-5 pb-4">{children}</div>
            {footer && (
              <div className="flex-shrink-0 px-5 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] border-t border-black/[0.06] bg-white/50 backdrop-blur-xl sm:rounded-b-[28px]">
                {footer}
              </div>
            )}
          </div>
        </ModalShell>
      )}
    </AnimatePresence>
  )
}

/** An inset grouped list section, as in iOS Settings. */
export function Group({ header, footer, children }: {
  header?: React.ReactNode; footer?: React.ReactNode; children: React.ReactNode
}) {
  return (
    <section className="mt-4 first:mt-1">
      {header && <h3 className="px-4 pb-1.5 text-[13px] text-[rgba(60,60,67,0.6)]">{header}</h3>}
      <div className="rounded-[12px] bg-white overflow-hidden divide-y divide-[rgba(60,60,67,0.12)]">{children}</div>
      {footer && <p className="px-4 pt-1.5 text-[12.5px] leading-snug text-[rgba(60,60,67,0.6)]">{footer}</p>}
    </section>
  )
}

export function GroupRowItem({ label, children, hint }: { label: React.ReactNode; children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <label className="flex items-center gap-3 px-4 min-h-[46px] py-1.5">
      <span className="text-[15px] text-[#1C1C1E] flex-shrink-0 min-w-[96px]">{label}</span>
      <span className="flex-1 min-w-0 flex justify-end">{children}</span>
      {hint}
    </label>
  )
}

/** Field that sits inside a GroupRowItem, right-aligned, iOS style. */
export const INLINE_FIELD =
  'w-full text-right bg-transparent text-[15px] text-[#1C1C1E] placeholder:text-[rgba(60,60,67,0.3)] focus:outline-none'

export function ErrorNote({ children }: { children: React.ReactNode }) {
  if (!children) return null
  return (
    <div className="mt-3 rounded-[12px] bg-[#FF3B30]/10 text-[#C4271D] text-[13px] px-3.5 py-2.5">{children}</div>
  )
}

export function rupees(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—'
  return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
}

export function shortDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${d} ${months[m - 1]} ${y}`
}

export function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
