'use client'

import React from 'react'
import { ChevronLeft, ChevronRight, Loader2, AlertTriangle, Circle, CircleDot, CheckCircle2, MinusCircle } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import ModalShell from '@/components/ui/ModalShell'
import type { TaskStatus } from '@/lib/tasks'

// ──────────────────────────────────────────────────────────────
// The Task Manager's kit — "amber paper".
//
// Warm white cards on the amber page, hairlines tinted from the page's own
// amber, capsule controls, and one strong colour: the amber-to-orange of the
// primary action. Nothing is filled dark. The classes live in globals.css
// (.tk-*), so a card in a tab and a card in a popup are the same object.
// ──────────────────────────────────────────────────────────────

type Tone = 'primary' | 'soft' | 'danger' | 'dangerSolid'
const TONE: Record<Tone, string> = {
  primary: 'tk-btn-primary',
  soft: 'tk-btn-soft',
  danger: 'tk-btn-danger',
  dangerSolid: 'tk-btn-danger-solid',
}

export function Btn({ tone = 'soft', className = '', children, ...rest }: { tone?: Tone } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" {...rest} className={`tk-btn ${TONE[tone]} ${className}`}>{children}</button>
}

export function IconBtn({ label, quiet, className = '', children, ...rest }: {
  label: string
  quiet?: boolean
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" aria-label={label} title={label} {...rest} className={`tk-icon-btn ${quiet ? 'tk-quiet' : ''} ${className}`}>
      {children}
    </button>
  )
}

/** The amber square an icon sits in. */
export function IconChip({ icon: Icon, size = 32 }: { icon: LucideIcon; size?: number }) {
  return (
    <span className="tk-chip-icon" style={{ width: size, height: size }}>
      <Icon size={Math.round(size * 0.5)} />
    </span>
  )
}

/** Two to four choices in a capsule. */
export function Seg<T extends string>({ value, onChange, options, className = '', full = false }: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: React.ReactNode }[]
  className?: string
  /** Stretch across the row. */
  full?: boolean
}) {
  return (
    <span className={`tk-seg ${full ? 'flex w-full' : ''} ${className}`} role="group">
      {options.map(o => (
        <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)} className="tk-seg-btn">
          {o.label}
        </button>
      ))}
    </span>
  )
}

/** Previous / label / next in one capsule. */
export function Stepper({ label, onPrev, onNext, prevLabel, nextLabel, canNext = true, onLabel, labelTitle, className = '' }: {
  label: React.ReactNode
  onPrev: () => void
  onNext: () => void
  prevLabel: string
  nextLabel: string
  canNext?: boolean
  onLabel?: () => void
  labelTitle?: string
  className?: string
}) {
  const arrow = 'w-8 h-8 inline-flex items-center justify-center rounded-full text-slate-500 hover:text-amber-700 hover:bg-amber-50 disabled:opacity-35 disabled:pointer-events-none transition'
  return (
    <span className={`inline-flex items-center gap-0.5 p-0.5 rounded-full bg-white border border-amber-900/[0.12] shadow-[0_1px_2px_rgba(120,53,15,.05)] max-w-full ${className}`}>
      <button type="button" onClick={onPrev} aria-label={prevLabel} className={arrow}><ChevronLeft size={16} /></button>
      {onLabel ? (
        <button type="button" onClick={onLabel} title={labelTitle} className="px-1.5 text-[13px] font-semibold text-slate-800 whitespace-nowrap hover:text-amber-700 transition">{label}</button>
      ) : (
        <span className="px-1.5 text-[13px] font-semibold text-slate-800 whitespace-nowrap">{label}</span>
      )}
      <button type="button" onClick={onNext} disabled={!canNext} aria-label={nextLabel} className={arrow}><ChevronRight size={16} /></button>
    </span>
  )
}

