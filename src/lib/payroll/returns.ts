// ============================================================================
// Monthly statutory returns, per establishment.
// ----------------------------------------------------------------------------
// The EPFO's ECR and the ESIC's Monthly Contribution are filed per
// establishment, not per employer: two campuses with two EPFO codes file two
// returns, and putting both campuses' members in one file is a portal error
// rather than a convenience.
//
// So a run's lines are grouped by the work location snapshotted on them, and
// each group is turned into its own return under that location's registration
// numbers. A single-location school gets exactly one of each, identical to what
// it got before locations existed.
//
// Nothing is recomputed here. `src/lib/statutory.ts` owns the file formats and
// keeps them; this module only decides who belongs in which file and hands each
// row the numbers the run already recorded. A return that recalculated wages
// from a payslip would be a second answer to a question the run has already
// settled, and the two would eventually disagree.
// ============================================================================

import type { StatutoryConfig, EcrRow, EsiRow } from '@/lib/statutory'
import { epfMemberName, esiPersonName, digitsOnly, epfTotals, esiTotals } from '@/lib/statutory'
import type { WorkLocation, StatutoryBases } from './engine/types'
import type { RunLineRow } from './rows'

/**
 * The establishment's own registration numbers, laid over the school-wide
 * rates. Rates are central — a Karnataka campus deducts PF at the same 12% as a
 * Tamil Nadu one — so only the identifiers move.
 */
export function configForLocation(cfg: StatutoryConfig, location: WorkLocation | null): StatutoryConfig {
  if (!location) return cfg
  return {
    ...cfg,
    epf_establishment_id: location.epfEstablishmentId ?? cfg.epf_establishment_id,
    esi_employer_code: location.esiEmployerCode ?? cfg.esi_employer_code,
  }
}

/** What a line's `inputs` carries once it has been calculated by the v2 engine. */
interface LineInputs {
  statutory?: Partial<StatutoryBases>
  locationId?: string | null
  jurisdiction?: string | null
}

export function statutoryBasesOf(line: RunLineRow): StatutoryBases | null {
  const s = (line.inputs as LineInputs | null)?.statutory
  if (!s || typeof s.pfWages !== 'number') return null
  return {
    pfWages: s.pfWages ?? 0,
    epsWages: s.epsWages ?? 0,
    edliWages: s.edliWages ?? 0,
    esiWages: s.esiWages ?? 0,
    pfApplicable: s.pfApplicable ?? false,
    esiApplicable: s.esiApplicable ?? false,
    ncpDays: s.ncpDays ?? 0,
    paidDaysWhole: s.paidDaysWhole ?? 0,
  }
}

function componentAmount(line: RunLineRow, code: string): number {
  return Number((line.components ?? []).find(c => c.component_code === code)?.amount ?? 0)
}

export interface MemberIdentity {
  uan: string | null
  esiIpNumber: string | null
}

/**
 * One ECR line from one run line.
 *
 * Every figure is read from the run: the wage bases the engine used, and the
 * contributions it actually deducted. `epfEpsDiff` is the one derived value,
 * and it is derived the way the portal defines it — the difference between the
 * two remitted figures — rather than recomputed from a rate.
 */
export function ecrRowFromLine(
  line: RunLineRow, bases: StatutoryBases, identity: MemberIdentity,
): EcrRow {
  const name = epfMemberName(line.employee?.full_name ?? '')
  const uan = digitsOnly(identity.uan)
  const epfContribution = Math.round(componentAmount(line, 'PF'))
  const epsContribution = Math.round(componentAmount(line, 'EPS_ER'))
  const employerPf = Math.round(componentAmount(line, 'PF_ER'))

  const issues: string[] = []
  if (uan.length !== 12) issues.push(uan ? 'UAN is not 12 digits' : 'No UAN on record')
  if (!name) issues.push('No name on record')

  return {
    staffId: line.employee_id,
    uan,
    name,
    grossWages: Math.round(Number(line.gross_earnings)),
    epfWages: Math.round(bases.pfWages),
    epsWages: Math.round(bases.epsWages),
    edliWages: Math.round(bases.edliWages),
    epsApplicable: bases.epsWages > 0,
    epfContribution,
    epsContribution,
    // The employer's share reaches EPF as whatever is left once the pension
    // share is carved out of it. Filing it as a rate applied afresh would
    // disagree with the run by a rupee often enough to matter.
    epfEpsDiff: employerPf,
    ncpDays: bases.ncpDays,
    refundOfAdvances: 0,
    deductedPf: epfContribution,
    issues,
  }
}

