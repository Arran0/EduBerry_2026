// Shared admin-aesthetic tokens for the Salary Manager — zinc + honey gold,
// sharp cards. Mirrors the Fee Manager (/more/fees) so the two admin hubs feel
// like one system.
export const ADMIN = {
  card: 'bg-white border border-[#E4E4E7] rounded-xl',
  // Search input with room for a left icon + right clear button.
  input: 'w-full bg-white border border-[#E4E4E7] rounded-lg pl-9 pr-9 py-2.5 text-sm text-[#27272A] placeholder:text-[#A1A1AA] focus:outline-none focus:border-[#27272A] transition-colors',
  // Plain input (no leading icon) for forms.
  inputPlain: 'w-full bg-white border border-[#E4E4E7] rounded-lg px-3 py-2 text-sm text-[#27272A] placeholder:text-[#A1A1AA] focus:outline-none focus:border-[#27272A] transition-colors',
  label: 'text-[10px] font-bold uppercase tracking-widest text-[#71717A]',
  darkBtn: 'flex items-center justify-center gap-1.5 bg-[#27272A] hover:bg-[#18181B] text-white text-xs font-semibold px-3 py-2 rounded-lg transition-colors disabled:opacity-50',
  ghostBtn: 'flex items-center justify-center gap-1.5 bg-white border border-[#E4E4E7] text-[#71717A] hover:text-[#27272A] hover:border-[#D4D4D8] text-xs font-semibold px-3 py-2 rounded-lg transition-colors disabled:opacity-50',
} as const

// Honey-gold accent used on dark surfaces (icons, highlights).
export const ADMIN_GOLD = '#B8983C'

// Status chips, restyled into the zinc palette (shared across cycle + record states).
export const CYCLE_CHIP: Record<'open' | 'closed', string> = {
  open: 'bg-[#F4F4F5] text-[#71717A] border border-[#E4E4E7]',
  closed: 'bg-[#27272A] text-white border border-[#27272A]',
}

// The stored status values stay 'open'/'closed'; the interface speaks of
// locking and unlocking a cycle, which reads better next to the padlock
// control and makes the consequence ("nothing more can change") obvious.
export const CYCLE_STATUS_LABEL: Record<'open' | 'closed', string> = {
  open: 'Unlocked',
  closed: 'Locked',
}

/** Shown once every record in a cycle has been paid out. */
export const PAID_CHIP = 'bg-emerald-50 text-emerald-700 border border-emerald-200'

/** Shown while a cycle still has records nobody has paid out yet. */
export const INCOMPLETE_CHIP = 'bg-[#FBF6E9] text-[#8A6D1F] border border-[#EFE3C4]'

export const RECORD_CHIP: Record<'draft' | 'approved' | 'paid', string> = {
  draft: 'bg-[#F4F4F5] text-[#71717A] border border-[#E4E4E7]',
  approved: 'bg-[#FBF6E9] text-[#8A6D1F] border border-[#EFE3C4]',
  paid: 'bg-[#27272A] text-white border border-[#27272A]',
}
