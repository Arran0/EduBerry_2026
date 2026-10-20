// Shared admin tokens for the Salary Manager, under the names the salary and
// driver-payroll screens already import. They are the module's glass language
// (see ./ui.tsx): square sheets, capsule controls, sentence-case labels.
import { LABEL, SX } from '@/components/salary/ui'

export const ADMIN = {
  card: 'fx-card',
  // Search input with room for a left icon + right clear button.
  input: `${SX.field} pl-9 pr-9`,
  // Plain input (no leading icon) for forms.
  inputPlain: SX.field,
  label: LABEL,
  darkBtn: SX.dark,
  ghostBtn: SX.ghost,
} as const

// Honey-gold accent used on dark surfaces (icons, highlights).
export const ADMIN_GOLD = '#B8983C'

// Colour for a cycle's status chip. The frame (height, radius, type) comes
// from whoever draws the chip.
export const CYCLE_CHIP: Record<'open' | 'closed', string> = {
  open: 'bg-slate-100 text-slate-600',
  closed: 'bg-[#27272A] text-white',
}

// The stored status values stay 'open'/'closed'; the interface speaks of
// locking and unlocking a cycle, which reads better next to the padlock
// control and makes the consequence ("nothing more can change") obvious.
export const CYCLE_STATUS_LABEL: Record<'open' | 'closed', string> = {
  open: 'Unlocked',
  closed: 'Locked',
}

/** Shown once every record in a cycle has been paid out. */
export const PAID_CHIP = 'bg-[#E6F2EA] text-[#1F6B42]'

/**
 * The pay cycle sheet and its popups. Same language, one step denser: the
 * cycle page is a spreadsheet.
 */
export const SHARP = {
  card: 'fx-card',
  input: SX.field,
  darkBtn: SX.dark,
  ghostBtn: SX.ghost,
  /** A ghost button holding a non-default selection — the filter/sort chips. */
  activeBtn: SX.choice(true),
  label: LABEL,
} as const

/**
 * Where a cycle's gross outlay ends up — the three slices of the composition
 * bar in the stats strip. Net is the neutral remainder; the two withholdings
 * carry hue.
 *
 * Checked with the palette validator against a white surface: the indigo/rose
 * pair clears CVD separation (ΔE 25.4 protan) and the normal-vision floor, and
 * both clear 3:1 contrast. Every slice is also labelled with its own figure
 * beside the bar, so identity is never colour alone. Don't re-step these
 * without re-running the validator.
 */
export const OUTLAY_COLORS = {
  net: '#27272A',
  statutory: '#4338CA',
  lop: '#BE123C',
  bonus: '#15803D',
} as const
