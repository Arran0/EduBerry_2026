// ============================================================================
// Cohort precedence — which configured group governs a given subject on a date.
// ----------------------------------------------------------------------------
// Extracted from src/lib/payroll/engine/resolvePolicy.ts, which invented this
// algorithm for staff policy groups and working calendars. Fees needs exactly
// the same precedence for fee structures over students, and the only part that
// actually differs is the predicate — payroll matches on category, department
// and designation; fees matches on grade, section, fee category and transport
// zone. So the algorithm lives here once and each module supplies its own
// matcher.
//
// Precedence, highest first:
//   1. a non-default group that lists this subject explicitly
//   2. a non-default group whose match rules select this subject
//   3. the default ("everyone") group
//   4. nothing — the caller's built-in fallback
//
// Within each band, higher `priority` wins; ties break on the more recent
// `effectiveFrom` so a newer group supersedes an older one of equal rank.
//
// The result always carries a `ScopeSource`. That is not decoration — an amount
// whose rule cannot be named is an amount the school cannot defend to the
// parent disputing it, and naming it is most of what makes this worth building.
// ============================================================================

/** How a group was reached. */
export type ScopeRank = 'explicit' | 'matched' | 'default' | 'builtin'

export interface ScopeSource {
  groupId: string
  groupName: string
  rank: ScopeRank
  priority: number
  why: string
}

/** The shape every scopeable group shares, whatever it is scoping. */
export interface Scopeable<M = unknown> {
  id: string
  name: string
  isDefault: boolean
  priority: number
  effectiveFrom: string
  effectiveTo: string | null
  memberIds: string[]
  match: M | null
}

/** The subject being scoped — a staff member, a student. */
export interface ScopeSubject {
  id: string
  name: string
}

/**
 * How a module decides whether its match rules select a subject, and how to say
 * so in a sentence a parent or an admin can read.
 */
export interface ScopeMatcher<M, S extends ScopeSubject> {
  matches(match: M, subject: S): boolean
  describe(match: M): string
}

function activeOn<T extends Scopeable<M>, M>(items: T[], onDate: string): T[] {
  return items.filter(i => i.effectiveFrom <= onDate && (i.effectiveTo === null || i.effectiveTo >= onDate))
}

function byPriority<T extends Scopeable<M>, M>(a: T, b: T): number {
  if (b.priority !== a.priority) return b.priority - a.priority
  return b.effectiveFrom.localeCompare(a.effectiveFrom)
}

function selects<T extends Scopeable<M>, M, S extends ScopeSubject>(
  item: T, subject: S, matcher: ScopeMatcher<M, S>,
): boolean {
  // An empty match object selects nobody. Selecting everybody is what
  // `isDefault` is for, and conflating the two makes a half-filled form
  // silently capture the whole school.
  return item.match !== null && matcher.matches(item.match, subject)
}

export interface Resolution<T> {
  item: T | null
  source: ScopeSource
}

/** Pick the one item in `items` that governs `subject` on `onDate`. */
export function resolveScope<T extends Scopeable<M>, M, S extends ScopeSubject>(
  items: T[],
  subject: S,
  onDate: string,
  matcher: ScopeMatcher<M, S>,
  fallbackName: string,
): Resolution<T> {
  const live = activeOn(items, onDate)
  const nonDefault = live.filter(i => !i.isDefault).sort(byPriority)

  const explicit = nonDefault.find(i => i.memberIds.includes(subject.id))
  if (explicit) {
    return {
      item: explicit,
      source: {
        groupId: explicit.id,
        groupName: explicit.name,
        rank: 'explicit',
        priority: explicit.priority,
        why: `${subject.name} is listed as a member of "${explicit.name}" (priority ${explicit.priority}).`,
      },
    }
  }

  const matched = nonDefault.find(i => i.memberIds.length === 0 && selects(i, subject, matcher))
  if (matched) {
    return {
      item: matched,
      source: {
        groupId: matched.id,
        groupName: matched.name,
        rank: 'matched',
        priority: matched.priority,
        why: `"${matched.name}" matches this ${describeSubject(subject)}'s ${matcher.describe(matched.match as M)} (priority ${matched.priority}).`,
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

/** Payroll's original wording said "employee"; keeping it generic reads fine for both. */
function describeSubject(_subject: ScopeSubject): string {
  return 'record'
}

/**
 * Everyone who could plausibly claim this subject, in precedence order.
 * The configuration screens use this for their coverage check: two groups at
 * the same priority both claiming the same person is a configuration bug the
 * admin needs told about, not something to resolve silently by array order.
 */
export function explainScopeCoverage<T extends Scopeable<M>, M, S extends ScopeSubject>(
  items: T[], subject: S, onDate: string, matcher: ScopeMatcher<M, S>,
): { item: T; rank: Exclude<ScopeRank, 'builtin'>; priority: number }[] {
  const live = activeOn(items, onDate)
  const out: { item: T; rank: Exclude<ScopeRank, 'builtin'>; priority: number }[] = []
  for (const i of live) {
    if (!i.isDefault && i.memberIds.includes(subject.id)) out.push({ item: i, rank: 'explicit', priority: i.priority })
    else if (!i.isDefault && i.memberIds.length === 0 && selects(i, subject, matcher)) out.push({ item: i, rank: 'matched', priority: i.priority })
    else if (i.isDefault) out.push({ item: i, rank: 'default', priority: i.priority })
  }
  const order = { explicit: 0, matched: 1, default: 2 }
  return out.sort((a, b) => (order[a.rank] - order[b.rank]) || (b.priority - a.priority))
}

/** True when two or more groups tie at the top — an ambiguity the admin must break by hand. */
export function hasAmbiguousScope<T extends Scopeable<M>, M, S extends ScopeSubject>(
  items: T[], subject: S, onDate: string, matcher: ScopeMatcher<M, S>,
): boolean {
  const cov = explainScopeCoverage(items, subject, onDate, matcher)
  if (cov.length < 2) return false
  return cov[0].rank === cov[1].rank && cov[0].priority === cov[1].priority
}
