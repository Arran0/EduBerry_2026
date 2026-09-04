// ─────────────────────────────────────────────────────────────────────────────
// Which price list applies to this student, and why.
//
// The `why` is not decoration. A parent asking "why is my child charged more
// than her classmate?" deserves an answer better than "the system decided", and
// the office needs to give it without reading SQL. This mirrors payroll's
// `resolvePolicy`, where making the reason a required return field is what
// stopped an unexplainable answer from ever being possible.
// ─────────────────────────────────────────────────────────────────────────────

import type {
  FeeGroup, FeeStructure, Provenance, ResolvedStructure, StudentContext,
} from './types'

/** Grades are numbers, but pre-primary ones are negative — see src/lib/grades.ts. */
function gradeLabel(grade: number | null): string {
  if (grade === null) return '—'
  if (grade === -3) return 'Pre-KG'
  if (grade === -2) return 'LKG'
  if (grade === -1) return 'UKG'
  return String(grade)
}

export class NoStructureError extends Error {
  readonly studentId: string
  readonly groupCode: string | null
  constructor(studentId: string, groupCode: string | null, message: string) {
    super(message)
    this.name = 'NoStructureError'
    this.studentId = studentId
    this.groupCode = groupCode
  }
}

/**
 * Resolve a student to a structure, most specific first:
 *
 *   0  their assigned group, their exact grade
 *   1  their assigned group, the all-grades structure
 *   2  the default group, their exact grade
 *   3  the default group, the all-grades structure
 *
 * Draft and archived structures are never chosen. A school builds next year's
 * prices in draft for weeks; billing from one by accident is the failure this
 * prevents.
 */
export function resolveStructure(
  student: StudentContext,
  groups: FeeGroup[],
  structures: FeeStructure[],
): ResolvedStructure {
  const publishedOnly = structures.filter(s => s.status === 'published')

  const assigned = student.feeGroupId
    ? groups.find(g => g.id === student.feeGroupId) ?? null
    : null
  const fallback = groups.find(g => g.isDefault) ?? null

  // Built by pushing rather than a filtered literal: `[a && x, b && y].filter(Boolean)`
  // does not narrow in TypeScript, and the cast that hides it would also hide a
  // real null slipping through.
  interface Attempt { group: FeeGroup; exactGrade: boolean; source: Provenance }
  const attempts: Attempt[] = []

  if (assigned) {
    attempts.push({
      group: assigned, exactGrade: true,
      source: {
        rank: 0,
        why: `Assigned to the ${assigned.name} group, which prices grade ${gradeLabel(student.grade)} separately.`,
      },
    })
    attempts.push({
      group: assigned, exactGrade: false,
      source: {
        rank: 1,
        why: `Assigned to the ${assigned.name} group, which uses one structure for every grade.`,
      },
    })
  }

  if (fallback) {
    const because = assigned
      ? `The ${assigned.name} group has no structure, so the default ${fallback.name} group`
      : `Not assigned to a fee group, so the default ${fallback.name} group`
    attempts.push({
      group: fallback, exactGrade: true,
      source: { rank: 2, why: `${because}'s grade ${gradeLabel(student.grade)} structure applies.` },
    })
    attempts.push({
      group: fallback, exactGrade: false,
      source: { rank: 3, why: `${because}'s all-grades structure applies.` },
    })
  }

  for (const attempt of attempts) {
    const match = publishedOnly.find(s =>
      s.feeGroupId === attempt.group.id &&
      (attempt.exactGrade ? s.grade === student.grade : s.grade === null))
    if (match) return { structure: match, group: attempt.group, source: attempt.source }
  }

  const groupName = assigned?.name ?? fallback?.name ?? null
  throw new NoStructureError(
    student.studentId,
    assigned?.code ?? fallback?.code ?? null,
    groupName
      ? `No published fee structure covers grade ${gradeLabel(student.grade)} in the ${groupName} group.`
      : 'No fee groups exist for this academic year, so no structure could be resolved.',
  )
}

/**
 * The same resolution, but returning null instead of throwing.
 *
 * Bulk screens need to show "412 will be billed, 6 skipped because no structure
 * covers them" rather than stopping at the first student who has none.
 */
export function tryResolveStructure(
  student: StudentContext,
  groups: FeeGroup[],
  structures: FeeStructure[],
): { ok: true; resolved: ResolvedStructure } | { ok: false; reason: string } {
  try {
    return { ok: true, resolved: resolveStructure(student, groups, structures) }
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : 'Could not resolve a fee structure' }
  }
}
