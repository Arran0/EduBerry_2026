import { describe, it, expect } from 'vitest'
import { gradeLetter, markPercent, rescaleMark, roundMark } from './reportCardGrading'

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('rescaleMark', () => {
  it('restates a mark against a smaller maximum', () => {
    // The total-conversion column: a test marked out of 120, reported out of 50.
    expect(rescaleMark(90, 120, 50)).toBe(37.5)
    // The import rescale: a marksheet marked out of 50, imported as a /20 part.
    expect(rescaleMark(45, 50, 20)).toBe(18)
  })

  it('restates a mark against a larger maximum', () => {
    expect(rescaleMark(18, 20, 80)).toBe(72)
  })

  it('is the identity when the two maximums match', () => {
    expect(rescaleMark(37, 50, 50)).toBe(37)
  })

  it('rounds to two decimals rather than trailing float noise', () => {
    // 47/50 out of 20 is 18.8 — not 18.799999999999997.
    expect(rescaleMark(47, 50, 20)).toBe(18.8)
    expect(rescaleMark(1, 3, 10)).toBe(3.33)
  })

  it('keeps full marks full and zero zero', () => {
    expect(rescaleMark(50, 50, 20)).toBe(20)
    expect(rescaleMark(0, 50, 20)).toBe(0)
  })

  it('has nothing to scale when there is no mark', () => {
    expect(rescaleMark(null, 50, 20)).toBeNull()
    expect(rescaleMark(undefined, 50, 20)).toBeNull()
  })

  it('refuses a source maximum that cannot be divided by', () => {
    expect(rescaleMark(10, 0, 20)).toBeNull()
    expect(rescaleMark(10, -5, 20)).toBeNull()
    expect(rescaleMark(10, Number.NaN, 20)).toBeNull()
  })

  it('refuses a nonsensical target', () => {
    expect(rescaleMark(10, 50, -1)).toBeNull()
    expect(rescaleMark(10, 50, Number.NaN)).toBeNull()
  })

  it('round-trips back to the original scale within rounding', () => {
    const down = rescaleMark(45, 50, 20)!
    expect(rescaleMark(down, 20, 50)).toBe(45)
  })
})

describe('gradeLetter', () => {
  it('bands a component percentage the same way it bands a total', () => {
    expect(gradeLetter(95).letter).toBe('A1')
    expect(gradeLetter(75).letter).toBe('B1')
    expect(gradeLetter(33).letter).toBe('D')
    expect(gradeLetter(10).letter).toBe('E')
  })
})

describe('roundMark', () => {
  it('takes a half up, which is how marks are entered', () => {
    expect(roundMark(17.5)).toBe(18)
    expect(roundMark(8.5)).toBe(9)
    expect(roundMark(0.5)).toBe(1)
  })

  it('rounds the finer fractions rescaling leaves behind', () => {
    expect(roundMark(18.79)).toBe(19)
    expect(roundMark(18.2)).toBe(18)
  })

  it('leaves a whole mark alone', () => {
    expect(roundMark(20)).toBe(20)
    expect(roundMark(0)).toBe(0)
  })

  it('passes a missing mark through rather than calling it zero', () => {
    expect(roundMark(null)).toBeNull()
    expect(roundMark(undefined)).toBeNull()
    expect(roundMark(Number.NaN)).toBeNull()
  })
})

describe('markPercent', () => {
  it('divides the two figures the page actually shows', () => {
    // 17.5/20 is printed as 18/20, so the percentage has to be 90, not 87.5 —
    // otherwise dividing the numbers on the card contradicts the card.
    expect(markPercent(17.5, 20)).toBe(90)
  })

  it('bands on the figure it printed', () => {
    expect(gradeLetter(markPercent(17.5, 20)!).letter).toBe('A2')
  })

  it('has no answer without a maximum', () => {
    expect(markPercent(10, 0)).toBeNull()
    expect(markPercent(10, 0.4)).toBeNull()
  })
})
