import { describe, it, expect } from 'vitest'
import { workLocation } from './__fixtures__'
import { buildReturnsByLocation, configForLocation, statutoryBasesOf, ecrRowFromLine } from './returns'
import { DEFAULT_STATUTORY_CONFIG, ecrFields } from '@/lib/statutory'
import type { RunLineRow } from './rows'
import type { StatutoryBases } from './engine/types'

const BASES: StatutoryBases = {
  pfWages: 15000, epsWages: 15000, edliWages: 15000, esiWages: 0,
  pfApplicable: true, esiApplicable: false, ncpDays: 0, paidDaysWhole: 30,
}

function line(over: Partial<RunLineRow> = {}, bases: Partial<StatutoryBases> = {}): RunLineRow {
  return {
    id: 'line-1', run_id: 'run-1', employee_id: 'emp-1',
    structure_id: null, policy_group_id: null, calendar_id: null,
    location_id: 'loc-main', entity_id: 'ent-1', jurisdiction: 'IN-TN',
    gross_earnings: 40000, total_deductions: 2000, employer_contributions: 1800,
    employer_cost: 41800, net_pay: 38000,
    payable_days: 30, paid_days: 30, lop_days: 0,
    inputs: { statutory: { ...BASES, ...bases } },
    trace: null, payout_status: null, payout_reference: null,
    employee: { id: 'emp-1', full_name: 'A Rahman', role: 'teacher' },
    components: [
      { component_code: 'PF', name: 'Provident Fund', kind: 'deduction', amount: 1800, full_amount: 1800, sequence: 910 },
      { component_code: 'PF_ER', name: 'Employer PF', kind: 'employer_contribution', amount: 550, full_amount: 550, sequence: 960 },
      { component_code: 'EPS_ER', name: 'Employer pension', kind: 'employer_contribution', amount: 1250, full_amount: 1250, sequence: 961 },
    ] as RunLineRow['components'],
    ...over,
  } as RunLineRow
}

const IDENTITIES = { 'emp-1': { uan: '101234567890', esiIpNumber: '3101234567' } }

