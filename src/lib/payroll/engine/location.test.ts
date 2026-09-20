import { describe, it, expect } from 'vitest'
import {
  engineInput, employee, workLocation, presentMonth, period, ALL_RULES, PT_RULES,
} from '../__fixtures__'
import { calcLine } from './calcLine'
import { resolveJurisdiction, resolveLocationFor, hasAmbiguousLocation, jurisdictionsFor } from './resolveLocation'
import { pinFor, pinnedRulesFor, pickRuleSet, type RunContext } from '../hydrate'
import type { RuleSetRow } from '../rows'

const TODAY = '2026-07-15'
const JUNE = period()

const chennai = workLocation()
const bengaluru = workLocation({
  id: 'loc-blr', name: 'Bengaluru campus', stateCode: 'IN-KA',
  isDefault: false, priority: 10, epfEstablishmentId: 'KNBNG0099999000',
  esiEmployerCode: '53000999990001000',
})

describe('work location resolution', () => {
  it('falls back to the default location when nobody claims the employee', () => {
    const r = resolveJurisdiction([chennai, bengaluru], employee(), '2026-06-30', 'IN-TN')
    expect(r.location?.id).toBe('loc-main')
    expect(r.jurisdiction).toBe('IN-TN')
    expect(r.unlocated).toBe(false)
    expect(r.locationSource.rank).toBe('default')
  })

  it('an explicit member assignment beats the default', () => {
    const blr = { ...bengaluru, members: [{ employeeId: 'emp-1', effectiveFrom: '2000-01-01', effectiveTo: null }] }
    const r = resolveJurisdiction([chennai, blr], employee(), '2026-06-30', 'IN-TN')
    expect(r.jurisdiction).toBe('IN-KA')
    expect(r.locationSource.rank).toBe('explicit')
  })

  it('a match rule beats the default but loses to an explicit assignment', () => {
    const matched = { ...bengaluru, match: { departments: ['Science'] } }
    expect(resolveJurisdiction([chennai, matched], employee(), '2026-06-30', 'IN-TN').locationSource.rank).toBe('matched')

    const alsoExplicit = { ...chennai, isDefault: false, priority: 5, members: [{ employeeId: 'emp-1', effectiveFrom: '2000-01-01', effectiveTo: null }] }
    const r = resolveJurisdiction([alsoExplicit, matched], employee(), '2026-06-30', 'IN-TN')
    expect(r.location?.id).toBe('loc-main')
    expect(r.locationSource.rank).toBe('explicit')
  })

  it('membership is effective-dated, so a transfer moves the state from that date and not before', () => {
    // Chennai until 31 July, Bengaluru from 1 August.
    const tn = { ...chennai, isDefault: false, priority: 5, members: [{ employeeId: 'emp-1', effectiveFrom: '2000-01-01', effectiveTo: '2026-07-31' }] }
    const ka = { ...bengaluru, members: [{ employeeId: 'emp-1', effectiveFrom: '2026-08-01', effectiveTo: null }] }

    expect(resolveJurisdiction([tn, ka], employee(), '2026-07-31', 'IN-TN').jurisdiction).toBe('IN-TN')
    expect(resolveJurisdiction([tn, ka], employee(), '2026-08-01', 'IN-TN').jurisdiction).toBe('IN-KA')
    // And July stays Tamil Nadu after the move has happened — the resolver is a
    // function of the date, not of today.
    expect(resolveJurisdiction([tn, ka], employee(), '2026-07-15', 'IN-TN').location?.name).toBe('Main campus')
  })

  it('an explicit per-person override beats the office', () => {
    const r = resolveJurisdiction([chennai], employee({ jurisdictionOverride: 'IN-KL' }), '2026-06-30', 'IN-TN')
    expect(r.jurisdiction).toBe('IN-KL')
    expect(r.location?.id).toBe('loc-main')
    expect(r.why).toContain('explicit override')
  })

  it('reports being unlocated rather than silently assuming a state', () => {
    const r = resolveJurisdiction([], employee(), '2026-06-30', 'IN-TN')
    expect(r.unlocated).toBe(true)
    expect(r.jurisdiction).toBe('IN-TN')
    expect(r.location).toBeNull()
  })

  it('flags two locations tying at the same priority', () => {
    const a = { ...bengaluru, id: 'a', members: [{ employeeId: 'emp-1', effectiveFrom: '2000-01-01', effectiveTo: null }] }
    const b = { ...bengaluru, id: 'b', name: 'Hyderabad campus', stateCode: 'IN-TG', members: [{ employeeId: 'emp-1', effectiveFrom: '2000-01-01', effectiveTo: null }] }
    expect(hasAmbiguousLocation([a, b], employee(), '2026-06-30')).toBe(true)
    expect(hasAmbiguousLocation([a], employee(), '2026-06-30')).toBe(false)
  })

  it('lists the distinct states a run has to pin rules for', () => {
    const ka = { ...bengaluru, members: [{ employeeId: 'emp-2', effectiveFrom: '2000-01-01', effectiveTo: null }] }
    const people = [employee(), employee({ id: 'emp-2', name: 'B Devi' })]
    expect(jurisdictionsFor([chennai, ka], people, '2026-06-30', 'IN-TN')).toEqual(['IN-KA', 'IN-TN'])
  })

  it('resolveLocationFor and resolveJurisdiction agree on the location', () => {
    const a = resolveLocationFor([chennai, bengaluru], employee(), '2026-06-30')
    const b = resolveJurisdiction([chennai, bengaluru], employee(), '2026-06-30', 'IN-TN')
    expect(a.location?.id).toBe(b.location?.id)
  })
})

