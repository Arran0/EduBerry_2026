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

/* ── Inset grouped forms ──────────────────────────────────────────────────
 *
 * The iOS Settings form: related fields in one rounded group, one field per
 * 44px row, the label on the left and the value typed straight into the row
 * on the right, hairline separators inset from the left edge. A form reads as
 * a list of facts about the thing being edited rather than a stack of boxes,
 * and on a phone a row costs one line instead of a label, a box and a hint.
 */

/** A titled group of rows, with an optional note under it. */
export function Group({ title, note, children, className = '' }: {
  title?: string
  note?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={className}>
      {title && <h3 className="px-4 pb-1.5 text-[12.5px] font-semibold text-slate-500">{title}</h3>}
      <div className="rounded-[16px] bg-white border border-slate-200/70 shadow-[0_1px_2px_rgba(15,23,42,.04)] overflow-hidden">
        {children}
      </div>
      {note && <p className="px-4 pt-1.5 text-[11.5px] leading-snug text-slate-500">{note}</p>}
    </section>
  )
}

const ROW_RULE =
  "relative before:content-[''] before:absolute before:top-0 before:left-4 before:right-0 before:h-px before:bg-slate-200/80 first:before:hidden"

/**
 * One field: label left, control right. `stacked` puts the label above, for
 * controls that need the full width (notes, colour swatches, a segmented
 * choice with long labels).
 */
export function Row({ label, required, hint, stacked = false, children, as: Tag = 'label' }: {
  label: string
  required?: boolean
  hint?: string
  stacked?: boolean
  children: React.ReactNode
  /** 'div' when the row holds buttons, so a click is not forwarded to the first one. */
  as?: 'label' | 'div'
}) {
  return (
    <Tag className={`${ROW_RULE} block px-4 py-1.5 transition-colors focus-within:bg-[#FBF8F1]`}>
      <span className={stacked ? 'block' : 'flex items-center gap-3 min-h-[34px]'}>
        <span className={stacked
          ? 'block pt-1 text-[12.5px] font-medium text-slate-500'
          : 'w-[6.75rem] sm:w-[8.5rem] flex-shrink-0 text-[13.5px] text-slate-800'}>
          {label}{required && <span className="text-[#B8983C]"> *</span>}
        </span>
        <span className={stacked ? 'block pt-1 pb-1' : 'flex-1 min-w-0'}>{children}</span>
      </span>
      {hint && <span className={`block text-[11px] leading-snug text-slate-400 pb-0.5 ${stacked ? '' : 'pl-[7.5rem] sm:pl-[9.25rem]'}`}>{hint}</span>}
    </Tag>
  )
}

const ROW_CONTROL =
  'w-full bg-transparent border-0 p-0 py-1.5 text-[14px] text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-0 disabled:text-slate-400'

export function RowInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${ROW_CONTROL} ${props.className ?? ''}`} />
}

export function RowSelect({ className = '', children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span className="relative block">
      <select {...props} className={`${ROW_CONTROL} appearance-none pr-6 cursor-pointer ${className}`}>{children}</select>
      <svg aria-hidden viewBox="0 0 16 16" className="pointer-events-none absolute right-0 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400">
        <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  )
}

export function RowTextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${ROW_CONTROL} resize-none leading-snug ${props.className ?? ''}`} />
}

/** The iOS switch, in the bus gold. */
export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex w-[46px] h-[28px] flex-shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B8983C]/60 ${
        checked ? 'bg-[#34A853]' : 'bg-slate-200'
      }`}
    >
      <span className={`absolute top-[2px] left-[2px] w-6 h-6 rounded-full bg-white shadow-[0_2px_5px_rgba(15,23,42,.25)] transition-transform ${
        checked ? 'translate-x-[18px]' : ''
      }`} />
    </button>
  )
}

/** A row whose control is a switch: the label is the whole statement. */
export function SwitchRow({ label, hint, checked, onChange }: {
  label: string
  hint?: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <div className={`${ROW_RULE} flex items-center gap-3 px-4 py-2 min-h-[46px]`}>
      <span className="flex-1 min-w-0">
        <span className="block text-[13.5px] text-slate-800">{label}</span>
        {hint && <span className="block text-[11px] leading-snug text-slate-400">{hint}</span>}
      </span>
      <Switch checked={checked} onChange={onChange} label={label} />
    </div>
  )
}

/** A small segmented control for a choice inside a row. */
export function Segmented<T extends string>({ value, onChange, options }: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string }[]
}) {
  return (
    <span className="flex w-full p-0.5 rounded-[10px] bg-slate-100" role="radiogroup">
      {options.map(o => {
        const on = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={`flex-1 h-7 rounded-[8px] text-[12.5px] font-semibold transition ${
              on ? 'bg-white text-slate-900 shadow-[0_1px_3px_rgba(15,23,42,.18)]' : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            {o.label}
          </button>
        )
      })}
    </span>
  )
}
