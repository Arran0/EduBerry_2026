// ============================================================================
// Money and rounding.
// ----------------------------------------------------------------------------
// Every amount in the engine is rupees as a `number`, matching the NUMERIC(10,2)
// columns the rest of the app already uses. Floating point is fine at this
// magnitude *provided* rounding happens at defined points rather than wherever
// it falls out, so this module is the only place that rounds.
//
// The rule that keeps payslips adding up: a component's amount is rounded when
// it is emitted, and every total is the sum of already-rounded components. A
// gross computed from unrounded parts and then rounded will occasionally differ
// from the printed lines by a paisa, and a teacher who adds up their own
// payslip will find it. This ordering makes that impossible.
// ============================================================================

/** Round to 2 decimal places, half away from zero (what a human doing this by hand does). */
export function round2(n: number): number {
  if (!Number.isFinite(n)) return 0
  const s = n < 0 ? -1 : 1
  return (s * Math.round(Math.abs(n) * 100 + Number.EPSILON * 100)) / 100
}

/** Round to whole rupees, half away from zero. Used where a rule says "rounded to the nearest rupee". */
export function round0(n: number): number {
  if (!Number.isFinite(n)) return 0
  const s = n < 0 ? -1 : 1
  return s * Math.round(Math.abs(n) + Number.EPSILON)
}

/** Always up to the next rupee — ESI employee/employer shares are computed this way by statute. */
export function ceilRupee(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.ceil(n - 1e-9)
}

export type RoundingMode = 'none' | 'nearest_rupee' | 'up_rupee' | 'down_rupee' | 'nearest_paisa'

export function applyRounding(n: number, mode: RoundingMode): number {
  switch (mode) {
    case 'nearest_rupee': return round0(n)
    case 'up_rupee': return ceilRupee(n)
    case 'down_rupee': return Math.floor(n + 1e-9)
    case 'none':
    case 'nearest_paisa':
    default: return round2(n)
  }
}

/** Sum a list of already-rounded amounts without reintroducing drift. */
export function sum(values: number[]): number {
  return round2(values.reduce((a, b) => a + b, 0))
}

/** Clamp into [lo, hi]. */
export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n))
}
