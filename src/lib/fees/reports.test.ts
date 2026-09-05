import { describe, expect, it } from 'vitest'
import { AGING_LABEL, AGING_ORDER, parseQuestion } from './reports'

// The question box is the one place in the module where something a person
// typed influences a query. These tests are about the boundary: what a phrase
// resolves to, and — more importantly — that a phrase which resolves to
// nothing returns null rather than guessing.

describe('parseQuestion', () => {
  it('reads a class out of the question the office actually asks', () => {
    const q = parseQuestion("which students of class 5 haven't paid?")
    expect(q?.kind).toBe('unpaid_in_class')
    expect(q?.grade).toBe(5)
    expect(q?.section).toBeUndefined()
  })

  it('picks up a section when one is named', () => {
    const q = parseQuestion('class 8 b who has not paid')
    expect(q?.kind).toBe('unpaid_in_class')
    expect(q?.grade).toBe(8)
    expect(q?.section).toBe('B')
  })

  it('understands the pre-primary grades by name', () => {
    // Pre-primary is stored as a negative grade, so "LKG" has to survive the
    // trip through the parser as -2 rather than as no grade at all.
    const q = parseQuestion('lkg students with dues')
    expect(q?.kind).toBe('unpaid_in_class')
    expect(q?.grade).toBe(-2)
  })

  it('separates "biggest" from "longest overdue"', () => {
    expect(parseQuestion('biggest defaulters')?.kind).toBe('biggest_defaulters')
    expect(parseQuestion('who is most overdue')?.kind).toBe('most_overdue')
  })

  it('routes today, staff and aging to their own shapes', () => {
    expect(parseQuestion('who paid today')?.kind).toBe('paid_today')
    expect(parseQuestion('how much was collected by each clerk')?.kind).toBe('staff_month')
    expect(parseQuestion('show me the aging buckets')?.kind).toBe('aging')
  })

  it('finds the families nobody can reach', () => {
    expect(parseQuestion('families with no number on file')?.kind).toBe('unreachable')
    expect(parseQuestion('who has opted out')?.kind).toBe('unreachable')
  })

  it('returns null rather than guessing at something it does not know', () => {
    // The failure that matters: confidently answering a different question is
    // worse than saying "I did not understand that".
    expect(parseQuestion('what is the school motto')).toBeNull()
    expect(parseQuestion('hello')).toBeNull()
    expect(parseQuestion('a')).toBeNull()
  })

  it('does not treat a bare name or receipt number as a question', () => {
    // These reach the box constantly — they are searches, and the box has to
    // fall through to plain search rather than run a report.
    expect(parseQuestion('AZBAH HANAAN')).toBeNull()
    expect(parseQuestion('MPS/RCP/26-27/0001')).toBeNull()
  })

  it('carries a label a reader can check the interpretation against', () => {
    const q = parseQuestion('class 5 unpaid')
    expect(q?.label).toContain('5')
  })
})

describe('the aging buckets', () => {
  it('runs least late to most late, which is the order the cliff is drawn in', () => {
    expect(AGING_ORDER[0]).toBe('not_yet_due')
    expect(AGING_ORDER[AGING_ORDER.length - 1]).toBe('d90_plus')
  })

  it('names every bucket the view can return', () => {
    AGING_ORDER.forEach(bucket => {
      expect(AGING_LABEL[bucket]).toBeTruthy()
    })
  })
})