export function esiRowFromLine(
  line: RunLineRow, bases: StatutoryBases, identity: MemberIdentity, zeroDayReason = '1',
): EsiRow {
  const ipName = esiPersonName(line.employee?.full_name ?? '')
  const ipNumber = digitsOnly(identity.esiIpNumber)
  const employeeContribution = Math.round(componentAmount(line, 'ESI'))
  const employerContribution = Math.round(componentAmount(line, 'ESI_ER'))

  const issues: string[] = []
  if (ipNumber.length !== 10) issues.push(ipNumber ? 'IP number is not 10 digits' : 'No IP number on record')
  if (!ipName) issues.push('No name on record')

  return {
    staffId: line.employee_id,
    ipNumber,
    ipName,
    daysWorked: bases.paidDaysWhole,
    totalMonthlyWages: Math.round(bases.esiWages),
    reasonCode: bases.paidDaysWhole > 0 ? '0' : zeroDayReason,
    lastWorkingDay: '',
    employeeContribution,
    employerContribution,
    deductedEsi: employeeContribution,
    issues,
  }
}

export interface LocationReturn {
  location: WorkLocation | null
  /** The establishment config this return files under. */
  config: StatutoryConfig
  ecr: EcrRow[]
  esi: EsiRow[]
  epf: ReturnType<typeof epfTotals>
  esiTotals: ReturnType<typeof esiTotals>
  /** Why this establishment cannot file yet, if it cannot. */
  blockers: string[]
}

/**
 * Group a run's lines by the location snapshotted on them and build one return
 * per establishment.
 *
 * Lines with no location land in their own group with a null location. They are
 * not silently folded into the default establishment: a member filed under the
 * wrong EPFO code is harder to unpick than one who was never filed, and the run
 * already raised NO_LOCATION as a blocking exception when it calculated.
 */
export function buildReturnsByLocation(args: {
  lines: RunLineRow[]
  locations: WorkLocation[]
  baseConfig: StatutoryConfig
  identities: Record<string, MemberIdentity>
  zeroDayReason?: string
}): LocationReturn[] {
  const { lines, locations, baseConfig, identities, zeroDayReason = '1' } = args
  const locationById = new Map(locations.map(l => [l.id, l]))

  const groups = new Map<string, RunLineRow[]>()
  for (const line of lines) {
    const key = line.location_id ?? ''
    const bucket = groups.get(key)
    if (bucket) bucket.push(line)
    else groups.set(key, [line])
  }

  const out: LocationReturn[] = []
  for (const [key, groupLines] of groups) {
    const location = key ? locationById.get(key) ?? null : null
    const config = configForLocation(baseConfig, location)

    const ecr: EcrRow[] = []
    const esi: EsiRow[] = []
    for (const line of groupLines) {
      const bases = statutoryBasesOf(line)
      // A line calculated before statutory bases were recorded cannot be filed
      // from. Recalculating the run fills them in; guessing them here would not.
      if (!bases) continue
      const identity = identities[line.employee_id] ?? { uan: null, esiIpNumber: null }
      if (bases.pfApplicable) ecr.push(ecrRowFromLine(line, bases, identity))
      if (bases.esiApplicable) esi.push(esiRowFromLine(line, bases, identity, zeroDayReason))
    }

    const blockers: string[] = []
    if (!location) blockers.push('These employees have no work location, so there is no establishment to file them under.')
    if (ecr.length > 0 && !config.epf_establishment_id) blockers.push('No EPFO establishment id for this location.')
    if (esi.length > 0 && !config.esi_employer_code) blockers.push('No ESIC employer code for this location.')
    const staleLines = groupLines.filter(l => !statutoryBasesOf(l)).length
    if (staleLines > 0) blockers.push(`${staleLines} line(s) were calculated before wage bases were recorded — recalculate the run.`)

    out.push({
      location,
      config,
      ecr,
      esi,
      epf: epfTotals(ecr.filter(r => r.issues.length === 0), config),
      esiTotals: esiTotals(esi.filter(r => r.issues.length === 0)),
      blockers,
    })
  }

  // Default establishment first, then by name, with the unlocated group last so
  // it reads as the exception it is.
  return out.sort((a, b) => {
    if (!a.location) return 1
    if (!b.location) return -1
    return (b.location.isDefault ? 1 : 0) - (a.location.isDefault ? 1 : 0)
      || a.location.name.localeCompare(b.location.name)
  })
}
