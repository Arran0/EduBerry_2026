'use client'

import React from 'react'
import { ChevronLeft, ChevronRight, Circle, CircleDot, CheckCircle2, MinusCircle } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { TaskStatus } from '@/lib/tasks'

// ──────────────────────────────────────────────────────────────
// The Task Manager's design kit.
//
// The same glass the Fees, Salary and Timetable modules use — square glass
// decks and sheets, capsule controls, the iOS grouped form, one popup sheet —
// so a task form and a payroll form are the same object. Only the identity
// differs: the task app's icon squares are amber, from its banner.
//
// The shared pieces are re-exported from here so every task screen imports
// its language from one file.
// ──────────────────────────────────────────────────────────────

export {
  Btn, Chip, Notice, FormGroup, FormRow, Switch, ConfirmModal, SX, LABEL, Panel, PanelHead,
  SearchField, Loading, Note, MenuPanel, MenuOption, useMenuDismiss, StatTile, Sheet, SheetHead, SheetRow,
} from '@/components/salary/ui'

const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B8983C]/60'

/** The amber square in a task popup's header (ModalShell `iconClassName`). */
export const TASK_ICON = 'text-white [background:linear-gradient(135deg,#B45309,#EA580C)]'

/** The page shell's width, shared with the other admin workspaces. */
export const SHELL = 'w-full mx-auto max-w-7xl 2xl:max-w-[1600px]'

/** The amber icon square, for deck headers. */
export function TaskIconChip({ icon: Icon, size = 'sm' }: { icon: LucideIcon; size?: 'sm' | 'md' }) {
  const box = size === 'sm' ? 'w-8 h-8' : 'w-10 h-10'
  return (
    <span className={`icon-chip ${box} flex-shrink-0`} style={{ background: 'linear-gradient(135deg, #B45309, #EA580C)' }}>
      <Icon size={size === 'sm' ? 15 : 17} className="relative z-10 text-white" />
    </span>
  )
}

/**
 * A glass deck: the surface a tab is worked on. Square, edge to edge on a
 * phone. The title wraps rather than truncating; the actions drop to their
 * own line when they no longer fit beside it.
 */
export function TaskDeck({ title, icon, actions, children, className = '', bodyClassName = '' }: {
  title?: React.ReactNode
  icon?: LucideIcon
  actions?: React.ReactNode
  children: React.ReactNode
  className?: string
  bodyClassName?: string
}) {
  return (
    <section className={`fx-deck fx-bleed min-w-0 ${className}`}>
      {(title || actions) && (
        // Above the body (the deck stacks its children at z-3), so a menu
        // opened from the header falls over the content rather than under it.
        <div className="!z-[5] flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-3 sm:px-4 pt-3 pb-2.5">
          {title && (
            <div className="flex items-center gap-2.5 min-w-0 flex-1 basis-[160px]">
              {icon && <TaskIconChip icon={icon} />}
              <h2 className="font-display text-[15.5px] sm:text-[17px] font-bold leading-snug text-slate-900 headline break-words min-w-0">
                {title}
              </h2>
            </div>
          )}
          {/* Without a title the actions are the header: they get the whole row. */}
          {actions && <div className={`flex flex-wrap items-center gap-1.5 max-w-full ${title ? '' : 'w-full'}`}>{actions}</div>}
        </div>
      )}
      <div className={`px-2.5 sm:px-3 pb-2.5 sm:pb-3 ${title || actions ? '' : 'pt-2.5 sm:pt-3'} ${bodyClassName}`}>
        {children}
      </div>
    </section>
  )
}

/** Previous / label / next in one capsule — the week, month and range pickers. */
export function Stepper({ label, onPrev, onNext, prevLabel, nextLabel, canNext = true, onLabelClick, labelTitle, className = '' }: {
  label: React.ReactNode
  onPrev: () => void
  onNext: () => void
  prevLabel: string
  nextLabel: string
  canNext?: boolean
  /** Pressing the label — e.g. "back to this week". */
  onLabelClick?: () => void
  labelTitle?: string
  className?: string
}) {
  const icon = `inline-flex items-center justify-center w-8 h-8 rounded-full flex-shrink-0 text-slate-500 hover:text-slate-900 hover:bg-slate-100 active:scale-95 transition disabled:opacity-35 disabled:pointer-events-none ${FOCUS}`
  const text = 'px-1 min-w-0 text-center text-[13px] font-semibold text-slate-900 leading-tight whitespace-nowrap'
  return (
    <div className={`lg-pill inline-flex items-center gap-0.5 p-1 min-w-0 max-w-full select-none ${className}`}>
      <button type="button" onClick={onPrev} aria-label={prevLabel} className={icon}>
        <ChevronLeft size={16} />
      </button>
      {onLabelClick ? (
        <button type="button" onClick={onLabelClick} title={labelTitle} className={`${text} rounded-full hover:text-[#8B6F47] ${FOCUS}`}>
          {label}
        </button>
      ) : (
        <span className={text}>{label}</span>
      )}
      <button type="button" onClick={onNext} disabled={!canNext} aria-label={nextLabel} className={icon}>
        <ChevronRight size={16} />
      </button>
    </div>
  )
}

