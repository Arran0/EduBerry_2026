/** Compact INR for stat tiles and chart read-outs: ₹1.2Cr / ₹5.8L / ₹42K / ₹940. */
export function fmtINR(amount: number): string {
  const n = Number(amount) || 0
  if (n >= 10000000) return '₹' + (n / 10000000).toFixed(1) + 'Cr'
  if (n >= 100000) return '₹' + (n / 100000).toFixed(1) + 'L'
  if (n >= 1000) return '₹' + (n / 1000).toFixed(0) + 'K'
  return '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 0 })
}

/**
 * The unabbreviated amount, for the `title` tooltip beside any compact value —
 * desktop users get the exact figure on hover rather than losing precision to
 * the abbreviation.
 */
export function fmtINRExact(amount: number): string {
  return '₹' + (Number(amount) || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })
}
