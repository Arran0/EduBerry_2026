/**
 * Report-card grade presentation — the CBSE-style letter band for a percentage,
 * the date format the cards print, and the rescaling both the total-conversion
 * column and an imported marksheet need. Shared by the academics Report Cards
 * section, the full-page academic record and the classroom marksheet.
 */

export interface GradeBand {
  letter: string
  /** Tailwind background class for the grade chip. */
  bg: string
  /** Tailwind text-colour class for the grade chip. */
  fg: string
}

/** Grade band for a percentage — green (A1) through red (E). */
export function gradeLetter(pct: number): GradeBand {
  if (pct >= 91) return { letter: 'A1', bg: 'bg-emerald-100', fg: 'text-emerald-700' }
  if (pct >= 81) return { letter: 'A2', bg: 'bg-green-100',   fg: 'text-green-700'   }
  if (pct >= 71) return { letter: 'B1', bg: 'bg-lime-100',    fg: 'text-lime-700'    }
  if (pct >= 61) return { letter: 'B2', bg: 'bg-yellow-100',  fg: 'text-yellow-700'  }
  if (pct >= 51) return { letter: 'C1', bg: 'bg-amber-100',   fg: 'text-amber-700'   }
  if (pct >= 41) return { letter: 'C2', bg: 'bg-orange-100',  fg: 'text-orange-700'  }
  if (pct >= 33) return { letter: 'D',  bg: 'bg-red-100',     fg: 'text-red-600'     }
  return               { letter: 'E',  bg: 'bg-red-100',     fg: 'text-red-700'     }
}

/**
 * A mark as a report card states it: the nearest whole number, halves up.
 *
 * Marks are entered and stored in halves (17.5 is by far the commonest
 * fraction), and rescaling a mark to a published total — see rescaleMark —
 * produces finer fractions still. None of that belongs on a card a student
 * reads, so every figure quoted *for one student* is rounded here before it is
 * shown: each assessment, each component, each subject total, the overall.
 *
 * Each figure is rounded from its own exact value rather than from the rounded
 * parts beneath it, so a total is always the faithful one. The cost is that a
 * split assessment's rounded components can add up to one more (or less) than
 * its rounded total — two halves that each round up. That is inherent to
 * rounding a breakdown, and the alternative is a total inflated by the display.
 *
 * Class *averages* are deliberately not rounded this way: a mean is not one
 * student's mark, and a whole number would throw away what it measures.
 */
export function roundMark(marks: number | null | undefined): number | null {
  if (marks == null || !isFinite(marks)) return null
  return Math.round(marks)
}

/** The percentage a card prints for a mark — computed from the *rounded*
 *  figures, so that dividing the two numbers on the page reproduces it. */
export function markPercent(obtained: number, max: number): number | null {
  const o = roundMark(obtained)
  const m = roundMark(max)
  if (o == null || m == null || m <= 0) return null
  return (o / m) * 100
}

/** "Mar 3, 2026" — falls back to the raw value if it will not parse. */
export function formatShortDate(d: string): string {
  try {
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  } catch { return d }
}

/**
 * Restates a mark against a different maximum, keeping the proportion: 45 out
 * of 50 shown out of 20 is 18.
 *
 * One function for two jobs that turn out to be the same arithmetic — the
 * "total conversion" column, which reports a mark at the scale a school
 * publishes it at, and the rescaling applied when a marksheet imported into a
 * component is given a different weight than it was marked at.
 *
 * Rounded to two decimals: a scaled mark is a reported figure, and a trailing
 * 18.799999999999997 helps nobody. Returns null for anything that cannot be
 * scaled (no mark, or a source maximum of zero).
 */
export function rescaleMark(
  marks: number | null | undefined,
  fromMax: number,
  toMax: number,
): number | null {
  if (marks == null || !isFinite(marks)) return null
  if (!isFinite(fromMax) || fromMax <= 0 || !isFinite(toMax) || toMax < 0) return null
  return Math.round((marks / fromMax) * toMax * 100) / 100
}
