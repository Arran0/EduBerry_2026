import { describe, it, expect } from 'vitest'
import {
  toPaise, toRupees, percentOf, splitProportional, waterfall, sum, formatPaise,
} from './money'
import { amountInWords, numberToIndianWords } from './words'

describe('paise conversion', () => {
  it('round-trips the amounts a NUMERIC(12,2) column can hold', () => {
    for (const r of [0, 1, 0.01, 0.99, 24000, 27000.5, 123456.78, 9999999.99]) {
      expect(toRupees(toPaise(r))).toBe(r)
    }
  })

  it('survives the float products that break naive scaling', () => {
    // 1.005 * 100 is 100.49999999999999 in binary floating point; a plain
    // Math.round would give 100 and lose a paisa on every such amount.
    expect(toPaise(1.005)).toBe(101)
    expect(toPaise(2.675)).toBe(268)
    expect(toPaise(24000.005)).toBe(2400001)
  })

  it('accepts the strings Supabase returns for NUMERIC', () => {
    expect(toPaise('27000.00')).toBe(2700000)
    expect(toPaise('3000.50')).toBe(300050)
  })

  it('treats null and rubbish as zero rather than NaN', () => {
    expect(toPaise(null)).toBe(0)
    expect(toPaise(undefined)).toBe(0)
    expect(toPaise('not a number')).toBe(0)
  })

  it('handles negatives symmetrically, for reversals and credits', () => {
    expect(toPaise(-1.005)).toBe(-101)
    expect(toRupees(toPaise(-450.25))).toBe(-450.25)
  })
})

describe('percentOf', () => {
  it('computes the common term splits exactly', () => {
    const total = 2_700_000 // ₹27,000
    expect(percentOf(total, 40)).toBe(1_080_000)
    expect(percentOf(total, 30)).toBe(810_000)
  })

  it('rounds half up, matching the bursar’s spreadsheet', () => {
    expect(percentOf(101, 50)).toBe(51)   // 50.5 -> 51
    expect(percentOf(-101, 50)).toBe(-51) // symmetric for credits
  })

  it('is zero for a nonsense rate rather than NaN', () => {
    expect(percentOf(1000, Number.NaN)).toBe(0)
  })
})

describe('splitProportional', () => {
  it('always sums back to the original amount', () => {
    const cases: [number, number[]][] = [
      [2_700_000, [40, 30, 30]],
      [1_000_000, [1, 1, 1]],          // ₹10,000 over three: 3333.34/3333.33/3333.33
      [100, [1, 1, 1]],                // one rupee over three
      [1, [1, 1, 1]],                  // one paisa over three
      [2_700_000, [2_400_000, 300_000]],
    ]
    for (const [amount, weights] of cases) {
      const parts = splitProportional(amount, weights)
      expect(sum(parts)).toBe(amount)
      expect(parts).toHaveLength(weights.length)
    }
  })

  it('puts the rounding remainder in the last part', () => {
    // ₹10,000 three ways: 3333.33 + 3333.33 + 3333.34
    expect(splitProportional(1_000_000, [1, 1, 1])).toEqual([333_333, 333_333, 333_334])
  })

  it('does not lose money when every weight is zero', () => {
    expect(splitProportional(5000, [0, 0])).toEqual([5000, 0])
  })

  it('returns nothing for no weights', () => {
    expect(splitProportional(5000, [])).toEqual([])
  })
})

describe('waterfall', () => {
  it('fills each bucket in order and reports the leftover', () => {
    expect(waterfall(1000, [400, 400, 400]))
      .toEqual({ taken: [400, 400, 200], remainder: 0 })
    expect(waterfall(1000, [400, 300]))
      .toEqual({ taken: [400, 300], remainder: 300 })
  })

  it('gives an overpayment back as remainder, to become a credit', () => {
    const { taken, remainder } = waterfall(500_000, [200_000])
    expect(taken).toEqual([200_000])
    expect(remainder).toBe(300_000)
  })

  it('never takes from a negative capacity', () => {
    expect(waterfall(1000, [-500, 600])).toEqual({ taken: [0, 600], remainder: 400 })
  })
})

describe('formatPaise', () => {
  it('groups in lakhs, not thousands', () => {
    expect(formatPaise(2_700_000)).toBe('₹27,000')
    expect(formatPaise(123_456_700)).toBe('₹12,34,567')
    expect(formatPaise(300_050, true)).toBe('₹3,000.50')
  })
})

describe('amount in words', () => {
  it('uses Indian grouping', () => {
    expect(numberToIndianWords(27000)).toBe('twenty seven thousand')
    expect(numberToIndianWords(1234567)).toBe('twelve lakh thirty four thousand five hundred sixty seven')
    expect(numberToIndianWords(10000000)).toBe('one crore')
    expect(numberToIndianWords(0)).toBe('zero')
  })

  it('formats the line that goes on a receipt', () => {
    expect(amountInWords(2_700_000)).toBe('Rupees Twenty Seven Thousand Only')
    expect(amountInWords(0)).toBe('Rupees Zero Only')
  })

  it('names paise separately, as an Indian invoice does', () => {
    expect(amountInWords(300_050)).toBe('Rupees Three Thousand and Fifty Paise Only')
  })

  it('handles the teens and the round tens', () => {
    expect(numberToIndianWords(15)).toBe('fifteen')
    expect(numberToIndianWords(70)).toBe('seventy')
    expect(numberToIndianWords(100)).toBe('one hundred')
    expect(numberToIndianWords(101)).toBe('one hundred one')
  })
})
