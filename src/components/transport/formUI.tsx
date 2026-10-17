'use client'

/**
 * Form atoms shared by the transport modals.
 *
 * Thin wrappers over the bus app's glass tokens (./glassAdmin), so a form in a
 * popup reads as the same material as the panels it opened from.
 *
 * These are deliberately dense. An admin form here is not a sign-up page with
 * six fields and room to breathe — it is a vehicle with ten, a route with
 * twelve, a schedule with a weekday picker — and a layout that gives each field
 * a full row turns filling one in into scrolling through one. The sheets on
 * /more/bus are dense for the same reason, and a form that opens over them
 * should not feel like a different application.
 *
 * The density comes from three things, all here rather than repeated per form:
 * inputs one step tighter than the page default, hints that sit under the field
 * without adding a line of their own margin, and a grid that goes to three
 * columns on a wide modal instead of stopping at two.
 */

import React from 'react'
import { ADMIN } from './glassAdmin'

/**
 * One step tighter than ADMIN.inputPlain, which is sized for a page rather
 * than for twelve of itself inside a modal.
 */
const DENSE_INPUT =
  'w-full bg-white/90 border border-slate-200/80 rounded-xl px-2.5 py-1.5 text-sm text-slate-900 ' +
  'shadow-[inset_0_1px_2px_rgba(15,23,42,.05)] placeholder:text-slate-400 focus:outline-none ' +
  'focus:border-[#B8983C] focus:ring-2 focus:ring-[#B8983C]/20 transition'

export function Field({
  label, hint, children, className = '', span,
}: {
  label: string
  hint?: string
  children: React.ReactNode
  className?: string
  /** Widen a field that genuinely needs the room, inside a FormGrid. */
  span?: 2 | 3 | 'full'
}) {
  const spanClass =
    span === 'full' ? 'sm:col-span-2 lg:col-span-3'
    : span === 3 ? 'lg:col-span-3'
    : span === 2 ? 'sm:col-span-2'
    : ''
  return (
    <label className={`block ${spanClass} ${className}`}>
      <span className={ADMIN.label}>{label}</span>
      <div className="mt-1">{children}</div>
      {hint && <p className="mt-0.5 text-[10.5px] leading-snug text-slate-500">{hint}</p>}
    </label>
  )
}

/**
 * The form's column grid.
 *
 * Three columns on a wide modal, two on a tablet, one on a phone. Two was the
 * old ceiling and it left half of a `size="lg"` modal empty while the fields
 * ran off the bottom.
 */
export function FormGrid({ children, className = '' }: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={`grid grid-cols-1 gap-x-3 gap-y-2.5 sm:grid-cols-2 lg:grid-cols-3 ${className}`}>
      {children}
    </div>
  )
}

/**
 * A titled band of related fields, matching the dark column headers the sheets
 * on /more/bus use — so a form reads as the same object as the list it opened
 * from, rather than as a dialog that happens to be nearby.
 */
export function FormSection({ title, hint, children }: {
  title: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <section className="rounded-2xl border border-slate-200/70 bg-slate-50/60 overflow-hidden">
      <div className="px-3.5 pt-3">
        <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{title}</p>
      </div>
      <div className="p-3.5 pt-2">
        {hint && <p className="mb-2.5 text-[11.5px] leading-snug text-slate-500">{hint}</p>}
        {children}
      </div>
    </section>
  )
}

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${DENSE_INPUT} ${props.className ?? ''}`} />
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${DENSE_INPUT} ${props.className ?? ''}`} />
}

export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${DENSE_INPUT} resize-none ${props.className ?? ''}`} />
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <p className="text-xs text-rose-700 bg-rose-50/90 border border-rose-100 rounded-xl px-3 py-2">
      {message}
    </p>
  )
}

export function ModalFooter({
  onCancel, onSubmit, saving, submitLabel = 'Save', disabled = false,
}: {
  onCancel: () => void
  onSubmit: () => void
  saving: boolean
  submitLabel?: string
  disabled?: boolean
}) {
  return (
    <div className="flex items-center justify-end gap-2">
      <button type="button" className={ADMIN.ghostBtn} onClick={onCancel} disabled={saving}>
        Cancel
      </button>
      <button type="button" className={ADMIN.darkBtn} onClick={onSubmit} disabled={saving || disabled}>
        {saving ? 'Saving…' : submitLabel}
      </button>
    </div>
  )
}
