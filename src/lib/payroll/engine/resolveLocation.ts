// ============================================================================
// Work location and jurisdiction resolution.
// ----------------------------------------------------------------------------
// Professional Tax and the Labour Welfare Fund are levied by the state, not by
// the country, so payroll cannot price a line until it knows which state the
// person works in. That used to be a constant in `hydrate.ts`; it is now
// resolved from the work location, with the same precedence the rest of payroll
// already uses for policy groups and working calendars:
//
//   1. a non-default location that lists this employee, effective on the date
//   2. a non-default location whose match rules select this employee
//   3. the default location
//   4. nothing — which is a blocking exception, never a silent guess
//
// One difference from policy groups: location membership is itself
// effective-dated. A teacher transferred from Chennai to Bengaluru on 1 August
// is in Tamil Nadu in July and Karnataka in September, and both months have to
// stay right after the move. Filtering members to the date before resolving is
// the whole of that.
//
// `resolveJurisdiction` is called from two places — the engine, to price the
// line, and the hydrator, to decide which state's rule sets to pin to the run.
// It is the same function in both, which is what stops a run from recording
// rules it did not use.
// ============================================================================

import type { WorkLocation, EngineEmployee, PolicySource } from './types'
import { resolveScoped, explainCoverage, type Resolution } from './resolvePolicy'

/** A location flattened to the shape `resolveScoped` understands, for one date. */
interface ScopedLocation {
  id: string
  name: string
  isDefault: boolean
  priority: number
  effectiveFrom: string
  effectiveTo: string | null
  memberIds: string[]
  match: WorkLocation['match']
  location: WorkLocation
}

/**
 * Membership is effective-dated, so who counts as a member depends on the date.
 * Everything else about a location is date-independent.
 */
function scopedOn(locations: WorkLocation[], onDate: string): ScopedLocation[] {
  return locations.map(l => ({
    id: l.id,
    name: l.name,
    isDefault: l.isDefault,
    priority: l.priority,
    effectiveFrom: l.effectiveFrom,
    effectiveTo: l.effectiveTo,
    memberIds: l.members
      .filter(m => m.effectiveFrom <= onDate && (m.effectiveTo === null || m.effectiveTo >= onDate))
      .map(m => m.employeeId),
    match: l.match,
    location: l,
  }))
}

export function resolveLocationFor(
  locations: WorkLocation[], employee: EngineEmployee, onDate: string,
): { location: WorkLocation | null; source: PolicySource } {
  const r: Resolution<ScopedLocation> = resolveScoped(scopedOn(locations, onDate), employee, onDate, 'work location')
  return { location: r.item?.location ?? null, source: r.source }
}

export interface JurisdictionResolution {
  /** The state code the statutory engine should use, e.g. 'IN-TN'. */
  jurisdiction: string
  location: WorkLocation | null
  /** Why this location applies. Null when an override skipped location resolution entirely. */
  locationSource: PolicySource
  /** How the jurisdiction itself was arrived at — printed by the Why? panel. */
  why: string
  /** True when the employee has no location at all; the caller raises the exception. */
  unlocated: boolean
}

/**
 * The state that governs this employee's PT and LWF on `onDate`.
 *
 * An explicit per-person override wins over the office, because the one case it
 * exists for — somebody taxed where they live rather than where the school is —
 * is precisely the case the office gets wrong. Everything else comes from the
 * location, and the school-wide default is the last resort.
 */
export function resolveJurisdiction(
  locations: WorkLocation[],
  employee: EngineEmployee,
  onDate: string,
  defaultJurisdiction: string,
): JurisdictionResolution {
  const { location, source } = resolveLocationFor(locations, employee, onDate)

  if (employee.jurisdictionOverride) {
    return {
      jurisdiction: employee.jurisdictionOverride,
      location,
      locationSource: source,
      why: location
        ? `${employee.name} is taxed in ${employee.jurisdictionOverride} by an explicit override, not in ${location.stateCode} where "${location.name}" sits.`
        : `${employee.name} is taxed in ${employee.jurisdictionOverride} by an explicit override.`,
      unlocated: !location,
    }
  }

  if (location) {
    return {
      jurisdiction: location.stateCode,
      location,
      locationSource: source,
      why: `${location.stateCode} applies because ${employee.name} works at "${location.name}". ${source.why}`,
      unlocated: false,
    }
  }

  return {
    jurisdiction: defaultJurisdiction,
    location: null,
    locationSource: source,
    why: `${employee.name} is not assigned to any work location, so the school default ${defaultJurisdiction} was used. Assign a location: the state decides Professional Tax and LWF.`,
    unlocated: true,
  }
}

/**
 * Every location that could claim this employee, in precedence order — the
 * locations screen's coverage check, and the same shape the policies screen
 * already uses.
 */
export function locationCoverage(
  locations: WorkLocation[], employee: EngineEmployee, onDate: string,
) {
  return explainCoverage(scopedOn(locations, onDate), employee, onDate)
    .map(c => ({ location: c.item.location, rank: c.rank, priority: c.priority }))
}

/** Two locations tying at the top is a configuration bug the admin has to break by hand. */
export function hasAmbiguousLocation(
  locations: WorkLocation[], employee: EngineEmployee, onDate: string,
): boolean {
  const cov = locationCoverage(locations, employee, onDate)
  if (cov.length < 2) return false
  return cov[0].rank === cov[1].rank && cov[0].priority === cov[1].priority
}

/** The distinct states present across a set of employees — what a run has to pin rules for. */
export function jurisdictionsFor(
  locations: WorkLocation[], employees: EngineEmployee[], onDate: string, defaultJurisdiction: string,
): string[] {
  const seen = new Set<string>()
  for (const e of employees) seen.add(resolveJurisdiction(locations, e, onDate, defaultJurisdiction).jurisdiction)
  return [...seen].sort()
}
