'use client'

import React from 'react'
import { Star } from 'lucide-react'

/**
 * Shared building blocks for the homework / classwork authoring forms.
 *
 * The forms open in a bare ModalShell on the glass sheet, so they draw the
 * same three layers every other popup in Academics has: the header straight
 * on the glass, the fields on a solid card (FORM_BODY), and the actions in a
 * footer on the glass, right-aligned with the primary action last.
 */

/* Fields take their focus ring from the page palette an admin sets in app
   settings (see PageConfigContext, which writes --page-* onto the page's
   data-page-theme element; ModalShell copies that attribute onto its portal
   so a form raised into <body> is themed too). */
export const INPUT_CLASS =
  'themed-input w-full min-w-0 bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-800 ' +
  'placeholder:text-slate-400 focus:outline-none transition-[border-color,box-shadow]'

/** The <form> itself: transparent, so the sheet behind it is the surface. */
export const FORM_SHELL = 'flex flex-col min-h-0'

/** The solid card the fields sit on. Scrolls on its own between header and footer. */
export const FORM_BODY =
  'lg-sheet-card mx-2 sm:mx-2.5 max-h-[64dvh] sm:max-h-[60dvh] overflow-y-auto overflow-x-hidden overscroll-contain px-4 sm:px-5 py-4 space-y-3.5'

const BUTTON_FILL = 'var(--page-primary-dark, #4338ca)'
const CHIP_TINT = 'color-mix(in srgb, var(--page-primary, #6366f1) 16%, white)'
const CHIP_INK = 'var(--page-primary-dark, #4338ca)'

/**
 * Header on the glass: a tinted icon chip beside the title, the same shape
 * ModalShell draws for its own titled popups. The title wraps rather than
 * truncating — a folder name is the part that tells forms apart.
 */
export function FormHeader({
  icon, title, subtitle, actions,
}: {
  icon: React.ReactNode
  title: string
  subtitle?: string | null
  actions?: React.ReactNode
}) {
  return (
    <div className="relative z-[3] flex-shrink-0 flex items-center gap-3 px-4 sm:px-5 pt-6 sm:pt-4 pb-3">
      <div
        className="icon-chip w-10 h-10 flex-shrink-0 [&_svg]:w-[17px] [&_svg]:h-[17px]"
        style={{ background: CHIP_TINT, color: CHIP_INK, boxShadow: 'none' }}
      >
        <span className="relative z-10 flex">{icon}</span>
      </div>
      <div className="flex-1 min-w-0">
        <p className="min-w-0 font-display text-[1.05rem] sm:text-[1.15rem] font-bold text-slate-900 leading-snug break-words">{title}</p>
        {subtitle && <p className="min-w-0 text-[12px] leading-snug text-slate-500 break-words mt-0.5">{subtitle}</p>}
      </div>
      <div className="flex items-center gap-1.5 flex-shrink-0">{actions}</div>
    </div>
  )
}

/** Header icon button — the glass close/action control. */
export function HeaderAction({
  onClick, title, disabled, children,
}: {
  onClick: () => void
  title: string
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      disabled={disabled}
      className="lg-control keep-round w-9 h-9 flex-shrink-0 disabled:opacity-50 [&>svg]:w-[15px] [&>svg]:h-[15px]"
    >
      {children}
    </button>
  )
}

/** Sentence-case label above a field. */
export function FieldLabel({ icon, children, hint }: {
  icon?: React.ReactNode
  children: React.ReactNode
  hint?: string
}) {
  return (
    <p className="text-[12px] font-semibold text-slate-600 flex flex-wrap items-center gap-x-1.5 mb-1">
      {icon}
      {children}
      {hint && <span className="font-normal text-slate-400">{hint}</span>}
    </p>
  )
}

/** A checkbox drawn as a compact tappable chip — a bigger target than a
 *  native checkbox, on one line, with the full description as its tooltip. */
export function ToggleCard({
  checked, onChange, icon, label, description, activeClass = 'border-indigo-400 bg-indigo-50/70 text-indigo-700',
}: {
  checked: boolean
  onChange: (v: boolean) => void
  icon: React.ReactNode
  label: string
  description: string
  activeClass?: string
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      aria-pressed={checked}
      title={description}
      className={`flex-1 min-w-[8rem] flex items-center gap-1.5 text-left px-3 py-2 rounded-xl border transition-all active:scale-[0.98] text-xs font-semibold [&_svg]:w-[14px] [&_svg]:h-[14px] ${
        checked ? activeClass : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
      }`}
    >
      <span className={`flex-shrink-0 flex ${checked ? '' : 'text-slate-500'}`}>{icon}</span>
      <span className="min-w-0 break-words">{label}</span>
    </button>
  )
}

/** 1–5 preset chips plus a free-form custom value. */
export function PointsPicker({
  value, custom, onPreset, onCustom,
}: {
  value: number
  custom: string
  onPreset: (n: number) => void
  onCustom: (v: string) => void
}) {
  return (
    <div>
      <FieldLabel icon={<Star size={12} className="text-amber-500" />} hint="awarded when it is done">
        EduPoints
      </FieldLabel>
      <div className="flex flex-wrap items-center gap-1">
        {[1, 2, 3, 4, 5].map(n => (
          <button
            key={n}
            type="button"
            onClick={() => onPreset(n)}
            className={`min-w-[34px] px-2 py-1.5 rounded-full text-xs font-bold border transition-all active:scale-95 ${
              value === n && custom === ''
                ? 'bg-amber-500 text-white border-amber-500 shadow-sm'
                : 'text-slate-700 border-slate-200 bg-white hover:border-amber-300 hover:bg-amber-50'
            }`}
          >
            {n}
          </button>
        ))}
        <input
          type="number"
          min={0}
          step={1}
          value={custom}
          onChange={e => onCustom(e.target.value)}
          placeholder="Custom"
          className={`w-24 px-3 py-1.5 rounded-full text-xs font-bold border transition-all focus:outline-none focus:ring-4 focus:ring-amber-500/10 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${
            custom !== ''
              ? 'bg-amber-500 text-white border-amber-500 placeholder-amber-100'
              : 'text-slate-700 border-slate-200 bg-white placeholder:text-slate-400'
          }`}
        />
      </div>
    </div>
  )
}

/** Footer on the glass: Cancel, then the primary action in the page colour. */
export function FormFooter({
  onCancel, submitLabel, submitIcon, disabled,
}: {
  onCancel: () => void
  submitLabel: string
  submitIcon: React.ReactNode
  disabled?: boolean
}) {
  return (
    <div className="relative z-[3] flex-shrink-0 flex flex-wrap items-center justify-end gap-2 px-4 sm:px-5 pt-2.5 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:pb-3.5">
      <button
        type="button"
        onClick={onCancel}
        className="inline-flex items-center justify-center min-h-[2.5rem] sm:min-h-[2.125rem] px-4 sm:px-3.5 rounded-full text-[13px] font-semibold text-slate-700 bg-white/80 hover:bg-white ring-1 ring-inset ring-slate-900/10 transition-colors"
      >
        Cancel
      </button>
      <button
        type="submit"
        disabled={disabled}
        className="inline-flex items-center justify-center gap-1.5 min-h-[2.5rem] sm:min-h-[2.125rem] px-4 sm:px-3.5 rounded-full text-[13px] font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,.18),0_4px_12px_-6px_rgba(15,23,42,.5)] transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-50 disabled:shadow-none [&_svg]:w-[14px] [&_svg]:h-[14px]"
        style={{ background: BUTTON_FILL }}
      >
        {submitIcon}
        {submitLabel}
      </button>
    </div>
  )
}
