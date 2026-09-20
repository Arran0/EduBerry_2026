/**
 * Report-card grade presentation — the CBSE-style letter band for a percentage,
 * and the date format the cards print. Shared by the academics Report Cards
 * section and the full-page academic record, which carried byte-identical
 * copies of both.
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

/** "Mar 3, 2026" — falls back to the raw value if it will not parse. */
export function formatShortDate(d: string): string {
  try {
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  } catch { return d }
}