describe('the line the engine prices carries its location', () => {
  const base = () => engineInput({
    period: JUNE, attendance: presentMonth(JUNE.from, JUNE.to),
  })

  it('snapshots the location, entity and state on the result', () => {
    const r = calcLine(base(), TODAY)
    expect(r.locationId).toBe('loc-main')
    expect(r.entityId).toBe('ent-1')
    expect(r.jurisdiction).toBe('IN-TN')
  })

  it('names the location and the state in the trace, so the Why? panel can print them', () => {
    const r = calcLine(base(), TODAY)
    expect(r.trace.inputs?.['Work location']).toBe('Main campus')
    expect(r.trace.inputs?.['Taxed in']).toBe('IN-TN')
    expect(r.trace.note).toContain('Main campus')
  })

  it('blocks the run when an employee has no work location at all', () => {
    const r = calcLine(engineInput({ period: JUNE, locations: [], attendance: presentMonth(JUNE.from, JUNE.to) }), TODAY)
    const w = r.warnings.find(x => x.code === 'NO_LOCATION')
    expect(w?.severity).toBe('block')
    // It still produces a number — the run is blocked at approval, not crashed.
    expect(r.netPay).toBeGreaterThan(0)
  })

  it('blocks when the resolved state has no Professional Tax rule set published', () => {
    const ka = { ...bengaluru, members: [{ employeeId: 'emp-1', effectiveFrom: '2000-01-01', effectiveTo: null }] }
    const r = calcLine(engineInput({
      period: JUNE, locations: [chennai, ka],
      attendance: presentMonth(JUNE.from, JUNE.to),
      // The hydrator found no Karnataka PT set to pin.
      rules: { ...ALL_RULES, pt: null },
    }), TODAY)
    expect(r.jurisdiction).toBe('IN-KA')
    expect(r.warnings.find(x => x.code === 'NO_PT_RULE_FOR_STATE')?.severity).toBe('block')
  })

  it('leaves a single-state school exactly where it was', () => {
    // The safety property of the whole change: with one default location in the
    // school's own state, every figure matches what the pre-location engine
    // produced, because nothing about the resolution has changed for it.
    const withLocations = calcLine(base(), TODAY)
    const asBefore = calcLine(engineInput({
      period: JUNE, attendance: presentMonth(JUNE.from, JUNE.to),
      locations: [workLocation({ id: 'other', name: 'Anything', stateCode: 'IN-TN' })],
    }), TODAY)
    expect(withLocations.netPay).toBe(asBefore.netPay)
    expect(withLocations.components.map(c => [c.code, c.amount]))
      .toEqual(asBefore.components.map(c => [c.code, c.amount]))
  })
})