describe('per-establishment statutory returns', () => {
  it('overlays only the identifiers, never the rates', () => {
    const loc = workLocation({ epfEstablishmentId: 'KNBNG0099999000', esiEmployerCode: '53000999990001000' })
    const cfg = configForLocation(DEFAULT_STATUTORY_CONFIG, loc)
    expect(cfg.epf_establishment_id).toBe('KNBNG0099999000')
    expect(cfg.esi_employer_code).toBe('53000999990001000')
    // PF is 12% in Bengaluru exactly as in Chennai.
    expect(cfg.epf_rate).toBe(DEFAULT_STATUTORY_CONFIG.epf_rate)
    expect(cfg.eps_wage_ceiling).toBe(DEFAULT_STATUTORY_CONFIG.eps_wage_ceiling)
  })

  it('files what the run deducted rather than recomputing it', () => {
    // The employer's PF share is filed as what actually reached PF, not as a
    // rate applied afresh — the two round differently often enough to matter.
    const row = ecrRowFromLine(line(), BASES, IDENTITIES['emp-1'])
    expect(row.epfContribution).toBe(1800)
    expect(row.epsContribution).toBe(1250)
    expect(row.epfEpsDiff).toBe(550)
    expect(row.grossWages).toBe(40000)
    expect(ecrFields(row)).toEqual(['101234567890', 'A RAHMAN', 40000, 15000, 15000, 15000, 1800, 1250, 550, 0, 0])
  })

  it('holds back a member with no UAN instead of filing a row the portal rejects', () => {
    const row = ecrRowFromLine(line(), BASES, { uan: null, esiIpNumber: null })
    expect(row.issues).toContain('No UAN on record')
  })

  it('produces one return per establishment', () => {
    const chennai = workLocation()
    const bengaluru = workLocation({
      id: 'loc-blr', name: 'Bengaluru campus', stateCode: 'IN-KA', isDefault: false,
      epfEstablishmentId: 'KNBNG0099999000', esiEmployerCode: '53000999990001000',
    })
    const rets = buildReturnsByLocation({
      lines: [
        line(),
        line({ id: 'line-2', employee_id: 'emp-2', location_id: 'loc-blr', jurisdiction: 'IN-KA',
               employee: { id: 'emp-2', full_name: 'B Devi', role: 'teacher' } }),
      ],
      locations: [chennai, bengaluru],
      baseConfig: DEFAULT_STATUTORY_CONFIG,
      identities: { ...IDENTITIES, 'emp-2': { uan: '101234567891', esiIpNumber: null } },
    })

    expect(rets).toHaveLength(2)
    expect(rets[0].location?.name).toBe('Main campus')       // default first
    expect(rets[1].config.epf_establishment_id).toBe('KNBNG0099999000')
    expect(rets[0].ecr).toHaveLength(1)
    expect(rets[1].ecr).toHaveLength(1)
    // Neither return contains the other's member — that is the whole point.
    expect(rets[0].ecr[0].name).toBe('A RAHMAN')
    expect(rets[1].ecr[0].name).toBe('B DEVI')
  })

  it('a single-location school still gets exactly one return', () => {
    const rets = buildReturnsByLocation({
      lines: [line(), line({ id: 'line-2', employee_id: 'emp-2', employee: { id: 'emp-2', full_name: 'B Devi', role: 'teacher' } })],
      locations: [workLocation()],
      baseConfig: DEFAULT_STATUTORY_CONFIG,
      identities: { ...IDENTITIES, 'emp-2': { uan: '101234567891', esiIpNumber: null } },
    })
    expect(rets).toHaveLength(1)
    expect(rets[0].ecr).toHaveLength(2)
    expect(rets[0].blockers).toEqual([])
  })

  it('keeps unlocated employees in their own group rather than filing them under the default code', () => {
    const rets = buildReturnsByLocation({
      lines: [line(), line({ id: 'line-2', employee_id: 'emp-2', location_id: null,
                             employee: { id: 'emp-2', full_name: 'B Devi', role: 'teacher' } })],
      locations: [workLocation()],
      baseConfig: DEFAULT_STATUTORY_CONFIG,
      identities: { ...IDENTITIES, 'emp-2': { uan: '101234567891', esiIpNumber: null } },
    })
    expect(rets).toHaveLength(2)
    const unlocated = rets[rets.length - 1]
    expect(unlocated.location).toBeNull()
    expect(unlocated.blockers[0]).toContain('no work location')
  })

  it('says so when a location has no EPFO code, rather than filing under a blank one', () => {
    const rets = buildReturnsByLocation({
      lines: [line()],
      locations: [workLocation({ epfEstablishmentId: null })],
      baseConfig: { ...DEFAULT_STATUTORY_CONFIG, epf_establishment_id: '' },
      identities: IDENTITIES,
    })
    expect(rets[0].blockers.some(b => b.includes('EPFO establishment id'))).toBe(true)
  })

  it('refuses to guess wage bases for a line calculated before they were recorded', () => {
    const stale = line({ inputs: { locationId: 'loc-main' } })
    expect(statutoryBasesOf(stale)).toBeNull()
    const rets = buildReturnsByLocation({
      lines: [stale], locations: [workLocation()],
      baseConfig: DEFAULT_STATUTORY_CONFIG, identities: IDENTITIES,
    })
    expect(rets[0].ecr).toHaveLength(0)
    expect(rets[0].blockers.some(b => b.includes('recalculate the run'))).toBe(true)
  })

  it('leaves a non-PF member out of the ECR entirely', () => {
    const rets = buildReturnsByLocation({
      lines: [line({}, { pfApplicable: false })],
      locations: [workLocation()],
      baseConfig: DEFAULT_STATUTORY_CONFIG, identities: IDENTITIES,
    })
    expect(rets[0].ecr).toHaveLength(0)
  })
})
