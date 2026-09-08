'use client'

import React from 'react'
import { Star } from 'lucide-react'

/**
 * Shared building blocks for the homework / classwork authoring cards.
 *
 * The three forms (new homework, new classwork, edit classwork) used to be
 * plain stacks of bordered inputs that read as a debug form. These pieces give
 * them one elevated identity on both phone and desktop: a coloured header
 * band, labelled field groups, tappable toggle cards and a chunky footer.
 */

/* The cards take their colour from the page palette an admin sets in app
   settings (see PageConfigContext, which writes --page-* onto the page's
   data-page-theme element; ModalShell copies that attribute onto its portal
   so a card raised into <body> is themed too). `themed-input` carries the
   focus ring, which needs a tint of the same variable. */
export const INPUT_CLASS =
  'themed-input w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 ' +
  'placeholder:text-slate-400 shadow-sm focus:outline-none transition-all'

/** Primary button fill and the header icon chip's tint, straight from the
 *  page palette. The header itself stays white — a full colour band across the
 *  top made the card read as an alert rather than a form. */
const BUTTON_FILL = 'var(--page-primary-dark, #4338ca)'
const CHIP_TINT = 'color-mix(in srgb, var(--page-primary, #6366f1) 16%, white)'
const CHIP_INK = 'var(--page-primary-dark, #4338ca)'

/**
 * Card header: a tinted icon chip beside the title, on white — the same shape
 * ModalShell gives the classwork card, so all four authoring cards (new/edit
 * homework, new/edit classwork) read as one family.
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
    <div className="flex items-center gap-3 px-3.5 sm:px-5 py-3 border-b border-slate-100 bg-white/90 backdrop-blur-xl">
      <div
        className="w-9 h-9 !rounded-xl flex items-center justify-center flex-shrink-0 [&>svg]:w-[17px] [&>svg]:h-[17px]"
        style={{ background: CHIP_TINT, color: CHIP_INK }}
      >
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[15px] font-bold text-slate-800 leading-tight truncate">{title}</p>
        {subtitle && <p className="text-[11px] text-slate-500 truncate mt-0.5">{subtitle}</p>}
      </div>
      {actions}
    </div>
  )
}

/** Header icon button — sits on the white header beside the title. */
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
      className="w-8 h-8 flex-shrink-0 flex items-center justify-center !rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 hover:text-slate-700 active:scale-90 transition-all disabled:opacity-50 [&>svg]:w-[15px] [&>svg]:h-[15px]"
    >
      {children}
    </button>
  )
}

/** Small uppercase label above a field group. */
export function FieldLabel({ icon, children, hint }: {
  icon?: React.ReactNode
  children: React.ReactNode
  hint?: string
}) {
  return (
    <p className="text-[10px] font-bold uppercase tracking-wide text-slate-600 flex items-center gap-1.5 mb-1">
      {icon}
      {children}
      {hint && <span className="normal-case font-medium tracking-normal text-slate-500">{hint}</span>}
    </p>
  )
}

/** A checkbox rendered as a compact tappable pill — bigger hit target than a
 *  native checkbox, but a single line (the full description moves to the
 *  title tooltip) so a row of these stays sleek instead of stacking two
 *  card-height blocks. */
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
      className={`flex-1 min-w-[8rem] flex items-center gap-1.5 text-left px-2.5 py-2 rounded-lg border transition-all active:scale-[0.98] text-xs font-semibold [&_svg]:w-[14px] [&_svg]:h-[14px] ${
        checked ? activeClass : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
      }`}
    >
      <span className={`flex-shrink-0 flex ${checked ? '' : 'text-slate-500'}`}>{icon}</span>
      {label}
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
      <FieldLabel icon={<Star size={12} className="text-amber-500" />} hint="— awarded on completion">
        Edu Points
      </FieldLabel>
      <div className="flex flex-wrap items-center gap-1">
        {[1, 2, 3, 4, 5].map(n => (
          <button
            key={n}
            type="button"
            onClick={() => onPreset(n)}
            className={`min-w-[30px] px-2 py-1.5 rounded-lg text-xs font-bold border transition-all active:scale-95 ${
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
          className={`w-24 px-2 py-1.5 rounded-lg text-xs font-bold border transition-all focus:outline-none focus:ring-4 focus:ring-amber-500/10 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${
            custom !== ''
              ? 'bg-amber-500 text-white border-amber-500 placeholder-amber-100'
              : 'text-slate-700 border-slate-200 bg-white placeholder:text-slate-400'
          }`}
        />
      </div>
    </div>
  )
}

/** Sticky footer with a cancel link and a solid primary action. */
export function FormFooter({
  onCancel, submitLabel, submitIcon, disabled,
}: {
  onCancel: () => void
  submitLabel: string
  submitIcon: React.ReactNode
  disabled?: boolean
}) {
  return (
    <div className="sticky bottom-0 flex items-center gap-2 px-3.5 sm:px-4 py-2 border-t border-slate-100 bg-white/95 backdrop-blur-xl pb-[max(0.625rem,env(safe-area-inset-bottom))]">
      <button
        type="button"
        onClick={onCancel}
        className="px-3.5 py-2 rounded-full text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors"
      >
        Cancel
      </button>
      <button
        type="submit"
        disabled={disabled}
        className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2 rounded-full text-xs font-bold text-white shadow-md transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-50 disabled:shadow-none [&_svg]:w-[14px] [&_svg]:h-[14px]"
        style={{ background: BUTTON_FILL }}
      >
        {submitIcon}
        {submitLabel}
      </button>
    </div>
  )
}
