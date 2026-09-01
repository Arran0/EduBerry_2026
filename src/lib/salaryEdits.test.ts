// ============================================================================
// Which pay cycle rows need a human to vouch for them before the month locks.
//
// Two ways this goes wrong and neither shows on screen: count the app's own
// PF/ESI/LOP/bonus rows as hand edits and every row lands behind the sign-off
// gate, which trains people to tick without looking; miss a real edit and a
// mistyped figure walks straight into a bank transfer. The third is subtler —
// a sign-off that survives the next edit to the row it was signing off.
// ============================================================================

import { describe, it, expect } from 'vitest'
import { PAYROLL_ITEM_LABELS } from './payroll'
import { EditableRecord, describeRecordEdits, editFingerprint } from './salaryEdits'

function rec(over: Partial<EditableRecord> = {}): EditableRecord {
  return {
    base_amount: 30000,
    working_days_override: null,
    leave_override: null,
    late_override: null,
    half_day_override: null,
    pf_amount_override: null,
    esi_amount_override: null,
    items: [],
    ...over,
  }
}

describe('describeRecordEdits', () => {
  it('says nothing about an untouched row', () => {
    expect(describeRecordEdits(rec(), 30000)).toEqual([])
  })

  it('reports each override that has been set', () => {
    expect(describeRecordEdits(rec({ working_days_override: 24 }), 30000)).toEqual(['days:24'])
    expect(describeRecordEdits(rec({ leave_override: 3 }), 30000)).toEqual(['leave:3'])
    expect(describeRecordEdits(rec({ late_override: 5 }), 30000)).toEqual(['late:5'])
    expect(describeRecordEdits(rec({ half_day_override: 2 }), 30000)).toEqual(['half:2'])
    expect(describeRecordEdits(rec({ pf_amount_override: 0 }), 30000)).toEqual(['pf:0'])
    expect(describeRecordEdits(rec({ esi_amount_override: 120 }), 30000)).toEqual(['esi:120'])
  })

  it('counts an override of zero — that is the one most worth checking', () => {
    // `?? null` on a falsy override would drop this, and a PF silently pinned
    // to zero is exactly the mistake the gate exists to catch.
    expect(describeRecordEdits(rec({ pf_amount_override: 0 }), 30000)).toHaveLength(1)
  })

  it('flags a base that departs from the person’s standing salary', () => {
    expect(describeRecordEdits(rec({ base_amount: 32000 }), 30000)).toEqual(['base:32000'])
    expect(describeRecordEdits(rec({ base_amount: '30000.00' }), 30000)).toEqual([])
  })

  it('leaves the base alone when there is no standing salary to differ from', () => {
    // A generated placeholder row for someone with no base-salary config is
    // not somebody's typo.
    expect(describeRecordEdits(rec({ base_amount: 0 }), null)).toEqual([])
    expect(describeRecordEdits(rec({ base_amount: 0 }), undefined)).toEqual([])
  })

  it('ignores the rows the app writes for itself', () => {
    const auto = rec({
      items: [
        { label: PAYROLL_ITEM_LABELS.pf, amount: -1800 },
        { label: PAYROLL_ITEM_LABELS.esi, amount: -225 },
        { label: PAYROLL_ITEM_LABELS.lopLeave, amount: -1150 },
        { label: PAYROLL_ITEM_LABELS.bonus, amount: 400 },
        { label: 'Task bonus (June 2026) · 4 pts', amount: 200 },
      ],
    })
    expect(describeRecordEdits(auto, 30000)).toEqual([])
  })

  it('counts what a person added by hand', () => {
    const manual = rec({
      items: [
        { label: PAYROLL_ITEM_LABELS.pf, amount: -1800 },
        { label: 'Festival advance', amount: -2500 },
        { label: 'Exam duty', amount: 1500 },
      ],
    })
    expect(describeRecordEdits(manual, 30000)).toEqual(['items:Exam duty=1500|Festival advance=-2500'])
  })

  it('reads the same however the items happen to be ordered', () => {
    const a = rec({ items: [{ label: 'B', amount: 1 }, { label: 'A', amount: 2 }] })
    const b = rec({ items: [{ label: 'A', amount: 2 }, { label: 'B', amount: 1 }] })
    expect(describeRecordEdits(a, 30000)).toEqual(describeRecordEdits(b, 30000))
  })

  it('lists every edit on a row that has several', () => {
    const busy = rec({
      base_amount: 31000,
      working_days_override: 24,
      half_day_override: 2,
      items: [{ label: 'Uniform recovery', amount: -600 }],
    })
    expect(describeRecordEdits(busy, 30000)).toEqual([
      'base:31000', 'days:24', 'half:2', 'items:Uniform recovery=-600',
    ])
  })
})

describe('editFingerprint', () => {
  it('changes when any edited value changes, so the sign-off does not carry over', () => {
    const before = editFingerprint(describeRecordEdits(rec({ leave_override: 3 }), 30000))
    const after = editFingerprint(describeRecordEdits(rec({ leave_override: 4 }), 30000))
    expect(after).not.toBe(before)
  })

  it('changes when an edit is added to an already-edited row', () => {
    const one = editFingerprint(describeRecordEdits(rec({ leave_override: 3 }), 30000))
    const two = editFingerprint(describeRecordEdits(rec({ leave_override: 3, late_override: 1 }), 30000))
    expect(two).not.toBe(one)
  })

  it('holds steady while the row does', () => {
    const a = editFingerprint(describeRecordEdits(rec({ half_day_override: 2 }), 30000))
    const b = editFingerprint(describeRecordEdits(rec({ half_day_override: 2 }), 30000))
    expect(a).toBe(b)
    expect(a).not.toBe('')
  })
})
