// ============================================================
// Asking the CP-SAT service the two questions it can answer.
//
// "Can this week be built at all, and if not, what exactly is stopping it" and
// "how much better can this week be". Neither is something the in-browser
// solver can answer: it searches, and a search that comes back empty-handed
// cannot tell you whether it was unlucky or whether you asked for something
// impossible.
//
// Everything here degrades to nothing. A deployment without the solver service
// configured gets a clear message and keeps every other feature, because
// Generate — the thing people use every day — does not depend on this at all.
// ============================================================

import {
  buildSolverPayload, buildSolverHint, materialisePlacements,
} from './solverPayload'
import type { SolverPayload, WirePlacement } from './solverPayload'
import type { GeneratorInput, PlacedEntry, Room, RoomType } from './types'
import { authHeader } from '../supabase'

/** One rule from a conflict, as the service reports it. */
export interface SolverConflict {
  /** Conflicts of the same group number cannot all hold at once. */
  group: number
  rule:
    | 'time_off' | 'consecutive_periods' | 'max_per_day' | 'room_capacity'
    | 'max_in_a_row' | 'class_teacher_pin' | 'required_periods' | 'limit'
  tag: string
  scope?: string
  id?: string
  homeroomId?: string
  subjectId?: string
  teacherId?: string
  roomType?: RoomType
  source?: string
  limitKind?: string
  period?: string
}

export interface SolverResult {
  status: 'feasible' | 'optimal' | 'impossible' | 'invalid' | 'unknown'
  placements: WirePlacement[]
  unplaced: string[]
  unplacedPeriods: number
  overCapPeriods: number
  penalty: number | null
  penaltyBound: number | null
  conflicts: SolverConflict[]
  conflictsTruncated: boolean
  wallTimeMs: number
  variables: number
  constraints: number
}

export type SolverOutcome =
  | { ok: true; result: SolverResult; payload: SolverPayload }
  | { ok: false; error: string }

async function call(
  mode: 'prove' | 'optimise',
  payload: SolverPayload,
  hint: Record<string, [number, number]> | null,
  budgetSeconds: number,
): Promise<SolverOutcome> {
  let response: Response
  try {
    response = await fetch('/api/timetable/solve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
      body: JSON.stringify({ mode, problem: payload, hint, budgetSeconds }),
    })
  } catch {
    return { ok: false, error: 'Could not reach the solver.' }
  }
  let body: { success?: boolean; error?: string; result?: SolverResult }
  try {
    body = await response.json()
  } catch {
    return { ok: false, error: `Solver returned ${response.status}.` }
  }
  if (!response.ok || !body.success || !body.result) {
    return { ok: false, error: body.error ?? `Solver returned ${response.status}.` }
  }
  return { ok: true, result: body.result, payload }
}

/**
 * Is a complete timetable possible for this configuration?
 *
 * Nothing about the current draft is sent beyond its pinned cells: the question
 * is about the rules, not about the week that happens to be on screen.
 */
export function proveFeasible(
  input: GeneratorInput,
  budgetSeconds = 45,
): Promise<SolverOutcome> {
  const payload = buildSolverPayload(input)
  return call('prove', payload, null, budgetSeconds)
}

/**
 * Improve the week that is already on screen.
 *
 * Always warm-started from the current draft, and the service is told to hold
 * its completeness: the result can place no fewer periods than what it was
 * given. Asked cold, CP-SAT spends its whole budget rediscovering a complete
 * timetable — the part the in-browser solver is already good at — and comes
 * back with a worse week than the one it replaced.
 */
export function improveWeek(
  input: GeneratorInput,
  entries: PlacedEntry[],
  budgetSeconds = 60,
): Promise<SolverOutcome> {
  const payload = buildSolverPayload(input)
  const hint = buildSolverHint(payload, entries)
  return call('optimise', payload, hint, budgetSeconds)
}

/** The improved week, as rows the grid and the save path already understand. */
export function entriesFromResult(
  payload: SolverPayload,
  result: SolverResult,
  rooms: Room[],
  homeroomIds: string[],
): PlacedEntry[] {
  return materialisePlacements(payload, result.placements, rooms, homeroomIds)
}

// ── Saying what a conflict means ─────────────────────────────

export interface ConflictNames {
  homeroom: (id: string) => string
  teacher: (id: string) => string
  subject: (id: string) => string
  /** The subject of a combined lesson, by the combined row's id. */
  combinedSubject: (id: string) => string | undefined
  /** A requirement, as "class / subject". */
  requirement: (id: string) => string | undefined
}

/**
 * One rule of a conflict, in words.
 *
 * The service deliberately returns ids rather than names — it has none — so
 * the naming happens here, where the workspace already has every class,
 * teacher and subject loaded.
 */
export function describeConflictRule(c: SolverConflict, names: ConflictNames): string {
  switch (c.rule) {
    case 'time_off': {
      const who =
        c.scope === 'subject' ? `${names.subject(c.id ?? '')} (subject)`
        : c.scope === 'homeroom' ? names.homeroom(c.id ?? '')
        : c.id === '*' ? 'every teacher'
        : names.teacher(c.id ?? '')
      return `the time off marked for ${who}`
    }
    case 'consecutive_periods': {
      const subject = names.combinedSubject(c.id ?? '') ?? names.requirement(c.id ?? '')
      return `running ${subject ?? 'that lesson'} as consecutive periods`
    }
    case 'max_per_day':
      return `the per-day limit on ${names.subject(c.subjectId ?? '')} for ${names.homeroom(c.homeroomId ?? '')}`
    case 'required_periods': {
      const what = c.source === 'combined'
        ? names.combinedSubject(c.id ?? '')
        : names.requirement(c.id ?? '')
      return `the periods asked for by ${what ?? 'that requirement'}`
    }
    case 'room_capacity':
      return `how many ${c.roomType?.replace(/_/g, ' ') ?? 'special'} rooms exist`
    case 'max_in_a_row':
      return `the consecutive-periods limit for ${
        c.teacherId === '*' ? 'every teacher' : names.teacher(c.teacherId ?? '')
      }`
    case 'class_teacher_pin':
      return `the class-teacher pins for ${names.homeroom(c.homeroomId ?? '')}`
    case 'limit':
      return `a ${c.limitKind === 'min' ? 'minimum' : 'maximum'} ${c.period} limit`
    default:
      return c.tag
  }
}

/** The conflicts grouped the way they have to be read: a group at a time. */
export function conflictGroups(conflicts: SolverConflict[]): SolverConflict[][] {
  const byGroup = new Map<number, SolverConflict[]>()
  for (const c of conflicts) {
    const arr = byGroup.get(c.group)
    if (arr) arr.push(c)
    else byGroup.set(c.group, [c])
  }
  return [...byGroup.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v)
}
