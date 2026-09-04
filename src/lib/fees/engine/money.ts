// ─────────────────────────────────────────────────────────────────────────────
// Money, in paise.
//
// Fee arithmetic splits a total across installments, takes a percentage off it
// for a discount, adds a percentage back on as a late fee, and then has to
// reconcile to the rupee. Doing that in floating point produces bills that are
// off by a paisa and totals that do not equal the sum of their lines, which is
// the one defect a parent will always notice and never forgive.
//
// So: every amount inside the engine is an integer number of paise. Rupees
// appear only at the boundary, in `toPaise` on the way in and `toRupees` on the
// way out. The database stores NUMERIC(12,2), which is exact, so the conversion
// is lossless in both directions.
// ─────────────────────────────────────────────────────────────────────────────

/** An integer number of paise. 100 paise = ₹1. */
export type Paise = number

export const RUPEE = 100

/** Rupees (as stored in NUMERIC(12,2)) to paise. Rounds half away from zero. */
export function toPaise(rupees: number | string | null | undefined): Paise {
  const n = typeof rupees === 'string' ? Number(rupees) : (rupees ?? 0)
  if (!Number.isFinite(n)) return 0
  // Scale before rounding: (24000.005 * 100) is 2400000.4999... in binary
  // floating point, so round the scaled value rather than trusting the product.
  return Math.round(n * RUPEE + (n < 0 ? -1e-6 : 1e-6))
}

/** Paise back to rupees, for storing or displaying. */
export function toRupees(paise: Paise): number {
  return Math.round(paise) / RUPEE
}

/** Guards against a NaN or a fraction sneaking in from a caller. */
export function assertPaise(value: number, what = 'amount'): Paise {
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    throw new Error(`${what} must be a whole number of paise, got ${value}`)
  }
  return value
}

export function sum(values: Paise[]): Paise {
  return values.reduce((a, b) => a + b, 0)
}

export function clamp(value: Paise, min: Paise, max: Paise): Paise {
  return Math.min(Math.max(value, min), max)
}

/**
 * A percentage of an amount, rounded to the nearest paisa.
 *
 * Half-up rather than banker's rounding: Indian fee receipts and every
 * spreadsheet a school will check this against round half up, and being
 * consistently a paisa above a bursar's arithmetic is easier to explain than
 * being alternately above and below it.
 */
export function percentOf(amount: Paise, percent: number): Paise {
  if (!Number.isFinite(percent)) return 0
  const exact = (amount * percent) / 100
  return exact < 0 ? -Math.round(-exact) : Math.round(exact)
}

/**
 * Split an amount into `weights.length` parts in proportion to the weights,
 * with every paisa accounted for.
 *
 * The last part absorbs the rounding remainder, so the parts always sum back to
 * the original amount exactly. This is what makes a three-term 40/30/30 split
 * of ₹27,000 come to ₹27,000 and not ₹26,999.99.
 */
export function splitProportional(amount: Paise, weights: number[]): Paise[] {
  const total = weights.reduce((a, b) => a + b, 0)
  if (weights.length === 0) return []
  if (total <= 0) {
    // No weights to go on: put everything in the first slice rather than
    // silently dropping the money.
    return weights.map((_, i) => (i === 0 ? amount : 0))
  }

  const parts: Paise[] = []
  let allocated = 0
  for (let i = 0; i < weights.length - 1; i++) {
    const part = Math.round((amount * weights[i]) / total)
    parts.push(part)
    allocated += part
  }
  parts.push(amount - allocated)
  return parts
}

/**
 * Distribute an amount across a list of capped buckets, in order, taking as
 * much as each will hold before moving on.
 *
 * Payment allocation across invoices, and a late-fee cap, are both this.
 * Returns what each bucket took plus whatever is left over.
 */
export function waterfall(
  amount: Paise,
  capacities: Paise[],
): { taken: Paise[]; remainder: Paise } {
  let left = Math.max(0, amount)
  const taken = capacities.map(cap => {
    const take = Math.min(left, Math.max(0, cap))
    left -= take
    return take
  })
  return { taken, remainder: left }
}

/** ₹ with Indian digit grouping. Mirrors `inr` in src/components/payroll/ui.ts. */
export function formatPaise(paise: Paise, withPaise = false): string {
  const rupees = toRupees(paise)
  return `₹${rupees.toLocaleString('en-IN', {
    minimumFractionDigits: withPaise ? 2 : 0,
    maximumFractionDigits: withPaise ? 2 : 0,
  })}`
}
