// ============================================================================
// Policy and calendar resolution.
// ----------------------------------------------------------------------------
// Generalises the pattern the attendance module already uses for late/checkout
// cutoff overrides (`resolveLateCutoff`, src/lib/attendance.ts) so that LOP
// rules, leave treatment and working calendars can differ per cohort of staff
// the same way cutoffs already do.
//
// The precedence algorithm itself now lives in src/lib/scopeResolution.ts,
// because the Fee Manager needs exactly the same one over students. What stays
// here is the only part that is actually about payroll: the match predicate
// (category, department, designation) and the built-in fallbacks.
//
// Precedence, highest first:
//   1. a non-default group that lists this employee explicitly
//   2. a non-default group whose match rules select this employee
//   3. the default ("everyone") group
//   4. the built-in fallback
//
// Within each band, higher `priority` wins; ties break on the more recent
// `effectiveFrom` so a newer policy supersedes an older one of equal rank.
//
// The result always carries a `PolicySource`. That is not decoration — a
// deduction whose rule cannot be named is a deduction the school cannot defend,
// and naming it is most of what makes this beat the incumbents.
// ============================================================================

import type {
  PolicyGroup, WorkingCalendar, PolicySource, EngineEmployee, PayrollPolicy,
} from './types'
import {
  resolveScope, explainScopeCoverage, hasAmbiguousScope,
  type Scopeable as ScopeableGroup, type ScopeMatcher,
} from '@/lib/scopeResolution'

/** What payroll match rules can select on. */
export type PayrollMatch = { categories?: string[]; departments?: string[]; designations?: string[] }

/** The shape both policy groups and calendars share, so one resolver serves both. */
type Scopeable = ScopeableGroup<PayrollMatch>

/**
 * Every clause an admin fills in must hold — a group scoped to "transport staff
 * in the Junior block" means both, not either.
 */
const PAYROLL_MATCHER: ScopeMatcher<PayrollMatch, EngineEmployee> = {
  matches(m, employee) {
    const clauses: boolean[] = []
    if (m.categories?.length) clauses.push(m.categories.includes(employee.category))
    if (m.departments?.length) clauses.push(!!employee.department && m.departments.includes(employee.department))
    if (m.designations?.length) clauses.push(!!employee.designation && m.designations.includes(employee.designation))
    return clauses.length > 0 && clauses.every(Boolean)
  },
  describe(m) {
    const parts: string[] = []
    if (m.categories?.length) parts.push(`category (${m.categories.join(', ')})`)
    if (m.departments?.length) parts.push(`department (${m.departments.join(', ')})`)
    if (m.designations?.length) parts.push(`designation (${m.designations.join(', ')})`)
    return parts.join(' and ') || 'attributes'
  },
}

export type { Resolution } from '@/lib/scopeResolution'

/**
 * Pick the one item in `items` that governs `employee` on `onDate`.
 * `fallbackName` is used only when nothing at all applies.
 */
export function resolveScoped<T extends Scopeable>(
  items: T[],
  employee: EngineEmployee,
  onDate: string,
  fallbackName: string,
) {
  return resolveScope(items, employee, onDate, PAYROLL_MATCHER, fallbackName)
}

/**
 * Everyone who could plausibly claim this employee, in precedence order.
 * The policies screen uses this for its coverage check: two groups at the same
 * priority both claiming the same person is a configuration bug the admin needs
 * told about, not something to resolve silently by array order.
 */
export function explainCoverage<T extends Scopeable>(
  items: T[], employee: EngineEmployee, onDate: string,
) {
  return explainScopeCoverage(items, employee, onDate, PAYROLL_MATCHER)
}

/** True when two or more groups tie at the top — an ambiguity the admin must break by hand. */
export function hasAmbiguousCoverage<T extends Scopeable>(
  items: T[], employee: EngineEmployee, onDate: string,
): boolean {
  return hasAmbiguousScope(items, employee, onDate, PAYROLL_MATCHER)
}

// ============================================
// Built-in fallbacks
// ============================================

/**
 * What applies when a school has configured nothing at all. Chosen to reproduce
 * the behaviour of the current `DEFAULT_PAYROLL_CALIBRATION` so that turning the
 * new engine on changes no numbers until someone deliberately configures a group.
 */
export const BUILTIN_POLICY: PayrollPolicy = {
  lop: {
    late: { freeCount: 3, tiers: [{ count: null, lopDaysEach: 0.5 }] },
    leave: { freeCount: 1, tiers: [{ count: null, lopDaysEach: 1 }] },
    halfDay: { freeCount: 0, tiers: [{ count: null, lopDaysEach: 0.5 }] },
  },
  leaveTreatment: {
    casual: 'paid', medical: 'paid', on_duty: 'paid', half_day: 'half', unapproved: 'lop',
  },
  lopBasis: 'calendar_days',
  fixedDays: 30,
  halfDayFraction: 0.5,
  lateGraceMinutes: 0,
  roundLopTo: 0.5,
  encashment: { rateBasis: 'basic', maxDays: 30, enabled: false },
  noticePeriodDays: 30,
  netRounding: 'nearest_rupee',
}

export const BUILTIN_CALENDAR: Omit<WorkingCalendar, 'id' | 'name' | 'memberIds' | 'match'> = {
  isDefault: true,
  priority: 0,
  effectiveFrom: '1900-01-01',
  effectiveTo: null,
  basis: 'calendar_days',
  fixedDays: 30,
  weekPattern: ['off', 'full', 'full', 'full', 'full', 'full', 'full'],
  nthWeekdayRules: [],
}

export function resolvePolicyFor(
  groups: PolicyGroup[], employee: EngineEmployee, onDate: string,
): { policy: PayrollPolicy; source: PolicySource } {
  const r = resolveScoped(groups, employee, onDate, 'default policy')
  return { policy: r.item ? r.item.policy : BUILTIN_POLICY, source: r.source }
}

export function resolveCalendarFor(
  calendars: WorkingCalendar[], employee: EngineEmployee, onDate: string,
): { calendar: WorkingCalendar; source: PolicySource } {
  const r = resolveScoped(calendars, employee, onDate, 'default calendar')
  const calendar: WorkingCalendar = r.item ?? {
    ...BUILTIN_CALENDAR, id: '', name: 'Built-in calendar', memberIds: [], match: null,
  }
  return { calendar, source: r.source }
}