/** The iOS switch, in amber. */
export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex w-[44px] h-[26px] flex-shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-amber-400/40 disabled:opacity-60 ${
        checked ? 'bg-gradient-to-r from-amber-500 to-orange-500' : 'bg-slate-200'}`}
    >
      <span className={`absolute top-[2px] left-[2px] w-[22px] h-[22px] rounded-full bg-white shadow-[0_2px_5px_rgba(15,23,42,.22)] transition-transform ${checked ? 'translate-x-[18px]' : ''}`} />
    </button>
  )
}

/** A card of form rows, with an optional title above and note below. */
export function FormCard({ title, note, children, className = '' }: {
  title?: React.ReactNode
  note?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={className}>
      {title && <h3 className="px-1 pb-1.5 text-[12px] font-semibold text-amber-800/80">{title}</h3>}
      <div className="tk-card !rounded-[14px] tk-rule overflow-hidden">{children}</div>
      {note && <p className="px-1 pt-1.5 text-[11.5px] leading-snug text-slate-500">{note}</p>}
    </section>
  )
}

/** One row: what it is on the left, its control on the right; wraps when tight. */
export function FormRow({ label, hint, children, stack = false }: {
  label: React.ReactNode
  hint?: React.ReactNode
  children: React.ReactNode
  stack?: boolean
}) {
  return (
    <div className={`px-3.5 py-2.5 ${stack ? 'space-y-2' : 'flex flex-wrap items-center justify-between gap-x-4 gap-y-2'}`}>
      <div className={stack ? '' : 'min-w-0 flex-1 basis-[110px]'}>
        <p className="text-[13.5px] text-slate-800 leading-snug">{label}</p>
        {hint && <p className="text-[11.5px] text-slate-500 leading-snug mt-0.5">{hint}</p>}
      </div>
      <div className={stack ? 'min-w-0' : 'max-w-full'}>{children}</div>
    </div>
  )
}

/** A labelled field, label above. */
export function Field({ label, children, className = '' }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`block min-w-0 ${className}`}>
      <span className="block text-[12px] font-medium text-slate-500 mb-1">{label}</span>
      {children}
    </label>
  )
}

export function Notice({ tone = 'error', children, className = '' }: { tone?: 'error' | 'warn' | 'info'; children: React.ReactNode; className?: string }) {
  const tones = {
    error: 'bg-red-50 border-red-200 text-red-700',
    warn: 'bg-amber-50 border-amber-200 text-amber-800',
    info: 'bg-white border-amber-900/10 text-slate-600',
  }
  return (
    <div className={`flex items-start gap-2 px-3 py-2 rounded-[12px] border text-[12.5px] leading-snug ${tones[tone]} ${className}`}>
      {tone !== 'info' && <AlertTriangle size={14} className="flex-shrink-0 mt-px" />}
      <span className="min-w-0 break-words">{children}</span>
    </div>
  )
}

/** A heading inside a card or popup body, with a count and an action. */
export function SubHead({ icon: Icon, children, count, right }: {
  icon?: LucideIcon
  children: React.ReactNode
  count?: React.ReactNode
  right?: React.ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 mb-2">
      <h4 className="flex items-center gap-1.5 min-w-0 text-[13px] font-semibold text-slate-800">
        {Icon && <Icon size={14} className="text-amber-600 flex-shrink-0" />}
        <span className="break-words min-w-0">{children}</span>
        {count != null && <span className="text-[12px] font-medium text-slate-400 tabular-nums">{count}</span>}
      </h4>
      {right}
    </div>
  )
}

/** The popup every task screen opens: the shared sheet with the amber icon. */
export function TaskSheet({ icon, children, ...props }: {
  icon: LucideIcon
  children: React.ReactNode
} & Omit<React.ComponentProps<typeof ModalShell>, 'icon' | 'iconClassName' | 'children'>) {
  const Icon = icon
  return (
    <ModalShell
      size="lg"
      {...props}
      icon={<Icon size={17} />}
      iconClassName="tk-chip-icon !rounded-[12px]"
    >
      {children}
    </ModalShell>
  )
}

/** Yes-or-no, in the same sheet. Replaces the browser's confirm box. */
export function ConfirmSheet({ title, icon, children, confirmLabel, busy, error, onConfirm, onClose }: {
  title: string
  icon: LucideIcon
  children: React.ReactNode
  confirmLabel: string
  busy?: boolean
  error?: string | null
  onConfirm: () => void
  onClose: () => void
}) {
  return (
    <TaskSheet
      onClose={onClose}
      size="sm"
      zClass="z-[60]"
      title={title}
      icon={icon}
      footer={
        <div className="flex items-center justify-end gap-2">
          <Btn onClick={onClose} disabled={busy}>Cancel</Btn>
          <Btn tone="dangerSolid" onClick={onConfirm} disabled={busy}>
            {busy && <Loader2 size={13} className="animate-spin" />}
            {confirmLabel}
          </Btn>
        </div>
      }
    >
      <div className="text-[13.5px] text-slate-600 leading-relaxed">{children}</div>
      {error && <Notice className="mt-3">{error}</Notice>}
    </TaskSheet>
  )
}

/** One status, drawn the same in the grid, the lists and the popups. */
export function StatusMark({ status, requireCheck, size = 14 }: { status: TaskStatus; requireCheck: boolean; size?: number }) {
  if (status === 'dismissed') return <MinusCircle size={size} className="text-slate-400" />
  if (status === 'checked' || (status === 'done' && !requireCheck)) return <CheckCircle2 size={size} className="text-emerald-500" />
  if (status === 'done') return <CheckCircle2 size={size} className="text-yellow-500" />
  if (status === 'partial') return <CircleDot size={size} className="text-orange-600" />
  return <Circle size={size} className="text-slate-400" />
}

/** A small read-only fact in a popup: icon and value, wrapping if long. */
export function Fact({ icon: Icon, tone = 'neutral', children }: {
  icon: LucideIcon
  tone?: 'neutral' | 'amber' | 'violet' | 'blue' | 'indigo'
  children: React.ReactNode
}) {
  const tones = {
    neutral: 'bg-[#fbf6ee] text-slate-700 border-amber-900/[0.08]',
    amber: 'bg-amber-50 text-amber-800 border-amber-200',
    violet: 'bg-violet-50 text-violet-700 border-violet-100',
    blue: 'bg-sky-50 text-sky-700 border-sky-100',
    indigo: 'bg-indigo-50 text-indigo-700 border-indigo-100',
  }
  return (
    <span className={`inline-flex items-center gap-1.5 min-h-[28px] px-2.5 py-1 rounded-full border text-[12px] font-medium leading-snug max-w-full ${tones[tone]}`}>
      <Icon size={13} className="flex-shrink-0" />
      <span className="min-w-0 break-words">{children}</span>
    </span>
  )
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "21 Oct" (or "21 Oct 2025" outside this year) from a YYYY-MM-DD date. */
export function shortDate(iso: string | null | undefined): string {
  if (!iso) return 'No date'
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return iso
  return y === new Date().getFullYear() ? `${d} ${MONTHS[m - 1]}` : `${d} ${MONTHS[m - 1]} ${y}`
}
