// Pre-primary grades are stored as negative integers so they sort before
// Grade 1-12 and require no database migration (profiles.grade is a plain
// INTEGER/SMALLINT column with no range constraint).
export const PRE_KG = -3
export const LKG = -2
export const UKG = -1

const PRE_PRIMARY_LABELS: Record<number, string> = {
  [PRE_KG]: 'Pre-KG',
  [LKG]: 'LKG',
  [UKG]: 'UKG',
}

export interface GradeOption {
  value: number
  label: string
}

export const GRADE_OPTIONS: GradeOption[] = [
  { value: PRE_KG, label: 'Pre-KG' },
  { value: LKG, label: 'LKG' },
  { value: UKG, label: 'UKG' },
  ...Array.from({ length: 12 }, (_, i) => ({ value: i + 1, label: `Grade ${i + 1}` })),
]

/** Human-readable label for a stored grade value, e.g. -1 → "UKG", 5 → "Grade 5". */
export function gradeLabel(grade: number | null | undefined): string {
  if (grade === null || grade === undefined) return ''
  return PRE_PRIMARY_LABELS[grade] ?? `Grade ${grade}`
}

/** Compact label for tight UI (grade chips/table cells), e.g. -1 → "UKG", 5 → "G5". */
export function gradeShortLabel(grade: number | null | undefined): string {
  if (grade === null || grade === undefined) return ''
  return PRE_PRIMARY_LABELS[grade] ?? `G${grade}`
}

/**
 * Parses a free-form grade cell/input into a stored grade value.
 * - A value starting with p/P → Pre-KG, l/L → LKG, u/U → UKG (checked before
 *   number parsing so those short codes always win).
 * - Otherwise the first number found in the text is used (so "Grade 10",
 *   "10", "Std 10" all resolve to 10), validated to the 1-12 range.
 */
export function parseGradeInput(raw: unknown): number | undefined {
  if (raw === null || raw === undefined || raw === '') return undefined
  if (typeof raw === 'number') {
    return raw >= 1 && raw <= 12 ? raw : undefined
  }
  const s = String(raw).trim()
  if (!s) return undefined

  const first = s[0].toLowerCase()
  if (first === 'p') return PRE_KG
  if (first === 'l') return LKG
  if (first === 'u') return UKG

  const match = s.match(/\d+/)
  if (!match) return undefined
  const n = parseInt(match[0], 10)
  return n >= 1 && n <= 12 ? n : undefined
}
