// Shared visual tokens for the Fee module.
//
// The Salary Manager's vocabulary, not a second one: warm paper surfaces,
// hairline rules instead of shadow, and square corners so dense rows sit flush
// against each other. See `src/components/salary/ui.tsx`, which this follows.
//
// `ADMIN` keeps the key names the fee screens already call — `card`, `label`,
// `darkBtn` — and changes only what they resolve to. That is deliberate: it
// re-skins nine screens and a dozen sheets from one place, and it leaves the
// Salary Manager's own `ADMIN` (in adminUi.ts) untouched, so neither module
// can restyle the other by accident.

export { ADMIN_GOLD, SHARP } from '@/components/salary/adminUi'
export { LABEL, BLEED } from '@/components/salary/ui'

/**
 * The module's type scale. Eight sizes, each with one job:
 *
 *   9px     a state chip — uppercase, tracked
 *   9.5px   a micro-label — `ADMIN.label` / `LABEL`
 *   10.5px  a button — `ADMIN.darkBtn` / `ADMIN.ghostBtn`
 *   11px    a second line: a class, a date, a method, a reason, a bill number
 *   11.5px  a figure
 *   12.5px  a row's subject, a form field, a sentence of prose
 *   15px    a card or section heading
 *   17px    the one figure a panel is about
 *
 * None of them changes at a breakpoint. The module used to carry twenty-five
 * size expressions, thirteen of which were a phone size and a laptop size
 * glued together (`text-[13px] sm:text-sm`), so a name was 13px beside a 14px
 * date beside an 11px class and the same row read differently either side of
 * 640px. A list is easier to read when the sizes in it mean something, and
 * "which breakpoint am I" is not one of the things a size should mean.
 *
 * Above this sits one display size, the page title (`text-lg`), and below it
 * 10px for a chart's tick labels and a card's caption.
 */

export const ADMIN = {
  /** A raised surface. Square, hairlined, no shadow. */
  card: 'bg-white border border-[#E3DFD3]',
  /** Search input, with room for a leading icon and a trailing clear. */
  input: 'w-full bg-white border border-[#E3DFD3] pl-8 pr-8 py-[7px] text-[12.5px] text-[#18181B] placeholder:text-[#A8A395] focus:outline-none focus:border-[#27272A] transition-colors',
  /** Plain form field. */
  inputPlain: 'w-full bg-white border border-[#E3DFD3] px-2.5 py-[7px] text-[12.5px] text-[#18181B] placeholder:text-[#A8A395] focus:outline-none focus:border-[#27272A] transition-colors',
  /** The uppercase micro-label used for every field name and tile caption. */
  label: 'text-[9.5px] font-bold uppercase tracking-[0.12em] text-[#8C8878]',
  darkBtn: 'inline-flex items-center justify-center gap-1.5 bg-[#27272A] hover:bg-[#18181B] text-white border border-[#27272A] text-[10.5px] font-bold uppercase tracking-[0.08em] leading-none px-2.5 py-[7px] transition-colors disabled:opacity-40 disabled:pointer-events-none',
  ghostBtn: 'inline-flex items-center justify-center gap-1.5 bg-white text-[#52525B] hover:text-[#18181B] border border-[#E3DFD3] hover:border-[#C9C4B4] text-[10.5px] font-bold uppercase tracking-[0.08em] leading-none px-2.5 py-[7px] transition-colors disabled:opacity-40 disabled:pointer-events-none',
} as const

export const GOLD = '#B8983C'

/** Where an invoice sits in its life. */
export const INVOICE_CHIP: Record<string, string> = {
  draft:       'bg-[#F4F1E7] text-[#6B675A] border border-[#E3DFD3]',
  pending:     'bg-[#EEF2FB] text-[#3A5490] border border-[#CFDAEF]',
  partly_paid: 'bg-[#FAF3DF] text-[#7A6220] border border-[#E7D9AE]',
  paid:        'bg-[#EAF5EE] text-[#1F6B42] border border-[#C6E3D2]',
  overdue:     'bg-[#FCECEC] text-[#A93232] border border-[#EFCCCC]',
  cancelled:   'bg-[#27272A] text-white border border-[#27272A]',
}

export const INVOICE_LABEL: Record<string, string> = {
  draft: 'Draft', pending: 'Pending', partly_paid: 'Partly paid',
  paid: 'Paid', overdue: 'Overdue', cancelled: 'Cancelled',
}

export const STRUCTURE_CHIP: Record<string, string> = {
  draft:     'bg-[#F4F1E7] text-[#6B675A] border border-[#E3DFD3]',
  published: 'bg-[#EAF5EE] text-[#1F6B42] border border-[#C6E3D2]',
  archived:  'bg-[#E3DFD3] text-[#6B675A] border border-[#C9C4B4]',
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