// ============================================
// Rule pinning — what a run records having used
// ============================================

function ruleRow(over: Partial<RuleSetRow> & Pick<RuleSetRow, 'id' | 'domain' | 'jurisdiction'>): RuleSetRow {
  return {
    version: 1, effective_from: '2026-04-01', effective_to: null,
    rules: PT_RULES.rules, source_note: null, status: 'published', published_at: null,
    ...over,
  } as RuleSetRow
}

const ROWS: RuleSetRow[] = [
  ruleRow({ id: 'pf-in', domain: 'pf', jurisdiction: 'IN' }),
  ruleRow({ id: 'esi-in', domain: 'esi', jurisdiction: 'IN' }),
  ruleRow({ id: 'tds-in', domain: 'tds', jurisdiction: 'IN' }),
  ruleRow({ id: 'pt-tn', domain: 'pt', jurisdiction: 'IN-TN' }),
  ruleRow({ id: 'pt-ka', domain: 'pt', jurisdiction: 'IN-KA' }),
  ruleRow({ id: 'lwf-tn', domain: 'lwf', jurisdiction: 'IN-TN' }),
]

function ctx(): RunContext {
  return {
    period: JUNE, components: [], structures: [], policyGroups: [], calendars: [],
    locations: [], defaultJurisdiction: 'IN-TN', holidays: [],
    ruleRows: ROWS, pinnedIds: {}, pinnedRules: {},
  }
}

describe('rule pinning across states', () => {
  it('prefers the state rule set over the central one for the same domain', () => {
    expect(pickRuleSet(ROWS, 'pt', 'IN-KA', '2026-06-30')?.id).toBe('pt-ka')
    expect(pickRuleSet(ROWS, 'pt', 'IN-TN', '2026-06-30')?.id).toBe('pt-tn')
    // PF is central; a state asking for it still gets the countrywide set.
    expect(pickRuleSet(ROWS, 'pf', 'IN-KA', '2026-06-30')?.id).toBe('pf-in')
  })

  it('returns nothing for a state whose rules were never published', () => {
    expect(pickRuleSet(ROWS, 'lwf', 'IN-KA', '2026-06-30')).toBeNull()
    expect(pinnedRulesFor(ROWS, 'IN-KA', '2026-06-30').lwf).toBeNull()
  })

  it('records exactly the rule sets it hands to the engine, per state', () => {
    // This is the bug the multi-state work exists to close: pinning used to
    // happen once against one assumed state while the engine resolved rules per
    // employee, so a two-state run stored provenance it had not used.
    const c = ctx()
    const tn = pinFor(c, 'IN-TN')
    const ka = pinFor(c, 'IN-KA')

    expect(tn.pt?.id).toBe('pt-tn')
    expect(ka.pt?.id).toBe('pt-ka')
    expect(c.pinnedIds).toEqual({
      IN: { pf: 'pf-in', esi: 'esi-in', tds: 'tds-in' },
      'IN-TN': { pt: 'pt-tn', lwf: 'lwf-tn' },
      'IN-KA': { pt: 'pt-ka' },
    })
  })

  it('resolves each state once however many people are on it', () => {
    const c = ctx()
    expect(pinFor(c, 'IN-TN')).toBe(pinFor(c, 'IN-TN'))
  })

  it('a one-state run records one state, as it always did', () => {
    const c = ctx()
    pinFor(c, 'IN-TN')
    expect(Object.keys(c.pinnedIds).sort()).toEqual(['IN', 'IN-TN'])
  })
})
