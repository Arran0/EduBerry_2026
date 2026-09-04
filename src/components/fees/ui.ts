// Shared visual tokens for the Fee module.
//
// Deliberately the same zinc + honey-gold palette as the Salary Manager and the
// Payroll module — see src/components/salary/adminUi.ts, whose own comment
// already names the Fee Manager as part of the same system. Importing rather
// than redefining is what keeps that true.

export { ADMIN, ADMIN_GOLD, SHARP } from '@/components/salary/adminUi'

export const GOLD = '#B8983C'

/** Where an invoice sits in its life. */
export const INVOICE_CHIP: Record<string, string> = {
  draft:       'bg-[#F4F4F5] text-[#71717A] border border-[#E4E4E7]',
  pending:     'bg-sky-50 text-sky-700 border border-sky-200',
  partly_paid: 'bg-[#FBF6E9] text-[#8A6D1F] border border-[#EFE3C4]',
  paid:        'bg-emerald-50 text-emerald-700 border border-emerald-200',
  overdue:     'bg-rose-50 text-rose-700 border border-rose-200',
  cancelled:   'bg-[#27272A] text-white border border-[#27272A]',
}

export const INVOICE_LABEL: Record<string, string> = {
  draft: 'Draft', pending: 'Pending', partly_paid: 'Partly paid',
  paid: 'Paid', overdue: 'Overdue', cancelled: 'Cancelled',
}

export const STRUCTURE_CHIP: Record<string, string> = {
  draft:     'bg-[#F4F4F5] text-[#71717A] border border-[#E4E4E7]',
  published: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
  archived:  'bg-[#E4E4E7] text-[#52525B] border border-[#D4D4D8]',
}

/**
 * ₹ with Indian digit grouping, or dots when the caller may not see amounts.
 *
 * Every amount in the fee module renders through this. Passing `false` for
 * `visible` is not what hides the number — the server already withheld it and
 * this is showing that absence honestly rather than printing "₹0", which would
 * be a lie a clerk might act on.
 */
export function inr(value: number | string | null | undefined, visible = true): string {
  if (!visible || value === null || value === undefined) return '••••'
  const n = typeof value === 'string' ? Number(value) : value
  if (!Number.isFinite(n)) return '••••'
  return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`
}

export function inrPrecise(value: number | string | null | undefined, visible = true): string {
  if (!visible || value === null || value === undefined) return '••••'
  const n = typeof value === 'string' ? Number(value) : value
  if (!Number.isFinite(n)) return '••••'
  return `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** '2026-04-10' → '10 Apr 2026'. Dates stay strings; no Date parsing, no drift. */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const [y, m, d] = iso.slice(0, 10).split('-')
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const mi = Number(m) - 1
  if (!months[mi]) return iso
  return `${Number(d)} ${months[mi]} ${y}`
}
