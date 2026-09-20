// Shared visual tokens for the Payroll module. Deliberately the same zinc +
// honey-gold palette as the Salary Manager and Fee Manager (see
// src/components/salary/adminUi.ts) so the admin hubs read as one system rather
// than three products that happened to land in the same app.

import type { RunStatus } from '@/lib/payroll/engine/workflow'

export const PUI = {
  card: 'bg-white border border-[#E4E4E7] rounded-xl',
  input: 'w-full bg-white border border-[#E4E4E7] rounded-lg px-3 py-2 text-sm text-[#27272A] placeholder:text-[#A1A1AA] focus:outline-none focus:border-[#27272A] transition-colors',
  label: 'text-[10px] font-bold uppercase tracking-widest text-[#71717A]',
  darkBtn: 'inline-flex items-center justify-center gap-1.5 bg-[#27272A] hover:bg-[#18181B] text-white text-xs font-semibold px-3 py-2 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
  ghostBtn: 'inline-flex items-center justify-center gap-1.5 bg-white border border-[#E4E4E7] text-[#71717A] hover:text-[#27272A] hover:border-[#D4D4D8] text-xs font-semibold px-3 py-2 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
  dangerBtn: 'inline-flex items-center justify-center gap-1.5 bg-white border border-rose-200 text-rose-600 hover:bg-rose-50 text-xs font-semibold px-3 py-2 rounded-lg transition-colors disabled:opacity-50',
} as const

export const GOLD = '#B8983C'

/** Where each state sits on the rail, and how it reads once reached. */
export const STATUS_CHIP: Record<RunStatus, string> = {
  draft:            'bg-[#F4F4F5] text-[#71717A] border border-[#E4E4E7]',
  review:           'bg-[#F4F4F5] text-[#52525B] border border-[#E4E4E7]',
  calculated:       'bg-sky-50 text-sky-700 border border-sky-200',
  exceptions:       'bg-amber-50 text-amber-800 border border-amber-200',
  pending_approval: 'bg-[#FBF6E9] text-[#8A6D1F] border border-[#EFE3C4]',
  approved:         'bg-violet-50 text-violet-700 border border-violet-200',
  locked:           'bg-[#27272A] text-white border border-[#27272A]',
  paid:             'bg-emerald-50 text-emerald-700 border border-emerald-200',
  reconciled:       'bg-emerald-600 text-white border border-emerald-600',
}

export const SEVERITY_CHIP: Record<'block' | 'warn' | 'info', string> = {
  block: 'bg-rose-50 text-rose-700 border border-rose-200',
  warn:  'bg-amber-50 text-amber-800 border border-amber-200',
  info:  'bg-sky-50 text-sky-700 border border-sky-200',
}

export const SEVERITY_LABEL: Record<'block' | 'warn' | 'info', string> = {
  block: 'Blocking', warn: 'Warning', info: 'For information',
}

/** ₹ with Indian digit grouping. Mirrors formatINR in the bus module. */
export function inr(n: number, withPaise = false): string {
  return `₹${(Number(n) || 0).toLocaleString('en-IN', {
    minimumFractionDigits: withPaise ? 2 : 0,
    maximumFractionDigits: withPaise ? 2 : 0,
  })}`
}

/** A signed amount, for variance and deltas. */
export function inrDelta(n: number): string {
  const v = Number(n) || 0
  return `${v > 0 ? '+' : v < 0 ? '−' : ''}${inr(Math.abs(v))}`
}

export function deltaColor(n: number): string {
  return n > 0 ? 'text-emerald-600' : n < 0 ? 'text-rose-600' : 'text-[#71717A]'
}
