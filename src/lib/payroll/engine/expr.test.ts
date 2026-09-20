import { describe, it, expect } from 'vitest'
import { evaluateFormula, formulaDependencies, FormulaError } from './expr'

const scope = { BASIC: 20000, HRA: 8000, DA: 2000, GROSS: 30000 }

describe('evaluateFormula', () => {
  it('does arithmetic with the usual precedence', () => {
    expect(evaluateFormula('2 + 3 * 4', {})).toBe(14)
    expect(evaluateFormula('(2 + 3) * 4', {})).toBe(20)
    expect(evaluateFormula('10 - 2 - 3', {})).toBe(5)
  })

  it('resolves component codes from the scope', () => {
    expect(evaluateFormula('BASIC * 0.4', scope)).toBe(8000)
    expect(evaluateFormula('BASIC + HRA + DA', scope)).toBe(30000)
  })

  it('supports the whitelisted functions', () => {
    expect(evaluateFormula('min(BASIC, 15000)', scope)).toBe(15000)
    expect(evaluateFormula('max(BASIC, 15000)', scope)).toBe(20000)
    expect(evaluateFormula('pct(BASIC, 12)', scope)).toBe(2400)
    expect(evaluateFormula('round(1234.6)', {})).toBe(1235)
  })

  it('handles unary minus', () => {
    expect(evaluateFormula('-BASIC + 25000', scope)).toBe(5000)
  })

  it('treats division by zero as zero rather than poisoning the result', () => {
    expect(evaluateFormula('BASIC / DAYS', { ...scope, DAYS: 0 })).toBe(0)
  })

  it('refuses an unknown component instead of defaulting it to zero', () => {
    // The whole point: a typo must stop the run, not silently halve a salary.
    expect(() => evaluateFormula('BASCI * 0.4', scope)).toThrow(FormulaError)
  })

  it('refuses anything that could reach a JS runtime', () => {
    expect(() => evaluateFormula('process.exit(1)', scope)).toThrow(FormulaError)
    expect(() => evaluateFormula('constructor', scope)).toThrow(FormulaError)
    expect(() => evaluateFormula('BASIC; drop', scope)).toThrow(FormulaError)
  })

  it('rejects malformed input', () => {
    expect(() => evaluateFormula('2 +', scope)).toThrow(FormulaError)
    expect(() => evaluateFormula('(2 + 3', scope)).toThrow(FormulaError)
    expect(() => evaluateFormula('2 3', scope)).toThrow(FormulaError)
  })
})

describe('formulaDependencies', () => {
  it('lists component codes and ignores function names', () => {
    expect(formulaDependencies('min(BASIC, 15000) + HRA').sort()).toEqual(['BASIC', 'HRA'])
  })
})
