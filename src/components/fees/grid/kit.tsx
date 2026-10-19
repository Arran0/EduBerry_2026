'use client'

// ─────────────────────────────────────────────────────────────────────────────
// The fee grid's small parts, in the fee module's own vocabulary.
//
// Nothing here invents a style. The sheet is the module's squared glass popup
// with the charcoal-and-bronze icon every fee popup carries; a field is a
// label over `ADMIN.inputPlain`; a toggle is a capsule, dark when on.
// ─────────────────────────────────────────────────────────────────────────────

import React from 'react'
import { AnimatePresence } from 'framer-motion'
import ModalShell from '@/components/ui/ModalShell'
import { ADMIN, FEE_ICON } from '@/components/fees/ui'

/** Boys and girls in a double cell. Blue and rose, muted to sit on paper. */
export const BOY = '#3A5490'
export const GIRL = '#A93259'

/**
 * A fee-grid popup: the module's squared glass sheet. Rendered inside
 * AnimatePresence so it can animate out.
 */
export function FeeSheet({
  open, onClose, title, subtitle, icon, footer, size = 'md', children,
}: {
  open: boolean
  onClose: () => void
  title: React.ReactNode
  subtitle?: React.ReactNode
  icon: React.ReactNode
  footer?: React.ReactNode
  size?: 'md' | 'lg' | 'xl' | '2xl'
  children: React.ReactNode
}) {
  return (
    <AnimatePresence>
      {open && (
        <ModalShell
          onClose={onClose}
          sharp
          size={size}
          title={title}
          subtitle={subtitle}
          icon={icon}
          iconClassName={FEE_ICON}
          bodyClassName="space-y-4"
          footer={footer}
        >
          {children}
        </ModalShell>
      )}
    </AnimatePresence>
  )
}

/** A labelled field: the micro-label, the control, and a line of help under it. */
export function Field({ label, hint, error, children, className = '' }: {
  label: React.ReactNode
  hint?: React.ReactNode
  error?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={className}>
      <span className={`${ADMIN.label} block mb-1`}>{label}</span>
      {children}
      {error
        ? <p className="text-[12px] text-[#A93232] mt-1 leading-snug">{error}</p>
        : hint && <p className="text-[12px] text-slate-500 mt-1 leading-snug">{hint}</p>}
    </div>
  )
}

/** A capsule toggle: dark when on, a hairline capsule when off. */
export function Pick({
  on, onClick, children, disabled, tone = 'dark', title,
}: {
  on: boolean
  onClick?: () => void
  children: React.ReactNode
  disabled?: boolean
  tone?: 'dark' | 'gold' | 'bad'
  title?: string
}) {
  const onCls = tone === 'gold' ? 'bg-[#B8983C] border-[#B8983C] text-white'
    : tone === 'bad' ? 'bg-[#A93232] border-[#A93232] text-white'
    : 'bg-[#27272A] border-[#27272A] text-white'
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={on}
      title={title}
      className={`inline-flex items-center gap-1 h-8 px-3 rounded-full border text-[12.5px] font-semibold
                  leading-none whitespace-nowrap transition active:scale-[0.97] disabled:opacity-40
                  disabled:pointer-events-none ${on ? onCls
                    : 'bg-white border-[#E2DDD2] text-slate-600 hover:border-[#CFC8B8] hover:text-slate-900'}`}
    >
      {children}
    </button>
  )
}

/** The module's error box. */
export function ErrorNote({ children }: { children: React.ReactNode }) {
  if (!children) return null
  return (
    <div className="bg-[#FCEDED] border-l-[3px] border-[#C24141] text-[#962C2C] text-[13px] leading-relaxed px-3.5 py-2.5">{children}</div>
  )
}

/** A quiet one-line note with a coloured edge — what a lock or a warning means. */
export function Aside({ tone = 'info', children }: { tone?: 'info' | 'good' | 'warn'; children: React.ReactNode }) {
  const t = tone === 'good' ? 'border-[#2E8B57] bg-[#EAF5EE] text-[#1F6B42]'
    : tone === 'warn' ? 'border-[#B8983C] bg-[#FBF4E2] text-[#6E5513]'
    : 'border-[#B9B2A2] bg-[#F8F6F1] text-slate-600'
  return <div className={`border-l-[3px] px-3.5 py-2.5 text-[12.5px] leading-snug ${t}`}>{children}</div>
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
