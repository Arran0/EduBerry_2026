'use client'

// ─────────────────────────────────────────────────────────────────────────────
// The fee grid's small parts, in the fee module's own vocabulary: square
// corners, the warm paper ramp, hairlines, zinc and one gold.
//
// Nothing here invents a style. The sheet is the module's sharp popup with the
// gold-on-dark icon square every fee tool uses; fields are `ADMIN.label` over
// `ADMIN.inputPlain`; a toggle is the same square chip the ledger filters use.
// ─────────────────────────────────────────────────────────────────────────────

import React from 'react'
import { AnimatePresence } from 'framer-motion'
import ModalShell from '@/components/ui/ModalShell'
import { ADMIN } from '@/components/fees/ui'

/** Boys and girls in a double cell. Blue and rose, muted to sit on paper. */
export const BOY = '#3A5490'
export const GIRL = '#A93259'

/**
 * A fee-grid popup: the module's sharp sheet, paper body, gold-on-dark icon.
 * Rendered inside AnimatePresence so it can animate out.
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
          iconClassName="bg-[#27272A] text-[#B8983C]"
          bodyClassName="bg-[#FDFCF9] !px-4 !py-4 space-y-4"
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
      <span className={`${ADMIN.label} block mb-1.5`}>{label}</span>
      {children}
      {error
        ? <p className="text-[11px] text-[#A93232] mt-1.5 leading-snug">{error}</p>
        : hint && <p className="text-[11px] text-[#8C8878] mt-1.5 leading-snug">{hint}</p>}
    </div>
  )
}

/** A square toggle chip: dark when on, a hairline box when off. */
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
      className={`inline-flex items-center gap-1 border px-2 py-[5px] text-[10.5px] font-bold uppercase
                  tracking-[0.06em] leading-none whitespace-nowrap transition-colors disabled:opacity-40
                  disabled:pointer-events-none ${on ? onCls
                    : 'bg-white border-[#E3DFD3] text-[#6B675A] hover:border-[#C9C4B4] hover:text-[#18181B]'}`}
    >
      {children}
    </button>
  )
}

/** The module's error box. */
export function ErrorNote({ children }: { children: React.ReactNode }) {
  if (!children) return null
  return (
    <div className="bg-[#FCECEC] border border-[#EFCCCC] text-[#A93232] text-[12.5px] px-3 py-2.5">{children}</div>
  )
}

/** A quiet one-line note with a coloured edge — what a lock or a warning means. */
export function Aside({ tone = 'info', children }: { tone?: 'info' | 'good' | 'warn'; children: React.ReactNode }) {
  const t = tone === 'good' ? 'border-[#1F6B42] bg-[#EAF5EE] text-[#1F6B42]'
    : tone === 'warn' ? 'border-[#B8983C] bg-[#FAF3DF] text-[#7A6220]'
    : 'border-[#C9C4B4] bg-[#FAF8F2] text-[#52525B]'
  return <div className={`border-l-2 px-3 py-2 text-[11.5px] leading-snug ${t}`}>{children}</div>
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
