// ============================================================================
// Which fee structure governs a student on a date.
// ----------------------------------------------------------------------------
// The precedence algorithm is shared with payroll and lives in
// src/lib/scopeResolution.ts. All that belongs here is the fee-specific match
// predicate — grade, section, fee category, homeroom, transport zone — and the
// wording that explains a match to a parent.
// ============================================================================

import {
  resolveScope as resolveScopeGeneric,
  explainScopeCoverage,
  hasAmbiguousScope,
  type ScopeMatcher,
  type ScopeSource,
} from '@/lib/scopeResolution'
import type { FeeMatch, FeeStructureScope, StudentFeeContext } from './types'

/**
 * Every clause an admin fills in must hold. A group scoped to "grades 9–10,
 * section A" means both, not either — the school that wanted either would have
 * made two groups, and silently widening a half-filled form is how a discount
 * ends up applying to the whole school.
 */
export const FEE_MATCHER: ScopeMatcher<FeeMatch, StudentFeeContext> = {
  matches(m, student) {
    const clauses: boolean[] = []
    if (m.grades?.length) clauses.push(student.grade !== null && m.grades.includes(student.grade))
    if (m.sections?.length) clauses.push(!!student.section && m.sections.includes(student.section))
    if (m.categories?.length) clauses.push(!!student.feeCategory && m.categories.includes(student.feeCategory))
    if (m.homeroomIds?.length) clauses.push(student.homeroomIds.some(h => m.homeroomIds!.includes(h)))
    if (m.transportZones?.length) clauses.push(!!student.transportZone && m.transportZones.includes(student.transportZone))
    return clauses.length > 0 && clauses.every(Boolean)
  },

  describe(m) {
    const parts: string[] = []
    if (m.grades?.length) parts.push(`class (${m.grades.join(', ')})`)
    if (m.sections?.length) parts.push(`section (${m.sections.join(', ')})`)
    if (m.categories?.length) parts.push(`category (${m.categories.join(', ')})`)
    if (m.homeroomIds?.length) parts.push(`homeroom`)
    if (m.transportZones?.length) parts.push(`transport zone (${m.transportZones.join(', ')})`)
    return parts.join(' and ') || 'attributes'
  },
}

export interface StructureResolution {
  scope: FeeStructureScope | null
  source: ScopeSource
}

/** The structure scope that governs this student on `onDate`, and why. */
export function resolveStructureFor(
  scopes: FeeStructureScope[],
  student: StudentFeeContext,
  onDate: string,
): StructureResolution {
  const r = resolveScopeGeneric(scopes, student, onDate, FEE_MATCHER, 'no fee structure')
  return { scope: r.item, source: r.source }
}

/** Every scope that could claim this student, in precedence order. */
export function explainStructureCoverage(
  scopes: FeeStructureScope[],
  student: StudentFeeContext,
  onDate: string,
) {
  return explainScopeCoverage(scopes, student, onDate, FEE_MATCHER)
}

/**
 * Two scopes tying at the top. Worth blocking a demand run over: an ambiguous
 * fee structure means the bill depends on array order, and a school cannot
 * defend a number that was decided that way.
 */
export function hasAmbiguousStructure(
  scopes: FeeStructureScope[],
  student: StudentFeeContext,
  onDate: string,
): boolean {
  return hasAmbiguousScope(scopes, student, onDate, FEE_MATCHER)
}
