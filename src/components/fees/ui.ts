// Shared visual tokens for the Fee module.
//
// The transport app's glass language, squared for records. Two rules:
//
//   Large surfaces — panels, lists, tiles, popups — have square corners. A fee
//   register is a ledger, and straight edges let dense rows and hairlines sit
//   flush the way a printed account book does.
//
//   Controls — buttons, segments, filters, inputs, chips — are rounded, the
//   iOS capsule. They are what a finger presses, and the round shape is how the
//   page says so.
//
// `ADMIN` keeps the key names the fee screens already call (`card`, `label`,
// `darkBtn`…) so every screen and sheet in the module re-skins from here.

/**
 * Cancels the page gutter so a list reaches both edges of a phone screen. The
 * fee pages use a 1rem gutter (`px-4`) at every width below `sm`, matching it.
 */
export const BLEED = '-mx-4 sm:mx-0'

/** A column heading, a field name, a tile caption. Sentence case, quiet. */
export const LABEL = 'text-[11.5px] font-medium text-slate-500'

/**
 * The module's type scale:
 *
 *   10.5px  a status chip
 *   11.5px  a label, a second line: a class, a date, a method, a bill number
 *   12.5px  a button, a figure in a row
 *   13.5px  a row's subject, a form field, a sentence
 *   15px    a panel heading
 *   20px+   the one figure a tile is about
 */
export const ADMIN = {
  /** A raised sheet of content. Square, solid, hairlined. */
  card: 'fx-card',
  /** Search input, with room for a leading icon and a trailing clear. */
  input: 'w-full h-9 rounded-[10px] bg-white border border-[#DDD8CC] pl-8 pr-8 text-[13.5px] text-slate-900 placeholder:text-slate-400 shadow-[inset_0_1px_2px_rgba(15,23,42,.04)] focus:outline-none focus:border-[#B8983C] focus:ring-2 focus:ring-[#B8983C]/20 transition',
  /** Plain form field. */
  inputPlain: 'w-full min-h-9 rounded-[10px] bg-white border border-[#DDD8CC] px-3 py-[7px] text-[13.5px] text-slate-900 placeholder:text-slate-400 shadow-[inset_0_1px_2px_rgba(15,23,42,.04)] focus:outline-none focus:border-[#B8983C] focus:ring-2 focus:ring-[#B8983C]/20 transition disabled:bg-slate-50 disabled:text-slate-400',
  /** The name above a field, or a caption. */
  label: LABEL,
  darkBtn: 'inline-flex items-center justify-center gap-1.5 h-8 px-3.5 rounded-full text-[12.5px] font-semibold text-white whitespace-nowrap bg-gradient-to-b from-[#3D3B40] to-[#27272A] shadow-[inset_0_1px_0_rgba(255,255,255,.16),0_6px_14px_-8px_rgba(15,23,42,.6)] hover:from-[#46444A] hover:to-[#2E2E31] active:scale-[0.97] transition disabled:opacity-45 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B8983C]/60',
  ghostBtn: 'inline-flex items-center justify-center gap-1.5 h-8 px-3.5 rounded-full text-[12.5px] font-semibold text-slate-700 whitespace-nowrap bg-white border border-[#E2DDD2] shadow-[0_1px_2px_rgba(15,23,42,.05)] hover:text-slate-900 hover:border-[#CFC8B8] active:scale-[0.97] transition disabled:opacity-45 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B8983C]/60',
  /** The one action a view is about — collecting, issuing. Used once per view. */
  goldBtn: 'inline-flex items-center justify-center gap-1.5 h-8 px-3.5 rounded-full text-[12.5px] font-semibold text-white whitespace-nowrap flex-shrink-0 bg-gradient-to-b from-[#C7A84C] to-[#A9892F] shadow-[inset_0_1px_0_rgba(255,255,255,.25),0_6px_14px_-8px_rgba(122,98,32,.7)] hover:from-[#CDAF55] hover:to-[#9E8029] active:scale-[0.97] transition disabled:opacity-45 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B8983C]/60',
  /** A small quiet button in a panel's heading row. */
  onDarkBtn: 'inline-flex items-center justify-center gap-1 h-7 px-2.5 rounded-full text-[12px] font-semibold text-slate-700 whitespace-nowrap bg-white border border-[#E2DDD2] hover:text-slate-900 hover:border-[#CFC8B8] active:scale-[0.97] transition disabled:opacity-45 disabled:pointer-events-none',
  /** A native picker sized to its contents, level with the search field. */
  select: 'h-9 rounded-full bg-white border border-[#DDD8CC] pl-3 pr-2 text-[13px] font-medium text-slate-800 focus:outline-none focus:border-[#B8983C] focus:ring-2 focus:ring-[#B8983C]/20 transition cursor-pointer',
} as const

export const GOLD = '#B8983C'

/** The icon square in a fee popup's header: charcoal into bronze, white mark. */
export const FEE_ICON = 'text-white [background:linear-gradient(135deg,#3D3B40,#8B6F47)]'

/** A status chip's frame; the tone classes below fill it. */
export const CHIP = 'inline-flex items-center gap-1 h-5 px-2 rounded-full text-[10.5px] font-semibold leading-none whitespace-nowrap'

/** Where an invoice sits in its life. */
export const INVOICE_CHIP: Record<string, string> = {
  draft:       `${CHIP} bg-slate-100 text-slate-600`,
  pending:     `${CHIP} bg-slate-100 text-slate-700`,
  partly_paid: `${CHIP} bg-[#FBF1D6] text-[#7A5D12]`,
  paid:        `${CHIP} bg-[#E6F2EA] text-[#1F6B42]`,
  overdue:     `${CHIP} bg-[#FBE7E7] text-[#A93232]`,
  cancelled:   `${CHIP} bg-zinc-200/80 text-zinc-600`,
}

export const INVOICE_LABEL: Record<string, string> = {
  draft: 'Draft', pending: 'Unpaid', partly_paid: 'Partly paid',
  paid: 'Paid', overdue: 'Overdue', cancelled: 'Cancelled',
}

export const STRUCTURE_CHIP: Record<string, string> = {
  draft:     `${CHIP} bg-slate-100 text-slate-600`,
  published: `${CHIP} bg-[#E6F2EA] text-[#1F6B42]`,
  archived:  `${CHIP} bg-zinc-200/80 text-zinc-600`,
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

/** '2026-04-10' → '10 Apr'. For a row where the session already names the year. */
export function fmtDay(iso: string | null | undefined): string {
  if (!iso) return '—'
  const [, m, d] = iso.slice(0, 10).split('-')
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const mi = Number(m) - 1
  if (!months[mi]) return iso
  return `${Number(d)} ${months[mi]}`
}