/** A two-to-four-way choice, iOS style. Fills its row on a phone. */
export function Segmented<T extends string>({ value, onChange, options, className = '' }: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string }[]
  className?: string
}) {
  return (
    <span className={`inline-flex w-full sm:w-auto p-0.5 rounded-full bg-[rgba(118,118,128,0.12)] ${className}`} role="radiogroup">
      {options.map(o => {
        const on = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={`flex-1 sm:flex-none h-7 px-3 rounded-full text-[12.5px] font-semibold whitespace-nowrap transition ${FOCUS} ${
              on ? 'bg-white text-slate-900 shadow-[0_1px_3px_rgba(15,23,42,.18)]' : 'text-slate-500 hover:text-slate-800'}`}
          >
            {o.label}
          </button>
        )
      })}
    </span>
  )
}

/** One status, drawn the same in the grid, the day list and every popup. */
export function StatusMark({ status, requireCheck, size = 14 }: { status: TaskStatus; requireCheck: boolean; size?: number }) {
  if (status === 'dismissed') return <MinusCircle size={size} className="text-slate-400" />
  if (status === 'checked' || (status === 'done' && !requireCheck)) return <CheckCircle2 size={size} className="text-emerald-500" />
  if (status === 'done') return <CheckCircle2 size={size} className="text-yellow-500" />
  if (status === 'partial') return <CircleDot size={size} className="text-orange-600" />
  return <Circle size={size} className="text-slate-400" />
}

/** A small read-only fact on a popup: icon, value. Wraps rather than clipping. */
export function Fact({ icon: Icon, tone = 'neutral', children }: {
  icon: LucideIcon
  tone?: 'neutral' | 'amber' | 'violet' | 'blue' | 'indigo'
  children: React.ReactNode
}) {
  const tones = {
    neutral: 'bg-[#F4F1EA] text-slate-700',
    amber: 'bg-[#FBF1D6] text-[#7A5D12]',
    violet: 'bg-violet-50 text-violet-700',
    blue: 'bg-sky-50 text-sky-700',
    indigo: 'bg-indigo-50 text-indigo-700',
  }
  return (
    <span className={`inline-flex items-center gap-1.5 min-h-[28px] px-2.5 py-1 rounded-full text-[12px] font-medium leading-snug max-w-full ${tones[tone]}`}>
      <Icon size={13} className="flex-shrink-0" />
      <span className="min-w-0 break-words">{children}</span>
    </span>
  )
}

/** A heading inside a popup body, with an optional count and action. */
export function SubHead({ icon: Icon, children, count, right }: {
  icon?: LucideIcon
  children: React.ReactNode
  count?: React.ReactNode
  right?: React.ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 mb-1.5">
      <h3 className="flex items-center gap-1.5 min-w-0 text-[13px] font-semibold text-slate-900 leading-snug">
        {Icon && <Icon size={14} className="text-slate-500 flex-shrink-0" />}
        <span className="break-words min-w-0">{children}</span>
        {count != null && <span className="text-[12px] font-medium text-slate-400 tabular-nums">{count}</span>}
      </h3>
      {right}
    </div>
  )
}

/** An inline field with an add button — checklist items, quick additions. */
export const FIELD =
  'w-full min-w-0 h-10 sm:h-9 rounded-[10px] bg-white border border-[#DDD8CC] px-3 text-[13.5px] text-slate-900 placeholder:text-slate-400 shadow-[inset_0_1px_2px_rgba(15,23,42,.04)] focus:outline-none focus:border-[#B8983C] focus:ring-2 focus:ring-[#B8983C]/20 transition disabled:bg-slate-50 disabled:text-slate-400'

/** Date and time fields sized to their contents, so they sit beside their label on a phone. */
export const DATE_FIELD = `${FIELD} !w-[9.5rem] sm:!w-[10.5rem] !px-2.5`
export const TIME_FIELD = `${FIELD} !w-[7.25rem] sm:!w-[8rem] !px-2.5`

/** A control placed inside a FormRow: borderless, the row is the box. */
export const ROW_FIELD =
  'w-full min-w-0 bg-transparent border-0 p-0 py-1 text-[14px] text-right text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-0'

/**
 * Only http(s) links are ever rendered as a link. A comment's link attachment
 * is typed by whoever posts it, and `javascript:` in an href runs as the
 * person who clicks it.
 */
export function safeHref(url: string | null | undefined): string | undefined {
  if (!url) return undefined
  try {
    const u = new URL(url)
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : undefined
  } catch {
    return undefined
  }
}
