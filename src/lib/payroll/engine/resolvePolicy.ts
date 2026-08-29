// ============================================================================
// Policy and calendar resolution.
// ----------------------------------------------------------------------------
// Generalises the pattern the attendance module already uses for late/checkout
// cutoff overrides (`resolveLateCutoff`, src/lib/attendance.ts) so that LOP
// rules, leave treatment and working calendars can differ per cohort of staff
// the same way cutoffs already do.
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

/** The shape both policy groups and calendars share, so one resolver serves both. */
interface Scopeable {
  id: string
  name: string
  isDefault: boolean
  priority: number
  effectiveFrom: string
  effectiveTo: string | null
  memberIds: string[]
  match: { categories?: string[]; departments?: string[]; designations?: string[] } | null
}

function activeOn<T extends Scopeable>(items: T[], onDate: string): T[] {
  return items.filter(i => i.effectiveFrom <= onDate && (i.effectiveTo === null || i.effectiveTo >= onDate))
}

function byPriority<T extends Scopeable>(a: T, b: T): number {
  if (b.priority !== a.priority) return b.priority - a.priority
  return b.effectiveFrom.localeCompare(a.effectiveFrom)
}

function matches(item: Scopeable, employee: EngineEmployee): boolean {
  const m = item.match
  if (!m) return false
  // An empty match object selects nobody. Selecting everybody is what
  // `isDefault` is for, and conflating the two makes a half-filled form
  // silently capture the whole school.
  const clauses: boolean[] = []
  if (m.categories?.length) clauses.push(m.categories.includes(employee.category))
  if (m.departments?.length) clauses.push(!!employee.department && m.departments.includes(employee.department))
  if (m.designations?.length) clauses.push(!!employee.designation && m.designations.includes(employee.designation))
  return clauses.length > 0 && clauses.every(Boolean)
}

export interface Resolution<T> {
  item: T | null
  source: PolicySource
}

/**
 * Pick the one item in `items` that governs `employee` on `onDate`.
 * `fallbackName` is used only when nothing at all applies.
 */
export function resolveScoped<T extends Scopeable>(
  items: T[],
  employee: EngineEmployee,
  onDate: string,
  fallbackName: string,
): Resolution<T> {
  const live = activeOn(items, onDate)
  const nonDefault = live.filter(i => !i.isDefault).sort(byPriority)

  const explicit = nonDefault.find(i => i.memberIds.includes(employee.id))
  if (explicit) {
    return {
      item: explicit,
      source: {
        groupId: explicit.id,
        groupName: explicit.name,
        rank: 'explicit',
        priority: explicit.priority,
        why: `${employee.name} is listed as a member of "${explicit.name}" (priority ${explicit.priority}).`,
      },
    }
  }

  const matched = nonDefault.find(i => i.memberIds.length === 0 && matches(i, employee))
  if (matched) {
    return {
      item: matched,
      source: {
        groupId: matched.id,
        groupName: matched.name,
        rank: 'matched',
        priority: matched.priority,
        why: `"${matched.name}" matches this employee's ${describeMatch(matched)} (priority ${matched.priority}).`,
      },
    }
  }

  const fallback = live.filter(i => i.isDefault).sort(byPriority)[0]
  if (fallback) {
    return {
      item: fallback,
      source: {
        groupId: fallback.id,
        groupName: fallback.name,
        rank: 'default',
        priority: fallback.priority,
        why: `No specific group applies, so the school-wide default "${fallback.name}" is used.`,
      },
    }
  }

  return {
    item: null,
    source: {
      groupId: '',
      groupName: fallbackName,
      rank: 'builtin',
      priority: -1,
      why: `Nothing is configured, so the built-in ${fallbackName} is used.`,
    },
  }
}

function describeMatch(item: Scopeable): string {
  const m = item.match
  if (!m) return 'attributes'
  const parts: string[] = []
  if (m.categories?.length) parts.push(`category (${m.categories.join(', ')})`)
  if (m.departments?.length) parts.push(`department (${m.departments.join(', ')})`)
  if (m.designations?.length) parts.push(`designation (${m.designations.join(', ')})`)
  return parts.join(' and ') || 'attributes'
}

/**
 * Everyone who could plausibly claim this employee, in precedence order.
 * The policies screen uses this for its coverage check: two groups at the same
 * priority both claiming the same person is a configuration bug the admin needs
 * told about, not something to resolve silently by array order.
 */
export function explainCoverage<T extends Scopeable>(
  items: T[],
  employee: EngineEmployee,
  onDate: string,
): { item: T; rank: 'explicit' | 'matched' | 'default'; priority: number }[] {
  const live = activeOn(items, onDate)
  const out: { item: T; rank: 'explicit' | 'matched' | 'default'; priority: number }[] = []
  for (const i of live) {
    if (!i.isDefault && i.memberIds.includes(employee.id)) out.push({ item: i, rank: 'explicit', priority: i.priority })
    else if (!i.isDefault && i.memberIds.length === 0 && matches(i, employee)) out.push({ item: i, rank: 'matched', priority: i.priority })
    else if (i.isDefault) out.push({ item: i, rank: 'default', priority: i.priority })
  }
  const order = { explicit: 0, matched: 1, default: 2 }
  return out.sort((a, b) => (order[a.rank] - order[b.rank]) || (b.priority - a.priority))
}

/** True when two or more groups tie at the top — an ambiguity the admin must break by hand. */
export function hasAmbiguousCoverage<T extends Scopeable>(
  items: T[], employee: EngineEmployee, onDate: string,
): boolean {
  const cov = explainCoverage(items, employee, onDate)
  if (cov.length < 2) return false
  return cov[0].rank === cov[1].rank && cov[0].priority === cov[1].priority
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
