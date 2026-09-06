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

export const INPUT_CLASS =
  'w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 shadow-sm ' +
  'focus:outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-500/10 transition-all'

export type Accent = 'indigo' | 'purple' | 'cyan'

const ACCENT_HEADER: Record<Accent, string> = {
  indigo: 'from-indigo-600 via-indigo-600 to-blue-600',
  purple: 'from-violet-600 via-purple-600 to-fuchsia-600',
  cyan:   'from-cyan-600 via-sky-600 to-blue-600',
}

const ACCENT_BUTTON: Record<Accent, string> = {
  indigo: 'bg-indigo-600 hover:bg-indigo-700 shadow-indigo-600/30',
  purple: 'bg-purple-600 hover:bg-purple-700 shadow-purple-600/30',
  cyan:   'bg-cyan-600 hover:bg-cyan-700 shadow-cyan-600/30',
}

/** Coloured header band: icon chip, title, optional subtitle and actions. */
export function FormHeader({
  accent = 'indigo', icon, title, subtitle, actions,
}: {
  accent?: Accent
  icon: React.ReactNode
  title: string
  subtitle?: string | null
  actions?: React.ReactNode
}) {
  return (
    <div className={`flex items-center gap-2.5 px-3.5 sm:px-4 py-2.5 bg-gradient-to-r ${ACCENT_HEADER[accent]}`}>
      <div className="w-7 h-7 rounded-lg bg-white/20 backdrop-blur-sm flex items-center justify-center text-white flex-shrink-0 [&>svg]:w-[15px] [&>svg]:h-[15px]">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-bold text-white leading-tight truncate">{title}</p>
        {subtitle && <p className="text-[10px] text-white/80 truncate mt-0.5">{subtitle}</p>}
      </div>
      {actions}
    </div>
  )
}

/** Header icon button — sits on the coloured band. */
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
      className="w-7 h-7 flex-shrink-0 flex items-center justify-center rounded-full text-white/85 hover:text-white hover:bg-white/20 active:scale-90 transition-all disabled:opacity-50 [&>svg]:w-[15px] [&>svg]:h-[15px]"
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
  accent = 'indigo', onCancel, submitLabel, submitIcon, disabled,
}: {
  accent?: Accent
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
        className={`flex-1 flex items-center justify-center gap-1.5 px-4 py-2 rounded-full text-xs font-bold text-white shadow-md transition-all active:scale-[0.98] disabled:opacity-50 disabled:shadow-none [&_svg]:w-[14px] [&_svg]:h-[14px] ${ACCENT_BUTTON[accent]}`}
      >
        {submitIcon}
        {submitLabel}
      </button>
    </div>
  )
}
